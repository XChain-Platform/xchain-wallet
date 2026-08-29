// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Abstract Signer contract (§17.1). Every wallet flow that needs to sign
// something goes through a Signer. Implementations: SoftwareSigner
// (§17.2, here in `core`), TrezorSigner / LedgerSigner (§17.3–4, separate
// workspace packages), MultisigSigner (§17.5, Phase 4+).
//
// The base class throws from every abstract method; subclasses override.
// A tiny pub/sub is provided on the base since all signers share the
// same 'status-change' event shape.

/** Stable error classes consumers can branch on. */
export class AbstractMethodError extends Error {
    constructor(method) {
        super(`Signer: abstract method "${method}" not implemented`);
        this.name = 'AbstractMethodError';
    }
}

export class SignerLockedError extends Error {
    constructor(signerId) {
        super(`Signer "${signerId}" is locked`);
        this.name = 'SignerLockedError';
        this.signerId = signerId;
    }
}

export class SignerStatusError extends Error {
    constructor(signerId, status, detail) {
        super(`Signer "${signerId}" is in status "${status}"${detail ? `: ${detail}` : ''}`);
        this.name = 'SignerStatusError';
        this.signerId = signerId;
        this.status = status;
    }
}

export class NotImplementedError extends Error {
    constructor(method) {
        super(`${method}: not yet implemented`);
        this.name = 'NotImplementedError';
    }
}

/**
 * The backstop every non-software signer runs at the top of `signPsbt`.
 *
 * A Taproot envelope reveal is a BIP341 script-path spend, and no shipping
 * hardware firmware signs one. The primary gate is
 * `flows/signerCapability.js#signerSupportsTapscript`, which keeps hardware
 * accounts off the envelope encoding entirely; this is the backstop for when it
 * does not. It lived only in RemoteSigner, so a renderer-registered
 * LedgerSigner/TrezorSigner (the desktop and popup shells register the concrete
 * device signer, not the transport shim) received `envelopeReveal: true` and
 * ignored it, failing later and deeper with `unsupported input scriptType
 * "p2tr"` or `input has only a witnessUtxo` instead of the capability message.
 *
 * Guards `envelopeReveal` ONLY, deliberately, and `reveal` is NOT added here.
 * The two flags sit on opposite sides of the first broadcast. `envelopeReveal`
 * is dispatched while nothing is on chain (submitWithSigner step 3b, before the
 * commit), so refusing it costs an error. `reveal` is the P2SH/P2WSH phase-2
 * spend, dispatched AFTER phase 1 has been broadcast, so a refusal there
 * completes the commit and never the reveal, which is the stranded-funds event
 * §6 forbids. The guard on that path is the pre-dispatch capability check in
 * submitWithSigner (`flows/signerCapability.js#signerSupportsChunkReveal`,
 * consulted before phase 1 is signed), never a refusal at the signer.
 *
 * @param {string} signerId
 * @param {{ envelopeReveal?: boolean } | null | undefined} params
 */
export function assertCannotSignEnvelopeReveal(signerId, params) {
    if (params && params.envelopeReveal) {
        throw new SignerStatusError(
            signerId, 'error',
            'signPsbt: this signer cannot sign a Taproot envelope reveal (BIP341 script path)',
        );
    }
}

/**
 * The second backstop the device signers run at the top of `signPsbt`.
 *
 * Hardware signing here is all-or-refuse: both vendor converters
 * (`toLedgerCreatePayment`, `toTrezorSignTransaction`) demand a signingPaths
 * entry for EVERY decomposed input and both signers hand back a fully
 * serialized transaction with `signedPsbtHex: ''`, never a partially-signed
 * PSBT for the next party. `signingPaths` therefore means "the key for each
 * input" on this lane, not the "sign only these inputs" scope the software
 * signer implements. Without this check a mixed-input (co-signed) PSBT that
 * passed the caller's zero-match guard died inside the converter with
 * `no signingPath for input index N`, which reads as a malformed request
 * rather than the capability limit it is. The primary gate is the
 * `auth.signPsbt.hw` host route, which refuses partial coverage before the
 * device is engaged; this is the backstop for every other caller.
 *
 * @param {string} signerId
 * @param {number} inputCount   decomposed.inputs.length
 * @param {Array<{ inputIndex?: number }> | null | undefined} signingPaths
 */
export function assertFullInputCoverage(signerId, inputCount, signingPaths) {
    if (!Number.isInteger(inputCount) || inputCount < 0) {
        throw new SignerStatusError(signerId, 'error', 'signPsbt: could not count the PSBT inputs');
    }
    const covered = new Set();
    for (const sp of Array.isArray(signingPaths) ? signingPaths : []) {
        if (sp && Number.isInteger(sp.inputIndex)) covered.add(sp.inputIndex);
    }
    let missing = 0;
    for (let i = 0; i < inputCount; i += 1) if (!covered.has(i)) missing += 1;
    if (missing > 0) {
        throw new SignerStatusError(
            signerId, 'error',
            'signPsbt: this signer signs every input of a transaction or none, so it cannot '
            + `partially sign (this key owns ${inputCount - missing} of ${inputCount} inputs). `
            + 'Use a software wallet key for co-signed transactions.',
        );
    }
}

/** @typedef {'software' | 'trezor' | 'ledger' | 'multisig' | 'airgap'} SignerKind */
/** @typedef {'available' | 'locked' | 'disconnected' | 'wrong-app' | 'unsupported-network' | 'error'} SignerStatus */

/**
 * @typedef {Object} GetAddressesParams
 * @property {string} chainId
 * @property {number} accountIndex
 * @property {0 | 1} change   BIP44 branch: 0 external (receive/dispenser), 1 internal change (§16)
 * @property {number} startIndex
 * @property {number} count
 * @property {string} [addressType]  defaults to the chain's defaultAddressType
 * @property {boolean} [verify]  hardware signers only: display each derived
 *        address on the device's trusted screen and require the user to
 *        confirm it, so a compromised host/transport cannot substitute a
 *        deposit address the user cannot see. Software signers ignore it
 *        (their addresses are derived locally, not host-mediated). Use it
 *        ONLY for a small, deliberate set (a fresh receive address, an
 *        on-demand "verify this address" tap) - never for silent gap-limit
 *        scanning, which would prompt the user on-device for every index.
 */

/**
 * @typedef {Object} DerivedAddress
 * @property {number} index
 * @property {string} address
 * @property {string} publicKey   hex
 * @property {string} path        concrete BIP32 path
 */

/**
 * A signing-path entry. Exactly one of `path` (HD-derived) or
 * `addressId` (imported-WIF, software signer only) must be present.
 * Hardware signers accept only the `path` form.
 *
 * @typedef {Object} SigningPathEntry
 * @property {number} inputIndex
 * @property {string} [path]         BIP32 path, HD-derived key
 * @property {string} [addressId]    Address record id, imported-WIF key (SoftwareSigner only)
 * @property {number} [sighashType]
 */

/**
 * @typedef {Object} SignPsbtParams
 * @property {string} psbtHex
 * @property {string} chainId
 * @property {SigningPathEntry[]} signingPaths
 * @property {boolean} [reveal]: phase-2 P2SH/P2WSH reveal tx. Its inputs are
 *                                the chunk-lane data-carrier outputs, which need the SDK's
 *                                reveal finalizer (not the default single-sig one). Software
 *                                signer only; two-phase P2SH is rejected for HW/remote signers.
 * @property {boolean} [envelopeReveal]: the Taproot envelope reveal tx (BIP341
 *                                script-path spend), dispatched by submitWithSigner step 3b
 *                                while nothing is on chain yet. A signer that cannot produce
 *                                a script-path spend REFUSES it here, via
 *                                `assertCannotSignEnvelopeReveal`; unlike `reveal`, refusing
 *                                costs an error rather than a stranded commit.
 */

/**
 * @typedef {Object} SignPsbtReturn
 * @property {string} signedPsbtHex
 * @property {string} txHex
 * @property {string} txid
 */

/**
 * Sign a message. Like `SignPsbtParams.signingPaths`, exactly one of
 * `path` or `addressId` identifies the key.
 *
 * @typedef {Object} SignMessageParams
 * @property {string} message
 * @property {string} chainId
 * @property {string} [path]
 * @property {string} [addressId]
 */

/**
 * @typedef {Object} SignMessageReturn
 * @property {string} signature
 */

/**
 * @typedef {Object} GetPublicKeyParams
 * @property {string} chainId
 * @property {string} path
 */

/**
 * @typedef {Object} GetPublicKeyReturn
 * @property {string} publicKey
 * @property {string} chainCode
 * @property {string} fingerprint
 */

/**
 * @typedef {Object} MultisigSessionRef
 * @property {'p2sh-multisig' | 'p2wsh-multisig' | 'taproot-musig2'} scheme
 * @property {number} threshold
 * @property {string[]} cosignerPubkeys     33-byte hex, ordered same as MultisigConfig.cosigners
 * @property {string} msgHash               32-byte hex; sighash of the input being signed
 * @property {string} fingerprint           32-byte hex of the canonicalized sessionRef (multisigPsbtEnvelope.fingerprintSessionRef)
 * @property {string} nonceUniqueId         per-signing-session unique id (the session UUID); bound into the MuSig2 secret-nonce derivation so two signings of the same tx cannot reuse a nonce (BIP327). Required for taproot-musig2.
 */

/**
 * @typedef {Object} SignMusig2Round1Params
 * @property {string} chainId
 * @property {string} path                  cosigner's BIP32 path
 * @property {MultisigSessionRef} sessionRef
 */

/**
 * @typedef {Object} SignMusig2Round1Return
 * @property {string} publicNonce           66-byte hex
 */

/**
 * @typedef {Object} SignMusig2Round2Params
 * @property {string} chainId
 * @property {string} path
 * @property {MultisigSessionRef} sessionRef
 * @property {string} aggNonceHex           66-byte aggregated public nonce, post-round-1
 */

/**
 * @typedef {Object} SignMusig2Round2Return
 * @property {string} publicNonce           66-byte hex; re-derived deterministically (same as round 1)
 * @property {string} partialSig            32-byte hex
 */

/**
 * @typedef {Object} SignMultisigClassicalParams
 * @property {string} chainId
 * @property {string} path                  cosigner's BIP32 path
 * @property {string} msgHash               32-byte hex; sighash being signed under the redeem/witness script
 */

/**
 * @typedef {Object} SignMultisigClassicalReturn
 * @property {string} sig                   DER-encoded ECDSA signature hex (no sighash flag byte)
 * @property {string} publicKey             33-byte hex of the signing key (for the sign-screen confirmation step)
 */

/**
 * §22.3 P2SH / P2WSH multisig PSBT signing (pre-launch Step 3). This
 * is the HW-friendly variant of `signMultisigClassical`: takes a
 * full PSBT and returns the signed-but-unfinalized PSBT. Hardware
 * signers that don't yet support multisig surface a clear error.
 *
 * @typedef {Object} SignMultisigPsbtParams
 * @property {string} chainId
 * @property {string} psbtHex                       unsigned PSBT (or partially signed by other cosigners)
 * @property {SigningPathEntry[]} signingPaths      which inputs to sign + under which path
 */

/**
 * @typedef {Object} SignMultisigPsbtReturn
 * @property {string} psbtHex                       PSBT with this signer's partial sigs added (NOT finalized)
 */

/** @typedef {(status: SignerStatus, detail?: string) => void} StatusListener */

export class Signer {
    constructor() {
        /** @type {Set<StatusListener>} */
        this._listeners = new Set();
    }

    /** Stable identifier (e.g. "software-wallet-abc", "trezor-device-xyz"). */
    get id() {
        throw new AbstractMethodError('id');
    }

    /** Human-readable name shown in UI. */
    get displayName() {
        throw new AbstractMethodError('displayName');
    }

    /** @returns {SignerKind} */
    get kind() {
        throw new AbstractMethodError('kind');
    }

    /** @returns {boolean} */
    get requiresPhysicalConfirmation() {
        return false;
    }

    /** @returns {Promise<SignerStatus>} */
    async getStatus() {
        throw new AbstractMethodError('getStatus');
    }

    /**
     * @param {GetAddressesParams} _params
     * @returns {Promise<DerivedAddress[]>}
     */
    async getAddresses(_params) {
        throw new AbstractMethodError('getAddresses');
    }

    /**
     * @param {SignPsbtParams} _params
     * @returns {Promise<SignPsbtReturn>}
     */
    async signPsbt(_params) {
        throw new AbstractMethodError('signPsbt');
    }

    /**
     * @param {SignMessageParams} _params
     * @returns {Promise<SignMessageReturn>}
     */
    async signMessage(_params) {
        throw new AbstractMethodError('signMessage');
    }

    /**
     * @param {GetPublicKeyParams} _params
     * @returns {Promise<GetPublicKeyReturn>}
     */
    async getPublicKey(_params) {
        throw new AbstractMethodError('getPublicKey');
    }

    /**
     * §22.3 MuSig2 round 1: generate this signer's 66-byte publicNonce
     * for the given multisig session. The secret nonce is bound to the
     * (signer instance + sessionRef.fingerprint) tuple so round 2 can
     * deterministically re-derive it without persisting secret material.
     *
     * Hardware signers throw `NotImplementedError` with a clear
     * "Update firmware to use MuSig2 on this device" message until the
     * vendor app exposes MuSig2 nonce generation.
     *
     * @param {SignMusig2Round1Params} _params
     * @returns {Promise<SignMusig2Round1Return>}
     */
    async signMusig2Round1(_params) {
        throw new AbstractMethodError('signMusig2Round1');
    }

    /**
     * §22.3 MuSig2 round 2: produce a 32-byte partial signature given
     * the aggregated public nonce. Re-derives the secret nonce from the
     * same deterministic sessionId used in round 1 (so the public
     * nonce returned matches round 1's output bit-for-bit).
     *
     * @param {SignMusig2Round2Params} _params
     * @returns {Promise<SignMusig2Round2Return>}
     */
    async signMusig2Round2(_params) {
        throw new AbstractMethodError('signMusig2Round2');
    }

    /**
     * §22.3 P2SH / P2WSH single-round contribution: produce a
     * DER-encoded ECDSA signature on the input's sighash under the
     * redeem / witness script. No sighash flag byte is appended; the
     * caller's PSBT finalizer adds it.
     *
     * @param {SignMultisigClassicalParams} _params
     * @returns {Promise<SignMultisigClassicalReturn>}
     */
    async signMultisigClassical(_params) {
        throw new AbstractMethodError('signMultisigClassical');
    }

    /**
     * §22.3 P2SH / P2WSH multisig PSBT signing: full-PSBT variant.
     * Returns the PSBT with this signer's partial sigs added but NOT
     * finalized; the coordinator merges + finalizes once threshold is
     * met. Hardware signers that lack multisig support throw a clear
     * "use the software signer or register a wallet policy" error.
     *
     * @param {SignMultisigPsbtParams} _params
     * @returns {Promise<SignMultisigPsbtReturn>}
     */
    async signMultisigPsbt(_params) {
        throw new AbstractMethodError('signMultisigPsbt');
    }

    /**
     * Subscribe to status changes. Returns an unsubscribe function.
     * @param {StatusListener} listener
     * @returns {() => void}
     */
    subscribe(listener) {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /**
     * @protected
     * @param {SignerStatus} status
     * @param {string} [detail]
     */
    _emitStatus(status, detail) {
        for (const fn of this._listeners) {
            try {
                fn(status, detail);
            } catch {
                // Listener errors are not the signer's concern.
            }
        }
    }
}
