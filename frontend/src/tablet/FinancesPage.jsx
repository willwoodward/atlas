import { useFinances } from '../context/FinancesContext.jsx'
import { useEmployment } from '../context/EmploymentContext.jsx'
import GoalRing from '../components/GoalRing.jsx'

const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)

// Read-only, like the rest of this layout — editing lives on desktop and mobile.
// It still surfaces budgets, recurring spend and pay, so the tablet view does not
// quietly show a stale picture of the same data.
export default function TabletFinancesPage() {
  const { pots, accounts, transactions, netWorth, income, spending, totalSaved, insights } = useFinances()
  const { summary: comp, employment } = useEmployment()
  const budgets = insights?.budgets || []
  const recurring = insights?.recurring || []

  const hasData = accounts.length > 0 || pots.length > 0 || transactions.length > 0

  return (
    <div style={{ padding: '14px 44px 30px' }}>
      <h1 style={{ margin: '0 0 18px', fontFamily: "'Newsreader', serif", fontSize: 32, fontWeight: 500 }}>Finances</h1>

      {/* 4-col stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 14, marginBottom: 16 }}>
        <div style={{ background: 'var(--ink)', borderRadius: 16, padding: '18px 20px', color: 'var(--surface-2)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }}>Net worth</div>
          <div style={{ marginTop: 6, fontFamily: "'Newsreader', serif", fontSize: 30, fontWeight: 500 }}>
            {accounts.length > 0 ? fmt(netWorth) : '—'}
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '18px 20px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>Income · this month</div>
          <div style={{ marginTop: 6, fontFamily: "'Newsreader', serif", fontSize: 23, fontWeight: 500 }}>
            {income > 0 ? fmt(income) : '—'}
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '18px 20px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>Spending · this month</div>
          <div style={{ marginTop: 6, fontFamily: "'Newsreader', serif", fontSize: 23, fontWeight: 500, color: spending > 0 ? '#c15f3c' : 'var(--ink)' }}>
            {spending > 0 ? fmt(spending) : '—'}
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '18px 20px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>Saved</div>
          <div style={{ marginTop: 6, fontFamily: "'Newsreader', serif", fontSize: 23, fontWeight: 500, color: totalSaved > 0 ? '#6f8168' : 'var(--ink)' }}>
            {totalSaved > 0 ? fmt(totalSaved) : '—'}
          </div>
        </div>
      </div>

      {!hasData && (
        <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 14, color: 'var(--faint)' }}>
          No financial data yet — add it on desktop.
        </div>
      )}

      {/* Budgets + recurring */}
      {(budgets.length > 0 || recurring.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: budgets.length && recurring.length ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 16 }}>
          {budgets.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 18, padding: '20px 24px' }}>
              <h2 style={{ margin: '0 0 12px', fontFamily: "'Newsreader', serif", fontSize: 18, fontWeight: 600 }}>Budgets</h2>
              {budgets.slice(0, 6).map(b => (
                <div key={b.id} style={{ padding: '9px 0', borderTop: '1px solid var(--bd-xs)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, marginBottom: 5 }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.category}</span>
                    <span style={{ flex: 'none', color: b.over ? '#c15f3c' : 'var(--mid)' }}>{fmt(b.spent)} / {fmt(b.amount)}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, width: `${Math.min(b.pct, 100)}%`,
                      background: b.over ? '#c15f3c' : b.pace > 1.15 ? '#b8860b' : '#4f7f45' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {recurring.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 18, padding: '20px 24px' }}>
              <h2 style={{ margin: '0 0 12px', fontFamily: "'Newsreader', serif", fontSize: 18, fontWeight: 600 }}>Recurring</h2>
              {recurring.slice(0, 6).map(r => (
                <div key={r.merchant} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '8px 0', borderTop: '1px solid var(--bd-xs)' }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                  <span style={{ flex: 'none', color: 'var(--mid)' }}>{r.varies ? '~' : ''}{fmt(r.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Compensation */}
      {employment && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 18, padding: '20px 24px', marginBottom: 16 }}>
          <h2 style={{ margin: '0 0 4px', fontFamily: "'Newsreader', serif", fontSize: 18, fontWeight: 600 }}>Compensation</h2>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
            {employment.employer}{employment.title ? ` · ${employment.title}` : ''}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {[['Gross · next 12m', comp.gross_12m], ['Net · next 12m', comp.net_12m], ['Equity · next 12m', comp.equity_12m]].map(([label, v]) => (
              <div key={label}>
                <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>{label}</div>
                <div style={{ marginTop: 5, fontFamily: "'Newsreader', serif", fontSize: 22, fontWeight: 500 }}>{v ? fmt(v) : '—'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Savings pots */}
      {pots.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 18, padding: '20px 24px', marginBottom: 16 }}>
          <h2 style={{ margin: '0 0 16px', fontFamily: "'Newsreader', serif", fontSize: 18, fontWeight: 600 }}>Savings pots</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {pots.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: '1px solid var(--bd-xs)' }}>
                <GoalRing pct={p.pct} color={p.color} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fmt(p.saved)} <span style={{ color: 'var(--faint)' }}>/ {fmt(p.targetAmount)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transactions */}
      {transactions.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 18, padding: '20px 24px' }}>
          <h2 style={{ margin: '0 0 4px', fontFamily: "'Newsreader', serif", fontSize: 18, fontWeight: 600 }}>Recent transactions</h2>
          {transactions.slice(0, 8).map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--bd-xs)' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: t.type === 'income' ? '#6f8168' : '#c15f3c', flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{t.merchant}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.category} · {t.date}</div>
              </div>
              <div style={{ fontFamily: "'Newsreader', serif", fontSize: 14.5, fontWeight: 600, color: t.type === 'income' ? '#6f8168' : '#c15f3c' }}>
                {t.type === 'income' ? '+' : '-'}{fmt(t.amount)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
