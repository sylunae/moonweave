import type { Chart } from './types'

export interface WebChartRecord {
  id: string
  chart: Chart
  updatedAt: number
  audio?: Blob
  background?: Blob
  cover?: Blob
}

const DATABASE_NAME = 'moonweave-library'
const STORE_NAME = 'charts'

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开浏览器谱面库'))
  })
}

async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void) {
  const database = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    operation(transaction.objectStore(STORE_NAME), resolve, reject)
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => reject(transaction.error ?? new Error('浏览器谱面库操作失败'))
  })
}

export const listWebCharts = () => transact<WebChartRecord[]>('readonly', (store, resolve, reject) => {
  const request = store.getAll()
  request.onsuccess = () => resolve(request.result as WebChartRecord[])
  request.onerror = () => reject(request.error)
})

export const readWebChart = (id: string) => transact<WebChartRecord | undefined>('readonly', (store, resolve, reject) => {
  const request = store.get(id)
  request.onsuccess = () => resolve(request.result as WebChartRecord | undefined)
  request.onerror = () => reject(request.error)
})

export async function writeWebChart(id: string, chart: Chart, assets: { audio?: Blob; background?: Blob | null; cover?: Blob | null } = {}) {
  const existing = await readWebChart(id)
  const record: WebChartRecord = {
    id, chart, updatedAt: Date.now(),
    audio: assets.audio === undefined ? existing?.audio : assets.audio,
    background: assets.background === undefined ? existing?.background : assets.background ?? undefined,
    cover: assets.cover === undefined ? existing?.cover : assets.cover ?? undefined,
  }
  return transact<WebChartRecord>('readwrite', (store, resolve, reject) => {
    const request = store.put(record)
    request.onsuccess = () => resolve(record)
    request.onerror = () => reject(request.error)
  })
}

export const deleteWebChart = (id: string) => transact<void>('readwrite', (store, resolve, reject) => {
  const request = store.delete(id)
  request.onsuccess = () => resolve()
  request.onerror = () => reject(request.error)
})
