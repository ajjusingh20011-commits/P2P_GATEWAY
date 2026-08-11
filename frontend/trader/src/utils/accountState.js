/**
 * One source of truth for "what state is this payment account actually in".
 *
 * Every live-pool count, summary tile and row badge in the trader panel used
 * to be derived from `is_active_detail` alone — the toggle position, i.e. the
 * trader's INTENT. That reported accounts as "Live" that had never had a
 * device or web session attached to them, and accounts whose connection had
 * died minutes earlier. Intent and real connection status are separate things
 * and are now kept separate: the toggle still expresses intent and is the only
 * settable control, while everything that claims an account is live reads the
 * real `connection_alive` mirrored from ngo-backend by
 * backend/src/jobs/connectionLiveness.js.
 */

export const ACCOUNT_STATE = {
  LIVE: 'live',
  RECONNECT: 'reconnect',
  MANUAL: 'manual',
  NEVER: 'never',
  OFF: 'off',
};

export const STATE_META = {
  // `short` is for the narrow Live-pool table column; `label` is the full
  // wording used everywhere there's room for it.
  [ACCOUNT_STATE.LIVE]: {
    label: 'Live',
    short: 'Live',
    hex: '#22c55e',
    title: 'Connection confirmed alive — this account is receiving orders',
  },
  [ACCOUNT_STATE.RECONNECT]: {
    label: 'Reconnect needed',
    short: 'Reconnect',
    hex: '#f59e0b',
    title: 'This account was connected but its device or web session is not responding now',
  },
  [ACCOUNT_STATE.MANUAL]: {
    label: 'Manual',
    short: 'Manual',
    hex: '#3b82f6',
    title: 'No connection linked — you confirm this account’s payments by hand, so it still receives orders',
  },
  [ACCOUNT_STATE.NEVER]: {
    label: 'Not connected',
    short: 'No link',
    hex: '#ef4444',
    title: 'Not connected — link a device or Web Login first',
  },
  [ACCOUNT_STATE.OFF]: {
    label: 'Off',
    short: 'Off',
    hex: '#94a3b8',
    title: 'Turned off — this account is not receiving orders by your choice',
  },
};

/**
 * Classify a trader-native payment detail.
 *
 * `connection_alive` is deliberately three-state (see the migration):
 *   true  - a device/session is linked and confirmed responding
 *   false - one is linked but confirmed dead
 *   null  - nothing has ever been linked to this UPI
 */
export function accountState(d) {
  if (!d) return ACCOUNT_STATE.OFF;
  // The toggle is intent, and OFF is a normal trader choice, not a fault —
  // it wins over connection status so a deliberately-parked account never
  // renders as an error.
  if (d.is_active_detail === false) return ACCOUNT_STATE.OFF;
  if (d.connection_alive === true) return ACCOUNT_STATE.LIVE;
  if (d.connection_alive === false) return ACCOUNT_STATE.RECONNECT;
  // Nothing linked: routing only accepts it on an explicit manual opt-in
  // (routingEngine.pickEligibleAccount), so the two cases are not the same.
  return d.manually_confirmed ? ACCOUNT_STATE.MANUAL : ACCOUNT_STATE.NEVER;
}

// An ngo (Web Login) account carries its own real session status rather than
// a mirrored flag, so it maps on its own terms.
export function ngoAccountState(a) {
  if (!a) return ACCOUNT_STATE.OFF;
  if (a.status === 'live') return ACCOUNT_STATE.LIVE;
  if (a.status === 'failed' || a.status === 'paused') return ACCOUNT_STATE.RECONNECT;
  return ACCOUNT_STATE.NEVER;
}

/**
 * Genuinely live: a confirmed-alive connection AND the trader wants orders on
 * it. `is_active` is the separate admin/linkage gate routing also requires.
 */
export const isLive = (d) => !!d && d.is_active !== false && accountState(d) === ACCOUNT_STATE.LIVE;

/**
 * What routing will actually accept — mirrors pickEligibleAccount's connection
 * branch. Broader than isLive because a manually-confirmed account with no
 * connection does still receive orders; kept distinct so a "Live" count never
 * quietly includes one.
 */
export const isRoutable = (d) => {
  if (!d || d.is_active === false) return false;
  const s = accountState(d);
  return s === ACCOUNT_STATE.LIVE || s === ACCOUNT_STATE.MANUAL;
};

export const countBy = (details, pred) => (details || []).filter(pred).length;
