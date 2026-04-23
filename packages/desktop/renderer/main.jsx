// Desktop renderer entry. Mounts the React app into the BrowserWindow.
// The preload (`../preload.js`) has already exposed
// `window.xchainWalletBridge.sendMessage` by the time this runs —
// `bridgeMessaging.sendMessage` throws a clear error if the bridge
// isn't there, so an accidental misconfigured BrowserWindow surfaces
// as a startup error rather than silent hang.

import { createRoot } from 'react-dom/client';
import '@xchain-wallet/core/ui/tokens.css';
import { App } from './App.jsx';

const container = document.getElementById('xchain-desktop-root');
if (!container) {
    throw new Error('desktop: #xchain-desktop-root missing — check renderer/index.html');
}
createRoot(container).render(<App />);
