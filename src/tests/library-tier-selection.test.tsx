// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ChartManagementPage from '@/pages/ChartManagementPage'
import { normalizeManagedChart } from '@/features/chart/types'

const chart = normalizeManagedChart({ title: 'Track', library: { levels: [0, 4, 8, 10], tier: 1 } })
const other = normalizeManagedChart({ title: 'Other', library: { levels: [2, 5, 0, 14], tier: 3 } })
const selectChart = vi.fn(async () => false)
const api = {
  chart, selectChart, activeChartId: 'track', libraryReady: true,
  inspectChart: async () => other,
  charts: ([['track', chart], ['other', other]] as const).map(([id, entry]) => ({
    id, title: entry.title, artist: entry.artist, coverUrl: '', library: entry.library, noteCount: 0, updatedAt: 0,
  })),
}

vi.mock('@/features/chart/ChartProvider', () => ({ useChart: () => api }))
vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (_zh: string, en: string) => en, locale: 'en', language: 'en' }) }))
vi.mock('@/app/sound', () => ({ useSound: () => ({ play: vi.fn() }) }))
vi.mock('@/features/platform/PlatformProvider', () => ({ usePlatform: () => ({}) }))
vi.mock('@/components/PlayerMenu', () => ({ PlayerMenu: () => null }))

afterEach(() => {
  cleanup()
  selectChart.mockClear()
  vi.unstubAllGlobals()
})

it('switches difficulty on the first click and edits it on the next click', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query !== '(pointer: coarse)' }))
  render(<ChartManagementPage onSettings={() => {}} />)

  const hard = screen.getByRole('button', { name: /^HARD\s*8$/ })
  fireEvent.click(hard)
  expect(hard.getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(selectChart).not.toHaveBeenCalled()

  fireEvent.click(hard)
  expect(screen.getByRole('dialog', { name: 'Edit chart information' })).toBeTruthy()
})

it('applies the selected difficulty to every row and opens the matching track', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query !== '(pointer: coarse)' }))
  render(<ChartManagementPage onSettings={() => {}} />)

  const track = screen.getByRole('option', { name: /Track/ })
  const otherRow = screen.getByRole('option', { name: /Other/ })
  expect(within(track).getByText('4')).toBeTruthy()
  expect(within(otherRow).getByText('5')).toBeTruthy()

  fireEvent.keyDown(window, { key: 'ArrowRight' })
  expect(within(track).getByText('8')).toBeTruthy()
  expect(within(otherRow).getByText('1')).toBeTruthy()
  fireEvent.doubleClick(otherRow)
  expect(selectChart).toHaveBeenCalledWith('other', 2)

  fireEvent.click(otherRow)
  const hard = screen.getByRole('button', { name: /^HARD\s*1$/ })
  expect(hard.getAttribute('aria-pressed')).toBe('true')
  await waitFor(() => expect((screen.getByRole('button', { name: /Open editor/ }) as HTMLButtonElement).disabled).toBe(false))
})

it('waits for a tap to focus the new chart title and dismisses the form through mobile Back', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }))
  render(<ChartManagementPage onSettings={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'New chart' }))

  const dialog = screen.getByRole('dialog', { name: 'New chart' })
  const title = within(dialog).getByRole('textbox', { name: 'Title' })
  expect(document.activeElement).toBe(dialog)
  fireEvent.change(title, { target: { value: 'Draft title' } })
  title.focus()
  await waitFor(() => expect(window.history.state?.moonweaveMobileBack).toBe(true))

  const back = () => act(async () => {
    const popped = new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }))
    window.history.back()
    await popped
  })

  await back()
  expect(document.activeElement).toBe(dialog)
  expect((title as HTMLInputElement).value).toBe('Draft title')
  await waitFor(() => expect(window.history.state?.moonweaveMobileBack).toBe(true))

  await back()
  expect(screen.queryByRole('dialog', { name: 'New chart' })).toBeNull()
})
