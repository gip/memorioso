/**
 * Automatic verification of every page.
 *
 * The click-to-scan path rides the `activeTab` grant, which does not survive navigation, so it can
 * never run by itself. Scanning without a click needs real host permission, which is declared as
 * optional and requested from the options page rather than at install time.
 *
 * The preference lives in `chrome.storage.local`, not `sync`: the permission it depends on is not
 * synced, so a synced "on" would claim automatic verification on a profile that cannot do it.
 */

export const AUTO_SCAN_KEY = 'libro:auto-scan'
export const AUTO_SCAN_SCRIPT_ID = 'libro-auto-scan'

/** Must stay in step with `optional_host_permissions` in the manifest. */
export const AUTO_SCAN_ORIGINS = ['https://*/*']

export async function autoScanPreference(): Promise<boolean> {
  const stored = await chrome.storage.local.get(AUTO_SCAN_KEY)
  return stored[AUTO_SCAN_KEY] === true
}

export async function setAutoScanPreference(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [AUTO_SCAN_KEY]: enabled })
}

export async function hasAutoScanPermission(): Promise<boolean> {
  return chrome.permissions.contains({ origins: AUTO_SCAN_ORIGINS }).catch(() => false)
}

async function isAutoScanRegistered(): Promise<boolean> {
  const registered = await chrome.scripting
    .getRegisteredContentScripts({ ids: [AUTO_SCAN_SCRIPT_ID] })
    .catch(() => [])
  return registered.length > 0
}

/**
 * Registered rather than injected: a dynamic content script persists across browser restarts and
 * runs before the service worker would have any way of knowing the page loaded.
 */
async function registerAutoScanScript(): Promise<void> {
  if (await isAutoScanRegistered()) return
  await chrome.scripting.registerContentScripts([{
    id: AUTO_SCAN_SCRIPT_ID,
    js: ['content.js'],
    matches: AUTO_SCAN_ORIGINS,
    runAt: 'document_idle',
    allFrames: false,
    persistAcrossSessions: true,
  }])
}

async function unregisterAutoScanScript(): Promise<void> {
  if (!(await isAutoScanRegistered())) return
  await chrome.scripting.unregisterContentScripts({ ids: [AUTO_SCAN_SCRIPT_ID] }).catch(() => undefined)
}

async function reconcileAutoScan(): Promise<boolean> {
  const [preferred, granted] = await Promise.all([autoScanPreference(), hasAutoScanPermission()])
  if (preferred && !granted) await setAutoScanPreference(false)
  const active = preferred && granted
  if (active) await registerAutoScanScript()
  else await unregisterAutoScanScript()
  return active
}

// Granting the permission makes the options page and the permissions listener both reconcile, and
// registering the same script id twice is an error, so reconciliation runs one at a time.
let pendingSync: Promise<boolean> = Promise.resolve(false)

/**
 * Reconciles the registered content script with the preference and the permission, and returns
 * whether automatic scanning is actually live. Permission can be revoked from chrome://extensions
 * without the extension being asked, so a preference that no longer has one is turned off here
 * instead of being left claiming a state that cannot hold.
 */
export function syncAutoScan(): Promise<boolean> {
  pendingSync = pendingSync.catch(() => false).then(reconcileAutoScan)
  return pendingSync
}

/**
 * Turns automatic scanning on or off. Enabling requires permission to already be granted: Chrome
 * only honours `permissions.request()` inside a user gesture, so the options page asks first and
 * calls this with the answer.
 */
export async function setAutoScan(enabled: boolean): Promise<boolean> {
  await setAutoScanPreference(enabled && (await hasAutoScanPermission()))
  return syncAutoScan()
}
