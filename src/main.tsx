import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { claimEarlyAccessNotice, PreferencesProvider } from './app/preferences'
import { SoundGate } from './app/sound'
import App from './App'
import './styles.css'

void claimEarlyAccessNotice().then((showEarlyAccessNotice) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <PreferencesProvider><SoundGate><App showEarlyAccessNotice={showEarlyAccessNotice} /></SoundGate></PreferencesProvider>
    </StrictMode>,
  )
})
