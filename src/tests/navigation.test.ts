import { describe, expect, it } from 'vitest'
import { appConfig, isRouteId } from '@/config/app'

describe('application navigation', () => {
  it('recognizes public and hidden application routes', () => {
    expect(['home', 'manage', 'editor', 'playtest'].every(isRouteId)).toBe(true)
    expect(isRouteId('unknown')).toBe(false)
  })

  it('keeps the home and playtest routes outside the sidebar group', () => {
    expect(appConfig.navigation.map((group) => group.label)).toEqual(['谱面制作'])
    expect(appConfig.navigation.flatMap((group) => group.items.map((item) => item.id))).toEqual(['manage', 'editor'])
  })
})
