// wallet.lock handler — clears the session backend and signals the
// background to tear down its host + vault references. Pairs with the
// `wallet.unlock` handler: unlock builds the host, lock tears it down.
//
// Runs via the pre-host dispatcher so lock works even if the host is
// already in a bad state (e.g. a handler threw and left things partial).
// No vault access needed — clearing the session key on its own is
// enough to gate future reads. The host-teardown callback is the
// belt-and-braces step that releases the closed-over vault reference
// so a later re-unlock doesn't race against stale state.

/**
 * @typedef {Object} WalletLockDeps
 * @property {import('../storage/ChromeSessionBackend.js').ChromeSessionBackend} sessionBackend
 * @property {() => Promise<void> | void} [onLocked]
 */

/**
 * @param {unknown} _request
 * @param {WalletLockDeps} deps
 * @returns {Promise<{ locked: true }>}
 */
export async function handleWalletLock(_request, deps) {
    await deps.sessionBackend.clear();
    if (typeof deps.onLocked === 'function') {
        await deps.onLocked();
    }
    return { locked: true };
}
