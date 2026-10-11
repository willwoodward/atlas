import { describe, it, expect } from 'vitest'
import { makeFx, formatMoney } from '../fx.js'

const fx = makeFx({
  GBP: [['2026-04-02', 0.80], ['2026-04-03', 0.90]],
  USD: [['2026-04-03', 1.10]],
})

describe('fx', () => {
  it('uses the last published rate on or before a date', () => {
    expect(fx.rate('GBP', '2026-04-04')).toBe(0.90)  // Saturday → Friday
    expect(fx.rate('GBP', '2026-04-02')).toBe(0.80)
    expect(fx.rate('GBP', '2020-01-01')).toBe(0.80)  // before the series
    expect(fx.rate('GBP')).toBe(0.90)                // latest
    expect(fx.rate('EUR', '2026-04-02')).toBe(1)
  })
  it('converts through EUR, at the given date', () => {
    expect(fx.convert(90, 'GBP', 'EUR', '2026-04-03')).toBeCloseTo(100)
    expect(fx.convert(100, 'EUR', 'GBP', '2026-04-02')).toBeCloseTo(80)
    expect(fx.convert(90, 'GBP', 'USD', '2026-04-03')).toBeCloseTo(110)
    expect(fx.convert(12, 'GBP', 'GBP')).toBe(12)
  })
  it('returns null rather than guessing when a rate is unknown', () => {
    expect(fx.convert(5, 'JPY', 'EUR')).toBe(null)
    expect(makeFx({}).convert(5, 'GBP', 'EUR')).toBe(null)
  })
  it('formats per currency and shows a dash for unknown', () => {
    expect(formatMoney(1234.5, 'EUR')).toBe('€1,234.50')
    expect(formatMoney(1234.5, 'GBP', 0)).toBe('£1,235')
    expect(formatMoney(null, 'EUR')).toBe('—')
  })
})
