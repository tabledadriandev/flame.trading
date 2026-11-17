import { useEffect, useMemo, useRef, useState } from 'react';
import { instrument } from '../data/instruments';
import { rulesFor } from '../engine/rules';
import { posKey, type OrderInput, type OrderType, type Quote, type Side } from '../engine/types';
import { dollars, money, parseNumber, price as fmtPrice, qty as fmtQty, rr } from '../lib/format';
import { useMedia } from '../lib/hooks';
import { useAccount, type Book } from '../state/account';
import { useQuoteSlow, useValuation } from '../state/hooks';
import { fillBasis, quoteFor } from '../state/live';
import { route } from '../data/feed';
import { useMarket } from '../state/market';
import { engineSettings, useSettings } from '../state/settings';
import { useTicket, type SizeMode } from '../state/ticket';
import { Dialog, Help, NumField, Pane, PaneState, Segmented } from '../ui/controls';
import { FeedBadge } from '../ui/FeedBadge';
import { maxQty, previewTicket } from './ticketMath';
import { ConePanel } from './Cone';

const trim = (n: number, d = 8): string => String(parseFloat(n.toFixed(d)));

/** On touch, an order takes a deliberate press: hold until the bar fills. */
function HoldButton({ label, onConfirm, disabled, side }: { label: string; onConfirm: () => void; disabled: boolean; side: Side }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      className="btn btn-primary ticket-go"
      data-side={side}
      data-holding={holding ? 'true' : undefined}
      disabled={disabled}
      onPointerDown={(e) => {
        if (disabled || e.pointerType === 'mouse') return;
        setHolding(true);
        timer.current = setTimeout(() => {
          stop();
          onConfirm();
        }, 650);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        // A mouse or keyboard press confirms at once; touch must hold.
        if (e.detail === 0 || (e.nativeEvent as PointerEvent).pointerType === 'mouse') onConfirm();
      }}
    >
      <span className="ticket-go-fill" aria-hidden="true" />
      <span className="ticket-go-text">{holding ? 'Keep holding' : `Hold to ${label.charAt(0).toLowerCase()}${label.slice(1)}`}</span>
    </button>
  );
}

export interface TicketProps {
  /** The practice account in Replay; the live paper account otherwise. */
  book?: Book;
  /** Defaults to the instrument on the desk. */
  instrumentId?: string;
  /** Replay supplies its own price (the bar being replayed); the desk uses the live feed. */
  getQuote?: (id: string) => Quote | undefined;
  /** Changes whenever getQuote would answer differently. */
  pulse?: number;
  badge?: React.ReactNode;
  /** Extra content under the preview, such as the outcome cone. */
  children?: React.ReactNode;
}

export function Ticket({ book = 'live', instrumentId, getQuote, pulse, badge }: TicketProps = {}) {
  const deskId = useMarket((s) => s.instrument);
  const id = instrumentId ?? deskId;
  const select = useMarket((s) => s.select);
  const i = instrument(id);
  const info = useQuoteSlow(id);
  const t = useTicket();
  const live = useAccount((s) => s[book]);
  const place = useAccount((s) => s.place);
  const settings = useSettings();
  const priceNow = (): Quote | undefined => (getQuote ? getQuote(id) : quoteFor(id));
  const replayMark = getQuote ? getQuote(id)?.last : undefined;
  const value = useValuation(book, getQuote ? { [id]: replayMark } : undefined);
  const touch = useMedia('(pointer: coarse)');
  const [confirming, setConfirming] = useState(false);
  const sizeRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  const rules = rulesFor(i.cls, engineSettings());
  const levName = i.cls === 'crypto' ? 'Perp' : 'Margin';
  const lev = Math.min(rules.maxLeverage, Math.max(1, t.leverage));
  const held = live.positions[posKey(id, 'spot')]?.qty ?? 0;
  const levPos = live.positions[posKey(id, 'lev')];

  // Something outside asked for the ticket: put the cursor where the next keystroke belongs.
  useEffect(() => {
    if (t.focus === 0) return;
    const el = t.type !== 'market' && !t.price ? priceRef.current : sizeRef.current;
    el?.focus();
    el?.select();
  }, [t.focus]);

  const quote = useMemo(() => priceNow(), [id, info, pulse]);
  const preview = previewTicket({
    symbol: i.symbol,
    cls: i.cls,
    side: t.side,
    mode: t.mode,
    type: t.type,
    sizeMode: t.sizeMode,
    size: parseNumber(t.size),
    price: parseNumber(t.price),
    leverage: lev,
    tp: parseNumber(t.tp),
    sl: parseNumber(t.sl),
    quote,
    cash: live.cash,
    equity: value.equity,
    held,
    settings: engineSettings(),
  });

  if (!i.tradable) {
    const alt = i.tradeInstead ? instrument(i.tradeInstead) : null;
    return (
      <Pane label="Order ticket" title="Ticket" className="pane-ticket">
        <PaneState
          title={`${i.symbol} is chart only`}
          action={
            alt ? (
              <button type="button" className="btn" onClick={() => select(alt.id)}>
                Trade {alt.symbol} instead
              </button>
            ) : undefined
          }
        >
          {alt ? `An index cannot be bought directly. ${alt.name} tracks it and can be traded.` : 'This instrument can be charted but not traded in Flame.'}
        </PaneState>
      </Pane>
    );
  }

  const input = (): OrderInput => {
    const tp = parseNumber(t.tp);
    const sl = parseNumber(t.sl);
    const px = parseNumber(t.price);
    return {
      instrument: id,
      cls: i.cls,
      mode: t.mode,
      side: t.side,
      type: t.type,
      qty: preview.qty,
      ...(t.type === 'limit' ? { limit: px } : {}),
      ...(t.type === 'stop' ? { stop: px } : {}),
      ...(t.mode === 'lev' ? { leverage: lev } : {}),
      ...(tp > 0 ? { tp } : {}),
      ...(sl > 0 ? { sl } : {}),
    };
  };

  const send = () => {
    setConfirming(false);
    if (preview.problem || !(preview.qty > 0)) return;
    const q = priceNow();
    // In Replay, the order happens at the replayed bar's time, not at today's.
    place(input(), q, book, getQuote ? q?.t : undefined);
  };
  const submit = () => {
    if (preview.problem || !(preview.qty > 0)) return;
    if (settings.confirmOrders) setConfirming(true);
    else send();
  };

  const unit = t.sizeMode === 'units' ? i.symbol : t.sizeMode === 'dollars' ? 'USD' : '% of equity';
  const action = `${preview.verb} ${preview.qty > 0 ? `${fmtQty(preview.qty, preview.est || 1)} ` : ''}${i.symbol}`;
  const closedMarket = quote?.open === false;
  const showBrackets = !(t.mode === 'spot' && t.side === 'sell');

  return (
    <Pane label="Order ticket" title="Ticket" className="pane-ticket" tools={badge ?? <FeedBadge instrumentId={id} />}>
      <form
        className="pane-body ticket"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Segmented<Side>
          label="Side"
          block
          tall
          value={t.side}
          onChange={(side) => t.set({ side })}
          options={[
            {
              value: 'buy',
              title: 'B',
              label: (
                <>
                  <span className="side-glyph hot" aria-hidden="true">▲</span> {t.mode === 'lev' ? 'Long' : 'Buy'}
                </>
              ),
            },
            {
              value: 'sell',
              title: 'S',
              label: (
                <>
                  <span className="side-glyph cold" aria-hidden="true">▼</span> {t.mode === 'lev' ? 'Short' : 'Sell'}
                </>
              ),
            },
          ]}
        />

        <div className="ticket-row">
          <Segmented<'spot' | 'lev'>
            label="Mode"
            value={t.mode}
            onChange={(mode) => t.set({ mode })}
            options={[
              { value: 'spot', label: 'Spot', title: 'Buy and hold the asset itself. No shorting, no leverage.' },
              { value: 'lev', label: levName, title: `Long or short with up to ${rules.maxLeverage}× leverage, on isolated margin.` },
            ]}
          />
          <Segmented<OrderType>
            label="Order type"
            value={t.type}
            onChange={(type) => t.set({ type })}
            options={[
              { value: 'market', label: 'Market', title: 'Fill now at the best available prices.' },
              { value: 'limit', label: 'Limit', title: 'Fill only at your price or better.' },
              { value: 'stop', label: 'Stop', title: 'Become a market order once the price trades at your stop.' },
            ]}
          />
        </div>

        {t.type !== 'market' ? (
          <NumField
            label={t.type === 'limit' ? 'Limit price' : 'Stop price'}
            prefix="$"
            value={t.price}
            inputRef={priceRef}
            onChange={(text) => t.set({ price: text })}
            action={quote ? { label: 'Last', title: 'Use the last price', onClick: () => t.set({ price: fmtPrice(quote.last).replace(/,/g, '') }) } : undefined}
          />
        ) : null}

        <div className="field">
          <div className="field-label">
            <span id="size-label">Size</span>
            <Segmented<SizeMode>
              label="Size in"
              value={t.sizeMode}
              onChange={(sizeMode) => t.set({ sizeMode, size: sizeMode === 'risk' ? String(settings.riskPct) : '' })}
              options={[
                { value: 'units', label: 'Units' },
                { value: 'dollars', label: 'Dollars' },
                { value: 'risk', label: 'Risk', title: 'Choose how much to lose if the stop is hit; Flame works out the size.' },
              ]}
            />
          </div>
          <NumField
            label={<span className="sr-only">Size in {unit}</span>}
            value={t.size}
            inputRef={sizeRef}
            suffix={unit}
            onChange={(text) => t.set({ size: text })}
            action={
              t.sizeMode === 'risk'
                ? undefined
                : {
                    label: 'Max',
                    title: 'The most your cash allows',
                    onClick: () => {
                      const px = preview.ref;
                      const m = maxQty({ cls: i.cls, side: t.side, mode: t.mode, leverage: lev, cash: live.cash, held, settings: engineSettings() }, px);
                      if (m > 0) t.set({ size: t.sizeMode === 'units' ? trim(m, 6) : trim(m * px, 2) });
                    },
                  }
            }
            note={
              t.sizeMode === 'risk' && preview.qty > 0 && preview.risk !== null
                ? `${fmtQty(preview.qty, preview.est)} ${i.symbol}, so the stop loses ${money(preview.risk)}.`
                : t.sizeMode === 'dollars' && preview.qty > 0
                  ? `${fmtQty(preview.qty, preview.est)} ${i.symbol}`
                  : t.sizeMode === 'units' && preview.qty > 0
                    ? `About ${money(preview.notional)}`
                    : undefined
            }
          />
        </div>

        {t.mode === 'lev' ? (
          <div className="field">
            <div className="field-label">
              <label htmlFor="lev">
                Leverage{' '}
                <Help align="left">
                  Leverage lets a small margin control a larger position. Gains and losses are on the full position, so {lev}× loses the margin after a move of about{' '}
                  {(100 / lev - rules.mmr * 100).toFixed(1)}% against you.
                </Help>
              </label>
              <small className="num">{lev}×</small>
            </div>
            <input
              id="lev"
              type="range"
              min={1}
              max={rules.maxLeverage}
              step={rules.maxLeverage <= 2 ? 0.5 : 1}
              value={lev}
              onChange={(e) => t.set({ leverage: Number(e.target.value) })}
            />
            <div className="field-note">
              {preview.liq !== null && preview.qty > 0 ? (
                <>
                  Liquidation at <span className="num">{dollars(preview.liq)}</span>
                </>
              ) : (
                `1× to ${rules.maxLeverage}×`
              )}
            </div>
          </div>
        ) : null}

        {showBrackets ? (
          <div className="ticket-row ticket-brackets">
            <NumField
              label="Stop-loss"
              prefix="$"
              value={t.sl}
              placeholder="None"
              onChange={(text) => t.set({ sl: text })}
              aside={preview.risk !== null && preview.qty > 0 ? `−1R = ${money(preview.risk)}` : undefined}
            />
            <NumField
              label="Take-profit"
              prefix="$"
              value={t.tp}
              placeholder="None"
              onChange={(text) => t.set({ tp: text })}
              aside={preview.tpR !== null ? `target is ${rr(preview.tpR).replace('+', '')}` : undefined}
            />
          </div>
        ) : null}

        {/* Not a live region: it changes with every tick. The order button points at it instead. */}
        <div className="ticket-preview" id="ticket-preview">
          {preview.problem ? <span className={preview.incomplete ? 'ticket-hint' : 'ticket-problem'}>{preview.problem}</span> : preview.sentence}
          {!preview.problem && closedMarket ? ' The market is closed; the order waits for the open.' : ''}
          {!preview.problem && !getQuote && t.type !== 'limit' && route(id)?.adapter.hasBook && fillBasis(id) === 'last'
            ? ' The order book is not synced right now, so this fills at the last price plus one basis point instead of walking the book.'
            : ''}
        </div>

        {touch ? (
          <HoldButton label={action} onConfirm={submit} disabled={!!preview.problem || !(preview.qty > 0)} side={t.side} />
        ) : (
          <button type="submit" className="btn btn-primary ticket-go" data-side={t.side} aria-describedby="ticket-preview" disabled={!!preview.problem || !(preview.qty > 0)}>
            <span className="ticket-go-text">{action}</span>
            <kbd>Enter</kbd>
          </button>
        )}

        {!getQuote ? <ConePanel instrumentId={id} side={t.side} qty={preview.qty} entry={preview.est} feeRate={preview.notional > 0 ? preview.fee / preview.notional : 0} stop={parseNumber(t.sl)} target={parseNumber(t.tp)} /> : null}

        <dl className="ticket-facts num">
          <div>
            <dt>Cash</dt>
            <dd>{money(live.cash)}</dd>
          </div>
          {held > 0 ? (
            <div>
              <dt>Holding</dt>
              <dd>
                {fmtQty(held, quote?.last ?? 1)} {i.symbol}
              </dd>
            </div>
          ) : null}
          {levPos ? (
            <div>
              <dt>{levName} position</dt>
              <dd>
                {levPos.dir === 'long' ? 'Long' : 'Short'} {fmtQty(levPos.qty, levPos.entry)} {i.symbol}
              </dd>
            </div>
          ) : null}
        </dl>
      </form>

      {confirming ? (
        <Dialog
          title={`${action}?`}
          onClose={() => setConfirming(false)}
          foot={
            <>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" data-autofocus onClick={send}>
                {action}
              </button>
            </>
          }
        >
          <p>{preview.sentence}</p>
        </Dialog>
      ) : null}
    </Pane>
  );
}
