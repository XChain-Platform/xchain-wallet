// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Single-encode pipeline tamper checks ( §5.3.2-3).
//
// composeForConfirm builds exactly ONE PSBT before the modal opens; the
// user previews it and submitWithSigner signs it byte-identically. Two
// independent checks run on that exact PSBT so a compromised encoder (or
// a corrupted response) cannot slip an extra output past the user:
//
//   1. Output-set check (all encodings): every output in the built PSBT
//      must be an EXPECTED output (a caller-supplied custom output, the
//      native-fee output, the resolved ADS donation - all of which live
//      in the final encoderOpts.customOutputs) OR the action carrier for
//      the chosen encoding OR change to one of the wallet's own
//      addresses. Any other output is a blocking tamper error.
//
//   2. Action-byte cross-check (inline OP_RETURN only): the decoded
//      action string in the PSBT must equal the intended action string.
//
//   3. Carrier-script check (P2SH/P2WSH chunk lanes): the redeem scripts
//      the encoder committed to must hash to outputs actually present in
//      this PSBT, AND their data pushes must concatenate to the intended
//      action. This used to be residual encoder trust, because check 2
//      skips these encodings and the commit output is only a hash - so
//      the lane carrying the LARGEST payloads was the least verified.
//      Closed by having the encoder RETURN the scripts (spec §5.3.2)
//      rather than re-deriving them here, which would need a byte-parity
//      gate against the encoder forever.
//
// Pure and advisory-capable: the functions RETURN structured results;
// the caller decides whether to throw. The action-variant hook throws a
// TamperDetectedError on any mismatch (non-overridable); the PSBT
// variant (§5.5) reuses checkOutputSet in report-only mode.

/**
 * Non-overridable tamper error. Distinct from the SDK's SDKPreflightError:
 * a preflight failure is "the network would reject this"; a tamper is
 * "the bytes you would sign are not the bytes you approved".
 */
export class TamperDetectedError extends Error {
    /**
     * @param {string} message
     * @param {{ outputs?: unknown[], expected?: unknown[], decoded?: unknown }} [details]
     */
    constructor(message, details = {}) {
        super(message);
        this.name = 'TamperDetectedError';
        this.code = 'TAMPER_DETECTED';
        this.details = details;
    }
}

// An OP_RETURN scriptPubKey begins with OP_RETURN (0x6a); decomposePsbt
// classifies it as scriptType 'unknown' with a null address.
function isOpReturnOutput(out) {
    return typeof out.scriptPubKeyHex === 'string' &&
        out.scriptPubKeyHex.toLowerCase().startsWith('6a');
}

const P2SH_TYPES = new Set(['p2sh', 'p2sh-p2wpkh', 'p2sh-p2wsh']);
const P2WSH_TYPES = new Set(['p2wsh']);

/**
 * Build the expected-output matcher set for a composed action PSBT.
 * The final encoderOpts.customOutputs already folds the native-fee
 * output (applyNativeFeePreflight) and the ADS donation
 * (applyAdsPlanToEncoderOpts), so they are all `addressed` slots here.
 *
 * @param {Object} args
 * @param {Array<{ address: string, value: number|string }>} [args.customOutputs]
 * @param {string} args.encoding   'OP_RETURN' | 'P2SH' | 'P2WSH' | 'MULTISIGN'
 * @param {{ address: string|null, value: number }|null} [args.adsOutput]   the resolved ADS donation, when present (hidden from display)
 * @returns {{ addressed: Array<{ address: string, value: number, isAds: boolean }>, encoding: string }}
 */
export function buildExpectedOutputs({ customOutputs = [], encoding, adsOutput = null, actionByteLen }) {
    const addressed = (Array.isArray(customOutputs) ? customOutputs : []).map((o) => ({
        address: String(o.address),
        value: Number(o.value),
        // Flag the ADS output so the modal can whitelist-but-not-display it.
        isAds: !!(adsOutput && String(o.address) === String(adsOutput.address) &&
            Number(o.value) === Number(adsOutput.value)),
    }));
    const enc = String(encoding || '').toUpperCase();
    return { addressed, encoding: enc, carrierAllowance: expectedCarrierAllowance(enc, actionByteLen) };
}

/**
 * Assert that every output in the built PSBT is expected, own-change, or
 * the action carrier. Advisory: returns a result; the caller throws.
 *
 * @param {Object} args
 * @param {string} args.psbtHex
 * @param {ReturnType<typeof buildExpectedOutputs>} args.expected
 * @param {string[]} args.ownAddresses            wallet-owned addresses (change is allowed here)
 * @param {(psbtHex: string) => { outputs: Array<{ address: string|null, scriptPubKeyHex: string, scriptType: string, value: number }> }} args.decomposePsbt
 * @returns {{ ok: boolean, unexpected: Array<{ index: number, address: string|null, value: number, scriptType: string }> }}
 */
export function checkOutputSet({ psbtHex, expected, ownAddresses, decomposePsbt }) {
    const own = new Set((ownAddresses || []).map(String));
    const decomposed = decomposePsbt(psbtHex);
    const outputs = decomposed.outputs || [];

    // Consumable copy of the addressed matchers (each matches at most once).
    const addressed = expected.addressed.map((s) => ({ ...s, consumed: false }));
    // How many carrier legs the chosen encoding may emit. OP_RETURN is always
    // one; a P2SH/P2WSH/MULTISIGN payload larger than a single on-chain chunk
    // spreads across several data-carrier outputs, so the allowance is derived
    // from the action size (see expectedCarrierAllowance). Falls back to the
    // single-leg default when the size was not supplied (older call sites/tests).
    let carrierAllowance = Number.isFinite(expected.carrierAllowance)
        ? expected.carrierAllowance
        : carrierAllowanceFor(expected.encoding);
    const unexpected = [];

    for (let i = 0; i < outputs.length; i++) {
        const out = outputs[i];

        // 1. An expected addressed output (custom / fee / ADS): address AND value.
        const slot = addressed.find((s) => !s.consumed && s.address === out.address && s.value === Number(out.value));
        if (slot) { slot.consumed = true; continue; }

        // 2. The action carrier for the chosen encoding.
        if (isCarrier(out, expected.encoding) && carrierAllowance > 0) {
            carrierAllowance -= 1;
            continue;
        }

        // 3. Change back to a wallet-owned address (any value).
        if (out.address && own.has(out.address)) continue;

        // 4. Anything else is a tamper.
        unexpected.push({ index: i, address: out.address, value: Number(out.value), scriptType: out.scriptType });
    }

    return { ok: unexpected.length === 0, unexpected };
}

function carrierAllowanceFor(encoding) {
    // Exactly one carrier leg per encoding (the inline OP_RETURN, or a
    // single P2SH/P2WSH/MULTISIGN commit output). Used only as the fallback
    // when the action size is unknown; expectedCarrierAllowance is the real
    // count for chunk encodings.
    return encoding ? 1 : 0;
}

// On-chain payload budget per data-carrier output, mirroring xchain-encoder
// XChainEncoder.js prepareData: a P2SH/P2WSH chunk holds SCRIPT_ELEMENT_SIZE
// (520) minus a 44-byte script-trailer/overhead reservation = 476 payload
// bytes; a bare-multisig carrier packs 60. If these encoder constants ever
// change, this over-estimates rather than rejects (see the +overhead/+1 margin
// below), so a deploy never falsely fails - at worst one extra carrier slot is
// tolerated (a slot a compromised encoder could already inflate in value under
// the documented residual-encoder-trust model, and which shows up in the
// confirm page's total-debit line).
const CHUNK_PAYLOAD_BYTES = { P2SH: 476, P2WSH: 476, MULTISIGN: 60 };

/**
 * How many carrier outputs the chosen encoding legitimately emits for an
 * action of `actionByteLen` bytes.
 *
 * D-24 : the encoder splits a P2SH/P2WSH/MULTISIGN payload that exceeds
 * one on-chain chunk across MULTIPLE data-carrier outputs (one per chunk), but
 * the tamper check formerly allowed exactly one - so any real contract DEPLOY
 * (or a large FILE / gated publish) was falsely flagged "outputs you did not
 * approve" and could never broadcast through the confirm modal. The count is a
 * deterministic function of the payload size, so it can be bounded here without
 * trusting the encoder's output count: an EXTRA carrier beyond this allowance is
 * still a tamper. Per-carrier VALUE stays unbounded, matching the existing
 * residual-encoder-trust posture (a commit output funds the reveal spend and is
 * not dust; confirmChecks.test.js documents a high-value single carrier as
 * accepted), with the confirm page's total-debit as the backstop against an
 * inflated carrier.
 *
 * @param {string} encoding   normalized ('OP_RETURN' | 'P2SH' | 'P2WSH' | 'MULTISIGN')
 * @param {number} [actionByteLen]   UTF-8 byte length of the composed action string
 * @returns {number}
 */
function expectedCarrierAllowance(encoding, actionByteLen) {
    const enc = String(encoding || '').toUpperCase();
    if (!enc) return 0;
    if (enc === 'OP_RETURN') return 1; // single zero-value nulldata leg
    const per = CHUNK_PAYLOAD_BYTES[enc];
    if (!per) return 0;
    // Unknown size (legacy call sites/tests): keep the single-leg default.
    if (!Number.isFinite(actionByteLen)) return 1;
    // +16 covers the magic word + compiled push prefix; the trailing +1 is a
    // rounding margin so a legitimate deploy is NEVER rejected (over-allowing at
    // a chunk boundary is safe - see CHUNK_PAYLOAD_BYTES).
    const len = Math.max(0, Number(actionByteLen));
    return Math.ceil((len + 16) / per) + 1;
}

function isCarrier(out, encoding) {
    switch (encoding) {
        case 'OP_RETURN':
            // Exactly one zero-value OP_RETURN output; content covered by
            // checkActionByteMatch, not by this matcher.
            return isOpReturnOutput(out) && Number(out.value) === 0;
        case 'P2SH':
            return P2SH_TYPES.has(out.scriptType);
        case 'P2WSH':
            return P2WSH_TYPES.has(out.scriptType);
        case 'MULTISIGN':
            // Bare multisig carrier rides fake pubkeys; decomposePsbt tags
            // it 'unknown' (not a standard single-key type). Residual
            // encoder trust: the commit script is not independently
            // predictable client-side (§5.3.2).
            return out.scriptType === 'unknown' && !isOpReturnOutput(out);
        default:
            return false;
    }
}

/**
 * Cross-check the decoded action bytes against the intended action string.
 * Only meaningful for inline OP_RETURN encodings; for P2SH/P2WSH the params
 * are not in this PSBT (two-phase), so this returns { ok: true, skipped: true }.
 *
 * @param {Object} args
 * @param {string} args.psbtHex
 * @param {string} args.actionString              the intended (composed) action string
 * @param {string} args.encoding
 * @param {(psbtOrHex: string, opts?: object) => { ok: boolean, actionString?: string, reason?: string }} args.decodeActionFromPsbt
 * @returns {{ ok: boolean, skipped?: boolean, decoded?: object, reason?: string }}
 */
export function checkActionByteMatch({ psbtHex, actionString, encoding, decodeActionFromPsbt }) {
    if (String(encoding || '').toUpperCase() !== 'OP_RETURN') {
        return { ok: true, skipped: true };
    }
    const decoded = decodeActionFromPsbt(psbtHex);
    if (!decoded || decoded.ok !== true) {
        return { ok: false, reason: decoded && decoded.reason ? decoded.reason : 'decode-failed', decoded };
    }
    if (decoded.actionString !== actionString) {
        return { ok: false, reason: 'action-string-mismatch', decoded };
    }
    return { ok: true, decoded };
}

/**
 * Check 3: carrier-script verification for the P2SH/P2WSH chunk lanes.
 *
 * checkActionByteMatch covers inline OP_RETURN and skips everything else,
 * which left the encoding that carries the LARGEST payloads verified by
 * nothing but the output-set shape. The encoder now returns the redeem
 * scripts it committed to, so the client can hash them against the PSBT's
 * own outputs and read the payload back out (spec §5.3.2).
 *
 * Delegates to the SDK rather than re-deriving the script here: a second
 * copy of the encoder's construction would need a byte-parity gate forever.
 *
 * @param {function} verifyCarrierScripts  sdk.decoder.verifyCarrierScripts
 * @param {string[]} carrierScripts        as create_tx returned them
 */
export function checkCarrierScripts({ psbt, carrierScripts, encoding, actionString, network, verifyCarrierScripts }) {
    // Encoding first, THEN wiring. A non-chunk encoding genuinely has nothing
    // to check here (inline OP_RETURN has its own byte-match, MULTISIGN is
    // covered by the output-set shape), so skipping is honest.
    const enc = String(encoding || '').toUpperCase();
    if (enc !== 'P2SH' && enc !== 'P2WSH') {
        return { ok: true, skipped: true };
    }
    // But a CHUNK lane with no verifier injected is a wiring failure, and
    // returning ok there would be "cannot verify" reading as "verified" - the
    // exact shape of the §5.4 session store and the §8.5 drift gate, both of
    // which sat inert for months looking like shipped features. Fail closed:
    // the PSBT variant never reaches this, because it skips on encoding above.
    if (typeof verifyCarrierScripts !== 'function') {
        return { ok: false, reason: 'no-verifier', checked: 0 };
    }
    return verifyCarrierScripts({ psbt, carrierScripts, encoding: enc, actionString, network });
}

/**
 * Run ALL THREE checks and THROW a TamperDetectedError on any failure. This
 * is the action-variant hook's blocking path; the PSBT variant calls the
 * individual functions directly in report-only mode.
 *
 * @param {Object} args   see checkOutputSet + checkActionByteMatch args, plus:
 * @param {string} args.actionString
 * @returns {{ outputSet: object, actionBytes: object, carrier: object }}
 */
export function assertNoTamper({ psbtHex, expected, ownAddresses, decomposePsbt, actionString, decodeActionFromPsbt,
                                 psbt, carrierScripts, network, verifyCarrierScripts }) {
    const outputSet = checkOutputSet({ psbtHex, expected, ownAddresses, decomposePsbt });
    if (!outputSet.ok) {
        throw new TamperDetectedError(
            `The transaction contains ${outputSet.unexpected.length} output(s) you did not approve.`,
            { outputs: outputSet.unexpected, expected: expected.addressed });
    }
    const actionBytes = checkActionByteMatch({ psbtHex, actionString, encoding: expected.encoding, decodeActionFromPsbt });
    if (!actionBytes.ok) {
        throw new TamperDetectedError(
            'The action encoded in the transaction does not match what you approved.',
            { decoded: actionBytes.decoded, reason: actionBytes.reason });
    }
    const carrier = checkCarrierScripts({
        psbt, carrierScripts, encoding: expected.encoding, actionString, network, verifyCarrierScripts,
    });
    if (!carrier.ok) {
        // Same copy as the action-byte mismatch on purpose: from the user's
        // seat these are the same event (the bytes are not what was approved),
        // and the encoding that produced it is not their concern.
        throw new TamperDetectedError(
            'The action encoded in the transaction does not match what you approved.',
            { reason: carrier.reason, checked: carrier.checked });
    }
    return { outputSet, actionBytes, carrier };
}
