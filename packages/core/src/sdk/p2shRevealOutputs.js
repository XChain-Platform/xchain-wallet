// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Check the P2SH/P2WSH reveal's outputs before signing. The commit emits none of
// the action's payments, so the reveal is the only transaction that pays them,
// and it is built after Approve; an unchecked reveal is an unchecked signature.

import { sameSats } from '../flows/confirmChecks.js';

/**
 * Longest payload the one OP_RETURN marker of each two-phase reveal may push:
 * the 4-byte protocol magic plus the encoding name, obfuscated to that length.
 */
const MARKER_PAYLOAD_BYTES = Object.freeze({ P2SH: 8, P2WSH: 9 });

/**
 * Thrown before the reveal is signed when its outputs do not pay exactly what
 * the user approved. The commit is signed but not yet broadcast, so nothing is
 * on chain; the error names the commit for diagnosis.
 */
export class RevealOutputsRefusedError extends Error {
    /**
     * @param {{ reason: string, unexpected: Array<object>, missing: Array<object>,
     *   phase1Txid: string, phase1TxHex: string, chainId: string, encoding: string }} fields
     */
    constructor({ reason, unexpected, missing, phase1Txid, phase1TxHex, chainId, encoding }) {
        super('The revealing transaction built for this action was not signed: it '
            + `${reason}. The commit ${phase1Txid} was signed and not broadcast, so nothing was sent.`);
        this.name = 'RevealOutputsRefusedError';
        this.code = 'REVEAL_OUTPUTS_REFUSED';
        this.userFacing = true;
        this.phase = 'phase2';
        this.reason = reason;
        this.unexpected = unexpected;
        this.missing = missing;
        this.phase1Txid = phase1Txid;
        this.phase1TxHex = phase1TxHex;
        this.chainId = chainId;
        this.encoding = encoding;
    }
}

// Whether an output is an OP_RETURN with one push no longer than the encoding's
// marker, too short to carry a second action beside the revealed one.
function isRevealMarker(out, encoding) {
    const markerBytes = MARKER_PAYLOAD_BYTES[/** @type {keyof typeof MARKER_PAYLOAD_BYTES} */ (encoding)];
    const script = typeof out?.scriptPubKeyHex === 'string' ? out.scriptPubKeyHex.toLowerCase() : '';
    if (!markerBytes || !/^6a[0-9a-f]{2}/.test(script)) return false;
    const push = parseInt(script.slice(2, 4), 16);
    return push <= markerBytes && script.length === 4 + push * 2;
}

/**
 * Why a reveal's outputs are refused, or null when they pay exactly the
 * approved deferred outputs plus wallet-owned change and the one marker.
 * Outputs are `decomposePsbt` shapes; amounts compare exactly, never by Number.
 *
 * @param {{ revealOutputs: unknown, deferredOutputs: Array<{ address: string, value: string | number }>,
 *   ownAddresses: Iterable<string>, encoding: string }} args
 * @returns {{ reason: string, unexpected: Array<object>, missing: Array<object> } | null}
 */
export function revealOutputsRefusal({ revealOutputs, deferredOutputs, ownAddresses, encoding }) {
    if (!Array.isArray(revealOutputs) || revealOutputs.length === 0) {
        return { reason: 'could not be read as a set of outputs', unexpected: [], missing: [] };
    }
    const own = new Set([...(ownAddresses || [])].filter(Boolean).map(String));
    const slots = (Array.isArray(deferredOutputs) ? deferredOutputs : [])
        .map((o) => ({ address: String(o.address), value: o.value, consumed: false }));
    const unexpected = [];
    let markers = 0;
    for (let i = 0; i < revealOutputs.length; i += 1) {
        const out = revealOutputs[i] || {};
        // An approved payment: address and exact amount, each slot used once.
        const slot = slots.find((s) => !s.consumed && s.address === out.address && sameSats(s.value, out.value));
        if (slot) { slot.consumed = true; continue; }
        // The surplus sweep or floor pad, back to an address the wallet holds.
        if (out.address && own.has(String(out.address))) continue;
        // The one zero-value marker; a second, a valued or a longer OP_RETURN is refused.
        if (markers === 0 && isRevealMarker(out, encoding) && sameSats(out.value, 0)) { markers += 1; continue; }
        unexpected.push({ index: i, address: out.address ?? null, value: out.value, scriptType: out.scriptType });
    }
    const missing = slots.filter((s) => !s.consumed).map((s) => ({ address: s.address, value: s.value }));
    if (unexpected.length === 0 && missing.length === 0) return null;
    const reason = unexpected.length > 0
        ? `pays ${unexpected.length} output${unexpected.length === 1 ? '' : 's'} you did not approve`
        : `leaves out ${missing.length} payment${missing.length === 1 ? '' : 's'} you approved`;
    return { reason, unexpected, missing };
}

/**
 * Refuse, before signing, a reveal whose outputs do not pay exactly what the
 * user approved. A reveal that cannot be decomposed is refused the same way.
 *
 * @param {{ decomposePsbt: (hex: string) => { outputs: unknown }, revealPsbtHex: string,
 *   deferredOutputs: Array<{ address: string, value: string | number }>, ownAddresses: Iterable<string>,
 *   phase1Txid: string, phase1TxHex: string, chainId: string, encoding: string }} args
 */
export function assertRevealPaysApprovedOutputs({
    decomposePsbt, revealPsbtHex, deferredOutputs, ownAddresses, phase1Txid, phase1TxHex, chainId, encoding,
}) {
    let revealOutputs = null;
    try { revealOutputs = decomposePsbt(revealPsbtHex).outputs; } catch { revealOutputs = null; }
    const refusal = revealOutputsRefusal({ revealOutputs, deferredOutputs, ownAddresses, encoding });
    if (refusal) throw new RevealOutputsRefusedError({ ...refusal, phase1Txid, phase1TxHex, chainId, encoding });
}
