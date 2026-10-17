/*
 * Durations written in step text ("simmer ~1 h", "rest 30 min",
 * "bake 1 h 15 min", "20–25 minutes"), so a step can offer a timer.
 * Only explicit time units count; "m" alone is left out (metres, mins?).
 */

const UNIT: Record<string, number> = {
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
};

const NUM = String.raw`(\d+(?:[.,]\d+)?|½)`;
// "1 h", "1.5 hours", "20-25 min", "20 to 25 min" (the lower figure is used), "½ h"
const PART = new RegExp(
  String.raw`${NUM}(?:\s*(?:-|–|to)\s*${NUM})?\s*(hours?|hrs?|h|minutes?|mins?|seconds?|secs?|s)\b`,
  "gi"
);

export type Duration = {
  /** As written, tidied: "1 h 15 min". */
  label: string;
  seconds: number;
};

const toNum = (s: string) => (s === "½" ? 0.5 : Number(s.replace(",", ".")));

/** Durations in a block's text, in order; adjacent parts ("1 h 15 min") are one. */
export function findDurations(text: string): Duration[] {
  const plain = text.replace(/\[\[ing:[^|\]]*\|([^\]]*)\]\]/g, "$1"); // ingredient pills
  const out: Duration[] = [];
  let last: { end: number; d: Duration } | null = null;
  for (const m of plain.matchAll(PART)) {
    const unit = UNIT[m[3].toLowerCase()];
    const n = toNum(m[1]);
    if (!unit || !(n > 0)) continue;
    const secs = Math.round(n * unit);
    const piece = `${m[1]}${m[2] ? "–" + m[2] : ""} ${short(m[3])}`;
    const start = m.index ?? 0;
    // "1 h 15 min": a part right after the previous one adds to it.
    if (last && /^\s*(?:and\s*)?$/i.test(plain.slice(last.end, start))) {
      last.d.seconds += secs;
      last.d.label += " " + piece;
    } else {
      last = { end: 0, d: { label: piece, seconds: secs } };
      out.push(last.d);
    }
    last.end = start + m[0].length;
  }
  return out.filter((d) => d.seconds >= 10 && d.seconds <= 48 * 3600);
}

function short(unit: string) {
  const u = unit.toLowerCase();
  if (u.startsWith("h")) return "h";
  if (u.startsWith("m")) return "min";
  return "s";
}

/** "12:05" under an hour, "1:02:05" above. */
export function fmtClock(totalSeconds: number) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}
