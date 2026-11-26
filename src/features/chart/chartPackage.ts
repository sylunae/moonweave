import { normalizeEffects } from './effects/scrollSpeed'
import { strFromU8, strToU8, unzip, zip, type UnzipFileFilter } from 'fflate'
import type { Chart } from './types'

interface PackagedAsset {
  data: Uint8Array
  name: string
}

export interface ChartPackageAssets {
  audio?: PackagedAsset
  background?: PackagedAsset
  cover?: PackagedAsset
}

interface ChartPackageManifest {
  format: 'moonweave-chart'
  version: 1
  chart: 'chart.json'
  assets: Partial<Record<keyof ChartPackageAssets, { path: string; name: string }>>
}

export const chartPackageExtensions = ['mwchart', 'zip']
export const chartPackageAccept = `${chartPackageExtensions.map(extension => `.${extension}`).join(',')},application/zip`

export function isChartPackageFile(name: string) {
  const filename = name.toLowerCase()
  return chartPackageExtensions.some(extension => filename.endsWith(`.${extension}`))
}

const safeExtension = (name: string) => {
  const match = /\.[a-z0-9]{1,8}$/i.exec(name)
  return match?.[0].toLowerCase() ?? ''
}

function unzipChartEntries(data: Uint8Array, filter: UnzipFileFilter) {
  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(data, { filter }, (error, files) => error ? reject(error) : resolve(files))
  })
}

async function unpackChartMetadata(data: Uint8Array, maxChartBytes = Infinity) {
  const files = await unzipChartEntries(data, entry => (entry.name === 'manifest.json' && entry.originalSize <= 64 * 1024)
    || (entry.name === 'chart.json' && entry.originalSize <= maxChartBytes))
  const manifestBytes = files['manifest.json']
  const chartBytes = files['chart.json']
  if (!manifestBytes || !chartBytes) throw new Error('无效的 Moonweave 谱面包')
  const manifest = JSON.parse(strFromU8(manifestBytes)) as ChartPackageManifest | null
  if (manifest?.format !== 'moonweave-chart' || manifest.version !== 1) throw new Error('不支持的 Moonweave 谱面包版本')
  if (manifest.chart !== 'chart.json' || !manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) {
    throw new Error('无效的 Moonweave 谱面包')
  }
  const chart = JSON.parse(strFromU8(chartBytes)) as Record<string, unknown> | null
  if (!chart || !Array.isArray(chart.notes)) throw new Error('谱面文件格式无效')
  return { manifest, chart }
}

export async function readChartPackageMetadata(data: Uint8Array, maxChartBytes: number) {
  return (await unpackChartMetadata(data, maxChartBytes)).chart
}

export function createChartPackage(chart: Chart, assets: ChartPackageAssets) {
  const files: Record<string, Uint8Array> = {}
  const manifest: ChartPackageManifest = { format: 'moonweave-chart', version: 1, chart: 'chart.json', assets: {} }
  const packagedChart: Chart = { ...chart, effects: normalizeEffects(chart.effects) }

  for (const kind of ['audio', 'background', 'cover'] as const) {
    const asset = assets[kind]
    if (!asset) continue
    const assetPath = `assets/${kind}${safeExtension(asset.name)}`
    files[assetPath] = asset.data
    manifest.assets[kind] = { path: assetPath, name: asset.name }
    packagedChart[`${kind}Path` as 'audioPath' | 'backgroundPath' | 'coverPath'] = assetPath
    packagedChart[`${kind}Name` as 'audioName' | 'backgroundName' | 'coverName'] = asset.name
  }

  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  files['chart.json'] = strToU8(JSON.stringify(packagedChart, null, 2))
  return new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => error ? reject(error) : resolve(data))
  })
}

export async function readChartPackage(data: Uint8Array) {
  const { manifest, chart } = await unpackChartMetadata(data)
  const entries = (['audio', 'background', 'cover'] as const).flatMap(kind => {
    const entry = manifest.assets[kind]
    if (entry === undefined) return []
    if (!entry || typeof entry.path !== 'string' || !entry.path || typeof entry.name !== 'string' || !entry.name) {
      throw new Error(`谱面包的 ${kind} 资源声明无效`)
    }
    return [{ kind, path: entry.path, name: entry.name }]
  })
  const assets: ChartPackageAssets = {}
  if (entries.length) {
    const files = await unzipChartEntries(data, file => entries.some(entry => entry.path === file.name))
    for (const { kind, path, name } of entries) {
      if (!Object.hasOwn(files, path)) throw new Error(`谱面包缺少 ${kind} 资源`)
      assets[kind] = { data: files[path], name }
    }
  }
  return { chart, assets }
}
