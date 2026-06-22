// Pure formatting for `composto score` — the shareable repo scorecard.
// Kept separate from the IO-heavy runScore so the viral artifacts (badge,
// share line, dollar math) are unit-testable in isolation.

export const INPUT_PRICE_PER_MTOK = 3; // Claude Sonnet input, $3/Mtok

export function dollarsFor(tokens: number): number {
  return (tokens / 1_000_000) * INPUT_PRICE_PER_MTOK;
}

/** shields.io static badge URL: "AI context NN% smaller". */
export function buildBadgeUrl(savedPercent: number): string {
  const pct = Math.round(savedPercent);
  const msg = encodeURIComponent(`${pct}% smaller`);
  return `https://img.shields.io/badge/AI%20context-${msg}-7c3aed`;
}

export function buildBadgeMarkdown(savedPercent: number): string {
  return `![Composto](${buildBadgeUrl(savedPercent)})`;
}

/** One-liner people paste into a tweet / PR / README. */
export function buildShareLine(
  fileCount: number,
  totalRaw: number,
  totalIR: number,
  savedPercent: number
): string {
  const pct = savedPercent.toFixed(1);
  return (
    `Composto shrinks my ${fileCount}-file project ${pct}% before it hits an AI ` +
    `(${totalRaw.toLocaleString()} → ${totalIR.toLocaleString()} tokens). ` +
    `Try yours: npx composto-ai score`
  );
}
