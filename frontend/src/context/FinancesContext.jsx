import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function uid() { return crypto.randomUUID() }
function today() { return new Date().toISOString().slice(0, 10) }

// Convert API pot row → internal shape (camelCase keys)
const potToInternal = (p) => ({
  id: p.id, name: p.name, color: p.color,
  targetAmount: p.target_amount, notes: p.notes,
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
  const [data, setData] = useState({ pots: [], transactions: [], accounts: [] })

  const call = useCallback((path, opts = {}) => fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...opts,
  }), [token])

  useEffect(() => {
    call('/api/finances').then(r => r.json()).then(d => {
      setData({ pots: d.pots.map(potToInternal), transactions: d.transactions, accounts: d.accounts })
    })
  }, [token])

  // ─── Pots ──────────────────────────────────────────────────────────────────
  const addPot = useCallback(async (name, color, targetAmount, notes = '') => {
    const id = uid()
    const pot = { id, name, color, targetAmount: Number(targetAmount)||0, notes, subGoals: [], deposits: [] }
    setData(d => ({ ...d, pots: [...d.pots, pot] }))
    await call('/api/finances/pots', { method: 'POST', body: JSON.stringify({ id, name, color, target_amount: pot.targetAmount, notes }) })
  }, [call])

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
  const addTransaction = useCallback(async (merchant, category, amount, date, type) => {
    const id = uid()
    const txn = { id, merchant, category, amount: Number(amount), date, type }
    setData(d => ({ ...d, transactions: [txn, ...d.transactions] }))
    await call('/api/finances/transactions', { method: 'POST', body: JSON.stringify(txn) })
  }, [call])

  const removeTransaction = useCallback(async (id) => {
    setData(d => ({ ...d, transactions: d.transactions.filter(t => t.id !== id) }))
    await call(`/api/finances/transactions/${id}`, { method: 'DELETE' })
  }, [call])

  // ─── Accounts ──────────────────────────────────────────────────────────────
  const addAccount = useCallback(async (name, institution, type, balance) => {
    const id = uid()
    const acc = { id, name, institution, type, balance: Number(balance)||0 }
    setData(d => ({ ...d, accounts: [...d.accounts, acc] }))
    await call('/api/finances/accounts', { method: 'POST', body: JSON.stringify(acc) })
  }, [call])

  const updateAccount = useCallback(async (id, fields) => {
    setData(d => ({ ...d, accounts: d.accounts.map(a => a.id === id ? { ...a, ...fields } : a) }))
    await call(`/api/finances/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(fields) })
  }, [call])

  const removeAccount = useCallback(async (id) => {
    setData(d => ({ ...d, accounts: d.accounts.filter(a => a.id !== id) }))
    await call(`/api/finances/accounts/${id}`, { method: 'DELETE' })
  }, [call])

  // ─── Computed ──────────────────────────────────────────────────────────────
  const pots = data.pots.map(p => {
    const saved = (p.deposits||[]).reduce((s, d) => s + d.amount, 0)
    const pct = p.targetAmount > 0 ? Math.min(Math.round(saved / p.targetAmount * 100), 100) : 0
    return { ...p, saved, pct }
  })
  const netWorth = data.accounts.reduce((s, a) => a.type === 'credit' ? s - a.balance : s + a.balance, 0)
  const totalSaved = pots.reduce((s, p) => s + p.saved, 0)
  const income   = data.transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const spending = data.transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

  return (
    <Ctx.Provider value={{
      pots, accounts: data.accounts, transactions: data.transactions,
      netWorth, totalSaved, income, spending,
      addPot, removePot,
      addSubGoal, removeSubGoal,
      addDeposit, removeDeposit,
      addTransaction, removeTransaction,
      addAccount, updateAccount, removeAccount,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useFinances = () => useContext(Ctx)
