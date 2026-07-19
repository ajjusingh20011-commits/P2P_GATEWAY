/**
 * Proxy assignment/rotation helper. Each NGO scrapes its payment accounts
 * through a dedicated proxy so sessions look consistent to the platform.
 *
 * This is intentionally lightweight — it reads credentials from the env and
 * produces Puppeteer-compatible launch args. Swap the pool source for a real
 * provider (e.g. rotating residential proxies) as needed.
 */

const PROXY_USERNAME = process.env.PROXY_USERNAME || '';
const PROXY_PASSWORD = process.env.PROXY_PASSWORD || '';

// A simple static pool; extend or source dynamically as required.
const proxyPool = (process.env.PROXY_POOL || '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

/**
 * Deterministically assigns a proxy IP to an NGO id from the pool.
 * Returns an empty string when no pool is configured (direct connection).
 * @param {string} ngoId
 * @returns {string}
 */
function assignProxy(ngoId) {
  if (proxyPool.length === 0) {
    return '';
  }
  let sum = 0;
  for (let i = 0; i < String(ngoId).length; i += 1) {
    sum += String(ngoId).charCodeAt(i);
  }
  return proxyPool[sum % proxyPool.length];
}

/**
 * Builds Puppeteer launch args + auth for a given proxy IP.
 * @param {string} proxyIp e.g. "1.2.3.4:8000"
 * @returns {{args: string[], auth: {username: string, password: string}|null}}
 */
function getLaunchOptions(proxyIp) {
  const args = ['--no-sandbox', '--disable-setuid-sandbox'];
  if (proxyIp) {
    args.push(`--proxy-server=${proxyIp}`);
  }
  const auth =
    PROXY_USERNAME && PROXY_PASSWORD
      ? { username: PROXY_USERNAME, password: PROXY_PASSWORD }
      : null;
  return { args, auth };
}

/**
 * Applies proxy authentication to a Puppeteer page, if credentials exist.
 * @param {import('puppeteer').Page} page
 */
async function authenticatePage(page) {
  if (PROXY_USERNAME && PROXY_PASSWORD && page && typeof page.authenticate === 'function') {
    await page.authenticate({ username: PROXY_USERNAME, password: PROXY_PASSWORD });
  }
}

module.exports = { assignProxy, getLaunchOptions, authenticatePage, proxyPool };
