import { useState } from 'react'
import { Button } from './ui.jsx'
import { toolLabel } from '../lib/toolLabels.js'

// "Ask first": a tool set to ask on the Agents page, waiting for a yes. The
// run is paused on it (like a question); Approve lets the call go ahead,
// Reject cancels it and the agent hears that you said no.

const short = v => {
  if (v === null || v === undefined || v === '') return '—'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 160 ? s.slice(0, 157) + '…' : s
}

/** What it wants to do: the API's words ("Delete to-do “Renew passport”"),
 * else the tool's label ("Deleting a to-do"). */
export const approvalTitle = q => q.summary || toolLabel(q.tool || '')
const who = q => q.agent || 'Atlas'

export default function ApprovalCard({ question, runId, onAnswer, compact = false }) {
  const [sending, setSending] = useState(null)
  const [failed, setFailed] = useState(null)
  const decide = async choice => {
    setSending(choice); setFailed(null)
    try { await onAnswer(runId, question.id, choice) } catch (e) { setFailed(e.message || 'Could not send that.') } finally { setSending(null) }
  }
  const entries = Object.entries(question.input || {}).filter(([, v]) => v !== undefined)

  if (question.status !== 'open') {
    const yes = /^approve/i.test(question.answer || '')
    return (
      <div className="approval-card approval-card-done" style={{ margin: '8px 0', fontSize: 12.5, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'baseline' }}>
        <span style={{ color: question.status === 'timeout' ? 'var(--faint)' : yes ? 'var(--sage)' : 'var(--accent)', fontWeight: 600 }}>
          {question.status === 'timeout' ? 'Not answered' : yes ? 'Approved' : 'Rejected'}
        </span>
        <span>{approvalTitle(question)}{question.agent && question.agent !== 'Atlas' ? ` (${question.agent})` : ''}</span>
      </div>
    )
  }
  return (
    <div className="approval-card" role="group" aria-label="Approve this change?"
      style={{ margin: '10px 0', padding: compact ? 10 : 12, borderRadius: 'var(--radius)', background: 'var(--surface)', border: '1px solid var(--accent-line)' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 4 }}>{who(question)} asks first</div>
      <div style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 500, marginBottom: entries.length ? 8 : 10 }}>{approvalTitle(question)}</div>
      {entries.length > 0 && !compact && (() => {
        const list = (
          <dl style={{ margin: '6px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px', fontSize: 12.5 }}>
            {entries.slice(0, 10).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--muted)' }}>{k.replace(/_/g, ' ')}</dt>
                <dd style={{ margin: 0, color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>{short(v)}</dd>
              </div>
            ))}
          </dl>
        )
        // With a summary the details are a click away; without one they're what there is.
        return question.summary
          ? <details style={{ margin: '-4px 0 10px', fontSize: 12 }}><summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Details · <code style={{ fontSize: 11 }}>{question.tool}</code></summary>{list}</details>
          : <div style={{ marginBottom: 10 }}>{list}</div>
      })()}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" size="sm" onClick={() => decide('Approve')} disabled={!!sending}>{sending === 'Approve' ? '…' : 'Approve'}</Button>
        <Button variant="ghost" size="sm" onClick={() => decide('Reject')} disabled={!!sending}>{sending === 'Reject' ? '…' : 'Reject'}</Button>
      </div>
      {failed && <div style={{ fontSize: 11.5, color: 'var(--accent)', marginTop: 6 }}>{failed}</div>}
    </div>
  )
}
