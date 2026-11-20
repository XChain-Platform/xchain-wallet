// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Keep confirmation presentation bound to the exact request handed to compose.
 * Arrays and nested request fields are copied so later form edits cannot alter
 * the snapshot while compose is pending.
 */
export function createSendConfirmSnapshot({
    sendBase,
    sendTotals,
    isMultiSend,
    isNativeSend,
    coinControlEnabled,
    coinControlLabel,
    feeEstimateAmount,
}) {
    return {
        chainId: sendBase.chainId,
        fromAddress: sendBase.from?.address || null,
        to: sendBase.to,
        tick: sendBase.tick,
        amount: sendBase.amount,
        memo: sendBase.memo,
        rbf: sendBase.rbf === true,
        changeAddress: sendBase.change || null,
        legs: Array.isArray(sendBase.legs) ? sendBase.legs.map((leg) => ({ ...leg })) : null,
        totals: Array.isArray(sendTotals) ? sendTotals.map((total) => ({ ...total })) : [],
        isMultiSend: isMultiSend === true,
        isNativeSend: isNativeSend === true,
        coinControlEnabled: coinControlEnabled === true,
        coinControlLabel: coinControlLabel || '',
        feeEstimateAmount: feeEstimateAmount == null ? null : String(feeEstimateAmount),
    };
}
