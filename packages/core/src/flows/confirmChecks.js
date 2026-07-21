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
//      The two-phase P2SH/P2WSH reveal cannot be cross-checked pre-
//      broadcast (the params live in a reveal tx that doesn't exist
//      yet), documented as residual encoder trust in the threat model.
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
export function buildExpectedOutputs({ customOutputs = [], encoding, adsOutput = null }) {
    const addressed = (Array.isArray(customOutputs) ? customOutputs : []).map((o) => ({
        address: String(o.address),
        value: Number(o.value),
        // Flag the ADS output so the modal can whitelist-but-not-display it.
        isAds: !!(adsOutput && String(o.address) === String(adsOutput.address) &&
            Number(o.value) === Number(adsOutput.value)),
    }));
    return { addressed, encoding: String(encoding || '').toUpperCase() };
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
    let carrierAllowance = carrierAllowanceFor(expected.encoding);
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
    // Exactly one carrier leg per encoding (the inline OP_RETURN, or the
    // single P2SH/P2WSH/MULTISIGN commit output).
    return encoding ? 1 : 0;
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
 * Run BOTH checks and THROW a TamperDetectedError on any failure. This is
 * the action-variant hook's blocking path; the PSBT variant calls the
 * individual functions directly in report-only mode.
 *
 * @param {Object} args   see checkOutputSet + checkActionByteMatch args, plus:
 * @param {string} args.actionString
 * @returns {{ outputSet: object, actionBytes: object }}
 */
export function assertNoTamper({ psbtHex, expected, ownAddresses, decomposePsbt, actionString, decodeActionFromPsbt }) {
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
    return { outputSet, actionBytes };
}
