// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `hardwareManage.*` keys: a hardware wallet's own
// Wallet Details page and its Unlink page. Words the app already has
// (Accounts, Name, Status, Add account, Connected) reuse their keys.

import { addEnglish } from '../../store.js';

const messages = {
    // Actions tab.
    'hardwareManage.actionsList': 'Hardware wallet actions',
    'hardwareManage.setActive': 'Set as active wallet',
    'hardwareManage.reconnect': 'Reconnect',
    'hardwareManage.reconnectLine': 'Plug in and unlock to use it again',
    'hardwareManage.rename': 'Rename',
    'hardwareManage.renameLine': 'Change the name shown in this app',
    // The Accounts row opens the shared My Accounts page (G131).
    'hardwareManage.accountsLine': 'See, add and edit its accounts',
    'hardwareManage.unlink': 'Unlink',
    'hardwareManage.unlinkLine': 'Remove it from this app, coins stay safe',

    // Details tab: the Device Access note, then the facts.
    'hardwareManage.detail.added': 'Added to this app',
    'hardwareManage.status.unlock': 'Needs unlocking',
    'hardwareManage.balancesTitle': 'Device Access',
    'hardwareManage.balancesNote': 'Balances show without the device; sending needs it plugged in.',
    // Add network, on a hardware account's Account Details, Addresses tab:
    // one row per network the device signs on the wallet's network setting
    // that the account does not have yet.
    'hardwareManage.addNetworkTitle': 'Add a Network',
    'hardwareManage.addNetworkList': 'Networks to add',
    'hardwareManage.addNetworkRow': 'Add {network}',
    'hardwareManage.addNetworkLine': 'Read its address from your {vendor}',
    'hardwareManage.addNetworkReading': 'Reading from your {vendor}.',
    'hardwareManage.addNetworkFailed': "Couldn't read it from your {vendor}. Check that it's plugged in and unlocked, then try again.",
    // Add account on a Ledger: the networks whose app was not open.
    'hardwareManage.waitingTitle': 'Waiting Networks',
    'hardwareManage.waitingList': 'Networks waiting for their app',
    'hardwareManage.waitingNoticeTitle': 'Account Added',
    'hardwareManage.waitingLine': '{nameState, select, named {{name}} other {The account}} is added. Open each app below on your Ledger to add its network, or add it later from the account\'s Addresses tab.',

    // Unlink page: the title is also the one button's label.
    'hardwareManage.unlinkTitle': 'Unlink Wallet',
    'hardwareManage.unlinkNoticeTitle': 'Coins Stay Safe',
    'hardwareManage.unlinkNoticeOne': 'This removes {name} and its 1 account from this app. Your coins stay on the {vendor}; connect it again any time to see them.',
    'hardwareManage.unlinkNoticeMany': 'This removes {name} and its {count} accounts from this app. Your coins stay on the {vendor}; connect it again any time to see them.',
    'hardwareManage.unlinkFailed': "Couldn't unlink this wallet. Try again.",
    'hardwareManage.unlinkUnavailable': "Unlinking isn't available in this app.",
};

addEnglish(messages);

export default messages;
