// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `shell.*` keys, loaded at startup by i18n/index.js.

import { addEnglish } from '../../store.js';

const messages = {
    // --- shell ---------------------------------------------------
    'shell.markets.selectAsset': 'Select coin or token',
    'shell.markets.back': 'Back to markets',
    'shell.settings.back': 'Back to settings',
    'shell.privateKeyQr': 'Private key QR',
    'shell.messageSent': 'Message sent',
    'shell.cannotOpenLink': "Can't open link",
    'shell.waitingLinkDropped': 'The waiting payment link was dropped.',
    'shell.dismiss': 'Dismiss notice',
    'shell.unknownState': 'unknown state "{state}"',

    // Copy moved out of JSX literals by the i18n sweep.
    'shell.header.appHeader': 'App header',
    'shell.settingsButton.walletSettings': 'Wallet settings',
    'shell.settingsButton.chooseWallet': 'Choose wallet',
    'shell.settingsButton.noWallet': 'No wallet',
    'shell.settingsButton.account': 'Account',
    'shell.settingsButton.chooseAccount': 'Choose account',
    'shell.settingsButton.account1': 'Account 1',
    'shell.settingsButton.activeNetworkInHeader': 'Active network in header',
    'shell.settingsButton.chainFilter': 'Network filter',
    'shell.settingsButton.allSettings': 'All settings',
    'shell.devVariantBadge.devVariant': 'Dev variant: {variant}',
    'shell.devVariantBadge.dragToMove': 'Drag to move',
    'shell.devVariantBadge.variant': 'variant',
    'shell.devVariantBadge.thresholdPx': 'Threshold: {THRESHOLD_PX}px',
    'shell.devVariantBadge.pickVariant': 'Pick variant',
    'shell.devVariantBadge.autoByViewport': 'auto · by viewport',
    'shell.devVariantBadge.smallMobile': 'small · mobile',
    'shell.devVariantBadge.fullDesktop': 'full · desktop',
    'shell.devVariantBadge.sidebarChromePanel': 'sidebar · chrome panel',
    'shell.devVariantBadge.extensionChromePopup': 'extension · chrome popup',
    'shell.platformLinks.main': 'Main site',
    'shell.platformLinks.docs': 'Documentation',
    'shell.platformLinks.encoder': 'Encoder status',
    'shell.platformLinks.sync': 'Bootstraps & sync',
    'shell.platformLinks.hub': 'Validator hub',
    'shell.platformLinks.mcp': 'MCP for agents',
    'shell.headerMenu.manageAddresses': 'Manage addresses',
    'shell.headerMenu.moreWalletActions': 'More wallet actions',
    'shell.header.walletPrefix': 'Wallet: ',
};

addEnglish(messages);

export default messages;
