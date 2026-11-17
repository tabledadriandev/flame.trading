import { describe, expect, it } from 'vitest';
import { candlesFromGecko, drainedWhy, enginePool, parseDexId, poolFromGecko, poolRead, riskFromRugcheck, type PoolInfo } from './dex';

// Shapes copied from the live APIs on 17 November 2026.
const GECKO_POOL = {
  id: 'solana_5AFbwVSQPJf4cgEjq4TajZYyPYUvYktrRN3SahNrPnmv',
  type: 'pool',
  attributes: {
    base_token_price_usd: '0.018645775453735893',
    address: '5AFbwVSQPJf4cgEjq4TajZYyPYUvYktrRN3SahNrPnmv',
    name: 'GTA6 / SOL',
    pool_created_at: '2026-10-29T13:56:21Z',
    fdv_usd: '18699397.02',
    market_cap_usd: null,
    pool_fee_percentage: '0.25',
    locked_liquidity_percentage: '46.4',
    price_change_percentage: { m5: '-0.355', h1: '0.188', h24: '72.743' },
    transactions: { h24: { buys: 64399, sells: 42776 } },
    volume_usd: { h24: '8056211.6' },
    reserve_in_usd: '246716.5756',
  },
  relationships: {
    base_token: { data: { id: 'solana_4kjruqGHDsSqkMdFfCjV7Vb62HPFhtXyWc2t6JpQzDnz', type: 'token' } },
    dex: { data: { id: 'meteora', type: 'dex' } },
  },
};
const INCLUDED = [{ id: 'solana_4kjruqGHDsSqkMdFfCjV7Vb62HPFhtXyWc2t6JpQzDnz', type: 'token', attributes: { name: 'GTA VI', symbol: 'GTA6' } }];
const NOW = Date.parse('2026-11-17T16:00:00Z');

describe('GeckoTerminal pools', () => {
  it('reads a pool into dollars, percent and a share', () => {
    const p = poolFromGecko('solana', GECKO_POOL, INCLUDED, NOW)!;
    expect(p).toMatchObject({
      id: 'dex:solana:5AFbwVSQPJf4cgEjq4TajZYyPYUvYktrRN3SahNrPnmv',
      symbol: 'GTA6',
      name: 'GTA VI',
      quoteSymbol: 'SOL',
      token: '4kjruqGHDsSqkMdFfCjV7Vb62HPFhtXyWc2t6JpQzDnz',
      dex: 'meteora',
      liquidity: 246716.5756,
      marketCap: 18699397.02,
      trades24h: 107175,
      volume24h: 8056211.6,
      fee: 0.0025,
      lockedPct: 46.4,
    });
    expect(p.price).toBeCloseTo(0.0186457754, 9);
    expect(p.change).toEqual({ m5: -0.355, h1: 0.188, h24: 72.743 });
    expect(p.createdAt).toBe(Date.parse('2026-10-29T13:56:21Z'));
  });

  it('falls back to the pair name when the token is not included, and leaves out a pool with no price', () => {
    expect(poolFromGecko('solana', GECKO_POOL, undefined, NOW)).toMatchObject({ symbol: 'GTA6', name: 'GTA6' });
    expect(poolFromGecko('solana', { ...GECKO_POOL, attributes: { ...GECKO_POOL.attributes, base_token_price_usd: null } }, INCLUDED, NOW)).toBeNull();
    expect(poolFromGecko('solana', { attributes: { address: 'x' } }, INCLUDED, NOW)).toBeNull();
  });

  it('turns the pool into what the engine fills against: equal dollars on each side', () => {
    const pool = enginePool(poolFromGecko('solana', GECKO_POOL, INCLUDED, NOW)!)!;
    expect(pool.dollars).toBeCloseTo(246716.5756 / 2, 6);
    expect(pool.dollars / pool.tokens).toBeCloseTo(0.0186457754, 9);
    expect(pool.fee).toBe(0.0025);
  });

  it('reads candles oldest first, in milliseconds', () => {
    const body = { data: { attributes: { ohlcv_list: [[1794928200, 0.0187, 0.0188, 0.0185, 0.0186, 13847.3], [1794927900, 0.0189, 0.0192, 0.0175, 0.0187, 48418.4], ['bad']] } } };
    const bars = candlesFromGecko(body);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toEqual({ t: 1794927900000, o: 0.0189, h: 0.0192, l: 0.0175, c: 0.0187, v: 48418.4 });
    expect(() => candlesFromGecko({ nope: true })).toThrow(/could not read/);
  });

  it('only accepts ids for the chains Flame lists', () => {
    expect(parseDexId('dex:solana:5AFbwVSQPJf4cgEjq4TajZYyPYUvYktrRN3SahNrPnmv')).toEqual({ chain: 'solana', address: '5AFbwVSQPJf4cgEjq4TajZYyPYUvYktrRN3SahNrPnmv' });
    expect(parseDexId('dex:base:0xe8d6ae09757769968d17eab44998a03e196217e7')).toMatchObject({ chain: 'base' });
    expect(parseDexId('dex:tron:abc')).toBeNull();
    expect(parseDexId('dex:solana:../../etc')).toBeNull();
  });
});

const pool = (over: Partial<PoolInfo>): PoolInfo => ({ ...poolFromGecko('solana', GECKO_POOL, INCLUDED, NOW)!, ...over });

describe("Flame's read of a pool", () => {
  it('calls a new, thin pool high risk and says why', () => {
    const r = poolRead(pool({ liquidity: 3_000, createdAt: NOW - 20 * 60_000 }), NOW);
    expect(r.level).toBe('high');
    expect(r.reasons).toEqual(expect.arrayContaining(['almost nothing in the pool', 'less than an hour old']));
  });

  it('notices a pool nobody has managed to sell into', () => {
    const r = poolRead(pool({ buys24h: 400, sells24h: 3, trades24h: 403 }), NOW);
    expect(r.reasons.join(' ')).toMatch(/almost nobody has sold/);
    expect(r.level).not.toBe('lower');
  });

  it('an older pool with real liquidity is lower risk, not no risk', () => {
    const r = poolRead(pool({ liquidity: 5_000_000, marketCap: 60_000_000, createdAt: NOW - 400 * 86_400_000, change: { m5: 0, h1: 0, h24: 2 } }), NOW);
    expect(r).toEqual({ level: 'lower', reasons: ['an older pool with real liquidity'] });
  });

  it('lists a pool as drained when the liquidity has gone or the price has collapsed', () => {
    expect(drainedWhy(pool({ liquidity: 40, volume24h: 90_000 }))).toBe('Under $1,000 left in the pool, after real trading');
    expect(drainedWhy(pool({ liquidity: 0, volume24h: 90_000 }))).toBe('Nothing left in the pool');
    expect(drainedWhy(pool({ change: { m5: 0, h1: -5, h24: -96.4 } }))).toBe('Down 96% today');
    expect(drainedWhy(pool({}))).toBeNull();
  });

  it('what the source did not report is unknown, not zero', () => {
    const bare = poolFromGecko('solana', { ...GECKO_POOL, attributes: { ...GECKO_POOL.attributes, reserve_in_usd: null, volume_usd: {} } }, INCLUDED, NOW)!;
    expect(bare.liquidity).toBeNull();
    expect(bare.volume24h).toBeNull();
    // Unknown liquidity is not "drained", and there is no pool to price an order against.
    expect(drainedWhy(bare)).toBeNull();
    expect(enginePool(bare)).toBeNull();
    expect(poolRead(bare, NOW).reasons).toContain('the size of the pool is not reported');
  });

  it('a pool reported with nothing in it is an empty pool, not a missing one', () => {
    const gone = enginePool(pool({ liquidity: 0 }))!;
    expect(gone).toMatchObject({ tokens: 0, dollars: 0 });
  });
});

describe('RugCheck', () => {
  it('reads the risks and the locked share', () => {
    const r = riskFromRugcheck({
      risks: [
        { name: 'Low Liquidity', value: '$0.01', description: 'Low amount of liquidity in the token pool', score: 2999, level: 'danger' },
        { name: 'High market cap per holder', value: '', description: 'The market cap is very high relative to its number of holders', score: 10000, level: 'warn' },
      ],
      score_normalised: 54,
      lpLockedPct: 100,
    })!;
    expect(r.score).toBe(54);
    expect(r.lockedPct).toBe(100);
    expect(r.items[0]).toEqual({ name: 'Low Liquidity', detail: 'Low amount of liquidity in the token pool ($0.01)', level: 'danger' });
    expect(r.sellBlocked).toBeNull();
    expect(r.sellTax).toBeNull();
  });

  it('flags a token that can be frozen, and reads a transfer tax', () => {
    const r = riskFromRugcheck({ risks: [{ name: 'Freeze Authority still enabled', description: 'Tokens can be frozen', level: 'danger' }, { name: 'Transfer fee', value: '8%', level: 'warn' }], score_normalised: 80 })!;
    expect(r.sellBlocked).toMatch(/cannot sell/);
    expect(r.sellTax).toBeCloseTo(0.08, 9);
  });

  it('a report with no score has no score, not the safest one', () => {
    expect(riskFromRugcheck({ risks: [] })!.score).toBeNull();
  });

  it('is null for an answer that is not a report', () => {
    expect(riskFromRugcheck({ error: 'not found' })).toBeNull();
  });
});
