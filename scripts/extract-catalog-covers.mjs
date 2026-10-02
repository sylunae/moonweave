import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'

const packages = ["Rrhar'il.mwchart", '田中.mwchart']
const sourceDirectory = 'public/tests'
const outputDirectory = join(sourceDirectory, 'covers')
const previews = {}

mkdirSync(outputDirectory, { recursive: true })

for (const packageName of packages) {
  const files = unzipSync(readFileSync(join(sourceDirectory, packageName)))
  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  const cover = manifest.assets?.cover
  if (!cover?.path || !cover?.name || !files[cover.path]) throw new Error(`${packageName} does not include cover art`)

  const filename = `${basename(packageName, extname(packageName))}${extname(cover.name).toLowerCase()}`
  writeFileSync(join(outputDirectory, filename), files[cover.path])
  previews[packageName] = `covers/${filename}`
}

writeFileSync(join(sourceDirectory, 'covers.json'), `${JSON.stringify(previews, null, 2)}\n`)
