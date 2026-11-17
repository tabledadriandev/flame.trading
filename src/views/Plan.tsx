import type { ViewId } from '../lib/route';

// Honest placeholders for the views that are specified but not built.
// Each one is replaced by its real view as the roadmap in docs/roadmap.md lands.

const COPY: Record<Exclude<ViewId, 'desk'>, { title: string; body: string }> = {
  markets: {
    title: 'Markets',
    body: 'Indices, rates, commodities and crypto on one board, with session clocks for New York, London, Frankfurt, Tokyo and Hong Kong, and the day’s biggest movers.',
  },
  flow: {
    title: 'Flow',
    body: 'Who is buying and who is selling: a footprint chart, the volume profile, cumulative delta, and a single order book merged from seven exchanges with its supply and demand walls marked.',
  },
  odds: {
    title: 'Odds',
    body: 'Prediction markets as live probabilities. Browse by topic, see how the odds moved this week, and take a paper position on either side.',
  },
  replay: {
    title: 'Replay',
    body: 'Pick any day and play the market back one bar at a time. Trade it with a separate practice account, then see how your read compared with what happened.',
  },
  lab: {
    title: 'Lab',
    body: 'Write down a rule, run it over years of history, and see the equity curve, drawdown and every trade it would have taken before you risk a cent of play money on it.',
  },
  journal: {
    title: 'Journal',
    body: 'Every trade from first fill to close, tagged with the setup and how you felt. Expectancy, profit factor, drawdown and R-multiples show what is working.',
  },
  news: {
    title: 'News',
    body: 'Market headlines in one stream, each tagged with the tickers it moves and how much attention it is getting compared with a normal hour.',
  },
};

export function Plan({ view }: { view: Exclude<ViewId, 'desk'> }) {
  const { title, body } = COPY[view];
  return (
    <article className="plan">
      <h1>{title}</h1>
      <p>{body}</p>
      <span className="plan-status">Not built yet</span>
    </article>
  );
}
