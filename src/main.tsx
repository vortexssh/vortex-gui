import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { parseTermHash, TermWindow } from '@/features/terminal/TermWindow'
import { api } from './lib/api'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
})

const termBoot = parseTermHash()

function Root() {
  useEffect(() => {
    if (termBoot) return
    void (async () => {
      try {
        const st = await api.getSettings()
        if (st.syncOnStart && st.linked) {
          await api.syncCloud()
          await queryClient.invalidateQueries({ queryKey: ['hosts'] })
        }
      } catch {
        /* local-first: ignore */
      }
    })()
  }, [])
  if (termBoot) {
    return <TermWindow hostId={termBoot.hostId} hostName={termBoot.hostName} />
  }
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </StrictMode>,
)
