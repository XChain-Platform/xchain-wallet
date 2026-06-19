// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SPV proof verification (§7/§8) for wallet consumers. Thin wrappers
// over the SDK light client (`sdk.light.verifyBalance` / `verifyAction`)
// that turn a proof check into a normalized per-row trust verdict the UI
// can badge.
//
// The light client binds the server-served amount/inclusion to a
// quorum-signed checkpoint root: nothing here trusts the explorer's own
// `verified` / `amount`. A failed verification is NOT an exception; only
// transport/shape problems throw, and those normalize to `unavailable`
// (the proof server may be a thin replica that cannot serve proofs, or
// the chain may be pre-commitment). A concrete proof-vs-amount
// contradiction is the only `failed` verdict, the security-meaningful
// case worth flagging loudly.
//
// Trust model (Phase 1): the convenience path. We do not pass
// `validators` / `trustedCheckpoint`, so the light client fetches the
// validator set from the explorer's verify endpoint but still checks the
// Ed25519 signatures + stake-weighted quorum locally and binds the amount
// to the quorum-signed root. A pinned launch set / DOGE-anchored root
// drops in later via the same SDK parameters (left as a seam).
//
// Only XChain token balances are provable: the native coin comes from the
// utxo-tracker, not the state SMT, so callers must NOT verify native rows.

/**
 * Normalized verdict statuses surfaced to the UI.
 *
 * - `verified`    proof recomputed the quorum-signed root; the amount/inclusion is proven.
 * - `failed`      the proof concretely contradicts the claimed amount/inclusion (server is wrong/lying).
 * - `unavailable` no proof could be established (thin replica, pre-commitment, transport, or not-yet-checkpointed).
 *
 * @typedef {'verified' | 'failed' | 'unavailable'} VerifyStatus
 */

/**
 * @typedef {Object} VerifyResult
 * @property {VerifyStatus} status
 * @property {string | null} amount     proven amount (balances only), else null
 * @property {number | null} height     proven (checkpointed) height, else null
 * @property {string | null} reason     light-client reason code / message, else null
 */

// A `verified:false` carrying one of these reasons means the proof itself
// contradicts the claimed amount/inclusion: the server cannot back its own
// answer. Everything else (quorum/checkpoint/transport) is "could not
// verify", not "proven false", so it degrades to `unavailable` and never
// raises a false alarm on the convenience path.
const MISMATCH_REASONS = new Set([
    // balance proof (verifyBalanceProof)
    'KEY_MISMATCH',
    'LEAF_AMOUNT_MISMATCH',
    'SMT_PROOF_INVALID',
    'SUBROOT_BIND_INVALID',
    'NONINCLUSION_NONZERO_AMOUNT',
    // action proof (verifyActionProof)
    'LEAF_MISMATCH',
    'MERKLE_PROOF_INVALID',
    'ACTION_INDEX_MISMATCH',
]);

/**
 * Resolve the explorer URL + coin + light client off a live SDK instance,
 * or null if this SDK cannot do SPV (e.g. a mock/thin instance without the
 * light client). In the wallet, `sdk.explorer.baseUrl` is the fully-formed
 * URL the SDK was constructed with (§10.2).
 *
 * @param {any} sdk
 * @returns {{ url: string, coin: string, light: any } | null}
 */
function resolveSpv(sdk) {
    const light = sdk && sdk.light;
    const ex = sdk && sdk.explorer;
    if (!light || !ex) return null;
    let url = ex.baseUrl;
    if (!url || !ex.coin) return null;
    if (!/^https?:\/\//i.test(url)) url = ex.port ? `http://${url}:${ex.port}` : `http://${url}`;
    return { url, coin: ex.coin, light };
}

/** Map a light-client `verifyBalance`/`verifyAction` result to a verdict. */
function classify(res) {
    if (res && res.verified) {
        return {
            status: /** @type {VerifyStatus} */ ('verified'),
            amount: res.amount != null ? String(res.amount) : null,
            height: Number.isFinite(Number(res.height)) ? Number(res.height) : null,
            reason: null,
        };
    }
    const reason = res && res.reason ? String(res.reason) : 'UNVERIFIED';
    const status = MISMATCH_REASONS.has(reason) ? 'failed' : 'unavailable';
    return {
        status: /** @type {VerifyStatus} */ (status),
        amount: null,
        height: res && Number.isFinite(Number(res.height)) ? Number(res.height) : null,
        reason,
    };
}

/** Turn a thrown transport/shape error into an `unavailable` verdict, tagging
 *  the not-yet-checkpointed case (explorer 409) so the UI can say so. */
function fromError(e) {
    const msg = e && e.message ? String(e.message) : String(e);
    const reason = / 409\b/.test(msg) ? 'NOT_YET_CHECKPOINTED' : msg;
    return { status: /** @type {VerifyStatus} */ ('unavailable'), amount: null, height: null, reason };
}

/**
 * @typedef {Object} VerifyBalanceOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} address
 * @property {string} tick                  XChain token tick (NOT the native coin)
 * @property {number | string} [atHeight]   verify as-of this height (nearest checkpoint >= it)
 */

/**
 * Verify a single XChain token balance against a quorum-signed checkpoint.
 * Never throws: transport/shape problems resolve to `unavailable`.
 *
 * @param {VerifyBalanceOpts} params
 * @returns {Promise<VerifyResult>}
 */
export async function verifyAddressBalance({ sdkRegistry, chainId, address, tick, atHeight }) {
    if (!sdkRegistry) throw new Error('verifyAddressBalance: sdkRegistry is required');
    if (!chainId) throw new Error('verifyAddressBalance: chainId is required');
    if (!address) throw new Error('verifyAddressBalance: address is required');
    if (!tick) throw new Error('verifyAddressBalance: tick is required');
    const sdk = sdkRegistry.get(chainId);
    const spv = resolveSpv(sdk);
    if (!spv || typeof spv.light.verifyBalance !== 'function') {
        return { status: 'unavailable', amount: null, height: null, reason: 'SPV_UNSUPPORTED' };
    }
    try {
        const res = await spv.light.verifyBalance({
            explorerUrl: spv.url,
            coin: spv.coin,
            address,
            tick,
            atHeight,
        });
        return classify(res);
    } catch (e) {
        return fromError(e);
    }
}

/**
 * @typedef {Object} VerifyActionOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {number | string} actionIndex
 */

/**
 * Verify a single action's inclusion against a quorum-signed checkpoint.
 * An action whose block is not yet checkpointed resolves to `unavailable`
 * with reason `NOT_YET_CHECKPOINTED` (the proof server returns 409), not an
 * error. Never throws.
 *
 * @param {VerifyActionOpts} params
 * @returns {Promise<VerifyResult>}
 */
export async function verifyAddressAction({ sdkRegistry, chainId, actionIndex }) {
    if (!sdkRegistry) throw new Error('verifyAddressAction: sdkRegistry is required');
    if (!chainId) throw new Error('verifyAddressAction: chainId is required');
    if (actionIndex == null || actionIndex === '') throw new Error('verifyAddressAction: actionIndex is required');
    const sdk = sdkRegistry.get(chainId);
    const spv = resolveSpv(sdk);
    if (!spv) return { status: 'unavailable', amount: null, height: null, reason: 'SPV_UNSUPPORTED' };
    if (typeof spv.light.verifyAction !== 'function') {
        return { status: 'unavailable', amount: null, height: null, reason: 'SPV_UNSUPPORTED' };
    }
    try {
        const res = await spv.light.verifyAction({
            explorerUrl: spv.url,
            coin: spv.coin,
            actionIndex,
        });
        return classify(res);
    } catch (e) {
        return fromError(e);
    }
}
