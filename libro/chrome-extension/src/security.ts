const CONTENT_NOTIFICATION_TYPES = new Set([
  'LIBRO_CAPTURE_UPDATE',
  'LIBRO_AUTO_CAPTURE',
  'LIBRO_PAGE_MAY_HAVE_LIBRO',
  'LIBRO_RESULT_STALE',
])

export async function restrictExtensionStorageAccess(): Promise<void> {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.sync.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ])
}

export function isContentNotification(type: unknown): type is string {
  return typeof type === 'string' && CONTENT_NOTIFICATION_TYPES.has(type)
}

export function isTrustedContentSender(
  sender: chrome.runtime.MessageSender,
  runtimeId: string = chrome.runtime.id
): boolean {
  return sender.id === runtimeId && sender.frameId === 0 && typeof sender.tab?.id === 'number'
}

export function isTrustedExtensionPageSender(
  sender: chrome.runtime.MessageSender,
  runtimeId: string = chrome.runtime.id
): boolean {
  if (sender.id !== runtimeId || sender.tab) return false
  const extensionOrigin = `chrome-extension://${runtimeId}`
  return sender.origin === extensionOrigin || sender.url?.startsWith(`${extensionOrigin}/`) === true
}
