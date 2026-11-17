import { useEffect, useRef, useState } from 'react';
import { Book } from '../desk/Book';
import { ChartPane } from '../desk/ChartPane';
import { Drawer } from '../desk/Drawer';
import { Tape } from '../desk/Tape';
import { Ticket } from '../desk/Ticket';
import { Watchlist } from '../desk/Watchlist';
import { useMedia, useSize } from '../lib/hooks';
import { useLayout } from '../state/layout';
import { useMarket } from '../state/market';
import { useReplaySeed } from '../state/replay';
import { useTicket } from '../state/ticket';
import { Divider } from '../ui/Divider';

// The desk is the terminal itself: every pane a trader needs on one screen.
// Every divider drags and the sizes persist. On a phone the panes become a
// swipeable stack.

/** "Replay from here" on the chart: open Replay at that bar, same instrument and timeframe. */
function replayFrom(t: number): void {
  const m = useMarket.getState();
  useReplaySeed.getState().set({ instrument: m.instrument, tf: m.tf === '1w' ? '1d' : m.tf, t });
  window.location.hash = 'replay';
}

function WideDesk() {
  const sizes = useLayout((s) => s.sizes);
  const setSize = useLayout((s) => s.setSize);
  const zen = useLayout((s) => s.zen);
  const maximised = useLayout((s) => (s.zen ? 'chart' : s.maximised));
  const [col, colSize] = useSize<HTMLDivElement>();
  return (
    <div
      className="desk"
      data-max={maximised ?? undefined}
      data-zen={zen ? 'true' : undefined}
      style={
        {
          '--w-watch': `${sizes.watch}px`,
          '--w-book': `${sizes.book}px`,
          '--w-ticket': `${sizes.ticket}px`,
          '--h-drawer': `${sizes.drawer}px`,
          '--ladder': sizes.ladder,
        } as React.CSSProperties
      }
    >
      <Watchlist />
      <ChartPane onReplay={replayFrom} />
      <div className="book-col" ref={col}>
        <Book />
        <Divider
          axis="y"
          className="divider-inline"
          label="Resize the book and the tape"
          value={sizes.ladder}
          scale={colSize.height > 0 ? 1 / colSize.height : 0.002}
          onChange={(v) => setSize('ladder', v)}
        />
        <Tape />
      </div>
      <Ticket />
      <Drawer />
      <Divider axis="x" className="div-watch" label="Resize the watchlist" value={sizes.watch} onChange={(v) => setSize('watch', v)} />
      <Divider axis="x" className="div-book" label="Resize the book" value={sizes.book} direction={-1} onChange={(v) => setSize('book', v)} />
      <Divider axis="x" className="div-ticket" label="Resize the ticket" value={sizes.ticket} direction={-1} onChange={(v) => setSize('ticket', v)} />
      <Divider axis="y" className="div-drawer" label="Resize the positions drawer" value={sizes.drawer} direction={-1} onChange={(v) => setSize('drawer', v)} />
    </div>
  );
}

const PAGES = [
  { id: 'chart', label: 'Chart' },
  { id: 'ticket', label: 'Ticket' },
  { id: 'book', label: 'Book' },
  { id: 'positions', label: 'Positions' },
  { id: 'watch', label: 'Watchlist' },
] as const;

function PhoneDesk() {
  const [page, setPage] = useState(0);
  const pages = useRef<HTMLDivElement>(null);
  const focus = useTicket((s) => s.focus);

  const go = (n: number) => {
    const el = pages.current;
    if (!el) return;
    el.scrollTo({ left: n * el.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setPage(n);
  };

  // Something asked for the ticket (a price picked from the book, the B or S key): bring it into view.
  const seenFocus = useRef(focus);
  useEffect(() => {
    // Only a new request moves the page; coming back to the desk stays on the chart.
    if (focus > seenFocus.current) go(1);
    seenFocus.current = focus;
  }, [focus]);

  return (
    <div className="phone-desk">
      <div className="phone-tabs" role="tablist" aria-label="Desk panes">
        {PAGES.map((p, n) => (
          <button key={p.id} type="button" role="tab" className="phone-tab" aria-selected={page === n} onClick={() => go(n)}>
            {p.label}
          </button>
        ))}
      </div>
      <div
        className="phone-pages"
        ref={pages}
        onScroll={(e) => {
          const el = e.currentTarget;
          const n = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (n !== page) setPage(n);
        }}
      >
        <div className="phone-page" role="tabpanel" aria-label="Chart">
          <ChartPane onReplay={replayFrom} />
        </div>
        <div className="phone-page" role="tabpanel" aria-label="Ticket">
          <Ticket />
        </div>
        <div className="phone-page phone-page-book" role="tabpanel" aria-label="Book">
          <Book />
          <Tape />
        </div>
        <div className="phone-page" role="tabpanel" aria-label="Positions">
          <Drawer />
        </div>
        <div className="phone-page" role="tabpanel" aria-label="Watchlist">
          <Watchlist />
        </div>
      </div>
    </div>
  );
}

export function Desk() {
  const phone = useMedia('(max-width: 860px)');
  return phone ? <PhoneDesk /> : <WideDesk />;
}
