"use client";

import { useEffect } from "react";

/**
 * Keeps the screen on while `active` (a page is open), so a tablet doesn't
 * dim and lock in the middle of a recipe. The browser drops the lock when
 * the tab is hidden, so it's taken again on return. Unsupported browsers
 * simply keep their normal sleep.
 */
export default function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        const l = await navigator.wakeLock.request("screen");
        if (stopped) l.release().catch(() => {});
        else lock = l;
      } catch {
        // battery saver or no permission: not worth bothering anyone about
      }
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
