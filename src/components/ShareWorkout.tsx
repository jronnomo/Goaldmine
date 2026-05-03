"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { formatWorkout, type ExportFormat, type FormattableWorkout } from "@/lib/formatters";

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "strong", label: "Strong" },
  { id: "markdown", label: "Markdown" },
  { id: "plain", label: "Plain" },
  { id: "json", label: "JSON" },
];

export function ShareWorkout({ workout }: { workout: FormattableWorkout }) {
  const [format, setFormat] = useState<ExportFormat>("strong");
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => {
    // Re-hydrate dates that crossed the server/client boundary as strings.
    const w = { ...workout, startedAt: new Date(workout.startedAt) };
    return formatWorkout(w, format);
  }, [workout, format]);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function download() {
    const ext = format === "json" ? "json" : format === "markdown" ? "md" : "txt";
    const filename = `${(workout.title ?? "workout").replace(/[^\w\-]+/g, "-")}.${ext}`;
    const blob = new Blob([text], {
      type: format === "json" ? "application/json" : "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Card title="Share">
      <div className="flex gap-1 mb-2 flex-wrap">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFormat(f.id)}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              format === f.id
                ? "bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]"
                : "border-[var(--border)] text-[var(--muted)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <pre className="text-xs font-mono bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 max-h-60 overflow-auto whitespace-pre-wrap">
        {text}
      </pre>
      <div className="flex gap-2 mt-2">
        <button
          onClick={copy}
          className="flex-1 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-3 py-2 text-sm font-medium"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          onClick={download}
          className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium"
        >
          Download
        </button>
      </div>
    </Card>
  );
}
