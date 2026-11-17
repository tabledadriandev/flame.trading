import { describe, expect, it } from 'vitest';
import { age, tokenPrice } from './format';

describe('token prices', () => {
  it('keeps four significant digits however small the price', () => {
    expect(tokenPrice(73.027)).toBe('$73.027');
    expect(tokenPrice(1234.5)).toBe('$1,234.50');
    expect(tokenPrice(0.5)).toBe('$0.5');
    expect(tokenPrice(0.018646)).toBe('$0.01865');
    expect(tokenPrice(0.00042)).toBe('$0.00042');
  });

  it('counts the zeros as a subscript once there are four or more', () => {
    expect(tokenPrice(0.000004821)).toBe('$0.0₅4821');
    expect(tokenPrice(0.00000000000363318)).toBe('$0.0₁₁3633');
  });

  it('carries a rounding into the zeros', () => {
    expect(tokenPrice(0.00099996)).toBe('$0.001');
    expect(tokenPrice(0.99999)).toBe('$1.00');
  });

  it('shows a dash for no price', () => {
    expect(tokenPrice(0)).toBe('—');
    expect(tokenPrice(null)).toBe('—');
    expect(tokenPrice(NaN)).toBe('—');
  });
});

describe('age', () => {
  it('uses one unit', () => {
    expect(age(20_000)).toBe('now');
    expect(age(20 * 60_000)).toBe('20m');
    expect(age(3 * 3_600_000)).toBe('3h');
    expect(age(5 * 86_400_000)).toBe('5d');
    expect(age(240 * 86_400_000)).toBe('7mo');
    expect(age(800 * 86_400_000)).toBe('2y');
  });
});
