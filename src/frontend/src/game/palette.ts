// Per-slime colour, derived from the id.
//
// matplotlib's `tab10` — the categorical palette it cycles through for unlabelled series.
// Chosen over generating hues from the id (`hsl(id * 137.5deg …)`) because a golden-angle
// sweep still lands neighbouring hues on adjacent ids and puts nothing between yellow and
// green that survives a dark background; tab10 is hand-tuned to stay distinguishable.
//
// Ten colours means ids 3 and 13 collide. That is the right trade for a debug view — a
// wrong-but-stable colour reads better than a palette that drifts as the world fills.
const TAB10 = [
  "#1f77b4", // blue
  "#ff7f0e", // orange
  "#2ca02c", // green
  "#d62728", // red
  "#9467bd", // purple
  "#8c564b", // brown
  "#e377c2", // pink
  "#7f7f7f", // grey
  "#bcbd22", // olive
  "#17becf", // cyan
] as const;

/** Stable colour for a slime id. Ids are uint32 and start at 1. */
export function colorForId(id: number): string {
  const index = ((Math.trunc(id) % TAB10.length) + TAB10.length) % TAB10.length;
  return TAB10[index] as string;
}

/**
 * Black or white, whichever stays readable on `hex`. The id label sits inside the slime, and
 * tab10 spans light olive to dark blue, so a fixed label colour is unreadable on one end.
 * Uses the WCAG relative-luminance threshold rather than a naive average.
 */
export function labelColorOn(hex: string): string {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.35 ? "#10131a" : "#f2f5fa";
}
