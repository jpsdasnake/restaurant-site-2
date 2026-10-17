"use client";

import React from "react";
import type { Block } from "@/lib/tasks-store";
import { findDurations } from "@/lib/tasks-durations";
import { startTimer, useTimers } from "./timers";
import styles from "./tasks.module.css";

export type TimerPage = { id: string; title: string; emoji: string };

/** The step's words without ingredient tokens, short enough for a timer. */
const stepLabel = (text: string) => {
  const plain = text.replace(/\[\[ing:[^|\]]*\|([^\]]*)\]\]/g, "$1").trim();
  return plain.length > 48 ? plain.slice(0, 46).trimEnd() + "…" : plain || "Timer";
};

/** A ⏱ button for each duration a step mentions ("rest 30 min"). */
export default function StepTimers({
  block,
  page,
  onStart,
  big = false,
}: {
  block: Block;
  page: TimerPage;
  onStart?: () => void;
  /** Cook mode: larger buttons. */
  big?: boolean;
}) {
  const timers = useTimers();
  const durations = findDurations(block.text);
  if (!durations.length) return null;
  return (
    <span className={`${styles.stepTimers} ${big ? styles.stepTimersBig : ""}`}>
      {durations.slice(0, 2).map((d) => {
        const running = timers.some((t) => t.blockId === block.id && t.totalMs === d.seconds * 1000);
        return (
          <button
            type="button"
            key={d.label}
            className={`${styles.stepTimer} ${running ? styles.stepTimerOn : ""}`}
            title={running ? "This timer is running (see bottom right)" : `Start a ${d.label} timer`}
            onMouseDown={(e) => e.preventDefault()} // keep the text focused
            onClick={(e) => {
              e.stopPropagation();
              if (running) return;
              onStart?.();
              startTimer({
                label: stepLabel(block.text),
                pageId: page.id,
                pageTitle: page.title || "Untitled",
                emoji: page.emoji,
                blockId: block.id,
                totalMs: d.seconds * 1000,
              });
            }}
          >
            ⏱ {d.label}
          </button>
        );
      })}
    </span>
  );
}
