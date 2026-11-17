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
    'reachability.notice.offline': "You're offline. Some information may be out of date.",

    'loading.opening': 'Opening your wallet',
    'loading.failure.title': 'Wallet Unavailable',
    'loading.error.body': 'Your wallet data is safe and unchanged. Try again, or restart the app.',

    // --- route fallback -----------------------------------------
    'routeNotFound.title': 'Page Not Found',
    'routeNotFound.emptyTitle': "That page isn't here",
    'routeNotFound.body': "This page doesn't exist or is no longer available.",

    // --- vault unavailable --------------------------------------
    'vaultUnavailable.title': "Your wallet couldn't be opened",
    'vaultUnavailable.locked.body':
        "Your wallet is still in storage on this device, but it couldn't be read because the device's secure storage stays locked until you unlock the device itself.",
    'vaultUnavailable.corrupt.body':
        "Your wallet is still in storage on this device, but it couldn't be read because the stored wallet file is damaged, and trying again won't repair it.",
    'vaultUnavailable.unavailable.body':
        "Your wallet is still in storage on this device but couldn't be read because the device's secure storage couldn't be reached. This is usually temporary.",
    'vaultUnavailable.evicted.body':
        "Your wallet's encrypted data is no longer in storage in this browser because the browser removed it. The wallet did not remove it: browsers can clear site data when storage runs low, when a clear-on-exit or privacy setting is on, when a cleanup tool runs, and Safari clears it after seven days without a visit. Install the wallet app or add this site to your home screen to help prevent this happening again.",
    'vaultUnavailable.recoverySafe': 'Your recovery phrase still holds everything.',
    'vaultUnavailable.blockchainSafe':
        'Your coins live on the blockchain, not in this app. Anything stored here is only a copy, and your recovery phrase restores it on this device or any other.',
    // The recovery action list (G101): sentence-case row titles, one line each.
    'vaultUnavailable.actions.label': 'Recovery actions',
    'vaultUnavailable.actions.retry.title': 'Try again',
    'vaultUnavailable.actions.retry.description': 'Open the wallet on this device again',
    'vaultUnavailable.actions.restore.title': 'Restore from recovery phrase or backup',
    'vaultUnavailable.actions.restore.description': 'Clear the unreadable data, then import your wallet again',
    'vaultUnavailable.actions.reset.title': 'Reset this wallet',
    'vaultUnavailable.actions.reset.description': 'Finish the reset, then import your wallet again',
    'vaultUnavailable.wipeWarning':
        "Don't do this unless you have your recovery phrase or an encrypted backup file to hand.",
    'vaultUnavailable.wipeConfirm': 'Type WIPE to confirm',

    // --- incomplete wallet data (meta without the vault) ---------
    'vaultUnavailable.incomplete.title': 'This wallet’s data is incomplete',
    'vaultUnavailable.incomplete.body':
        "Part of the wallet stored on this device is missing, so it can't be opened, and a new wallet can't be set up over what is left. A reset that stopped part way leaves it like this.",
    'vaultUnavailable.incomplete.nextStep':
        'Reset this wallet, then restore it from your recovery phrase or an encrypted backup.',
    'vaultUnavailable.incomplete.reset': 'Reset This Wallet',
    'vaultUnavailable.incomplete.region': 'Clear what is left of this wallet',
    'vaultUnavailable.incomplete.note':
        'This clears what is left of the wallet on this device so you can restore it from its recovery phrase or an encrypted backup. It changes nothing on the blockchain.',
    'vaultUnavailable.incomplete.failed':
        "Couldn't reset this wallet. Try again, or restart the app and try once more.",
};

addEnglish(messages);

export default messages;
