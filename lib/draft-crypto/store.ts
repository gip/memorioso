'use client'

// Per-device cache for the author's draft key.
//
// The key is only derivable at login, when World ID proof material exists, but a
// page reload has no proof — so the unwrapped key is cached here and survives
// until sign-out. It is stored as a non-extractable CryptoKey, which IndexedDB
// can hold through structured clone: script on the page can use it to decrypt,
// and cannot read it back out to send anywhere.

const DATABASE_NAME = 'memorioso-draft-keys'
const DATABASE_VERSION = 1
const STORE_NAME = 'keys'

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> => {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode)
      const request = run(transaction.objectStore(STORE_NAME))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

const isAvailable = (): boolean => typeof window !== 'undefined' && 'indexedDB' in window

/**
 * Reads this device's cached key for one author. Returns null whenever there is
 * nothing to read — including in private windows, where IndexedDB may refuse —
 * because a missing key is a prompt to unlock, never an error.
 */
export async function readCachedDraftKey(userId: number): Promise<CryptoKey | null> {
  if (!isAvailable()) return null
  try {
    const stored = await withStore<CryptoKey | undefined>('readonly', (store) => store.get(userId))
    return stored instanceof CryptoKey ? stored : null
  } catch {
    return null
  }
}

/** Caches the key for this device. A storage failure only costs another unlock. */
export async function writeCachedDraftKey(userId: number, key: CryptoKey): Promise<void> {
  if (!isAvailable()) return
  try {
    await withStore('readwrite', (store) => store.put(key, userId))
  } catch {
    // Nothing to do: the next login derives the key again.
  }
}

/** Forgets every cached key. Called on sign-out, so a shared device keeps nothing. */
export async function clearCachedDraftKeys(): Promise<void> {
  if (!isAvailable()) return
  try {
    await withStore('readwrite', (store) => store.clear())
  } catch {
    // A device that cannot clear its cache also cannot have written to it.
  }
}
