import Navbar from './Navbar'
import Sidebar from './Sidebar'
import ToastContainer from './Toast'
import useSocket from '../hooks/useSocket'
import { theme } from '../theme'

// Shared app shell for every protected page. Owns the single Socket.io
// connection (so navigating between pages doesn't reconnect) and passes the
// live-connection status down to the Navbar.
export default function Layout({ children }) {
  const { connected } = useSocket()

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: theme.bg }}>
      <Sidebar />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Navbar connected={connected} />
        <main style={{ flex: 1, padding: '28px 32px' }}>{children}</main>
      </div>
      <ToastContainer />
    </div>
  )
}
