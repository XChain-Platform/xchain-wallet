// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `hardwareSign.*` keys: the page shown while a
// hardware wallet signs, plus the device line on the Confirm page. Words the
// app already has (Confirm, Unlock, Signed, Try again) reuse their keys.

import { addEnglish } from '../../store.js';

const messages = {
    // Sign page.
    'hardwareSign.title': 'Sign on {vendor}',
    'hardwareSign.backToConfirm': 'Back to Confirm',
    'hardwareSign.heading': 'Confirm on your {vendor}',
    'hardwareSign.checkSend': 'Check the amount and address on its screen',
    'hardwareSign.checkMessage': 'Check the message on its screen',
    // A Ledger signs regtest in its Bitcoin Test app, which writes testnet
    // (tb1) addresses where the wallet shows bcrt1 for the same key.
    'hardwareSign.ledgerRegtestPrefix': 'Your Ledger shows this address starting with tb1.',
    'hardwareSign.statusLabel': 'Signing progress',
    'hardwareSign.step.device': 'Device',
    'hardwareSign.failed.unplugged': "Your {vendor} isn't connected. Plug it in and unlock it.",
    'hardwareSign.failed.rejected': 'Signing was rejected on your {vendor}. Nothing was signed.',
    'hardwareSign.failed.timeout': "Your {vendor} didn't answer in time. Nothing was signed.",
    'hardwareSign.failed.other': "Your {vendor} couldn't sign. Nothing was signed.",
    // A Ledger has one app per coin; {app} is the one the chain needs.
    'hardwareSign.failed.wrongApp': 'Open the {app} app on your Ledger, then try again.',
    'hardwareSign.failed.wrongAppAny': 'Open the app for this network on your Ledger, then try again.',

    // Device line on the Confirm page.
    'hardwareSign.notConnected': "Your {vendor} isn't connected yet. Plug it in and unlock it, then select Approve to connect it.",
};

addEnglish(messages);

export default messages;
