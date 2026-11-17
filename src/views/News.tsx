import { useCallback, useEffect, useState } from 'react';
import { instrument } from '../data/instruments';
import { stamp } from '../lib/format';
import { openOnDesk } from '../shell/commands';
import { PaneState } from '../ui/controls';

interface NewsItem {
  title: string;
  link: string;
  time: number | null;
  source: string;
  primary: boolean;
  about: string[];
}

interface NewsPayload {
  items: NewsItem[];
  sources: string[];
  failed: string[];
}

function ago(t: number | null, now: number): string {
  if (t === null) return 'No date given';
  const m = Math.round((now - t) / 60_000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  return stamp(t);
}

export function News() {
  const [data, setData] = useState<NewsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    fetch('/api/news', { signal: AbortSignal.timeout(20_000) })
      .then(async (res) => {
        const body = (await res.json()) as NewsPayload & { message?: string };
        if (!res.ok) throw new Error(body.message ?? `The news service answered ${res.status}.`);
        setData(body);
        setError(null);
        setNow(Date.now());
      })
      .catch((err: unknown) => {
        console.warn('[flame] news failed', err);
        setError(err instanceof Error && !/aborted|Failed to fetch|JSON/i.test(err.message) ? err.message : 'The headlines could not be loaded. Check the connection.');
      });
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 180_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="news">
      <header className="jtop">
        <h1 className="page-title" aria-hidden="true">
          News
        </h1>
        <p className="lab-lede">
          Announcements straight from the institutions that move markets{data ? `: ${data.sources.join(', ')}` : ''}. Every headline links to the source's own page.
        </p>
      </header>
      {error && !data ? (
        <PaneState
          title="The headlines could not be loaded"
          action={
            <button type="button" className="btn" onClick={load}>
              Try again
            </button>
          }
        >
          {error}
        </PaneState>
      ) : !data ? (
        <PaneState title="Loading headlines" />
      ) : (
        <>
          {data.failed.length || error ? (
            <p className="board-note" role="status">
              {data.failed.length ? `${data.failed.join(' and ')} could not be read just now and ${data.failed.length === 1 ? 'is' : 'are'} missing from this list. ` : ''}
              {error ? `The last refresh failed (${error}) These are the headlines from before.` : ''}
            </p>
          ) : null}
          <ol className="news-list">
            {data.items.map((item) => (
              <li key={item.link} className="news-item">
                <div className="news-meta">
                  <span>{item.source}</span>
                  <span className="num">{ago(item.time, now)}</span>
                  {!item.primary ? <span>Not a primary source</span> : null}
                </div>
                <a className="news-title" href={item.link} target="_blank" rel="noopener noreferrer">
                  {item.title}
                </a>
                {item.about.length ? (
                  <div className="news-tags">
                    {item.about.map((id) => (
                      <button key={id} type="button" className="btn btn-sm" onClick={() => openOnDesk(id)} title={`Open ${instrument(id).name} on the desk`}>
                        {instrument(id).symbol}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
