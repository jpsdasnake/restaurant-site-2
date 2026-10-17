/*
 * Live updates for Tasks over Supabase Realtime, spoken directly over a
 * WebSocket (Phoenix channel protocol, JSON v1) so there's still no
 * supabase-js. Devices hear about each other's edits within a moment instead
 * of on the next poll.
 *
 * Events are only a nudge: the app reacts by refetching, so a missed or
 * malformed event costs nothing but a delay until the (slower) poll. The
 * tables must be in the `supabase_realtime` publication (see tasks.sql).
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const TABLES = ["task_pages", "task_blocks", "task_repeat_exceptions"] as const;

export type Change = {
  table: string;
  type: "INSERT" | "UPDATE" | "DELETE";
  /** New row (empty for DELETE). */
  record: Record<string, unknown>;
  /** Old row; under RLS only its primary key. */
  old: Record<string, unknown>;
};

const HEARTBEAT_MS = 25_000;
const TOPIC = "realtime:tasks";

/**
 * Connect and stay connected (reconnecting with backoff, and at once when the
 * page becomes visible again). `onLive(true)` once the channel is joined,
 * `onLive(false)` when the connection drops. Returns a function that closes it.
 */
export function subscribeTasks(onChange: (c: Change) => void, onLive: (live: boolean) => void) {
  if (!SUPABASE_URL || typeof WebSocket === "undefined") return () => {};
  const url =
    SUPABASE_URL.replace(/^http/, "ws") +
    `/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`;

  let ws: WebSocket | null = null;
  let ref = 0;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let backoff = 1000;
  let stopped = false;

  const send = (topic: string, event: string, payload: object) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ref += 1;
    ws.send(JSON.stringify({ topic, event, payload, ref: String(ref), join_ref: "1" }));
  };

  const drop = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {}
      ws = null;
    }
    onLive(false);
  };

  const scheduleReconnect = () => {
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };

  const connect = () => {
    if (stopped) return;
    drop();
    const sock = new WebSocket(url);
    ws = sock;
    sock.onopen = () => {
      send(TOPIC, "phx_join", {
        config: {
          broadcast: { self: false },
          presence: { key: "" },
          postgres_changes: TABLES.map((table) => ({ event: "*", schema: "public", table })),
        },
        access_token: SUPABASE_ANON_KEY,
      });
      heartbeat = setInterval(() => send("phoenix", "heartbeat", {}), HEARTBEAT_MS);
    };
    sock.onmessage = (e) => {
      let msg: { event?: string; topic?: string; payload?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.topic !== TOPIC) return;
      if (msg.event === "phx_reply" && msg.payload?.status === "ok") {
        backoff = 1000;
        onLive(true);
      } else if (msg.event === "postgres_changes") {
        const d = msg.payload?.data;
        if (!d || typeof d.table !== "string") return;
        onChange({
          table: d.table,
          type: d.type,
          record: d.record ?? {},
          old: d.old_record ?? {},
        });
      } else if (msg.event === "phx_error" || msg.event === "phx_close") {
        drop();
        scheduleReconnect();
      }
    };
    sock.onclose = () => {
      drop();
      scheduleReconnect();
    };
    sock.onerror = () => sock.close();
  };

  // A tablet waking up usually holds a dead socket: start over straight away.
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    if (ws?.readyState === WebSocket.OPEN) return;
    if (retry) clearTimeout(retry);
    retry = null;
    backoff = 1000;
    connect();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);

  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onVisible);
    drop();
  };
}
