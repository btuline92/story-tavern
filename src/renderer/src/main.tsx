import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyTheme, readStoredTheme } from './stores/theme'
import { installFocusDiagnostics } from './focusDiagnostics'

// Apply the saved theme before the first paint so there's no flash of the default.
applyTheme(readStoredTheme())

// TEMPORARY: instrument the "text box locks out" bug — verify the fix, then remove.
installFocusDiagnostics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
