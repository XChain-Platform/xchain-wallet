// contractQueries — thin wrappers around the SDK's VM/contract explorer
// methods for the §42.2 Contracts browse surface and §42.3 detail
// surfaces. Single-chain read-only queries; no vault, no signing.
//
// The explorer's /contracts/{QUERY}/{TYPE} endpoint supports types
// [block, address, source]. "source" returns contracts the given
// address deployed (owner-facing); "address" returns contracts where
// the given address is source OR contract address. We expose each lane
// as a dedicated helper so callers don't reach for magic strings.
//
// "My interactions" is a client-side composition: merging deposits
// made by the user's addresses + withdrawals they've initiated gives
// a set of CONTRACT_ACTION_INDEX values they've funded or withdrawn
// against. Executions-by-address is a follow-up — the SDK's
// getExecutions is currently contract-scoped (takes contractActionIndex
// as its QUERY), not address-scoped. The explorer's underlying route
// supports ['block','address','contract'] types, but widening the SDK
// passthrough to accept (query, type, opts) is deferred to a later
// release when the contract detail page lands that narrow lane.

/**
 * @typedef {Object} ContractQueryOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} [address]            source (deployer) or involved address
 * @property {object} [opts]               pagination passed through to the SDK call
 */

/**
 * List contracts deployed by a given address ("My contracts").
 * @param {ContractQueryOpts} params
 */
export async function contractsForSource({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('contractsForSource: sdkRegistry is required');
    if (!chainId) throw new Error('contractsForSource: chainId is required');
    if (!address) throw new Error('contractsForSource: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getContracts(address, 'source', opts);
}

/**
 * List contracts where the address is either source OR contract
 * address. Rarely distinguished from "source" today but preserved for
 * future detail surfaces that need both lanes.
 * @param {ContractQueryOpts} params
 */
export async function contractsForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('contractsForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('contractsForAddress: chainId is required');
    if (!address) throw new Error('contractsForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getContracts(address, 'address', opts);
}

/**
 * Browse-all paginated contracts list (no address filter).
 * Backs the §42.2 "Browse all contracts" table.
 * @param {{ sdkRegistry: any, chainId: string, opts?: object }} params
 */
export async function contractsBrowseAll({ sdkRegistry, chainId, opts }) {
    if (!sdkRegistry) throw new Error('contractsBrowseAll: sdkRegistry is required');
    if (!chainId) throw new Error('contractsBrowseAll: chainId is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getContracts(null, null, opts);
}

/**
 * List DEPOSIT actions for a given address (query, type=address). Used
 * to compose "My interactions" — the set of contracts this address has
 * sent tokens to.
 * @param {ContractQueryOpts} params
 */
export async function depositsForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('depositsForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('depositsForAddress: chainId is required');
    if (!address) throw new Error('depositsForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getDeposits(address, 'address', opts);
}

/**
 * List WITHDRAWAL actions for a given address. Paired with deposits
 * to compose "My interactions".
 * @param {ContractQueryOpts} params
 */
export async function withdrawalsForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('withdrawalsForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('withdrawalsForAddress: chainId is required');
    if (!address) throw new Error('withdrawalsForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getWithdrawals(address, 'address', opts);
}
