// dispenserQueries — thin wrappers around the SDK's explorer methods
// for the §40.7.2 "My dispensers" + detail surfaces. Single-chain
// read-only queries; no vault, no signing.
//
// The explorer's /dispensers/{QUERY}/{TYPE} endpoint supports types
// [block, address, source, destination, token]. "source" returns
// dispensers the given address opened (owner-facing); "address"
// returns dispensers where the given address is source OR dispenser
// address; "token" filters by GIVE_TICK or GET_TICK. We expose each
// lane as a dedicated helper so callers don't reach for magic strings.
//
// Indexer surface is still incomplete (see xchain-explorer/db.js's
// getDispensers TODO — GIVE_ESCROW / current stock / dispense count
// aren't returned yet). Callers render what's present and fall back
// to "—" for missing fields.

/**
 * @typedef {Object} DispenserQueryOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} [address]                  source address (owner) or dispenser address
 * @property {string} [token]                    GIVE_TICK or GET_TICK filter
 * @property {string} [actionIndex]              fetch one dispenser by action index
 * @property {object} [opts]                     passed through to the SDK call (pagination etc.)
 */

/**
 * List dispensers opened by a given address ("My dispensers").
 * @param {DispenserQueryOpts} params
 */
export async function dispensersForSource({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('dispensersForSource: sdkRegistry is required');
    if (!chainId) throw new Error('dispensersForSource: chainId is required');
    if (!address) throw new Error('dispensersForSource: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getDispensers(address, 'source', opts);
}

/**
 * List dispensers where the address is either source OR dispenser
 * address. Useful when the address is both owner + vendor.
 * @param {DispenserQueryOpts} params
 */
export async function dispensersForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('dispensersForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('dispensersForAddress: chainId is required');
    if (!address) throw new Error('dispensersForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getDispensers(address, 'address', opts);
}

/**
 * List dispensers filtered by token (GIVE_TICK or GET_TICK).
 * Used by the buyer-facing explorer in Step 22b.
 * @param {DispenserQueryOpts} params
 */
export async function dispensersForToken({ sdkRegistry, chainId, token, opts }) {
    if (!sdkRegistry) throw new Error('dispensersForToken: sdkRegistry is required');
    if (!chainId) throw new Error('dispensersForToken: chainId is required');
    if (!token) throw new Error('dispensersForToken: token is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getDispensers(token, 'token', opts);
}

/**
 * Fetch a single dispenser (and the associated DISPENSER action) by
 * action index. Used by the detail page.
 * @param {DispenserQueryOpts} params
 */
export async function dispenserByActionIndex({ sdkRegistry, chainId, actionIndex }) {
    if (!sdkRegistry) throw new Error('dispenserByActionIndex: sdkRegistry is required');
    if (!chainId) throw new Error('dispenserByActionIndex: chainId is required');
    if (!actionIndex) throw new Error('dispenserByActionIndex: actionIndex is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getAction(actionIndex);
}

/**
 * List dispense events (fill receipts) for a source / address / token.
 * Used by the detail page's "Recent dispenses" list.
 * @param {{ sdkRegistry: any, chainId: string, query: string, type: 'address' | 'source' | 'destination' | 'token' | 'block', opts?: object }} params
 */
export async function dispensesFor({ sdkRegistry, chainId, query, type, opts }) {
    if (!sdkRegistry) throw new Error('dispensesFor: sdkRegistry is required');
    if (!chainId) throw new Error('dispensesFor: chainId is required');
    if (!query) throw new Error('dispensesFor: query is required');
    if (!type) throw new Error('dispensesFor: type is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getDispenses(query, type, opts);
}
