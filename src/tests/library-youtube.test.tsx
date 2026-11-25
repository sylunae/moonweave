// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LibraryForm } from '@/features/chart/LibraryForm'
import { DEFAULT_CHART, normalizeChart } from '@/features/chart/types'
import type { YoutubeImportAPI } from '@/shared/electron'
import { youtubeVideoId } from '@/shared/youtubeUrl'

vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (_zh: string, en: string) => en }) }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('installs on demand and stages the imported audio until the chart is created', async () => {
  let status: 'ready' | 'missing' = 'missing'
  const api = {
    status: vi.fn(async () => status),
    install: vi.fn(async () => { status = 'ready' }),
    download: vi.fn<YoutubeImportAPI['download']>().mockResolvedValue({
      ok: true,
      media: { title: 'Song title', artist: 'Composer', audioName: 'Song title.mp3', duration: 153_500 },
    }),
    discard: vi.fn(async () => {}),
  }
  vi.stubGlobal('sylunae', { platform: 'electron' })
  vi.stubGlobal('moonweave', { youtube: api })
  const onSave = vi.fn(async () => true)
  const onClose = vi.fn()
  const { unmount } = render(<LibraryForm chart={normalizeChart(DEFAULT_CHART)} creating onSave={onSave} onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: 'Import from YouTube' }))
  const install = await screen.findByRole('button', { name: 'Download and install plugin' })
  expect(api.install).not.toHaveBeenCalled()
  expect(api.download).not.toHaveBeenCalled()
  fireEvent.click(install)
  const link = await screen.findByRole('textbox', { name: 'YouTube video link' })
  fireEvent.change(link, { target: { value: 'https://youtu.be/abc_Abc-123' } })
  fireEvent.keyDown(link, { key: 'Enter' })
  await screen.findByText('Song title.mp3')
  expect(api.install).toHaveBeenCalledOnce()
  expect(api.download).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'https://youtu.be/abc_Abc-123')
  expect(onSave).not.toHaveBeenCalled()
  expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Song title')
  expect((screen.getByLabelText('Artist') as HTMLInputElement).value).toBe('Composer')
  expect((screen.getByLabelText('Duration (seconds)') as HTMLInputElement).value).toBe('153.5')
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited track title' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  const requestId = api.download.mock.calls[0][0]
  expect(onSave).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ title: 'Edited track title', artist: 'Composer', duration: 153_500 }),
    expect.objectContaining({ youtubeImportId: requestId }),
  )
  unmount()
  expect(api.discard).toHaveBeenCalledWith(requestId)
})

it('accepts video links, dropping playlist and timestamp parameters', () => {
  expect(youtubeVideoId('https://www.youtube.com/watch?v=abc_Abc-123&list=PL7&t=42')).toBe('abc_Abc-123')
  expect(youtubeVideoId('https://www.youtube.com/shorts/abc_Abc-123')).toBe('abc_Abc-123')
  expect(youtubeVideoId('https://music.youtube.com/watch?v=abc_Abc-123')).toBe('abc_Abc-123')
  expect(youtubeVideoId('https://www.youtube.com/playlist?list=PL7')).toBeNull()
  expect(youtubeVideoId('https://www.youtube.com.example.com/watch?v=abc_Abc-123')).toBeNull()
  expect(youtubeVideoId('https://www.youtube.com@other.example/watch?v=abc_Abc-123')).toBeNull()
})
