import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { fetchTree, fetchFile, putFile } from '../integrations/github.js'
import { useAuth } from './AuthContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const Ctx = createContext(null)

export function GitHubProvider({ children }) {
  const { token } = useAuth()
  const [auth, setAuth] = useState({ token: null, repo: null })
  const [tree, setTree] = useState([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState(null)

  const isConnected = !!(auth.token && auth.repo)

  const authHeaders = { Authorization: `Bearer ${token}` }

  // Load from server on mount
  useEffect(() => {
    if (!token) return
    fetch(`${API}/api/integrations`, { headers: authHeaders })
      .then(r => r.json())
      .then(data => {
        if (data.github) {
          setAuth({ token: data.github.token, repo: data.github.repo })
        }
      })
      .catch(() => {})
  }, [token]) // eslint-disable-line

  const loadTree = useCallback(async (ghToken = auth.token, repo = auth.repo) => {
    if (!ghToken || !repo) return
    setTreeLoading(true)
    setTreeError(null)
    try {
      setTree(await fetchTree(ghToken, repo))
    } catch (err) {
      setTreeError(err.message)
    } finally {
      setTreeLoading(false)
    }
  }, [auth.token, auth.repo])

  // Auto-load tree when auth changes
  useEffect(() => {
    if (isConnected) loadTree()
  }, [auth.token, auth.repo]) // eslint-disable-line

  const connect = useCallback(async (ghToken, repo) => {
    setAuth({ token: ghToken, repo })
    await fetch(`${API}/api/integrations/github`, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: ghToken, repo }),
    }).catch(() => {})
    await loadTree(ghToken, repo)
  }, [token, loadTree]) // eslint-disable-line

  const disconnect = useCallback(() => {
    setAuth({ token: null, repo: null })
    setTree([])
    setTreeError(null)
    fetch(`${API}/api/integrations/github`, {
      method: 'DELETE',
      headers: authHeaders,
    }).catch(() => {})
  }, [token]) // eslint-disable-line

  const getFile = useCallback(async (path) => {
    if (!isConnected) throw new Error('Not connected')
    return fetchFile(auth.token, auth.repo, path)
  }, [isConnected, auth.token, auth.repo])

  const publishFile = useCallback(async (path, content, sha, message) => {
    if (!isConnected) throw new Error('Not connected')
    return putFile(auth.token, auth.repo, path, content, sha, message)
  }, [isConnected, auth.token, auth.repo])

  const createFile = useCallback(async (path, content = '', message) => {
    if (!isConnected) throw new Error('Not connected')
    return putFile(auth.token, auth.repo, path, content, undefined, message)
  }, [isConnected, auth.token, auth.repo])

  return (
    <Ctx.Provider value={{
      github: { connected: isConnected, repo: auth.repo, tree, treeLoading, treeError },
      connect,
      disconnect,
      loadTree,
      getFile,
      publishFile,
      createFile,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useGitHub = () => useContext(Ctx)
