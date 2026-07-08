import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { fetchTree, fetchFile, putFile } from '../integrations/github.js'

const KEY = 'atlas:github:v1'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  // Fall back to env vars if set
  const token = import.meta.env.VITE_GITHUB_TOKEN || null
  const repo  = import.meta.env.VITE_GITHUB_REPO  || null
  return { token, repo }
}

const Ctx = createContext(null)

export function GitHubProvider({ children }) {
  const [auth, setAuth] = useState(load)
  const [tree, setTree] = useState([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState(null)

  const isConnected = !!(auth.token && auth.repo)

  const loadTree = useCallback(async (token = auth.token, repo = auth.repo) => {
    if (!token || !repo) return
    setTreeLoading(true)
    setTreeError(null)
    try {
      setTree(await fetchTree(token, repo))
    } catch (err) {
      setTreeError(err.message)
    } finally {
      setTreeLoading(false)
    }
  }, [auth.token, auth.repo])

  // Auto-load tree on mount if already connected
  useEffect(() => {
    if (isConnected) loadTree()
  }, []) // eslint-disable-line

  const connect = useCallback(async (token, repo) => {
    const next = { token, repo }
    localStorage.setItem(KEY, JSON.stringify(next))
    setAuth(next)
    await loadTree(token, repo)
  }, [loadTree])

  const disconnect = useCallback(() => {
    localStorage.removeItem(KEY)
    setAuth({ token: null, repo: null })
    setTree([])
    setTreeError(null)
  }, [])

  const getFile = useCallback(async (path) => {
    if (!isConnected) throw new Error('Not connected')
    return fetchFile(auth.token, auth.repo, path)
  }, [isConnected, auth.token, auth.repo])

  const publishFile = useCallback(async (path, content, sha, message) => {
    if (!isConnected) throw new Error('Not connected')
    return putFile(auth.token, auth.repo, path, content, sha, message)
  }, [isConnected, auth.token, auth.repo])

  return (
    <Ctx.Provider value={{
      github: { connected: isConnected, repo: auth.repo, tree, treeLoading, treeError },
      connect,
      disconnect,
      loadTree,
      getFile,
      publishFile,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useGitHub = () => useContext(Ctx)
