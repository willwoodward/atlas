import { describe, it, expect } from 'vitest'
import { periodRange, categoryTotals, colorMap, slices, suggestPattern, UNCATEGORISED, OTHER, OTHER_COLOR } from '../categories.js'

const t = (category, amount, date = '2026-10-05', type = 'expense') => ({ category, amount, date, type })
const value = (x) => x.amount

describe('periods', () => {
  const now = new Date(2026, 0, 15) // 15 Jan 2026
  it('handles month and year boundaries', () => {
    expect(periodRange('month', now)).toEqual({ from: '2026-01-01', to: '2026-01-31' })
    expect(periodRange('last-month', now)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(periodRange('3m', now)).toEqual({ from: '2025-11-01', to: '2026-01-31' })
    expect(periodRange('year', now)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(periodRange('all', now)).toEqual({ from: null, to: null })
    expect(periodRange('month', new Date(2028, 1, 10)).to).toBe('2028-02-29') // leap year
    expect(periodRange('30d', now)).toEqual({ from: '2025-12-17', to: '2026-01-15' }) // rolls back over the year
    expect(periodRange('30d', new Date(2026, 2, 1))).toEqual({ from: '2026-01-31', to: '2026-03-01' })
  })
})

describe('category totals', () => {
  const txns = [
    t('Groceries', 30), t('Groceries', 20), t('', 5), t('Rent', 900),
    t('Transfer', 200), t('Salary', 3000, '2026-10-01', 'income'),
    t('Groceries', 40, '2026-09-30'),
  ]
  it('sums by category, largest first, within the period and type', () => {
    expect(categoryTotals(txns, 'expense', value, periodRange('month', new Date(2026, 9, 11)))).toEqual([
      { category: 'Rent', total: 900 }, { category: 'Transfer', total: 200 },
      { category: 'Groceries', total: 50 }, { category: UNCATEGORISED, total: 5 },
    ])
  })
  it('skips amounts that could not be converted', () => {
    expect(categoryTotals([t('A', 5), t('B', 7)], 'expense', x => x.category === 'A' ? null : x.amount)).toEqual([{ category: 'B', total: 7 }])
  })
})

describe('colours and slices', () => {
  const many = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c, i) => t(c, 100 - i * 10))
  it('gives the five biggest categories (all time) a fixed colour', () => {
    const colors = colorMap(many, 'expense', value)
    expect([...colors.keys()]).toEqual(['A', 'B', 'C', 'D', 'E', UNCATEGORISED])
  })
  it('folds the rest into Other and keeps Uncategorised separate', () => {
    const colors = colorMap(many, 'expense', value)
    const s = slices(categoryTotals([...many, t('', 3)], 'expense', value), colors)
    expect(s.map(x => x.category)).toEqual(['A', 'B', 'C', 'D', 'E', UNCATEGORISED, OTHER])
    expect(s.at(-1)).toMatchObject({ total: 50 + 40, color: OTHER_COLOR, members: ['F', 'G'] })
  })
})

describe('a category that is big this period but small overall', () => {
  // Giving is tiny all-time (not in the top five) but the biggest thing this month.
  const history = ['A', 'B', 'C', 'D', 'E'].map((c, i) => t(c, 1000 - i * 100, '2026-01-10'))
  const all = [...history, t('Giving', 40, '2026-02-01'), t('Giving', 300, '2026-10-05'), t('A', 20, '2026-10-06'), t('B', 10, '2026-10-07')]
  const colors = colorMap(all, 'expense', value)
  it('has no colour of its own overall', () => {
    expect(colors.has('Giving')).toBe(false)
  })
  it('still gets its own slice, not a place in Other', () => {
    const s = slices(categoryTotals(all, 'expense', value, periodRange('month', new Date(2026, 9, 11))), colors)
    expect(s.map(x => x.category)).toEqual(['Giving', 'A', 'B'])
    expect(s.find(x => x.category === OTHER)).toBeUndefined()
  })
  it('keeps the colours of the others and never reuses one on screen', () => {
    const s = slices(categoryTotals(all, 'expense', value, periodRange('month', new Date(2026, 9, 11))), colors)
    expect(s.find(x => x.category === 'A').color).toBe(colors.get('A'))
    expect(s.find(x => x.category === 'B').color).toBe(colors.get('B'))
    expect(new Set(s.map(x => x.color)).size).toBe(3)
  })
  it('in a period with more than five categories, the smallest fold into Other', () => {
    const s = slices(categoryTotals(all, 'expense', value), colors)
    expect(s.length).toBe(6)
    expect(s.at(-1)).toMatchObject({ category: OTHER, members: ['Giving'] })
  })
})

describe('suggested patterns', () => {
  it('uses the first distinctive word', () => {
    expect(suggestPattern('Tesco Stores Plc BEGGARS BUSH')).toBe('tesco')
    expect(suggestPattern('Pret A Manger DUBLIN')).toBe('pret')
    expect(suggestPattern('TFL Travel Charge')).toBe('tfl travel')
    expect(suggestPattern('Sumup  *South African Dublin')).toBe('sumup')
    expect(suggestPattern('')).toBe('')
  })
})
