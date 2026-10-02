try {
  const value = JSON.parse(localStorage.getItem('moonweave.preferences') || '{}') as { theme?: string }
  const theme = value.theme === 'dark' || value.theme === 'light'
    ? value.theme
    : 'dark'
  document.documentElement.dataset.theme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
} catch { /* Invalid preferences are normalized after React starts. */ }
