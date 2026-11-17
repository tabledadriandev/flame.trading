# Data sources

**Status of this document: unverified.** Everything below was written from knowledge of these APIs. The sandbox that produced the baseline could not reach any of them, so not one call was tested. Before building on a source, make a real request, compare it with this page, and correct the page. Mark each section "Verified <date>" when you have.

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

Things to check for each venue when you verify:

- Does the REST endpoint send `Access-Control-Allow-Origin`? If not, proxy it or use the venue only over WebSocket.
- **Binance:** `api.binance.com` is blocked in some regions. `data-api.binance.vision` (REST) and `wss://data-stream.binance.vision` (WebSocket) serve public market data and are the fallback. Klines carry taker-buy volume, which gives per-bar delta for free: delta = 2 × takerBuyBase − volume.
- **Coinbase:** some book channels moved behind authentication in 2023. `level2_batch` is believed to be the public one. If it is not, use `ticker` plus the REST book.
- **Binance book sync:** buffer diffs, fetch the snapshot, drop diffs older than the snapshot's `lastUpdateId`, then apply in order; on a gap, resync.
- **OKX and Bybit:** both send a checksum or sequence with book updates; on a mismatch, resubscribe.
- Rate limits and connection limits per IP.

### The merged book

Each adapter keeps its own price → size map per side. An aggregator runs about four times a second:

1. Take the mid from the primary venue.
2. Keep levels within ±1% of the mid.
3. Convert USDT-quoted prices to USD at parity (note this in the pane's help).
4. Bucket into rows of the chosen tick ($1, $5, $10, $20, $50 for BTC; scale by price for other coins).
5. Emit rows with total size and the per-venue split, plus the largest row on each side as the supply and demand wall.

A venue that is reconnecting is left out and named in the pane.

### Instruments list

Build the crypto list from Binance `GET /api/v3/ticker/24hr`: USDT pairs, ranked by quote volume, top 40, minus stablecoin-to-stablecoin pairs and leveraged tokens. Map each to the other venues' symbols with a small table; a coin a venue does not list simply has no book contribution from it.

## Stocks, ETFs, indices, rates, commodities: through `/api`

HAJ's symbols are Yahoo Finance notation, and Yahoo's unofficial chart endpoints are the simplest free source. They are not a licensed feed: they can change or rate-limit without notice, and prices are delayed for many exchanges. That is acceptable for a paper-trading tool that labels the delay. If Flame becomes a public product with real traffic, move to a licensed feed.

| Function | Upstream | Returns |
|---|---|---|
| `GET /api/quote/chart?symbol=SPY&range=1d&interval=5m` | `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=&interval=&includePrePost=false` | Candles plus meta (last price, previous close, currency, exchange timezone, market state) |
| `GET /api/quote/spark?symbols=^GSPC,^IXIC,…` | `https://query1.finance.yahoo.com/v8/finance/spark?symbols=&range=1d&interval=5m` | Last price, previous close and a sparkline for each symbol, in one call (for the Markets boards) |
| `GET /api/quote/search?q=nvid` | `https://query1.finance.yahoo.com/v1/finance/search?q=&quotesCount=8&newsCount=0` | Symbol matches |

Notes:

- Send a browser-like `User-Agent`; Yahoo rejects some default clients.
- The `v7/finance/quote` endpoint now needs a cookie and crumb. Avoid it; `chart` and `spark` carry what Flame needs.
- Cache: `s-maxage=15, stale-while-revalidate=60` for intraday, an hour for daily history.
- Validate and whitelist the `symbol` and `range` parameters; never pass a user string straight into an upstream URL. Return upstream failures as a clear JSON error, not a 500 with a stack.
- Fallbacks if Yahoo stops answering from Vercel's addresses: Stooq CSV (daily history, no key), or a free-key provider (Twelve Data, Finnhub, Alpha Vantage) with the key in a Vercel environment variable.

Useful symbols: `^GSPC` S&P 500, `^IXIC` Nasdaq, `^DJI` Dow, `^RUT` Russell 2000, `^VIX` VIX, `^TNX` 10-year yield, `GC=F` gold, `CL=F` crude, `EURUSD=X` euro–dollar.

Market hours for the session clocks do not need a feed: New York 09:30–16:00 America/New_York, London 08:00–16:30 Europe/London, Frankfurt 09:00–17:30 Europe/Berlin, Tokyo 09:00–15:30 Asia/Tokyo (lunch break 11:30–12:30), Hong Kong 09:30–16:00 Asia/Hong_Kong (lunch break 12:00–13:00). Compute with `Intl.DateTimeFormat` time zones; weekends are closed; holidays are a later refinement. Verify these hours once against each exchange's own page.

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
