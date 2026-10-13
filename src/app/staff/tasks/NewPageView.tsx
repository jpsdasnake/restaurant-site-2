"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { TemplateSummary } from "@/lib/tasks-store";
import { summary } from "@/lib/tasks-repeat";
import styles from "./tasks.module.css";

type Props = {
  /** "today", "Tue 13 Oct", or null for an Ongoing page. */
  dayLabel: string | null;
  templates: TemplateSummary[];
  onBlank: () => void;
  /** Make a page from this template. */
  onPick: (templateId: string) => void;
  /** Open this template in the editor instead. */
  onEdit: (templateId: string) => void;
  onNewTemplate: (isRecipe: boolean) => void;
  onClose: () => void;
};

/** Repeating templates first, then by title; untitled ones last. */
const byTemplateOrder = (a: TemplateSummary, b: TemplateSummary) => {
  if (Boolean(a.repeat) !== Boolean(b.repeat)) return a.repeat ? -1 : 1;
  if (Boolean(a.title) !== Boolean(b.title)) return a.title ? -1 : 1;
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.created_at.localeCompare(b.created_at);
};

/** The full-screen "+" view: Recipes and Checklists to use or edit, a new
 *  template of either kind, and Blank page tucked into the header. */
export default function NewPageView({
  dayLabel,
  templates,
  onBlank,
  onPick,
  onEdit,
  onNewTemplate,
  onClose,
}: Props) {
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const needle = q.trim().toLowerCase();
  const [recipes, checklists] = useMemo(() => {
    const shown = [...templates]
      .sort(byTemplateOrder)
      .filter((t) => !needle || (t.title || "Untitled").toLowerCase().includes(needle));
    return [shown.filter((t) => t.is_recipe), shown.filter((t) => !t.is_recipe)];
  }, [templates, needle]);

  const title = dayLabel === null ? "New ongoing page" : `New page for ${dayLabel}`;

  const column = (heading: string, items: TemplateSummary[], isRecipe: boolean) => (
    <section className={styles.newCol} aria-label={heading}>
      <h3 className={styles.newColHead}>{heading}</h3>
      {items.length === 0 ? (
        <p className={styles.newEmpty}>
          {needle ? `No ${heading.toLowerCase()} match.` : `No ${heading.toLowerCase()} yet.`}
        </p>
      ) : (
        <ul className={styles.newList}>
          {items.map((t) => (
            <li key={t.id} className={styles.newRow}>
              <button
                type="button"
                className={styles.newRowMain}
                onClick={() => onPick(t.id)}
                title={dayLabel === null ? "Add as an ongoing page" : `Add to ${dayLabel}`}
              >
                <span className={styles.newRowEmoji}>{t.emoji || "📄"}</span>
                <span className={`${styles.newRowTitle} ${t.title ? "" : styles.untitled}`}>
                  {t.title || "Untitled"}
                </span>
                {t.repeat && (
                  <span className={styles.repeatMark} title={summary(t.repeat)}>
                    ↻
                  </span>
                )}
              </button>
              <button
                type="button"
                className={styles.newRowEdit}
                onClick={() => onEdit(t.id)}
                aria-label={`Edit ${isRecipe ? "recipe" : "checklist"} ${t.title || "Untitled"}`}
              >
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={styles.newCreate} onClick={() => onNewTemplate(isRecipe)}>
        ＋ New {isRecipe ? "recipe" : "checklist"}
      </button>
    </section>
  );

  return (
    <div className={styles.newView} role="dialog" aria-label={title}>
      <header className={styles.newHead}>
        <h2 className={styles.newTitle}>{title}</h2>
        <button type="button" className={styles.newBlank} onClick={onBlank}>
          Blank page
        </button>
        <button type="button" className={styles.newClose} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <input
        className={styles.newFind}
        value={q}
        placeholder="Find a template…"
        onChange={(e) => setQ(e.target.value)}
        aria-label="Find a template"
      />
      <div className={styles.newCols}>
        {column("Recipes", recipes, true)}
        {column("Checklists", checklists, false)}
      </div>
    </div>
  );
}
