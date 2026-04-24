// linkQueries — thin read-only wrapper over `sdk.getLinks`. Backs
// the §23.5 cross-chain thread rendering on History: every LINK
// action records a (coin1, coin1_action_index) ↔ (coin2,
// coin2_action_index) pair, and the History route uses these to mark
// 🔗 badges, draw vertical connectors, and open the dual-side detail
// card.
//
// `getLinks(address, 'address')` returns LINK rows where the source
// address is the supplied `address`. Each row carries enough metadata
// (coin1 / coin1_action_index / coin2 / coin2_action_index / memo /
// status / block_index / timestamp / tx_hash) to thread without a
// follow-up read for the LINK itself.

/**
 * @typedef {Object} LinkQueryOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} address
 * @property {object} [opts]      pagination forwarded to the SDK
 */

/**
 * List LINK actions where `address` is the source. Explorer route
 * `/{COIN}/api/links/{ADDRESS}/address`.
 *
 * @param {LinkQueryOpts} params
 */
export async function linksForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('linksForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('linksForAddress: chainId is required');
    if (!address) throw new Error('linksForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getLinks(address, 'address', opts);
}
