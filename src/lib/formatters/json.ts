import type { FormattableWorkout } from "./types";

export function formatJson(w: FormattableWorkout): string {
  return JSON.stringify(w, null, 2) + "\n";
}
