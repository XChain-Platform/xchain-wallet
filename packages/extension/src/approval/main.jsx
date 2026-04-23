// Approval-window React root. The Router dispatches by the parked
// request's `kind` to either ConnectApproval (no password needed) or
// SignApproval (password-gated; handles signMessage / signPsbt /
// signAction / signIn).

import { createRoot } from 'react-dom/client';
import '@xchain-wallet/core/ui/tokens.css';
import { Router } from './Router.jsx';

const container = document.getElementById('xchain-approval-root');
if (!container) {
    throw new Error('approval: #xchain-approval-root missing — check approval.html');
}
createRoot(container).render(<Router />);
