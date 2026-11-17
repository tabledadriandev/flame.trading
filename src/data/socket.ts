import type { FeedStatus, Unsubscribe } from './types';

// One WebSocket per venue, shared by every subscription: connects on demand,
// notices a silent connection, reconnects with jittered exponential backoff
// (1 s → 30 s) and tells the adapter to resubscribe when it is back.

export const BACKOFF_MIN = 1_000;
export const BACKOFF_MAX = 30_000;

/** Delay before reconnect attempt `n` (0-based): 1 s doubling to 30 s, each with ±25% jitter. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** attempt);
  return Math.round(base * (0.75 + random() * 0.5));
}

export interface SocketOptions {
  /** One URL, or several to rotate through when a connection fails (a venue's fallback host). */
  urls: string[];
  /** Called on every (re)connect; send the subscriptions here. */
  onOpen: (send: (payload: unknown) => void) => void;
  onMessage: (data: string) => void;
  /** Reconnect when nothing has arrived for this long. */
  silenceMs?: number;
  /** An application-level ping some venues expect, and how often to send it. */
  ping?: { every: number; payload: () => unknown };
  /** After this many failed attempts in a row the feed is reported as down (it keeps retrying). */
  downAfter?: number;
  WebSocketImpl?: typeof WebSocket;
}

export class ManagedSocket {
  private ws: WebSocket | null = null;
  private state: FeedStatus = 'connecting';
  private listeners = new Set<(s: FeedStatus) => void>();
  private attempt = 0;
  private urlIndex = 0;
  private wanted = false;
  private everOpened = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessage = 0;

  constructor(private readonly opts: SocketOptions) {}

  status(): FeedStatus {
    return this.state;
  }

  onStatus(cb: (s: FeedStatus) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Open the connection if it is not already open or opening. */
  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    this.attempt = 0;
    this.connect();
  }

  /** Close for good (until start is called again). */
  stop(): void {
    this.wanted = false;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch {
        // Closing a socket that never opened can throw; there is nothing to clean up.
      }
    }
    this.setState('connecting');
  }

  get open(): boolean {
    return this.ws !== null && this.ws.readyState === 1;
  }

  send(payload: unknown): boolean {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
      return true;
    }
    return false;
  }

  /** What to call the feed while it is not live. */
  private waiting(): FeedStatus {
    if (this.attempt >= (this.opts.downAfter ?? 4)) return 'down';
    return this.everOpened ? 'reconnecting' : 'connecting';
  }

  private setState(s: FeedStatus): void {
    if (s === this.state) return;
    this.state = s;
    for (const cb of this.listeners) cb(s);
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = this.watchdog = this.pingTimer = null;
  }

  private connect(): void {
    if (!this.wanted) return;
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    const url = this.opts.urls[this.urlIndex % this.opts.urls.length]!;
    this.setState(this.waiting());

    let ws: WebSocket;
    try {
      ws = new Impl(url);
    } catch (err) {
      console.warn(`[flame] could not open ${url}`, err);
      this.retry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.lastMessage = Date.now();
      this.opts.onOpen((p) => this.send(p));
      const silence = this.opts.silenceMs ?? 20_000;
      this.watchdog = setInterval(() => {
        if (Date.now() - this.lastMessage > silence) {
          console.warn(`[flame] ${url} went silent; reconnecting`);
          this.drop();
        }
      }, Math.max(1_000, silence / 4));
      const ping = this.opts.ping;
      if (ping) this.pingTimer = setInterval(() => this.send(ping.payload()), ping.every);
    };

    ws.onmessage = (ev: MessageEvent) => {
      this.lastMessage = Date.now();
      // The connection counts as live once the venue actually talks to us.
      if (this.state !== 'live') {
        this.attempt = 0;
        this.everOpened = true;
        this.setState('live');
      }
      if (typeof ev.data === 'string') this.opts.onMessage(ev.data);
    };

    ws.onerror = () => {
      // The close event that follows carries the retry.
    };

    ws.onclose = () => {
      if (this.ws === ws) this.drop();
    };
  }

  private drop(): void {
    const ws = this.ws;
    this.ws = null;
    this.clearTimers();
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch {
        // Already closed.
      }
    }
    this.retry();
  }

  private retry(): void {
    if (!this.wanted) return;
    const failedBefore = this.attempt;
    this.attempt += 1;
    this.urlIndex += 1;
    this.setState(this.waiting());
    this.retryTimer = setTimeout(() => this.connect(), backoffDelay(failedBefore));
  }
}
