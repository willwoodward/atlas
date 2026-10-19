import { describe, it, expect } from 'vitest'
import { niceTicks } from '../../components/HistoryCharts.jsx'

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
