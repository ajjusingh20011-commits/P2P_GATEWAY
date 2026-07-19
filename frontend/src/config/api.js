const BASE_URL = 'http://localhost:3000/api'
const SOCKET_URL = 'http://localhost:3000'

export function authHeaders() {
  const token = localStorage.getItem('token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
}

export async function apiCall(endpoint, options = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: { ...authHeaders(), ...options.headers }
  })
  const json = await res.json()
  if (res.status === 401) {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    window.location.href = '/login'
  }
  if (!json.success) throw new Error(json.message)
  return json
}

export { BASE_URL, SOCKET_URL }
