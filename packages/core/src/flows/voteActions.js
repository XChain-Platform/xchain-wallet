// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// VOTE (token-weighted governance) composers. The wire-level VOTE action has
// four versions (spec: xchain-documentation/protocol/actions/VOTE.md):
//   v0: create a poll   v1: cast a ballot   v2: system finalize (never authored here)
//   v3: set or clear a standing delegation
//
// The VOTE-shape knowledge (option/ballot encoding, mode enums, gate defaults,
// binding-poll pairing rules) lives in the SDK's VoteHelpers (sdk.voting), so
// each composer takes the UI-level camelCase object, runs it through the
// matching sdk.voting.*Params builder (which validates + shapes it into the
// wire params), then hands it to submitAction like every other single-action
// flow. UI is in CreatePollForm / CastBallotForm / DelegateVoteForm (delegate +
// clear share one component, two modes, mirroring DelegationActionForm).

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} VoteActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} [password]
 * @property {string} [bip39Passphrase]
 * @property {import('../signers/Signer.js').Signer} [signer]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {object} params            UI-level camelCase params for the matching sdk.voting builder
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt]   single-encode pipeline: sign this exact composed PSBT byte-identically (the one the ConfirmActionModal previewed + tamper-checked) instead of rebuilding.
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

// Shared submit chassis: build the wire params via the named sdk.voting builder,
// then submit as a VOTE action from the source address. Keeping this one helper
// means each exported composer is just "which builder + which summary".
function submitVote(opts, builderName, buildInput, summary) {
    if (!opts) throw new Error('voteActions: opts is required');
    if (!opts.sdkRegistry) throw new Error('voteActions: sdkRegistry is required');
    if (!opts.chainId) throw new Error('voteActions: chainId is required');
    const sdk = opts.sdkRegistry.get(opts.chainId);
    if (!sdk?.voting || typeof sdk.voting[builderName] !== 'function') {
        throw new Error(`voteActions: sdk.voting.${builderName} is unavailable`);
    }
    // Validates + normalizes the UI input into wire params (throws on bad input
    // BEFORE any signing prompt, matching the other composers' up-front guards).
    const params = sdk.voting[builderName](buildInput);
    const source = normalizeSource(opts.from, 'voteActions');
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: summary,
    };
    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        signer: opts.signer,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData: { action: 'VOTE', params },
        encoderOpts: {
            pubkey: source.publicKey,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
        },
        signingPaths: [source.derivationPath
            ? { inputIndex: 0, path: source.derivationPath }
            : { inputIndex: 0, addressId: source.addressId }],
        prebuiltPsbt: opts.prebuiltPsbt,
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
    });
}

/**
 * Create a governance poll (VOTE v0). `opts.params` is the sdk.voting.createPollParams
 * input: { tick, endBlock, options, maxSelections?, tallyMode?, weightMode?, quorum?,
 * minVoters?, minVoteBalance?, decideThreshold?, question?, deposit?, callback* }.
 * @param {VoteActionOpts} opts
 */
export async function createPollAction(opts) {
    if (!opts?.params?.tick) throw new Error('createPollAction: params.tick is required');
    const q = opts.params.question ? ` "${String(opts.params.question).slice(0, 40)}"` : '';
    return submitVote(opts, 'createPollParams', opts.params, `Create ${opts.params.tick} governance poll${q}`);
}

/**
 * Cast a ballot on an existing poll (VOTE v1). `opts.params` is the
 * sdk.voting.castBallotParams input: { pollRef, ballot, memo? }.
 * @param {VoteActionOpts} opts
 */
export async function castBallotAction(opts) {
    if (opts?.params?.pollRef === undefined || opts?.params?.pollRef === null) {
        throw new Error('castBallotAction: params.pollRef is required');
    }
    return submitVote(opts, 'castBallotParams', opts.params, `Vote on poll ${opts.params.pollRef}`);
}

/**
 * Set a standing delegation of TICK voting weight (VOTE v3). `opts.params` is the
 * sdk.voting.delegateParams input: { tick, delegateTo, memo? }.
 * @param {VoteActionOpts} opts
 */
export async function delegateVoteAction(opts) {
    if (!opts?.params?.tick) throw new Error('delegateVoteAction: params.tick is required');
    if (!opts?.params?.delegateTo) throw new Error('delegateVoteAction: params.delegateTo is required');
    const to = String(opts.params.delegateTo);
    return submitVote(opts, 'delegateParams', opts.params, `Delegate ${opts.params.tick} votes to ${to.slice(0, 12)}…`);
}

/**
 * Clear a standing delegation of TICK voting weight (VOTE v3, blank DELEGATE_TO).
 * `opts.params` is the sdk.voting.clearDelegationParams input: { tick, memo? }.
 * @param {VoteActionOpts} opts
 */
export async function clearVoteDelegationAction(opts) {
    if (!opts?.params?.tick) throw new Error('clearVoteDelegationAction: params.tick is required');
    return submitVote(opts, 'clearDelegationParams', opts.params, `Clear ${opts.params.tick} vote delegation`);
}
