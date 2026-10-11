import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from './AuthContext.jsx'
import { useRefresh } from './RefreshContext.jsx'
import { makeFx, formatMoney, DISPLAY_CURRENCIES } from '../lib/fx.js'

// The EUR/GBP switch. Per device: it's a viewing preference, not data.
const CURRENCY_KEY = 'atlas:display-currency'
function loadDisplayCurrency() {
  try {
    const v = localStorage.getItem(CURRENCY_KEY)
    return DISPLAY_CURRENCIES.includes(v) ? v : 'EUR'
  } catch { return 'EUR' }
}

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function uid() { return crypto.randomUUID() }
// Local date — toISOString would give yesterday's date late in the evening.
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// Convert API pot row → internal shape (camelCase keys)
const potToInternal = (p) => ({
  id: p.id, name: p.name, color: p.color,
  targetAmount: p.target_amount, notes: p.notes, currency: p.currency || 'GBP',
  subGoals: (p.subGoals || []).map(sg => ({
    id: sg.id, name: sg.name, targetAmount: sg.target_amount, notes: sg.notes,
  })),
  deposits: (p.deposits || []).map(d => ({
    id: d.id, amount: d.amount, note: d.note, date: d.date,
  })),
})

const Ctx = createContext(null)

export function FinancesProvider({ children }) {
  const { token } = useAuth()
  // Bumped when the assistant mutates data via MCP, forcing a refetch.
  const { tick } = useRefresh()
  const [data, setData] = useState({ pots: [], transactions: [], accounts: [], rules: [] })
  const [insights, setInsights] = useState({ budgets: [], unbudgeted: [], recurring: [], surplus: {}, allocation: [] })
  const [fxRates, setFxRates] = useState({})
  const [displayCurrency, setDisplayCurrencyState] = useState(loadDisplayCurrency)
  const setDisplayCurrency = useCallback((c) => {
    setDisplayCurrencyState(c)
    try { localStorage.setItem(CURRENCY_KEY, c) } catch {}
  }, [])
  const fxTable = useMemo(() => makeFx(fxRates), [fxRates])

  const call = useCallback((path, opts = {}) => fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...opts,
  }), [token])

  // Insights are derived server-side from every transaction, so they are
  // refetched rather than recomputed whenever the ledger changes.
  // Insights come back already converted into the display currency.
  const refreshInsights = useCallback(async () => {
    const res = await call(`/api/finances/insights?currency=${displayCurrency}`)
    if (res.ok) setInsights(await res.json())
  }, [call, displayCurrency])

  // Rates for every currency in use; refetched after imports add new ones.
  const refreshFx = useCallback(async () => {
    const res = await call('/api/finances/fx')
    if (res.ok) setFxRates((await res.json()).rates || {})
  }, [call])

  useEffect(() => { if (token) refreshInsights() }, [token, tick, refreshInsights])
  useEffect(() => { if (token) refreshFx() }, [token, tick, refreshFx])

  useEffect(() => {
    call('/api/finances').then(r => r.json()).then(d => {
      setData({
        pots: d.pots.map(potToInternal),
        transactions: d.transactions,
        accounts: d.accounts,
        rules: d.rules || [],
      })
    })
  }, [token, tick])

  // ─── Pots ──────────────────────────────────────────────────────────────────
  // A pot keeps the currency it was created in (the display currency then).
  const addPot = useCallback(async (name, color, targetAmount, notes = '') => {
    const id = uid()
    const pot = { id, name, color, targetAmount: Number(targetAmount)||0, notes, currency: displayCurrency, subGoals: [], deposits: [] }
    setData(d => ({ ...d, pots: [...d.pots, pot] }))
    await call('/api/finances/pots', { method: 'POST', body: JSON.stringify({ id, name, color, target_amount: pot.targetAmount, notes, currency: displayCurrency }) })
  }, [call, displayCurrency])

  const removePot = useCallback(async (id) => {
    setData(d => ({ ...d, pots: d.pots.filter(p => p.id !== id) }))
    await call(`/api/finances/pots/${id}`, { method: 'DELETE' })
  }, [call])

  // ─── Sub-goals ─────────────────────────────────────────────────────────────
  const addSubGoal = useCallback(async (potId, name, targetAmount, notes = '') => {
    const id = uid()
    const sg = { id, name, targetAmount: Number(targetAmount)||0, notes }
    setData(d => ({ ...d, pots: d.pots.map(p => p.id === potId ? { ...p, subGoals: [...(p.subGoals||[]), sg] } : p) }))
    await call(`/api/finances/pots/${potId}/subgoals`, { method: 'POST', body: JSON.stringify({ id, name, target_amount: sg.targetAmount, notes }) })
  }, [call])

  const removeSubGoal = useCallback(async (potId, subId) => {
    setData(d => ({ ...d, pots: d.pots.map(p => p.id === potId ? { ...p, subGoals: (p.subGoals||[]).filter(s => s.id !== subId) } : p) }))
    await call(`/api/finances/pots/${potId}/subgoals/${subId}`, { method: 'DELETE' })
  }, [call])

  // ─── Deposits ──────────────────────────────────────────────────────────────
  const addDeposit = useCallback(async (potId, amount, note = '', date = today()) => {
    const id = uid()
    const dep = { id, amount: Number(amount), note, date }
    setData(d => ({ ...d, pots: d.pots.map(p => p.id === potId ? { ...p, deposits: [...(p.deposits||[]), dep] } : p) }))
    await call(`/api/finances/pots/${potId}/deposits`, { method: 'POST', body: JSON.stringify({ id, amount: dep.amount, note, date }) })
  }, [call])

  const removeDeposit = useCallback(async (potId, depositId) => {
    setData(d => ({ ...d, pots: d.pots.map(p => p.id === potId ? { ...p, deposits: (p.deposits||[]).filter(d => d.id !== depositId) } : p) }))
    await call(`/api/finances/pots/${potId}/deposits/${depositId}`, { method: 'DELETE' })
  }, [call])

  // ─── Transactions ──────────────────────────────────────────────────────────
  // Recorded in the account's currency; with no account, the display currency.
  const addTransaction = useCallback(async (merchant, category, amount, date, type, accountId = null) => {
    const id = uid()
    const account = data.accounts.find(a => a.id === accountId)
    const currency = account?.currency || displayCurrency
    const txn = { id, merchant, category, amount: Number(amount), date, type, account_id: account?.id ?? null, currency }
    setData(d => ({ ...d, transactions: [txn, ...d.transactions].sort((a, b) => (b.date || '').localeCompare(a.date || '')) }))
    await call('/api/finances/transactions', { method: 'POST', body: JSON.stringify(txn) })
    refreshInsights()
  }, [call, data.accounts, displayCurrency, refreshInsights])

  const setTransactionCategory = useCallback(async (id, category) => {
    setData(d => ({ ...d, transactions: d.transactions.map(t => t.id === id ? { ...t, category } : t) }))
    await call(`/api/finances/transactions/${id}`, { method: 'PATCH', body: JSON.stringify({ category }) })
    refreshInsights()
  }, [call, refreshInsights])

  const removeTransaction = useCallback(async (id) => {
    setData(d => ({ ...d, transactions: d.transactions.filter(t => t.id !== id) }))
    await call(`/api/finances/transactions/${id}`, { method: 'DELETE' })
  }, [call])

  // ─── Accounts ──────────────────────────────────────────────────────────────
  const addAccount = useCallback(async (name, institution, type, balance, currency = 'EUR') => {
    const id = uid()
    const acc = { id, name, institution, type, balance: Number(balance)||0, currency }
    setData(d => ({ ...d, accounts: [...d.accounts, acc] }))
    await call('/api/finances/accounts', { method: 'POST', body: JSON.stringify(acc) })
  }, [call])

  const updateAccount = useCallback(async (id, fields) => {
    // A balance typed in by hand is correct as of today (the server stamps it too).
    const local = 'balance' in fields ? { ...fields, balance_as_of: today() } : fields
    setData(d => ({ ...d, accounts: d.accounts.map(a => a.id === id ? { ...a, ...local } : a) }))
    await call(`/api/finances/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(fields) })
  }, [call])

  const removeAccount = useCallback(async (id) => {
    setData(d => ({ ...d, accounts: d.accounts.filter(a => a.id !== id) }))
    await call(`/api/finances/accounts/${id}`, { method: 'DELETE' })
  }, [call])

  const refetch = useCallback(async () => {
    const d = await call('/api/finances').then(r => r.json())
    setData({
      pots: d.pots.map(potToInternal),
      transactions: d.transactions,
      accounts: d.accounts,
      rules: d.rules || [],
    })
    await refreshInsights()
  }, [call, refreshInsights])

  // "Everything like this": saves a rule (so future imports are categorised
  // too) and applies it to existing uncategorised transactions now.
  const categoriseMatching = useCallback(async (pattern, category) => {
    const p = pattern.trim().toLowerCase()
    setData(d => ({ ...d, transactions: d.transactions.map(t =>
      !(t.category || '').trim() && (t.merchant || '').toLowerCase().includes(p) ? { ...t, category } : t) }))
    await call('/api/finances/rules', { method: 'POST', body: JSON.stringify({ id: uid(), pattern: p, category }) })
    const res = await call('/api/finances/rules/apply', { method: 'POST', body: JSON.stringify({ pattern: p, category }) })
    await refetch()
    return res.ok ? (await res.json()).updated : 0
  }, [call, refetch])

  // ─── Budgets ───────────────────────────────────────────────────────────────
  // Entered in the display currency, and kept in it.
  const setBudget = useCallback(async (category, amount) => {
    await call('/api/finances/budgets', {
      method: 'POST',
      body: JSON.stringify({ id: uid(), category, amount: Number(amount) || 0, period: 'monthly', currency: displayCurrency }),
    })
    await refreshInsights()
  }, [call, refreshInsights, displayCurrency])

  const removeBudget = useCallback(async (id) => {
    await call(`/api/finances/budgets/${id}`, { method: 'DELETE' })
    await refreshInsights()
  }, [call, refreshInsights])

  // Deliberately explicit: /insights only ever suggests an allocation, and this
  // is the separate call that actually writes the deposits.
  const allocateSurplus = useCallback(async (allocations, note) => {
    await call('/api/finances/allocate', {
      method: 'POST', body: JSON.stringify({ allocations, note, currency: displayCurrency }),
    })
    await refetch()
  }, [call, refetch, displayCurrency])

  // ─── Import rules ──────────────────────────────────────────────────────────
  const addRule = useCallback(async (pattern, category) => {
    const id = uid()
    setData(d => ({ ...d, rules: [...d.rules, { id, pattern, category }] }))
    await call('/api/finances/rules', { method: 'POST', body: JSON.stringify({ id, pattern, category }) })
  }, [call])

  const removeRule = useCallback(async (id) => {
    setData(d => ({ ...d, rules: d.rules.filter(r => r.id !== id) }))
    await call(`/api/finances/rules/${id}`, { method: 'DELETE' })
  }, [call])

  // ─── Statement import ──────────────────────────────────────────────────────
  // Two-step by design: preview never writes, so a wrong file or a wrong bank
  // profile costs nothing but a second click.
  const previewImport = useCallback(async (source, accountId, content) => {
    const res = await call('/api/finances/import/preview', {
      method: 'POST', body: JSON.stringify({ source, account_id: accountId, content }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.detail || 'Could not read that file')
    return body
  }, [call])

  // closingBalance comes from the preview; the server decides whether it
  // becomes the account's balance (same currency, not older than the current one).
  const commitImport = useCallback(async (source, accountId, rows, closingBalance = null) => {
    const res = await call('/api/finances/import/commit', {
      method: 'POST',
      body: JSON.stringify({ source, account_id: accountId, rows, closing_balance: closingBalance }),
    })
    const body = await res.json()
    if (!res.ok) {
      const detail = Array.isArray(body.detail) ? body.detail[0]?.msg : body.detail
      throw new Error(detail || `Import failed (${res.status})`)
    }
    await refetch()
    refreshFx()
    return body
  }, [call, refetch, refreshFx])

  // ─── Computed (all in the display currency) ────────────────────────────────
  // Balances convert at the latest rate; a transaction at the rate on its own
  // date, so past months don't drift as the exchange rate moves.
  const missingRates = new Set()
  const toDisplay = (amount, currency, on) => {
    const v = fxTable.convert(amount, currency || displayCurrency, displayCurrency, on)
    if (v == null) missingRates.add(currency)
    return v
  }
  const sumOf = (vals) => vals.reduce((s, v) => s + (v ?? 0), 0)
  const txnValue = (t) => toDisplay(t.amount, t.currency, t.date)

  const pots = data.pots.map(p => {
    const saved = (p.deposits||[]).reduce((s, d) => s + d.amount, 0)
    const pct = p.targetAmount > 0 ? Math.min(Math.round(saved / p.targetAmount * 100), 100) : 0
    return { ...p, saved, pct, savedDisplay: toDisplay(saved, p.currency), targetDisplay: toDisplay(p.targetAmount, p.currency) }
  })
  const accounts = data.accounts.map(a => ({ ...a, currency: a.currency || 'GBP', balanceDisplay: toDisplay(a.balance, a.currency || 'GBP') }))
  const netWorth = sumOf(accounts.map(a => a.balanceDisplay == null ? null : a.type === 'credit' ? -a.balanceDisplay : a.balanceDisplay))
  const totalSaved = sumOf(pots.map(p => p.savedDisplay))

  // Local month key, not toISOString — that shifts the boundary in UTC.
  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const inMonth = (t, m) => (t.date || '').slice(0, 7) === m

  const monthTxns = data.transactions.filter(t => inMonth(t, thisMonth))
  const sum = (rows, type) => sumOf(rows.filter(t => t.type === type).map(txnValue))

  const income   = sum(monthTxns, 'income')
  const spending = sum(monthTxns, 'expense')
  const incomeAllTime   = sum(data.transactions, 'income')
  const spendingAllTime = sum(data.transactions, 'expense')

  // Spend per category this month — the basis for budgets in a later phase.
  const byCategory = Object.entries(
    monthTxns.filter(t => t.type === 'expense').reduce((acc, t) => {
      const key = t.category || 'Uncategorised'
      acc[key] = (acc[key] || 0) + (txnValue(t) ?? 0)
      return acc
    }, {})
  ).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total)

  const fmt = useCallback((n, digits = 2) => formatMoney(n, displayCurrency, digits), [displayCurrency])

  return (
    <Ctx.Provider value={{
      pots, accounts, transactions: data.transactions, rules: data.rules,
      displayCurrency, setDisplayCurrency, fmt, toDisplay, txnValue, fx: fxTable,
      missingRates: [...missingRates].filter(Boolean),
      netWorth, totalSaved, income, spending,
      incomeAllTime, spendingAllTime, byCategory, thisMonth,
      addRule, removeRule, previewImport, commitImport, refetch,
      insights, setBudget, removeBudget, allocateSurplus, refreshInsights,
      addPot, removePot,
      addSubGoal, removeSubGoal,
      addDeposit, removeDeposit,
      addTransaction, removeTransaction, setTransactionCategory, categoriseMatching,
      addAccount, updateAccount, removeAccount,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useFinances = () => useContext(Ctx)
