import { describe, expect, it } from 'vitest'
import { defaultPreferences, migrateLegacyChartPreferences, normalizePreferences, SIDEBAR_MAX, SIDEBAR_MIN } from '@/app/preferences'

describe('normalizePreferences', () => {
  it('uses safe defaults for invalid data', () => {
    expect(normalizePreferences(null)).toEqual(defaultPreferences)
    expect(normalizePreferences({ theme: 'neon', sidebarWidth: 'wide' })).toEqual({ ...defaultPreferences, schemaVersion: 0 })
  })

  it('clamps persisted sidebar widths', () => {
    expect(normalizePreferences({ sidebarWidth: 1 }).sidebarWidth).toBe(SIDEBAR_MIN)
    expect(normalizePreferences({ sidebarWidth: 9999 }).sidebarWidth).toBe(SIDEBAR_MAX)
  })

  it('normalizes global play and editor preferences', () => {
    const normalized = normalizePreferences({
      playKeys: ['a', 's', 'k', 'l'], noteScrollSpeed: 99, laneTilt: -10,
      timingWindow: 'relaxed', judgmentLineHeight: 999,
    })
    expect(normalized.playKeys).toEqual(['A', 'S', 'K', 'L'])
    expect(normalized.noteScrollSpeed).toBe(12)
    expect(normalized.playbackRate).toBe(defaultPreferences.playbackRate)
    expect(normalized.laneTilt).toBe(0)
    expect(normalized.timingWindow).toBe('relaxed')
    expect(normalized.judgmentLineHeight).toBe(360)
  })

  it('accepts the editor playback rates used by playtest', () => {
    expect(normalizePreferences({ playbackRate: 0.5 }).playbackRate).toBe(0.5)
    expect(normalizePreferences({ playbackRate: 2 }).playbackRate).toBe(defaultPreferences.playbackRate)
  })

  it('defaults track background blur on and preserves a saved off setting', () => {
    expect(normalizePreferences({ schemaVersion: 1 }).trackBackgroundBlur).toBe(true)
    expect(normalizePreferences({ trackBackgroundBlur: false }).trackBackgroundBlur).toBe(false)
  })

  it('defaults to lane judgments and preserves the saved center position', () => {
    expect(normalizePreferences({ schemaVersion: 1 }).judgmentDisplay).toBe('lane')
    expect(normalizePreferences({ judgmentDisplay: 'invalid' }).judgmentDisplay).toBe('lane')
    expect(normalizePreferences({ judgmentDisplay: 'center' }).judgmentDisplay).toBe('center')
  })

  it('migrates legacy per-chart play settings only once', () => {
    const oldPreferences = normalizePreferences({ theme: 'light' })
    const migrated = migrateLegacyChartPreferences(oldPreferences, { settings: { keys: ['a', 's', 'k', 'l'], scrollSpeed: 9, laneTilt: 24, timingWindow: 'strict' } })
    expect(migrated).toMatchObject({ schemaVersion: 1, playKeys: ['A', 'S', 'K', 'L'], noteScrollSpeed: 9, laneTilt: 24, timingWindow: 'strict' })
    expect(migrateLegacyChartPreferences(migrated, { settings: { scrollSpeed: 4 } })).toBe(migrated)
  })

  it('repairs invalid custom palette values without dropping valid colors', () => {
    const normalized = normalizePreferences({ themePalettes: { light: { bg: '#fafafa', text: 'invalid' } } })
    expect(normalized.themePalettes.light.bg).toBe('#fafafa')
    expect(normalized.themePalettes.light.text).toBe(defaultPreferences.themePalettes.light.text)
  })
})
