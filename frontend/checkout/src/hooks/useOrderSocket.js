import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_ORIGIN } from '../services/api';

/**
 * Subscribe to real-time status updates for a single order.
 * Connects anonymously (the backend allows token-less sockets to follow one
 * order room) and invokes `onStatus(status, payload)` for order:* events.
 * Safe no-op when `orderId` is falsy.
 */
export function useOrderSocket(orderId, onStatus) {
  const cbRef = useRef(onStatus);
  cbRef.current = onStatus;

  useEffect(() => {
    if (!orderId) return undefined;

    const socket = io(SOCKET_ORIGIN, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      auth: {}, // anonymous — no token
    });

    const subscribe = () => socket.emit('subscribe:order', orderId);
    socket.on('connect', subscribe);

    const handle = (status) => (payload) => cbRef.current?.(status, payload);
    socket.on('order:confirmed', handle('confirmed'));
    socket.on('order:expired', handle('expired'));
    socket.on('order:cancelled', handle('cancelled'));
    socket.on('order:paid', handle('paid'));

    return () => socket.disconnect();
  }, [orderId]);
}
