/**
 * JS mirror of app/tokens.css, for the few places that cannot use CSS classes:
 * <canvas> drawing, SVG attributes and Leaflet vector layers. Keep in sync with tokens.css.
 */
export const tokens = {
  canvas: "#f5f1e8",
  surface: "#fbf9f4",
  raised: "#fffdf9",
  line: "#e5ded2",
  lineStrong: "#d3cabb",
  ink: "#252525",
  ink2: "#6f6a62",
  accent: "#e67e22",
  accentSoft: "#f2a65a",
  ok: "#2e8b57",
  warn: "#c88920",
  crit: "#c94c4c",
  video: "#141311",
  videoInk: "#f3efe6",
} as const;

export type Tone = "neutral" | "accent" | "ok" | "warn" | "crit";
