import type { MoonweaveAPI, SylunaeShellAPI } from './shared/electron'

declare global {
  interface Window {
    sylunae?: SylunaeShellAPI
    moonweave?: MoonweaveAPI
  }
}

export {}
