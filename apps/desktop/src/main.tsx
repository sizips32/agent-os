import { createRoot } from 'react-dom/client'
import { ProtectedDesktop } from './protected/Desktop.tsx'
import './styles.css'
createRoot(document.getElementById('root')!).render(<ProtectedDesktop />)
