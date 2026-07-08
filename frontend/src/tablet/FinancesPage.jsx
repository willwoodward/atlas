import { useFinances } from '../context/FinancesContext.jsx'
import GoalRing from '../components/GoalRing.jsx'

const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)

export default function TabletFinancesPage() {
  const { pots, accounts, transactions, netWorth, income, spending, totalSaved } = useFinances()

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
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>Income</div>
          <div style={{ marginTop: 6, fontFamily: "'Newsreader', serif", fontSize: 23, fontWeight: 500 }}>
            {income > 0 ? fmt(income) : '—'}
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '18px 20px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>Spending</div>
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
