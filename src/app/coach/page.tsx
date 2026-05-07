import { Card } from "@/components/Card";
import { CopyPromptButton } from "@/components/CopyPromptButton";

export const dynamic = "force-dynamic";

const PROMPTS = [
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
          <li key={p.title}>
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
