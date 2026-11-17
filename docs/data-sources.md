# Data sources

**Status of this document: verified section by section.** It was first written from knowledge of these APIs, untested. Each source is now checked with a real request before Flame builds on it, and its section is marked "Verified <date>" with what was found. A section without that mark has not been tested: test it before relying on it.

Two ways data reaches Flame:

1. **Direct from the browser** for exchanges that publish public WebSockets and allow cross-origin requests. No server, no keys, lowest latency.
2. **Through a Vercel function in `/api`** for sources that block browsers (no CORS headers) or need response shaping. Functions add a short cache (`s-maxage`) so Flame is a polite client.

Flame never needs an API key for v1. If a source starts demanding one, pick another source rather than asking users for keys.

## The adapter interface

Every venue implements the same shape so panes stay venue-blind (a sketch; refine when you build it):

```ts
interface VenueAdapter {
  id: VenueId;                                   // 'binance' | 'coinbase' | ...
  candles(symbol: string, tf: Timeframe, from?: number, to?: number): Promise<Candle[]>;
  subscribeCandles?(symbol: string, tf: Timeframe, on: (c: Candle) => void): Unsubscribe;
  subscribeTrades(symbol: string, on: (t: Trade[]) => void): Unsubscribe;
  subscribeBook(symbol: string, on: (b: BookUpdate) => void): Unsubscribe;
  status(): 'connecting' | 'live' | 'reconnecting' | 'down';
}
```

One WebSocket per venue, shared by all subscriptions, with heartbeat, jittered exponential backoff (1 s → 30 s), and resubscription on reconnect. Feed messages are parsed off the render path and delivered in batches on `requestAnimationFrame`.

## Crypto: direct from the browser

Primary venue for charts, tape and fills: **Binance spot**. The others feed the merged book and are fallbacks.

| Venue | WebSocket | Book | Trades | Candles (REST) | Symbol for BTC |
|---|---|---|---|---|---|
| Binance | `wss://stream.binance.com:9443/stream?streams=…` | `<s>@depth@100ms` diffs + REST snapshot `GET /api/v3/depth?symbol=&limit=5000`, synced by update id | `<s>@aggTrade` | `GET https://api.binance.com/api/v3/klines?symbol=&interval=&limit=1000` | `BTCUSDT` (streams use lower case) |
| Coinbase Exchange | `wss://ws-feed.exchange.coinbase.com` | `level2_batch` channel (snapshot, then `l2update`) | `matches` | `GET https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=` | `BTC-USD` |
| Kraken | `wss://ws.kraken.com/v2` | `book` channel, depth up to 1000 | `trade` | `GET https://api.kraken.com/0/public/OHLC?pair=&interval=` | `BTC/USD` |
| Bitstamp | `wss://ws.bitstamp.net` | `order_book_btcusd` (top 100, full snapshot each message) | `live_trades_btcusd` | `GET https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=&limit=` | `btcusd` |
| OKX | `wss://ws.okx.com:8443/ws/v5/public` | `books` channel (400 levels, snapshot then updates) | `trades` | `GET https://www.okx.com/api/v5/market/candles?instId=&bar=` | `BTC-USDT` |
| Bybit | `wss://stream.bybit.com/v5/public/spot` | `orderbook.200.BTCUSDT` (snapshot then delta) | `publicTrade.BTCUSDT` | `GET https://api.bybit.com/v5/market/kline?category=spot&symbol=&interval=` | `BTCUSDT` |
| Hyperliquid (perps) | `wss://api.hyperliquid.xyz/ws` | `l2Book` subscription (20 levels a side per message; `nSigFigs` coarsens the levels to reach deeper) | `trades` | `POST https://api.hyperliquid.xyz/info` with `{"type":"candleSnapshot","req":{coin,interval,startTime,endTime}}` | `BTC` |

### Binance: verified 17 November 2026

Tested from Adrian's Mac (Romania) with `curl` (sending `Origin: https://flame.trading`) and Node's WebSocket, then from Chrome on `localhost` and on flame.trading.

- **REST CORS:** `api.binance.com` and `data-api.binance.vision` both answer `access-control-allow-origin: *`. No proxy needed.
- **Klines:** `GET /api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1000` returns arrays `[openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBase, takerBuyQuote, ignore]`; prices are strings. `endTime` pages back, `startTime` pages forward. Weight 2.
- **Depth snapshot:** `GET /api/v3/depth?symbol=BTCUSDT&limit=5000` returns `{lastUpdateId, bids, asks}`. Weight 250 at this limit (the budget is 6,000 a minute per IP).
- **Combined stream:** `wss://stream.binance.com:9443/stream?streams=a/b` works, and so does connecting to bare `/stream` and sending `{"method":"SUBSCRIBE","params":[…],"id":n}`; the reply is `{"result":null,"id":n}`. Flame uses the second form so it can change subscriptions without reconnecting. Messages arrive as `{"stream":"btcusdt@aggTrade","data":{…}}`.
- **Fallback hosts work:** `wss://data-stream.binance.vision/stream` carried `aggTrade`, `depth20@100ms` and `bookTicker`.
- **`@aggTrade`:** `{p, q, T, m}`; `m: true` means the buyer was the maker, so the trade was a sell.
- **`@depth@100ms`:** `{U, u, b, a}` diffs, synced to the snapshot by update id as described below. About ten messages a second for BTC.
- **`@kline_<tf>`:** `{k: {t, o, h, l, c, v, V, x}}` roughly once a second; `V` is taker-buy volume, `x` is true on the final update of a bar.
- **`@miniTicker`:** `{c, o, h, l, v, q}` once a second; `o` is the price 24 hours ago, so change = (c − o) / o.
- **`GET /api/v3/ticker/24hr?type=MINI`** (all symbols) is about 1 MB and weight 80. Flame calls it only when search opens, never on a timer. Its fields are `lastPrice`, `openPrice`, `quoteVolume`.
- **Limits:** five control messages a second per connection (Flame batches subscription changes into one message every 250 ms); 1,024 streams per connection.
- Not yet seen: the regional block on `api.binance.com`. The adapter rotates to the `binance.vision` hosts on 403, 451, 429 or a network failure.

Things to check for each venue when you verify:

- Does the REST endpoint send `Access-Control-Allow-Origin`? If not, proxy it or use the venue only over WebSocket.
- **Binance:** `api.binance.com` is blocked in some regions. `data-api.binance.vision` (REST) and `wss://data-stream.binance.vision` (WebSocket) serve public market data and are the fallback. Klines carry taker-buy volume, which gives per-bar delta for free: delta = 2 × takerBuyBase − volume.
- **Coinbase:** some book channels moved behind authentication in 2023. `level2_batch` is believed to be the public one. If it is not, use `ticker` plus the REST book.
- **Binance book sync:** buffer diffs, fetch the snapshot, drop diffs older than the snapshot's `lastUpdateId`, then apply in order; on a gap, resync.
- **OKX and Bybit:** both send a checksum or sequence with book updates; on a mismatch, resubscribe.
- Rate limits and connection limits per IP.

### The other six venues: verified 17 November 2026

Each was tested with Node's WebSocket from Adrian's Mac, then in Chrome through the merged book on the desk. All are public and need no key.

| Venue | What was found |
|---|---|
| Coinbase | `{"type":"subscribe","product_ids":["BTC-USD"],"channels":["level2_batch","matches"]}` works without authentication. The server reports the channel back as `level2_50`. A `snapshot` (`bids`/`asks` as `[price, size]` strings) is followed by `l2update` messages with `changes: [[side, price, size]]`; size `0` removes the level. |
| Kraken | `wss://ws.kraken.com/v2`, `{"method":"subscribe","params":{"channel":"book","symbol":["BTC/USD"],"depth":500}}`. Snapshot then updates, levels as `{price, qty}` numbers. Kraken keeps only the top N levels: the client must drop levels that fall out of range. Updates carry a CRC32 `checksum`; Flame does not verify it and instead resubscribes if the book ever crosses. `heartbeat` messages arrive every second. Kraken's public API lists no tokenized stock pairs here. |
| Bitstamp | `{"event":"bts:subscribe","data":{"channel":"order_book_btcusd"}}`. Every message is the full top 100 per side; no diffs to apply. |
| OKX | Port 8443 answers with a notice that it "will be retired soon. Please migrate to port 443", so Flame uses `wss://ws.okx.com/ws/v5/public` first. `books` channel: `action: "snapshot"` then `"update"`, each with `seqId` and `prevSeqId`; Flame resubscribes when `prevSeqId` does not match. Levels are `[price, size, "0", orderCount]`. The server expects the text `ping` at least every 30 seconds and answers `pong`. |
| Bybit | `{"op":"subscribe","args":["orderbook.200.BTCUSDT"]}`. `type: "snapshot"` then `"delta"`, with an update id `u` that rises by one; Flame resubscribes on a gap. Needs `{"op":"ping"}` every 20 seconds. |
| Hyperliquid | `{"method":"subscribe","subscription":{"type":"l2Book","coin":"BTC"}}` sends the whole book (20 levels a side, `{px, sz, n}`) about twice a second. Flame uses the default precision, so Hyperliquid contributes depth near the touch only. `{"method":"ping"}` keeps the connection open. The `perpDexs` query shows a deployer-run exchange (`xyz`) with perps on stocks and commodities; not used in v1. |

A coin a venue does not list simply never delivers a book; after 12 seconds the pane reports "No book for this coin on" that venue.

### The merged book

Each adapter keeps its own price → size map per side. An aggregator runs about four times a second:

1. Take the mid from the primary venue.
2. Keep levels within ±1% of the mid.
3. Line every other venue up on its own mid before adding it (changed from "convert USDT to USD at parity": at parity, a USD venue quoting a few dollars above a USDT venue put bids above asks and the merged book crossed). USDT and USDC still count as dollars. The pane's help says so.
4. Bucket into rows of the chosen tick ($1, $5, $10, $20, $50 for BTC; scale by price for other coins).
5. Emit rows with total size and the per-venue split, plus the largest row on each side as the supply and demand wall.

A venue that is reconnecting is left out and named in the pane.

### Instruments list

Build the crypto list from Binance `GET /api/v3/ticker/24hr`: USDT pairs, ranked by quote volume, top 40, minus stablecoin-to-stablecoin pairs and leveraged tokens. Map each to the other venues' symbols with a small table; a coin a venue does not list simply has no book contribution from it.

## Stocks, ETFs, indices, rates, commodities: through `/api`

### Status on 17 November 2026: no working source

**Yahoo Finance refuses Flame.** Tested three ways with a browser-like `User-Agent`, on `query1` and `query2`:

- from Adrian's Mac with `curl` and with Node: `429 Too Many Requests` on the first request of the day, for `chart`, `spark` and `search` alike
- from the deployed function on Vercel (region `cdg1`): the same `429`

So the block is not a rate limit Flame ran into; Yahoo now turns away clients that arrive without its cookies. Working around that (harvesting a cookie and crumb) would be defeating an access control, and Flame does not do it.

**The fallbacks this page used to name do not work either.** Stooq's CSV endpoints now answer with a JavaScript proof-of-work page ("This site requires JavaScript to verify your browser"). Cboe's delayed-quote files answer `307` from Cloudflare.

**What is built.** The three functions exist, validate their input and return clean JSON errors; today every upstream call ends in `503 upstream_rate_limited`. The browser side (`src/data/stocks.ts`) talks only to `/api/quote/*`, so the stock views, the "Delayed" label, margin mode and market-hours rules are all in place and show an honest "These quotes are not available" state.

**What unblocks it.** A licensed or key-based feed, with the key in a Vercel environment variable (never in the browser, never asked of users). Only `api/_lib/yahoo.ts` and the three handlers need to change; the response shape stays. Candidates, none tested because each needs an account:

| Provider | Free tier (as advertised; verify) | Fit |
|---|---|---|
| Alpaca Market Data | IEX real-time and 15-minute-delayed consolidated bars, about 200 requests a minute | Best fit: bars at every timeframe Flame uses, snapshots for many symbols in one call. Stocks and ETFs only; no indices, rates or futures |
| Twelve Data | About 800 requests a day, 8 a minute | Covers stocks, ETFs, some indices and FX; the daily budget is tight for polling a watchlist |
| Finnhub | 60 requests a minute; quotes free, intraday candles paid | Quotes only; not enough for charts |

Until then, acceptance check 5 (SPY, "Delayed", buy 10 shares) cannot pass on the live site. The same flow passes with the simulated feed (`?sim=1`), which exercises everything except the upstream call.

### The intended shape

| Function | Upstream (Yahoo, when it answers) | Returns |
|---|---|---|
| `GET /api/quote/chart?symbol=SPY&range=1d&interval=5m` | `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=&interval=&includePrePost=false` | `{quote, interval, range, candles}`: bars plus last price, previous close, currency, exchange, time zone and whether the regular session is open |
| `GET /api/quote/spark?symbols=^GSPC,^IXIC,…` | `https://query1.finance.yahoo.com/v8/finance/spark?symbols=&range=1d&interval=5m` | `{quotes: [...]}`: the same quote fields and a sparkline for up to 20 symbols in one call |
| `GET /api/quote/search?q=nvid` | `https://query1.finance.yahoo.com/v1/finance/search?q=&quotesCount=8&newsCount=0` | `{results: [{symbol, name, type, exchange}]}` |

Verified on flame.trading on 17 November 2026: a bad symbol (`../../etc`) returns `400 bad_symbol`; an unknown range returns `400 bad_range`; `POST` returns `405`; an upstream refusal returns `503` with a sentence, `Cache-Control: no-store`, and no stack trace.

Notes:

- The symbol must match `^[A-Z0-9^][A-Z0-9.\-=^]{0,14}$`; range and interval come from fixed lists, and only the combinations the source serves are allowed. The upstream host is a constant; nothing a caller sends can change it.
- Cache: `s-maxage=15, stale-while-revalidate=60` for intraday, an hour for daily history, five minutes for search. Errors are never cached.
- Vercel runs these files as native ES modules: relative imports need the `.js` extension (`../_lib/http.js`), or the function fails at load with `ERR_MODULE_NOT_FOUND`.

Useful symbols: `^GSPC` S&P 500, `^IXIC` Nasdaq, `^DJI` Dow, `^RUT` Russell 2000, `^VIX` VIX, `^TNX` 10-year yield, `GC=F` gold, `CL=F` crude, `EURUSD=X` euro–dollar.

Market hours for the session clocks do not need a feed: New York 09:30–16:00 America/New_York, London 08:00–16:30 Europe/London, Frankfurt 09:00–17:30 Europe/Berlin, Tokyo 09:00–15:30 Asia/Tokyo (lunch break 11:30–12:30), Hong Kong 09:30–16:00 Asia/Hong_Kong (lunch break 12:00–13:00). Computed with `Intl.DateTimeFormat` time zones (`src/lib/sessions.ts`); weekends are closed; holidays are a later refinement, and the Markets view says so.

Checked against each exchange's own page on 17 November 2026:

| Exchange | Result |
|---|---|
| NYSE | Confirmed: core session 9:30 a.m. to 4:00 p.m. ET (`nyse.com/markets/hours-calendars`) |
| HKEX | Confirmed: 9:30 to 12:00 and 13:00 to 16:00, with auctions either side (`hkex.com.hk`, Securities Market trading hours) |
| London | **Not confirmed.** The exchange's page points to a spreadsheet for hours; the value here is from memory |
| Frankfurt (Xetra) | **Not confirmed.** The official pages redirected or returned 404 |
| Tokyo | **Not confirmed.** `jpx.co.jp` returned 403 |

## Prediction markets: through `/api`

Polymarket publishes two public APIs:

- **Gamma** (`https://gamma-api.polymarket.com`): the catalogue. `GET /events?closed=false&order=volume24hr&ascending=false&limit=50` lists events with their markets, outcomes, outcome prices, volume and end date; tags give the topics.
- **CLOB** (`https://clob.polymarket.com`): prices and books. `GET /book?token_id=` for a market's order book, `GET /prices-history?market=<token_id>&interval=1w&fidelity=60` for the probability history.

Proxy both (`/api/odds/events`, `/api/odds/book`, `/api/odds/history`) with a 30-second cache. Paper fills use the best ask to buy and best bid to sell. A market that resolves pays $1 or $0 a share; read resolution from Gamma.

## News: through `/api`

`/api/news` fetches a short list of public RSS feeds on the server, merges them newest first, and returns title, link, source, time and any tickers matched in the title. Cache for two minutes. Choose feeds whose terms allow headline-and-link display, show the source name on every item, and link out rather than reproducing article text. Start with exchange and central-bank press feeds (SEC, Federal Reserve, ECB) and add news publishers only after reading their feed terms.

## What Flame does not use

- Anything that needs the user's own exchange key or wallet.
- Scraped pages.
- HAJ's own endpoints.
