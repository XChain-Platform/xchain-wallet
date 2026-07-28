// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// passiveCoSign: the wallet acting as the policy co-signer (daemon half)
// of a 2-of-2 MuSig2 agent account (§22, P4).
//
// An inbound co-sign request carries a PSBT + the agent's public nonce. The
// flow runs the SDK's `sdk.coSigner.CoSigner` (the single source of truth:
// decode-from-PSBT -> policy -> anti-drain output gate -> deterministic
// partial-sign) and returns its verdict: either the partial signature, or a
// structured refusal. The wallet never re-implements the policy brain; it
// supplies the Vault-backed window store and the unlocked daemon key.
//
// Fail-closed everywhere a daemon can't safely proceed:
//   - §26.5 panic-mode freeze    -> { approved:false, reason:'PANIC_MODE' }
//   - corrupt spending-window     -> { approved:false, reason:'WINDOW_STATE_CORRUPT' }
//   - any policy / decode / output-gate denial comes straight from CoSigner.
//
// This is the transport-agnostic core (Vitest-testable against a mock SDK).
// Key derivation (deriving the 32-byte daemon secret from the unlocked seed)
// and loading the persisted agent-account record are wired by the caller /
// the schema slice; this flow takes them as inputs so it stays pure.

import { assertSigningAllowed, PanicModeActiveError } from './panicMode.js';

// ── Exclusive bracket (G4) ──────────────────────────────────────────────
//
// `CoSigner.process()` being synchronous is NOT enough to make the decision
// atomic here, and an earlier revision of the spec wrongly said it was. The
// wallet wraps it in an ASYNC load and an ASYNC persist, and the store is
// rebuilt per request (buildAccountWindowStore), so two concurrent requests
// both `await load()` the SAME pre-charge state, both decide against it, both
// pass, and the second `flush()` overwrites the first: one authorization is
// silently uncharged, and a policy the operator sized for N actions per window
// pays out more. The whole snapshot -> decide -> charge -> persist bracket must
// therefore be serialized end to end.
//
// Keyed by account id, NOT by store instance: a fresh store object per request
// is exactly the case that needs serializing, so an identity-based lock would
// never fire. The instance fallback covers direct passiveCoSign callers that
// share one store and pass no key.
const KEYED_LOCKS = new Map();
const STORE_LOCKS = new WeakMap();

function lockSlot(lockKey, windowStore) {
    if (typeof lockKey === 'string' && lockKey.length > 0) {
        let slot = KEYED_LOCKS.get(lockKey);
        if (!slot) { slot = { tail: Promise.resolve() }; KEYED_LOCKS.set(lockKey, slot); }
        return slot;
    }
    if (windowStore) {
        let slot = STORE_LOCKS.get(windowStore);
        if (!slot) { slot = { tail: Promise.resolve() }; STORE_LOCKS.set(windowStore, slot); }
        return slot;
    }
    // No window store and no key: there is no persisted budget to race over.
    return null;
}

function runExclusive(slot, fn) {
    if (!slot) return fn();
    // Chain on both settle paths: a previous request that threw must not wedge
    // the queue behind it.
    const run = slot.tail.then(fn, fn);
    slot.tail = run.then(() => {}, () => {});
    return run;
}

/**
 * @typedef {Object} PassiveCoSignRequest
 * @property {string} psbt                       PSBT hex
 * @property {Array<{ index: number, agentPublicNonce: string }>} [inputs]  the canonical form
 * @property {string} [agentPublicNonce]         66-byte hex; single-input convenience, wrapped
 *           into a one-element `inputs` array before it reaches the daemon
 * @property {number} [inputIndex]               default 0 (single-input convenience)
 * @property {number} [sighashType]
 */

/**
 * @typedef {Object} PassiveCoSignOpts
 * @property {{ coSigner: { CoSigner: new (config: object) => { process: (req: object) => object } } }} sdk
 *           an SDK instance exposing `sdk.coSigner.CoSigner`
 * @property {Uint8Array} secretKey              this wallet's 32-byte daemon key (caller owns its lifecycle)
 * @property {(Uint8Array|string)[]} publicKeys  full signer set incl. ours, in the agreed order
 * @property {object} policy                     normalized spending policy (see SDK policyEvaluator)
 * @property {import('../cosigner/vaultWindowStore.js').VaultWindowStore} [windowStore]
 *           required when policy.maxPerWindow is set
 * @property {string} [recoveryPublicKey]        2-of-3 only: the operator-recovery pubkey the SDK
 *           derives the tap tree from. A raw taproot tweak is never accepted (G3).
 * @property {object} [network]                  bitcoinjs network for hex PSBT parsing
 * @property {Array<{ address?: string, script?: string, maxValue?: number }>} [allowedOutputs]
 * @property {boolean} [allowConfirmable]        default false; a daemon denies confirm-required actions
 * @property {PassiveCoSignRequest} request      the inbound co-sign request
 * @property {number} [now]                      injectable clock (ms) for the panic-mode check
 * @property {string} [lockKey]                  serializes the load/decide/charge/persist bracket
 *           across concurrent requests for the same account (G4); pass the account id
 */

/**
 * @typedef {Object} PassiveCoSignResult
 * @property {boolean} approved
 * @property {string} [reason]                   denial code when approved === false
 * @property {*} [detail]
 * @property {string} [action]                   the action decoded from the PSBT
 * @property {Array<{ index: number, publicNonce: string, sig: string, msg: string }>} [signatures]
 *           one entry per co-signed input on approval. This is the ONLY approval shape: the
 *           legacy top-level {publicNonce, sig, msg} body went away with the wire collapse,
 *           so a single-input request gets a one-element array.
 */

/**
 * Run one passive co-sign decision.
 *
 * @param {PassiveCoSignOpts} opts
 * @returns {Promise<PassiveCoSignResult>}
 */
export async function passiveCoSign(opts = {}) {
    const {
        sdk,
        secretKey,
        publicKeys,
        policy,
        windowStore,
        recoveryPublicKey,
        network,
        allowedOutputs,
        allowConfirmable,
        request,
        now,
        lockKey,
    } = opts;

    if (!sdk || !sdk.coSigner || typeof sdk.coSigner.CoSigner !== 'function') {
        throw new Error('passiveCoSign: sdk with sdk.coSigner.CoSigner is required');
    }
    if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
        throw new Error('passiveCoSign: secretKey must be a 32-byte Uint8Array');
    }
    if (!Array.isArray(publicKeys) || publicKeys.length < 2) {
        throw new Error('passiveCoSign: publicKeys must list the full signer set (>= 2)');
    }
    if (!policy || !policy.allowedActions) {
        throw new Error('passiveCoSign: a normalized policy with allowedActions is required');
    }
    if (!request || typeof request.psbt !== 'string' || request.psbt.length === 0) {
        throw new Error('passiveCoSign: request.psbt (hex) is required');
    }

    // Wire collapse: the SDK daemon takes exactly ONE request shape (an `inputs`
    // array), so that every hardening gate has a single validation path. The
    // single-input convenience lives at the client edge - CoSignerClient.sign()
    // on the SDK side, and right here for callers reaching the wallet through the
    // extension bridge. The daemon below never sees the legacy shape, and the
    // verdict it returns always carries a `signatures` array, even for one input.
    const coSignRequest = Array.isArray(request.inputs) && request.inputs.length > 0
        ? { psbt: request.psbt, inputs: request.inputs, sighashType: request.sighashType }
        : {
            psbt:   request.psbt,
            inputs: [{
                index:            Number.isInteger(request.inputIndex) ? request.inputIndex : 0,
                agentPublicNonce: request.agentPublicNonce,
            }],
            sighashType: request.sighashType,
        };

    // §26.5 panic-mode freeze: a daemon returns a refusal verdict rather than
    // throwing, so the transport relays a clean "no" instead of a 500.
    try {
        assertSigningAllowed(now);
    } catch (e) {
        if (e instanceof PanicModeActiveError) {
            return { approved: false, reason: 'PANIC_MODE', detail: { remainingMs: e.remainingMs ?? null } };
        }
        throw e;
    }

    // Everything from here to the persist runs under one exclusive slot, so a
    // second concurrent request cannot decide against a snapshot that is about
    // to be superseded (see the lock notes at the top of this file).
    return runExclusive(lockSlot(lockKey, windowStore), async () => {
        // Load the spending window into memory before the synchronous process()
        // call. Corrupt state fails closed as a refusal (the UI slice surfaces the
        // distinct reason so the user can reset the window deliberately).
        if (windowStore) {
            try {
                await windowStore.load();
            } catch (e) {
                return { approved: false, reason: 'WINDOW_STATE_CORRUPT', detail: { message: e?.message ?? String(e) } };
            }
        }

        const { CoSigner } = sdk.coSigner;
        let cosigner;
        try {
            cosigner = new CoSigner({
                secretKey,
                publicKeys,
                policy,
                windowStore: windowStore ?? null,
                // No `tweaks`: a raw taproot tweak is an unverifiable commitment to
                // an arbitrary script tree, so the SDK refuses one outright (G3). A
                // 2-of-3 account names the recovery PUBLIC KEY and the daemon
                // re-derives the tree itself.
                ...(recoveryPublicKey ? { recoveryPublicKey } : {}),
                network: network ?? null,
                allowedOutputs: allowedOutputs ?? [],
                allowConfirmable: allowConfirmable === true,
            });
        } catch (e) {
            // A stored account can carry a policy the SDK now refuses to build a
            // daemon from - an amount cap that could never bind, for instance
            // (G2). That is a configuration fault, not a transport fault, so it
            // relays as a clean refusal the UI can explain rather than a 500 on
            // every request.
            return { approved: false, reason: 'POLICY_CONFIG_INVALID',
                     detail: { message: e?.message ?? String(e) } };
        }

        const result = cosigner.process(coSignRequest);

        // Persist any budget consumed during process() BEFORE returning the
        // signature: an approval is irrevocable, so it must never be handed out
        // against a charge that only exists in memory. If the persist fails the
        // signature is discarded and the request refuses - the in-memory charge
        // dies with this store, so nothing was spent and nothing was signed.
        if (windowStore) {
            try {
                await windowStore.flush();
            } catch (e) {
                return { approved: false, reason: 'WINDOW_PERSIST_FAILED',
                         detail: { message: e?.message ?? String(e) } };
            }
        }

        return result;
    });
}
