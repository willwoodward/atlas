import { describe, it, expect } from 'vitest'
import { curvePath, niceTicks } from '../../components/HistoryCharts.jsx'

describe('chart gridlines', () => {
  it('lands on round values', () => {
    expect(niceTicks(0, 100)).toEqual([0, 50, 100])
    expect(niceTicks(-1439, 3615)).toEqual([0, 2000])
    expect(Object.is(niceTicks(-1439, 3615)[0], -0)).toBe(false)
    expect(niceTicks(1880, 2010)).toEqual([1900, 1950, 2000])
  })
  it('counts step by whole numbers', () => {
    expect(niceTicks(0, 6, 3, true)).toEqual([0, 2, 4, 6])
    expect(niceTicks(0, 1.2, 3, true)).toEqual([0, 1])
  })
  it('copes with a flat line', () => {
    expect(niceTicks(5, 5)).toEqual([5])
  })
})

describe('smooth lines', () => {
  const ys = (d) => [...d.matchAll(/C[^,]+,([\d.-]+) [^,]+,([\d.-]+) /g)].flatMap(m => [Number(m[1]), Number(m[2])])
  it('passes through every point', () => {
    const d = curvePath([[0, 50], [10, 20], [20, 80]])
    expect(d.startsWith('M0,50')).toBe(true)
    expect(d).toContain(' 10,20')
    expect(d.endsWith('20,80')).toBe(true)
  })
  it('does not swing past its highest or lowest point', () => {
    // A sharp peak between flat neighbours would overshoot with a plain spline.
    const d = curvePath([[0, 100], [10, 100], [20, 0], [30, 0]])
    ys(d).forEach(y => { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(100) })
  })
  it('falls back to a straight line for two points', () => {
    expect(curvePath([[0, 1], [5, 2]])).toBe('M0,1L5,2')
  })
})
