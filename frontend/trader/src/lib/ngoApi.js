const NGO_BASE = 'http://localhost:3000/api'
const NGO_CREDENTIALS = {
  email: 'staff@bright.org',
  password: 'staff123'
}

async function getNGOToken() {
  try {
    // Check if we have a valid stored token
    const stored = localStorage.getItem('ngo_token')
    const expiry = localStorage.getItem('ngo_token_expiry')

    if (stored && expiry && Date.now() < parseInt(expiry)) {
      return stored
    }

    // Login to get fresh token
    const res = await fetch(`${NGO_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(NGO_CREDENTIALS)
    })

    const data = await res.json()

    if (data.success) {
      const token = data.data.token
      // Store token with 6 hour expiry
      localStorage.setItem('ngo_token', token)
      localStorage.setItem(
        'ngo_token_expiry',
        Date.now() + 6 * 60 * 60 * 1000
      )
      return token
    }
    return null
  } catch (err) {
    console.error('NGO login failed:', err)
    return null
  }
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
  return json.data
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
  const token = await getNGOToken();
  const ngoId = '6a4be25836583c99fa079802';
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
  const token = await getNGOToken();
  const ngoId = '6a4be25836583c99fa079802';
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