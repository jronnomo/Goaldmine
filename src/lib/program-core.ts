// Plain async helpers for Program mutations + reads (#310/#311, Sprint 17 seam flip).
//
// IMPORTANT: this module intentionally has NO server-action directive at the
// top — same dual-caller contract as goal-core.ts. It is imported from MCP
// tool registrations (src/lib/mcp/tools/program-tools.ts) today and from
// server actions / the /program dashboard later.
//
// Validation guards live here as defensive contract checks; the MCP tool
// callers also Zod-validate inputs for wire-level friendly errors.
//
// Scoping: every DB access goes through getDb() (Program/Goal/Plan are all
// SCOPED_MODELS) — userId is injected into reads and writes automatically.
// No nested relation WRITES anywhere in this file (gotcha §B.10: nested
// writes bypass the $extends injection) — every mutation is a sequential
// top-level call.
//
// One-active-per-user invariant: enforced at the DB level by the raw-SQL
// partial unique index `program_one_active_per_user` (see prisma/schema.prisma
// above `model Program`). setProgramStatusCore pre-checks for a friendly
// error AND catches the P2002 a concurrent activate race produces.

import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

// ---------------------------------------------------------------------------
// Status enum
// ---------------------------------------------------------------------------

export const PROGRAM_STATUSES = ["draft", "active", "completed", "archived"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

// ---------------------------------------------------------------------------
// Attribution rules schema
//
// TODO(consolidate): src/lib/attribution-rules.ts is being built in a sibling
// worktree (auto-link engine). Once it lands, replace this local schema with
// an import from there — keeping the two extra authoring guards below
// (≥1 match criterion, ≥1 goalId). Shape mirrors the Program.attributionRules
// doc comment in prisma/schema.prisma (design amendment 1,
// docs/program-redesign/03-run-amendments.md).
// ---------------------------------------------------------------------------

export const AttributionRuleSchema = z.object({
  match: z
    .object({
      titleContains: z.array(z.string().min(1)).optional(),
      exerciseContains: z.array(z.string().min(1)).optional(),
      source: z.string().min(1).optional(),
    })
    .refine(
      (m) =>
        (m.titleContains?.length ?? 0) > 0 ||
        (m.exerciseContains?.length ?? 0) > 0 ||
        !!m.source,
      {
        message:
          "each rule's match needs at least one of titleContains, exerciseContains, source — an empty match would match every activity",
      },
    ),
  goalIds: z.array(z.string().min(1)).min(1, "each rule needs at least one goalId"),
  note: z.string().optional(),
});

export const AttributionRulesSchema = z.array(AttributionRuleSchema);
export type AttributionRule = z.infer<typeof AttributionRuleSchema>;

// ---------------------------------------------------------------------------
// Shared row projection (never selects userId — leaky-reads discipline)
// ---------------------------------------------------------------------------

const PROGRAM_SELECT = {
  id: true,
  name: true,
  status: true,
  startedOn: true,
  endsOn: true,
  notes: true,
  attributionRules: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface ProgramRow {
  id: string;
  name: string;
  status: string;
  startedOn: Date;
  endsOn: Date | null;
  notes: string | null;
  attributionRules: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function isP2002(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

function alreadyActiveError(other: { id: string; name: string }): Error {
  return new Error(
    `Program "${other.name}" (${other.id}) is already active — only one Program can be active per user (DB-enforced). ` +
      `Set it to completed or archived via set_program_status first, then activate this one.`,
  );
}

// ---------------------------------------------------------------------------
// createProgramCore
// ---------------------------------------------------------------------------
// Status is ALWAYS the schema default "draft" — activation is set_program_status's
// job (that is where the one-active invariant lives), so create can never
// trip program_one_active_per_user.
// ---------------------------------------------------------------------------

export interface CreateProgramCoreInput {
  name: string;
  startedOn: Date;
  endsOn?: Date | null;
  notes?: string | null;
}

export async function createProgramCore(
  input: CreateProgramCoreInput,
): Promise<ProgramRow> {
  if (!input.name.trim()) throw new Error("name required");
  if (Number.isNaN(input.startedOn.getTime())) throw new Error("invalid startedOn");
  const endsOn = input.endsOn ?? null;
  if (endsOn !== null) {
    if (Number.isNaN(endsOn.getTime())) throw new Error("invalid endsOn");
    if (endsOn < input.startedOn) {
      throw new Error("endsOn is before startedOn — a Program cannot end before it starts.");
    }
  }

  const db = await getDb();
  return db.program.create({
    data: {
      name: input.name.trim(),
      startedOn: input.startedOn,
      endsOn,
      notes: input.notes?.trim() || null,
      // status omitted — schema default "draft"
    },
    select: PROGRAM_SELECT,
  });
}

// ---------------------------------------------------------------------------
// updateProgramCore
// ---------------------------------------------------------------------------
// True PATCH semantics: only fields present on the patch object change.
// `endsOn: null` / `notes: null` / `attributionRules: null` clear the field;
// `undefined` (absent) leaves it untouched. status is deliberately NOT
// patchable here — setProgramStatusCore owns lifecycle + the one-active
// invariant.
//
// attributionRules note: replacing the rules array never retracts
// ActivityGoalLink rows already created (v1 append-only-in-effect policy) —
// rules shape FUTURE auto-linking only.
// ---------------------------------------------------------------------------

export interface UpdateProgramCorePatch {
  name?: string;
  startedOn?: Date;
  endsOn?: Date | null;
  notes?: string | null;
  attributionRules?: AttributionRule[] | null;
}

export interface UpdateProgramCoreResult {
  program: ProgramRow;
  /** Field names actually written. Empty array = no-op call (no write ran). */
  changed: string[];
}

export async function updateProgramCore(
  id: string,
  patch: UpdateProgramCorePatch,
): Promise<UpdateProgramCoreResult> {
  const db = await getDb();

  const existing = await db.program.findUnique({
    where: { id },
    select: PROGRAM_SELECT,
  });
  if (!existing) throw new Error(`Program not found: ${id}`);

  const changed: string[] = [];
  const data: Prisma.ProgramUpdateInput = {};

  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error("name cannot be blank");
    data.name = patch.name.trim();
    changed.push("name");
  }
  if (patch.startedOn !== undefined) {
    if (Number.isNaN(patch.startedOn.getTime())) throw new Error("invalid startedOn");
    data.startedOn = patch.startedOn;
    changed.push("startedOn");
  }
  if (patch.endsOn !== undefined) {
    if (patch.endsOn !== null && Number.isNaN(patch.endsOn.getTime())) {
      throw new Error("invalid endsOn");
    }
    data.endsOn = patch.endsOn;
    changed.push("endsOn");
  }
  if (patch.notes !== undefined) {
    data.notes = patch.notes?.trim() || null;
    changed.push("notes");
  }
  if (patch.attributionRules !== undefined) {
    if (patch.attributionRules === null) {
      data.attributionRules = Prisma.JsonNull;
    } else {
      const parsed = AttributionRulesSchema.safeParse(patch.attributionRules);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new Error(
          `attributionRules invalid${first ? ` at ${first.path.join(".") || "(root)"}: ${first.message}` : ""}. ` +
            `Expected Array<{ match: { titleContains?: string[], exerciseContains?: string[], source?: string }, goalIds: string[], note?: string }>.`,
        );
      }
      data.attributionRules = parsed.data as unknown as Prisma.InputJsonValue;
    }
    changed.push("attributionRules");
  }

  if (changed.length === 0) {
    return { program: existing, changed };
  }

  // Merged-window guard: the effective window (existing values overlaid with
  // the patch) must still make sense — endsOn cannot precede startedOn.
  const effStart = patch.startedOn ?? existing.startedOn;
  const effEnd = patch.endsOn === undefined ? existing.endsOn : patch.endsOn;
  if (effEnd !== null && effEnd < effStart) {
    throw new Error(
      "endsOn is before startedOn — a Program cannot end before it starts. " +
        "Patch both dates together if you are moving the whole window.",
    );
  }

  const program = await db.program.update({
    where: { id },
    data,
    select: PROGRAM_SELECT,
  });
  return { program, changed };
}

// ---------------------------------------------------------------------------
// setProgramStatusCore
// ---------------------------------------------------------------------------
// The ONLY lifecycle mutator. Second-activate handling is two-layered:
//  1. Pre-check inside the transaction — finds the current active Program and
//     throws a friendly error NAMING it (the common path).
//  2. P2002 catch — a concurrent activate race slips past the pre-check and
//     trips the program_one_active_per_user partial unique index; we re-query
//     the winner and throw the same friendly error (never a raw Postgres
//     unique-violation).
// Same-status calls are an idempotent no-op (changed:false), not an error.
// ---------------------------------------------------------------------------

export interface SetProgramStatusCoreResult {
  id: string;
  name: string;
  previousStatus: string;
  status: string;
  changed: boolean;
}

export async function setProgramStatusCore(
  id: string,
  status: ProgramStatus,
): Promise<SetProgramStatusCoreResult> {
  const db = await getDb();
  try {
    return await db.$transaction(async (tx) => {
      const program = await tx.program.findUnique({
        where: { id },
        select: { id: true, name: true, status: true },
      });
      if (!program) throw new Error(`Program not found: ${id}`);

      if (program.status === status) {
        return {
          id: program.id,
          name: program.name,
          previousStatus: program.status,
          status,
          changed: false,
        };
      }

      if (status === "active") {
        const otherActive = await tx.program.findFirst({
          where: { status: "active", NOT: { id } },
          select: { id: true, name: true },
        });
        if (otherActive) throw alreadyActiveError(otherActive);
      }

      const updated = await tx.program.update({
        where: { id },
        data: { status },
        select: { id: true, name: true, status: true },
      });
      return {
        id: updated.id,
        name: updated.name,
        previousStatus: program.status,
        status: updated.status,
        changed: true,
      };
    });
  } catch (e) {
    if (isP2002(e)) {
      // Concurrent-activate race: another Program won between the pre-check
      // and our update. Name the winner if we can still see it.
      const winner = await db.program.findFirst({
        where: { status: "active", NOT: { id } },
        select: { id: true, name: true },
      });
      throw winner
        ? alreadyActiveError(winner)
        : new Error(
            "Another Program is already active — only one Program can be active per user (DB-enforced). " +
              "Set it to completed or archived via set_program_status first.",
          );
    }
    throw e;
  }
}
