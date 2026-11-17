// Feed messages arrive faster than the screen should repaint. Work is batched
// onto the next animation frame; in a hidden tab (where frames stop) it falls
// back to a timer so working orders are still evaluated.

type Job = () => void;

const pending = new Set<Job>();
let scheduled = false;

function run(): void {
  scheduled = false;
  const jobs = [...pending];
  pending.clear();
  for (const job of jobs) {
    try {
      job();
    } catch (err) {
      console.error('[flame] a batched feed update failed', err);
    }
  }
}

/** Run `job` once on the next frame, however many times it is requested before then. */
export function onFrame(job: Job): void {
  pending.add(job);
  if (scheduled) return;
  scheduled = true;
  const hidden = typeof document !== 'undefined' && document.hidden;
  if (!hidden && typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 100);
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
