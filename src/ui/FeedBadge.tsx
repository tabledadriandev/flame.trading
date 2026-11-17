import { CircleAlert, Clock, FlaskConical, Hourglass, Loader, Radio, WifiOff, type LucideIcon } from 'lucide-react';
import { route } from '../data/feed';
import { isStale, useMarket } from '../state/market';
import { useNow } from '../lib/hooks';

// Feed status in every pane: an icon and a word in ink, not a coloured dot.

export type FeedState = 'live' | 'delayed' | 'simulated' | 'connecting' | 'reconnecting' | 'down' | 'offline' | 'stale' | 'none';

const LOOK: Record<FeedState, { word: string; icon: LucideIcon; warn?: boolean; title: string }> = {
  live: { word: 'Live', icon: Radio, title: 'Prices are streaming from the exchange.' },
  delayed: { word: 'Delayed', icon: Clock, title: 'Prices for this instrument are delayed, typically by 15 minutes.' },
  simulated: { word: 'Simulated', icon: FlaskConical, warn: true, title: 'These prices are made up. The simulated feed is on (?sim=1).' },
  connecting: { word: 'Connecting', icon: Loader, title: 'Opening the feed.' },
  reconnecting: { word: 'Reconnecting', icon: Loader, warn: true, title: 'The feed dropped. Flame is reconnecting; prices shown may be old.' },
  down: { word: 'Feed down', icon: CircleAlert, warn: true, title: 'The feed cannot be reached. Flame keeps trying.' },
  offline: { word: 'Offline', icon: WifiOff, warn: true, title: 'This device is offline. Prices will resume when the connection returns.' },
  stale: { word: 'Stale', icon: Hourglass, warn: true, title: 'No price has arrived for a while. The number shown may be old.' },
  none: { word: 'No feed', icon: CircleAlert, warn: true, title: 'Flame has no data source for this instrument yet.' },
};

export function useFeedState(instrumentId: string): FeedState {
  const r = route(instrumentId);
  const feed = useMarket((s) => (r ? s.feeds[r.adapter.id] : undefined));
  const online = useMarket((s) => s.online);
  const quote = useMarket((s) => s.quotes[instrumentId]);
  const now = useNow(1_000);
  if (!r) return 'none';
  if (r.adapter.kind === 'simulated') return 'simulated';
  if (!online) return 'offline';
  if (feed === 'reconnecting' || feed === 'down') return feed;
  if (!quote) return 'connecting';
  if (isStale(quote, now)) return 'stale';
  return r.adapter.kind === 'delayed' ? 'delayed' : 'live';
}

export function FeedBadge({ instrumentId }: { instrumentId: string }) {
  return <StatusBadge state={useFeedState(instrumentId)} />;
}

export function StatusBadge({ state, word }: { state: FeedState; word?: string }) {
  const look = LOOK[state];
  const Icon = look.icon;
  return (
    <span className="status" data-level={look.warn ? 'warn' : undefined} title={look.title}>
      <Icon size={11} aria-hidden="true" />
      {word ?? look.word}
    </span>
  );
}
