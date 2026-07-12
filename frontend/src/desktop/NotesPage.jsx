import { useState, useRef, useCallback, useEffect } from 'react'
import { marked } from 'marked'
import { useNotes } from '../context/NotesContext.jsx'
import { useGitHub } from '../context/GitHubContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'

marked.use({ gfm: true, breaks: true })

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

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
          ? { name: part, path: file.path, isFile: true, draftOnly: !!file.draftOnly }
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

function FileTree({ nodes, selectedPath, onSelect, depth = 0, draftPaths = new Set() }) {
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
            color: selectedPath === node.path ? '#5f7591' : node.draftOnly ? 'var(--mid)' : 'var(--mid)',
            fontSize: 13, display: 'flex', alignItems: 'center', gap: 7,
            transition: 'background .1s',
            fontStyle: node.draftOnly ? 'italic' : 'normal',
            opacity: node.draftOnly ? 0.8 : 1,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: .5 }}>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {node.name.replace(/\.md$/, '')}
          </span>
          {node.draftOnly && (
            <span style={{ fontSize: 9, fontWeight: 700, color: '#b08a3e', background: 'rgba(176,138,62,.15)', padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>new</span>
          )}
          {!node.draftOnly && draftPaths.has(node.path) && (
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
            <FileTree nodes={node.children} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} draftPaths={draftPaths} />
          )}
        </div>
      ))}
    </>
  )
}

// ─── Heading extraction ───────────────────────────────────────────────────────

function extractHeadings(body) {
  return body.split('\n')
    .map(line => { const m = line.match(/^(#{1,6})\s+(.+)/); return m ? { level: m[1].length, text: m[2].trim() } : null })
    .filter(Boolean)
}

// ─── Outline bottom sheet ─────────────────────────────────────────────────────

function OutlineSheet({ body, contentRef, onClose }) {
  const headings = extractHeadings(body)

  const scrollTo = (text, level) => {
    const selector = `h${level}`
    const els = contentRef.current?.querySelectorAll(selector) || []
    for (const el of els) {
      if (el.textContent.trim() === text) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        break
      }
    }
    onClose()
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.4)' }} />
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 201,
        background: 'var(--surface)', borderRadius: '18px 18px 0 0',
        boxShadow: '0 -8px 40px rgba(0,0,0,.18)',
        maxHeight: '70vh', display: 'flex', flexDirection: 'column',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {/* Handle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 20px 0' }}>
          <div style={{ width: 36, height: 4, borderRadius: 99, background: 'var(--bd-xl)' }} />
        </div>
        <div style={{ padding: '12px 20px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mid)', letterSpacing: '.04em', textTransform: 'uppercase' }}>Outline</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 16px' }}>
          {headings.length === 0
            ? <div style={{ padding: '12px 8px', fontSize: 13, color: 'var(--faint)' }}>No headings found.</div>
            : headings.map((h, i) => (
              <button key={i} onClick={() => scrollTo(h.text, h.level)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: `8px 8px 8px ${8 + (h.level - 1) * 14}px`,
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: h.level <= 2 ? "'Newsreader', serif" : 'inherit',
                  fontSize: h.level === 1 ? 16 : h.level === 2 ? 14 : 13,
                  fontWeight: h.level <= 2 ? 600 : 500,
                  color: h.level <= 2 ? 'var(--ink)' : 'var(--mid)',
                  borderRadius: 8,
                }}>
                {h.text}
              </button>
            ))
          }
        </div>
      </div>
    </>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const noteTitle   = body => body.trim().split('\n')[0].replace(/^#+\s*/, '').trim() || 'New note'
const notePreview = body => body.trim().split('\n').slice(1).join(' ').replace(/[#*`_]/g, '').trim()

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotesPage() {
  const isMobile = useIsMobile()
  const { token } = useAuth()
  const { notes, addNote, updateNote, removeNote } = useNotes()
  const { github, loadTree, getFile, publishFile, createFile } = useGitHub()

  const [selected,          setSelected]          = useState(null)  // { type:'quick',id } | { type:'github',path }
  const [body,              setBody]              = useState('')
  const [editing,           setEditing]           = useState(false) // github view → edit
  const [fileMeta,          setFileMeta]          = useState(null)  // { sha } | null (draft-only has no sha)
  const [fileLoading,       setFileLoading]       = useState(false)
  const [publishing,        setPublishing]        = useState(false)
  const [pubStatus,         setPubStatus]         = useState(null)  // 'ok' | 'err' | 'saved'
  const [drafts,            setDrafts]            = useState(loadDrafts)
  const [backendDraftPaths, setBackendDraftPaths] = useState(new Set()) // paths with backend drafts
  const [showOutline,       setShowOutline]       = useState(false)
  const [newItem,           setNewItem]           = useState(null)   // null | 'menu' | 'file' | 'folder'
  const [newName,           setNewName]           = useState('')
  const [creating,          setCreating]          = useState(false)
  const [createError,       setCreateError]       = useState(null)
  const contentRef = useRef(null)
  const saveTimer  = useRef(null)

  const isQuick  = selected?.type === 'quick'
  const isGithub = selected?.type === 'github'
  const hasDraft = isGithub && (!!drafts[selected?.path] || backendDraftPaths.has(selected?.path))
  const isDraftOnly = isGithub && !github.tree.some(f => f.path === selected?.path)

  const updateDrafts = (next) => { saveDrafts(next); setDrafts(next) }

  // ── Backend draft API helpers ─────────────────────────────────────────────

  const authHeaders = { Authorization: `Bearer ${token}` }

  const fetchBackendDraftPaths = useCallback(async () => {
    if (!token) return
    try {
      const r = await fetch(`${API}/api/github-drafts`, { headers: authHeaders })
      if (!r.ok) return
      const list = await r.json()
      setBackendDraftPaths(new Set(list.map(d => d.path)))
    } catch {}
  }, [token]) // eslint-disable-line

  const saveBackendDraft = useCallback((path, content) => {
    if (!token) return
    fetch(`${API}/api/github-drafts`, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    }).catch(() => {})
    setBackendDraftPaths(prev => new Set([...prev, path]))
  }, [token]) // eslint-disable-line

  const deleteBackendDraft = useCallback((path) => {
    if (!token) return
    fetch(`${API}/api/github-drafts/${encodeURIComponent(path)}`, {
      method: 'DELETE',
      headers: authHeaders,
    }).catch(() => {})
    setBackendDraftPaths(prev => { const s = new Set(prev); s.delete(path); return s })
  }, [token]) // eslint-disable-line

  // Fetch backend drafts on mount and when connection changes
  useEffect(() => {
    if (github.connected && token) fetchBackendDraftPaths()
  }, [github.connected, token, fetchBackendDraftPaths])

  // ── Tree with draft-only files ────────────────────────────────────────────

  const githubPaths = new Set(github.tree.map(f => f.path))
  const draftOnlyPaths = [...backendDraftPaths].filter(p => !githubPaths.has(p))
  const allTreeFiles = [...github.tree, ...draftOnlyPaths.map(path => ({ path, draftOnly: true }))]
  const tree = buildTree(allTreeFiles)
  // Combined draft indicator (localStorage + backend)
  const allDraftPaths = new Set([...Object.keys(drafts), ...backendDraftPaths])

  // ── Note selection ────────────────────────────────────────────────────────

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
      const localDraft = loadDrafts()[file.path]
      const isDraftOnlyFile = file.draftOnly || (backendDraftPaths.has(file.path) && !githubPaths.has(file.path))
      if (isDraftOnlyFile) {
        // Draft-only: load content from backend (not on GitHub yet)
        if (localDraft) {
          setBody(localDraft.body)
        } else {
          const r = await fetch(`${API}/api/github-drafts/${encodeURIComponent(file.path)}`, { headers: authHeaders })
          const data = r.ok ? await r.json() : {}
          setBody(data.content || '')
        }
        setFileMeta(null) // no SHA — not published to GitHub yet
        setEditing(true)  // auto-open edit mode for new drafts
      } else {
        const { content, sha } = await getFile(file.path)
        const draft = localDraft || null
        if (!draft && backendDraftPaths.has(file.path)) {
          // Backend draft exists but not in localStorage — fetch content
          const r = await fetch(`${API}/api/github-drafts/${encodeURIComponent(file.path)}`, { headers: authHeaders })
          const data = r.ok ? await r.json() : {}
          setBody(data.content || content)
        } else {
          setBody(draft ? draft.body : content)
        }
        setFileMeta({ sha })
      }
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

  const handleNewNote = async () => {
    const id = await addNote()
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

  // Save locally (localStorage) + sync to backend
  const handleSave = () => {
    if (!isGithub) return
    updateDrafts({ ...drafts, [selected.path]: { body, savedAt: new Date().toISOString() } })
    saveBackendDraft(selected.path, body)
    setPubStatus('saved')
    setEditing(false)
  }

  // Discard local + backend draft, reload from remote
  const handleDiscard = async () => {
    if (!isGithub) return
    const next = { ...drafts }
    delete next[selected.path]
    updateDrafts(next)
    deleteBackendDraft(selected.path)
    if (isDraftOnly) {
      // Draft-only file discarded — remove from view
      setSelected(null)
      setBody('')
      return
    }
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

  // Publish to GitHub (create if draft-only, update if existing), then clear drafts
  const handlePublish = async () => {
    if (!isGithub) return
    setPublishing(true)
    setPubStatus(null)
    try {
      let newSha
      if (fileMeta?.sha) {
        // Update existing file
        const res = await publishFile(selected.path, body, fileMeta.sha, `Update ${selected.path}`)
        newSha = res?.content?.sha
      } else {
        // Draft-only → create on GitHub
        const res = await createFile(selected.path, body, `Create ${selected.path}`)
        newSha = res?.content?.sha
        await loadTree() // refresh tree to show new file
      }
      if (newSha) setFileMeta({ sha: newSha })
      // Clear from localStorage
      const next = { ...drafts }
      delete next[selected.path]
      updateDrafts(next)
      // Clear from backend
      deleteBackendDraft(selected.path)
      setPubStatus('ok')
      setEditing(false)
    } catch {
      setPubStatus('err')
    } finally {
      setPublishing(false)
    }
  }

  // Create new file/folder as a draft (not directly to GitHub)
  const handleCreate = async (e) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      let filePath, content
      if (newItem === 'file') {
        filePath = name.endsWith('.md') ? name : name + '.md'
        const title = filePath.split('/').pop().replace(/\.md$/, '')
        content = `# ${title}\n`
      } else {
        const folder = name.replace(/\/$/, '')
        filePath = `${folder}/README.md`
        content = `# ${folder.split('/').pop()}\n`
      }
      // Save as backend draft
      const r = await fetch(`${API}/api/github-drafts`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
      })
      if (!r.ok) throw new Error('Failed to save draft')
      setBackendDraftPaths(prev => new Set([...prev, filePath]))
      setNewItem(null)
      setNewName('')
      await selectGithub({ path: filePath, draftOnly: true })
    } catch (err) {
      setCreateError(err.message || 'Failed to create')
    } finally {
      setCreating(false)
    }
  }

  const draftCount = allDraftPaths.size
  const currentNote = isQuick ? notes.find(n => n.id === selected?.id) : null

  // On mobile: show sidebar OR editor, not both
  const mobileShowEditor = isMobile && selected !== null

  return (
    <div style={{ display: 'flex', height: isMobile ? '100%' : 'calc(100vh - 96px)', minHeight: 0, margin: isMobile ? 0 : '-28px -28px 0', overflow: 'hidden' }}>

      {/* ── Sidebar ── */}
      <div style={{ width: isMobile ? '100%' : 236, flexShrink: 0, borderRight: isMobile ? 'none' : '1px solid var(--bd)', display: mobileShowEditor ? 'none' : 'flex', flexDirection: 'column', overflowY: 'auto', background: 'var(--surface-2)' }}>

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
              <div style={{ display: 'flex', gap: 2, alignItems: 'center', position: 'relative' }}>
                <button onClick={() => loadTree()} title="Refresh"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', padding: 2, display: 'flex', alignItems: 'center' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10"/><path d="M20.49 15a9 9 0 01-14.85 3.36L1 14"/>
                  </svg>
                </button>
                <button onClick={() => { setNewItem(p => p ? null : 'menu'); setCreateError(null) }} title="New"
                  style={{ width: 18, height: 18, borderRadius: 5, border: 'none', background: 'var(--surface-3)', color: 'var(--mid)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: 14, lineHeight: 1 }}>
                  +
                </button>
                {newItem === 'menu' && (
                  <>
                    <div onClick={() => setNewItem(null)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
                    <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 11, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)', minWidth: 120, overflow: 'hidden', marginTop: 4 }}>
                      {['file', 'folder'].map(type => (
                        <div key={type} onClick={() => { setNewItem(type); setNewName(''); setCreateError(null) }}
                          style={{ padding: '8px 14px', fontSize: 13, color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                          {type === 'file'
                            ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                          }
                          New {type}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
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
          {(newItem === 'file' || newItem === 'folder') && (
            <form onSubmit={handleCreate} style={{ padding: '0 10px 8px' }}>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder={newItem === 'file' ? 'folder/note.md' : 'folder/name'}
                onKeyDown={e => e.key === 'Escape' && setNewItem(null)}
                disabled={creating}
                style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--bd-xl)', background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', opacity: creating ? 0.6 : 1 }}
              />
              {createError && <div style={{ fontSize: 11, color: '#c15f3c', marginTop: 3 }}>{createError}</div>}
            </form>
          )}
          {tree.length > 0 && (
            <FileTree nodes={tree} selectedPath={isGithub ? selected.path : null} onSelect={selectGithub} draftPaths={allDraftPaths} />
          )}
        </div>
      </div>

      {/* Outline bottom sheet */}
      {showOutline && isGithub && !editing && (
        <OutlineSheet body={body} contentRef={contentRef} onClose={() => setShowOutline(false)} />
      )}

      {/* ── Editor / viewer ── */}
      <div style={{ flex: 1, display: mobileShowEditor || !isMobile ? 'flex' : 'none', flexDirection: 'column', minWidth: 0, background: 'var(--surface)', position: 'relative' }}>

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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '12px 16px' : '14px 28px', borderBottom: '1px solid var(--bd-xs)', flexShrink: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%', display: 'flex', alignItems: 'center', gap: 8 }}>
                {isMobile && (
                  <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mid)', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                    Notes
                  </button>
                )}
                {isGithub && <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{selected.path}</span>}
                {isGithub && isDraftOnly && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#b08a3e', background: 'rgba(176,138,62,.12)', padding: '2px 7px', borderRadius: 5 }}>draft</span>
                )}
                {isGithub && !isDraftOnly && hasDraft && !editing && (
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
                    {(hasDraft || isDraftOnly) && (
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
                    {!isDraftOnly && (
                      <button onClick={() => { setEditing(true); setPubStatus(null) }}
                        style={{ fontSize: 13, fontWeight: 600, color: 'var(--mid)', background: 'var(--surface-3)', border: 'none', cursor: 'pointer', padding: '6px 14px', borderRadius: 8, fontFamily: 'inherit' }}>
                        Edit
                      </button>
                    )}
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
            <div ref={contentRef} style={{ flex: 1, overflow: 'auto', padding: '28px 36px' }}>
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

              {/* Mobile outline trigger — ^ button */}
              {isMobile && isGithub && !editing && !fileLoading && body && (
                <button
                  onClick={() => setShowOutline(true)}
                  style={{
                    position: 'fixed', bottom: 24, right: 20, zIndex: 10,
                    width: 44, height: 44, borderRadius: '50%',
                    background: 'var(--surface-2)', border: '1px solid var(--bd)',
                    color: 'var(--mid)', fontSize: 18, fontWeight: 700,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 12px rgba(0,0,0,.12)',
                  }}
                  title="Outline"
                >
                  ↑
                </button>
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
