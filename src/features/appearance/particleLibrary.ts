export interface ParticleAtlas {
  image: Blob
  columns: number
  rows: number
  frameDurations: number[]
}

export interface ParticleAppearance {
  id: string
  name: string
}

export interface ParticleAssets {
  tap: ParticleAtlas
  hold: ParticleAtlas
}

const PROFILE_STORE = 'appearances'
const ASSET_STORE = 'atlases'

function openLibrary() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('moonweave-particle-library', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(PROFILE_STORE, { keyPath: 'id' })
      request.result.createObjectStore(ASSET_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transact<T>(stores: string[], mode: IDBTransactionMode, operation: (transaction: IDBTransaction) => IDBRequest<T>) {
  const database = await openLibrary()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(stores, mode)
      transaction.onabort = () => reject(transaction.error ?? new Error('Particle library transaction aborted'))
      try {
        const request = operation(transaction)
        transaction.oncomplete = () => resolve(request.result)
      } catch (error) {
        transaction.abort()
        reject(error)
      }
    })
  } finally {
    database.close()
  }
}

export function listParticleAppearances(): Promise<ParticleAppearance[]> {
  return transact([PROFILE_STORE], 'readonly', (transaction) => transaction.objectStore(PROFILE_STORE).getAll())
}

export function readParticleAssets(id: string): Promise<ParticleAssets | undefined> {
  return transact([ASSET_STORE], 'readonly', (transaction) => transaction.objectStore(ASSET_STORE).get(id))
}

export function addParticleAppearance(appearance: ParticleAppearance, assets: ParticleAssets) {
  return transact([PROFILE_STORE, ASSET_STORE], 'readwrite', (transaction) => {
    transaction.objectStore(ASSET_STORE).add(assets, appearance.id)
    return transaction.objectStore(PROFILE_STORE).add(appearance)
  })
}

export function renameParticleAppearance(appearance: ParticleAppearance) {
  return transact([PROFILE_STORE], 'readwrite', (transaction) => {
    const store = transaction.objectStore(PROFILE_STORE)
    const request = store.get(appearance.id)
    request.onsuccess = () => {
      if (request.result) store.put(appearance)
      else transaction.abort()
    }
    return request
  })
}

export function deleteParticleAppearance(id: string) {
  return transact([PROFILE_STORE, ASSET_STORE], 'readwrite', (transaction) => {
    transaction.objectStore(ASSET_STORE).delete(id)
    return transaction.objectStore(PROFILE_STORE).delete(id)
  })
}
