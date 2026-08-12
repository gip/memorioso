import { AUTO_SCAN_ORIGINS } from './auto-scan'
import {
  loadApprovedManifestOrigins,
  manifestOriginPattern,
  normalizeManifestOrigin,
  saveApprovedManifestOrigins,
} from './manifest-access'
import {
  defaultLibroRpcEndpoints,
  isDefaultLibroRpcUrl,
  libroRpcHost,
  libroRpcOriginPattern,
  loadLibroRpcEndpoints,
  normalizeLibroRpcUrl,
  saveLibroRpcEndpoints,
  type LibroRpcEndpoint,
} from './rpc-settings'
import { clearLibroVerificationCache } from './verification-cache'

const API_ORIGIN = new URL(import.meta.env.VITE_MEMORIOSO_APP_URL || 'https://www.memorioso.xyz').origin

const list = document.querySelector<HTMLElement>('#endpoints')
const form = document.querySelector<HTMLFormElement>('#add')
const input = document.querySelector<HTMLInputElement>('#url')
const message = document.querySelector<HTMLElement>('#message')
const reset = document.querySelector<HTMLButtonElement>('#reset')
const autoScan = document.querySelector<HTMLInputElement>('#auto-scan')
const autoMessage = document.querySelector<HTMLElement>('#auto-message')
const manifestList = document.querySelector<HTMLElement>('#manifest-origins')
const manifestForm = document.querySelector<HTMLFormElement>('#add-manifest-origin')
const manifestInput = document.querySelector<HTMLInputElement>('#manifest-origin')
const manifestMessage = document.querySelector<HTMLElement>('#manifest-message')
const apiOrigin = document.querySelector<HTMLElement>('#api-origin')

let endpoints: LibroRpcEndpoint[] = []
let manifestOrigins: string[] = []

function say(text: string, ok = false): void {
  if (!message) return
  message.textContent = text
  message.className = ok ? 'message success' : 'message'
}

function sayAuto(text: string, ok = false): void {
  if (!autoMessage) return
  autoMessage.textContent = text
  autoMessage.className = ok ? 'message success' : 'message'
}

async function persist(): Promise<void> {
  await saveLibroRpcEndpoints(endpoints)
  await clearLibroVerificationCache()
  render()
}

function sayManifest(text: string, ok = false): void {
  if (!manifestMessage) return
  manifestMessage.textContent = text
  manifestMessage.className = ok ? 'message success' : 'message'
}

function originUsedByCustomRpc(origin: string): boolean {
  return endpoints.some((endpoint) => !isDefaultLibroRpcUrl(endpoint.url) && new URL(endpoint.url).origin === origin)
}

async function removeOriginPermissionIfUnused(origin: string): Promise<void> {
  if (manifestOrigins.includes(origin) || originUsedByCustomRpc(origin)) return
  await chrome.permissions.remove({ origins: [manifestOriginPattern(origin)] }).catch(() => undefined)
}

function renderEndpoint(endpoint: LibroRpcEndpoint): HTMLElement {
  const item = document.createElement('li')
  item.className = `endpoint${endpoint.enabled ? '' : ' disabled'}`

  const toggle = document.createElement('input')
  toggle.type = 'checkbox'
  toggle.checked = endpoint.enabled
  toggle.id = `toggle-${endpoint.url}`
  toggle.addEventListener('change', async () => {
    if (!toggle.checked && endpoint.enabled && endpoints.filter((item) => item.enabled).length === 1) {
      toggle.checked = true
      say('Keep at least one World Chain endpoint enabled.')
      return
    }
    endpoints = endpoints.map((item) => item.url === endpoint.url ? { ...item, enabled: toggle.checked } : item)
    await persist()
    say('', true)
  })

  const label = document.createElement('label')
  label.htmlFor = toggle.id
  const host = document.createElement('span')
  host.className = 'host'
  host.textContent = libroRpcHost(endpoint.url)
  const url = document.createElement('span')
  url.className = 'url'
  url.textContent = endpoint.url
  label.append(host, url)

  item.append(toggle, label)

  if (isDefaultLibroRpcUrl(endpoint.url)) {
    const tag = document.createElement('span')
    tag.className = 'tag'
    tag.textContent = 'built-in'
    item.append(tag)
    return item
  }

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.textContent = 'Remove'
  remove.style.marginLeft = 'auto'
  remove.addEventListener('click', async () => {
    if (endpoint.enabled && endpoints.filter((item) => item.enabled).length === 1) {
      say('Keep at least one World Chain endpoint enabled.')
      return
    }
    endpoints = endpoints.filter((item) => item.url !== endpoint.url)
    await persist()
    await removeOriginPermissionIfUnused(new URL(endpoint.url).origin)
    say(`Removed ${libroRpcHost(endpoint.url)}.`, true)
  })
  item.append(remove)
  return item
}

function render(): void {
  if (!list) return
  list.replaceChildren(...endpoints.map(renderEndpoint))
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!input) return

  let url: string
  try {
    url = normalizeLibroRpcUrl(input.value)
  } catch (error) {
    say(error instanceof Error ? error.message : 'That endpoint could not be added')
    return
  }
  if (endpoints.some((endpoint) => endpoint.url === url)) {
    say('That endpoint is already in the list')
    return
  }

  // Must run inside the submit gesture: Chrome rejects permission requests made after an await.
  const granted = await chrome.permissions.request({ origins: [libroRpcOriginPattern(url)] }).catch(() => false)
  if (!granted) {
    say('Permission to contact that host was declined, so it was not added')
    return
  }

  endpoints = [...endpoints, { url, enabled: true }]
  await persist()
  input.value = ''
  say(`Added ${libroRpcHost(url)}.`, true)
})

reset?.addEventListener('click', async () => {
  const customOrigins = [...new Set(endpoints
    .filter((endpoint) => !isDefaultLibroRpcUrl(endpoint.url))
    .map((endpoint) => new URL(endpoint.url).origin))]
  endpoints = defaultLibroRpcEndpoints()
  await persist()
  await Promise.all(customOrigins.map(removeOriginPermissionIfUnused))
  say('Restored the built-in endpoints.', true)
})

function renderManifestOrigins(): void {
  if (!manifestList) return
  manifestList.replaceChildren(...manifestOrigins.map((origin) => {
    const item = document.createElement('li')
    item.className = 'endpoint'
    const label = document.createElement('span')
    label.className = 'url'
    label.textContent = origin
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = 'Remove'
    remove.style.marginLeft = 'auto'
    remove.addEventListener('click', async () => {
      manifestOrigins = manifestOrigins.filter((candidate) => candidate !== origin)
      await saveApprovedManifestOrigins(manifestOrigins)
      renderManifestOrigins()
      await removeOriginPermissionIfUnused(origin)
      sayManifest(`Removed ${origin}.`, true)
    })
    item.append(label, remove)
    return item
  }))
}

manifestForm?.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!manifestInput) return
  let origin: string
  try {
    origin = normalizeManifestOrigin(manifestInput.value)
  } catch (error) {
    sayManifest(error instanceof Error ? error.message : 'That origin could not be added')
    return
  }
  if (origin === API_ORIGIN) {
    sayManifest('The Memorioso API origin is already trusted.')
    return
  }
  if (manifestOrigins.includes(origin)) {
    sayManifest('That manifest origin is already allowed.')
    return
  }
  const granted = await chrome.permissions.request({ origins: [manifestOriginPattern(origin)] }).catch(() => false)
  if (!granted) {
    sayManifest('Permission to contact that origin was declined.')
    return
  }
  manifestOrigins = [...manifestOrigins, origin].sort()
  await saveApprovedManifestOrigins(manifestOrigins)
  renderManifestOrigins()
  manifestInput.value = ''
  sayManifest(`Allowed manifests from ${origin}.`, true)
})

autoScan?.addEventListener('change', async () => {
  const wanted = autoScan.checked
  // Must run inside the change gesture: Chrome rejects permission requests made after an await.
  const granted = wanted
    ? await chrome.permissions.request({ origins: AUTO_SCAN_ORIGINS }).catch(() => false)
    : false

  if (wanted && !granted) {
    autoScan.checked = false
    sayAuto('Permission to read pages was declined, so automatic verification stays off')
    return
  }

  const response = await chrome.runtime.sendMessage({
    type: 'LIBRO_SET_AUTO_SCAN',
    enabled: wanted,
  }).catch(() => null) as { enabled?: boolean } | null
  const enabled = response?.enabled === true
  autoScan.checked = enabled

  if (!wanted) {
    // The registered script is already gone; holding a grant this broad past its purpose is not.
    await chrome.permissions.remove({ origins: AUTO_SCAN_ORIGINS }).catch(() => undefined)
  }
  sayAuto(
    enabled
      ? 'Every page you open is verified as it loads.'
      : wanted
        ? 'Automatic verification could not be turned on'
        : 'Pages are verified only when you open the Libro popup.',
    enabled || !wanted
  )
})

chrome.runtime.sendMessage({ type: 'LIBRO_GET_AUTO_SCAN' })
  .then((response: { enabled?: boolean } | undefined) => {
    if (autoScan) autoScan.checked = response?.enabled === true
  })
  .catch(() => sayAuto('The automatic verification setting could not be read'))

if (apiOrigin) apiOrigin.textContent = `Trusted by default: ${API_ORIGIN}`

Promise.all([loadLibroRpcEndpoints(), loadApprovedManifestOrigins()])
  .then(([loadedEndpoints, loadedManifestOrigins]) => {
    endpoints = loadedEndpoints
    manifestOrigins = loadedManifestOrigins
    render()
    renderManifestOrigins()
  })
  .catch(() => say('Saved verification settings could not be read'))
