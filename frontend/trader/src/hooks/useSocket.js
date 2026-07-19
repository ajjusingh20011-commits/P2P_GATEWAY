import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

/**
 * Establishes a Socket.IO connection to the backend and reports status.
 * Real-time event handlers (order updates, payout alerts) get wired here later.
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

    // TODO: subscribe to real-time channels, e.g.
    // socket.on('order:new', handler);
    // socket.on('payout:assigned', handler);

    return () => socket.disconnect();
  }, []);

  return { connected, socket: socketRef.current };
}
