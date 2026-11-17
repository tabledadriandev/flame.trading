import { describe, expect, it } from 'vitest';
import { parseOrderText } from './orderText';

describe('typed orders', () => {
  it("reads the spec's example", () => {
    expect(parseOrderText('buy 0.1 btc limit 63000')).toEqual({ side: 'buy', mode: 'spot', symbol: 'BTC', type: 'limit', qty: 0.1, price: 63_000 });
  });

  it('reads market orders, dollar sizes, stops and long/short', () => {
    expect(parseOrderText('sell 2 eth')).toEqual({ side: 'sell', mode: 'spot', symbol: 'ETH', type: 'market', qty: 2 });
    expect(parseOrderText('buy $500 sol')).toEqual({ side: 'buy', mode: 'spot', symbol: 'SOL', type: 'market', dollars: 500 });
    expect(parseOrderText('short 0.5 btc stop 60,000')).toEqual({ side: 'sell', mode: 'lev', symbol: 'BTC', type: 'stop', qty: 0.5, price: 60_000 });
    expect(parseOrderText('Long 1 BTC at 64k')).toEqual({ side: 'buy', mode: 'lev', symbol: 'BTC', type: 'limit', qty: 1, price: 64_000 });
    expect(parseOrderText('buy 10 spy market')).toEqual({ side: 'buy', mode: 'spot', symbol: 'SPY', type: 'market', qty: 10 });
  });

  it('refuses anything that is not clearly an order', () => {
    for (const text of ['btc', 'buy btc', 'buy 0 btc', 'buy -1 btc', 'buy 1 btc limit', 'buy 1 btc limit abc', 'buy 1 btc limit 5 extra', 'hold 1 btc', 'buy one btc', '']) {
      expect(parseOrderText(text)).toBeNull();
    }
  });
});
