import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { toast } from '../components/toast';

/**
 * Establishes a Socket.IO connection to the backend and reports status.
 * Wires real-time order/trader events into the toast system and re-broadcasts
 * them as `order:update` window CustomEvents so pages can refetch/patch.
 * Also tracks a running "paid orders" count for the current session.
 * Gracefully reports "disconnected" when the backend isn't running.
 */
export function useSocket() {
  const [connected, setConnected] = useState(false);
  const [paidCount, setPaidCount] = useState(0);
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

    socket.on('connect', () => {
      setConnected(true);
      // Admin joins the shared admin room.
      socket.emit('join', 'admin');
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    // Re-broadcast to the window so pages (e.g. Orders) can react without a
    // direct socket dependency.
    const emitUpdate = (type, payload) => {
      window.dispatchEvent(new CustomEvent('order:update', { detail: { type, ...payload } }));
    };

    const orderId = (p) => p?.order_id || p?.orderId || p?.id || p?.uuid || '';

    socket.on('order:paid', (p) => {
      toast(`New paid order ${orderId(p)}`, 'success');
      setPaidCount((c) => c + 1);
      emitUpdate('paid', p);
    });

    socket.on('order:confirmed', (p) => {
      toast(`Order ${orderId(p)} confirmed`, 'success');
      emitUpdate('confirmed', p);
    });

    socket.on('order:cancelled', (p) => {
      toast(`Order ${orderId(p)} cancelled`, 'warning');
      emitUpdate('cancelled', p);
    });

    socket.on('order:disputed', (p) => {
      toast(`Order ${orderId(p)} disputed`, 'error');
      emitUpdate('disputed', p);
    });

    socket.on('trader:online', (p) => {
      const who = p?.name || p?.trader_id || p?.id || '';
      if (who) toast(`Trader ${who} online`, 'info');
    });

    socket.on('trader:offline', (p) => {
      const who = p?.name || p?.trader_id || p?.id || '';
      if (who) toast(`Trader ${who} offline`, 'info');
    });

    return () => socket.disconnect();
  }, []);

  return { connected, socket: socketRef.current, paidCount };
}
