// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The frozen list follows the protocol-fee paths in the indexer's action
// handlers. ISSUE is conditional because updating an existing token is free.
import { isNativeFeeMandatory } from '../registry/nativeFee.js';

export const FEE_BEARING_ACTIONS = Object.freeze([
    'AIRDROP',
    'BATCH',
    'BET',
    'CALLBACK',
    'DEPLOY',
    'DISPENSER',
    'DIVIDEND',
    'EXECUTE',
    'ISSUE',
    'LIST',
    'ORDER',
    'SWAP',
    'SWEEP',
    'XBRIDGE',
]);

const ACTIONS = new Set(FEE_BEARING_ACTIONS);
const DEFAULT_OPTIONS = Object.freeze({ nativeSwitch: true, unverified: false });
const BATCH_OPTIONS = Object.freeze({ nativeSwitch: false, unverified: false });
const UNVERIFIED_OPTIONS = Object.freeze({ nativeSwitch: true, unverified: true });

export function isFeeBearingAction(action, { newToken = false } = {}) {
    const name = String(action || '').trim().toUpperCase();
    if (name === 'ISSUE') return newToken === true;
    return ACTIONS.has(name);
}

export function feeSurfaceForAction(action, opts = {}) {
    return isFeeBearingAction(action, opts) ? 'feesCard' : 'networkFeeField';
}

// Keep the required native flag on chains where omitting it makes even a
// feeless action invalid, without exposing a fee-mode choice for that action.
export function nativeFeeForFeelessAction(chainOrCoin) {
    const mandatory = isNativeFeeMandatory(chainOrCoin);
    return {
        payFeeInNativeCoin: mandatory,
        flag: mandatory || undefined,
        mandatory,
    };
}

export function feeCardOptionsForAction(action, opts = {}) {
    if (!isFeeBearingAction(action, opts)) return null;
    const name = String(action || '').trim().toUpperCase();
    if (name === 'BATCH') return BATCH_OPTIONS;
    if (name === 'DEPLOY' || name === 'EXECUTE') return UNVERIFIED_OPTIONS;
    return DEFAULT_OPTIONS;
}
