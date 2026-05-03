import { formatJson } from "./json";
import { formatMarkdown } from "./markdown";
import { formatPlain } from "./plain";
import { formatStrong } from "./strong";
import type { ExportFormat, FormattableWorkout } from "./types";

export function formatWorkout(w: FormattableWorkout, format: ExportFormat): string {
  switch (format) {
    case "strong":
      return formatStrong(w);
    case "markdown":
      return formatMarkdown(w);
    case "plain":
      return formatPlain(w);
    case "json":
      return formatJson(w);
  }
}

export type { ExportFormat, FormattableWorkout } from "./types";
