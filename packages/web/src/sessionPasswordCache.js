// Session-scoped wallet-password cache for the web shell.
//
// The web shell's wallet host lives in the page itself and is destroyed
// on every reload, so a naive flow forces the user to retype their
// password every time the page refreshes (e.g. after a Hot Module
// Reload, F5, or navigating between routes that trigger remount).
// We bridge that gap by storing the password in `sessionStorage`:
//
//   - sessionStorage persists across reloads inside the same tab
//   - sessionStorage clears when the tab closes (window.unload)
//   - sessionStorage is per-origin and not shared with other tabs
//
// Lifecycle:
//   - Successful `unlockWallet` / `createWallet` / `importMnemonic` →
//     password saved
//   - `lockWallet` (user-initiated) → password cleared
//   - Tab close → browser drops sessionStorage → password gone
//   - Auto-unlock failure (e.g. user changed the password from another
//     tab, vault rotated) → cache cleared, fallback to the unlock form
//
// This matches the user's stated mental model: "remember my password
// until I close the tab or click Lock."
//
// Caveat: an XSS attacker can read sessionStorage. The wallet's
// existing CSP, no-inline-script discipline, and bundle-only-trusted-
// deps stance are the load-bearing mitigations against that — this
// cache itself doesn't add new attack surface that wasn't already
// reachable via the in-page wallet host.

const PW_KEY = 'xc.session.pw';

export function savePassword(password) {
    if (typeof window === 'undefined') return;
    if (typeof password !== 'string' || password.length === 0) return;
    try { window.sessionStorage.setItem(PW_KEY, password); }
    catch { /* SecurityError / quota — silently no-op */ }
}

export function readPassword() {
    if (typeof window === 'undefined') return null;
    try {
        const v = window.sessionStorage.getItem(PW_KEY);
        return v && v.length > 0 ? v : null;
    } catch {
        return null;
    }
}

export function clearPassword() {
    if (typeof window === 'undefined') return;
    try { window.sessionStorage.removeItem(PW_KEY); }
    catch { /* ignore */ }
}
