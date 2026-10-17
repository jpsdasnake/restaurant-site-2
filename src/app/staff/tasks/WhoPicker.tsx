"use client";

import React, { useEffect, useState } from "react";
import { store as shifts } from "@/lib/shifts-store";
import { workDayISO } from "@/lib/time";
import { setWho, useWho } from "./who";
import styles from "./tasks.module.css";

/** "Who's on?": today's people from the schedule, recent names, or type one. */
export default function WhoPicker({ onDone }: { onDone: (name: string) => void }) {
  const who = useWho();
  const [onShift, setOnShift] = useState<string[]>([]);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const today = workDayISO();
    shifts
      .list(today, today)
      .then((list) => setOnShift([...new Set(list.map((s) => s.person.trim()).filter(Boolean))]))
      .catch(() => {}); // no schedule to suggest from: recent names and typing still work
  }, []);

  const pick = (name: string) => {
    setWho(name);
    onDone(name.trim());
  };
  const names = [...new Set([...onShift, ...who.recent])];

  return (
    <div className={`${styles.modalBack} ${styles.whoBack}`} onClick={() => onDone("")}>
      <div
        className={`${styles.modal} ${styles.whoModal}`}
        role="dialog"
        aria-label="Who’s on?"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={styles.modalTitle}>Who’s on?</h2>
        <p className={styles.whoHint}>Ticks on this tablet will show your name for the rest of the shift.</p>
        {names.length > 0 && (
          <div className={styles.whoNames}>
            {names.map((n) => (
              <button
                type="button"
                key={n}
                className={`${styles.whoName} ${n === who.name ? styles.whoNameOn : ""}`}
                onClick={() => pick(n)}
              >
                {n}
                {onShift.includes(n) && <span className={styles.whoShift}>on today</span>}
              </button>
            ))}
          </div>
        )}
        <form
          className={styles.whoForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) pick(typed);
          }}
        >
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Your name"
            aria-label="Your name"
            autoFocus={names.length === 0}
          />
          <button type="submit" className={styles.popGo} disabled={!typed.trim()}>
            That’s me
          </button>
        </form>
        <div className={styles.modalActions}>
          <button type="button" className={styles.popItemSmall} onClick={() => onDone("")}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
