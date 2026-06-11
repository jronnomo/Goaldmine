import { Card } from "@/components/Card";
import { CopyPromptButton } from "@/components/CopyPromptButton";

export const dynamic = "force-dynamic";

const PROMPTS: Array<{ title: string; when: string; prompt: string; id?: string }> = [
  {
    id: "interview",
    title: "Interview your coach",
    when: "Starting a new goal",
    prompt:
      "I want to add a new goal. Run a goal-intake interview with me — one stage at a time, don't skip ahead:\n\n" +
      "1. Objective — ask what I want to achieve, then distill it into one crisp objective line and confirm it with me.\n" +
      "2. Date — ask whether this has a hard date, a flexible window (pick a date together), or is a someday goal. Someday = no target date: no plan gets scaffolded, no calendar pin, unrated for rarity. That's a fine answer.\n" +
      "3. Benchmarks — ask where I am right now on the 2–4 measures that best predict this goal. Log each answer via log_baseline as we go, so my targets start from real numbers.\n" +
      "4. Constraints — ask about equipment, weekly schedule, and how this sits alongside my current goals (call list_goals for the live slate).\n" +
      "5. Targets — propose a weighted targets array (weights summing to ~1), each tied to a benchmark from step 3, with a one-line rationale per target. Wait for my edits.\n" +
      "6. Feasibility — call preview_goal_feasibility with the proposed targets (and date, if any) BEFORE creating anything. Tell me plainly: this goal's own tier, and what it does to my active stack. If the stack lands epic or legendary, talk me through recalibrating the date, trimming targets, or pausing something first.\n" +
      "7. Create — only on my explicit go-ahead, call create_goal with the objective, date (omit if someday), targets, a coachFeasibility seed ({tier, rationale} summarizing your read from this interview), and attributionHints — the exercise names (exactly as I log them) that count as training this goal, so the app can show when I last trained it. Propose a legend to match the flavor.\n\n" +
      "If this came from an old note, use promote_note_to_goal instead of create_goal at step 7 so the note gets resolved too.",
  },
  {
    title: "Daily check-in",
    when: "Morning, before training",
    prompt:
      "What's on for today? Pull my plan plus any baseline tests due, and call out anything from yesterday's notes I should fold in.",
  },
  {
    title: "Log a Strong-app workout",
    when: "After training",
    prompt:
      "Just finished. Log this:\n\n[paste your Strong-app txt here]",
  },
  {
    title: "Audible: single-day adjustment",
    when: "Plan needs a tweak for one upcoming date",
    prompt:
      "For [YYYY-MM-DD] I need to [reason]. Log a note tagged to that date and propose a day override if needed.",
  },
  {
    title: "Audible: whole-plan adjustment",
    when: "Recurring issue, multi-week implication",
    prompt:
      "I've been [feeling X / dealing with Y / noticing Z] across the last week. Pull recent context and propose a plan revision.",
  },
  {
    title: "Sunday weekly review",
    when: "End of every week",
    prompt:
      "Sunday review time. Pull last week's data, summarize wins and gaps, and propose adjustments for next week. Save the summary as a feedback note.",
  },
  {
    title: "Refine readiness from research",
    when: "Just added a URL or doc reference to the goal",
    prompt:
      "I added a reference to my Mt. Elbert goal: [paste URL or summary]. Pull the goal, read what's there, and propose target adjustments grounded in this source.",
  },
  {
    title: "Log a baseline result",
    when: "Just finished a baseline test",
    prompt: "Did the [test name] today: [value] [units]. Log it.",
  },
  {
    title: "Log a meal from a photo",
    when: "Ate something you can't easily itemize (restaurant, mixed plate)",
    prompt:
      "Here's a photo of my meal — [attach photo]. Identify what's on the plate, estimate the portions and macros, and log it via log_nutrition.\n\nTreat every value as an estimate, not exact. If anything is ambiguous — cooking oil, sauces, portion size — state your assumption and flag it. For reference: [add any portion cues you have, e.g. 'the chicken was ~6 oz', 'light on the dressing', 'used olive oil not butter'].",
  },
  {
    title: "Dry-run a revision",
    when: "Considering a change, want to see the cascade first",
    prompt:
      "I'm thinking about [proposed change]. What would that do to the plan? Don't apply anything yet — walk me through the cascade.",
  },
  {
    title: "Review pending notes",
    when: "Notes have piled up; want to clear them",
    prompt:
      "Pull my pending notes. For each, decide: fold into a plan revision, or acknowledge as no-change-needed. Walk me through each before applying.",
  },
  {
    title: "Ingest goal references",
    when: "Goal has references without a saved summary",
    prompt:
      "Call get_goal for my active goal and check references[]. For each reference that has no claudeSummary yet, fetch its content (web fetch the URL, or read the doc text), distill the method and key takeaways that are relevant to coaching my training, and write each summary back via update_goal_reference. When done, tell me what you learned from each source and how it will influence programming.",
  },
];

export default function CoachPage() {
  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Coach prompts</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Copy and paste into your claude.ai chat. Each prompt is shaped to trigger the right MCP
          tool calls.
        </p>
      </header>

      <Card title="One-time setup">
        <ol className="text-sm space-y-2 list-decimal list-inside">
          <li>
            In claude.ai, create a Project (Settings → Projects). Add the workout-planner
            connector to it.
          </li>
          <li>
            Open the project&apos;s instructions field and paste the coach brief from{" "}
            <code className="text-xs">docs/claude-ai-setup.md</code> in the repo. Saves once;
            applies to every chat in the project.
          </li>
          <li>Use the prompts below from any chat in that project.</li>
        </ol>
      </Card>

      <ul className="space-y-3">
        {PROMPTS.map((p) => (
          <li key={p.title} id={p.id}>
            <Card
              title={p.title}
              action={<CopyPromptButton text={p.prompt} />}
            >
              <p className="text-xs text-[var(--muted)] mb-2">When: {p.when}</p>
              <pre className="text-xs whitespace-pre-wrap font-mono bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                {p.prompt}
              </pre>
            </Card>
          </li>
        ))}
      </ul>

      <p className="text-xs text-[var(--muted)] text-center pt-2">
        Full setup notes + rules in <code>docs/claude-ai-setup.md</code>.
      </p>
    </div>
  );
}
