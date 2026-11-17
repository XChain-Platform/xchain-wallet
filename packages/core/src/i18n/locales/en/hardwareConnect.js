// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `hardwareConnect.*` keys: the three-step connect
// flow for a hardware wallet (Choose, Connect, Accounts), plus the device
// card and step status line the sign and manage pages share with it.

import { addEnglish } from '../../store.js';

const messages = {
    // Page header, one title for every step.
    'hardwareConnect.title': 'Hardware Wallet',
    'hardwareConnect.step': 'Step {step} of 3: {name}',
    'hardwareConnect.step.choose': 'Choose',
    'hardwareConnect.step.connect': 'Connect',
    'hardwareConnect.step.accounts': 'Accounts',
    'hardwareConnect.openInTab': 'Open in tab',

    // Step 1: Choose.
    'hardwareConnect.choose.formLabel': 'Choose hardware wallet',
    'hardwareConnect.choose.noticeLead': 'Your keys stay on your hardware wallet.',
    'hardwareConnect.choose.notice': 'This wallet only reads addresses and asks the hardware wallet to sign.',
    'hardwareConnect.choose.listLabel': 'Hardware wallets',
    'hardwareConnect.vendor.trezor': 'Trezor',
    'hardwareConnect.vendor.ledger': 'Ledger',
    'hardwareConnect.vendor.other': 'hardware wallet',
    'hardwareConnect.vendor.trezorModels': 'Safe 3, Safe 5, Model T, Model One',
    'hardwareConnect.vendor.ledgerModels': 'Nano S Plus, Nano X, Stax, Flex',
    'hardwareConnect.vendor.unavailable': 'Not available in this app.',
    'hardwareConnect.vendor.webHidFirefox': "Needs WebHID, which Firefox doesn't have. Use Chrome, Edge or Brave.",
    'hardwareConnect.vendor.webHidSafari': "Needs WebHID, which Safari doesn't have. Use Chrome, Edge or Brave.",
    'hardwareConnect.vendor.webHidOther': "Needs WebHID, which this browser doesn't have. Use Chrome, Edge or Brave.",

    // Step 2: Connect.
    'hardwareConnect.connect.formLabel': 'Connect hardware wallet',
    'hardwareConnect.connect.statusLabel': 'Connection progress',
    'hardwareConnect.connect.pluggedIn': 'Plugged in',
    'hardwareConnect.connect.unlock': 'Unlock',
    'hardwareConnect.connect.allow': 'Allow XChain',
    'hardwareConnect.connect.optionsLabel': 'Connection options',
    'hardwareConnect.connect.tryAgain': 'Try again',
    'hardwareConnect.connect.tryAgainLine': 'Look for the hardware wallet again',
    'hardwareConnect.connect.help': 'Help with connecting',
    'hardwareConnect.connect.helpLine': 'Cable, PIN and browser tips',
    'hardwareConnect.connect.continue': 'Continue',
    'hardwareConnect.help.formLabel': 'Help with connecting',
    'hardwareConnect.help.lead': "If your {vendor} isn't found:",
    'hardwareConnect.help.cable': 'Use a data cable plugged straight into this computer, not through a hub.',
    'hardwareConnect.help.pin': 'Unlock the {vendor} with its PIN and keep it on its home screen.',
    'hardwareConnect.help.ledgerApp': 'Open the app for the network you want on the Ledger, such as Bitcoin.',
    'hardwareConnect.help.trezorPopup': 'Approve the connection in the Trezor Connect window when it opens.',
    'hardwareConnect.help.otherApps': 'Close Trezor Suite, Ledger Live and any other wallet tab that may hold the device.',
    'hardwareConnect.help.browser': 'Use Chrome, Edge or Brave on a computer, and allow the device when the browser asks.',

    // Connection errors, in plain words.
    'hardwareConnect.error.notFound': 'No {vendor} was found. Plug it in and unlock it, then try again.',
    'hardwareConnect.error.locked': 'Your {vendor} is locked. Enter the PIN on it, then try again.',
    'hardwareConnect.error.ledgerApp': "The Bitcoin app isn't open on your Ledger. Open it on the Ledger, then try again.",
    'hardwareConnect.error.busy': 'Another app or browser tab is using this {vendor}. Close {tool} and any other wallet tab, then try again.',
    'hardwareConnect.error.cancelled': 'The connection was not allowed. Approve it on your {vendor} and in any browser prompt, then try again.',
    'hardwareConnect.error.generic': "Couldn't connect your {vendor}. Plug it in and unlock it, then try again.",
    'hardwareConnect.error.firmware': 'This {vendor} firmware is too old. Update it with {tool}, plug it in again, then try again.',
    'hardwareConnect.error.firmwareVersion': 'This {vendor} firmware is too old. Update it to version {version} or newer with {tool}, plug it in again, then try again.',
    // The link under a firmware notice; a label, not a sentence.
    'hardwareConnect.updateLink': 'Open the update tool',

    // Step 3: Accounts.
    'hardwareConnect.accounts.formLabel': 'Add hardware wallet',
    'hardwareConnect.accounts.name': 'Wallet name',
    'hardwareConnect.accounts.nameHelp': 'Shows in your wallet list. You can change it later.',
    'hardwareConnect.accounts.nameRequired': 'Enter a wallet name.',
    'hardwareConnect.accounts.defaultName': 'My {vendor}',
    // Three views of one account model (G131): Networks, Accounts, Addresses.
    'hardwareConnect.accounts.tabsLabel': 'Networks, accounts and addresses',
    'hardwareConnect.accounts.networksTab': 'Networks',
    'hardwareConnect.accounts.accountsTab': 'Accounts',
    // The Addresses tab reuses home.addresses; Add Account reuses accountPicker.add.
    'hardwareConnect.accounts.networksLabel': 'Networks',
    'hardwareConnect.accounts.accountsLabel': 'Accounts found',
    // An account row's line: "5 addresses on 3 networks".
    'hardwareConnect.accounts.accountCounts': '{addresses} on {networks}',
    'hardwareConnect.accounts.addressCountOne': '1 address',
    'hardwareConnect.accounts.addressCountMany': '{count} addresses',
    'hardwareConnect.accounts.networkCountOne': '1 network',
    'hardwareConnect.accounts.networkCountMany': '{count} networks',
    'hardwareConnect.accounts.addressesEmpty': 'No addresses to show',
    'hardwareConnect.accounts.addressesEmptyBody': 'Turn on a network and an account to see their addresses.',
    'hardwareConnect.accounts.nothingSelected': 'Turn on at least one network and one account.',
    'hardwareConnect.accounts.notSupported': 'Not supported',
    'hardwareConnect.accounts.supportedBy': 'Supported by {device}',
    'hardwareConnect.accounts.notSupportedBy': 'Not supported by {device}',
    'hardwareConnect.accounts.networkName': '{name} {network}',
    'hardwareConnect.accounts.accountName': 'Account {number}',
    'hardwareConnect.accounts.amount': '{amount} {ticker}',
    'hardwareConnect.accounts.finding': 'Finding accounts on your {vendor}.',
    'hardwareConnect.accounts.none': "No accounts yet. Your {device} doesn't sign on any network shown here.",
    'hardwareConnect.accounts.findFailed': "Couldn't read accounts from your {vendor}. Check that it's plugged in and unlocked, then try again.",
    // A Ledger network whose app is not open yet: one line in its row, then
    // Try again once the user opens {app} ("Litecoin", "Bitcoin Test").
    'hardwareConnect.accounts.openApp': 'Open the {app} app on your Ledger',
    'hardwareConnect.accounts.openAppAny': 'Open the app for this network on your Ledger',
    // The accessible name of a row's Try Again button; it starts with the
    // visible label so speech input can say it.
    'hardwareConnect.accounts.tryAgainOn': 'Try Again on {network}',
    'hardwareConnect.accounts.differentDevice': 'This is a different Ledger. Connect the one you started with, then try again.',
    // Add Account's line: it adds the next account number, on every network that is on.
    'hardwareConnect.accounts.addAccountLine': 'The next account, on every network that is on',
    'hardwareConnect.accounts.addWallet': 'Add Wallet',
    'hardwareConnect.accounts.saveFailed': "Couldn't add the wallet. Try again.",
    'hardwareConnect.accounts.saveUnavailable': "This app can't add a hardware wallet yet.",
    // Back from the Set Password page that follows step 3 on a fresh install.
    'hardwareConnect.accounts.backToAccounts': 'Back to accounts',

    // Device card status pill (shared with the sign and manage pages).
    'hardwareConnect.device.found': 'Found by USB',
    'hardwareConnect.device.connected': 'Connected',
    'hardwareConnect.device.notConnected': 'Not connected',
    'hardwareConnect.device.unlock': 'Unlock your {vendor}',

    // Step status line (shared with the sign page).
    'hardwareConnect.statusLine.label': 'Progress',
    'hardwareConnect.statusLine.done': '{label}: done',
    'hardwareConnect.statusLine.active': '{label}: in progress',
    'hardwareConnect.statusLine.todo': '{label}: not started',
    'hardwareConnect.statusLine.failed': '{label}: failed',
};

addEnglish(messages);

export default messages;
