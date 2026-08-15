import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'

import { BrowserRouter } from 'react-router-dom'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { ThemeProvider } from './contexts/ThemeContext'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import App from './App'
import './index.css'
import { registerServiceWorker, initInstallPrompt } from './lib/pwa'
import { queryClient, queryPersister } from '@/lib/query-client'

initInstallPrompt()
registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: queryPersister }}
    >
      <BrowserRouter>
        <ThemeProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </ThemeProvider>
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>
)
