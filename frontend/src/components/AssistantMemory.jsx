import { useEffect, useState } from 'react'
import Sheet from './Sheet.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useVoiceSettings, setVoiceSettings, CONVERSATION_SILENCE, TTS_VOICES } from '../lib/voiceSettings.js'
import { speech, unlockAudio } from '../lib/speech.js'
import { useKeybinds } from '../context/KeybindsContext.jsx'
import { displayCombo } from '../lib/keybinds.js'
import { Button, Switch, Select, field, kbd } from './ui.jsx'
import { useAssistantPrefs, setAssistantPrefs } from '../lib/assistantPrefs.js'
import { useRefresh } from '../context/RefreshContext.jsx'
import { openShow } from '../lib/focus.js'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Assistant settings: the two documents the assistant works from, both of
// which it is free to rewrite itself.
//   memory — standing notes about you (routines, rules, preferences)
//   prompt — its system prompt: how it behaves
// Each save is a version on the server, so any edit (yours or its) can be
// rolled back. A conversation keeps the versions it started with; changes
// apply from the next one.

const SOURCE_LABEL = { user: 'You', assistant: 'Atlas', restore: 'Restored' }

const DOCS = {
  memory: {
    label: 'Memory',
    intro: 'Notes Atlas keeps about you (routines, rules, preferences) and updates itself as it learns.',
    placeholder: '## Routines\n- Morning routine: 1h; 1.5h on weekdays without gym, 45 min on gym days\n\n## Scheduling\n- The train into town takes 30 min; put it in the calendar before anything in town',
  },
  prompt: {
    label: 'System prompt',
    intro: 'How Atlas behaves. Atlas can edit this too. {name} and {today} are filled in when a conversation starts.',
    placeholder: '',
  },
}

function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`
}

function useDocApi(kind) {
  const { token } = useAuth()
  const call = async (path, init = {}) => {
    const res = await fetch(`${API}/assistant/${kind}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    })
    if (!res.ok) {
      let detail = ''
      try { detail = (await res.json()).detail } catch { /* not JSON */ }
      throw new Error(typeof detail === 'string' && detail ? detail : `Request failed (${res.status})`)
    }
    return res.json()
  }
  return {
    get: () => call(''),
    history: () => call('/history?limit=30'),
    save: content => call('', { method: 'PUT', body: JSON.stringify({ content }) }),
    restore: version => call('/restore', { method: 'POST', body: JSON.stringify({ version }) }),
  }
}

export function SettingsButton({ style }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} title="Atlas's memory and system prompt"
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--bd)', background: 'transparent', color: 'var(--muted)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', ...style }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>
        Settings
      </button>
      {open && <SettingsSheet onClose={() => setOpen(false)} />}
    </>
  )
}

function SettingsSheet({ onClose }) {
  const [kind, setKind] = useState('memory')
  const tabs = [...Object.entries(DOCS), ['voice', { label: 'Voice' }], ['changes', { label: 'Changes' }]]
  return (
    <Sheet title="Assistant settings" onClose={onClose} width={680} height="84vh">
      {close => <>
      <div role="tablist" style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 9, background: 'var(--surface-2)', alignSelf: 'flex-start', marginBottom: 14 }}>
        {tabs.map(([k, d]) => (
          <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
            style={{ fontSize: 12.5, padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                     background: kind === k ? 'var(--surface)' : 'transparent', color: kind === k ? 'var(--ink)' : 'var(--muted)',
                     boxShadow: kind === k ? '0 1px 3px var(--bd)' : 'none' }}>
            {d.label}
          </button>
        ))}
      </div>
      {/* Keyed so switching tabs loads the other document fresh. */}
      {kind === 'voice' ? <VoiceSettings /> : kind === 'changes' ? <ChangesLog onOpen={close} /> : <DocEditor key={kind} kind={kind} />}
      </>}
    </Sheet>
  )
}

// Everything Atlas has changed, newest first, each with Undo (and Open, where
// there's something to look at).
function ChangesLog({ onOpen }) {
  const { token } = useAuth()
  const { refresh } = useRefresh()
  const { followAlong } = useAssistantPrefs()
  const [actions, setActions] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = async () => {
    try {
      const res = await fetch(`${API}/assistant/actions?limit=50`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`Couldn't load changes (${res.status})`)
      setActions((await res.json()).actions)
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  const undo = async (a, i) => {
    const newerLive = actions.slice(0, i).some(x => x.undoable)
    if (newerLive && !window.confirm('Atlas has made changes since this one. Undo it anyway? Later changes to the same thing will be reverted too.')) return
    setBusy(a.id)
    try {
      const res = await fetch(`${API}/assistant/actions/${a.id}/undo`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        let detail = ''
        try { detail = (await res.json()).detail } catch { /* not JSON */ }
        throw new Error(detail || `Undo failed (${res.status})`)
      }
      refresh()
      await load()
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }

  return (
    <div>
      <SettingRow title="Show me what Atlas changes"
        detail="When Atlas edits something, open it so you see the change (on a laptop; the chat moves to the side panel). Asking it to show you something always works.">
        <Switch checked={followAlong} onChange={v => setAssistantPrefs({ followAlong: v })} label="Show me what Atlas changes" />
      </SettingRow>
      <SafeWebSetting />
      <div style={{ fontSize: 12.5, color: 'var(--mid)', margin: '14px 0 8px' }}>Every change Atlas makes is listed here and can be undone.</div>
      {err && <div style={{ fontSize: 12.5, color: 'var(--accent)', marginBottom: 8 }}>{err}</div>}
      {actions === null && !err && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}
      {actions?.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No changes yet.</div>}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {actions?.map((a, i) => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i ? '1px solid var(--bd-sm)' : 'none' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: a.undone_at ? 'var(--muted)' : 'var(--ink)', textDecoration: a.undone_at ? 'line-through' : 'none',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.summary}</div>
              <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{when(a.created_at)}{a.undone_at ? ' · undone' : ''}</div>
            </div>
            {a.show && !a.undone_at && <Button variant="ghost" size="sm" onClick={() => { onOpen?.(); openShow(a.show) }}>Open</Button>}
            {a.undoable && <Button variant="ghost" size="sm" disabled={busy === a.id} onClick={() => undo(a, i)}>{busy === a.id ? '…' : 'Undo'}</Button>}
          </div>
        ))}
      </div>
    </div>
  )
}

// Stored on the server (it changes which tools the agent gets), so it's the
// same on every device. Applies from the next message.
function SafeWebSetting() {
  const { token } = useAuth()
  const [on, setOn] = useState(null)
  const [err, setErr] = useState(null)
  const call = async (init) => {
    const res = await fetch(`${API}/assistant/settings`, {
      ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Couldn't ${init ? 'save' : 'load'} the setting (${res.status})`)
    return res.json()
  }
  useEffect(() => { call().then(s => setOn(s.safe_web)).catch(e => setErr(e.message)) }, []) // eslint-disable-line
  const change = async v => {
    setOn(v)
    try { setOn((await call({ method: 'PUT', body: JSON.stringify({ safe_web: v }) })).safe_web) }
    catch (e) { setOn(!v); setErr(e.message) }
  }
  return (
    <SettingRow title="Safer web access"
      detail={err || 'Atlas can only read web pages (no sending data), only open links that came up in a search, on a page it opened or in your messages, and never internal addresses. Protects against web pages that try to trick it into leaking your data. Applies from your next message.'}>
      <Switch checked={!!on} onChange={change} label="Safer web access" disabled={on === null} />
    </SettingRow>
  )
}

const SILENCE_OPTIONS = [0, 1, 2, 3, 4, 5, 7, 10]

function SettingRow({ title, detail, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--bd-sm)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.45 }}>{detail}</div>
      </div>
      <div style={{ flex: 'none' }}>{children}</div>
    </div>
  )
}

const SPEAK_OPTIONS = [['dock', 'Corner mic only'], ['voice', 'Whenever I speak'], ['always', 'Always'], ['never', 'Never']]

function VoiceSettings() {
  const { silenceSeconds, autoSend, keepListening, speakReplies, ttsVoice, bargeIn, floatingMic, voiceOpensChat } = useVoiceSettings()
  const { bindings } = useKeybinds() || { bindings: {} }
  return (
    <div>
      <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--mid)', lineHeight: 1.5 }}>
        Tap the mic{bindings.voice ? <> or press <kbd style={kbd}>{displayCombo(bindings.voice)}</kbd></> : null} to talk to Atlas. These settings are kept on this device.
      </p>
      <SettingRow title="Stop when I pause"
        detail="Stops listening after this long without speech, so you don't have to tap again.">
        <select aria-label="Stop after a pause of" value={silenceSeconds}
          onChange={e => setVoiceSettings({ silenceSeconds: Number(e.target.value) })}
          style={{ fontSize: 13, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--bd-xl)', background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit' }}>
          {SILENCE_OPTIONS.map(n => <option key={n} value={n}>{n === 0 ? 'Never' : `${n} second${n === 1 ? '' : 's'}`}</option>)}
        </select>
      </SettingRow>
      <SettingRow title="Send automatically"
        detail="Sends what you said as soon as it's transcribed. Turn off to check and edit it in the box first.">
        <Switch checked={autoSend || keepListening} onChange={v => setVoiceSettings({ autoSend: v })} label="Send automatically" disabled={keepListening}
          title={keepListening ? 'Always on while “Keep listening” is on' : undefined} />
      </SettingRow>
      <SettingRow title="Keep listening"
        detail={`A hands-free conversation: after Atlas replies, it starts listening again. Messages send when you pause${silenceSeconds ? '' : ` (${CONVERSATION_SILENCE} seconds, since stopping on a pause is off)`}. Say nothing, or press Esc, to end it.`}>
        <Switch checked={keepListening} onChange={v => setVoiceSettings({ keepListening: v })} label="Keep listening" />
      </SettingRow>

      <SettingRow title="Read replies aloud"
        detail="Atlas talks back, starting as soon as the first sentence is ready. “Corner mic only” speaks when you used the corner mic with the chat closed; “Whenever I speak” also covers the chat's own mic. Replies to be read out are kept short.">
        <Select aria-label="Read replies aloud" value={speakReplies} onChange={e => setVoiceSettings({ speakReplies: e.target.value })} style={{ fontSize: 13 }}>
          {SPEAK_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </SettingRow>
      {speakReplies !== 'never' && <>
        <SettingRow title="Voice" detail="Which voice reads replies.">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Select aria-label="Voice" value={ttsVoice} onChange={e => setVoiceSettings({ ttsVoice: e.target.value })} style={{ fontSize: 13, textTransform: 'capitalize' }}>
              {TTS_VOICES.map(v => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
            </Select>
            <Button size="sm" variant="ghost" onClick={() => { unlockAudio(); speech.cancel(); speech.say('Hi, this is how I sound. Say the word and I’ll get on with it.') }}>Try</Button>
          </div>
        </SettingRow>
        <SettingRow title="Stop when I talk"
          detail="Talking over Atlas cuts the reply off, so you can interrupt. The mic button and the voice shortcut always do.">
          <Switch checked={bargeIn} onChange={v => setVoiceSettings({ bargeIn: v })} label="Stop when I talk" />
        </SettingRow>
      </>}

      <SettingRow title="Corner mic"
        detail="A mic button in the bottom-right corner when the chat isn't open, so you can talk to Atlas from any page. The reply shows in a small card above it.">
        <Switch checked={floatingMic} onChange={v => setVoiceSettings({ floatingMic: v })} label="Corner mic" />
      </SettingRow>
      <SettingRow title="Voice shortcut opens the chat"
        detail={`When the chat isn't open, ${bindings.voice ? displayCombo(bindings.voice) : 'the voice shortcut'} opens the assistant panel and listens there${floatingMic ? ', instead of using the corner mic' : ''}.`}>
        <Switch checked={voiceOpensChat || !floatingMic} onChange={v => setVoiceSettings({ voiceOpensChat: v })} label="Voice shortcut opens the chat" disabled={!floatingMic}
          title={!floatingMic ? 'Always, while the corner mic is off' : undefined} />
      </SettingRow>
    </div>
  )
}

function DocEditor({ kind }) {
  const doc = DOCS[kind]
  const api = useDocApi(kind)
  const [loaded, setLoaded] = useState(null)   // the version on the server
  const [draft, setDraft] = useState('')
  const [versions, setVersions] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [savedNote, setSavedNote] = useState(false)

  const load = async () => {
    try {
      const [cur, hist] = await Promise.all([api.get(), api.history()])
      setLoaded(cur)
      setDraft(cur.content)
      setVersions(hist.versions || [])
      setErr(null)
    } catch (e) {
      setErr(e.message)
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  const dirty = loaded && draft !== loaded.content
  const max = loaded?.max_chars || 20000
  const isDefault = loaded && loaded.default !== undefined && loaded.content === loaded.default

  const act = async (fn) => {
    setSaving(true)
    try { await fn(); setPreview(null); await load(); setSavedNote(true) } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <p style={{ flex: 1, margin: 0, fontSize: 13, color: 'var(--mid)', lineHeight: 1.5 }}>
          {doc.intro} Changes apply from your next conversation.
        </p>
        {versions.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => { setShowHistory(h => !h); setPreview(null) }}
            style={{ flex: 'none', background: showHistory ? 'var(--surface-2)' : 'transparent' }}>
            {showHistory ? 'Back' : `History · ${versions.length}`}
          </Button>
        )}
      </div>

      {loaded === null && !err && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}
      {err && <div style={{ fontSize: 12.5, color: 'var(--accent)', marginBottom: 10 }}>{err}</div>}

      {loaded && !showHistory && (
        <>
          <textarea value={draft} onChange={e => { setDraft(e.target.value); setSavedNote(false) }} spellCheck
            aria-label={doc.label} placeholder={doc.placeholder}
            style={{ ...field, flex: 1, minHeight: 260, resize: 'none', padding: '12px 14px', borderRadius: 10, fontSize: 13, lineHeight: 1.55, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 160, fontSize: 12, color: draft.length > max ? 'var(--accent)' : 'var(--faint)' }}>
              {savedNote && !dirty ? 'Saved · applies from your next conversation'
                : loaded.version ? `${SOURCE_LABEL[loaded.source] || loaded.source} · ${when(loaded.created_at)}`
                : kind === 'prompt' ? 'Default' : 'Nothing saved yet'}
              {' · '}{draft.length.toLocaleString()} / {max.toLocaleString()}
            </span>
            {kind === 'prompt' && !isDefault && !dirty && (
              <Button variant="ghost" onClick={() => act(() => api.restore(0))} disabled={saving}>Reset to default</Button>
            )}
            {dirty && <Button variant="ghost" onClick={() => setDraft(loaded.content)} disabled={saving}>Discard</Button>}
            <Button variant="primary" onClick={() => act(() => api.save(draft))} disabled={!dirty || saving || draft.length > max}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </>
      )}

      {loaded && showHistory && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {versions.map((v, i) => {
            const open = preview === v.version
            return (
              <div key={v.version} style={{ border: '1px solid var(--bd)', borderRadius: 10, background: open ? 'var(--surface-2)' : 'transparent' }}>
                <div onClick={() => setPreview(open ? null : v.version)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer' }}>
                  <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500, minWidth: 64 }}>{SOURCE_LABEL[v.source] || v.source}</span>
                  <span style={{ flex: 1, fontSize: 12.5, color: 'var(--muted)' }}>{when(v.created_at)}</span>
                  {i === 0
                    ? <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>Current</span>
                    : <button onClick={e => { e.stopPropagation(); act(() => api.restore(v.version)) }} disabled={saving}
                        style={{ fontSize: 12, padding: '4px 10px', borderRadius: 7, border: '1px solid var(--bd)', background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', cursor: 'pointer' }}>Restore</button>}
                </div>
                {open && (
                  <pre style={{ margin: 0, padding: '0 12px 12px', fontSize: 12, lineHeight: 1.5, color: 'var(--mid)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', maxHeight: 300, overflowY: 'auto' }}>
                    {v.content || '(empty)'}
                  </pre>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

/**
 * Shown under a turn where Atlas changed its memory or system prompt, with a
 * way to take it back. Undo restores the version from just before the edit.
 */
export function MemoryEditChip({ edit }) {
  const api = useDocApi(edit.kind || 'memory')
  const [state, setState] = useState('idle') // idle | working | undone | failed
  const undo = async () => {
    setState('working')
    try {
      const cur = await api.get()
      if (cur.version !== edit.version && !window.confirm(
        'This has changed again since. Undoing this edit will also undo the later changes. Continue?')) {
        setState('idle')
        return
      }
      await api.restore(edit.previous)
      setState('undone')
    } catch {
      setState('failed')
    }
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
      {state === 'undone'
        ? <span style={{ color: 'var(--faint)' }}>· undone</span>
        : <button onClick={e => { e.stopPropagation(); undo() }} disabled={state === 'working'}
            style={{ fontSize: 11.5, padding: '1px 8px', borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--surface)', color: 'var(--mid)', fontFamily: 'inherit', cursor: 'pointer' }}>
            {state === 'working' ? '…' : 'Undo'}
          </button>}
      {state === 'failed' && <span style={{ color: 'var(--accent)' }}>couldn't undo</span>}
    </span>
  )
}
