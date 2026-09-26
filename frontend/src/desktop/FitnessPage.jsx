import { useState } from 'react'
import { useFitness } from '../context/FitnessContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { useQuickAdd } from '../context/QuickAddContext.jsx'

// Validated with the dataviz palette checker against the light (#fffdf9) and
// dark (#22201a) surfaces — the same steps as the compensation chart. The
// stacked "All" view uses them in exactly this order, which is the adjacency
// that was validated (coral→blue→gold), so do not reorder.
const SPORTS = [
  { key: 'run',  label: 'Run',  color: '#c15f3c' },
  { key: 'swim', label: 'Swim', color: '#2b72a8' },
  { key: 'ride', label: 'Ride', color: '#b8860b' },
]
const SPORT = Object.fromEntries(SPORTS.map(s => [s.key, s]))
const STRAVA_ORANGE = '#FC4C02'
const SECTION_COLORS = ['#c15f3c', '#2b72a8', '#4f7f45', '#b8860b', '#9a6d84']

// ─── Formatting ───────────────────────────────────────────────────────────────

const fmtDist = (sport, m) => {
  if (!m) return sport === 'swim' ? '0 m' : '0 km'
  return sport === 'swim'
    ? `${Math.round(m).toLocaleString('en-GB')} m`
    : `${(m / 1000).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
}
const fmtDur = (s) => {
  if (!s) return '0m'
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60)
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
const fmtPace = (sport, v) => {
  if (v == null) return '—'
  if (sport === 'run') return `${mmss(v)} /km`
  if (sport === 'swim') return `${mmss(v)} /100m`
  return `${v.toFixed(1)} km/h`
}
const weekLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
const niceCeil = (v) => {
  if (v <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(v))
  for (const f of [1, 2, 2.5, 5, 10]) if (v <= f * pow) return f * pow
  return 10 * pow
}

const card = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16 }
const h2 = { margin: 0, fontFamily: "'Newsreader', serif", fontSize: 19, fontWeight: 600 }
const eyebrow = { fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }
const linkBtn = { fontSize: 12, fontWeight: 600, color: '#c15f3c', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }
const inp = { padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--bd-xl)', background: 'var(--surface-2)', fontSize: 13, fontFamily: 'inherit', color: 'var(--ink)', outline: 'none', width: '100%', minWidth: 0 }

// ─── Weekly volume chart ──────────────────────────────────────────────────────

function valueOf(week, sport) {
  return sport === 'all'
    ? SPORTS.reduce((s, sp) => s + week[sp.key].moving_time, 0)
    : week[sport].distance
}
function axisLabel(sport, v) {
  if (sport === 'all') return `${Math.round(v / 3600 * 10) / 10}h`
  if (sport === 'swim') return `${Math.round(v).toLocaleString('en-GB')} m`
  return `${Math.round(v / 100) / 10} km`
}

function WeekDetail({ week, sport }) {
  const parts = sport === 'all' ? SPORTS : [SPORT[sport]]
  return (
    <div style={{ fontSize: 12.5 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        Week of {weekLabel(week.week_start)}{week.current ? ' · this week' : ''}
      </div>
      {parts.map(sp => {
        const w = week[sp.key]
        return (
          <div key={sp.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '2px 0' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: .85 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: sp.color }} />{sp.label}
            </span>
            <span>
              {w.count ? `${fmtDist(sp.key, w.distance)} · ${w.count}× · ${fmtDur(w.moving_time)}` : '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function VolumeChart({ weeks, sport }) {
  const isMobile = useIsMobile()
  const [hover, setHover] = useState(null)
  const [asTable, setAsTable] = useState(false)

  const values = weeks.map(w => valueOf(w, sport))
  const top = niceCeil(Math.max(...values, 0))
  const PLOT = 150
  const ticks = [top, top / 2, 0]
  const maxIdx = values.indexOf(Math.max(...values))
  const active = weeks.find(w => w.week_start === hover)
  const layers = sport === 'all' ? SPORTS : [SPORT[sport]]

  if (asTable) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button onClick={() => setAsTable(false)} style={linkBtn}>Chart view</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>
              <th style={{ textAlign: 'left', padding: '6px 8px 6px 0', color: 'var(--muted)', fontWeight: 600 }}>Week</th>
              {SPORTS.map(s => <th key={s.key} style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--muted)', fontWeight: 600 }}>{s.label}</th>)}
              <th style={{ textAlign: 'right', padding: '6px 0 6px 8px', color: 'var(--muted)', fontWeight: 600 }}>Time</th>
            </tr></thead>
            <tbody>
              {[...weeks].reverse().map(w => (
                <tr key={w.week_start} style={{ borderTop: '1px solid var(--bd-xs)' }}>
                  <td style={{ padding: '6px 8px 6px 0', whiteSpace: 'nowrap' }}>{weekLabel(w.week_start)}</td>
                  {SPORTS.map(s => (
                    <td key={s.key} style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--mid)', whiteSpace: 'nowrap' }}>
                      {w[s.key].count ? fmtDist(s.key, w[s.key].distance) : '—'}
                    </td>
                  ))}
                  <td style={{ textAlign: 'right', padding: '6px 0 6px 8px', whiteSpace: 'nowrap' }}>{fmtDur(w.total_time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {/* One series needs no legend; the stacked view has three, so it does. */}
        {sport === 'all' ? (
          <div style={{ display: 'flex', gap: 14 }}>
            {SPORTS.map(s => (
              <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--mid)' }}>
                <span style={{ width: 9, height: 9, borderRadius: 2.5, background: s.color }} />{s.label}
              </span>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Distance per week</span>
        )}
        <button onClick={() => setAsTable(true)} style={linkBtn}>Table view</button>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {/* Recessive axis: three labels, no box. */}
        <div style={{ position: 'relative', width: 44, height: PLOT, flex: 'none' }}>
          {ticks.map((t, i) => (
            <span key={i} style={{ position: 'absolute', right: 0, top: (i / 2) * PLOT - 7, fontSize: 10.5, color: 'var(--faint)', whiteSpace: 'nowrap' }}>
              {axisLabel(sport, t)}
            </span>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden' }}>
          <div style={{ minWidth: isMobile ? 420 : 'auto', position: 'relative' }}>
            {ticks.map((t, i) => (
              <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: (i / 2) * PLOT, borderTop: `1px ${i === 2 ? 'solid' : 'dashed'} var(--bd-sm)`, pointerEvents: 'none' }} />
            ))}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: PLOT, position: 'relative' }}>
              {weeks.map((w, i) => {
                const total = values[i]
                const label = total > 0 && (w.current || i === maxIdx)
                return (
                  <div key={w.week_start}
                    onMouseEnter={() => setHover(w.week_start)}
                    onMouseLeave={() => !isMobile && setHover(null)}
                    onClick={() => setHover(h => (h === w.week_start ? null : w.week_start))}
                    style={{ flex: 1, minWidth: 22, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch', cursor: 'default', position: 'relative' }}>
                    {label && (
                      <span style={{ position: 'absolute', bottom: `calc(${(total / top) * 100}% + 4px)`, left: '50%', transform: 'translateX(-50%)', fontSize: 10.5, fontWeight: 600, color: 'var(--mid)', whiteSpace: 'nowrap' }}>
                        {sport === 'all' ? fmtDur(total) : fmtDist(sport, total)}
                      </span>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column-reverse', opacity: hover && hover !== w.week_start ? .45 : 1, transition: 'opacity .12s' }}>
                      {layers.map(sp => {
                        const v = sport === 'all' ? w[sp.key].moving_time : w[sp.key].distance
                        if (!v) return null
                        return (
                          <div key={sp.key} style={{
                            height: `${(v / top) * PLOT}px`, minHeight: 3, flexShrink: 0,
                            background: sp.color, boxSizing: 'border-box',
                            borderTop: sport === 'all' ? '2px solid var(--surface)' : 'none',
                            borderRadius: '4px 4px 0 0',
                          }} />
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              {weeks.map((w, i) => (
                <span key={w.week_start} style={{ flex: 1, minWidth: 22, textAlign: 'center', fontSize: 10.5, color: w.current ? 'var(--ink)' : 'var(--faint)', fontWeight: w.current ? 600 : 400, whiteSpace: 'nowrap' }}>
                  {/* Every other label on phones, so the dates never collide. */}
                  {(!isMobile || i % 2 === (weeks.length - 1) % 2) ? (w.current ? 'Now' : weekLabel(w.week_start)) : ''}
                </span>
              ))}
            </div>

            {active && !isMobile && (
              <div style={{ position: 'absolute', top: 0, right: 0, background: 'var(--ink)', color: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px', minWidth: 210, pointerEvents: 'none', boxShadow: '0 8px 24px rgba(43,40,32,.24)', zIndex: 2 }}>
                <WeekDetail week={active} sport={sport} />
              </div>
            )}
          </div>
        </div>
      </div>

      {active && isMobile && (
        <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 10 }}>
          <WeekDetail week={active} sport={sport} />
        </div>
      )}
      {isMobile && !active && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--faint)' }}>Tap a week for the breakdown.</div>
      )}
    </div>
  )
}

// ─── Strava card ──────────────────────────────────────────────────────────────

function Tile({ label, value, sub }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={eyebrow}>{label}</div>
      <div style={{ marginTop: 4, fontFamily: "'Newsreader', serif", fontSize: 21, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  )
}

function SportStats({ sport, summary, ytd }) {
  const s = summary.sports[sport]
  const change = s.avg_week_4 > 0 ? Math.round((s.this_week.distance / s.avg_week_4 - 1) * 100) : null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 16, marginTop: 18 }}>
      <Tile label="This week" value={fmtDist(sport, s.this_week.distance)}
        sub={s.this_week.count ? `${s.this_week.count} session${s.this_week.count > 1 ? 's' : ''} · ${fmtDur(s.this_week.moving_time)}` : 'Nothing yet'} />
      <Tile label="4-week average" value={fmtDist(sport, s.avg_week_4)}
        sub={change == null ? 'per week' : `${change >= 0 ? '+' : ''}${change}% this week so far`} />
      <Tile label={sport === 'ride' ? 'Avg speed' : 'Avg pace'} value={fmtPace(sport, s.avg_pace)}
        sub={s.avg_heartrate ? `${s.avg_heartrate} bpm avg` : `${s.sessions} sessions · 12 wk`} />
      <Tile label="Longest" value={s.longest ? fmtDist(sport, s.longest.distance) : '—'}
        sub={s.longest ? s.longest.name : 'in the last 12 weeks'} />
      {ytd?.[sport] && (
        <Tile label="This year" value={fmtDist(sport, ytd[sport].distance)}
          sub={`${ytd[sport].count} ${sport === 'swim' ? 'swims' : sport === 'ride' ? 'rides' : 'runs'}`} />
      )}
    </div>
  )
}

function StravaSetup() {
  return (
    <div style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.6 }}>
      <p style={{ margin: '0 0 10px' }}>
        Strava isn't configured on the server yet. To connect it:
      </p>
      <ol style={{ margin: 0, paddingLeft: 18 }}>
        <li>Create an API application at <a href="https://www.strava.com/settings/api" target="_blank" rel="noreferrer" style={{ color: STRAVA_ORANGE }}>strava.com/settings/api</a>.
          Since June 2026 this needs an active Strava subscription.</li>
        <li>Set its Authorization Callback Domain to the site's domain (<code>localhost</code> always works for local dev).</li>
        <li>Add <code>STRAVA_CLIENT_ID</code> and <code>STRAVA_CLIENT_SECRET</code> to the server's env, then restart the API.</li>
      </ol>
    </div>
  )
}

function StravaCard() {
  const isMobile = useIsMobile()
  const { strava, summary, stravaError, loadingSummary, connectStrava, disconnectStrava } = useFitness()
  const [sport, setSport] = useState('run')

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
      <h2 style={h2}>Training volume</h2>
      {strava.connected && (
        <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', padding: 3, borderRadius: 10 }} role="tablist">
          {[...SPORTS, { key: 'all', label: 'All', color: 'var(--ink)' }].map(s => (
            <button key={s.key} role="tab" aria-selected={sport === s.key} onClick={() => setSport(s.key)} style={{
              padding: isMobile ? '6px 10px' : '6px 13px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
              background: sport === s.key ? 'var(--surface)' : 'transparent',
              color: sport === s.key ? 'var(--ink)' : 'var(--muted)',
              boxShadow: sport === s.key ? '0 1px 3px rgba(43,40,32,.12)' : 'none',
            }}>{s.label}</button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ ...card, padding: isMobile ? '18px 16px' : '20px 24px' }}>
      {header}

      {stravaError && (
        <div style={{ fontSize: 12.5, color: '#c15f3c', background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>{stravaError}</div>
      )}

      {!strava.configured && <StravaSetup />}

      {strava.configured && !strava.connected && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.6, margin: '0 0 14px' }}>
            Connect Strava to see your weekly swim, run and ride volume. Access is
            read-only — Atlas can't post, edit or delete anything — and activities
            are fetched live rather than stored.
          </p>
          <button onClick={connectStrava} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: STRAVA_ORANGE, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Connect with Strava
          </button>
        </div>
      )}

      {strava.connected && !summary && loadingSummary && (
        <div style={{ fontSize: 13, color: 'var(--faint)', padding: '40px 0', textAlign: 'center' }}>Loading from Strava…</div>
      )}

      {strava.connected && summary && (
        <>
          <VolumeChart weeks={summary.weeks} sport={sport} />
          {sport !== 'all' && <SportStats sport={sport} summary={summary.summary} ytd={summary.ytd} />}
          {sport === 'all' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 16, marginTop: 18 }}>
              <Tile label="Streak" value={`${summary.summary.streak_weeks} wk`} sub="weeks in a row with a session" />
              <Tile label="This week" value={fmtDur(summary.weeks.at(-1).total_time)} sub="across all three" />
              <Tile label="12-week total" value={fmtDur(summary.weeks.reduce((s, w) => s + w.total_time, 0))}
                sub={`${SPORTS.reduce((n, s) => n + summary.summary.sports[s.key].sessions, 0)} sessions`} />
            </div>
          )}

          {summary.recent.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div style={{ ...eyebrow, marginBottom: 6 }}>Recent</div>
              {summary.recent.filter(r => sport === 'all' || r.sport === sport).slice(0, 5).map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--bd-xs)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, flex: 'none', background: SPORT[r.sport].color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                      {weekLabel(r.date)} · {fmtDur(r.moving_time)} · {fmtPace(r.sport, r.pace)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flex: 'none' }}>
                    <div style={{ fontFamily: "'Newsreader', serif", fontSize: 14.5, fontWeight: 600 }}>{fmtDist(r.sport, r.distance)}</div>
                    {/* Strava's brand guidelines require a link back to each activity. */}
                    <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 600, color: STRAVA_ORANGE, textDecoration: 'none' }}>View on Strava</a>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 10, borderTop: '1px solid var(--bd-sm)', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--faint)' }}>
              Powered by Strava{summary.stale ? ' · showing a cached copy (rate limited)' : ''}
            </span>
            <button onClick={() => window.confirm('Disconnect Strava? Atlas will revoke its access and forget the connection.') && disconnectStrava()}
              style={{ ...linkBtn, color: 'var(--faint)', fontWeight: 400 }}>Disconnect</button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Gym list ─────────────────────────────────────────────────────────────────

function Sparkline({ history, color }) {
  const pts = history.filter(h => h.weight != null)
  if (pts.length < 2) return <span style={{ width: 56, flex: 'none' }} />
  const ws = pts.map(p => p.weight)
  const lo = Math.min(...ws), hi = Math.max(...ws), span = hi - lo || 1
  const W = 56, H = 18
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * (W - 4) + 2, H - 2 - ((p.weight - lo) / span) * (H - 4)])
  const [lx, ly] = xy.at(-1)
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ flex: 'none' }} aria-label={`Weight trend: ${ws.join(', ')}`}>
      <polyline points={xy.map(p => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
      <circle cx={lx} cy={ly} r="3" fill={color} stroke="var(--surface)" strokeWidth="1.5" />
    </svg>
  )
}

function delta(history) {
  const pts = history.filter(h => h.weight != null)
  if (pts.length < 2) return null
  const last = pts.at(-1), prev = pts.at(-2)
  const d = Math.round((last.weight - prev.weight) * 100) / 100
  if (!d) return null
  return { d, since: prev.date }
}

function ExerciseForm({ initial, onSave, onCancel, onDelete }) {
  const [f, setF] = useState({
    name: initial?.name || '', weight: initial?.weight ?? '', sets: initial?.sets ?? '', reps: initial?.reps || '',
  })
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))
  const submit = (e) => {
    e.preventDefault()
    if (!f.name.trim()) return
    onSave({
      name: f.name.trim(),
      weight: f.weight === '' ? null : Number(f.weight),
      sets: f.sets === '' ? null : Number(f.sets),
      reps: String(f.reps).trim(),
    })
  }
  return (
    <form onSubmit={submit} onKeyDown={e => e.key === 'Escape' && onCancel()}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 0', borderTop: '1px solid var(--bd-xs)' }}>
      <input autoFocus value={f.name} onChange={set('name')} placeholder="Exercise" style={{ ...inp, flex: '2 1 150px' }} />
      <input type="number" step="0.5" min="0" inputMode="decimal" value={f.weight} onChange={set('weight')} placeholder="kg" aria-label="Weight in kg" style={{ ...inp, flex: '0 1 76px' }} />
      <input type="number" min="1" inputMode="numeric" value={f.sets} onChange={set('sets')} placeholder="Sets" aria-label="Sets" style={{ ...inp, flex: '0 1 64px' }} />
      <input value={f.reps} onChange={set('reps')} placeholder="Reps" aria-label="Reps" style={{ ...inp, flex: '0 1 70px' }} />
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginLeft: 'auto' }}>
        {onDelete && <button type="button" onClick={onDelete} style={{ ...linkBtn, color: 'var(--faint)', fontWeight: 400 }}>Delete</button>}
        <button type="button" onClick={onCancel} style={{ ...linkBtn, color: 'var(--mid)' }}>Cancel</button>
        <button type="submit" style={linkBtn}>Save</button>
      </div>
    </form>
  )
}

function ExerciseRow({ ex, color }) {
  const { updateExercise, removeExercise } = useFitness()
  const [editing, setEditing] = useState(false)
  const change = delta(ex.history)

  if (editing) {
    return (
      <ExerciseForm initial={ex}
        onSave={async (fields) => { await updateExercise(ex.id, fields); setEditing(false) }}
        onCancel={() => setEditing(false)}
        onDelete={() => window.confirm(`Delete ${ex.name}? Its history goes too.`) && removeExercise(ex.id)} />
    )
  }
  return (
    <button onClick={() => setEditing(true)} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 0',
      background: 'none', border: 'none', borderTop: '1px solid var(--bd-xs)', cursor: 'pointer',
      fontFamily: 'inherit', textAlign: 'left', color: 'var(--ink)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ex.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {ex.sets || ex.reps ? `${ex.sets ?? '?'} × ${ex.reps || '?'}` : 'No sets logged'}
          {change && <span style={{ color: change.d > 0 ? '#4f7f45' : 'var(--muted)' }}>
            {` · ${change.d > 0 ? '+' : ''}${change.d} kg since ${weekLabel(change.since)}`}
          </span>}
        </div>
      </div>
      <Sparkline history={ex.history} color={color} />
      <div style={{ fontFamily: "'Newsreader', serif", fontSize: 16, fontWeight: 600, minWidth: 62, textAlign: 'right', flex: 'none' }}>
        {ex.weight != null ? `${ex.weight} ${ex.unit}` : 'BW'}
      </div>
    </button>
  )
}

function GymCard() {
  const isMobile = useIsMobile()
  const { sections, addSection, renameSection, removeSection, addExercise } = useFitness()
  const [addingTo, setAddingTo] = useState(null)
  const [newSection, setNewSection] = useState(null)
  const [renaming, setRenaming] = useState(null)
  useQuickAdd('Add day', () => setNewSection(''))

  const nextColor = SECTION_COLORS[sections.length % SECTION_COLORS.length]

  const startPPL = async () => {
    for (const [i, name] of ['Push', 'Pull', 'Legs'].entries()) {
      await addSection(name, SECTION_COLORS[i])
    }
  }

  return (
    <div style={{ ...card, padding: isMobile ? '18px 16px' : '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={h2}>Lifts</h2>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--faint)', marginBottom: 8, lineHeight: 1.5 }}>
        Tap an exercise to update what you're on. A change to the weight or sets is
        kept as progression; renaming isn't.
      </div>

      {sections.length === 0 && newSection === null && (
        <div style={{ padding: '18px 0 6px' }}>
          <div style={{ fontSize: 13, color: 'var(--mid)', marginBottom: 12 }}>No training days yet.</div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <button onClick={startPPL} style={linkBtn}>Start with Push / Pull / Legs</button>
            <button onClick={() => setNewSection('')} style={{ ...linkBtn, color: 'var(--mid)' }}>Add a custom day</button>
          </div>
        </div>
      )}

      {sections.map(s => (
        <div key={s.id} style={{ marginTop: 14 }}>
          {/* The divider: one list, sectioned by training day. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `2px solid ${s.color}` }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flex: 'none' }} />
            {renaming === s.id ? (
              <form onSubmit={e => { e.preventDefault(); const v = e.target.elements.n.value.trim(); if (v) renameSection(s.id, v); setRenaming(null) }} style={{ flex: 1 }}>
                <input name="n" autoFocus defaultValue={s.name} onBlur={() => setRenaming(null)} style={{ ...inp, padding: '4px 8px' }} />
              </form>
            ) : (
              <button onClick={() => setRenaming(s.id)} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'text', fontFamily: 'inherit' }}>
                <span style={{ ...eyebrow, color: 'var(--ink)', fontSize: 12 }}>{s.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--faint)', marginLeft: 8 }}>{s.exercises.length}</span>
              </button>
            )}
            <button onClick={() => setAddingTo(s.id)} style={linkBtn}>+ Add</button>
            <button onClick={() => window.confirm(`Delete ${s.name} and its ${s.exercises.length} exercises?`) && removeSection(s.id)}
              aria-label={`Delete ${s.name}`}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 16, lineHeight: 1, padding: '0 2px', minWidth: 22 }}>×</button>
          </div>

          {s.exercises.map(ex => <ExerciseRow key={ex.id} ex={ex} color={s.color} />)}

          {s.exercises.length === 0 && addingTo !== s.id && (
            <div style={{ fontSize: 12.5, color: 'var(--faint)', padding: '10px 0' }}>No exercises yet.</div>
          )}
          {addingTo === s.id && (
            <ExerciseForm
              onSave={async (fields) => { await addExercise(s.id, fields); setAddingTo(null) }}
              onCancel={() => setAddingTo(null)} />
          )}
        </div>
      ))}

      {newSection !== null && (
        <form onSubmit={e => { e.preventDefault(); if (newSection.trim()) addSection(newSection.trim(), nextColor); setNewSection(null) }}
          style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <input autoFocus value={newSection} onChange={e => setNewSection(e.target.value)} placeholder="e.g. Upper, Full body"
            onKeyDown={e => e.key === 'Escape' && setNewSection(null)} style={{ ...inp, flex: 1 }} />
          <button type="button" onClick={() => setNewSection(null)} style={{ ...linkBtn, color: 'var(--mid)' }}>Cancel</button>
          <button type="submit" style={linkBtn}>Add</button>
        </form>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FitnessPage() {
  const isMobile = useIsMobile()
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: isMobile ? 26 : 34, fontWeight: 500 }}>Fitness</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--mid)' }}>Weekly swim, run and ride volume, and what you're lifting.</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.45fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <StravaCard />
        <GymCard />
      </div>
    </div>
  )
}
