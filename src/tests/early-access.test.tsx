// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { claimEarlyAccessNotice, PreferencesProvider } from '@/app/preferences'
import { EarlyAccessDialog } from '@/components/EarlyAccessDialog'

beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('reserves the notice once even before preferences are saved or the notice is closed', async () => {
  const visits = await Promise.all([claimEarlyAccessNotice(), claimEarlyAccessNotice()])
  expect(visits).toEqual([true, false])
  expect(await claimEarlyAccessNotice()).toBe(false)
})

it('skips the notice for an existing user with saved preferences', async () => {
  localStorage.setItem('moonweave.preferences', JSON.stringify({ language: 'en' }))
  expect(await claimEarlyAccessNotice()).toBe(false)
})

it('switches the notice and saved app language from either language button', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  localStorage.setItem('moonweave.preferences', JSON.stringify({ language: 'zh' }))
  render(<PreferencesProvider><EarlyAccessDialog /></PreferencesProvider>)

  expect(screen.getByRole('dialog', { name: '早期版本说明' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getByRole('dialog', { name: 'Early access' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'English', pressed: true })).toBeTruthy()
  expect(document.documentElement.lang).toBe('en')
  expect(screen.getByRole('link', { name: '@sylunae' }).getAttribute('href')).toBe('https://www.instagram.com/sylunae/')

  fireEvent.click(screen.getByRole('button', { name: '中文' }))
  expect(screen.getByRole('dialog', { name: '早期版本说明' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(JSON.parse(localStorage.getItem('moonweave.preferences') ?? '{}').language).toBe('en')
})

it('opens the app in the first supported system language when no language is saved', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.stubGlobal('sylunae', { preferredLanguages: ['ja-JP', 'zh-Hant-TW', 'en-US'], system: { setTitlebarTheme: vi.fn() } })
  render(<PreferencesProvider><EarlyAccessDialog /></PreferencesProvider>)

  expect(screen.getByRole('dialog', { name: '早期版本说明' })).toBeTruthy()
  expect(document.documentElement.lang).toBe('zh-CN')
})
