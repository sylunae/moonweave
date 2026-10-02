import { describe, expect, it } from 'vitest'
import { appConfig, isRouteId } from '@/config/app'

describe('application navigation', () => {
  it('recognizes public and hidden application routes', () => {
    expect(['manage', 'editor', 'playtest'].every(isRouteId)).toBe(true)
    expect(isRouteId('unknown')).toBe(false)
    expect(['home', 'uploads', 'profile'].some(isRouteId)).toBe(false)
  })

  it('keeps the requested sidebar items and playtest hidden without a group label', () => {
    expect(appConfig.navigation).toHaveLength(1)
    expect(appConfig.navigation[0]).not.toHaveProperty('label')
    expect(appConfig.navigation.flatMap((group) => group.items.map((item) => item.id))).toEqual(['manage', 'editor'])
    expect(appConfig.navigation.flatMap((group) => group.items.map((item) => item.label.zh))).toEqual(['我的谱面', '编辑器'])
  })
})
