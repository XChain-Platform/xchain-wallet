// Web SPA entry. Vite serves this from `/src/main.jsx`, referenced by
// the root `index.html`. Imports tokens.css once at the entry so the
// design-token custom properties install on `:root` for every route.

import { createRoot } from 'react-dom/client';
import '@xchain-wallet/core/ui/tokens.css';
import { App } from './App.jsx';

const container = document.getElementById('xchain-web-root');
if (!container) {
    throw new Error('web: #xchain-web-root missing — check index.html');
}
createRoot(container).render(<App />);
