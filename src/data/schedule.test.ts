import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onFrame, throttle } from './schedule';

describe('frame batching', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('runs a job once however often it is requested before the frame', () => {
    const job = vi.fn();
    onFrame(job);
    onFrame(job);
    onFrame(job);
    vi.advanceTimersByTime(250);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it('still delivers when animation frames never fire (a covered or minimised window)', () => {
    // A requestAnimationFrame that accepts the callback and never calls it.
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const job = vi.fn();
    onFrame(job);
    vi.advanceTimersByTime(150);
    expect(job).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(job).toHaveBeenCalledTimes(1);
    // And the next batch is scheduled afresh.
    onFrame(job);
    vi.advanceTimersByTime(250);
    expect(job).toHaveBeenCalledTimes(2);
  });

  it('does not run twice when the frame and the timer both fire', () => {
    let frame: (() => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      frame = cb;
      return 1;
    });
    const job = vi.fn();
    onFrame(job);
    frame!();
    vi.advanceTimersByTime(500);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it('one failing job does not stop the others', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    onFrame(() => {
      throw new Error('boom');
    });
    onFrame(good);
    vi.advanceTimersByTime(250);
    expect(good).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes the latest call through at most once per interval', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t(1);
    t(2);
    t(3);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(3);
  });
});
