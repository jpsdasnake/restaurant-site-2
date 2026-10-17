/*
 * Service worker: makes the installed app open straight away and keeps it
 * usable when the kitchen wifi drops.
 *
 * - Build files (/_next/static/…) never change under a name: cache first.
 * - Task photos in Supabase Storage are immutable objects: cache first.
 * - Pages: network first, falling back to the last copy when offline or slow.
 * - Everything else, Supabase data included, goes straight to the network;
 *   the app keeps its own copy of the data (see Tasks.tsx, "snapshot").
 *
 * Bump VERSION to drop every cache on the next visit.
 */

const VERSION = "v1";
const STATIC = `static-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const IMAGES = `images-${VERSION}`;
const NAV_TIMEOUT_MS = 3000;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [STATIC, PAGES, IMAGES];
      for (const key of await caches.keys()) if (!keep.includes(key)) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

const cacheFirst = async (cacheName, request) => {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === "opaque") cache.put(request, res.clone());
  return res;
};

const networkFirst = async (request) => {
  const cache = await caches.open(PAGES);
  const network = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  // A slow network shouldn't hold the app hostage when we have a copy.
  const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch {
    // offline: fall through to the cache
  }
  const hit = (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }));
  return hit || network;
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
      event.respondWith(cacheFirst(STATIC, request));
    } else if (request.mode === "navigate") {
      event.respondWith(networkFirst(request));
    }
    return;
  }
  if (url.pathname.includes("/storage/v1/object/public/")) {
    event.respondWith(cacheFirst(IMAGES, request));
  }
});
