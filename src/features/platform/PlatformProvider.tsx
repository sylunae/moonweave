import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { OfficialPlaySession } from './types'

interface PlatformContextValue {
  session: OfficialPlaySession | null
  startOfficialPlay(session: OfficialPlaySession): void
  leavePlay(): void
}

const PlatformContext = createContext<PlatformContextValue | null>(null)

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<OfficialPlaySession | null>(null)
  const startOfficialPlay = useCallback((nextSession: OfficialPlaySession) => setSession(nextSession), [])
  const leavePlay = useCallback(() => setSession(null), [])
  const value = useMemo(() => ({ session, startOfficialPlay, leavePlay }), [leavePlay, session, startOfficialPlay])

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>
}

export function usePlatform() {
  const value = useContext(PlatformContext)
  if (!value) throw new Error('usePlatform must be used inside PlatformProvider')
  return value
}
