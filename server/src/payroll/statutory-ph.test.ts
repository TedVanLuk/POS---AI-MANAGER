import { describe, expect, it } from 'vitest';
import { pagibigContribution, philhealthContribution, sssContribution, sssMsc, withholdingTax } from './statutory-ph.js';

describe('SSS 2025 schedule', () => {
  it.each([[4000, 5000], [5249.99, 5000], [5250, 5500], [18258.33, 18500], [34749.99, 34500], [34750, 35000], [90000, 35000]])(
    'MSC for %d is %d', (comp, msc) => expect(sssMsc(comp)).toBe(msc),
  );
  it('splits 5% / 10% with EC', () => {
    expect(sssContribution(20000)).toEqual({ msc: 20000, ee: 1000, er: 2000, ec: 30 });
    expect(sssContribution(10000)).toEqual({ msc: 10000, ee: 500, er: 1000, ec: 10 });
  });
});

describe('PhilHealth', () => {
  it('applies floor and ceiling', () => {
    expect(philhealthContribution(8000)).toEqual({ base: 10000, ee: 250, er: 250 });
    expect(philhealthContribution(150000)).toEqual({ base: 100000, ee: 2500, er: 2500 });
    expect(philhealthContribution(30000)).toEqual({ base: 30000, ee: 750, er: 750 });
  });
});

describe('Pag-IBIG', () => {
  it('uses 1% for low earners and caps the fund salary', () => {
    expect(pagibigContribution(1500)).toEqual({ base: 1500, ee: 15, er: 30 });
    expect(pagibigContribution(25000)).toEqual({ base: 10000, ee: 200, er: 200 });
  });
});

describe('withholding tax (TRAIN 2023+)', () => {
  it('monthly', () => {
    expect(withholdingTax(20833, 'monthly')).toBe(0);
    expect(withholdingTax(30000, 'monthly')).toBe(1375.05);
    expect(withholdingTax(100000, 'monthly')).toBe(16875.05);
  });
  it('semi-monthly', () => {
    expect(withholdingTax(10417, 'semi_monthly')).toBe(0);
    expect(withholdingTax(23400, 'semi_monthly')).toBe(2284.1);
  });
});
