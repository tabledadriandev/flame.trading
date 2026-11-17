// When a price last arrived. The account's `lastSeen` is stamped from this,
// not from the wall clock, so time spent asleep or offline counts as a gap
// the engine must replay.

let lastPriceAt = 0;

export function notePrice(t: number): void {
  if (t > lastPriceAt) lastPriceAt = t;
}

export function lastPrice(): number {
  return lastPriceAt;
}

/** Start the clock from the stored account, so a gap is measured from the last visit. */
export function seedClock(t: number): void {
  lastPriceAt = t;
}
