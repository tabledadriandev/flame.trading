// The Flame mark: one solid flame with a candlestick cut out of it.
// The flame has its own token: it is the brand, so it stays amber whichever colours mean up and down.
// The same geometry draws the app icons: see scripts/make-icons.mjs and keep the two in step.
const FLAME = 'M18.5 2C19.5 8.5 27 11.5 27 19.5C27 25.5 22.1 30 16 30C9.9 30 5 25.5 5 19.5C5 15.6 7 12.6 9.6 10.2C9.8 12.6 10.8 14.4 12.6 15.2C12 9.8 14 4.8 18.5 2Z';
const CANDLE =
  'M13 17.2a1.2 1.2 0 0 1 1.2-1.2h.9v-3.8a1.1 1.1 0 0 1 2.2 0V16h.9a1.2 1.2 0 0 1 1.2 1.2v6a1.2 1.2 0 0 1-1.2 1.2h-.9V27a1.1 1.1 0 0 1-2.2 0v-2.6h-.9a1.2 1.2 0 0 1-1.2-1.2z';

export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Flame">
      <path d={FLAME + CANDLE} fill="var(--flame)" fillRule="evenodd" />
    </svg>
  );
}
