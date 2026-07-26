const NGO_BASE = import.meta.env.VITE_NGO_API_BASE_URL || 'http://localhost:3000/api'
export const NGO_SOCKET_ORIGIN = NGO_BASE.replace(/\/api\/?$/, '')
const NGO_CREDENTIALS = {
  email: 'staff@bright.org',
  password: 'staff123'
}

async function getNGOAuth() {
  try {
    const stored = localStorage.getItem('ngo_token')
    const expiry = localStorage.getItem('ngo_token_expiry')
    const storedNgoId = localStorage.getItem('ngo_id')

    if (stored && expiry &&
        Date.now() < parseInt(expiry) &&
        storedNgoId &&
        storedNgoId !== 'null' &&
        storedNgoId !== 'undefined') {
      return { token: stored, ngoId: storedNgoId }
    }

    // Clear stale cache — covers a token cached before ngoId existed on the
    // user record, or one cached with the literal string 'null'/'undefined'.
    localStorage.removeItem('ngo_token')
    localStorage.removeItem('ngo_token_expiry')
    localStorage.removeItem('ngo_id')

    const res = await fetch(`${NGO_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(NGO_CREDENTIALS)
    })
    const data = await res.json()
    if (data.success) {
      const token = data.data.token
      const user = data.data.user
      const ngoId = user?.ngoId ||
                    user?.ngo_id ||
                    null
      localStorage.setItem('ngo_token', token)
      localStorage.setItem('ngo_token_expiry',
        String(Date.now() + 6 * 60 * 60 * 1000))
      if (ngoId) {
        localStorage.setItem('ngo_id', ngoId)
      }
      return { token, ngoId }
    }
    return { token: null, ngoId: null }
  } catch (err) {
    console.error('NGO login failed:', err)
    return { token: null, ngoId: null }
  }
}

async function getNGOToken() {
  const { token } = await getNGOAuth()
  return token
}

export async function saveAPKAccount(data) {
  const token = await getNGOToken()
  if (!token) throw new Error('Cannot connect to NGO server')

  const res = await fetch(`${NGO_BASE}/ngo/accounts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({
      type: 'apk',
      platform: data.platform,
      upiId: data.upiId,
      displayName: data.displayName
    })
  })

  const json = await res.json()

  if (res.status === 401) {
    // Token expired, clear and retry once
    localStorage.removeItem('ngo_token')
    localStorage.removeItem('ngo_token_expiry')
    return saveAPKAccount(data)
  }

  if (!json.success) throw new Error(json.message)
  return json
}

export async function saveWebAccount(data) {
  const token = await getNGOToken()
  if (!token) throw new Error('Cannot connect to NGO server')

  const res = await fetch(`${NGO_BASE}/ngo/accounts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({
      type: 'web',
      platform: data.platform,
      upiId: data.upiId,
      displayName: data.displayName,
      loginEmail: data.loginEmail,
      loginPassword: data.loginPassword,
      loginPhone: data.loginPhone
    })
  })

  const json = await res.json()

  if (res.status === 401) {
    localStorage.removeItem('ngo_token')
    localStorage.removeItem('ngo_token_expiry')
    return saveWebAccount(data)
  }

  if (!json.success) throw new Error(json.message)
  return json
}

export async function getAccounts() {
  const token = await getNGOToken()
  if (!token) throw new Error('Cannot connect to NGO server')

  const res = await fetch(`${NGO_BASE}/ngo/accounts`, {
    headers: { 'Authorization': 'Bearer ' + token }
  })

  const json = await res.json()
  if (!json.success) throw new Error(json.message)
  return json.data
}

// Returns { account, reconnect } — reconnect is only present when turning ON
// triggered a cookie-first reconnect attempt (web-login account, no live
// session), and reports what that attempt actually did (live / needsOTP /
// failed) so the caller can react instead of assuming success.
export async function toggleAccount(accountId, status) {
  const token = await getNGOToken()
  if (!token) throw new Error('Cannot connect to NGO server')

  const res = await fetch(
    `${NGO_BASE}/ngo/accounts/${accountId}/toggle`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ status })
    }
  )

  const json = await res.json()
  if (!json.success) throw new Error(json.message)
  return { account: json.data, reconnect: json.reconnect || null }
}

// Edit account details (title, organization, limits) — separate from the
// live/paused toggle above.
export async function updateAccount(accountId, data) {
  const token = await getNGOToken()
  if (!token) throw new Error('Cannot connect to NGO server')

  const res = await fetch(
    `${NGO_BASE}/ngo/accounts/${accountId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(data)
    }
  )

  const json = await res.json()
  if (!json.success) throw new Error(json.message)
  return json.data
}

// Delete an account permanently. If it's a web-login account with a live
// scraper session, the backend closes that session and removes its saved
// cookie file before deleting the record.
export async function deleteAccount(accountId) {
  const token = await getNGOToken()
  if (!token) throw new Error('Cannot connect to NGO server')

  const res = await fetch(
    `${NGO_BASE}/ngo/accounts/${accountId}`,
    {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    }
  )

  const json = await res.json()
  if (!json.success) throw new Error(json.message)
  return json
}

// Scraper/APK-sourced transactions — this is where real payment events
// actually land (see ngo-backend's webScraper.js fetchAndSaveTransactions),
// unlike the P2P gateway's MySQL NotificationLog table, which nothing
// currently writes to.
export async function getTransactions() {
  const token = await getNGOToken()
  if (!token) throw new Error('Cannot connect to NGO server')

  const res = await fetch(`${NGO_BASE}/ngo/transactions`, {
    headers: { 'Authorization': 'Bearer ' + token }
  })

  const json = await res.json()
  if (!json.success) throw new Error(json.message)
  return json.transactions
}

export async function getNGOStats() {
  const token = await getNGOToken()
  if (!token) throw new Error('Cannot connect to NGO server')

  const res = await fetch(`${NGO_BASE}/ngo/stats`, {
    headers: { 'Authorization': 'Bearer ' + token }
  })

  const json = await res.json()
  if (!json.success) throw new Error(json.message)
  return json.data
}
// Start connect process
export async function connectAccount(accountId) {
  const token = await getNGOToken()
  if (!token) throw new Error(
    'Cannot connect to NGO server'
  )
  const res = await fetch(
    `${NGO_BASE}/ngo/accounts/${accountId}/connect`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      }
    }
  )
  const json = await res.json()
  if (!json.success) throw new Error(json.message)
  return json
}

// Submit OTP
export async function verifyOTP(accountId, otp) {
  const token = await getNGOToken()
  const res = await fetch(
    `${NGO_BASE}/ngo/accounts/${accountId}/verify-otp`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ otp })
    }
  )
  const json = await res.json()
  if (!json.success) throw new Error(json.message)
  return json
}

// Get account status
export async function getAccountStatus(accountId) {
  const token = await getNGOToken()
  const res = await fetch(
    `${NGO_BASE}/ngo/accounts/${accountId}/status`,
    {
      headers: { 
        'Authorization': 'Bearer ' + token 
      }
    }
  )
  return await res.json()
}

// Manual sync
export async function syncAccount(accountId) {
  const token = await getNGOToken()
  const res = await fetch(
    `${NGO_BASE}/ngo/accounts/${accountId}/sync`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token
      }
    }
  )
  const json = await res.json()
  if (!json.success) throw new Error(json.message)
  return json
}

export async function generateLicense() {
  const { token, ngoId } = await getNGOAuth()
  if (!token) throw new Error('Cannot connect to NGO server')
  const res = await fetch(
    `${NGO_BASE}/apk/generate-license`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ ngoId })
    }
  );
  const json = await res.json();
  if (!json.success) throw new Error(json.message);
  return json;
}

export async function getDevices() {
  const { token, ngoId } = await getNGOAuth()
  if (!token) throw new Error('Cannot connect to NGO server')
  const res = await fetch(
    `${NGO_BASE}/apk/devices/${ngoId}`,
    {
      headers: {
        'Authorization': 'Bearer ' + token
      }
    }
  );
  const json = await res.json();
  if (!json.success) throw new Error(json.message);
  return json.devices;
}

// Rename a paired device (trader-assigned display name).
export async function renameDevice(deviceId, deviceName) {
  const token = await getNGOToken()
  if (!token) throw new Error('Cannot connect to NGO server')
  const res = await fetch(
    `${NGO_BASE}/apk/devices/${deviceId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ deviceName })
    }
  );
  const json = await res.json();
  if (!json.success) throw new Error(json.message);
  return json.device;
}

// Permanently delete a device (real backend DELETE, not a client-side hide).
export async function deleteDevice(deviceId) {
  const token = await getNGOToken()
  if (!token) throw new Error('Cannot connect to NGO server')
  const res = await fetch(
    `${NGO_BASE}/apk/devices/${deviceId}`,
    {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    }
  );
  const json = await res.json();
  if (!json.success) throw new Error(json.message);
  return json;
}

// Real-time liveness check for one device (for gating actions like linking
// a Details account into an Offer) — same ~15s heartbeat window as the
// Smartphones page's online dot, computed fresh server-side each call.
export async function getDeviceLiveness(deviceId) {
  const devices = await getDevices()
  return devices.find((d) => d.id === deviceId) || null
}