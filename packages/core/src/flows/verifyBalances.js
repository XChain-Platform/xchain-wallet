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
// Trust model: two tiers, picked per coin by whether a pinned launch
// trust root (SPV spec D4, `xchain-sdk/src/pinnedCheckpoints.js`) is
// registered for it.
//
// - `pinned`   an out-of-band launch checkpoint plus the validator set
//              that signed it ships with the SDK. Quorum is checked
//              against THAT set (rolled forward across rotation when the
//              served checkpoint is later, §7.3) and the explorer's
//              /verify endpoint is never consulted.
// - `explorer` nothing is pinned for the coin, so the explorer chooses
//              the qualifying set. Signatures and the stake-weighted
//              quorum are still checked locally and the amount is still
//              bound to the quorum-signed root; only the SET is trusted.
//
// The tier is not cosmetic: it decides how loudly a quorum failure is
// reported (see MISMATCH_REASONS). Callers may override the shipped
// registry with their own `pinnedResolver` (a self-verified or
// operator-supplied root); the light client accepts the same seam.
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
 * Which trust root backed the quorum check.
 *
 * - `pinned`   the out-of-band launch root shipped for this coin (or a
 *              caller-supplied resolver); the explorer never chose the set.
 * - `explorer` nothing pinned, so the explorer's /verify endpoint chose it.
 *
 * @typedef {'pinned' | 'explorer'} TrustTier
 */

/**
 * @typedef {Object} VerifyResult
 * @property {VerifyStatus} status
 * @property {string | null} amount     proven amount (balances only), else null
 * @property {number | null} height     proven (checkpointed) height, else null
 * @property {string | null} reason     light-client reason code / message, else null
 * @property {TrustTier} trust          which trust root backed the quorum check
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
    // either proof: the served proof answers a different identity than the
    // one this wallet asked about (`expected` binding), or the proven key
    // is not the one derived from the request. The server substituted an
    // answer, which is a wrong answer, not a degraded one.
    'REQUESTED_IDENTITY_MISMATCH',
    'BALANCE_QUERY_MISMATCH',
    // action proof (verifyActionProof)
    'LEAF_MISMATCH',
    'MERKLE_PROOF_INVALID',
    'ACTION_INDEX_MISMATCH',
]);

// On the PINNED tier these promote from "could not verify" to "proven
// false". The explorer served a checkpoint that the trust root we pinned
// out of band does not sign, and (per §7.3) could not be reached from it by
// following rotation either. Nothing about that is an ordinary degraded
// service: it is the explorer presenting state outside our trust root, so
// it earns the loud verdict.
//
// They stay `unavailable` on the explorer tier, where a quorum miss is
// routinely just an incomplete set from a thin replica and the client has
// no independent root to contradict it with.
const PINNED_MISMATCH_REASONS = new Set([
    'CHECKPOINT_QUORUM_FAILED',
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

/**
 * Decide which trust tier this call runs on, and the resolver to hand the
 * light client.
 *
 * A caller-supplied `pinnedResolver` always wins and is forwarded verbatim.
 * Otherwise we ask the SDK's own registry (`sdk.light.getPinnedCheckpoint`)
 * whether this coin has a pinned root, and forward nothing: the light client
 * consults the same registry itself, so passing it back would be a no-op that
 * only invites the two copies to drift.
 *
 * An SDK too old to export the accessor reports `explorer`. That understates
 * the trust actually used (its light client still consults its own registry),
 * which is the safe direction to be wrong in: the tier only ever escalates a
 * verdict, so an understated tier stays quiet rather than raising an alarm it
 * cannot back.
 *
 * @param {any} light                                  the SDK light client
 * @param {string} coin                                explorer coin prefix (BTC/RBTC/...)
 * @param {((coin: string) => any) | undefined} pinnedResolver  caller override
 * @returns {{ tier: TrustTier, resolver: ((coin: string) => any) | undefined }}
 */
function resolveTrust(light, coin, pinnedResolver) {
    const resolve = typeof pinnedResolver === 'function'
        ? pinnedResolver
        : (light && typeof light.getPinnedCheckpoint === 'function' ? light.getPinnedCheckpoint : null);
    if (!resolve) return { tier: 'explorer', resolver: undefined };
    let entry = null;
    try {
        entry = resolve(coin) || null;
    } catch {
        // A resolver that throws is a broken pin, not a trust root. Fall back
        // to the explorer tier rather than failing the whole verification.
        entry = null;
    }
    return {
        tier: /** @type {TrustTier} */ (entry ? 'pinned' : 'explorer'),
        resolver: typeof pinnedResolver === 'function' ? pinnedResolver : undefined,
    };
}

/**
 * Map a light-client `verifyBalance`/`verifyAction` result to a verdict.
 *
 * @param {any} res
 * @param {TrustTier} trust
 * @returns {VerifyResult}
 */
function classify(res, trust) {
    if (res && res.verified) {
        return {
            status: /** @type {VerifyStatus} */ ('verified'),
            amount: res.amount != null ? String(res.amount) : null,
            height: Number.isFinite(Number(res.height)) ? Number(res.height) : null,
            reason: null,
            trust,
        };
    }
    const reason = res && res.reason ? String(res.reason) : 'UNVERIFIED';
    const mismatch = MISMATCH_REASONS.has(reason)
        || (trust === 'pinned' && PINNED_MISMATCH_REASONS.has(reason));
    return {
        status: /** @type {VerifyStatus} */ (mismatch ? 'failed' : 'unavailable'),
        amount: null,
        height: res && Number.isFinite(Number(res.height)) ? Number(res.height) : null,
        reason,
        trust,
    };
}

/** Turn a thrown transport/shape error into an `unavailable` verdict, tagging
 *  the not-yet-checkpointed case (explorer 409) so the UI can say so. */
function fromError(e, trust) {
    const msg = e && e.message ? String(e.message) : String(e);
    const reason = / 409\b/.test(msg) ? 'NOT_YET_CHECKPOINTED' : msg;
    return {
        status: /** @type {VerifyStatus} */ ('unavailable'),
        amount: null,
        height: null,
        reason,
        trust: /** @type {TrustTier} */ (trust || 'explorer'),
    };
}

/** The verdict for an SDK that cannot do SPV at all. No call was made, so no
 *  trust root backed anything; report the weaker tier rather than imply one. */
function unsupported() {
    return {
        status: /** @type {VerifyStatus} */ ('unavailable'),
        amount: null,
        height: null,
        reason: 'SPV_UNSUPPORTED',
        trust: /** @type {TrustTier} */ ('explorer'),
    };
}

/**
 * @typedef {Object} VerifyBalanceOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} address
 * @property {string} tick                  XChain token tick (NOT the native coin)
 * @property {number | string} [atHeight]   verify as-of this height (nearest checkpoint >= it)
 * @property {(coin: string) => any} [pinnedResolver]  override the shipped pinned-root registry
 */

/**
 * Verify a single XChain token balance against a quorum-signed checkpoint.
 * Never throws: transport/shape problems resolve to `unavailable`.
 *
 * @param {VerifyBalanceOpts} params
 * @returns {Promise<VerifyResult>}
 */
export async function verifyAddressBalance({ sdkRegistry, chainId, address, tick, atHeight, pinnedResolver }) {
    if (!sdkRegistry) throw new Error('verifyAddressBalance: sdkRegistry is required');
    if (!chainId) throw new Error('verifyAddressBalance: chainId is required');
    if (!address) throw new Error('verifyAddressBalance: address is required');
    if (!tick) throw new Error('verifyAddressBalance: tick is required');
    const sdk = sdkRegistry.get(chainId);
    const spv = resolveSpv(sdk);
    if (!spv || typeof spv.light.verifyBalance !== 'function') return unsupported();
    const { tier, resolver } = resolveTrust(spv.light, spv.coin, pinnedResolver);
    try {
        const res = await spv.light.verifyBalance({
            explorerUrl: spv.url,
            coin: spv.coin,
            address,
            tick,
            atHeight,
            // Bind the proof to the identity THIS caller asked about, not the
            // server's echo of it: the light client refuses a genuine proof
            // for a different (address, tick) as REQUESTED_IDENTITY_MISMATCH
            // instead of verifying it. The wallet never verifies an unbound
            // proof.
            expected: { address: String(address), tick: String(tick) },
            ...(resolver ? { pinnedResolver: resolver } : {}),
        });
        return classify(res, tier);
    } catch (e) {
        return fromError(e, tier);
    }
}

/**
 * @typedef {Object} VerifyActionOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {number | string} actionIndex
 * @property {(coin: string) => any} [pinnedResolver]  override the shipped pinned-root registry
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
export async function verifyAddressAction({ sdkRegistry, chainId, actionIndex, pinnedResolver }) {
    if (!sdkRegistry) throw new Error('verifyAddressAction: sdkRegistry is required');
    if (!chainId) throw new Error('verifyAddressAction: chainId is required');
    if (actionIndex == null || actionIndex === '') throw new Error('verifyAddressAction: actionIndex is required');
    const sdk = sdkRegistry.get(chainId);
    const spv = resolveSpv(sdk);
    if (!spv) return unsupported();
    if (typeof spv.light.verifyAction !== 'function') return unsupported();
    const { tier, resolver } = resolveTrust(spv.light, spv.coin, pinnedResolver);
    try {
        const res = await spv.light.verifyAction({
            explorerUrl: spv.url,
            coin: spv.coin,
            actionIndex,
            // Bind the proof to the action index THIS caller asked about (the
            // same requested-identity binding verifyAddressBalance passes):
            // a genuine proof for a different action must refuse, not verify.
            expected: { action_index: String(actionIndex) },
            ...(resolver ? { pinnedResolver: resolver } : {}),
        });
        return classify(res, tier);
    } catch (e) {
        return fromError(e, tier);
    }
}
