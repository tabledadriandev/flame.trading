// Market-hours clocks. No feed needed: each exchange's regular session in its
// own time zone, worked out with Intl time zones. Weekends are closed;
// exchange holidays are not modelled yet, and the view says so.

export interface Exchange {
  id: string;
  city: string;
  name: string;
  zone: string;
  /** Sessions in local time as minutes after midnight. Two entries mean a lunch break between them. */
  sessions: [number, number][];
}

const hm = (h: number, m: number): number => h * 60 + m;

export const EXCHANGES: Exchange[] = [
  { id: 'nyse', city: 'New York', name: 'NYSE and Nasdaq', zone: 'America/New_York', sessions: [[hm(9, 30), hm(16, 0)]] },
  { id: 'lse', city: 'London', name: 'London Stock Exchange', zone: 'Europe/London', sessions: [[hm(8, 0), hm(16, 30)]] },
  { id: 'xetra', city: 'Frankfurt', name: 'Xetra', zone: 'Europe/Berlin', sessions: [[hm(9, 0), hm(17, 30)]] },
  { id: 'tse', city: 'Tokyo', name: 'Tokyo Stock Exchange', zone: 'Asia/Tokyo', sessions: [[hm(9, 0), hm(11, 30)], [hm(12, 30), hm(15, 30)]] },
  { id: 'hkex', city: 'Hong Kong', name: 'Hong Kong Exchanges', zone: 'Asia/Hong_Kong', sessions: [[hm(9, 30), hm(12, 0)], [hm(13, 0), hm(16, 0)]] },
];

interface Local {
  /** 0 = Sunday. */
  weekday: number;
  minutes: number;
  hh: string;
  mm: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function localTime(now: number, zone: string): Local {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(zone, f);
  }
  const parts = f.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hh = get('hour');
  const mm = get('minute');
  return { weekday: WEEKDAYS.indexOf(get('weekday')), minutes: Number(hh) * 60 + Number(mm), hh, mm };
}

export interface SessionState {
  open: boolean;
  /** 'lunch' while an exchange with a midday break is between sessions. */
  phase: 'open' | 'lunch' | 'closed';
  /** Milliseconds until the state next changes. */
  until: number;
  /** "Closes in", "Reopens in" or "Opens in". */
  label: string;
  clock: string;
}

const isWeekday = (d: number): boolean => d >= 1 && d <= 5;

export function sessionState(ex: Exchange, now: number): SessionState {
  const t = localTime(now, ex.zone);
  const clock = `${t.hh}:${t.mm}`;
  // Seconds into the current minute, so countdowns land on the minute.
  const intoMinute = now % 60_000;
  const ms = (minutes: number) => minutes * 60_000 - intoMinute;

  if (isWeekday(t.weekday)) {
    for (let i = 0; i < ex.sessions.length; i++) {
      const [start, end] = ex.sessions[i]!;
      if (t.minutes >= start && t.minutes < end) return { open: true, phase: 'open', until: ms(end - t.minutes), label: i < ex.sessions.length - 1 ? 'Lunch in' : 'Closes in', clock };
      if (t.minutes < start) {
        return { open: false, phase: i === 0 ? 'closed' : 'lunch', until: ms(start - t.minutes), label: i === 0 ? 'Opens in' : 'Reopens in', clock };
      }
    }
  }
  // Closed for the day: count to the first session of the next weekday.
  let days = 1;
  let wd = (t.weekday + 1) % 7;
  while (!isWeekday(wd)) {
    wd = (wd + 1) % 7;
    days += 1;
  }
  const first = ex.sessions[0]![0];
  return { open: false, phase: 'closed', until: ms(days * 1440 - t.minutes + first), label: 'Opens in', clock };
}

/** "2h 14m", "3d 4h", "58m". */
export function countdown(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${m}m`;
}
