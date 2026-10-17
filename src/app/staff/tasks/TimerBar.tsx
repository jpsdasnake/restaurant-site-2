"use client";

import React, { useEffect, useState } from "react";
import { fmtClock } from "@/lib/tasks-durations";
import {
  beep,
  checkTimers,
  leftOf,
  pauseTimer,
  removeTimer,
  resumeTimer,
  unlockSound,
  useTimers,
} from "./timers";
import styles from "./tasks.module.css";

/** Running timers, bottom right, on every screen. Rings until stopped. */
export default function TimerBar({ onOpen }: { onOpen: (pageId: string) => void }) {
  const timers = useTimers();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timers.length) return;
    const tick = () => {
      const n = Date.now();
      setNow(n);
      checkTimers(n);
    };
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [timers.length]);

  // Beep every few seconds while any timer has gone off (for two minutes at most).
  const ringing = timers.some((t) => t.ringing);
  useEffect(() => {
    if (!ringing) return;
    beep();
    const again = setInterval(beep, 2500);
    const quiet = setTimeout(() => clearInterval(again), 120_000);
    return () => {
      clearInterval(again);
      clearTimeout(quiet);
    };
  }, [ringing]);

  // After a reload, browsers only allow sound once the screen has been touched.
  useEffect(() => {
    document.addEventListener("pointerdown", unlockSound);
    return () => document.removeEventListener("pointerdown", unlockSound);
  }, []);

  if (!timers.length) return null;
  return (
    <div className={styles.timerBar} role="region" aria-label="Timers">
      {timers.map((t) => {
        const left = leftOf(t, now);
        const paused = t.endsAt === null && !t.ringing;
        return (
          <div
            key={t.id}
            className={`${styles.timer} ${t.ringing ? styles.timerRinging : ""} ${paused ? styles.timerPaused : ""}`}
          >
            <button type="button" className={styles.timerMain} onClick={() => onOpen(t.pageId)}>
              <span className={styles.timerEmoji}>{t.emoji || "⏱"}</span>
              <span className={styles.timerText}>
                <span className={styles.timerLabel}>{t.label}</span>
                <span className={styles.timerPage}>{t.pageTitle}</span>
              </span>
              <span className={styles.timerClock}>{t.ringing ? "Done" : fmtClock(left / 1000)}</span>
            </button>
            {t.ringing ? (
              <button type="button" className={styles.timerStop} onClick={() => removeTimer(t.id)}>
                Stop
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.timerBtn}
                  aria-label={paused ? "Resume timer" : "Pause timer"}
                  onClick={() => (paused ? resumeTimer(t.id) : pauseTimer(t.id))}
                >
                  {paused ? "▶" : "❚❚"}
                </button>
                <button
                  type="button"
                  className={styles.timerBtn}
                  aria-label="Cancel timer"
                  onClick={() => removeTimer(t.id)}
                >
                  ✕
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
