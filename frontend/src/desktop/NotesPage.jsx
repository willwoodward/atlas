import { useState, useRef, useCallback } from 'react'
import { marked } from 'marked'
import { useNotes } from '../context/NotesContext.jsx'
import { useGitHub } from '../context/GitHubContext.jsx'

marked.use({ gfm: true, breaks: true })

// ─── Local drafts (per-path saves that haven't been published yet) ────────────

const DRAFTS_KEY = 'atlas:github-drafts:v1'

function loadDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}') } catch { return {} }
}
function saveDrafts(drafts) {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
}

// ─── File tree ────────────────────────────────────────────────────────────────

function buildTree(files) {
  const root = { children: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      if (!node.children) node.children = []
      let child = node.children.find(c => c.name === part)
      if (!child) {
        child = isLast
          ? { name: part, path: file.path, isFile: true }
          : { name: part, path: parts.slice(0, i + 1).join('/'), isFile: false, children: [] }
        node.children.push(child)
      }
      if (!isLast) node = child
    }
  }
  const sort = n => {
    if (!n.children) return
    n.children.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1
      return a.name.localeCompare(b.name)
    })
    n.children.forEach(sort)
  }
  sort(root)
  return root.children
}

function FileTree({ nodes, selectedPath, onSelect, depth = 0, drafts = {} }) {
  const [open, setOpen] = useState({})
  return (
    <>
      {nodes.map(node => node.isFile ? (
        <div key={node.path}
          onClick={() => onSelect(node)}
          style={{
            padding: `5px 10px 5px ${10 + depth * 14}px`,
            cursor: 'pointer', borderRadius: 7, marginBottom: 1,
            background: selectedPath === node.path ? 'rgba(95,117,145,.12)' : 'transparent',
            color: selectedPath === node.path ? '#5f7591' : 'var(--mid)',
            fontSize: 13, display: 'flex', alignItems: 'center', gap: 7,
            transition: 'background .1s',
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: .5 }}>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {node.name.replace(/\.md$/, '')}
          </span>
          {drafts[node.path] && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#b08a3e', flexShrink: 0 }} />
          )}
        </div>
      ) : (
        <div key={node.path}>
          <div
            onClick={() => setOpen(p => ({ ...p, [node.path]: !p[node.path] }))}
            style={{ padding: `5px 10px 5px ${10 + depth * 14}px`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              style={{ transform: open[node.path] ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
              <path d="M9 18l6-6-6-6"/>
            </svg>
            {node.name}
          </div>
          {open[node.path] && node.children && (
            <FileTree nodes={node.children} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} drafts={drafts} />
          )}
        </div>
      ))}
    </>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const noteTitle   = body => body.trim().split('\n')[0].replace(/^#+\s*/, '').trim() || 'New note'
const notePreview = body => body.trim().split('\n').slice(1).join(' ').replace(/[#*`_]/g, '').trim()

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotesPage() {
  const { notes, addNote, updateNote, removeNote } = useNotes()
  const { github, loadTree, getFile, publishFile }  = useGitHub()

  const [selected,     setSelected]     = useState(null)  // { type:'quick',id } | { type:'github',path }
  const [body,         setBody]         = useState('')
  const [editing,      setEditing]      = useState(false) // github view → edit
  const [fileMeta,     setFileMeta]     = useState(null)  // { sha }
  const [fileLoading,  setFileLoading]  = useState(false)
  const [publishing,   setPublishing]   = useState(false)
  const [pubStatus,    setPubStatus]    = useState(null)  // 'ok' | 'err' | 'saved'
  const [drafts,       setDrafts]       = useState(loadDrafts)
  const saveTimer = useRef(null)

  const isQuick  = selected?.type === 'quick'
  const isGithub = selected?.type === 'github'
  const hasDraft = isGithub && !!drafts[selected?.path]

  const updateDrafts = (next) => { saveDrafts(next); setDrafts(next) }

  const selectQuick = (note) => {
    setSelected({ type: 'quick', id: note.id })
    setBody(note.body)
    setEditing(false)
    setFileMeta(null)
    setPubStatus(null)
  }

  const selectGithub = async (file) => {
    setSelected({ type: 'github', path: file.path })
    setEditing(false)
    setFileMeta(null)
    setPubStatus(null)
    setFileLoading(true)
    try {
      const { content, sha } = await getFile(file.path)
      // If a local draft exists, use that instead of the remote content
      const draft = loadDrafts()[file.path]
      setBody(draft ? draft.body : content)
      setFileMeta({ sha })
    } catch (e) {
      setBody(`_Error loading file: ${e.message}_`)
    } finally {
      setFileLoading(false)
    }
  }

  const handleBodyChange = useCallback((val) => {
    setBody(val)
    if (!isQuick) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => updateNote(selected.id, val), 400)
  }, [isQuick, selected, updateNote])

  const handleNewNote = () => {
    const id = addNote()
    setSelected({ type: 'quick', id })
    setBody('')
    setEditing(false)
    setFileMeta(null)
  }

  const handleDelete = () => {
    if (!isQuick || !window.confirm('Delete this note?')) return
    removeNote(selected.id)
    setSelected(null)
    setBody('')
  }

  // Save locally — no GitHub call
  const handleSave = () => {
    if (!isGithub) return
    updateDrafts({ ...drafts, [selected.path]: { body, savedAt: new Date().toISOString() } })
    setPubStatus('saved')
    setEditing(false)
  }

  // Discard local draft, reload from remote
  const handleDiscard = async () => {
    if (!isGithub) return
    const next = { ...drafts }
    delete next[selected.path]
    updateDrafts(next)
    setFileLoading(true)
    setEditing(false)
    try {
      const { content, sha } = await getFile(selected.path)
      setBody(content)
      setFileMeta({ sha })
    } finally {
      setFileLoading(false)
    }
    setPubStatus(null)
  }

  // Publish to GitHub, then clear draft
  const handlePublish = async () => {
    if (!isGithub || !fileMeta) return
    setPublishing(true)
    setPubStatus(null)
    try {
      const res = await publishFile(selected.path, body, fileMeta.sha, `Update ${selected.path}`)
      const newSha = res?.content?.sha
      if (newSha) setFileMeta({ sha: newSha })
      const next = { ...drafts }
      delete next[selected.path]
      updateDrafts(next)
      setPubStatus('ok')
      setEditing(false)
    } catch {
      setPubStatus('err')
    } finally {
      setPublishing(false)
    }
  }

  const draftCount = Object.keys(drafts).length
  const tree = buildTree(github.tree)
  const currentNote = isQuick ? notes.find(n => n.id === selected?.id) : null

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 96px)', minHeight: 0, margin: '-28px -28px 0', overflow: 'hidden' }}>

      {/* ── Sidebar ── */}
      <div style={{ width: 236, flexShrink: 0, borderRight: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', overflowY: 'auto', background: 'var(--surface-2)' }}>

        {/* Quick notes */}
        <div style={{ padding: '20px 10px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', marginBottom: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }}>Quick notes</span>
            <button onClick={handleNewNote}
              style={{ width: 20, height: 20, borderRadius: 6, border: 'none', background: 'var(--surface-3)', color: 'var(--mid)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>
          {notes.length === 0 && (
            <div style={{ padding: '4px 6px', fontSize: 12, color: 'var(--faint)' }}>No notes yet.</div>
          )}
          {notes.map(n => (
            <div key={n.id} onClick={() => selectQuick(n)}
              style={{ padding: '7px 8px', borderRadius: 8, cursor: 'pointer', marginBottom: 1,
                background: selected?.id === n.id ? 'rgba(95,117,145,.1)' : 'transparent',
                transition: 'background .1s' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: selected?.id === n.id ? '#5f7591' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {noteTitle(n.body)}
              </div>
              {notePreview(n.body) && (
                <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {notePreview(n.body)}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* GitHub notes */}
        <div style={{ padding: '14px 10px 16px', borderTop: '1px solid var(--bd-xs)', marginTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', marginBottom: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
              {github.repo || 'GitHub'}
              {draftCount > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#b08a3e', background: 'rgba(176,138,62,.14)', padding: '1px 6px', borderRadius: 4 }}>
                  {draftCount} unsaved
                </span>
              )}
            </span>
            {github.connected && (
              <button onClick={() => loadTree()} title="Refresh"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', padding: 2, display: 'flex', alignItems: 'center' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10"/><path d="M20.49 15a9 9 0 01-14.85 3.36L1 14"/>
                </svg>
              </button>
            )}
          </div>
          {!github.connected && (
            <div style={{ padding: '2px 4px', fontSize: 12, color: 'var(--faint)' }}>Connect GitHub in Accounts.</div>
          )}
          {github.treeLoading && (
            <div style={{ padding: '2px 4px', fontSize: 12, color: 'var(--faint)' }}>Loading…</div>
          )}
          {github.treeError && (
            <div style={{ padding: '2px 4px', fontSize: 12, color: '#c15f3c' }}>{github.treeError}</div>
          )}
          {github.connected && !github.treeLoading && !github.treeError && tree.length === 0 && (
            <div style={{ padding: '2px 4px', fontSize: 12, color: 'var(--faint)' }}>No markdown files found.</div>
          )}
          {tree.length > 0 && (
            <FileTree nodes={tree} selectedPath={isGithub ? selected.path : null} onSelect={selectGithub} drafts={drafts} />
          )}
        </div>
      </div>

      {/* ── Editor / viewer ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--surface)' }}>

        {!selected && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--faint)' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span style={{ fontSize: 13 }}>Select a note or create one</span>
          </div>
        )}

        {selected && (
          <>
            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 28px', borderBottom: '1px solid var(--bd-xs)', flexShrink: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%', display: 'flex', alignItems: 'center', gap: 8 }}>
                {isGithub && <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{selected.path}</span>}
                {isGithub && hasDraft && !editing && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#b08a3e', background: 'rgba(176,138,62,.12)', padding: '2px 7px', borderRadius: 5 }}>unsaved</span>
                )}
                {isQuick && currentNote && (
                  <span>{new Date(currentNote.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                {pubStatus === 'ok'    && <span style={{ fontSize: 12, color: '#6f8168' }}>Published ✓</span>}
                {pubStatus === 'saved' && <span style={{ fontSize: 12, color: '#b08a3e' }}>Saved locally</span>}
                {pubStatus === 'err'   && <span style={{ fontSize: 12, color: '#c15f3c' }}>Failed to publish</span>}
                {isQuick && (
                  <button onClick={handleDelete}
                    style={{ fontSize: 12, color: '#c15f3c', background: 'none', border: 'none', cursor: 'pointer', padding: '5px 10px', borderRadius: 7, fontFamily: 'inherit' }}>
                    Delete
                  </button>
                )}
                {/* View mode actions */}
                {isGithub && !editing && !fileLoading && (
                  <>
                    {hasDraft && (
                      <>
                        <button onClick={handleDiscard}
                          style={{ fontSize: 13, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, fontFamily: 'inherit' }}>
                          Discard
                        </button>
                        <button onClick={handlePublish} disabled={publishing}
                          style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: '#5f7591', border: 'none', cursor: publishing ? 'default' : 'pointer', padding: '6px 16px', borderRadius: 8, fontFamily: 'inherit', opacity: publishing ? 0.7 : 1 }}>
                          {publishing ? 'Publishing…' : 'Publish'}
                        </button>
                      </>
                    )}
                    <button onClick={() => { setEditing(true); setPubStatus(null) }}
                      style={{ fontSize: 13, fontWeight: 600, color: 'var(--mid)', background: 'var(--surface-3)', border: 'none', cursor: 'pointer', padding: '6px 14px', borderRadius: 8, fontFamily: 'inherit' }}>
                      Edit
                    </button>
                  </>
                )}
                {/* Edit mode actions */}
                {isGithub && editing && (
                  <>
                    <button onClick={() => { setEditing(false); setPubStatus(null) }}
                      style={{ fontSize: 13, color: 'var(--mid)', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 12px', borderRadius: 8, fontFamily: 'inherit' }}>
                      Cancel
                    </button>
                    <button onClick={handleSave}
                      style={{ fontSize: 13, fontWeight: 600, color: '#b08a3e', background: 'rgba(176,138,62,.1)', border: '1px solid rgba(176,138,62,.25)', cursor: 'pointer', padding: '6px 14px', borderRadius: 8, fontFamily: 'inherit' }}>
                      Save
                    </button>
                    <button onClick={handlePublish} disabled={publishing}
                      style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: '#5f7591', border: 'none', cursor: publishing ? 'default' : 'pointer', padding: '6px 16px', borderRadius: 8, fontFamily: 'inherit', opacity: publishing ? 0.7 : 1 }}>
                      {publishing ? 'Publishing…' : 'Publish'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: '28px 36px' }}>
              {fileLoading && <div style={{ fontSize: 13, color: 'var(--faint)' }}>Loading…</div>}

              {/* Quick note — textarea, auto-saves */}
              {isQuick && (
                <textarea
                  value={body}
                  onChange={e => handleBodyChange(e.target.value)}
                  placeholder="Start writing…"
                  autoFocus
                  style={{ width: '100%', height: '100%', minHeight: 400, border: 'none', outline: 'none', resize: 'none',
                    fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 15, lineHeight: 1.75,
                    color: 'var(--ink)', background: 'transparent' }}
                />
              )}

              {/* GitHub — rendered markdown */}
              {isGithub && !fileLoading && !editing && (
                <div className="md-prose" dangerouslySetInnerHTML={{ __html: marked.parse(body || '') }} />
              )}

              {/* GitHub — edit mode */}
              {isGithub && !fileLoading && editing && (
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  autoFocus
                  style={{ width: '100%', height: '100%', minHeight: 500, border: 'none', outline: 'none', resize: 'none',
                    fontFamily: "'Courier New', Courier, monospace", fontSize: 13.5, lineHeight: 1.8,
                    color: 'var(--ink)', background: 'transparent' }}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
