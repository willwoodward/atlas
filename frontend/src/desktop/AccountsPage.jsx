import { useState, useCallback } from 'react'
import { useIntegrations } from '../context/IntegrationsContext.jsx'
import { useGitHub } from '../context/GitHubContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'

function StatusBadge({ connected }) {
  return connected
    ? <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'rgba(111,129,104,.15)', color: '#6f8168' }}>Connected</span>
    : <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'var(--surface-3)', color: 'var(--muted)' }}>Not connected</span>
}

function IntegrationCard({ icon, name, description, connected, onConnect, onDisconnect, warning }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 18 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: 22 }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span>
          <StatusBadge connected={connected} />
        </div>
        <div style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.4 }}>{description}</div>
        {warning && (
          <div style={{ marginTop: 7, display: 'inline-flex', fontSize: 12, color: '#b08a3e', background: 'rgba(176,138,62,.12)', padding: '4px 10px', borderRadius: 7 }}>
            {warning}
          </div>
        )}
      </div>
      {connected
        ? <button onClick={onDisconnect} style={{ padding: '8px 16px', borderRadius: 9, border: '1px solid var(--bd-xl)', background: 'transparent', color: 'var(--mid)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Disconnect</button>
        : <button onClick={onConnect}    style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: 'var(--ink)', color: 'var(--surface-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Connect</button>
      }
    </div>
  )
}

function ComingSoonCard({ icon, name, description }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 18, opacity: 0.5 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: 22 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{name}</div>
        <div style={{ fontSize: 13, color: 'var(--mid)' }}>{description}</div>
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 9, background: 'var(--surface-3)', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Coming soon</span>
    </div>
  )
}

function GitHubCard() {
  const { github, connect, disconnect } = useGitHub()
  const [open,   setOpen]   = useState(false)
  const [token,  setToken]  = useState('')
  const [repo,   setRepo]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error,  setError]  = useState(null)

  const handleConnect = async (e) => {
    e.preventDefault()
    if (!token.trim() || !repo.trim()) return
    setLoading(true)
    setError(null)
    try {
      await connect(token.trim(), repo.trim())
      setOpen(false)
      setToken('')
      setRepo('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: 22 }}>
          🐙
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>GitHub Notes</span>
            <StatusBadge connected={github.connected} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.4 }}>
            {github.connected
              ? `Synced with ${github.repo}`
              : 'Browse and edit your markdown notes repo directly from Atlas.'}
          </div>
        </div>
        {github.connected
          ? <button onClick={disconnect} style={{ padding: '8px 16px', borderRadius: 9, border: '1px solid var(--bd-xl)', background: 'transparent', color: 'var(--mid)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Disconnect</button>
          : <button onClick={() => setOpen(o => !o)} style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: 'var(--ink)', color: 'var(--surface-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Connect</button>
        }
      </div>

      {open && !github.connected && (
        <form onSubmit={handleConnect} style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--bd-xs)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            value={repo}
            onChange={e => setRepo(e.target.value)}
            placeholder="Repo — e.g. willwoodward/learning"
            style={{ padding: '9px 13px', borderRadius: 9, border: '1.5px solid var(--bd-xl)', background: 'var(--surface-2)', fontSize: 13.5, fontFamily: 'inherit', color: 'var(--ink)', outline: 'none' }}
          />
          <input
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Personal access token (repo scope)"
            type="password"
            style={{ padding: '9px 13px', borderRadius: 9, border: '1.5px solid var(--bd-xl)', background: 'var(--surface-2)', fontSize: 13.5, fontFamily: 'inherit', color: 'var(--ink)', outline: 'none' }}
          />
          {error && <div style={{ fontSize: 12, color: '#c15f3c' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={loading}
              style={{ padding: '8px 18px', borderRadius: 9, border: 'none', background: 'var(--ink)', color: 'var(--surface-2)', fontSize: 13, fontWeight: 600, cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Connecting…' : 'Connect'}
            </button>
            <button type="button" onClick={() => setOpen(false)}
              style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid var(--bd-xl)', background: 'transparent', color: 'var(--mid)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function MigrationCard() {
  const { token, user, logout } = useAuth()
  const [status, setStatus] = useState(null) // null | 'running' | 'done' | 'error'
  const [progress, setProgress] = useState([])

  const log = (msg, ok = true) => setProgress(p => [...p, { msg, ok }])

  const migrate = useCallback(async () => {
    setStatus('running')
    setProgress([])
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    const call = (path, body, method = 'POST') =>
      fetch(`${API}${path}`, { method, headers: h, body: JSON.stringify(body) })

    try {
      // Habits
      const habitsRaw = localStorage.getItem('atlas:habits:v1')
      if (habitsRaw) {
        const { habits = [], completions = {} } = JSON.parse(habitsRaw)
        for (const hab of habits) {
          await call('/api/habits', { id: hab.id, name: hab.name, color: hab.color, created_at: hab.createdAt || new Date().toISOString() })
          for (const date of (completions[hab.id] || [])) {
            await call(`/api/habits/${hab.id}/toggle`, { date })
          }
        }
        log(`Habits: migrated ${habits.length} habits`)
      }

      // Todos
      const todosRaw = localStorage.getItem('atlas:todos:v1')
      if (todosRaw) {
        const { todos = [], outcomes = '', weekStr } = JSON.parse(todosRaw)
        for (const t of todos) {
          await call('/api/todos', { id: t.id, text: t.text, bucket: t.bucket, goal_id: t.goalId || null, done: t.done, created_at: t.createdAt || new Date().toISOString(), sort_order: 0 })
        }
        if (weekStr && outcomes) await call('/api/todos/outcomes', { week_str: weekStr, text: outcomes }, 'PUT')
        log(`Todos: migrated ${todos.length} todos`)
      }

      // Goals
      const goalsRaw = localStorage.getItem('atlas:goals:v1')
      if (goalsRaw) {
        const goals = JSON.parse(goalsRaw)
        for (const g of goals) {
          await call('/api/goals', { id: g.id, title: g.title, color: g.color, created_at: g.createdAt || new Date().toISOString(), q1: g.quarters?.Q1 || '', q2: g.quarters?.Q2 || '', q3: g.quarters?.Q3 || '', q4: g.quarters?.Q4 || '' })
        }
        log(`Goals: migrated ${goals.length} goals`)
      }

      // Finances
      const finRaw = localStorage.getItem('atlas:finances:v1')
      if (finRaw) {
        const { pots = [], transactions = [], accounts = [] } = JSON.parse(finRaw)
        for (const p of pots) {
          await call('/api/finances/pots', { id: p.id, name: p.name, color: p.color, target_amount: p.targetAmount || 0, notes: p.notes || '' })
          for (const sg of (p.subGoals || [])) await call(`/api/finances/pots/${p.id}/subgoals`, { id: sg.id, name: sg.name, target_amount: sg.targetAmount || 0, notes: sg.notes || '' })
          for (const dep of (p.deposits || [])) await call(`/api/finances/pots/${p.id}/deposits`, { id: dep.id, amount: dep.amount, note: dep.note || '', date: dep.date })
        }
        for (const t of transactions) await call('/api/finances/transactions', t)
        for (const a of accounts) await call('/api/finances/accounts', a)
        log(`Finances: migrated ${pots.length} pots, ${transactions.length} transactions, ${accounts.length} accounts`)
      }

      // Notes
      const notesRaw = localStorage.getItem('atlas:notes:v1')
      if (notesRaw) {
        const notes = JSON.parse(notesRaw)
        for (const n of notes) await call('/api/notes', { id: n.id, body: n.body || '', updated_at: n.updatedAt || new Date().toISOString() })
        log(`Notes: migrated ${notes.length} notes`)
      }

      // Calendar events
      const calRaw = localStorage.getItem('atlas:local-events:v1')
      if (calRaw) {
        const events = JSON.parse(calRaw)
        for (const e of events) await call('/api/calendar', { id: e.id, title: e.title, date: e.date, start_h: e.startH, end_h: e.endH, color: e.color, notes: e.notes || '' })
        log(`Calendar: migrated ${events.length} events`)
      }

      log('Migration complete — you can now clear old localStorage data.')
      setStatus('done')
    } catch (err) {
      log(`Error: ${err.message}`, false)
      setStatus('error')
    }
  }, [token])

  const clearLocal = () => {
    ['atlas:habits:v1','atlas:todos:v1','atlas:goals:v1','atlas:finances:v1','atlas:notes:v1','atlas:local-events:v1'].forEach(k => localStorage.removeItem(k))
    log('Cleared local storage keys.')
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>One-time data migration</div>
          <div style={{ fontSize: 13, color: 'var(--mid)' }}>Copy existing local data into the server database.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {status === 'done' && (
            <button onClick={clearLocal} style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid var(--bd-xl)', background: 'transparent', color: 'var(--mid)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              Clear local storage
            </button>
          )}
          <button onClick={migrate} disabled={status === 'running'} style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: 'var(--ink)', color: 'var(--surface-2)', fontSize: 13, fontWeight: 600, cursor: status === 'running' ? 'default' : 'pointer', fontFamily: 'inherit', opacity: status === 'running' ? 0.7 : 1 }}>
            {status === 'running' ? 'Migrating…' : 'Migrate now'}
          </button>
        </div>
      </div>
      {progress.length > 0 && (
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {progress.map((p, i) => (
            <div key={i} style={{ fontSize: 12.5, color: p.ok ? 'var(--mid)' : '#c15f3c', fontFamily: 'monospace' }}>
              {p.ok ? '✓' : '✗'} {p.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AccountsPage() {
  const { gcal, connectGoogle, disconnectGoogle } = useIntegrations()
  const { user, logout } = useAuth()
  const hasClientId = !!import.meta.env.VITE_GOOGLE_CLIENT_ID

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 34, fontWeight: 500 }}>Accounts &amp; connections</h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--mid)' }}>Link your services to bring everything into Atlas.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 4 }}>
          {user && <span style={{ fontSize: 13, color: 'var(--mid)' }}>{user.email}</span>}
          <button onClick={logout} style={{ padding: '7px 14px', borderRadius: 9, border: '1px solid var(--bd-xl)', background: 'transparent', color: 'var(--mid)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            Sign out
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 10 }}>

        <h2 style={{ margin: '4px 0 6px', fontFamily: "'Newsreader', serif", fontSize: 17, fontWeight: 600, color: 'var(--muted)' }}>Calendar</h2>

        <IntegrationCard
          icon="📅"
          name="Google Calendar"
          description="Pull in your events so they appear in the Calendar view and today's schedule on the Home page."
          connected={gcal.connected}
          onConnect={connectGoogle}
          onDisconnect={disconnectGoogle}
          warning={!hasClientId && !gcal.connected ? 'VITE_GOOGLE_CLIENT_ID not set — see setup guide below.' : null}
        />

        {gcal.error && (
          <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(193,95,60,.08)', border: '1px solid rgba(193,95,60,.2)', fontSize: 13, color: '#c15f3c' }}>
            ⚠ {gcal.error}
          </div>
        )}

        <h2 style={{ margin: '16px 0 6px', fontFamily: "'Newsreader', serif", fontSize: 17, fontWeight: 600, color: 'var(--muted)' }}>Finance</h2>
        <ComingSoonCard icon="🏦" name="Plaid" description="Connect bank accounts, savings, and credit cards to track net worth and spending automatically." />

        <h2 style={{ margin: '16px 0 6px', fontFamily: "'Newsreader', serif", fontSize: 17, fontWeight: 600, color: 'var(--muted)' }}>Notes</h2>
        <GitHubCard />
        <h2 style={{ margin: '16px 0 6px', fontFamily: "'Newsreader', serif", fontSize: 17, fontWeight: 600, color: 'var(--muted)' }}>Tasks</h2>
        <ComingSoonCard icon="✅" name="Todoist" description="Sync tasks and projects into the To-do view." />

      </div>

      {/* Data migration */}
      <div style={{ maxWidth: 720, marginTop: 28 }}>
        <h2 style={{ margin: '0 0 10px', fontFamily: "'Newsreader', serif", fontSize: 17, fontWeight: 600, color: 'var(--muted)' }}>Data</h2>
        <MigrationCard />
      </div>

      {/* Setup guide */}
      <div style={{ maxWidth: 720, marginTop: 44 }}>
        <h2 style={{ margin: '0 0 14px', fontFamily: "'Newsreader', serif", fontSize: 20, fontWeight: 600 }}>Google Calendar setup</h2>
        <div style={{ background: 'var(--ink)', borderRadius: 16, padding: '24px 28px', color: '#d4cfc6' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 16 }}>Step-by-step</div>
          {[
            'Go to console.cloud.google.com and create a new project.',
            'Navigate to APIs & Services → Library, search "Google Calendar API" and enable it.',
            'Go to APIs & Services → Credentials → Create Credentials → OAuth client ID.',
            'Choose "Web application". Under Authorised JavaScript origins add:',
            `Create a .env.local file in the project root with:\nVITE_GOOGLE_CLIENT_ID=paste_your_client_id_here`,
            'Restart the dev server (npm run dev), then click Connect above.',
          ].map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, marginBottom: i < 5 ? 12 : 0 }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#c15f3c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flex: 'none', marginTop: 2, color: '#fff' }}>{i + 1}</span>
              <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
                {i === 3 ? (
                  <>
                    {step}
                    <code style={{ display: 'block', marginTop: 6, padding: '6px 10px', background: 'rgba(255,255,255,.06)', borderRadius: 6, fontSize: 12, color: '#f0b98f' }}>
                      {window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '')}
                    </code>
                  </>
                ) : i === 4 ? (
                  <>
                    {step.split('\n')[0]}
                    <code style={{ display: 'block', marginTop: 6, padding: '8px 12px', background: 'rgba(255,255,255,.06)', borderRadius: 6, fontSize: 12, color: '#f0b98f', whiteSpace: 'pre' }}>
                      {step.split('\n')[1]}
                    </code>
                  </>
                ) : step}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
