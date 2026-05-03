import { ImportForm } from "@/components/ImportForm";
import { Card } from "@/components/Card";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Import workout</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Paste a Strong-app txt export. The deterministic parser handles reps, weight × reps, and time-based sets.
        </p>
      </header>

      <Card>
        <ImportForm />
      </Card>

      <Card title="Format reference">
        <pre className="text-xs whitespace-pre-wrap text-[var(--muted)] font-mono">
{`Afternoon Workout
Saturday, May 2, 2026 at 3:59 PM

Pull Up
Set 1: 11 reps
Set 2: 10 reps

Shoulder Press (Dumbbell)
Set 1: 35 lb × 10

Plank
Set 1: 1:00

https://link.strong.app/...`}
        </pre>
      </Card>
    </div>
  );
}
