"use client";

/*
 * Who is using this tablet, so a tick can say "Sam · 10:42". There's no
 * login: the name is asked once per shift and kept on the device; after
 * SHIFT_HOURS it's asked again on the next tick.
 */

import { useSyncExternalStore } from "react";

const KEY = "tasks-who-v1";
const SHIFT_HOURS = 10;

type Who = { name: string; at: number; recent: string[] };
const NONE: Who = { name: "", at: 0, recent: [] };
let who: Who | null = null;
const listeners = new Set<() => void>();

const read = (): Who => {
  if (who) return who;
  try {
    const raw = typeof window === "undefined" ? null : localStorage.getItem(KEY);
    who = raw ? { ...NONE, ...(JSON.parse(raw) as Who) } : NONE;
  } catch {
    who = NONE;
  }
  return who;
};

export const useWho = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => NONE
  );

/** The current name, or "" if nobody has said who's on this shift. */
export const currentName = () => {
  const w = read();
  return w.name && Date.now() - w.at < SHIFT_HOURS * 3600_000 ? w.name : "";
};

export function setWho(name: string) {
  const n = name.trim();
  const w = read();
  who = {
    name: n,
    at: Date.now(),
    recent: n ? [n, ...w.recent.filter((r) => r !== n)].slice(0, 8) : w.recent,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(who));
  } catch {
    // kept for this session only
  }
  for (const l of listeners) l();
}
