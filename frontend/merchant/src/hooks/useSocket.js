import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { toast } from '../components/Toaster';

/**
 * Broadcast a normalized order update to the rest of the app via a window
 * CustomEvent so any page can react without prop drilling or shared state.
 */
function broadcastOrderUpdate(order_id, status) {
  window.dispatchEvent(
    new CustomEvent('order:update', { detail: { order_id, status } })
  );
}

/**
 * Establishes a Socket.IO connection to the backend and reports status.
 * Wires real-time order events to toasts + a window `order:update` event.
 * Gracefully reports "disconnected" when the backend isn't running.
 */
export function useSocket() {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    const url = import.meta.env.VITE_WS_URL || 'http://localhost:4000';
    const token = localStorage.getItem('accessToken');

    const socket = io(url, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      auth: { token },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    // Real-time order events → toast + broadcast to pages. Guard null payloads.
    const orderId = (p) => (p && (p.order_id || p.id)) || '';
    socket.on('order:confirmed', (p) => {
      toast(`Order ${orderId(p)} confirmed`, 'success');
      broadcastOrderUpdate(orderId(p), 'confirmed');
    });
    socket.on('order:cancelled', (p) => {
      toast(`Order ${orderId(p)} cancelled`, 'error');
      broadcastOrderUpdate(orderId(p), 'cancelled');
    });
    socket.on('order:disputed', (p) => {
      toast(`Order ${orderId(p)} disputed`, 'warning');
      broadcastOrderUpdate(orderId(p), 'disputed');
    });
    socket.on('order:paid', (p) => {
      toast(`Order ${orderId(p)} marked paid`, 'info');
      broadcastOrderUpdate(orderId(p), 'paid');
    });

    return () => socket.disconnect();
  }, []);

  return { connected, socket: socketRef.current };
}
