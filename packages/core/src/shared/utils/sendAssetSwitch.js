// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Send's "Change asset" round trip through the send-picker route. Send hands
// its in-progress draft over, the picker either applies a new asset or is
// backed out of, and both ways land on Send again: the picker is a step of
// Send, so its Back returns to Send with the draft intact, never to Home.
// The three shells share these so their prefill handling cannot drift.

const sameTick = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();

/**
 * Prefill while the picker is open: whatever Send was opened with, plus the
 * draft Send carried out.
 *
 * @param {object | null} prev
 * @param {{ chainId: string | null, tick: string, address: string, amount: string, feeSelection?: object }} carry
 */
export function beginSendAssetSwitch(prev, carry) {
    return { ...prev, assetSwitchNotice: undefined, assetSwitchDraft: carry };
}

/**
 * Prefill after backing out of the picker: the draft Send carried out,
 * unchanged, over what Send was opened with.
 *
 * @param {object | null} prev
 */
export function cancelSendAssetSwitch(prev) {
    // The draft carries chainId, tick, address, amount and feeSelection.
    return prev?.assetSwitchDraft
        ? { ...prev, ...prev.assetSwitchDraft, assetSwitchDraft: undefined, assetSwitchNotice: undefined }
        : prev || null;
}

/**
 * Prefill after picking an asset. The recipient and fee survive a token
 * change on the same chain, the amount survives only the same token, and a
 * notice says what was reset.
 *
 * @param {object | null} prev
 * @param {{ chainId: string, tick: string, kind?: string, displayName?: string, imageUrl?: string | null }} sel
 */
export function applySendAssetPick(prev, sel) {
    const draft = prev?.assetSwitchDraft;
    const sameChain = draft?.chainId === sel.chainId;
    const sameToken = sameChain && sameTick(draft?.tick, sel.tick);
    let assetSwitchNotice;
    if (draft && !sameChain) assetSwitchNotice = 'Network changed. Recipient, amount, and fee rate were reset.';
    else if (draft && !sameToken) assetSwitchNotice = 'Token changed. Amount was reset for the new token precision.';
    return {
        chainId: sel.chainId,
        tick: sel.tick,
        kind: sel.kind,
        displayName: sel.displayName,
        imageUrl: sel.imageUrl,
        address: sameChain ? (draft.address || undefined) : undefined,
        amount: sameToken ? (draft.amount || undefined) : undefined,
        feeSelection: sameChain ? draft.feeSelection : undefined,
        assetSwitchNotice,
    };
}
