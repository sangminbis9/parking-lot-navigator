import type { CandidateEvent, CandidateSource, QualityScore, ScoredCandidate, SourceRunSummary } from "./types.js";

const sourceLabels: Record<CandidateSource, string> = {
  kakao_place_feed: "Kakao Place Feed",
  naver_place_feed: "Naver Place Feed",
  instagram: "Instagram Business Discovery"
};

export function score(c: CandidateEvent): QualityScore {
  const hasImage = c.imageUrls.length > 0;
  const hasDateRange = Boolean(c.startDate || c.endDate);
  const hasBenefit = Boolean(c.benefit);
  const recencyDays = c.postedAt
    ? Math.floor((Date.now() - new Date(c.postedAt).getTime()) / 86400000)
    : null;
  const textLength = (c.body ?? "").length;

  const recencyWeight =
    recencyDays === null ? 0 : recencyDays <= 30 ? 1 : recencyDays <= 90 ? 0.5 : 0;
  const composite =
    (hasImage ? 0.35 : 0) +
    (hasDateRange ? 0.2 : 0) +
    (hasBenefit ? 0.25 : 0) +
    recencyWeight * 0.2;

  return { hasImage, hasDateRange, hasBenefit, recencyDays, textLength, composite };
}

export function buildReport(input: {
  generatedAt: string;
  summaries: SourceRunSummary[];
  scored: ScoredCandidate[];
}): string {
  const lines: string[] = [];
  lines.push("# Crawl PoC Report");
  lines.push("");
  lines.push(`- Generated at: ${input.generatedAt}`);
  lines.push("");
  lines.push("## Source Summary");
  lines.push("");
  lines.push("| Source | Attempted stores | Success | Failed | Skipped | Note |");
  lines.push("|---|---:|---:|---:|---:|---|");
  for (const summary of input.summaries) {
    lines.push(`| ${sourceLabels[summary.source]} | ${summary.attemptedStores} | ${summary.successStores} | ${summary.failedStores} | ${summary.skippedStores} | ${summary.skippedReason ?? ""} |`);
  }
  lines.push("");
  lines.push("## Quality Metrics");
  lines.push("");
  lines.push("| Source | Avg composite | hasImage | hasDateRange | hasBenefit | Avg recency days | Candidates |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const source of Object.keys(sourceLabels) as CandidateSource[]) {
    const rows = input.scored.filter((item) => item.event.source === source);
    const metric = aggregate(rows);
    lines.push(`| ${sourceLabels[source]} | ${format(metric.avgComposite)} | ${formatPercent(metric.hasImageRatio)} | ${formatPercent(metric.hasDateRangeRatio)} | ${formatPercent(metric.hasBenefitRatio)} | ${metric.avgRecencyDays === null ? "n/a" : format(metric.avgRecencyDays)} | ${rows.length} |`);
  }
  lines.push("");

  for (const source of Object.keys(sourceLabels) as CandidateSource[]) {
    const rows = input.scored
      .filter((item) => item.event.source === source)
      .sort((a, b) => b.score.composite - a.score.composite);
    lines.push(`## ${sourceLabels[source]} Samples`);
    lines.push("");
    lines.push("### Top 5");
    appendSamples(lines, rows.slice(0, 5));
    lines.push("");
    lines.push("### Bottom 3");
    appendSamples(lines, rows.slice(-3).reverse());
    lines.push("");
  }

  lines.push("## Conclusion (user-written)");
  lines.push("");
  lines.push("_Fill in after reviewing the quantitative and sample quality results._");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function aggregate(rows: ScoredCandidate[]): {
  avgComposite: number;
  hasImageRatio: number;
  hasDateRangeRatio: number;
  hasBenefitRatio: number;
  avgRecencyDays: number | null;
} {
  if (rows.length === 0) {
    return { avgComposite: 0, hasImageRatio: 0, hasDateRangeRatio: 0, hasBenefitRatio: 0, avgRecencyDays: null };
  }
  const recencyRows = rows.map((row) => row.score.recencyDays).filter((value): value is number => value !== null);
  return {
    avgComposite: average(rows.map((row) => row.score.composite)),
    hasImageRatio: rows.filter((row) => row.score.hasImage).length / rows.length,
    hasDateRangeRatio: rows.filter((row) => row.score.hasDateRange).length / rows.length,
    hasBenefitRatio: rows.filter((row) => row.score.hasBenefit).length / rows.length,
    avgRecencyDays: recencyRows.length > 0 ? average(recencyRows) : null
  };
}

function appendSamples(lines: string[], rows: ScoredCandidate[]): void {
  if (rows.length === 0) {
    lines.push("- No candidates.");
    return;
  }
  for (const { event, score: quality } of rows) {
    lines.push(`- ${event.title ?? "(no title)"} | score=${format(quality.composite)} | benefit=${event.benefit ?? "n/a"} | image=${event.imageUrls[0] ?? "n/a"} | permalink=${event.permalink ?? "n/a"}`);
  }
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function format(value: number): string {
  return value.toFixed(2);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
