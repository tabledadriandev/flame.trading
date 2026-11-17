import { useEffect, useRef, useState } from 'react';

/** The current time, refreshed every `ms`. For countdowns and staleness. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** Tracks a media query. */
export function useMedia(query: string): boolean {
  const [hit, setHit] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setHit(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return hit;
}

/** Briefly returns 'up' or 'down' when a number changes, for the 300 ms tick flash. */
export function useFlash(value: number | undefined): 'up' | 'down' | null {
  const prev = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (value === undefined || before === undefined || value === before) return;
    setFlash(value > before ? 'up' : 'down');
    const timer = setTimeout(() => setFlash(null), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return flash;
}

/** The element's size, kept current with a ResizeObserver. The ref may attach late or move to another element. */
export function useSize<T extends HTMLElement>(): [(el: T | null) => void, { width: number; height: number }] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: Math.round(r.width), height: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size];
}
