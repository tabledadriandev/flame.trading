import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Minus, Plus } from 'lucide-react';
import { route } from '../data/feed';
import { instrument } from '../data/instruments';
import { heatStep, imbalanceRead, tickChoices, type LadderRow, type Wall } from '../data/ladder';
import { VENUE_NAMES } from '../data/venues';
import { compact, pct, price } from '../lib/format';
import { useMedia, useSize } from '../lib/hooks';
import { useQuoteSlow } from '../state/hooks';
import { useMarket } from '../state/market';
import { useTicket } from '../state/ticket';
import { Help, Pane, PaneState } from '../ui/controls';
import { FeedBadge } from '../ui/FeedBadge';
import { useLadder, type VenueState } from './useLadder';

const ROW = 20;
const ROW_PHONE = 24;

function Row({
  row,
  side,
  max,
  decimals,
  wall,
  open,
  onToggle,
  onPick,
  multi,
  tab,
}: {
  row: LadderRow;
  side: 'bid' | 'ask';
  max: number;
  decimals: number;
  wall: Wall | null;
  open: boolean;
  onToggle: () => void;
  onPick: () => void;
  multi: boolean;
  /** One row is in the tab order; the arrow keys reach the rest. */
  tab: boolean;
}) {
  const step = heatStep(row.size, max);
  const width = max > 0 ? Math.max(2, Math.sqrt(row.size / max) * 100) : 0;
  const isWall = wall !== null && wall.price === row.price;
  const venues = Object.entries(row.venues).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="ladder-row" data-side={side} data-wall={isWall ? 'true' : undefined}>
        {multi ? (
          <button
            type="button"
            className="ladder-open"
            tabIndex={-1}
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} which venues hold the size at ${price(row.price, decimals)}`}
          >
            {open ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
          </button>
        ) : (
          <span className="ladder-open" aria-hidden="true" />
        )}
        <button
          type="button"
          className="ladder-pick num"
          tabIndex={tab ? 0 : -1}
          onClick={onPick}
          title="Load this price into the ticket as a limit"
          aria-label={`${side === 'bid' ? 'Bid' : 'Ask'} ${price(row.price, decimals)}, size ${compact(row.size)}. Load into the ticket as a limit.`}
        >
          <span className="ladder-price">{price(row.price, decimals)}</span>
          <span className="ladder-bar" aria-hidden="true">
            <i data-step={step} style={{ width: `${width}%` }} />
            {isWall ? <em>Wall</em> : null}
          </span>
          <span className="ladder-size">{compact(row.size)}</span>
        </button>
      </div>
      {open && multi ? (
        <div className="ladder-venues num" data-side={side}>
          {venues.map(([id, size]) => (
            <span key={id} title={VENUE_NAMES[id]?.name ?? id}>
              <b>{VENUE_NAMES[id]?.short ?? id}</b> {compact(size)}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function venueNote(venues: VenueState[]): { text: string; warn: boolean; title: string } {
  const name = (v: VenueState) => VENUE_NAMES[v.id]?.name ?? v.id;
  const inBook = venues.filter((v) => v.state === 'in');
  const out = venues.filter((v) => v.state === 'reconnecting' || v.state === 'down');
  const unlisted = venues.filter((v) => v.state === 'unlisted');
  const parts = [`In the book: ${inBook.map(name).join(', ') || 'none yet'}.`];
  if (out.length) parts.push(`Reconnecting, and left out until they are back: ${out.map(name).join(', ')}.`);
  if (unlisted.length) parts.push(`No book for this coin on: ${unlisted.map(name).join(', ')}.`);
  const text = out.length ? `${inBook.length} of ${venues.length - unlisted.length} venues` : `${inBook.length} ${inBook.length === 1 ? 'venue' : 'venues'}`;
  return { text, warn: out.length > 0, title: parts.join(' ') };
}

export function Book({ rangePct = 0.01 }: { rangePct?: number }) {
  const id = useMarket((s) => s.instrument);
  const i = instrument(id);
  const q = useQuoteSlow(id, 1_000);
  const r = route(id);
  const choices = useMemo(() => tickChoices(q?.last ?? 0), [q ? Math.floor(Math.log10(Math.max(q.last, 1e-9))) : 0]);
  const [tickIndex, setTickIndex] = useState(1);
  const tick = choices[Math.min(tickIndex, choices.length - 1)] ?? 1;
  const feed = useLadder(id, tick, rangePct);
  const [open, setOpen] = useState<string | null>(null);
  const [wrap, size] = useSize<HTMLDivElement>();
  const prefill = useTicket((s) => s.prefill);

  useEffect(() => setOpen(null), [id, tick]);

  const hasBook = r?.adapter.hasBook ?? false;
  const decimals = Math.max(0, Math.ceil(-Math.log10(tick)));
  const l = feed.ladder;
  const phone = useMedia('(max-width: 860px)');
  const perSide = Math.max(3, Math.floor((size.height - 26) / 2 / (phone ? ROW_PHONE : ROW)) - (open ? 1 : 0));
  const asks = l ? l.asks.slice(0, perSide) : [];
  const bids = l ? l.bids.slice(0, perSide) : [];
  let max = 0;
  for (const row of asks) max = Math.max(max, row.size);
  for (const row of bids) max = Math.max(max, row.size);
  const multi = feed.venues.filter((v) => v.state === 'in').length > 1;
  const note = venueNote(feed.venues);

  return (
    <Pane
      label="Order book"
      className="pane-book"
      title="Book"
      tools={
        hasBook ? (
          <>
            {feed.venues.length > 1 ? (
              <span className="status" data-level={note.warn ? 'warn' : undefined} title={note.title}>
                {note.text}
              </span>
            ) : (
              <FeedBadge instrumentId={id} />
            )}
            <span className="stepper" role="group" aria-label="Row size">
              <button type="button" className="btn btn-sm btn-icon" onClick={() => setTickIndex((n) => Math.max(0, n - 1))} disabled={tickIndex === 0} aria-label="Finer rows">
                <Minus size={12} aria-hidden="true" />
              </button>
              <span className="num" title="Price step of each row">
                {price(tick, decimals)}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-icon"
                onClick={() => setTickIndex((n) => Math.min(choices.length - 1, n + 1))}
                disabled={tickIndex >= choices.length - 1}
                aria-label="Coarser rows"
              >
                <Plus size={12} aria-hidden="true" />
              </button>
            </span>
            <Help align="right" label="How to read the book">
              Resting orders by price: sellers (asks) above, buyers (bids) below. A longer, more saturated bar means more size waiting there. For coins, every venue's book is lined up on its own mid
              price and added together; USDT and USDC count as dollars. Click a price to load it into the ticket.
            </Help>
          </>
        ) : null
      }
    >
      {!hasBook ? (
        <PaneState title={`No order book for ${i.symbol}`}>
          {i.cls === 'stock' ? 'Stock quotes here are delayed and come without depth. Orders fill at the last price.' : 'This instrument has no public order book.'}
        </PaneState>
      ) : !l ? (
        feed.problem ? (
          <PaneState title="The book is not syncing">{feed.problem} Flame keeps retrying. Until it syncs, market orders fill at the last price plus one basis point.</PaneState>
        ) : (
          <PaneState title={feed.ready ? 'The book is empty' : 'Loading the book'}>
            {feed.ready ? 'No resting orders within range of the mid, or the book has gone stale.' : `Syncing ${i.symbol} depth from ${VENUE_NAMES[r!.adapter.id]?.name ?? 'the venue'}.`}
          </PaneState>
        )
      ) : (
        <>
          <div className="book-top num">
            <div
              className="imbalance"
              role="img"
              aria-label={`${imbalanceRead(l.bidShare)}: ${Math.round(l.bidShare * 100)}% bids, ${Math.round((1 - l.bidShare) * 100)}% asks within half a percent of the mid`}
            >
              <span className="imbalance-bar" aria-hidden="true">
                <i className="imbalance-bid" style={{ width: `${l.bidShare * 100}%` }} />
                <i className="imbalance-ask" style={{ width: `${(1 - l.bidShare) * 100}%` }} />
              </span>
              <span className="imbalance-read">
                {imbalanceRead(l.bidShare)}
                <Help align="right">
                  The split of resting size within 0.5% either side of the mid: {compact(l.nearBid)} {i.symbol} bid against {compact(l.nearAsk)} offered. Resting orders can be pulled, so read it as
                  intent, not a forecast.
                </Help>
              </span>
            </div>
            <div className="walls">
              {l.askWall ? (
                <span>
                  <i>Supply wall</i> {compact(l.askWall.size)} at {price(l.askWall.price, decimals)}, {pct(l.askWall.distancePct, false)} up
                  {multi ? `, mostly ${VENUE_NAMES[l.askWall.venue]?.name ?? l.askWall.venue}` : ''}
                </span>
              ) : null}
              {l.bidWall ? (
                <span>
                  <i>Demand wall</i> {compact(l.bidWall.size)} at {price(l.bidWall.price, decimals)}, {pct(l.bidWall.distancePct, false)} down
                  {multi ? `, mostly ${VENUE_NAMES[l.bidWall.venue]?.name ?? l.bidWall.venue}` : ''}
                </span>
              ) : null}
            </div>
          </div>
          <div
            className="ladder"
            ref={wrap}
            role="group"
            aria-label="Price ladder. Arrow keys move between prices; left opens the venue split."
            onKeyDown={(e) => {
              const here = document.activeElement as HTMLElement | null;
              if (!here || !e.currentTarget.contains(here)) return;
              const picks = [...e.currentTarget.querySelectorAll<HTMLElement>('.ladder-pick')];
              const row = here.closest('.ladder-row');
              const n = picks.indexOf(row?.querySelector<HTMLElement>('.ladder-pick') ?? here);
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                picks[Math.max(0, Math.min(picks.length - 1, n + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
              } else if (e.key === 'ArrowLeft') {
                row?.querySelector<HTMLElement>('button.ladder-open')?.focus();
              } else if (e.key === 'ArrowRight') {
                picks[n]?.focus();
              }
            }}
          >
            <div className="ladder-side ladder-asks">
              {asks
                .slice()
                .reverse()
                .map((row) => (
                  <Row
                    key={row.price}
                    row={row}
                    side="ask"
                    max={max}
                    decimals={decimals}
                    wall={l.askWall}
                    multi={multi}
                    tab={false}
                    open={open === `a${row.price}`}
                    onToggle={() => setOpen(open === `a${row.price}` ? null : `a${row.price}`)}
                    onPick={() => prefill({ type: 'limit', price: String(row.price) })}
                  />
                ))}
            </div>
            <div className="ladder-mid num">
              <span>{price(l.mid, Math.max(decimals, 2))}</span>
              <small>
                Spread {price(l.spread, Math.max(decimals, 2))}
              </small>
            </div>
            <div className="ladder-side ladder-bids">
              {bids.map((row) => (
                <Row
                  key={row.price}
                  row={row}
                  side="bid"
                  max={max}
                  decimals={decimals}
                  wall={l.bidWall}
                  multi={multi}
                  tab={row === bids[0]}
                  open={open === `b${row.price}`}
                  onToggle={() => setOpen(open === `b${row.price}` ? null : `b${row.price}`)}
                  onPick={() => prefill({ type: 'limit', price: String(row.price) })}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </Pane>
  );
}
