import { createRoot } from 'react-dom/client';
import { CardSyncAdminPage } from '@/components/admin/CardSyncAdminPage';
import '@/index.css';
// Test-only mount of the real page. Playwright intercepts every API request; no account or database is used.
createRoot(document.getElementById('root')!).render(<CardSyncAdminPage onBack={() => undefined} />);
