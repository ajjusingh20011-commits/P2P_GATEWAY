// Tiny pub/sub buses so non-component code (the socket hook) can push UI
// updates — toasts, live activity, and donation refresh signals — without
// prop drilling or spinning up multiple socket connections.

function createBus() {
  const listeners = new Set()
  return {
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    emit(payload) {
      listeners.forEach((fn) => {
        try {
          fn(payload)
        } catch (err) {
          // A misbehaving listener must not break the others.
          console.error('bus listener error:', err)
        }
      })
    },
  }
}

export const toastBus = createBus()
export const activityBus = createBus()
export const donationBus = createBus()

let toastSeq = 0
export function showToast(message, type = 'info') {
  toastSeq += 1
  toastBus.emit({ id: `${Date.now()}-${toastSeq}`, message, type })
}

export function pushActivity(item) {
  activityBus.emit(item)
}

export function signalDonation(entry) {
  donationBus.emit(entry)
}
