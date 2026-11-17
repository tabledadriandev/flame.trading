// The desk is the terminal itself: every pane a trader needs on one screen.
// This file is the layout skeleton; each pane is specified in docs/product-spec.md.

const PANES: { key: string; title: string; note: string; hint: string; wide?: boolean }[] = [
  { key: 'watch', title: 'Watchlist', note: 'Live prices', hint: 'Your symbols, with price, day change and a sparkline.' },
  { key: 'chart', title: 'Chart', note: 'Candles and indicators', hint: 'Candles, drawing levels, and your orders and positions on the price axis.' },
  { key: 'book', title: 'Book and tape', note: 'All venues', hint: 'One heat ladder merged from every exchange, with the trade tape under it.' },
  { key: 'ticket', title: 'Order ticket', note: 'Paper only', hint: 'Market, limit and stop orders, sized by the risk you choose.' },
  { key: 'positions', title: 'Positions', note: 'Orders, fills, journal', hint: 'Open positions, working orders and every fill, each one journaled.', wide: true },
];

export function Desk() {
  return (
    <div className="desk">
      {PANES.map((p) => (
        <section key={p.key} className={p.wide ? 'pane pane-positions' : 'pane'} aria-label={p.title}>
          <header className="pane-head">
            {p.title}
            <small>{p.note}</small>
          </header>
          <div className="pane-body">
            <strong>Not built yet</strong>
            <span>{p.hint}</span>
          </div>
        </section>
      ))}
    </div>
  );
}
