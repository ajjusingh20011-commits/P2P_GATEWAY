import { useEffect, useRef, useState } from 'react'
import io from 'socket.io-client'
import { SOCKET_URL } from '../config/api'
import { showToast, pushActivity, signalDonation } from '../lib/bus'

/**
 * Connects to the backend Socket.io server, joins the logged-in NGO's room,
 * and wires the live events to the app:
 *   - newDonation      -> success toast + signal so stats/ledger can refresh
 *   - donation_intent  -> info ("pending") toast
 *   - raw_event        -> pushed into the sidebar activity feed
 *
 * Returns { connected, socket }.
 */
export default function useSocket() {
  const [connected, setConnected] = useState(false)
  const socketRef = useRef(null)

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || 'null')

    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      // Events are scoped to a room named after the ngoId.
      if (user && user.ngoId) {
        socket.emit('join', user.ngoId)
      }
    })

    socket.on('disconnect', () => setConnected(false))
    socket.on('connect_error', () => setConnected(false))

    socket.on('newDonation', (entry) => {
      const amount = entry && entry.amount ? entry.amount : '0'
      const donor = (entry && entry.donorName) || 'Unknown'
      showToast(`New donation: ₹${amount} from ${donor}`, 'success')
      signalDonation(entry)
    })

    socket.on('donation_intent', (intent) => {
      const amount = intent && intent.amount ? intent.amount : '0'
      showToast(`Pending donation intent: ₹${amount}`, 'info')
    })

    socket.on('raw_event', (evt) => {
      pushActivity({
        id: (evt && evt._id) || `${Date.now()}-${Math.random()}`,
        category: (evt && evt.category) || 'EVENT',
        sender: (evt && evt.sender) || '',
        amount: (evt && evt.amount) || '',
        at: (evt && (evt.utcTimestamp || evt.createdAt)) || new Date().toISOString(),
      })
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  return { connected, socket: socketRef.current }
}
