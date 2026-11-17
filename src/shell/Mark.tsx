// The Flame mark: a candlestick whose upper wick is lit.
// The flame has its own token: it is the brand, so it stays amber whichever colours mean up and down.
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Flame">
      <path
        d="M16 2.500c2.800 3.100 4.800 5.300 4.800 8.100a4.800 4.800 0 0 1-9.600 0c0-2.800 2-5 4.800-8.100z"
        fill="var(--flame)"
      />
      <rect x="11" y="16.500" width="10" height="9.500" rx="1.500" fill="currentColor" />
      <path d="M16 26v3.500M16 14.500v2" stroke="currentColor" strokeWidth="1.700" strokeLinecap="round" />
    </svg>
  );
}
