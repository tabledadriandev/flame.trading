// Feed messages arrive faster than the screen should repaint. Work is batched
// onto the next animation frame, with a timer behind it for when frames stop.

type Job = () => void;

const pending = new Set<Job>();
let scheduled = false;
let onError: ((err: unknown) => void) | null = null;

/** A failed batch may have dropped a price the engine needed; the app tells the user. */
export function setFrameErrorHandler(fn: (err: unknown) => void): void {
  onError = fn;
}

function run(): void {
  scheduled = false;
  const jobs = [...pending];
  pending.clear();
  for (const job of jobs) {
    try {
      job();
    } catch (err) {
      console.error('[flame] a batched feed update failed', err);
      onError?.(err);
    }
  }
}

/** How long a batch may wait for a frame before a timer delivers it instead. */
const FRAME_FALLBACK_MS = 200;

/**
 * Run `job` once on the next frame, however many times it is requested before
 * then. A timer backs the frame up: browsers stop animation frames for a tab
 * that is hidden, and also for a window that is merely covered or minimised,
 * and working orders must still be evaluated then.
 */
export function onFrame(job: Job): void {
  pending.add(job);
  if (scheduled) return;
  scheduled = true;
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    run();
  };
  const timer = setTimeout(once, FRAME_FALLBACK_MS);
  if (typeof requestAnimationFrame === 'function' && !(typeof document !== 'undefined' && document.hidden)) requestAnimationFrame(once);
}

/** Call `fn` at most once per `ms`, always delivering the latest call. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: A | null = null;
  return (...args: A) => {
    latest = args;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) {
      last = Date.now();
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        if (latest) fn(...latest);
      }, wait);
    }
  };
}
