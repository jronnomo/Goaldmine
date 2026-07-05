// src/lib/auth/access-request-actions.test.ts
//
// Unit tests for submitAccessRequest (REQ-002 / #222).
// Mocks @/lib/db using the exact dual-export convention from
// src/lib/auth/invite-gate.test.ts:9-21 (both `prisma` and `getDb` exported,
// getDb kept as an empty stub so any stale import doesn't error).
//
// Also mocks next/headers (headers() throws outside a request scope) and
// @/lib/rate-limit (so the rate-limit behavior is deterministic and doesn't
// depend on ambient UPSTASH_* env vars — that behavior is covered separately
// in src/lib/rate-limit.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    accessRequest: {
      create: vi.fn(),
    },
  },
  getDb: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

const { mockCheckRateLimit, mockGetClientIp } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));

import { submitAccessRequest } from "@/lib/auth/access-request-actions";
import { prisma } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAccessRequest = prisma.accessRequest as any;

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

describe("submitAccessRequest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetClientIp.mockReturnValue("1.2.3.4");
    mockCheckRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
    mockAccessRequest.create.mockResolvedValue({ id: "ar_1" });
  });

  it("rejects a missing email", async () => {
    const result = await submitAccessRequest(fd({}));
    expect(result.ok).toBe(false);
    expect(mockAccessRequest.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid-shaped email", async () => {
    const result = await submitAccessRequest(fd({ email: "not-an-email" }));
    expect(result.ok).toBe(false);
    expect(mockAccessRequest.create).not.toHaveBeenCalled();
  });

  it("rejects an oversized email (> 254 chars)", async () => {
    const longEmail = `${"a".repeat(250)}@b.com`; // > 254 chars total
    expect(longEmail.length).toBeGreaterThan(254);
    const result = await submitAccessRequest(fd({ email: longEmail }));
    expect(result.ok).toBe(false);
    expect(mockAccessRequest.create).not.toHaveBeenCalled();
  });

  it("rejects a note longer than 1000 chars", async () => {
    const result = await submitAccessRequest(
      fd({ email: "person@example.com", note: "x".repeat(1001) }),
    );
    expect(result.ok).toBe(false);
    expect(mockAccessRequest.create).not.toHaveBeenCalled();
  });

  it("silently drops when the honeypot field is filled, returning ok:true without writing", async () => {
    const result = await submitAccessRequest(
      fd({ email: "person@example.com", company: "I am a bot" }),
    );
    expect(result).toEqual({ ok: true });
    expect(mockAccessRequest.create).not.toHaveBeenCalled();
  });

  it("accepts a valid submission and writes a lowercased email", async () => {
    const result = await submitAccessRequest(
      fd({ email: "Person@Example.COM", note: "please let me in" }),
    );
    expect(result).toEqual({ ok: true });
    expect(mockAccessRequest.create).toHaveBeenCalledWith({
      data: {
        email: "person@example.com",
        note: "please let me in",
      },
    });
  });

  it("returns a friendly error when rate-limited", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 3600 });
    const result = await submitAccessRequest(fd({ email: "person@example.com" }));
    expect(result).toEqual({
      ok: false,
      error: "Too many requests — try again in an hour.",
    });
    expect(mockAccessRequest.create).not.toHaveBeenCalled();
  });
});
