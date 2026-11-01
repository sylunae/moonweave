// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { BpmDetectionDialog } from '@/features/chart/BpmDetectionDialog'
import { detectBpm } from '@/features/chart/detectBpm'

vi.mock('@/features/chart/detectBpm', () => ({ detectBpm: vi.fn() }))
vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (_zh: string, en: string) => en }) }))
afterEach(() => { vi.clearAllMocks() })

async function setup() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div'); document.body.appendChild(element)
  const root = createRoot(element)
  const onApply = vi.fn(), onUnavailable = vi.fn()
  await act(async () => root.render(<BpmDetectionDialog url="blob:audio" onApply={onApply} onUnavailable={onUnavailable} />))
  return { onApply, onUnavailable, cleanup: async () => { await act(async () => root.unmount()); element.remove() } }
}

it('offers half/double and only applies the confirmed value', async () => {
  vi.mocked(detectBpm).mockResolvedValue({ bpm: 150, reliable: true })
  const session = await setup()
  try {
    const button = (label: string) => [...document.querySelectorAll('button')].find((node) => node.textContent?.includes(label))!
    expect(session.onApply).not.toHaveBeenCalled()
    await act(async () => button('Half').click())
    expect(document.querySelector('input')?.value).toBe('75')
    await act(async () => button('Apply BPM').click())
    expect(session.onApply).toHaveBeenCalledWith(75)
  } finally { await session.cleanup() }
})

it('labels an uncertain result and allows ignoring it', async () => {
  vi.mocked(detectBpm).mockResolvedValue({ bpm: 135, reliable: false })
  const session = await setup()
  try {
    expect(document.body.textContent).toContain('Uncertain BPM estimate')
    await act(async () => [...document.querySelectorAll('button')].find((node) => node.textContent === 'Ignore')!.click())
    expect(session.onApply).not.toHaveBeenCalled()
  } finally { await session.cleanup() }
})

it('reports an unavailable estimate without applying anything', async () => {
  vi.mocked(detectBpm).mockResolvedValue(null)
  const session = await setup()
  try {
    expect(session.onUnavailable).toHaveBeenCalledOnce()
    expect(session.onUnavailable).toHaveBeenCalledWith('unavailable')
    expect(session.onApply).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  } finally { await session.cleanup() }
})

it.each([
  [new TypeError('Failed to fetch'), 'failed'],
  [new RangeError('size'), 'unsupported'],
])('distinguishes processing errors from a missing rhythm (%s)', async (error, reason) => {
  vi.mocked(detectBpm).mockRejectedValue(error)
  const session = await setup()
  try { expect(session.onUnavailable).toHaveBeenCalledWith(reason) }
  finally { await session.cleanup() }
})

it('aborts analysis on unmount and suppresses its late result', async () => {
  let finish!: (result: { bpm: number; reliable: boolean }) => void
  vi.mocked(detectBpm).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const session = await setup()
  const signal = vi.mocked(detectBpm).mock.calls.at(-1)![1]
  await session.cleanup()
  expect(signal.aborted).toBe(true)
  await act(async () => finish({ bpm: 150, reliable: true }))
  expect(session.onApply).not.toHaveBeenCalled()
  expect(session.onUnavailable).not.toHaveBeenCalled()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
