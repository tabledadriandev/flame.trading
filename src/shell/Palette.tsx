import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { search } from '../data/search';
import type { Instrument } from '../data/instruments';
import { parseOrderText } from '../lib/orderText';
import { pct, price } from '../lib/format';
import { useMarket } from '../state/market';
import { usePalette } from '../state/palette';
import { toast } from '../state/toasts';
import { activeItems, useWatchlists } from '../state/watchlists';
import { commands, describeOrder, loadOrder, openOnDesk, type Command } from './commands';

const KIND: Record<Instrument['kind'], string> = {
  crypto: 'Crypto',
  stock: 'Stock',
  etf: 'ETF',
  index: 'Index',
  rate: 'Rate',
  commodity: 'Commodity',
  fx: 'Currency',
  odds: 'Prediction market',
};

interface Row {
  key: string;
  group: string;
  label: string;
  detail?: string;
  keys?: string;
  run: () => void;
  /** A second action on the row: add the symbol to the watchlist. */
  watch?: () => void;
  watching?: boolean;
}

export function Palette() {
  const { open, seed, purpose, hide } = usePalette();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Instrument[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const quotes = useMarket((s) => s.quotes);
  const watched = useWatchlists(activeItems);
  const before = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    before.current = document.activeElement as HTMLElement | null;
    setQuery(seed);
    setActive(0);
    input.current?.focus();
    return () => before.current?.focus?.();
  }, [open, seed]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setProblem(null);
    setFound(
      search(query, (more) => {
        if (!alive) return;
        setFound(more.items);
        setProblem(more.problem);
      }),
    );
    return () => {
      alive = false;
    };
  }, [query, open]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Row[] = [];
    const order = parseOrderText(query);
    if (order && purpose === 'go') {
      out.push({ key: 'order', group: 'Order', label: `Load into the ticket: ${describeOrder(order)}`, detail: 'Enter again in the ticket to place it', run: () => loadOrder(order) });
    }
    for (const i of found) {
      const quote = quotes[i.id];
      const watching = watched.includes(i.id);
      const add = () => {
        useWatchlists.getState().add(i.id);
        toast(`${i.symbol} added to the watchlist.`);
      };
      out.push({
        key: i.id,
        group: 'Symbols',
        label: i.symbol,
        detail: `${i.name === i.symbol ? '' : `${i.name}, `}${KIND[i.kind]}${quote ? `, ${price(quote.last)} ${Number.isFinite(quote.changePct) ? pct(quote.changePct) : ''}` : ''}`,
        run: purpose === 'watch' ? add : () => openOnDesk(i.id),
        ...(purpose === 'go' ? { watch: add, watching } : {}),
      });
    }
    if (purpose === 'go') {
      const cmds: Command[] = commands().filter((c) => !q || `${c.group} ${c.label}`.toLowerCase().includes(q));
      for (const c of cmds) out.push({ key: c.id, group: c.group, label: c.label, ...(c.keys ? { keys: c.keys } : {}), run: c.run });
    }
    return out;
  }, [query, found, quotes, watched, purpose]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const run = (row: Row | undefined) => {
    if (!row) return;
    hide();
    row.run();
  };

  let lastGroup = '';
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) hide();
      }}
    >
      <div className="dialog palette" role="dialog" aria-modal="true" aria-label={purpose === 'watch' ? 'Add a symbol to the watchlist' : 'Search and commands'}>
        <div className="palette-input">
          <Search size={15} aria-hidden="true" />
          <input
            ref={input}
            autoFocus
            value={query}
            placeholder={purpose === 'watch' ? 'Find a symbol to add' : 'Find a symbol, run a command, or type an order: buy 0.1 btc limit 63000'}
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={rows[active] ? `pal-${rows[active]!.key}` : undefined}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(rows.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(rows[active]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                hide();
              } else if (e.key === 'Tab') {
                e.preventDefault(); // focus stays in the palette
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {rows.length === 0 ? <div className="palette-empty">Nothing matches “{query}”. Try a ticker, a company name or a command such as “zen”.</div> : null}
          {rows.map((row, n) => {
            const head = row.group !== lastGroup ? row.group : null;
            lastGroup = row.group;
            return (
              <div key={row.key}>
                {head ? <div className="pop-label">{head}</div> : null}
                <div className="palette-row" data-active={n === active ? 'true' : undefined}>
                  <button
                    type="button"
                    id={`pal-${row.key}`}
                    role="option"
                    aria-selected={n === active}
                    className="palette-main"
                    tabIndex={-1}
                    onMouseMove={() => setActive(n)}
                    onClick={() => run(row)}
                  >
                    <strong>{row.label}</strong>
                    {row.detail ? <span>{row.detail}</span> : null}
                    {row.keys ? (
                      <small>
                        {row.keys.split(' ').map((k) => (
                          <kbd key={k}>{k}</kbd>
                        ))}
                      </small>
                    ) : null}
                  </button>
                  {row.watch ? (
                    <button type="button" className="btn btn-sm" tabIndex={-1} disabled={row.watching} onClick={row.watch}>
                      {row.watching ? 'Watching' : 'Watch'}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {problem ? <div className="palette-foot">{problem}</div> : null}
      </div>
    </div>
  );
}
