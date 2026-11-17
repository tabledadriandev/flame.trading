import type { OptionSpec } from '../engine/types';

// An option's instrument id says everything about the contract, so nothing
// else has to be stored: opt:deribit:BTC-25JUN27-88000-C, or
// opt:alpaca:AAPL261218C00200000 (the standard OCC symbol).

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Deribit options expire at 08:00 UTC. */
function deribit(name: string): OptionSpec | null {
  const m = /^([A-Z]+)-(\d{1,2})([A-Z]{3})(\d{2})-([0-9d]+)-([CP])$/.exec(name);
  if (!m) return null;
  const month = MONTHS.indexOf(m[3]!);
  const strike = Number(m[5]!.replace('d', '.'));
  if (month < 0 || !(strike > 0)) return null;
  const expiry = Date.UTC(2000 + Number(m[4]), month, Number(m[2]), 8);
  return {
    underlying: `crypto:${m[1]}`,
    kind: m[6] === 'C' ? 'call' : 'put',
    strike,
    expiry,
    multiplier: 1,
    venue: 'deribit',
    // Deribit's fee page: a daily expiry is any option that does not expire on a Friday.
    ...(new Date(expiry).getUTCDay() !== 5 ? { daily: true } : {}),
  };
}

/** The moment it is `hour` o'clock in New York on a given date, whichever side of the clock change that is. */
function newYork(y: number, month: number, d: number, hour: number): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
  for (const offset of [4, 5]) {
    const t = Date.UTC(y, month, d, hour + offset);
    if (Number(fmt.format(t)) === hour) return t;
  }
  return Date.UTC(y, month, d, hour + 5);
}

/** US stock options stop trading at the 16:00 New York close on their expiry day. */
function occ(symbol: string): OptionSpec | null {
  const m = /^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(symbol);
  if (!m) return null;
  const strike = Number(m[6]) / 1000;
  const month = Number(m[3]) - 1;
  const d = Number(m[4]);
  if (!(strike > 0) || month < 0 || month > 11 || d < 1 || d > 31) return null;
  return { underlying: `stock:${m[1]}`, kind: m[5] === 'C' ? 'call' : 'put', strike, expiry: newYork(2000 + Number(m[2]), month, d, 16), multiplier: 100, venue: 'alpaca' };
}

export function parseOptionId(id: string): OptionSpec | null {
  const m = /^opt:(deribit|alpaca):(.+)$/.exec(id);
  if (!m) return null;
  return m[1] === 'deribit' ? deribit(m[2]!) : occ(m[2]!);
}

export const optionId = (venue: OptionSpec['venue'], name: string): string => `opt:${venue}:${name}`;

/** The venue's own name for the contract, as it appears in the id. */
export const venueName = (id: string): string => id.replace(/^opt:[a-z]+:/, '');

const strikeText = (k: number): string => k.toLocaleString('en-US', { maximumFractionDigits: 4 });
const ticker = (spec: OptionSpec): string => spec.underlying.slice(spec.underlying.indexOf(':') + 1);

export function expiryText(expiry: number, year = true): string {
  return new Date(expiry).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: '2-digit' as const } : {}), timeZone: 'UTC' });
}

/** "BTC 88,000 call 25 Jun 27": short enough for a positions row. */
export function optionSymbol(spec: OptionSpec): string {
  return [ticker(spec), strikeText(spec.strike), spec.kind, expiryText(spec.expiry)].join(' ');
}

export function optionName(spec: OptionSpec): string {
  const right = spec.kind === 'call' ? 'buy' : 'sell';
  const what = spec.multiplier === 1 ? '1 ' + ticker(spec) : spec.multiplier + ' ' + ticker(spec) + ' shares';
  return 'The right to ' + right + ' ' + what + ' at $' + strikeText(spec.strike) + ' on ' + expiryText(spec.expiry);
}

/** Years from `now` to expiry, never negative. */
export const yearsTo = (expiry: number, now: number): number => Math.max(0, expiry - now) / (365 * 86_400_000);
