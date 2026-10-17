"use client";

/*
 * Kitchen timers started from steps ("rest 30 min"). They live on this
 * device only (localStorage), survive a reload, and keep running whatever
 * page is open. Read with useTimers(); change with the functions below.
 */

import { useSyncExternalStore } from "react";

export type Timer = {
  id: string;
  /** What it's for: the step's text, shortened. */
  label: string;
  /** The page it was started from, to jump back to it. */
  pageId: string;
  pageTitle: string;
  emoji: string;
  /** The block it came from, so its button can show it's running. */
  blockId: string;
  totalMs: number;
  /** When it goes off; null while paused. */
  endsAt: number | null;
  /** Time left while paused. */
  leftMs: number;
  /** It went off and nobody has stopped it yet. */
  ringing: boolean;
};

const KEY = "tasks-timers-v1";
const EMPTY: Timer[] = [];
let timers: Timer[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

const load = () => {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) timers = JSON.parse(raw) as Timer[];
  } catch {
    timers = EMPTY;
  }
};

const set = (next: Timer[]) => {
  timers = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage full or blocked: timers still run until a reload
  }
  for (const l of listeners) l();
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const get = () => {
  load();
  return timers;
};

/** Timers on this device; empty during a server render. */
export const useTimers = () => useSyncExternalStore(subscribe, get, () => EMPTY);

/** Time left on a timer at `now`. */
export const leftOf = (t: Timer, now: number) => (t.endsAt === null ? t.leftMs : Math.max(0, t.endsAt - now));

export function startTimer(t: Omit<Timer, "id" | "endsAt" | "leftMs" | "ringing">) {
  load();
  unlockSound(); // a tap started this, so the browser lets us make noise later
  set([
    ...timers,
    { ...t, id: crypto.randomUUID(), endsAt: Date.now() + t.totalMs, leftMs: t.totalMs, ringing: false },
  ]);
}

export const pauseTimer = (id: string) =>
  set(timers.map((t) => (t.id === id && t.endsAt !== null ? { ...t, leftMs: leftOf(t, Date.now()), endsAt: null } : t)));

export const resumeTimer = (id: string) =>
  set(timers.map((t) => (t.id === id && t.endsAt === null ? { ...t, endsAt: Date.now() + t.leftMs } : t)));

export const removeTimer = (id: string) => set(timers.filter((t) => t.id !== id));

/** Mark timers that have run out as ringing; returns whether any just went off. */
export function checkTimers(now: number) {
  let fired = false;
  const next = timers.map((t) => {
    if (t.ringing || t.endsAt === null || t.endsAt > now) return t;
    fired = true;
    return { ...t, ringing: true, leftMs: 0 };
  });
  if (fired) set(next);
  return fired;
}

/* ---------- sound ---------- */

let audio: AudioContext | null = null;

export function unlockSound() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") audio.resume().catch(() => {});
  } catch {
    audio = null;
  }
}

/** Three short beeps, loud enough for a kitchen. */
export function beep() {
  if (!audio) return;
  const t0 = audio.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "square";
    osc.frequency.value = 1320;
    gain.gain.setValueAtTime(0.0001, t0 + i * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.25 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.25 + 0.18);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0 + i * 0.25);
    osc.stop(t0 + i * 0.25 + 0.2);
  }
  navigator.vibrate?.([300, 120, 300, 120, 300]);
}
