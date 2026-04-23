// Popup React root. Loaded by popup.html (at the extension package
// root) — Vite bundles this entry and rewrites the HTML's script tag
// to point at the hashed output.
//
// Loading tokens.css here (once, at the shell entry) installs the
// design-token custom properties on :root.

import { createRoot } from 'react-dom/client';
import '@xchain-wallet/core/ui/tokens.css';
import { App } from './App.jsx';

const container = document.getElementById('xchain-popup-root');
if (!container) {
    throw new Error('popup: #xchain-popup-root missing — check popup.html');
}

createRoot(container).render(<App />);
