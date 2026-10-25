import type { CSSProperties } from "react";

const PROJECT_BADGE_LABELS: Readonly<Record<string, string>> = {
  personal: "PE",
  deeplog: "DL",
  unplan: "UP",
  "smash-leaderboard": "SL",
  general: "GL",
  "os-v2": "COS",
  "os-web": "COS",
  inbox0: "i0",
  guestbook: "GB",
  retrace: "RT",
};

const PROJECT_BADGE_TONES: Readonly<
  Record<string, { hue: number; chroma: number }>
> = {
  PE: { hue: 95, chroma: 0.065 },
  DL: { hue: 45, chroma: 0.045 },
  UP: { hue: 300, chroma: 0.045 },
  SL: { hue: 20, chroma: 0.065 },
  GL: { hue: 240, chroma: 0 },
  COS: { hue: 240, chroma: 0 },
  i0: { hue: 240, chroma: 0.008 },
  GB: { hue: 185, chroma: 0.045 },
  RT: { hue: 265, chroma: 0.045 },
};

export function projectBadgeStyle(label: string): CSSProperties {
  const tone = Object.hasOwn(PROJECT_BADGE_TONES, label)
    ? PROJECT_BADGE_TONES[label]
    : {
        hue:
          Array.from(label).reduce(
            (hash, character) => hash * 31 + (character.codePointAt(0) ?? 0),
            0,
          ) % 360,
        chroma: 0.045,
      };
  const { hue, chroma } = tone;
  const lightnessOffset =
    label === "DL" || label === "SL" || label === "PE" ? 0.08 : 0;
  const base = `oklch(from var(--canvas) ${0.27 + lightnessOffset} ${chroma} ${hue})`;
  const highlight = `oklch(from var(--canvas) ${0.31 + lightnessOffset} ${chroma} ${hue})`;
  const edge = `oklch(from var(--canvas) ${0.36 + lightnessOffset} ${chroma} ${hue})`;
  return {
    backgroundColor: base,
    backgroundImage: `linear-gradient(160deg, ${highlight}, ${base} 65%)`,
    color: `oklch(from var(--ink) ${0.8 + lightnessOffset} ${chroma * 2} ${hue})`,
    boxShadow: `inset 0 1px 0 ${edge}`,
  };
}

export function projectBadgeLabel(name: string): string {
  const normalized = name.trim();
  const key = normalized.toLowerCase();
  if (Object.hasOwn(PROJECT_BADGE_LABELS, key))
    return PROJECT_BADGE_LABELS[key];
  const words = normalized.split(/[\s_-]+/u).filter(Boolean);
  const initials =
    words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => Array.from(word)[0])
          .join("")
      : Array.from(normalized).slice(0, 2).join("");
  return initials.toLocaleUpperCase();
}
