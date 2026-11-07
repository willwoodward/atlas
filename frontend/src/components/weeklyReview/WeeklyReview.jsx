import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGoals } from '../../context/GoalsContext.jsx'
import { useIntegrations } from '../../context/IntegrationsContext.jsx'
import { useCalendarEvents } from '../../hooks/useCalendarEvents.js'
import { useIsMobile } from '../../hooks/useIsMobile.js'
import { getWeekRange } from '../../integrations/googleCalendar.js'
import { formatWeekRange } from '../../lib/week.js'
import { STEPS, goalHoursFor, weeksAgo } from '../../lib/weeklyReview.js'
import { Button, IconButton, eyebrow } from '../ui.jsx'
import GoalsStep from './GoalsStep.jsx'
import HabitsStep from './HabitsStep.jsx'
import MoneyStep from './MoneyStep.jsx'
import OverviewStep from './OverviewStep.jsx'
import PlanStep from './PlanStep.jsx'
import TodosStep from './TodosStep.jsx'
import { REVIEW_CSS } from './shared.jsx'
import { useRecap } from './useRecap.js'

// The review itself: a full-screen flow with no sidebar or header, so there is
// only the one thing on screen. Goals lead (they decide what the to-dos and
// habits are for), then money, habits and to-dos, ending in a reflection and a
// plan. Each step is the same recap seen through one lens, with Atlas's
// observations; where something can be fixed on the spot, it can.

const stepKey = (week) => `atlas:weekly-review:${week}`
const readStep = (week) => { try { return Math.min(Math.max(Number(localStorage.getItem(stepKey(week))) || 0, 0), STEPS.length - 1) } catch { return 0 } }

const typing = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

export default function WeeklyReview({ week, onClose, onComplete }) {
  const isMobile = useIsMobile()
  const { goals } = useGoals()
  const { gcal, loadWeeks } = useIntegrations()
  const events = useCalendarEvents()
  const { recap, error, reload, narrative, narrate } = useRecap(week)

  const [step, setStep] = useState(() => readStep(week))
  const [done, setDone] = useState(false)
  const [todoMemo, setTodoMemo] = useState({ items: null, decisions: {} })
  const scroller = useRef(null)

  useEffect(() => { try { localStorage.setItem(stepKey(week), String(step)) } catch { /* not kept */ } }, [week, step])
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [step, done])

  // Hours on each goal come from the calendar, which only the app can see; the
  // week may be one that isn't loaded yet.
  const [calendarReady, setCalendarReady] = useState(!gcal.connected)
  useEffect(() => {
    if (!gcal.connected) { setCalendarReady(true); return }
    let live = true
    loadWeeks(Array.from({ length: 5 }, (_, i) => getWeekRange(-weeksAgo(week) - i))).finally(() => live && setCalendarReady(true))
    return () => { live = false }
  }, [gcal.connected, week]) // eslint-disable-line react-hooks/exhaustive-deps
  // Only when the calendar is connected and goals have tags; otherwise there is
  // nothing to say, and zero hours would read as a finding.
  const goalHours = useMemo(
    () => (gcal.connected && goals.some(g => (g.tags || '').trim()) ? goalHoursFor(events, goals, week) : []),
    [events, goals, week, gcal.connected])

  // The commentary is written once the recap and calendar are in.
  const narrated = useRef(false)
  useEffect(() => {
    if (!recap || !calendarReady || narrated.current) return
    narrated.current = true
    narrate(goalHours)
  }, [recap, calendarReady]) // eslint-disable-line react-hooks/exhaustive-deps
  // After an import the figures changed, so the commentary is written again.
  const reloadAndRenarrate = useCallback(async () => {
    const fresh = await reload()
    if (fresh) narrate(goalHours, true)
  }, [reload, narrate, goalHours])

  const last = step === STEPS.length - 1
  const go = useCallback((n) => setStep(s => Math.min(Math.max(s + n, 0), STEPS.length - 1)), [])
  const finish = useCallback(async () => { await onComplete(week); setDone(true) }, [onComplete, week])

  // ← → move between steps; Esc leaves (the work is saved as you go). Both
  // stand down while a dialog (the statement import) is open or you're typing.
  useEffect(() => {
    const onKey = (e) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (e.key === 'Escape') {
        if (typing(document.activeElement)) document.activeElement.blur()
        else onClose()
      } else if (!typing(document.activeElement) && !e.metaKey && !e.ctrlKey && !e.altKey && !done) {
        if (e.key === 'ArrowRight' && !last) go(1)
        if (e.key === 'ArrowLeft') go(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, last, onClose, done])

  const body = (() => {
    if (error && !recap) return <p style={{ color: 'var(--accent)', fontSize: 15 }}>Couldn't load the week: {error}. <button type="button" onClick={reload} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: 'var(--accent)', cursor: 'pointer' }}>Try again</button></p>
    if (!recap) return <p style={{ color: 'var(--muted)', fontSize: 15 }}>Reading your week…</p>
    const props = { week, recap, narrative, goalHours, reload: reloadAndRenarrate }
    switch (STEPS[step].id) {
      case 'week':   return <OverviewStep {...props} />
      case 'goals':  return <GoalsStep {...props} />
      case 'money':  return <MoneyStep {...props} />
      case 'habits': return <HabitsStep {...props} reload={reload} />
      case 'todos':  return <TodosStep {...props} memo={todoMemo} setMemo={setTodoMemo} />
      default:       return <PlanStep {...props} />
    }
  })()

  return (
    <div role="region" aria-label="Weekly review"
      style={{ position: 'fixed', inset: 0, zIndex: 160, background: 'var(--bg)', color: 'var(--ink)', display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
      <style>{REVIEW_CSS}</style>

      <header style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 22, padding: isMobile ? '14px 16px 8px' : '20px 32px 10px' }}>
        <IconButton size={36} onClick={onClose} aria-label="Leave the review" title="Leave (your progress is saved)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
        </IconButton>
        {!done && (
          <nav aria-label="Steps" style={{ flex: 1, display: 'flex', gap: isMobile ? 5 : 8, maxWidth: 720, margin: '0 auto' }}>
            {STEPS.map((s, i) => (
              <button key={s.id} type="button" onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined} title={s.label}
                style={{ flex: 1, minWidth: 0, padding: '8px 0 0', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                <div style={{ height: 4, borderRadius: 99, background: i <= step ? 'var(--accent)' : 'var(--surface-3)', opacity: i < step ? .55 : 1, transition: 'background .3s, opacity .3s' }} />
                {!isMobile && <div style={{ marginTop: 7, fontSize: 11.5, fontWeight: i === step ? 600 : 500, color: i === step ? 'var(--ink)' : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</div>}
              </button>
            ))}
          </nav>
        )}
        <div style={{ ...eyebrow, flex: done ? 1 : 'none', textAlign: 'right', whiteSpace: 'nowrap' }}>{isMobile ? '' : `Weekly review · ${formatWeekRange(week)}`}</div>
      </header>

      <main ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div key={done ? 'done' : STEPS[step].id} style={{ maxWidth: 760, margin: '0 auto', padding: isMobile ? '22px 18px 40px' : '34px 32px 60px' }}>
          {done ? <Finished week={week} onClose={onClose} /> : body}
        </div>
      </main>

      {!done && (
        <footer style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: isMobile ? '12px 16px calc(14px + env(safe-area-inset-bottom))' : '14px 32px 20px', borderTop: '1px solid var(--bd-sm)', background: 'var(--bg-blur, var(--bg))' }}>
          <Button variant="ghost" size="lg" onClick={() => go(-1)} disabled={step === 0} style={{ visibility: step === 0 ? 'hidden' : 'visible' }}>Back</Button>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{step + 1} of {STEPS.length}</span>
          {last
            ? <Button variant="primary" size="lg" raised onClick={finish}>Finish review</Button>
            : <Button variant="primary" size="lg" raised onClick={() => go(1)} disabled={!recap}>Continue</Button>}
        </footer>
      )}
    </div>
  )
}

function Finished({ week, onClose }) {
  return (
    <div style={{ minHeight: '52vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div className="wr-pop" style={{ width: 54, height: 54, borderRadius: '50%', background: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 22 }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4 10-11" /></svg>
      </div>
      <div className="wr-rise" style={{ '--d': '.15s' }}>
        <div style={{ ...eyebrow, color: 'var(--sage)', marginBottom: 8 }}>{formatWeekRange(week)}</div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 'clamp(30px, 5vw, 46px)', fontWeight: 500, letterSpacing: '-.015em', lineHeight: 1.12 }}>That's the week, done.</h1>
        <p style={{ margin: '14px 0 28px', fontSize: 16, lineHeight: 1.6, color: 'var(--mid)', maxWidth: 480 }}>
          Your reflection and next week's outcomes are saved, and the to-dos you decided on are where you left them. See you next Sunday.
        </p>
        <Button variant="primary" size="lg" raised onClick={onClose}>Back to Atlas</Button>
      </div>
    </div>
  )
}
