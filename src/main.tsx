import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { claimEarlyAccessNotice, PreferencesProvider } from './app/preferences'
import { SoundGate } from './app/sound'
import App from './App'
import './styles.css'

if (import.meta.env.PROD && !window.sylunae && window.isSecureContext && /^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`, { updateViaCache: 'none' })
    .catch((error: unknown) => console.warn('Moonweave service worker registration failed', error))
}

void claimEarlyAccessNotice().then((showEarlyAccessNotice) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <PreferencesProvider><SoundGate><App showEarlyAccessNotice={showEarlyAccessNotice} /></SoundGate></PreferencesProvider>
    </StrictMode>,
  )
})
