import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { RegistryProvider } from '@effect-atom/atom-react'

import App from './app.tsx'

import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('index.html is missing the #root element')
}

createRoot(rootElement).render(
  <StrictMode>
    <RegistryProvider>
      <App />
    </RegistryProvider>
  </StrictMode>,
)
