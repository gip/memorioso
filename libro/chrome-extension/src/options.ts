import { AUTO_SCAN_ORIGINS } from './auto-scan'
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

const list = document.querySelector<HTMLElement>('#endpoints')
const form = document.querySelector<HTMLFormElement>('#add')
const input = document.querySelector<HTMLInputElement>('#url')
const message = document.querySelector<HTMLElement>('#message')
const reset = document.querySelector<HTMLButtonElement>('#reset')
const autoScan = document.querySelector<HTMLInputElement>('#auto-scan')
const autoMessage = document.querySelector<HTMLElement>('#auto-message')

let endpoints: LibroRpcEndpoint[] = []

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
  render()
}

function renderEndpoint(endpoint: LibroRpcEndpoint): HTMLElement {
  const item = document.createElement('li')
  item.className = `endpoint${endpoint.enabled ? '' : ' disabled'}`

  const toggle = document.createElement('input')
  toggle.type = 'checkbox'
  toggle.checked = endpoint.enabled
  toggle.id = `toggle-${endpoint.url}`
  toggle.addEventListener('change', async () => {
    endpoints = endpoints.map((item) => item.url === endpoint.url ? { ...item, enabled: toggle.checked } : item)
    const enabled = endpoints.filter((item) => item.enabled).length
    await persist()
    say(enabled === 0 ? 'All endpoints are off, so the built-in list is used instead.' : '', enabled > 0)
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
    endpoints = endpoints.filter((item) => item.url !== endpoint.url)
    await persist()
    // Best effort: the origin may still be granted for another endpoint on the same host.
    await chrome.permissions.remove({ origins: [libroRpcOriginPattern(endpoint.url)] }).catch(() => undefined)
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
  endpoints = defaultLibroRpcEndpoints()
  await persist()
  say('Restored the built-in endpoints.', true)
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

loadLibroRpcEndpoints()
  .then((loaded) => {
    endpoints = loaded
    render()
  })
  .catch(() => say('Saved endpoints could not be read'))
