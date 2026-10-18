import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { API } from '../context/InboxContext.jsx'
import { useAssistant } from '../context/AssistantContext.jsx'

// Who you're talking to: Atlas, or one of your agents (Agents page). Picking
// someone else starts a new chat with them. Hidden until you have an agent of
// your own. The Researcher and Coder aren't listed: they only take tasks
// handed to them.

let cache = null
const listeners = new Set()

async function loadAgents(token) {
  try {
    const r = await fetch(`${API}/agents`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return
    const { agents } = await r.json()
    cache = agents.filter(a => a.id === 'atlas' || (!a.builtin && a.enabled))
    listeners.forEach(fn => fn(cache))
  } catch { /* offline: keep what we had */ }
}

/** Agents you can talk to, kept fresh when the Agents page saves. */
export function useChatAgents() {
  const { token } = useAuth()
  const [list, setList] = useState(cache)
  useEffect(() => {
    listeners.add(setList)
    loadAgents(token)
    const reload = () => loadAgents(token)
    window.addEventListener('atlas:agents-changed', reload)
    return () => { listeners.delete(setList); window.removeEventListener('atlas:agents-changed', reload) }
  }, [token])
  return list || []
}

/** Tell pickers the list changed (the Agents page calls this after a save). */
export const agentsChanged = () => window.dispatchEvent(new Event('atlas:agents-changed'))

export function useChatAgent() {
  const { chatAgent } = useAssistant()
  const agents = useChatAgents()
  return agents.find(a => a.id === chatAgent) || { id: 'atlas', name: 'Atlas' }
}

export default function AgentPicker({ style }) {
  const { chatAgent, chooseAgent, messages, kept, busy } = useAssistant()
  const agents = useChatAgents()
  if (agents.length < 2) return null
  const current = agents.some(a => a.id === chatAgent) ? chatAgent : 'atlas'
  const pick = e => {
    const id = e.target.value
    if (messages.length && !kept && !window.confirm('Talking to someone else starts a new chat, and this one isn’t kept. Carry on?')) return
    chooseAgent(id)
  }
  return (
    <label className="agent-picker" title="Who you’re talking to" style={{ display: 'flex', alignItems: 'center', gap: 6, ...style }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>With</span>
      <select value={current} onChange={pick} disabled={busy} aria-label="Who you’re talking to"
        style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--surface)', color: 'var(--ink)',
                 fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer', maxWidth: 180 }}>
        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </label>
  )
}
