import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKOFF_MAX, ManagedSocket, backoffDelay } from './socket';

class FakeSocket {
  static made: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.made.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(data: string) {
    this.onmessage?.({ data });
  }
  fail() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const Impl = FakeSocket as unknown as typeof WebSocket;

describe('backoff', () => {
  it('doubles from 1 s to 30 s with jitter', () => {
    expect(backoffDelay(0, () => 0.5)).toBe(1_000);
    expect(backoffDelay(1, () => 0.5)).toBe(2_000);
    expect(backoffDelay(4, () => 0.5)).toBe(16_000);
    expect(backoffDelay(5, () => 0.5)).toBe(BACKOFF_MAX);
    expect(backoffDelay(12, () => 0.5)).toBe(BACKOFF_MAX);
    expect(backoffDelay(0, () => 0)).toBe(750);
    expect(backoffDelay(0, () => 1)).toBe(1_250);
  });
});

describe('managed socket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.made = [];
  });
  afterEach(() => vi.useRealTimers());

  it('is live once the venue sends a message, and resubscribes after a drop', () => {
    const opens: number[] = [];
    const got: string[] = [];
    const s = new ManagedSocket({
      urls: ['wss://a', 'wss://b'],
      WebSocketImpl: Impl,
      onOpen: (send) => {
        opens.push(1);
        send({ sub: 'x' });
      },
      onMessage: (d) => got.push(d),
    });
    const states: string[] = [];
    s.onStatus((st) => states.push(st));

    s.start();
    expect(s.status()).toBe('connecting');
    FakeSocket.made[0]!.open();
    expect(FakeSocket.made[0]!.sent).toEqual(['{"sub":"x"}']);
    FakeSocket.made[0]!.message('hello');
    expect(s.status()).toBe('live');
    expect(got).toEqual(['hello']);

    FakeSocket.made[0]!.fail();
    expect(s.status()).toBe('reconnecting');
    vi.advanceTimersByTime(1_300);
    // The retry rotates to the fallback host and subscribes again.
    expect(FakeSocket.made).toHaveLength(2);
    expect(FakeSocket.made[1]!.url).toBe('wss://b');
    FakeSocket.made[1]!.open();
    FakeSocket.made[1]!.message('again');
    expect(opens).toHaveLength(2);
    expect(states).toEqual(['live', 'reconnecting', 'live']);
  });

  it('reports the feed as down after repeated failures, and keeps trying', () => {
    const s = new ManagedSocket({ urls: ['wss://a'], WebSocketImpl: Impl, onOpen: () => {}, onMessage: () => {}, downAfter: 3 });
    s.start();
    for (let i = 0; i < 3; i++) {
      FakeSocket.made.at(-1)!.fail();
      vi.advanceTimersByTime(40_000);
    }
    expect(s.status()).toBe('down');
    expect(FakeSocket.made.length).toBeGreaterThanOrEqual(4);
    FakeSocket.made.at(-1)!.open();
    FakeSocket.made.at(-1)!.message('back');
    expect(s.status()).toBe('live');
  });

  it('reconnects a connection that has gone silent', () => {
    const s = new ManagedSocket({ urls: ['wss://a'], WebSocketImpl: Impl, onOpen: () => {}, onMessage: () => {}, silenceMs: 4_000 });
    s.start();
    FakeSocket.made[0]!.open();
    FakeSocket.made[0]!.message('x');
    vi.advanceTimersByTime(6_000);
    expect(s.status()).toBe('reconnecting');
    vi.advanceTimersByTime(1_300);
    expect(FakeSocket.made).toHaveLength(2);
  });

  it('stops for good when asked', () => {
    const s = new ManagedSocket({ urls: ['wss://a'], WebSocketImpl: Impl, onOpen: () => {}, onMessage: () => {} });
    s.start();
    FakeSocket.made[0]!.open();
    s.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.made).toHaveLength(1);
  });
});
