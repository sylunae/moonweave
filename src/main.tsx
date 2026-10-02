import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PreferencesProvider } from './app/preferences'
import { SoundGate } from './app/sound'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreferencesProvider><SoundGate><App /></SoundGate></PreferencesProvider>
  </StrictMode>,
)
