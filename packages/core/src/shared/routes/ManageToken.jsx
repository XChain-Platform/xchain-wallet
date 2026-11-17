// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The `manage-token` route, opened from My Tokens. It reuses TokenDetail's
// tabs and issuer groups, but ownerView replaces the browse page's balance
// hero with the token identity card used for this management surface.

import { TokenDetail } from './TokenDetail.jsx';

export { normalizeGenesisRow } from '../components/TokenOwnerActions.jsx';

/** The issuer handler props this route takes, as the shells wire them. */
export const MANAGE_TOKEN_HANDLER_NAMES = [
    'onIssueSubtoken',
    'onMint',
    'onDestroy',
    'onLock',
    'onMintSettings',
    'onCallbackSettings',
    'onExecuteCallback',
    'onAccessLists',
    'onUseSharedBlockList',
    'onBridgeSettings',
    'onPauseToken',
    'onUpdateDescription',
    'onAttachContent',
    'onGatedContent',
    'onManageRoster',
    'onTransferOwnership',
    'onSellOwnership',
    'onCreateDispenser',
    'onPayDividend',
    'onAirdrop',
    'onBroadcast',
    'onBindController',
    'onUnbindController',
];

/**
 * The management page for one token, opened from My Tokens: a plain token
 * identity card, then Actions, Details and History, with the issuer's action
 * groups in Actions and their facts in Details.
 *
 * Takes TokenDetail's props plus the issuer handlers named above (onMint,
 * onLock, ...), each called with `{ issuer }`.
 */
export function ManageToken(props) {
    const manageActions = {};
    const pageProps = {};
    for (const [name, value] of Object.entries(props)) {
        if (MANAGE_TOKEN_HANDLER_NAMES.includes(name)) manageActions[name] = value;
        else pageProps[name] = value;
    }
    return (
        <TokenDetail
            kind="token"
            {...pageProps}
            manageActions={manageActions}
            ownerView
        />
    );
}
