// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the error and fallback states (`vaultUnavailable.*`, `routeNotFound.*`, `reachability.*`, `offline.*`, `loading.*`),
// loaded at startup by i18n/index.js.

import { addEnglish } from '../../store.js';

const messages = {
    'offline.empty.title': "You're offline",
    'reachability.notice.balances': 'Some balances may be out of date',
    'reachability.notice.degraded': 'Some information may be out of date',
    'reachability.notice.offline': "You're offline. Some information may be out of date.",

    'loading.error.title': "The wallet couldn't start.",
    'loading.error.body': "Something stopped the wallet from opening. Your wallet data hasn't been changed.",
    'loading.error.recovery':
        "Choose Try again. If the wallet still doesn't open, contact support before clearing any wallet data.",

    // --- route fallback -----------------------------------------
    'routeNotFound.title': 'Page not found',
    'routeNotFound.body': "This page doesn't exist or is no longer available.",
    'routeNotFound.backToHome': 'Back to Home',

    // --- vault unavailable --------------------------------------
    'vaultUnavailable.recoverySafe': 'Your recovery phrase still holds everything.',
    'vaultUnavailable.blockchainSafe':
        'Your coins live on the blockchain, not in this app. Anything stored here is only a copy, and your recovery phrase restores it on this device or any other.',
    'vaultUnavailable.restore': 'Restore from recovery phrase or backup',
    'vaultUnavailable.wipeWarning':
        "Don't do this unless you have your recovery phrase or an encrypted backup file to hand.",
    'vaultUnavailable.wipeConfirm': 'Type WIPE to confirm',
};

addEnglish(messages);

export default messages;
