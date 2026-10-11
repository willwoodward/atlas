import { useState, useRef } from 'react'
import { useFinances } from '../context/FinancesContext.jsx'
import GoalRing from '../components/GoalRing.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'
import CompensationPanel from '../components/CompensationPanel.jsx'
import InsightsPanel from '../components/InsightsPanel.jsx'
import CategoryCharts from '../components/CategoryCharts.jsx'
import Sheet from '../components/Sheet.jsx'
import { suggestPattern, UNCATEGORISED } from '../lib/categories.js'
import { useQuickAdd } from '../context/QuickAddContext.jsx'
import { formatMoney, currencySymbol, DISPLAY_CURRENCIES } from '../lib/fx.js'

const PAL = ['#6f8168','#c15f3c','#5f7591','#b08a3e','#9a6d84','#c88a5f']

const ACCOUNT_CURRENCIES = ['EUR', 'GBP', 'USD']
const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Current / Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'investment', label: 'Investments' },
  { value: 'credit', label: 'Credit card' },
]
const TXN_PAGE = 10
const fmtDate = (iso) => iso ? new Date(iso + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// EUR | GBP switch for everything on the page (and the net worth on Home).
function CurrencySwitch() {
  const { displayCurrency, setDisplayCurrency } = useFinances()
  return (
    <div role="radiogroup" aria-label="Display currency"
      style={{ display: 'flex', gap: 3, padding: 3, background: 'var(--surface-2)', border: '1px solid var(--bd)', borderRadius: 10 }}>
      {DISPLAY_CURRENCIES.map(c => (
        <button key={c} role="radio" aria-checked={displayCurrency === c} onClick={() => setDisplayCurrency(c)}
          style={{ padding: '5px 11px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
            background: displayCurrency === c ? 'var(--surface)' : 'transparent',
            color: displayCurrency === c ? 'var(--ink)' : 'var(--muted)',
            boxShadow: displayCurrency === c ? '0 1px 3px var(--bd)' : 'none' }}>
          {currencySymbol(c)} {c}
        </button>
      ))}
    </div>
  )
}

// An amount in its own currency, with the display-currency value beside it
// when they differ ("£90.00 · ≈ €106.18").
function Money({ amount, currency, converted, sign = '', style }) {
  const { displayCurrency, fmt } = useFinances()
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', ...style }}>
      <span>{sign}{formatMoney(Math.abs(amount), currency)}</span>
      {currency !== displayCurrency && (
        <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11, fontWeight: 500, color: 'var(--muted)' }}>
          ≈ {converted == null ? '—' : `${sign}${fmt(Math.abs(converted))}`}
        </span>
      )}
    </span>
  )
}

// ─── Modals / inline forms ────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</span>
      {children}
    </label>
  )
}

const inp = { padding: '9px 12px', borderRadius: 9, border: '1.5px solid var(--bd-xl)', background: 'var(--surface-2)', fontSize: 14, fontFamily: 'inherit', color: 'var(--ink)', outline: 'none', width: '100%' }
const sel = { ...inp, cursor: 'pointer' }

// Every finance dialog is a Sheet: bottom sheet on a phone, dialog on a laptop.
function Modal({ title, onClose, children }) {
  return <Sheet title={title} onClose={onClose}>{children}</Sheet>
}

function PrimaryBtn({ children, ...props }) {
  return <button {...props} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: '#c15f3c', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', ...props.style }}>{children}</button>
}
function GhostBtn({ children, ...props }) {
  return <button {...props} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--bd-xl)', background: 'transparent', color: 'var(--mid)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', ...props.style }}>{children}</button>
}

// ─── Add Pot Modal ────────────────────────────────────────────────────────────

function AddPotModal({ onClose }) {
  const { addPot, displayCurrency } = useFinances()
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [color, setColor] = useState(PAL[0])
  const [notes, setNotes] = useState('')

  const submit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    addPot(name.trim(), color, target, notes.trim())
    onClose()
  }

  return (
    <Modal title="New savings pot" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Name"><input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Camping Gear" style={inp} /></Field>
        <Field label={`Target amount (${currencySymbol(displayCurrency)})`}><input type="number" min="0" step="0.01" value={target} onChange={e => setTarget(e.target.value)} placeholder="0.00" style={inp} /></Field>
        <Field label="Colour">
          <div style={{ display: 'flex', gap: 8 }}>
            {PAL.map(c => <button key={c} type="button" onClick={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: color === c ? '3px solid #2b2820' : '3px solid transparent', cursor: 'pointer', padding: 0 }} />)}
          </div>
        </Field>
        <Field label="Notes (optional)"><input value={notes} onChange={e => setNotes(e.target.value)} placeholder="What's this pot for?" style={inp} /></Field>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <GhostBtn type="button" onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn type="submit">Create pot</PrimaryBtn>
        </div>
      </form>
    </Modal>
  )
}

// ─── Pot detail / deposit / sub-goal panel ────────────────────────────────────

function PotPanel({ pot, onClose }) {
  const { addSubGoal, removeSubGoal, addDeposit, removeDeposit, removePot } = useFinances()
  const [subName, setSubName]     = useState('')
  const [subTarget, setSubTarget] = useState('')
  const [depAmt, setDepAmt]       = useState('')
  const [depNote, setDepNote]     = useState('')
  const [depDate, setDepDate]     = useState(localToday)
  const pfmt = (n) => formatMoney(n, pot.currency)
  const sym = currencySymbol(pot.currency)

  const handleAddSub = (e) => {
    e.preventDefault()
    if (!subName.trim()) return
    addSubGoal(pot.id, subName.trim(), subTarget)
    setSubName(''); setSubTarget('')
  }

  const handleDeposit = (e) => {
    e.preventDefault()
    if (!depAmt) return
    addDeposit(pot.id, depAmt, depNote.trim(), depDate)
    setDepAmt(''); setDepNote(''); setDepDate(localToday())
  }

  const totalSubTarget = (pot.subGoals || []).reduce((s, sg) => s + sg.targetAmount, 0)

  return (
    <Modal title={pot.name} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* Progress */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <GoalRing pct={pot.pct} color={pot.color} size={72} />
          <div>
            <div style={{ fontFamily: "'Newsreader', serif", fontSize: 28, fontWeight: 500, color: pot.color }}>{pfmt(pot.saved)}</div>
            {pot.targetAmount > 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>of {pfmt(pot.targetAmount)} target</div>}
            {pot.notes && <div style={{ marginTop: 6, fontSize: 13, color: 'var(--mid)', fontStyle: 'italic' }}>{pot.notes}</div>}
          </div>
        </div>

        {/* Sub-goals */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10 }}>Sub-goals {totalSubTarget > 0 && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {pfmt(totalSubTarget)} total</span>}</div>
          {(pot.subGoals || []).map(sg => (
            <div key={sg.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--bd-sm)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: pot.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13.5 }}>{sg.name}</span>
              {sg.targetAmount > 0 && <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>{pfmt(sg.targetAmount)}</span>}
              <button onClick={() => removeSubGoal(pot.id, sg.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>×</button>
            </div>
          ))}
          <form onSubmit={handleAddSub} style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <input value={subName} onChange={e => setSubName(e.target.value)} placeholder="Sub-goal name" style={{ ...inp, flex: '1 1 140px' }} />
            <input type="number" min="0" step="0.01" value={subTarget} onChange={e => setSubTarget(e.target.value)} placeholder={`${sym}0`} style={{ ...inp, flex: '0 0 80px' }} />
            <PrimaryBtn type="submit" style={{ padding: '9px 14px', fontSize: 13 }}>Add</PrimaryBtn>
          </form>
        </div>

        {/* Log deposit */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10 }}>Log deposit</div>
          <form onSubmit={handleDeposit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input type="number" min="0.01" step="0.01" value={depAmt} onChange={e => setDepAmt(e.target.value)} placeholder={`Amount (${sym})`} required style={{ ...inp, flex: '1 1 130px' }} />
              <input type="date" value={depDate} onChange={e => setDepDate(e.target.value)} style={{ ...inp, flex: '1 1 140px' }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={depNote} onChange={e => setDepNote(e.target.value)} placeholder="Note (optional)" style={{ ...inp, flex: 1 }} />
              <PrimaryBtn type="submit" style={{ fontSize: 13, padding: '9px 14px' }}>Log</PrimaryBtn>
            </div>
          </form>

          {/* Deposit history */}
          {(pot.deposits || []).length > 0 && (
            <div style={{ marginTop: 12, maxHeight: 160, overflowY: 'auto' }}>
              {[...(pot.deposits || [])].reverse().map(dep => (
                <div key={dep.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--bd-xs)' }}>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--mid)' }}>{dep.note || '—'}</span>
                  <span style={{ fontSize: 11, color: 'var(--faint)' }}>{dep.date}</span>
                  <span style={{ fontFamily: "'Newsreader', serif", fontSize: 14, fontWeight: 600, color: '#6f8168' }}>+{pfmt(dep.amount)}</span>
                  <button onClick={() => removeDeposit(pot.id, dep.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4, borderTop: '1px solid var(--bd-sm)' }}>
          <button onClick={() => { if (window.confirm(`Delete "${pot.name}"?`)) { removePot(pot.id); onClose() } }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c15f3c', fontSize: 13 }}>Delete pot</button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Add Transaction Modal ────────────────────────────────────────────────────

function AddTransactionModal({ onClose }) {
  const { addTransaction, accounts, displayCurrency } = useFinances()
  const [accountId, setAccountId] = useState(accounts[0]?.id || '')
  const currency = accounts.find(a => a.id === accountId)?.currency || displayCurrency
  const [merchant, setMerchant] = useState('')
  const [category, setCategory] = useState('')
  const [amount, setAmount]     = useState('')
  const [date, setDate]         = useState(localToday)
  const [type, setType]         = useState('expense')

  const submit = (e) => {
    e.preventDefault()
    if (!merchant.trim() || !amount) return
    addTransaction(merchant.trim(), category.trim(), amount, date, type, accountId || null)
    onClose()
  }

  return (
    <Modal title="Add transaction" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {['expense','income'].map(t => (
            <button key={t} type="button" onClick={() => setType(t)} style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, background: type === t ? (t === 'income' ? '#6f8168' : '#c15f3c') : 'var(--surface-3)', color: type === t ? '#fff' : 'var(--mid)', transition: 'all .12s' }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {accounts.length > 0 && (
          <Field label="Account">
            <select value={accountId} onChange={e => setAccountId(e.target.value)} style={sel}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </select>
          </Field>
        )}
        <Field label="Description / Merchant"><input autoFocus value={merchant} onChange={e => setMerchant(e.target.value)} placeholder={type === 'income' ? 'e.g. Salary' : 'e.g. Tesco'} style={inp} /></Field>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 130px' }}>
            <Field label={`Amount (${currencySymbol(currency)})`}><input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required style={inp} /></Field>
          </div>
          <div style={{ flex: '1 1 130px' }}>
            <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} style={sel} /></Field>
          </div>
        </div>
        <Field label="Category"><input value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Groceries" style={inp} /></Field>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <GhostBtn type="button" onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn type="submit">Add</PrimaryBtn>
        </div>
      </form>
    </Modal>
  )
}

// ─── Add Account Modal ────────────────────────────────────────────────────────

function AddAccountModal({ onClose }) {
  const { addAccount } = useFinances()
  const [name, setName]   = useState('')
  const [inst, setInst]   = useState('')
  const [type, setType]   = useState('checking')
  const [bal, setBal]     = useState('')
  const [currency, setCurrency] = useState('EUR')

  const submit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    addAccount(name.trim(), inst.trim(), type, bal, currency)
    onClose()
  }

  return (
    <Modal title="Add account" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Account name"><input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Current account" style={inp} /></Field>
        <Field label="Institution"><input value={inst} onChange={e => setInst(e.target.value)} placeholder="e.g. Monzo" style={inp} /></Field>
        <Field label="Type">
          <select value={type} onChange={e => setType(e.target.value)} style={sel}>
            <option value="checking">Current / Checking</option>
            <option value="savings">Savings</option>
            <option value="investment">Investments</option>
            <option value="credit">Credit card</option>
          </select>
        </Field>
        <Field label="Currency">
          <select value={currency} onChange={e => setCurrency(e.target.value)} style={sel}>
            {ACCOUNT_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label={`Current balance (${currencySymbol(currency)})`}><input type="number" step="0.01" value={bal} onChange={e => setBal(e.target.value)} placeholder="0.00" style={inp} /></Field>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <GhostBtn type="button" onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn type="submit">Add account</PrimaryBtn>
        </div>
      </form>
    </Modal>
  )
}

// ─── Category editor ──────────────────────────────────────────────────────────

function CategoryModal({ txn, onClose }) {
  const { transactions, setTransactionCategory, categoriseMatching } = useFinances()
  const [category, setCategory] = useState(txn.category || '')
  const [pattern, setPattern] = useState(suggestPattern(txn.merchant))
  // Defaults on for an uncategorised row: the usual case is "Tesco is groceries".
  const [applyAll, setApplyAll] = useState(!(txn.category || '').trim() || txn.category_source === 'ai')
  const [busy, setBusy] = useState(false)

  // Existing categories, most used first, as one-tap choices.
  const counts = {}
  for (const t of transactions) { const c = (t.category || '').trim(); if (c) counts[c] = (counts[c] || 0) + 1 }
  const known = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
  const p = pattern.trim().toLowerCase()
  const matches = p ? transactions.filter(t => t.id !== txn.id && (!(t.category || '').trim() || t.category_source === 'ai') && (t.merchant || '').toLowerCase().includes(p)).length : 0

  const save = async (e) => {
    e.preventDefault()
    const c = category.trim()
    if (!c) return
    setBusy(true)
    try {
      await setTransactionCategory(txn.id, c)
      if (applyAll && p) await categoriseMatching(p, c)
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <Modal title="Category" onClose={onClose}>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13.5, color: 'var(--mid)' }}>
          <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{txn.merchant}</strong> · {txn.date} · {formatMoney(txn.amount, txn.currency || 'GBP')}
        </div>
        <Field label="Category">
          <input autoFocus list="atlas-categories" value={category} onChange={e => setCategory(e.target.value)}
            placeholder="e.g. Groceries, Rent, Eating out" style={inp} />
          <datalist id="atlas-categories">{known.map(c => <option key={c} value={c} />)}</datalist>
        </Field>
        {known.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: -4 }}>
            {known.slice(0, 12).map(c => (
              <button key={c} type="button" onClick={() => setCategory(c)}
                style={{ padding: '4px 10px', borderRadius: 99, border: `1px solid ${category === c ? '#c15f3c' : 'var(--bd-xl)'}`, background: category === c ? 'rgba(193,95,60,.1)' : 'transparent',
                  color: category === c ? '#c15f3c' : 'var(--mid)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{c}</button>
            ))}
          </div>
        )}
        <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13, color: 'var(--mid)', lineHeight: 1.45, cursor: 'pointer' }}>
          <input type="checkbox" checked={applyAll} onChange={e => setApplyAll(e.target.checked)} style={{ marginTop: 3, width: 'auto' }} />
          <span>Also categorise other transactions containing{' '}
            <input value={pattern} onChange={e => setPattern(e.target.value)} onClick={e => e.preventDefault()}
              style={{ ...inp, display: 'inline-block', width: 130, padding: '3px 8px', fontSize: 12.5 }} />
            {' '}— {matches} uncategorised or auto-categorised now, and future imports.
          </span>
        </label>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <GhostBtn type="button" onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn type="submit" disabled={busy || !category.trim()} style={{ opacity: busy || !category.trim() ? .5 : 1 }}>{busy ? 'Saving…' : 'Save'}</PrimaryBtn>
        </div>
      </form>
    </Modal>
  )
}

// ─── Edit Account Modal ───────────────────────────────────────────────────────

function EditAccountModal({ account, onClose }) {
  const { updateAccount, removeAccount, transactions } = useFinances()
  const [name, setName] = useState(account.name)
  const [inst, setInst] = useState(account.institution || '')
  const [type, setType] = useState(account.type)
  const [currency, setCurrency] = useState(account.currency)
  const [bal, setBal] = useState(String(account.balance ?? 0))
  const txnCount = transactions.filter(t => t.account_id === account.id).length

  const submit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    const changes = {}
    if (name.trim() !== account.name) changes.name = name.trim()
    if (inst.trim() !== (account.institution || '')) changes.institution = inst.trim()
    if (type !== account.type) changes.type = type
    if (currency !== account.currency) changes.currency = currency
    if (Number(bal) !== Number(account.balance)) changes.balance = Number(bal) || 0
    if (Object.keys(changes).length) updateAccount(account.id, changes)
    onClose()
  }

  return (
    <Modal title="Edit account" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Account name"><input autoFocus value={name} onChange={e => setName(e.target.value)} style={inp} /></Field>
        <Field label="Institution"><input value={inst} onChange={e => setInst(e.target.value)} placeholder="e.g. Wise" style={inp} /></Field>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 150px' }}>
            <Field label="Type">
              <select value={type} onChange={e => setType(e.target.value)} style={sel}>
                {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ flex: '1 1 100px' }}>
            <Field label="Currency">
              <select value={currency} onChange={e => setCurrency(e.target.value)} style={sel}>
                {ACCOUNT_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
        </div>
        {currency !== account.currency && txnCount > 0 && (
          <div style={{ fontSize: 12, color: '#b08a3e', lineHeight: 1.5 }}>
            The {txnCount} transaction{txnCount !== 1 ? 's' : ''} already in this account keep the currency they were recorded in.
          </div>
        )}
        <Field label={`Current balance (${currencySymbol(currency)})`}>
          <input type="number" step="0.01" value={bal} onChange={e => setBal(e.target.value)} style={inp} />
        </Field>
        {account.balance_as_of && (
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -6 }}>Balance as of {fmtDate(account.balance_as_of)}. Importing a newer statement updates it.</div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
          <button type="button" onClick={() => { if (window.confirm(`Remove "${account.name}"?`)) { removeAccount(account.id); onClose() } }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c15f3c', fontSize: 13, fontFamily: 'inherit', padding: 0, marginRight: 'auto' }}>
            Remove account
          </button>
          <GhostBtn type="button" onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn type="submit">Save</PrimaryBtn>
        </div>
      </form>
    </Modal>
  )
}

// ─── Import statement modal ───────────────────────────────────────────────────
//
// Neither Barclays nor Wise exposes a usable read-only API for a UK personal
// account, so a CSV export is the ingest path. Two steps on purpose: the
// preview writes nothing, so picking the wrong file or the wrong bank costs a
// click rather than a corrupted ledger.

const SOURCES = [
  { id: 'barclays_csv', label: 'Barclays (CSV)' },
  { id: 'wise_csv',     label: 'Wise (CSV)' },
]

function ImportModal({ onClose }) {
  const { accounts, previewImport, commitImport, classifier } = useFinances()
  const [source, setSource]     = useState(SOURCES[0].id)
  const [accountId, setAccount] = useState(accounts[0]?.id || '')
  const [fileName, setFileName] = useState('')
  const [content, setContent]   = useState('')
  const [preview, setPreview]   = useState(null)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const [done, setDone]         = useState(null)

  const readFile = (file) => {
    if (!file) return
    setFileName(file.name)
    setError('')
    const reader = new FileReader()
    reader.onload = () => setContent(String(reader.result || ''))
    reader.onerror = () => setError('Could not read that file')
    reader.readAsText(file)
  }

  const runPreview = async () => {
    if (!content || !accountId) return
    setBusy(true); setError('')
    try {
      const result = await previewImport(source, accountId, content)
      setPreview(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const runCommit = async () => {
    setBusy(true)
    try {
      const fresh = preview.rows.filter(r => !r.duplicate)
      setDone(await commitImport(source, accountId, fresh, preview.closing_balance))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Modal title="Import complete" onClose={onClose}>
        <div style={{ fontSize: 14, color: 'var(--mid)', lineHeight: 1.6 }}>
          Added <strong style={{ color: 'var(--ink)' }}>{done.inserted}</strong> transaction{done.inserted !== 1 ? 's' : ''}.
          {done.auto_categorised > 0 && <> Auto-categorised <strong style={{ color: 'var(--ink)' }}>{done.auto_categorised}</strong> (marked ✦ — click one to correct it).</>}
          {done.auto_error && <div style={{ marginTop: 8, color: '#c15f3c' }}>Couldn't auto-categorise: {done.auto_error}. You can retry from the category charts.</div>}
          {done.skipped > 0 && <> Skipped {done.skipped} already imported.</>}
          {done.balance_updated && (
            <div style={{ marginTop: 8 }}>
              Balance updated to <strong style={{ color: 'var(--ink)' }}>{formatMoney(done.balance_updated.amount, done.balance_updated.currency)}</strong>, as of {fmtDate(done.balance_updated.date)}.
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <PrimaryBtn onClick={onClose}>Done</PrimaryBtn>
        </div>
      </Modal>
    )
  }

  if (accounts.length === 0) {
    return (
      <Modal title="Import statement" onClose={onClose}>
        <div style={{ fontSize: 14, color: 'var(--mid)', lineHeight: 1.6 }}>
          Add an account first — imported transactions are filed against one, so
          balances and history stay tied together.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <GhostBtn onClick={onClose}>Close</GhostBtn>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Import statement" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 150px' }}>
            <Field label="Account">
              <select value={accountId} onChange={e => { setAccount(e.target.value); setPreview(null) }} style={sel}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <Field label="Format">
              <select value={source} onChange={e => { setSource(e.target.value); setPreview(null) }} style={sel}>
                {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <Field label="Statement file">
          <label style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, color: fileName ? 'var(--ink)' : 'var(--faint)' }}>
            <input type="file" accept=".csv,text/csv" style={{ display: 'none' }}
              onChange={e => { readFile(e.target.files?.[0]); setPreview(null) }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fileName || 'Choose a CSV export…'}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#c15f3c' }}>Browse</span>
          </label>
        </Field>

        {error && (
          <div style={{ fontSize: 13, color: '#c15f3c', background: 'var(--surface-2)', borderRadius: 9, padding: '10px 12px' }}>{error}</div>
        )}

        {!preview && (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <GhostBtn type="button" onClick={onClose}>Cancel</GhostBtn>
            <PrimaryBtn onClick={runPreview} disabled={!content || busy} style={{ opacity: !content || busy ? .5 : 1 }}>
              {busy ? 'Reading…' : 'Preview'}
            </PrimaryBtn>
          </div>
        )}

        {preview && (
          <>
            <div style={{ display: 'flex', gap: 18, fontSize: 13, color: 'var(--mid)', paddingTop: 2 }}>
              <span><strong style={{ color: '#6f8168', fontSize: 15 }}>{preview.new_count}</strong> new</span>
              <span><strong style={{ color: 'var(--muted)', fontSize: 15 }}>{preview.duplicate_count}</strong> already imported</span>
            </div>

            {preview.closing_balance && (
              <div style={{ fontSize: 12.5, color: 'var(--mid)', background: 'var(--surface-2)', borderRadius: 9, padding: '10px 12px', lineHeight: 1.55 }}>
                Closing balance <strong style={{ color: 'var(--ink)' }}>{formatMoney(preview.closing_balance.amount, preview.closing_balance.currency)}</strong> on {fmtDate(preview.closing_balance.date)}.{' '}
                {preview.balance_update.will_update
                  ? <>This will become the account's balance.</>
                  : <>The account's balance won't change: {preview.balance_update.reason}</>}
              </div>
            )}

            {preview.currencies.length > 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--mid)', background: 'var(--surface-2)', borderRadius: 9, padding: '10px 12px', lineHeight: 1.55 }}>
                Rows in {preview.currencies.join(', ')} will be stored in {preview.account_currency} (this account's currency),
                converted at the ECB rate on each transaction's date. The original amount is kept too.
              </div>
            )}

            <div style={{ maxHeight: 260, overflowY: 'auto', borderTop: '1px solid var(--bd-sm)' }}>
              {preview.rows.map(r => (
                <div key={r.external_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--bd-xs)', opacity: r.duplicate ? .4 : 1 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none', background: r.type === 'income' ? '#6f8168' : '#c15f3c' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.merchant}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {r.date}{r.category ? ` · ${r.category}` : ''}{r.duplicate ? ' · already imported' : ''}
                    </div>
                  </div>
                  <div style={{ fontFamily: "'Newsreader', serif", fontSize: 14, fontWeight: 600, flex: 'none' }}>
                    {r.type === 'income' ? '+' : '−'}{formatMoney(r.amount, r.currency)}
                    {r.converted_amount != null && <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11, fontWeight: 500, color: 'var(--muted)', textAlign: 'right' }}>→ {formatMoney(r.converted_amount, preview.account_currency)}</div>}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <GhostBtn type="button" onClick={() => setPreview(null)}>Back</GhostBtn>
              <PrimaryBtn onClick={runCommit} disabled={busy || preview.new_count === 0}
                style={{ opacity: busy || preview.new_count === 0 ? .5 : 1 }}>
                {busy ? (classifier.configured ? 'Importing & categorising…' : 'Importing…') : `Import ${preview.new_count}`}
              </PrimaryBtn>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ─── Account type colours ─────────────────────────────────────────────────────

const ACC_COLOR = { checking: '#6f8168', savings: '#5f7591', investment: '#b08a3e', credit: '#c15f3c' }

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FinancesPage() {
  const isMobile = useIsMobile()
  const { pots, accounts, transactions, netWorth, income, spending, totalSaved, fmt, txnValue, displayCurrency, missingRates } = useFinances()
  const [showAddPot, setShowAddPot]         = useState(false)
  const [showAddTxn, setShowAddTxn]         = useState(false)
  const [showAddAcc, setShowAddAcc]         = useState(false)
  const [showImport, setShowImport]         = useState(false)
  useQuickAdd('Import', () => setShowImport(true))
  const [activePot, setActivePot]           = useState(null)
  const [editAccount, setEditAccount]       = useState(null)
  const [txnPage, setTxnPage]               = useState(0)
  const [catTxn, setCatTxn]                 = useState(null)
  // Set by clicking a chart slice: { type, label, categories, range }
  const [txnFilter, setTxnFilter]           = useState(null)
  const txnCardRef = useRef(null)

  const { removeTransaction } = useFinances()
  // Clamped, so deleting the last row on the final page, or a smaller ledger
  // after a refresh, never leaves an empty page showing.
  // A chart slice sets type + period; the category picker sets neither, so it
  // shows money in and out for that category across all time.
  const shown = txnFilter
    ? transactions.filter(t => (!txnFilter.type || t.type === txnFilter.type)
        && txnFilter.categories.includes((t.category || '').trim() || UNCATEGORISED)
        && (!txnFilter.range?.from || t.date >= txnFilter.range.from)
        && (!txnFilter.range?.to || t.date <= txnFilter.range.to))
    : transactions
  // Categories in use, most transactions first, for the picker.
  const categoryCounts = transactions.reduce((m, t) => {
    const c = (t.category || '').trim() || UNCATEGORISED
    m.set(c, (m.get(c) || 0) + 1)
    return m
  }, new Map())
  const pickerOptions = [...categoryCounts].filter(([c]) => c !== UNCATEGORISED).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const pickCategory = (c) => {
    setTxnPage(0)
    setTxnFilter(c ? { type: null, label: c, categories: [c], range: null } : null)
  }
  const filterBy = (f) => {
    setTxnFilter(f); setTxnPage(0)
    txnCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // "Oct 2026" / "Aug – Oct 2026"; nothing for all time.
  const rangeLabel = (range) => {
    if (!range?.from) return ''
    const m = (d) => new Date(d + 'T12:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    return m(range.from) === m(range.to) ? m(range.from) : `${m(range.from).split(' ')[0]} – ${m(range.to)}`
  }
  const pageCount = Math.max(1, Math.ceil(shown.length / TXN_PAGE))
  const page = Math.min(txnPage, pageCount - 1)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: isMobile ? 26 : 34, fontWeight: 500 }}>Finances</h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--mid)' }}>Net worth, cashflow, and savings pots.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
          <CurrencySwitch />
          <GhostBtn onClick={() => setShowAddAcc(true)} style={{ fontSize: 13, padding: '8px 14px' }}>+ Account</GhostBtn>
          <GhostBtn onClick={() => setShowAddTxn(true)} style={{ fontSize: 13, padding: '8px 14px' }}>+ Transaction</GhostBtn>
          <PrimaryBtn onClick={() => setShowAddPot(true)} style={{ fontSize: 13, padding: '8px 14px' }}>+ Pot</PrimaryBtn>
        </div>
      </div>

      {missingRates.length > 0 && (
        <div style={{ fontSize: 13, color: '#c15f3c', background: 'rgba(193,95,60,.08)', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
          No exchange rate available yet for {missingRates.join(', ')} — those amounts are left out of the {displayCurrency} totals.
        </div>
      )}

      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : '1.3fr 1fr 1fr 1fr', gap: isMobile ? 10 : 14, marginBottom: 24 }}>
        <div style={{ background: 'var(--ink)', borderRadius: 16, padding: '20px 22px', color: 'var(--surface-2)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }}>Net worth</div>
          <div style={{ marginTop: 6, fontFamily: "'Newsreader', serif", fontSize: isMobile ? 22 : 32, fontWeight: 500 }}>{accounts.length > 0 ? fmt(netWorth) : '—'}</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '20px 22px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>Income · last 30 days</div>
          <div style={{ marginTop: 6, fontFamily: "'Newsreader', serif", fontSize: isMobile ? 20 : 26, fontWeight: 500 }}>{income > 0 ? fmt(income) : '—'}</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '20px 22px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>Spending · last 30 days</div>
          <div style={{ marginTop: 6, fontFamily: "'Newsreader', serif", fontSize: isMobile ? 20 : 26, fontWeight: 500, color: spending > 0 ? '#c15f3c' : 'var(--ink)' }}>{spending > 0 ? fmt(spending) : '—'}</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '20px 22px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>In pots</div>
          <div style={{ marginTop: 6, fontFamily: "'Newsreader', serif", fontSize: isMobile ? 20 : 26, fontWeight: 500, color: totalSaved > 0 ? '#6f8168' : 'var(--ink)' }}>{totalSaved > 0 ? fmt(totalSaved) : '—'}</div>
        </div>
      </div>

      {/* Where the money goes — right under the headline figures */}
      <div style={{ marginBottom: 16 }}>
        <CategoryCharts selected={txnFilter} onSelect={filterBy} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.2fr 1fr', gap: 16, alignItems: 'start' }}>

        {/* LEFT col: Savings pots + Accounts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Savings pots */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 19, fontWeight: 600 }}>Savings pots</h2>
              <button onClick={() => setShowAddPot(true)} style={{ fontSize: 12, fontWeight: 600, color: '#c15f3c', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>+ New pot</button>
            </div>

            {pots.length === 0 && (
              <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--faint)' }}>No pots yet — create one to start saving towards something specific.</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pots.map(pot => (
                <div
                  key={pot.id}
                  onClick={() => setActivePot(pot)}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', borderRadius: 12, background: 'var(--surface-2)', cursor: 'pointer', transition: 'background .12s' }}
                >
                  {/* Ring */}
                  <div style={{ position: 'relative', width: 52, height: 52, flex: 'none' }}>
                    <svg viewBox="0 0 52 52" style={{ transform: 'rotate(-90deg)', width: 52, height: 52 }}>
                      <circle cx="26" cy="26" r="21" fill="none" stroke="var(--surface-3)" strokeWidth="5.5" />
                      <circle cx="26" cy="26" r="21" fill="none" stroke={pot.color} strokeWidth="5.5" strokeLinecap="round"
                        strokeDasharray={`${(2 * Math.PI * 21 * pot.pct / 100).toFixed(1)} ${(2 * Math.PI * 21).toFixed(1)}`} />
                    </svg>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Newsreader', serif", fontSize: 12, fontWeight: 600 }}>{pot.pct}%</div>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 2 }}>{pot.name}</div>
                    {(pot.subGoals || []).length > 0 && (
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>{(pot.subGoals || []).length} sub-goal{(pot.subGoals || []).length !== 1 ? 's' : ''}</div>
                    )}
                    <div style={{ height: 5, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden', marginTop: 4 }}>
                      <div style={{ height: '100%', borderRadius: 99, background: pot.color, width: `${pot.pct}%`, transition: 'width .4s' }} />
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: "'Newsreader', serif", fontSize: 16, fontWeight: 600, color: pot.color }}>{fmt(pot.savedDisplay)}</div>
                    {pot.targetAmount > 0 && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>of {fmt(pot.targetDisplay)}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Accounts */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 19, fontWeight: 600 }}>Accounts</h2>
              <button onClick={() => setShowAddAcc(true)} style={{ fontSize: 12, fontWeight: 600, color: '#c15f3c', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>+ Add</button>
            </div>
            {accounts.length === 0 && <div style={{ padding: '16px 0', fontSize: 13, color: 'var(--faint)', textAlign: 'center' }}>No accounts yet</div>}
            {accounts.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: '1px solid var(--bd-xs)' }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: ACC_COLOR[a.type] || 'var(--muted)', flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <button onClick={() => setEditAccount(a)} title="Edit account"
                    style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', textDecoration: 'underline', textDecorationColor: 'var(--bd-xl)', textUnderlineOffset: 3 }}>
                    {a.name}
                  </button>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    {a.institution ? `${a.institution} · ` : ''}{ACCOUNT_TYPES.find(t => t.value === a.type)?.label || a.type} · {a.currency}
                    {a.balance_as_of && <> · as of {fmtDate(a.balance_as_of)}</>}
                  </div>
                </div>
                <Money amount={a.balance} currency={a.currency} converted={a.balanceDisplay} sign={a.type === 'credit' ? '−' : ''}
                  style={{ fontFamily: "'Newsreader', serif", fontSize: 15, fontWeight: 600, color: a.type === 'credit' ? '#c15f3c' : 'var(--ink)' }} />
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT col: Transactions + compensation */}
        <div ref={txnCardRef} style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '20px 24px', scrollMarginTop: 90 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 19, fontWeight: 600 }}>Transactions</h2>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {transactions.length > 0 && (
              <select aria-label="Filter by category"
                value={txnFilter && !txnFilter.type && txnFilter.categories.length === 1 ? txnFilter.categories[0] : ''}
                onChange={e => pickCategory(e.target.value)}
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--mid)', background: 'var(--surface-2)', border: '1px solid var(--bd-xl)', borderRadius: 7, padding: '3px 6px', fontFamily: 'inherit', cursor: 'pointer', maxWidth: 150 }}>
                <option value="">All categories</option>
                {pickerOptions.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
                {categoryCounts.has(UNCATEGORISED) && <option value={UNCATEGORISED}>Uncategorised ({categoryCounts.get(UNCATEGORISED)})</option>}
              </select>
            )}
            <button onClick={() => setShowImport(true)} style={{ fontSize: 12, fontWeight: 600, color: 'var(--mid)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Import</button>
            <button onClick={() => setShowAddTxn(true)} style={{ fontSize: 12, fontWeight: 600, color: '#c15f3c', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>+ Add</button>
            </div>
          </div>
          {txnFilter && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 11px', borderRadius: 99, background: 'var(--surface-2)', border: '1px solid var(--bd-xl)', fontSize: 12.5, color: 'var(--ink)' }}>
                {txnFilter.label}{txnFilter.type ? ` · ${txnFilter.type === 'income' ? 'income' : 'spending'}` : ''}{rangeLabel(txnFilter.range) && ` · ${rangeLabel(txnFilter.range)}`}
                <button onClick={() => { setTxnFilter(null); setTxnPage(0) }} aria-label="Clear filter"
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, lineHeight: 1, padding: '0 4px' }}>×</button>
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {shown.length} transaction{shown.length !== 1 ? 's' : ''}
                {/* Net total for the filter, in the display currency */}
                {shown.length > 0 && (() => {
                  const net = shown.reduce((s, t) => s + (t.type === 'income' ? 1 : -1) * (txnValue(t) ?? 0), 0)
                  const allIn = shown.every(t => t.type === 'income'), allOut = shown.every(t => t.type !== 'income')
                  return <> · {allIn || allOut ? '' : net >= 0 ? '+' : '−'}{fmt(Math.abs(net))} {allIn ? 'in' : allOut ? 'out' : 'net'}</>
                })()}
              </span>
            </div>
          )}
          {transactions.length === 0 && <div style={{ padding: '24px 0', fontSize: 13, color: 'var(--faint)', textAlign: 'center' }}>No transactions yet</div>}
          {transactions.length > 0 && shown.length === 0 && <div style={{ padding: '24px 0', fontSize: 13, color: 'var(--faint)', textAlign: 'center' }}>All done — nothing left here.</div>}
          {shown.slice(page * TXN_PAGE, (page + 1) * TXN_PAGE).map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--bd-xs)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.type === 'income' ? '#6f8168' : '#c15f3c', flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{t.merchant}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  <button onClick={() => setCatTxn(t)} title="Set category"
                    style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5,
                      color: t.category ? 'var(--mid)' : '#c15f3c', fontWeight: t.category ? 500 : 600, textDecoration: 'underline', textDecorationColor: 'var(--bd-xl)', textUnderlineOffset: 2 }}>
                    {t.category || '+ Category'}
                  </button>
                  {t.category_source === 'ai' && (
                    <span title="Categorised automatically — click the category to correct it" style={{ marginLeft: 3, color: '#b08a3e', cursor: 'help' }}>✦</span>
                  )}
                  {' · '}{t.date}
                  {t.orig_currency && <> · was {formatMoney(t.orig_amount, t.orig_currency)}</>}
                </div>
              </div>
              <Money amount={t.amount} currency={t.currency || 'GBP'} converted={txnValue(t)} sign={t.type === 'income' ? '+' : '−'}
                style={{ fontFamily: "'Newsreader', serif", fontSize: 14.5, fontWeight: 600, color: t.type === 'income' ? '#6f8168' : 'var(--ink)' }} />
              <button onClick={() => removeTransaction(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>×</button>
            </div>
          ))}
          {pageCount > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--bd-xs)', fontSize: 12.5, color: 'var(--muted)' }}>
              <span>{page * TXN_PAGE + 1}–{Math.min((page + 1) * TXN_PAGE, shown.length)} of {shown.length}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <GhostBtn onClick={() => setTxnPage(page - 1)} disabled={page === 0} aria-label="Newer transactions"
                  style={{ padding: '5px 12px', fontSize: 12.5, opacity: page === 0 ? .4 : 1 }}>‹ Newer</GhostBtn>
                <GhostBtn onClick={() => setTxnPage(page + 1)} disabled={page >= pageCount - 1} aria-label="Older transactions"
                  style={{ padding: '5px 12px', fontSize: 12.5, opacity: page >= pageCount - 1 ? .4 : 1 }}>Older ›</GhostBtn>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <InsightsPanel />
      </div>

      <div style={{ marginTop: 16 }}>
        <CompensationPanel />
      </div>

      {/* Modals */}
      {showAddPot && <AddPotModal onClose={() => setShowAddPot(false)} />}
      {showAddTxn && <AddTransactionModal onClose={() => setShowAddTxn(false)} />}
      {showAddAcc && <AddAccountModal onClose={() => setShowAddAcc(false)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
      {catTxn && <CategoryModal txn={transactions.find(t => t.id === catTxn.id) || catTxn} onClose={() => setCatTxn(null)} />}
      {editAccount && <EditAccountModal account={accounts.find(a => a.id === editAccount.id) || editAccount} onClose={() => setEditAccount(null)} />}
      {activePot  && <PotPanel pot={pots.find(p => p.id === activePot.id) || activePot} onClose={() => setActivePot(null)} />}
    </div>
  )
}
