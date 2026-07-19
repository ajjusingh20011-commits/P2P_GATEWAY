import { useState, useEffect, useRef } from 'react'
import { generateLicense, getDevices } from '../lib/ngoApi'

const styles = {
  container: {
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '12px',
    padding: '20px',
    marginTop: '20px'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px'
  },
  title: {
    color: '#e6edf3',
    fontSize: '16px',
    fontWeight: '600',
    margin: 0
  },
  addBtn: {
    background: '#00d4aa',
    color: '#000',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  deviceCard: {
    background: '#1a2332',
    border: '1px solid #1f2937',
    borderRadius: '8px',
    padding: '14px 16px',
    marginBottom: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  dot: (status) => ({
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    flexShrink: 0,
    background: status === 'active'
      ? '#00d4aa' : '#374151'
  }),
  deviceInfo: {
    flex: 1
  },
  deviceName: {
    color: '#e6edf3',
    fontSize: '14px',
    fontWeight: '500',
    margin: '0 0 2px'
  },
  deviceMeta: {
    color: '#6b7280',
    fontSize: '12px',
    margin: 0
  },
  statusBadge: (status) => ({
    background: status === 'active'
      ? '#052e1a' : '#1f2937',
    color: status === 'active'
      ? '#00d4aa' : '#6b7280',
    border: `1px solid ${status === 'active'
      ? '#00d4aa33' : '#374151'}`,
    borderRadius: '20px',
    padding: '3px 10px',
    fontSize: '11px',
    fontWeight: '500'
  }),
  empty: {
    textAlign: 'center',
    color: '#6b7280',
    fontSize: '14px',
    padding: '30px 0'
  },
  modal: {
    position: 'fixed',
    top: 0, left: 0,
    width: '100%', height: '100%',
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999
  },
  modalBox: {
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '16px',
    padding: '32px',
    width: '360px',
    textAlign: 'center'
  },
  modalTitle: {
    color: '#e6edf3',
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '8px'
  },
  modalSub: {
    color: '#6b7280',
    fontSize: '13px',
    marginBottom: '24px'
  },
  codeBox: {
    background: '#1a2332',
    border: '2px solid #00d4aa',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '20px'
  },
  codeText: {
    color: '#00d4aa',
    fontSize: '36px',
    fontWeight: '700',
    letterSpacing: '8px',
    margin: 0
  },
  copyBtn: {
    background: '#1f2937',
    color: '#e6edf3',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13px',
    cursor: 'pointer',
    marginBottom: '16px',
    width: '100%'
  },
  closeBtn: {
    background: 'transparent',
    color: '#6b7280',
    border: '1px solid #374151',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13px',
    cursor: 'pointer',
    width: '100%'
  },
  screenshotModal: {
    position: 'fixed',
    top: 0, left: 0,
    width: '100%', height: '100%',
    background: 'rgba(0,0,0,0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    flexDirection: 'column',
    gap: '16px'
  },
  screenshotImg: {
    maxWidth: '90vw',
    maxHeight: '80vh',
    borderRadius: '8px',
    border: '2px solid #00d4aa'
  },
  screenshotInfo: {
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '8px',
    padding: '12px 20px',
    color: '#e6edf3',
    fontSize: '13px',
    textAlign: 'center'
  }
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr)
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (mins < 1) return 'just now'
  if (mins < 60) return mins + 'm ago'
  if (hours < 24) return hours + 'h ago'
  return days + 'd ago'
}

export default function DeviceManager({ socket }) {
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCodeModal, setShowCodeModal] = useState(false)
  const [generatedCode, setGeneratedCode] = useState('')
  const [generating, setGenerating] = useState(false)
  const [screenshot, setScreenshot] = useState(null)
  const [screenshotInfo, setScreenshotInfo] = useState(null)
  const [copied, setCopied] = useState(false)

  const loadDevices = async () => {
    try {
      const list = await getDevices()
      setDevices(list || [])
    } catch(e) {
      console.error('Load devices error:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDevices()

    if (!socket) return

    socket.on('device-registered', (data) => {
      console.log('Device registered:', data)
      loadDevices()
    })

    socket.on('screenshot-received', (data) => {
      console.log('Screenshot received!', data)
      setScreenshot(data.screenshot)
      setScreenshotInfo({
        deviceName: data.deviceName,
        capturedAt: data.capturedAt,
        recordedData: data.recordedData || {}
      })
    })

    return () => {
      socket.off('device-registered')
      socket.off('screenshot-received')
    }
  }, [socket])

  const handleGenerateLicense = async () => {
    setGenerating(true)
    try {
      const result = await generateLicense()
      setGeneratedCode(result.licenseKey)
      setShowCodeModal(true)
    } catch(e) {
      alert('Error: ' + e.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleCopyCode = () => {
    navigator.clipboard.writeText(generatedCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>
          📱 Registered Devices
        </h3>
        <button
          style={styles.addBtn}
          onClick={handleGenerateLicense}
          disabled={generating}
        >
          {generating
            ? 'Generating...'
            : '+ Add Device'}
        </button>
      </div>

      {loading ? (
        <p style={styles.empty}>
          Loading devices...
        </p>
      ) : devices.length === 0 ? (
        <div style={styles.empty}>
          <p>No devices registered yet.</p>
          <p style={{fontSize: '12px'}}>
            Click "Add Device" to get a
            registration code for PaymentBot APK.
          </p>
        </div>
      ) : (
        devices.map(device => (
          <div
            key={device.id}
            style={styles.deviceCard}
          >
            <div style={styles.dot(device.status)} />
            <div style={styles.deviceInfo}>
              <p style={styles.deviceName}>
                {device.deviceName || 'Unnamed Device'}
              </p>
              <p style={styles.deviceMeta}>
                {device.deviceModel &&
                  device.deviceModel + ' • '}
                Last seen: {timeAgo(device.lastSeen)}
                {' • '}
                Code: {device.licenseKey
                  ? device.licenseKey.substring(0,2)
                    + '****'
                  : 'N/A'}
              </p>
            </div>
            <span style={styles.statusBadge(
              device.status
            )}>
              {device.status === 'active'
                ? '● Active'
                : '○ Pending'}
            </span>
          </div>
        ))
      )}

      {showCodeModal && (
        <div style={styles.modal}>
          <div style={styles.modalBox}>
            <p style={styles.modalTitle}>
              📱 Install PaymentBot
            </p>
            <p style={styles.modalSub}>
              Enter this code in the PaymentBot
              app to register the device
            </p>
            <div style={styles.codeBox}>
              <p style={styles.codeText}>
                {generatedCode}
              </p>
            </div>
            <button
              style={styles.copyBtn}
              onClick={handleCopyCode}
            >
              {copied ? '✅ Copied!' : '📋 Copy Code'}
            </button>
            <p style={{
              color: '#6b7280',
              fontSize: '12px',
              marginBottom: '16px'
            }}>
              Once the device registers it will
              appear in the list above with a
              green dot ●
            </p>
            <button
              style={styles.closeBtn}
              onClick={() => {
                setShowCodeModal(false)
                setGeneratedCode('')
                loadDevices()
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {screenshot && (
        <div style={styles.screenshotModal}
          onClick={() => {
            setScreenshot(null)
            setScreenshotInfo(null)
          }}
        >
          <div style={styles.screenshotInfo}>
            📷 Screenshot from{' '}
            {screenshotInfo?.deviceName || 'device'}
            {' • '}
            {screenshotInfo?.capturedAt
              ? new Date(screenshotInfo.capturedAt)
                  .toLocaleTimeString()
              : ''}
            {screenshotInfo?.recordedData
              ?.amount && (
              <span style={{color: '#00d4aa'}}>
                {' • ₹'}
                {screenshotInfo.recordedData.amount}
                {screenshotInfo.recordedData
                  .recipientName
                  ? ' → ' + screenshotInfo
                      .recordedData.recipientName
                  : ''}
              </span>
            )}
            <br/>
            <span style={{
              color: '#6b7280',
              fontSize: '11px'
            }}>
              Click anywhere to close
            </span>
          </div>
          <img
            src={`data:image/jpeg;base64,${screenshot}`}
            style={styles.screenshotImg}
            alt="Payment screenshot"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
