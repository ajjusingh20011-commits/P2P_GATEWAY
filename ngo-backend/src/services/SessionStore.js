class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  setSession(accountId, data) {
    this.sessions.set(accountId.toString(), data);
  }

  getSession(accountId) {
    return this.sessions.get(accountId.toString());
  }

  removeSession(accountId) {
    const s = this.sessions.get(accountId.toString());
    if (s && s.browser) {
      s.browser.close().catch(() => {});
    }
    if (s && s.monitorInterval) {
      clearInterval(s.monitorInterval);
    }
    this.sessions.delete(accountId.toString());
  }

  getStatus(accountId) {
    const s = this.sessions.get(accountId.toString());
    return s ? s.status : 'disconnected';
  }

  async isSessionAlive(accountId) {
    const s = this.sessions.get(accountId.toString());
    if (!s || !s.page) return false;
    try {
      const url = s.page.url();
      return !url.includes('login');
    } catch {
      return false;
    }
  }
}

module.exports = new SessionStore();