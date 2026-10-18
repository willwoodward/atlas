import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { API } from '../context/InboxContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { useFocusRequest } from '../lib/focus.js'
import { toolLabel } from '../lib/toolLabels.js'
import { Button, IconButton, BinButton, Input, Textarea, Select, Switch, PageHeader, card, eyebrow } from '../components/ui.jsx'

// The Agents page: who does the work and how. Atlas (the assistant), the
// Researcher and the Coder, plus agents of your own that Atlas can hand work
// to. Each has a model, a prompt, skills and a policy per tool: on, ask first
// (an approve card in the chat; a suggestion in the inbox for routines) or
// off. Skills are SKILL.md instructions an agent loads when one fits.
// Prompts and skills keep every version. See backend/agent_config.py.

function agentsFetch(token, path, { method = 'GET', body } = {}) {
  return fetch(`${API}/agents${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async r => {
    if (!r.ok) {
      let detail = ''
      try { detail = (await r.json()).detail } catch { /* not JSON */ }
      throw new Error(typeof detail === 'string' && detail ? detail : `Couldn't save (${r.status})`)
    }
    return r.json()
  })
}

// Changing an agent always asks first (agent/agent_settings.py ALWAYS_ASK).
const ALWAYS_ASK = new Set(['create_agent', 'update_agent', 'delete_agent'])
// Ask first makes sense where Atlas or your agents call a tool; the
// researchers and the coder work on their own, so theirs are on or off.
const CAN_ASK = id => id !== 'researcher' && id !== 'coder'

const SKILL_TEMPLATE = `---
name: New skill
description: When to use it, in one sentence. Agents read this to decide.
---

Step-by-step instructions for the job.
`

function when(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

const label = { fontSize: 12.5, fontWeight: 600, color: 'var(--mid)', marginBottom: 6, display: 'block' }
const hint = { fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.45 }
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── Bits ─────────────────────────────────────────────────────────────────────

/** On / Ask / Off for one tool. */
function Policy({ value, onChange, canAsk, locked, name }) {
  if (locked) return <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }} title="Changing an agent always asks you first">Always asks</span>
  const opts = canAsk ? ['on', 'ask', 'off'] : ['on', 'off']
  return (
    <div role="radiogroup" aria-label={`${name}: on, ask first or off`} className="policy-toggle"
      style={{ display: 'inline-flex', border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden', flex: 'none' }}>
      {opts.map(o => {
        const on = value === o
        const colour = o === 'on' ? 'var(--sage)' : o === 'ask' ? 'var(--gold)' : 'var(--muted)'
        return (
          <button key={o} type="button" role="radio" aria-checked={on} onClick={() => onChange(o)}
            style={{ padding: '4px 9px', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', border: 'none',
                     borderLeft: o === opts[0] ? 'none' : '1px solid var(--bd)',
                     background: on ? 'var(--surface-3)' : 'transparent', color: on ? colour : 'var(--muted)', fontWeight: on ? 700 : 500 }}>
            {o === 'ask' ? 'Ask' : o === 'on' ? 'On' : 'Off'}
          </button>
        )
      })}
    </div>
  )
}

function History({ versions, onRestore, current }) {
  const [open, setOpen] = useState(false)
  if (!versions?.length) return null
  return (
    <div style={{ marginTop: 8 }}>
      <Button variant="link" onClick={() => setOpen(o => !o)} style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
        {open ? 'Hide history' : `History (${versions.length})`}
      </Button>
      {open && (
        <div style={{ marginTop: 6, border: '1px solid var(--bd-sm)', borderRadius: 8, maxHeight: 200, overflowY: 'auto' }}>
          {versions.map(v => (
            <div key={v.version} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderTop: '1px solid var(--bd-2xs)', fontSize: 12.5 }}>
              <span style={{ color: 'var(--ink)' }}>{when(v.created_at)}</span>
              <span style={{ color: 'var(--muted)' }}>{v.source === 'assistant' ? 'by Atlas' : v.source === 'restore' ? 'restored' : 'by you'}</span>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(v.content || '(built-in)').slice(0, 80)}</span>
              {v.version === current
                ? <span style={{ color: 'var(--faint)' }}>Current</span>
                : <Button variant="link" onClick={() => onRestore(v.version)} style={{ fontSize: 12 }}>Restore</Button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SaveBar({ dirty, busy, error, onSave, onDiscard, saveLabel = 'Save' }) {
  if (!dirty && !error) return null
  return (
    // Right padding keeps the buttons clear of the corner mic (48px + its 16px margin).
    <div style={{ position: 'sticky', bottom: 0, zIndex: 2, marginTop: 20, padding: '12px 64px 12px 0', background: 'var(--bg)', borderTop: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ flex: 1, fontSize: 12.5, color: error ? 'var(--accent)' : 'var(--muted)' }}>{error || 'Unsaved changes'}</span>
      {dirty && <Button variant="ghost" onClick={onDiscard} disabled={busy}>Discard</Button>}
      {dirty && <Button variant="primary" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : saveLabel}</Button>}
    </div>
  )
}

// ── An agent ─────────────────────────────────────────────────────────────────

function ToolList({ agentId, tools, policies, defaultPolicy, onChange }) {
  const [q, setQ] = useState('')
  const canAsk = CAN_ASK(agentId)
  const shown = tools.filter(t => !q || (t.name + ' ' + t.description + ' ' + toolLabel(t.name)).toLowerCase().includes(q.toLowerCase()))
  const groups = shown.reduce((acc, t) => { (acc[t.group || 'Tools'] ||= []).push(t); return acc }, {})
  const policyOf = t => policies[t.name] || defaultPolicy
  const setAll = fn => onChange(Object.fromEntries(tools.filter(t => !ALWAYS_ASK.has(t.name)).map(t => [t.name, fn(t)])))
  const counts = tools.reduce((c, t) => { c[policyOf(t)] = (c[policyOf(t)] || 0) + 1; return c }, {})
  if (!tools.length) return <div style={hint}>—</div>
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter tools…" aria-label="Filter tools" style={{ flex: '1 1 180px', fontSize: 13 }} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{counts.on || 0} on{canAsk ? ` · ${counts.ask || 0} ask` : ''} · {counts.off || 0} off</span>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <Button variant="link" onClick={() => setAll(() => 'on')} style={{ fontSize: 12 }}>All on</Button>
        {canAsk && <Button variant="link" onClick={() => setAll(t => (t.writes ? 'ask' : 'on'))} style={{ fontSize: 12 }} title="Reading is on; anything that changes your data asks first">Changes ask first</Button>}
        {canAsk && <Button variant="link" onClick={() => setAll(t => (t.writes ? 'off' : 'on'))} style={{ fontSize: 12 }}>Read-only</Button>}
        <Button variant="link" onClick={() => setAll(() => 'off')} style={{ fontSize: 12 }}>All off</Button>
      </div>
      <div style={{ ...card, padding: 0, borderRadius: 10, overflow: 'hidden' }}>
        {Object.entries(groups).map(([g, list]) => (
          <div key={g}>
            <div style={{ ...eyebrow, padding: '10px 12px 6px', background: 'var(--surface-2)', borderBottom: '1px solid var(--bd-sm)' }}>{g}</div>
            {list.map(t => (
              <div key={t.name} className="agent-tool-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderBottom: '1px solid var(--bd-2xs)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                    {toolLabel(t.name)}
                    {t.writes && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', color: 'var(--gold)', textTransform: 'uppercase' }}>changes</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.description}>
                    <code style={{ fontSize: 11, color: 'var(--faint)' }}>{t.name}</code>{t.description ? ` · ${t.description}` : ''}
                  </div>
                </div>
                <Policy name={toolLabel(t.name)} value={policyOf(t)} canAsk={canAsk} locked={ALWAYS_ASK.has(t.name)}
                  onChange={p => onChange({ [t.name]: p })} />
              </div>
            ))}
          </div>
        ))}
        {!shown.length && <div style={{ padding: 14, fontSize: 13, color: 'var(--muted)' }}>No tools match.</div>}
      </div>
    </div>
  )
}

function AgentEditor({ token, id, catalog, skills, onSaved, onDeleted, isMobile }) {
  const isNew = id === 'new'
  const [agent, setAgent] = useState(null)   // as saved
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const builtinPrompt = catalog?.defaults?.[id]?.prompt
  const load = () => {
    if (isNew) {
      const fresh = { id: 'new', name: '', description: '', builtin: false, enabled: true, model: '', reasoning: '', tools: {}, skills: [], prompt: '', engine: 'strands' }
      setAgent(fresh); setDraft(fresh); return Promise.resolve()
    }
    return agentsFetch(token, `/${id}`).then(a => { setAgent(a); setDraft(a); setError(null) }).catch(e => setError(e.message))
  }
  useEffect(() => { setAgent(null); setDraft(null); load() }, [id]) // eslint-disable-line

  if (!draft) return <div style={{ fontSize: 13, color: error ? 'var(--accent)' : 'var(--muted)' }}>{error || 'Loading…'}</div>

  const set = patch => setDraft(d => ({ ...d, ...patch }))
  // A built-in with no prompt of its own uses its built-in one: show that, and
  // only store it if it's changed.
  const usingBuiltin = !draft.prompt && !!builtinPrompt && id !== 'atlas'
  const promptValue = usingBuiltin ? builtinPrompt : draft.prompt
  const kind = id === 'atlas' || id === 'researcher' || id === 'coder' ? id : 'custom'
  const tools = catalog?.tools?.[kind] || []
  const defaultPolicy = draft.builtin ? 'on' : 'off'
  const fields = ['name', 'description', 'model', 'reasoning', 'tools', 'skills', 'enabled', 'prompt']
  const dirty = fields.some(k => !sameJSON(draft[k], agent[k]))

  const save = async () => {
    setBusy(true); setError(null)
    try {
      const body = Object.fromEntries(fields.filter(k => !sameJSON(draft[k], agent[k])).map(k => [k, draft[k]]))
      if (draft.builtin) delete body.name
      if (isNew) {
        const made = await agentsFetch(token, '', { method: 'POST', body: { ...body, name: draft.name } })
        onSaved(made.id)
      } else {
        const saved = await agentsFetch(token, `/${id}`, { method: 'PUT', body })
        setAgent(saved); setDraft(saved); onSaved(id); load()
      }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const restore = async version => {
    setBusy(true); setError(null)
    try {
      await agentsFetch(token, `/${id}/prompt/restore`, { method: 'POST', ...(version ? { body: { version } } : {}) })
      await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm(`Delete “${agent.name}”? Atlas won't be able to hand it work any more.`)) return
    try { await agentsFetch(token, `/${id}`, { method: 'DELETE' }); onDeleted() } catch (e) { setError(e.message) }
  }

  const defaultReasoning = catalog?.defaults?.[id]?.reasoning
  const modelsInUse = [catalog?.default_model, draft.model].filter(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {draft.builtin
            ? <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 500, color: 'var(--ink)' }}>{draft.name}</h2>
            : <Input value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="Name, e.g. Finance analyst" aria-label="Agent name" maxLength={60}
                autoFocus={isNew} style={{ width: '100%', fontSize: 18, fontFamily: 'var(--font-serif)' }} />}
          <div style={{ ...hint, marginTop: 6 }}>{draft.builtin ? 'Built in' : isNew ? 'A new agent of your own' : 'Yours'} · Strands Agents engine</div>
        </div>
        {!draft.builtin && !isNew && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
            <span style={{ fontSize: 12.5, color: 'var(--mid)' }}>{draft.enabled ? 'On' : 'Off'}</span>
            <Switch checked={draft.enabled} onChange={v => set({ enabled: v })} label="Atlas can hand it work" />
            <BinButton aria-label={`Delete ${agent.name}`} onClick={remove} />
          </div>
        )}
      </div>

      <label>
        <span style={label}>What it’s for</span>
        {draft.builtin
          ? <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{draft.description}</div>
          : <>
              <Textarea value={draft.description} onChange={e => set({ description: e.target.value })} rows={2} maxLength={600} style={{ width: '100%', fontSize: 13.5 }}
                placeholder="e.g. Looks into my spending and budgets and suggests where to cut back." />
              <div style={hint}>Atlas reads this to decide when to hand it a task.</div>
            </>}
      </label>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <label style={{ flex: '1 1 220px' }}>
          <span style={label}>Model</span>
          <Input value={draft.model} onChange={e => set({ model: e.target.value.trim() })} list="agent-models" aria-label="Model"
            placeholder={catalog?.default_model ? `Default (${catalog.default_model})` : 'Default'} style={{ width: '100%' }} />
          <datalist id="agent-models">{[...new Set(modelsInUse)].map(m => <option key={m} value={m} />)}</datalist>
          <div style={hint}>Any model id the server's OpenAI key can use. Blank for the default.</div>
        </label>
        <label style={{ flex: '0 1 200px' }}>
          <span style={label}>Reasoning</span>
          <Select value={draft.reasoning} onChange={e => set({ reasoning: e.target.value })} aria-label="Reasoning effort" style={{ width: '100%' }}>
            {(catalog?.reasoning || ['']).map(r => <option key={r} value={r}>{r ? r[0].toUpperCase() + r.slice(1) : `Default${defaultReasoning ? ` (${defaultReasoning})` : ''}`}</option>)}
          </Select>
          {id === 'atlas' && <div style={hint}>Spoken turns stay quick (low) whatever this says.</div>}
        </label>
      </div>

      <div>
        <span style={label}>{id === 'atlas' ? 'System prompt' : 'Prompt'}</span>
        <Textarea value={promptValue || ''} onChange={e => set({ prompt: e.target.value === builtinPrompt && id !== 'atlas' ? '' : e.target.value })}
          rows={isMobile ? 10 : 14} aria-label="Prompt" style={{ width: '100%', fontSize: 12.5, lineHeight: 1.55, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          placeholder={draft.builtin ? '—' : 'How it should work: what to look at, how to answer. It gets the task from Atlas.'} />
        <div style={{ ...hint, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span style={{ flex: 1, minWidth: 200 }}>
            {id === 'atlas' ? 'The same as Assistant settings → System prompt. {name} and {today} are filled in; changes apply from your next conversation.'
              : usingBuiltin ? `The built-in prompt. ${catalog?.defaults?.[id]?.note || ''}`
              : draft.builtin ? `Your own version. ${catalog?.defaults?.[id]?.note || ''}`
              : 'Atlas adds who it is working for and today’s date.'}
          </span>
          {draft.builtin && id !== 'atlas' && !usingBuiltin && builtinPrompt && (
            <Button variant="link" onClick={() => set({ prompt: '' })} style={{ fontSize: 12 }}>Use the built-in prompt</Button>
          )}
          {id === 'atlas' && catalog?.defaults?.atlas?.prompt && draft.prompt !== catalog.defaults.atlas.prompt && (
            <Button variant="link" onClick={() => set({ prompt: catalog.defaults.atlas.prompt })} style={{ fontSize: 12 }}>Reset to the default</Button>
          )}
        </div>
        {!isNew && <History versions={agent.prompt_history} current={agent.prompt_version} onRestore={restore} />}
      </div>

      <div>
        <span style={label}>Skills</span>
        {skills.length === 0
          ? <div style={hint}>No skills yet. Make one under Skills.</div>
          : <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {skills.map(s => {
                const on = draft.skills.includes(s.id)
                return (
                  <button key={s.id} type="button" aria-pressed={on} title={s.description}
                    onClick={() => set({ skills: on ? draft.skills.filter(x => x !== s.id) : [...draft.skills, s.id] })}
                    style={{ padding: '5px 11px', borderRadius: 99, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer',
                             border: `1px solid ${on ? 'var(--accent-line)' : 'var(--bd)'}`, background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent)' : 'var(--mid)' }}>
                    {on ? '✓ ' : ''}{s.name}
                  </button>
                )
              })}
            </div>}
        <div style={hint}>It sees each skill’s name and description, and loads the full instructions when one fits.</div>
      </div>

      <div>
        <span style={label}>Tools</span>
        {!catalog?.agent_service && id !== 'custom' && (
          <div style={{ ...hint, marginBottom: 8, color: 'var(--accent)' }}>The agent service isn’t reachable, so only Atlas’s own data tools are listed.</div>
        )}
        <div style={{ ...hint, marginTop: 0, marginBottom: 10 }}>
          {CAN_ASK(id)
            ? <>On: uses it freely. <b>Ask</b>: checks with you first, with an approve card in the chat (in a routine, it becomes a suggestion in the inbox). Off: it doesn’t have it.{!draft.builtin && ' Your own agents only get the tools you turn on.'}</>
            : 'On or off. This agent works on its own once Atlas sends it, so there’s no asking first.'}
        </div>
        <ToolList agentId={id} tools={tools} policies={draft.tools} defaultPolicy={defaultPolicy}
          onChange={patch => set({ tools: { ...draft.tools, ...patch } })} />
      </div>

      <SaveBar dirty={dirty || isNew} busy={busy} error={error} onSave={save} saveLabel={isNew ? 'Create agent' : 'Save'}
        onDiscard={() => (isNew ? onDeleted() : (setDraft(agent), setError(null)))} />
    </div>
  )
}

// ── A skill ──────────────────────────────────────────────────────────────────

function parseSkill(text) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text || '')
  const meta = {}
  if (m) m[1].split('\n').forEach(l => { const i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim() })
  return { name: meta.name || '', description: meta.description || '' }
}

function SkillEditor({ token, id, agents, onSaved, onDeleted, isMobile }) {
  const isNew = id === 'new'
  const [skill, setSkill] = useState(null)
  const [text, setText] = useState('')
  const [users, setUsers] = useState([])   // agent ids that have it
  const [usersTouched, setUsersTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const holders = useMemo(() => agents.filter(a => a.skills.includes(id)).map(a => a.id), [agents, id])

  const load = () => {
    if (isNew) { setSkill({ content: SKILL_TEMPLATE }); setText(SKILL_TEMPLATE); setUsers(['atlas']); return Promise.resolve() }
    return agentsFetch(token, `/skills/${id}`).then(s => { setSkill(s); setText(s.content); setError(null) }).catch(e => setError(e.message))
  }
  useEffect(() => { setSkill(null); setUsersTouched(false); load() }, [id]) // eslint-disable-line
  // Who has it follows the saved state until you change it here.
  useEffect(() => { if (!isNew && !usersTouched) setUsers(holders) }, [holders]) // eslint-disable-line

  if (!skill) return <div style={{ fontSize: 13, color: error ? 'var(--accent)' : 'var(--muted)' }}>{error || 'Loading…'}</div>
  const meta = parseSkill(text)
  const dirty = isNew || text !== skill.content || !sameJSON([...users].sort(), [...holders].sort())

  const save = async () => {
    setBusy(true); setError(null)
    try {
      let sid = id
      if (isNew) sid = (await agentsFetch(token, '/skills', { method: 'POST', body: { content: text } })).id
      else if (text !== skill.content) await agentsFetch(token, `/skills/${id}`, { method: 'PUT', body: { content: text } })
      // Give it to the agents ticked, take it from the rest.
      for (const a of agents) {
        const has = a.skills.includes(sid), want = users.includes(a.id)
        if (has !== want) await agentsFetch(token, `/${a.id}`, { method: 'PUT', body: { skills: want ? [...a.skills, sid] : a.skills.filter(x => x !== sid) } })
      }
      setUsersTouched(false)
      onSaved(sid)
      if (!isNew) await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const restore = async version => {
    setBusy(true)
    try { await agentsFetch(token, `/skills/${id}/restore`, { method: 'POST', body: { version } }); await load(); onSaved(id) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm(`Delete the skill “${skill.name}”? Agents that have it stop seeing it.`)) return
    try { await agentsFetch(token, `/skills/${id}`, { method: 'DELETE' }); onDeleted() } catch (e) { setError(e.message) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 500, color: meta.name ? 'var(--ink)' : 'var(--faint)' }}>{meta.name || 'Untitled skill'}</h2>
          <div style={{ ...hint, marginTop: 6 }}>{meta.description || 'Add a description in the frontmatter.'}</div>
        </div>
        {!isNew && <BinButton aria-label={`Delete the skill ${skill.name}`} onClick={remove} />}
      </div>
      <div>
        <span style={label}>SKILL.md</span>
        <Textarea value={text} onChange={e => setText(e.target.value)} rows={isMobile ? 14 : 20} aria-label="SKILL.md"
          style={{ width: '100%', fontSize: 12.5, lineHeight: 1.55, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} />
        <div style={hint}>Frontmatter with a name and a description (when to use it), then the instructions. Markdown.</div>
        {!isNew && <History versions={skill.history} current={skill.version} onRestore={restore} />}
      </div>
      <div>
        <span style={label}>Who has it</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {agents.map(a => {
            const on = users.includes(a.id)
            return (
              <button key={a.id} type="button" aria-pressed={on} onClick={() => { setUsersTouched(true); setUsers(u => (on ? u.filter(x => x !== a.id) : [...u, a.id])) }}
                style={{ padding: '5px 11px', borderRadius: 99, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer',
                         border: `1px solid ${on ? 'var(--accent-line)' : 'var(--bd)'}`, background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent)' : 'var(--mid)' }}>
                {on ? '✓ ' : ''}{a.name}
              </button>
            )
          })}
        </div>
      </div>
      <SaveBar dirty={dirty} busy={busy} error={error} onSave={save} saveLabel={isNew ? 'Create skill' : 'Save'}
        onDiscard={() => (isNew ? onDeleted() : (setText(skill.content), setUsers(holders), setUsersTouched(false), setError(null)))} />
    </div>
  )
}

// ── The page ─────────────────────────────────────────────────────────────────

function ListItem({ active, onClick, title, sub, badge, off }) {
  return (
    <button onClick={onClick} className="nav-btn" aria-current={active ? 'page' : undefined}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 11px', border: 'none', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit',
               ...(active ? { background: 'var(--surface-3)', color: 'var(--ink)' } : {}) }}>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: active ? 600 : 500, color: off ? 'var(--muted)' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {badge && <span style={{ fontSize: 10.5, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{badge}</span>}
      </span>
      {sub && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
    </button>
  )
}

export default function AgentsPage() {
  const { token } = useAuth()
  const isMobile = useIsMobile()
  const [data, setData] = useState(null)       // {agents, skills}
  const [catalog, setCatalog] = useState(null)
  const [sel, setSel] = useState(isMobile ? null : { kind: 'agent', id: 'atlas' })
  const [error, setError] = useState(null)

  const load = () => agentsFetch(token, '').then(d => { setData(d); setError(null); return d }).catch(e => setError(e.message))
  useEffect(() => {
    load()
    agentsFetch(token, '/catalog').then(setCatalog).catch(() => setCatalog({ tools: {}, defaults: {}, reasoning: [''] }))
  }, []) // eslint-disable-line
  // "Show me the researcher" / a change Atlas made to an agent or skill.
  useFocusRequest(['agent', 'skill'], t => { setSel({ kind: t.kind, id: t.id }); load() })

  const agents = data?.agents || []
  const skills = data?.skills || []
  const sub = a => a.builtin
    ? [a.model || 'Default model', a.skills.length ? `${a.skills.length} skill${a.skills.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')
    : (a.description || '—')

  const list = (
    <nav aria-label="Agents and skills" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ ...eyebrow, padding: '0 11px 6px' }}>Agents</div>
      {agents.map(a => (
        <ListItem key={a.id} active={sel?.kind === 'agent' && sel.id === a.id} onClick={() => setSel({ kind: 'agent', id: a.id })}
          title={a.name} sub={sub(a)} badge={a.builtin ? null : a.enabled ? null : 'off'} off={!a.enabled} />
      ))}
      <Button variant="link" onClick={() => setSel({ kind: 'agent', id: 'new' })} style={{ fontSize: 12.5, padding: '8px 11px', justifyContent: 'flex-start' }}>+ New agent</Button>
      <div style={{ ...eyebrow, padding: '18px 11px 6px' }}>Skills</div>
      {skills.length === 0 && <div style={{ padding: '2px 11px 4px', fontSize: 12.5, color: 'var(--muted)' }}>None yet.</div>}
      {skills.map(s => (
        <ListItem key={s.id} active={sel?.kind === 'skill' && sel.id === s.id} onClick={() => setSel({ kind: 'skill', id: s.id })}
          title={s.name} sub={s.description} />
      ))}
      <Button variant="link" onClick={() => setSel({ kind: 'skill', id: 'new' })} style={{ fontSize: 12.5, padding: '8px 11px', justifyContent: 'flex-start' }}>+ New skill</Button>
    </nav>
  )

  const editor = sel && data && (sel.kind === 'agent'
    ? <AgentEditor key={`a-${sel.id}`} token={token} id={sel.id} catalog={catalog} skills={skills} isMobile={isMobile}
        onSaved={newId => { load(); if (newId !== sel.id) setSel({ kind: 'agent', id: newId }) }}
        onDeleted={() => { load(); setSel(isMobile ? null : { kind: 'agent', id: 'atlas' }) }} />
    : <SkillEditor key={`s-${sel.id}`} token={token} id={sel.id} agents={agents} isMobile={isMobile}
        onSaved={newId => { load(); if (newId !== sel.id) setSel({ kind: 'skill', id: newId }) }}
        onDeleted={() => { load(); setSel(isMobile ? null : { kind: 'agent', id: 'atlas' }) }} />)

  return (
    <div>
      <PageHeader title="Agents" isMobile={isMobile}
        subtitle={isMobile && sel ? null : 'Who does the work: their models, prompts, skills and what they’re allowed to do.'} />
      {error && <div style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 12 }}>{error}</div>}
      {!data && !error && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}
      {data && (isMobile
        ? (sel
            ? <>
                <IconButton aria-label="Back to agents" onClick={() => setSel(null)} style={{ marginBottom: 12 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                </IconButton>
                {editor}
              </>
            : list)
        : (
          <div style={{ display: 'grid', gridTemplateColumns: '230px minmax(0, 1fr)', gap: 36, alignItems: 'start' }}>
            <div style={{ position: 'sticky', top: 0 }}>{list}</div>
            <div>{editor}</div>
          </div>
        ))}
    </div>
  )
}
