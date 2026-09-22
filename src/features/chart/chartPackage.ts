import { strFromU8, strToU8, unzip, zip } from 'fflate'
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

const safeExtension = (name: string) => {
  const match = /\.[a-z0-9]{1,8}$/i.exec(name)
  return match?.[0].toLowerCase() ?? ''
}

export function createChartPackage(chart: Chart, assets: ChartPackageAssets) {
  const files: Record<string, Uint8Array> = {}
  const manifest: ChartPackageManifest = { format: 'moonweave-chart', version: 1, chart: 'chart.json', assets: {} }
  const packagedChart: Chart = { ...chart }

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

export function readChartPackage(data: Uint8Array) {
  return new Promise<{ chart: unknown; assets: ChartPackageAssets }>((resolve, reject) => {
    unzip(data, (error, files) => {
      if (error) { reject(error); return }
      try {
        const manifestBytes = files['manifest.json']
        const chartBytes = files['chart.json']
        if (!manifestBytes || !chartBytes) throw new Error('无效的 Moonweave 谱面包')
        const manifest = JSON.parse(strFromU8(manifestBytes)) as Partial<ChartPackageManifest>
        if (manifest.format !== 'moonweave-chart' || manifest.version !== 1 || !manifest.assets) throw new Error('不支持的 Moonweave 谱面包版本')
        const assets: ChartPackageAssets = {}
        for (const kind of ['audio', 'background', 'cover'] as const) {
          const entry = manifest.assets[kind]
          if (!entry || typeof entry.path !== 'string' || typeof entry.name !== 'string') continue
          const assetData = files[entry.path]
          if (!assetData) throw new Error(`谱面包缺少 ${kind} 资源`)
          assets[kind] = { data: assetData, name: entry.name }
        }
        resolve({ chart: JSON.parse(strFromU8(chartBytes)) as unknown, assets })
      } catch (reason) { reject(reason) }
    })
  })
}
