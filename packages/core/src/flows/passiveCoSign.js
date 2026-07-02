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

/**
 * @typedef {Object} PassiveCoSignRequest
 * @property {string} psbt                       PSBT hex
 * @property {string} [agentPublicNonce]         66-byte hex; single-input form
 * @property {number} [inputIndex]               default 0 (single-input form)
 * @property {Array<{ index: number, agentPublicNonce: string }>} [inputs]  multi-input form
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
 * @property {{ tweak: Uint8Array|string, xOnly?: boolean }[]} [tweaks]  taproot tweak from address setup
 * @property {object} [network]                  bitcoinjs network for hex PSBT parsing
 * @property {Array<{ address?: string, script?: string, maxValue?: number }>} [allowedOutputs]
 * @property {boolean} [allowConfirmable]        default false; a daemon denies confirm-required actions
 * @property {PassiveCoSignRequest} request      the inbound co-sign request
 * @property {number} [now]                      injectable clock (ms) for the panic-mode check
 */

/**
 * @typedef {Object} PassiveCoSignResult
 * @property {boolean} approved
 * @property {string} [reason]                   denial code when approved === false
 * @property {*} [detail]
 * @property {string} [publicNonce]              hex; single-input approval
 * @property {string} [sig]                      hex; single-input approval
 * @property {string} [msg]                      hex; single-input approval
 * @property {string} [action]                   the action decoded from the PSBT
 * @property {Array<{ index: number, publicNonce: string, sig: string, msg: string }>} [signatures]  multi-input approval
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
        tweaks,
        network,
        allowedOutputs,
        allowConfirmable,
        request,
        now,
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
    const cosigner = new CoSigner({
        secretKey,
        publicKeys,
        policy,
        windowStore: windowStore ?? null,
        tweaks: tweaks ?? [],
        network: network ?? null,
        allowedOutputs: allowedOutputs ?? [],
        allowConfirmable: allowConfirmable === true,
    });

    const result = cosigner.process(request);

    // Persist any budget consumed during process() before returning the
    // signature, so an authorized spend is durably counted even if the
    // process crashes immediately after.
    if (windowStore) {
        await windowStore.flush();
    }

    return result;
}
