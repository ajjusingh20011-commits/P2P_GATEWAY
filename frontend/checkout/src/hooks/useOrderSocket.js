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

    /*
     * Every event the backend actually emits into the order room (`emitToOrder`
     * — see backend/src/websocket/index.js and services/smartMerge.js). The
     * previous list subscribed to `order:paid`, which nothing emits, and omitted
     * rejected / disputed / claimed_paid / assigned / updated — so CheckoutPage's
     * handler branches for those statuses could never fire and the page silently
     * fell back to the 3s poll. Event names are mapped onto the status strings
     * the page already switches on; no handling logic changed.
     */
    const EVENTS = {
      'order:confirmed': 'confirmed',
      'order:success': 'success',
      'order:completed': 'completed',
      'order:claimed_paid': 'claimed_paid',
      'order:rejected': 'rejected',
      'order:disputed': 'disputed',
      'order:expired': 'expired',
      'order:cancelled': 'cancelled',
      'order:assigned': 'assigned',
      'order:updated': 'updated',
    };
    Object.entries(EVENTS).forEach(([event, status]) => socket.on(event, handle(status)));

    return () => socket.disconnect();
  }, [orderId]);
}
