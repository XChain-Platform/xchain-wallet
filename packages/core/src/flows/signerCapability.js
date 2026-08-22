// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// signerCapability (§6): can THIS address actually produce the
// signature a Taproot envelope reveal needs?
//
// This exists because of the shape of the failure, not for tidiness. An envelope
// is a commit/reveal PAIR: the commit funds a one-time P2TR output and the reveal
// spends it through a BIP341 script path. If the reveal turns out to be
// unsignable, the commit has already funded an address whose only exit is the
// §3.5 key-path cancel. §6 states the rule plainly: "The reveal must be signable
// before the commit is broadcast; anything else manufactures a stranded-funds
// event, not an error message."
//
// So the question is answered BEFORE an encoding is chosen, and it is answered
// with an ALLOW-LIST. A deny-list would mean every future address source (a new
// hardware vendor, an air-gapped signer, a multisig account) silently defaults to
// "yes, it can sign", and the cost of being wrong is the user's coin rather than
// an error dialog. Fail closed: anything not known to be capable is not capable,
// and the caller falls back to P2WSH, which is only ~2x the bytes.

/**
 * Address sources that hand the SDK a usable private key, which is what
 * `wallet.signEnvelopeRevealPsbt` needs to produce a Schnorr script-path
 * signature over the envelope leaf.
 *
 * - `hd`           derived from the wallet seed; key available locally
 * - `imported-wif` a key the user pasted; likewise available
 *
 * Deliberately ABSENT, and each for its own reason:
 * - `watch-only`   no key at all, by definition
 * - `trezor`/`ledger` the device signs, and no shipping firmware exposes
 *   tapscript script-path signing over the wallet's integration today. If that
 *   changes it is a per-vendor capability question, not a blanket flip: add the
 *   source here only once a real device has produced a real envelope reveal.
 */
// A frozen ARRAY, not a frozen Set: Object.freeze does not touch a Set's internal
// slots, so a frozen Set still accepts .add() and the allow-list could be widened
// at runtime by any caller. That is the precise fail-OPEN this module exists to
// prevent, so the container has to be one freeze actually protects.
export const TAPSCRIPT_CAPABLE_SOURCES = Object.freeze(['hd', 'imported-wif']);

/**
 * Whether an address can sign a Taproot envelope reveal.
 *
 * Accepts the Address record (or anything carrying `source`) and returns a plain
 * boolean, never a maybe: the caller is deciding whether to commit funds.
 *
 * @param {{ source?: string } | null | undefined} addressRecord
 * @returns {boolean}
 */
export function signerSupportsTapscript(addressRecord) {
    if (!addressRecord || typeof addressRecord !== 'object') return false;
    const source = addressRecord.source;
    if (typeof source !== 'string') return false;
    return TAPSCRIPT_CAPABLE_SOURCES.includes(source);
}

/**
 * The `options` bag the SDK's encoder surface expects for `encoding: 'AUTO'`.
 * AUTO consults `signerSupportsTapscript` before it will select the envelope, so
 * passing this is what makes auto-selection safe for hardware accounts rather
 * than merely lucky.
 *
 * Kept as its own helper so every call site spells the key identically; a typo
 * here reads to the encoder as "capability not asserted", which is the safe
 * direction but would silently cost every user the envelope.
 *
 * @param {{ source?: string } | null | undefined} addressRecord
 * @returns {{ signerSupportsTapscript: boolean }}
 */
export function encoderSignerOptions(addressRecord) {
    return { signerSupportsTapscript: signerSupportsTapscript(addressRecord) };
}

/**
 * Signer kinds that can sign the P2SH/P2WSH phase-2 reveal (the chunk lane).
 *
 * The reveal spends the data-carrier script outputs the phase-1 commit funded
 * and needs the SDK's reveal finalizer over the wallet's own key, which is
 * what `SoftwareSigner.signPsbt({ reveal: true })` does.
 *
 * Deliberately ABSENT, and each for its own reason:
 * - `trezor`/`ledger` (and the RemoteSigner shim that carries either kind):
 *   both device signers drop the `reveal` flag and their format converters
 *   have no P2SH/P2WSH data-carrier input type, so the request fails inside
 *   the vendor layer. Add a kind here only once a real device has signed a
 *   real reveal.
 * - `multisig` / `airgap`: no chunk-lane signing path exists for them at all.
 *
 * Same fail-closed container as TAPSCRIPT_CAPABLE_SOURCES, for the same reason.
 */
export const CHUNK_REVEAL_CAPABLE_SIGNER_KINDS = Object.freeze(['software']);

/**
 * Whether an injected Signer can sign the P2SH/P2WSH phase-2 reveal.
 *
 * Differs in shape from `signerSupportsTapscript`: that one takes an Address
 * record and reads `source` (the question is asked before an encoding is
 * chosen); this one takes the Signer that will be dispatched to and reads
 * `kind`, because the chunk lane's hazard is the dispatch itself. Called by
 * `submitWithSigner` BEFORE the phase-1 commit is signed or broadcast: a
 * refusal there costs an error dialog, a refusal at the signer after the
 * commit is on chain is the stranded-funds event §6 forbids.
 *
 * @param {{ kind?: string } | null | undefined} signer
 * @returns {boolean}
 */
export function signerSupportsChunkReveal(signer) {
    if (!signer || typeof signer !== 'object') return false;
    let kind;
    try {
        kind = signer.kind;
    } catch {
        // The abstract Signer getter throws; an unknown kind is an incapable one.
        return false;
    }
    if (typeof kind !== 'string') return false;
    return CHUNK_REVEAL_CAPABLE_SIGNER_KINDS.includes(kind);
}
