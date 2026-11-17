// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy from later namespaces that first-paint modules render. It
// loads at startup with i18n/index.js so the first screens never show a raw
// key; the rest of each namespace loads with the screens that use it.

import { addEnglish } from '../../store.js';

const messages = {
    'adsNotice.continue': 'Continue',
    'settings.saveFailed': "Couldn't save this setting. Try again.",
    'settings.network.label': 'Network',
    'settings.network.switchTitle': 'Switch to {network}?',
    'settings.network.switchMessage':
        'The wallet will reload and show {nextNetwork} networks. Your {currentNetwork} balances and network settings stay unchanged. Unlock the wallet again after it reloads.',
    'settings.network.switching': 'Switching networks. This can take a moment.',
    'alerts.notificationsTitle': 'Notifications',
    'walletDetails.exitDemo': 'Exit demo & wipe',
    // The same action on a button, where labels are Title Case.
    'walletDetails.exitDemoAction': 'Exit Demo & Wipe',
    'walletPicker.add': 'Add Wallet',
    'importWallet.title': 'Import Wallet',

    // --- send -----------------------------------------------------
    'send.title': 'Send',
    'send.recipient.remove': 'Remove',

    // --- extension banner ----------------------------------------
    'extensionBanner.activeTitle': 'Using your extension wallet.',
    'extensionBanner.activeBody':
        'Signing and account access route through the XChain Wallet extension on this site.',
    'extensionBanner.switchBack': 'Switch Back',
    'extensionBanner.detectedTitle': 'XChain Wallet extension detected.',
    'extensionBanner.detectedBody':
        'Use your extension wallet on this site instead of the web app.',
    'extensionBanner.connecting': 'Connecting…',
    'extensionBanner.useExtension': 'Use Extension Wallet',
    'extensionBanner.dismissLabel': 'Dismiss extension notice',
    'extensionBanner.notNow': 'Not Now',

    // --- xchain: URI intent labels (Cluster L FOLLOWUP 5) ---------
    'uri.intent.send': 'Send',
    'uri.intent.sendTo': 'Send to {address}',
    'uri.intent.sendToken': 'Send {tick}',
    'uri.intent.sendAssetTo': 'Send {tick} to {address}',
    'uri.intent.sendAmount': 'Send {amount} {tick}',
    'uri.intent.sendAmountTo': 'Send {amount} {tick} to {address}',
    'uri.intent.receive': 'Receive',
    'uri.intent.receiveAt': 'Receive at {address}',
    'uri.intent.receiveAsset': 'Receive {tick}',
    'uri.intent.receiveAssetAt': 'Receive {tick} at {address}',
    'uri.intent.receiveAmount': 'Receive {amount} {tick}',
    'uri.intent.receiveAmountAt': 'Receive {amount} {tick} at {address}',
    'uri.intent.execute': 'Call Contract #{contract}', // Feeds the Execute page title.
    'uri.intent.executeMethod': 'Call {method} on contract #{contract}',
    'uri.intent.unknown': 'Unrecognized link',

    // --- scan route (Cluster R FOLLOWUP 2: i18n migration beachhead) -
    'scan.title': 'Scan',

    // --- history --------------------------------------------------
    'history.title': 'History',
    'history.detail.openNewWindow': 'Open in New Window',
    'pending.detail.technicalDetails': 'Technical details',


    // --- errors ---------------------------------------------------
    // --- flow status and error copy -------------------------------
    'flows.biometric.browserUnsupported': "This browser doesn't support the sign-in technology biometric unlock needs.",
    'flows.biometric.deviceUnavailable':
        'This device has no built-in fingerprint, face, or PIN unlock that this browser can use. Set one up in your system settings, then come back.',
    'flows.biometric.probeFailed': "This browser couldn't check whether a built-in unlock method is available.",
    'flows.biometric.genericUnavailable': "Biometric unlock isn't available on this device.",

    // Copy moved out of JSX literals by the i18n sweep.
    'settings.developer.sending': 'Sending…',
    'settings.thisWallet.wallet': 'Wallet',
    'settings.thisWallet.removing': 'Removing…',
    'routes.addressList.search': 'Search',
    'components.leftNav.primaryNavigation': 'Primary navigation',
    'components.leftNav.xchainWallet': 'XChain Wallet',
    'components.leftNav.groupWallet': 'Wallet',
    'components.leftNav.groupTrade': 'Trade',
    'components.leftNav.groupNetwork': 'Network',
    'components.leftNav.groupBuild': 'Build',
    'components.leftNav.groupSocial': 'Social',
    'components.leftNav.exchangeDex': 'Exchange (DEX)',
    'components.leftNav.myTokens': 'My Tokens',
    'components.leftNav.governance': 'Governance',
    'components.leftNav.bettingMarkets': 'Betting markets',
    'components.leftNav.footerActions': 'Wallet controls',
    'components.leftNav.openCommandPalette': 'Open the wallet menu',
    'components.leftNav.searchCmdCtrlK': 'Search the wallet menu (Cmd/Ctrl+K)',
    'components.leftNav.skipToMainContent': 'Skip to main content',
    // The side menu's three states (G100); button labels are Title Case.
    'components.leftNav.hideSideMenu': 'Hide Side Menu',
    'components.leftNav.showSideMenu': 'Show Side Menu',
    'components.leftNav.resizeSideMenu': 'Resize side menu',
    'components.leftNav.resizeSideMenuHint': 'Drag to resize, or press Home to reset.',
    'components.bottomTabBar.bottomNavigation': 'Bottom navigation',
    'components.bottomTabBar.switchWallet': 'Switch wallet',
    'components.contactsPickerScreen.contacts': 'Contacts',
    'components.queuedBroadcastBanner.waitingToSend': 'Waiting to send (',
    'components.queuedBroadcastBanner.signed': 'signed',
    'components.queuedBroadcastBanner.sendingWasInterruptedSoThis':
        "Sending was interrupted, so this may already have been sent. Sending it again is safe and can't pay twice.",
    'components.queuedBroadcastBanner.sending': 'Sending: {summary}',
    'components.queuedBroadcastBanner.sendNow': 'Send now: {summary}',
    'components.queuedBroadcastBanner.trySendingAgain': 'Try Sending Again',
    'components.queuedBroadcastBanner.sendNow2': 'Send Now',
    'components.queuedBroadcastBanner.removingFromQueue': 'Removing from queue: {summary}',
    'components.queuedBroadcastBanner.removeFromQueue': 'Remove from queue: {summary}',
    'components.routeErrorBoundary.couldNotLoadThisSection': "Couldn't load this section.",
    'components.routeErrorBoundary.goToHome': 'Go to Home',
    'components.reachabilityLine.details': 'Details',
    'components.reachabilityLine.affectedCoins': 'Affected coins',
    'components.routeErrorBoundary.thisScreenCouldNotBe': "This screen couldn't be shown",
    'components.routeErrorBoundary.somethingWentWrongWhileShowing':
        'Something went wrong while showing this screen. Try again or go to Home.',
    'components.toastHost.more': '+{hiddenCount} more',
    'components.toastHost.dismissNotification': 'Dismiss notification',
    'components.demoExitConfirm.exitDemoAndDeleteIts': 'Exit demo and delete its data?',
    'components.watchOnlyBadge.watchOnlyWallet': 'Another phone signs for this wallet',
    'components.watchOnlyBadge.watchOnly': 'Signs on another phone',
    'ui.input.capsLockIsOn': 'Caps Lock is on',
    'ui.pageHeader.backToPreviousScreen': 'Back to previous screen',
};

addEnglish(messages);

export default messages;
