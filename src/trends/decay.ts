import type { GitLogEntry, DecaySignal } from "../types.js";

export function detectDecay(entries: GitLogEntry[]): DecaySignal[] {
  const fileChanges = new Map<string, { date: string }[]>();

  for (const entry of entries) {
    for (const file of entry.files) {
      const changes = fileChanges.get(file) ?? [];
      changes.push({ date: entry.date });
      fileChanges.set(file, changes);
    }
  }

  const signals: DecaySignal[] = [];

  for (const [file, changes] of fileChanges) {
    if (changes.length < 4) continue;

    const sorted = [...changes].sort((a, b) => a.date.localeCompare(b.date));

    // Compare change density: split timeline by time, not count
    const firstDate = new Date(sorted[0].date).getTime();
    const lastDate = new Date(sorted[sorted.length - 1].date).getTime();
    const midDate = firstDate + (lastDate - firstDate) / 2;

    const firstHalfCount = sorted.filter((c) => new Date(c.date).getTime() <= midDate).length;
    const secondHalfCount = sorted.length - firstHalfCount;

    // More changes in second half of the time window = accelerating churn
    if (secondHalfCount > firstHalfCount) {
      signals.push({
        file,
        metric: "churn",
        trend: "declining",
        dataPoints: sorted.map((c, i) => ({ date: c.date, value: i + 1 })),
      });
    }
  }

  return signals;
}
