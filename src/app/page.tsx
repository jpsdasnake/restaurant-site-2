import Link from "next/link";
import styles from "./page.module.css";

const TOOLS = [
  { href: "/staff/tasks", emoji: "📋", title: "Tasks", text: "Today’s checklists, recipes and prep" },
  { href: "/staff/schedule", emoji: "📅", title: "Shift schedule", text: "Who’s on this week" },
  { href: "/staff/preferences", emoji: "🗳️", title: "Open-shift preferences", text: "Pick the shifts you want" },
];

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>Staff tools</h1>
        <p>Internal tools for running the restaurant.</p>
        <ul className={styles.tiles}>
          {TOOLS.map((t) => (
            <li key={t.href}>
              <Link href={t.href} className={styles.tile}>
                <span className={styles.emoji} aria-hidden>
                  {t.emoji}
                </span>
                <span className={styles.body}>
                  <strong>{t.title}</strong>
                  <span>{t.text}</span>
                </span>
                <span className={styles.chev} aria-hidden>
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
