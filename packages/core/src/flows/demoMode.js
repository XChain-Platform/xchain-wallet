// §25.2 / G058 + G059 — Demo mode bookkeeping. Tracks the "this wallet
// is the throwaway demo" flag in localStorage so the shell can render a
// persistent banner and offer a one-tap "Exit demo + wipe" affordance.
//
// The demo wallet itself is created via the regular `messaging.createWallet`
// path with a randomly-generated mnemonic + password (kept in the
// session-password cache). Marking it as demo here is just metadata —
// no schema bump, no host-handler changes. When the user exits demo
// mode the shell calls the existing `wallet.remove` flow and then
// `clearDemoWalletId()`.

const STORAGE_KEY = 'xc:demoWalletId';

/** @param {string} walletId */
export function markDemoWallet(walletId) {
    if (typeof walletId !== 'string' || !walletId) return;
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, walletId);
    } catch { /* best-effort */ }
}

/** @returns {string | null} */
export function getDemoWalletId() {
    try {
        const v = globalThis.localStorage?.getItem(STORAGE_KEY);
        return typeof v === 'string' && v.length > 0 ? v : null;
    } catch {
        return null;
    }
}

export function clearDemoWalletId() {
    try {
        globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch { /* best-effort */ }
}

/**
 * @param {string} walletId
 * @returns {boolean}
 */
export function isDemoWallet(walletId) {
    return typeof walletId === 'string' && walletId.length > 0
        && getDemoWalletId() === walletId;
}
