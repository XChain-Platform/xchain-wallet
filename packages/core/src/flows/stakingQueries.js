// stakingQueries — thin read-only wrappers over the staking-side
// explorer passthroughs landed in xchain-sdk 1.10.0
// (ExplorerClient.getStakes / getDelegations / getValidators /
// getValidatorRewards). Back the §42.7.4 Staking dashboard and the
// §42.7.5 Operator dashboard.
//
// Staking is BTC-only at launch per §10.3 — callers should already
// have resolved a BTC chain via useBtcAddressesPresent before
// invoking these. Each flow delegates to an sdkRegistry-scoped SDK.

/**
 * @typedef {Object} StakingQueryOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} [address]    source / holder address for per-address queries
 * @property {object} [opts]       pagination forwarded to the SDK
 */

/**
 * List stake entries keyed to an address (either deposits the address
 * made, or the validator's own stake). Backs "Your stake" + the
 * operator's stake status.
 *
 * @param {StakingQueryOpts} params
 */
export async function stakesForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('stakesForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('stakesForAddress: chainId is required');
    if (!address) throw new Error('stakesForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getStakes(address, 'address', opts);
}

/**
 * List DELEGATE records scoped to an address. Backs the dashboard's
 * "Delegated pubkey" line and the operator dashboard's delegation
 * chain.
 *
 * @param {StakingQueryOpts} params
 */
export async function delegationsForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('delegationsForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('delegationsForAddress: chainId is required');
    if (!address) throw new Error('delegationsForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getDelegations(address, 'address', opts);
}

/**
 * List reward events scoped to an address (pending + historical). Backs
 * the "Pending rewards" / "Lifetime rewards" / "Recent reward events"
 * sections.
 *
 * @param {StakingQueryOpts} params
 */
export async function rewardsForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('rewardsForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('rewardsForAddress: chainId is required');
    if (!address) throw new Error('rewardsForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getValidatorRewards(address, 'address', opts);
}

/**
 * List every validator on a chain. Backs the §42.7.5 Operator
 * dashboard's roster view.
 *
 * @param {{ sdkRegistry: any, chainId: string, opts?: object }} params
 */
export async function validatorsForChain({ sdkRegistry, chainId, opts }) {
    if (!sdkRegistry) throw new Error('validatorsForChain: sdkRegistry is required');
    if (!chainId) throw new Error('validatorsForChain: chainId is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getValidators(opts);
}
