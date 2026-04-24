// listQueries — thin read-only wrappers used by the §40.9 airdrop
// flow to (a) resolve a broadcast LIST's ACTION_INDEX after it's
// indexed and (b) fetch the canonical LIST row for the stage-5
// "review AIRDROP" confirmation display.
//
// These aren't list-specific at the SDK level — `actionByTxid` also
// resolves the AIRDROP's own action after stage 6 — but the only
// caller today is AirdropForm, so the module name tracks the feature.

/**
 * Fetch the indexed action for a given tx hash. Returns null when the
 * transaction hasn't been indexed yet (the explorer 404s); the form
 * uses that null as "not yet indexed — keep polling". Any other error
 * propagates so the caller can surface it.
 *
 * @param {{ sdkRegistry: any, chainId: string, txid: string }} params
 * @returns {Promise<unknown>}
 */
export async function actionByTxid({ sdkRegistry, chainId, txid }) {
    if (!sdkRegistry) throw new Error('actionByTxid: sdkRegistry is required');
    if (!chainId) throw new Error('actionByTxid: chainId is required');
    if (!txid) throw new Error('actionByTxid: txid is required');
    const sdk = sdkRegistry.get(chainId);
    try {
        return await sdk.getTransaction(txid, 'hash');
    } catch (err) {
        // Treat 404 / not-found as "not yet indexed". The SDK's HTTP
        // layer may surface this as an error with a status field or
        // simply resolve to null — handle both shapes.
        const status = /** @type {any} */ (err)?.status
            ?? /** @type {any} */ (err)?.response?.status;
        if (status === 404) return null;
        if (/not found|404/i.test(/** @type {any} */ (err)?.message || '')) return null;
        throw err;
    }
}

/**
 * Fetch a LIST action by its ACTION_INDEX. Used by the stage-5
 * AIRDROP review to confirm the list's TYPE + item-count match what
 * the user pasted before they sign the AIRDROP.
 *
 * @param {{ sdkRegistry: any, chainId: string, actionIndex: string }} params
 */
export async function listByActionIndex({ sdkRegistry, chainId, actionIndex }) {
    if (!sdkRegistry) throw new Error('listByActionIndex: sdkRegistry is required');
    if (!chainId) throw new Error('listByActionIndex: chainId is required');
    if (!actionIndex) throw new Error('listByActionIndex: actionIndex is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getAction(actionIndex);
}
