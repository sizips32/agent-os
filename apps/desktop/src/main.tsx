import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './protected/ErrorBoundary.tsx'
import { ProtectedDesktop } from './protected/Desktop.tsx'
import './styles.css'
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ProtectedDesktop />
  </ErrorBoundary>
)
