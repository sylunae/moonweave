import { mkdtemp, open, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { readAnalysisAudio } from '../../electron/main/analysisAudio'

let directory: string
const id = '12345678-abcd'
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'moonweave-bpm-test-')) })
afterEach(async () => {
  for (const name of await readdir(directory)) await unlink(path.join(directory, name))
  await rmdir(directory)
})

it('reads chart-owned audio bytes', async () => {
  await writeFile(path.join(directory, `${id}.mp3`), new Uint8Array([1, 2, 3]))
  expect(await readAnalysisAudio(directory, id, `${id}.mp3`)).toEqual(new Uint8Array([1, 2, 3]))
})

it.each(['../outside.mp3', '87654321.mp3', `${id}.json`, `${id}.mp3/../../outside.mp3`])('rejects unowned or invalid audio references: %s', async (name) => {
  await expect(readAnalysisAudio(directory, id, name)).rejects.toThrow('无效')
})

it('skips oversized files before allocating an audio buffer', async () => {
  const file = await open(path.join(directory, `${id}.mp3`), 'w')
  await file.truncate(32 * 1024 * 1024 + 1); await file.close()
  expect(await readAnalysisAudio(directory, id, `${id}.mp3`)).toBeNull()
})
