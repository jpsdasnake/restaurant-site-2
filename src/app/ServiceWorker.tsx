"use client";

import { useEffect } from "react";

/** Registers public/sw.js in production builds (in dev it would cache stale bundles). */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((e) => console.error("Service worker", e));
  }, []);
  return null;
}
