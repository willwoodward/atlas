const BASE = 'https://api.github.com'

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
})

// UTF-8 safe base64 decode
function b64decode(str) {
  const binary = atob(str.replace(/\n/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// UTF-8 safe base64 encode
function b64encode(str) {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  bytes.forEach(b => (binary += String.fromCharCode(b)))
  return btoa(binary)
}

export async function fetchTree(token, repo) {
  const repoRes = await fetch(`${BASE}/repos/${repo}`, { headers: headers(token) })
  if (!repoRes.ok) throw new Error(`GitHub ${repoRes.status}`)
  const { default_branch } = await repoRes.json()

  const res = await fetch(`${BASE}/repos/${repo}/git/trees/${default_branch}?recursive=1`, { headers: headers(token) })
  if (!res.ok) throw new Error(`GitHub tree ${res.status}`)
  const data = await res.json()
  return (data.tree || []).filter(f => f.type === 'blob' && f.path.endsWith('.md'))
}

export async function fetchFile(token, repo, path) {
  const res = await fetch(`${BASE}/repos/${repo}/contents/${encodeURIComponent(path)}`, { headers: headers(token) })
  if (!res.ok) throw new Error(`GitHub ${res.status}`)
  const data = await res.json()
  return { content: b64decode(data.content), sha: data.sha }
}

export async function putFile(token, repo, path, content, sha, message = 'Update note') {
  const body = { message, content: b64encode(content) }
  if (sha) body.sha = sha
  const res = await fetch(`${BASE}/repos/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`GitHub ${res.status}`)
  return res.json()
}
