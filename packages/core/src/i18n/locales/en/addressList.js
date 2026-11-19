// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `addressList.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'addressList.balanceCheckWarning': "The balance couldn't be checked. This address may hold coins.",
    'addressList.hidden.show':
        '{count, plural, one {Show # Hidden Address} other {Show # Hidden Addresses}}',
    'addressList.hidden.hide':
        '{count, plural, one {Hide # Hidden Address} other {Hide # Hidden Addresses}}',
    'addressList.group.imported': 'Imported keys',
    'addressList.pagination':
        '{shown, number} of {total, plural, one {# address} other {# addresses}} shown',
    'addressList.wifNetworkHelp': 'The coin network this private key belongs to. The imported address joins this account on that network.',
    'addressList.wifTypeHelp': 'The address format this key is imported as. One key gives a different address in each format, so pick the one that holds your coins.',
    'addressList.wifKeyHelp': 'The private key in WIF form, as exported from another wallet. It stays encrypted in this wallet and signs for the imported address.',
    'addressList.wifLabelHelp': 'Optional. A name for the imported address, shown in your address list so you can tell it apart.',
    'addressList.wifAckHelp':
        'This address comes from the key, not from this wallet\'s recovery phrase, so restoring the phrase won\'t bring it back. Keep the key backed up on its own.',
    // View Address (the identity card, its Actions and Details tabs, Edit label).
    'addressList.detail.title': 'View Address',
    'addressList.detail.card': 'Address',
    'addressList.detail.unlabelled': 'Address',
    'addressList.detail.qr': 'QR code for this address',
    'addressList.detail.copy': 'Copy Address',
    'addressList.detail.copied': 'Copied',
    'addressList.detail.view': 'Address view',
    'addressList.detail.actions': 'Actions',
    'addressList.detail.details': 'Details',
    'addressList.detail.receive': 'Receive',
    'addressList.detail.editLabel': 'Edit label',
    'addressList.detail.onChainPrefs': 'On-chain prefs',
    'addressList.detail.hide': 'Hide',
    'addressList.detail.unhide': 'Unhide',
    'addressList.detail.setActive': 'Set active',
    'addressList.detail.switching': 'Switching…',
    'addressList.detail.secretKey': 'Secret key',
    'addressList.detail.watchOnlyLocked': 'No key in this wallet',
    'addressList.detail.explorer': 'Explorer',
    'addressList.detail.delete': 'Delete',
    'addressList.detail.deleting': 'Deleting…',
    // One line under each action row saying what it does (G101).
    'addressList.detail.receiveDescription': 'Show this address and its QR to get paid',
    'addressList.detail.editLabelDescription': 'Give this address a name you will recognise',
    'addressList.detail.onChainPrefsDescription': 'Set its fee, memo and dispenser rules on chain',
    'addressList.detail.hideDescription': 'Leave it out of the address list',
    'addressList.detail.unhideDescription': 'Show it in the address list again',
    'addressList.detail.setActiveDescription': 'Send and receive from this address',
    'addressList.detail.secretKeyDescription': 'Reveal the private key behind this address',
    'addressList.detail.explorerDescription': 'Open this address on the block explorer',
    'addressList.detail.deleteDescription': 'Take this address out of the wallet',
    'addressList.detail.network': 'Network',
    'addressList.detail.balance': 'Balance',
    'addressList.detail.type': 'Type',
    'addressList.detail.addressFormat': 'Address format',
    'addressList.detail.addressFormatHelp':
        'This controls how the address begins and which services can send to it. Some older services can\'t use newer formats.',
    'addressList.detail.derivationPath': 'Account path',
    'addressList.detail.derivationPathHelp':
        'Where this account sits inside your recovery phrase. Different paths produce different addresses from the same phrase. This is a technical detail you rarely need to change.',
    'addressList.detail.multisig': 'Multisig',
    'addressList.detail.preferences': 'On-chain preferences',
    'addressList.detail.protocolFee': 'Protocol fee',
    'addressList.detail.incomingSends': 'Incoming sends',
    'addressList.detail.dispensers': 'Dispensers',
    'addressList.detail.loading': 'Loading…',
    'addressList.detail.help': '{label} help',
    'addressList.detail.editTitle': 'Edit Label',
    'addressList.detail.labelSection': 'Label',
    'addressList.detail.labelField': 'Address label',
    'addressList.detail.labelPlaceholder': 'Add a label',
    'addressList.detail.labelHelp': 'A name only you see for this address. It stays in this wallet and never goes on chain.',
    'addressList.detail.saveLabel': 'Save Label',
};

addEnglish(messages);

export default messages;
