import { useState } from 'react'
import { useFinances } from '../context/FinancesContext.jsx'
import GoalRing from '../components/GoalRing.jsx'

const PAL = ['#6f8168','#c15f3c','#5f7591','#b08a3e','#9a6d84','#c88a5f']

const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n)
const fmtAbs = (n) => fmt(Math.abs(n))

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

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(43,40,32,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', borderRadius: 20, padding: 28, width: 440, maxWidth: '90vw', boxShadow: '0 24px 60px rgba(43,40,32,.22)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <h3 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 22, fontWeight: 600 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function PrimaryBtn({ children, ...props }) {
  return <button {...props} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: '#c15f3c', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', ...props.style }}>{children}</button>
}
function GhostBtn({ children, ...props }) {
  return <button {...props} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--bd-xl)', background: 'transparent', color: 'var(--mid)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', ...props.style }}>{children}</button>
}

// ─── Add Pot Modal ────────────────────────────────────────────────────────────

function AddPotModal({ onClose }) {
  const { addPot } = useFinances()
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
        <Field label="Target amount (£)"><input type="number" min="0" step="0.01" value={target} onChange={e => setTarget(e.target.value)} placeholder="0.00" style={inp} /></Field>
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
  const [depDate, setDepDate]     = useState(new Date().toISOString().slice(0, 10))

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
    setDepAmt(''); setDepNote(''); setDepDate(new Date().toISOString().slice(0, 10))
  }

  const totalSubTarget = (pot.subGoals || []).reduce((s, sg) => s + sg.targetAmount, 0)

  return (
    <Modal title={pot.name} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* Progress */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <GoalRing pct={pot.pct} color={pot.color} size={72} />
          <div>
            <div style={{ fontFamily: "'Newsreader', serif", fontSize: 28, fontWeight: 500, color: pot.color }}>{fmt(pot.saved)}</div>
            {pot.targetAmount > 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>of {fmt(pot.targetAmount)} target</div>}
            {pot.notes && <div style={{ marginTop: 6, fontSize: 13, color: 'var(--mid)', fontStyle: 'italic' }}>{pot.notes}</div>}
          </div>
        </div>

        {/* Sub-goals */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10 }}>Sub-goals {totalSubTarget > 0 && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {fmt(totalSubTarget)} total</span>}</div>
          {(pot.subGoals || []).map(sg => (
            <div key={sg.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--bd-sm)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: pot.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13.5 }}>{sg.name}</span>
              {sg.targetAmount > 0 && <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>{fmt(sg.targetAmount)}</span>}
              <button onClick={() => removeSubGoal(pot.id, sg.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>×</button>
            </div>
          ))}
          <form onSubmit={handleAddSub} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input value={subName} onChange={e => setSubName(e.target.value)} placeholder="Sub-goal name" style={{ ...inp, flex: 1 }} />
            <input type="number" min="0" step="0.01" value={subTarget} onChange={e => setSubTarget(e.target.value)} placeholder="£0" style={{ ...inp, width: 80 }} />
            <PrimaryBtn type="submit" style={{ padding: '9px 14px', fontSize: 13 }}>Add</PrimaryBtn>
          </form>
        </div>

        {/* Log deposit */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10 }}>Log deposit</div>
          <form onSubmit={handleDeposit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" min="0.01" step="0.01" value={depAmt} onChange={e => setDepAmt(e.target.value)} placeholder="Amount (£)" required style={{ ...inp, flex: 1 }} />
              <input type="date" value={depDate} onChange={e => setDepDate(e.target.value)} style={{ ...inp, width: 150 }} />
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
                  <span style={{ fontFamily: "'Newsreader', serif", fontSize: 14, fontWeight: 600, color: '#6f8168' }}>+{fmt(dep.amount)}</span>
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
  const { addTransaction } = useFinances()
  const [merchant, setMerchant] = useState('')
  const [category, setCategory] = useState('')
  const [amount, setAmount]     = useState('')
  const [date, setDate]         = useState(new Date().toISOString().slice(0, 10))
  const [type, setType]         = useState('expense')

  const submit = (e) => {
    e.preventDefault()
    if (!merchant.trim() || !amount) return
    addTransaction(merchant.trim(), category.trim(), amount, date, type)
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
        <Field label="Description / Merchant"><input autoFocus value={merchant} onChange={e => setMerchant(e.target.value)} placeholder={type === 'income' ? 'e.g. Salary' : 'e.g. Tesco'} style={inp} /></Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Amount (£)" style={{ flex: 1 }}><input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required style={inp} /></Field>
          <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} style={sel} /></Field>
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

  const submit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    addAccount(name.trim(), inst.trim(), type, bal)
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
        <Field label="Current balance (£)"><input type="number" step="0.01" value={bal} onChange={e => setBal(e.target.value)} placeholder="0.00" style={inp} /></Field>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <GhostBtn type="button" onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn type="submit">Add account</PrimaryBtn>
        </div>
      </form>
    </Modal>
  )
}

// ─── Account type colours ─────────────────────────────────────────────────────

const ACC_COLOR = { checking: '#6f8168', savings: '#5f7591', investment: '#b08a3e', credit: '#c15f3c' }

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FinancesPage() {
  const { pots, accounts, transactions, netWorth, income, spending } = useFinances()
  const [showAddPot, setShowAddPot]         = useState(false)
  const [showAddTxn, setShowAddTxn]         = useState(false)
  const [showAddAcc, setShowAddAcc]         = useState(false)
  const [activePot, setActivePot]           = useState(null)

  const { removeAccount, removeTransaction } = useFinances()

  const totalSaved = pots.reduce((s, p) => s + p.saved, 0)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 34, fontWeight: 500 }}>Finances</h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--mid)' }}>Net worth, cashflow, and savings pots.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={() => setShowAddAcc(true)} style={{ fontSize: 13, padding: '8px 14px' }}>+ Account</GhostBtn>
          <GhostBtn onClick={() => setShowAddTxn(true)} style={{ fontSize: 13, padding: '8px 14px' }}>+ Transaction</GhostBtn>
          <PrimaryBtn onClick={() => setShowAddPot(true)} style={{ fontSize: 13, padding: '8px 14px' }}>+ Savings pot</PrimaryBtn>
        </div>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 1fr', gap: 14, marginBottom: 24 }}>
        <div style={{ background: 'var(--ink)', borderRadius: 16, padding: '20px 22px', color: 'var(--surface-2)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }}>Net worth</div>
          <div style={{ marginTop: 6, fontFamily: "'Newsreader', serif", fontSize: 32, fontWeight: 500 }}>{accounts.length > 0 ? fmt(netWorth) : '—'}</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '20px 22px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>Income</div>
          <div style={{ marginTop: 6, fontFamily: "'Newsreader', serif", fontSize: 26, fontWeight: 500 }}>{income > 0 ? fmt(income) : '—'}</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '20px 22px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>Spending</div>
          <div style={{ marginTop: 6, fontFamily: "'Newsreader', serif", fontSize: 26, fontWeight: 500, color: spending > 0 ? '#c15f3c' : 'var(--ink)' }}>{spending > 0 ? fmt(spending) : '—'}</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '20px 22px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>In pots</div>
          <div style={{ marginTop: 6, fontFamily: "'Newsreader', serif", fontSize: 26, fontWeight: 500, color: totalSaved > 0 ? '#6f8168' : 'var(--ink)' }}>{totalSaved > 0 ? fmt(totalSaved) : '—'}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, alignItems: 'start' }}>

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
                    <div style={{ fontFamily: "'Newsreader', serif", fontSize: 16, fontWeight: 600, color: pot.color }}>{fmt(pot.saved)}</div>
                    {pot.targetAmount > 0 && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>of {fmt(pot.targetAmount)}</div>}
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
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{a.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{a.institution} · {a.type}</div>
                </div>
                <div style={{ fontFamily: "'Newsreader', serif", fontSize: 15, fontWeight: 600, color: a.type === 'credit' ? '#c15f3c' : 'var(--ink)' }}>
                  {a.type === 'credit' ? `−${fmtAbs(a.balance)}` : fmt(a.balance)}
                </div>
                <button onClick={() => window.confirm(`Remove "${a.name}"?`) && removeAccount(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>×</button>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT col: Transactions */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 19, fontWeight: 600 }}>Transactions</h2>
            <button onClick={() => setShowAddTxn(true)} style={{ fontSize: 12, fontWeight: 600, color: '#c15f3c', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>+ Add</button>
          </div>
          {transactions.length === 0 && <div style={{ padding: '24px 0', fontSize: 13, color: 'var(--faint)', textAlign: 'center' }}>No transactions yet</div>}
          {transactions.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--bd-xs)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.type === 'income' ? '#6f8168' : '#c15f3c', flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{t.merchant}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t.category ? `${t.category} · ` : ''}{t.date}</div>
              </div>
              <div style={{ fontFamily: "'Newsreader', serif", fontSize: 14.5, fontWeight: 600, color: t.type === 'income' ? '#6f8168' : 'var(--ink)' }}>
                {t.type === 'income' ? '+' : '−'}{fmtAbs(t.amount)}
              </div>
              <button onClick={() => removeTransaction(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>×</button>
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      {showAddPot && <AddPotModal onClose={() => setShowAddPot(false)} />}
      {showAddTxn && <AddTransactionModal onClose={() => setShowAddTxn(false)} />}
      {showAddAcc && <AddAccountModal onClose={() => setShowAddAcc(false)} />}
      {activePot  && <PotPanel pot={pots.find(p => p.id === activePot.id) || activePot} onClose={() => setActivePot(null)} />}
    </div>
  )
}
