// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const ADAPTER_METHODS = [
    'listWallets',
    'fetchApproval',
    'resolveApproval',
    'getAddressBalances',
    'getTokenInfo',
    'getAddressesByChain',
    'getSettings',
    'parsePsbt',
    'requoteNativeFee',
    'preflight',
    'describeAction',
    'parseCoSign',
];

let approvalAdapter = null;

export function injectApprovalAdapter(adapter) {
    if (!adapter || typeof adapter !== 'object') {
        throw new TypeError('Approval adapter must be an object.');
    }
    for (const method of ADAPTER_METHODS) {
        if (typeof adapter[method] !== 'function') {
            throw new TypeError(`Approval adapter is missing ${method}().`);
        }
    }
    approvalAdapter = adapter;
}

function invoke(method, args) {
    if (!approvalAdapter) {
        throw new Error('Approval adapter has not been injected.');
    }
    return approvalAdapter[method](...args);
}

export const listWallets = (...args) => invoke('listWallets', args);
export const fetchApproval = (...args) => invoke('fetchApproval', args);
export const resolveApproval = (...args) => invoke('resolveApproval', args);
export const getAddressBalances = (...args) => invoke('getAddressBalances', args);
export const getTokenInfo = (...args) => invoke('getTokenInfo', args);
export const getAddressesByChain = (...args) => invoke('getAddressesByChain', args);
export const getSettings = (...args) => invoke('getSettings', args);
export const parsePsbt = (...args) => invoke('parsePsbt', args);
export const requoteNativeFee = (...args) => invoke('requoteNativeFee', args);
export const preflight = (...args) => invoke('preflight', args);
export const describeAction = (...args) => invoke('describeAction', args);
export const parseCoSign = (...args) => invoke('parseCoSign', args);
