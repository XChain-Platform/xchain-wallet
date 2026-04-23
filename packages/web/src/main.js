// Web SPA entry — Phase 1 infra scaffold. Imports @xchain-wallet/core
// to verify the bundler reaches the workspace dep, renders a bare
// marker into #app so "does the pipeline work" is visually obvious.
//
// Full UI (React or otherwise) lands in the UI session — this file
// gets replaced wholesale when that work starts.

import { registry } from '@xchain-wallet/core';

const el = document.getElementById('app');
if (el) {
    const chains = registry.defaultRegistry().supportedChains();
    el.textContent = `XChain Wallet scaffold — ${chains.length} chains registered`;
}

console.log('[xchain] web shell ready');
