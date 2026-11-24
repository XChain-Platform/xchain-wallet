// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { injectApprovalAdapter } from '@xchain-wallet/core/shared/approval/index.js';

// The shared approval screens call these through core; the web shell answers
// them over the same host routes the extension approval window uses, backed
// by the in-app approvals the host bridge was built with.
export function createWebApprovalAdapter(send) {
    return {
        listWallets: () => send('wallet.list'),
        fetchApproval: (id) => send('approval.fetch', { id }),
        resolveApproval: (id, result) => send('approval.resolve', { id, result }),
        getAddressBalances: (chainId, address) => send('balances.address', { chainId, address }),
        getTokenInfo: (req) => send('token.info', req),
        getAddressesByChain: (walletId, accountId) => send('addresses.byChain', { walletId, accountId }),
        getSettings: () => send('settings.get'),
        parsePsbt: (opts) => send('psbt.parse', opts),
        requoteNativeFee: (opts) => send('action.requoteNativeFee', opts),
        preflight: (opts) => send('action.preflight', opts),
        describeAction: (opts) => send('action.describe', opts),
        parseCoSign: (opts) => send('coSign.parse', opts),
    };
}

export function installWebApprovalAdapter(send) {
    injectApprovalAdapter(createWebApprovalAdapter(send));
}
