// Currency conversion over ECB daily rates from /api/finances/fx, where
// rates[CUR] = [[date, rate], ...] means "1 EUR = rate CUR" on that date.
// Mirrors backend/fx.py: a date with no publication (weekends, holidays) uses
// the last rate before it; a date before the series uses its first rate.

export const DISPLAY_CURRENCIES = ['EUR', 'GBP']

export function makeFx(rates = {}) {
  const has = (cur) => cur === 'EUR' || (rates[cur]?.length > 0)

  const rate = (cur, on) => {
    if (cur === 'EUR') return 1
    const series = rates[cur]
    if (!series?.length) return null
    if (!on) return series[series.length - 1][1]
    // Binary search for the last entry with date <= on
    let lo = 0, hi = series.length - 1, found = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (series[mid][0] <= on) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    return series[found][1]
  }

  // null when either currency has no known rate — callers show "—" rather
  // than silently treating the amount as 1:1.
  const convert = (amount, from, to, on) => {
    const a = Number(amount) || 0
    if (!from || from === to) return a
    const rf = rate(from, on), rt = rate(to, on)
    if (rf == null || rt == null) return null
    return a / rf * rt
  }

  return { has, rate, convert }
}

const formatters = {}
export function formatMoney(n, currency = 'EUR', digits = 2) {
  if (n == null || Number.isNaN(n)) return '—'
  const key = `${currency}|${digits}`
  formatters[key] ??= new Intl.NumberFormat(currency === 'EUR' ? 'en-IE' : 'en-GB', {
    style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: digits === 0 ? 0 : undefined,
  })
  return formatters[key].format(n)
}

export const currencySymbol = (cur) => ({ EUR: '€', GBP: '£', USD: '$' }[cur] || cur)
