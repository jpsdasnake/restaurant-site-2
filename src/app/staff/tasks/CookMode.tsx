"use client";

import React, { useEffect, useRef, useState } from "react";
import type { Block, Page, RecipeRow } from "@/lib/tasks-store";
import { imageUrl } from "@/lib/tasks-images";
import { fmtAmount, pillLabel, segments } from "@/lib/tasks-recipe";
import StepTimers from "./StepTimers";
import styles from "./tasks.module.css";

type Step = { block: Block; section: string };

const SCALES = [0.5, 1, 2, 3];
const leadLabel = (n: number) => (n === 1 ? "Day before" : `${n} days before`);

/**
 * A recipe, one step at a time, readable from across the bench: big text,
 * the amounts that step needs, its timers, and large Back / Next buttons
 * (or a swipe). Ticking a step's box here ticks it on the page.
 */
export default function CookMode({
  page,
  blocks,
  rows,
  scale,
  canScale,
  onScale,
  onToggle,
  onStartTimer,
  onClose,
}: {
  page: Page;
  /** In page order. */
  blocks: Block[];
  rows: RecipeRow[];
  scale: number;
  /** Pages only: templates always show ×1. */
  canScale: boolean;
  onScale: (s: number) => void;
  onToggle: (id: string, done: boolean) => void;
  onStartTimer: () => void;
  onClose: () => void;
}) {
  // Every non-empty block but headers is a step; a header names the steps under it.
  const steps: Step[] = [];
  let section = "";
  for (const b of blocks) {
    if (b.kind === "header") section = b.text.trim();
    else if (b.text.trim()) steps.push({ block: b, section: section || (b.lead_days ? leadLabel(b.lead_days) : "") });
  }
  // Start at the first unticked step.
  const [i, setI] = useState(() => {
    const k = steps.findIndex((s) => s.block.kind === "todo" && !s.block.done);
    return k < 0 ? 0 : k;
  });
  const at = Math.min(i, Math.max(0, steps.length - 1));
  const step = steps[at];
  const go = (d: number) => setI((n) => Math.max(0, Math.min(steps.length - 1, n + d)));

  const goRef = useRef(go);
  const closeRef = useRef(onClose);
  useEffect(() => {
    goRef.current = go;
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      else if (e.key === "ArrowRight" || e.key === " ") goRef.current(1);
      else if (e.key === "ArrowLeft") goRef.current(-1);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Swipe sideways between steps.
  const swipe = useRef<{ x: number; y: number } | null>(null);

  if (!step)
    return (
      <div className={styles.cook} role="dialog" aria-label="Cook mode">
        <div className={styles.cookTop}>
          <span className={styles.cookTitle}>{page.title}</span>
          <button type="button" className={styles.cookClose} onClick={onClose} aria-label="Close cook mode">
            ✕
          </button>
        </div>
        <p className={styles.cookEmpty}>This recipe has no steps yet. Add them under Steps.</p>
      </div>
    );

  const used = segments(step.block.text)
    .filter((s) => s.kind === "ing")
    .map((s) => (s.kind === "ing" ? pillLabel(s, rows, scale) : null))
    .filter((x): x is { label: string; missing: boolean } => !!x && !x.missing);
  const isTodo = step.block.kind === "todo";
  const last = at === steps.length - 1;
  const img = step.block.images[0];

  return (
    <div
      className={styles.cook}
      role="dialog"
      aria-label="Cook mode"
      onPointerDown={(e) => {
        if (e.pointerType === "touch") swipe.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className={styles.cookTop}>
        <span className={styles.cookTitle}>
          {page.emoji} {page.title || "Untitled"}
        </span>
        {canScale && (
          <span className={styles.cookScales} role="group" aria-label="Recipe size">
            {SCALES.map((s) => (
              <button
                type="button"
                key={s}
                className={Math.abs(scale - s) < 1e-9 ? styles.cookScaleOn : ""}
                onClick={() => onScale(s)}
              >
                ×{s === 0.5 ? "½" : s}
              </button>
            ))}
            {!SCALES.some((s) => Math.abs(scale - s) < 1e-9) && (
              <span className={styles.cookScaleOther}>×{fmtAmount(scale)}</span>
            )}
          </span>
        )}
        <button type="button" className={styles.cookClose} onClick={onClose} aria-label="Close cook mode">
          ✕
        </button>
      </div>

      <div className={styles.cookProgress} aria-hidden>
        {steps.map((s, k) => (
          <span
            key={s.block.id}
            className={`${k === at ? styles.cookDotOn : ""} ${s.block.kind === "todo" && s.block.done ? styles.cookDotDone : ""}`}
          />
        ))}
      </div>

      <div className={styles.cookBody} key={step.block.id}>
        <div className={styles.cookMeta}>
          Step {at + 1} of {steps.length}
          {step.section && <> · {step.section}</>}
        </div>
        <p className={`${styles.cookText} ${isTodo && step.block.done ? styles.cookTextDone : ""}`}>
          {segments(step.block.text).map((s, k) => {
            if (s.kind === "text") return <React.Fragment key={k}>{s.text}</React.Fragment>;
            const p = pillLabel(s, rows, scale);
            return (
              <span key={k} className={`${styles.pill} ${p.missing ? styles.pillMissing : ""}`}>
                {p.label}
              </span>
            );
          })}
        </p>
        {used.length > 0 && (
          <ul className={styles.cookIngs}>
            {used.map((u) => (
              <li key={u.label}>{u.label}</li>
            ))}
          </ul>
        )}
        <StepTimers block={step.block} page={page} onStart={onStartTimer} big />
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.cookImg} src={imageUrl(img.path)} alt="" width={img.w} height={img.h} />
        )}
      </div>

      <div className={styles.cookNav}>
        <button type="button" className={styles.cookBack} disabled={at === 0} onClick={() => go(-1)}>
          ‹ Back
        </button>
        {isTodo && (
          <button
            type="button"
            className={`${styles.cookTick} ${step.block.done ? styles.cookTickOn : ""}`}
            onClick={() => {
              const done = !step.block.done;
              onToggle(step.block.id, done);
              if (done && !last) go(1);
            }}
          >
            {step.block.done ? "✓ Done" : last ? "Done" : "Done · next"}
          </button>
        )}
        <button
          type="button"
          className={styles.cookNext}
          onClick={() => (last ? onClose() : go(1))}
        >
          {last ? "Finish" : "Next ›"}
        </button>
      </div>
    </div>
  );
}
