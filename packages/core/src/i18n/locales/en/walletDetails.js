// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `walletDetails.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- wallet management --------------------------------------
    'walletDetails.title': 'Wallet Details',
    'walletDetails.name': 'Name',
    'walletDetails.type': 'Type',
    'walletDetails.origin': 'Origin',
    'walletDetails.originLabel.created': 'Generated in this wallet',
    'walletDetails.originLabel.demo': 'Created for demo mode',
    'walletDetails.originLabel.importedMnemonic': 'Imported from a recovery phrase',
    'walletDetails.originLabel.importedWif': 'Imported single private key',
    'walletDetails.originLabel.importedBackup': 'Restored from backup file',
    'walletDetails.originLabel.importedFreewallet': 'Imported from FreeWallet',
    'walletDetails.originLabel.connectedHardware': 'Hardware wallet',
    'walletDetails.originLabel.unknown': 'Not recorded',
    'walletDetails.passphrase': 'Extra passphrase status',
    'walletDetails.created': 'Created',
    'walletDetails.demoWallet': 'Demo wallet (throwaway)',
    'walletDetails.id': 'ID',
    'walletDetails.upgradeRecovery': 'Upgrade recovery phrase',
    'walletDetails.continueMigration': 'Continue migration',
    'walletDetails.actionsList': 'Wallet actions',
    'walletDetails.exportBackupAction': 'Export Backup',
    // One line under each action row saying what it does (G101).
    'walletDetails.action.setActive': 'Switch to this wallet for balances and sends',
    'walletDetails.action.rename': 'Change the wallet name and tile',
    'walletDetails.action.recoveryPhrase': 'See the words that restore this wallet',
    'walletDetails.action.exportBackup': 'Save an encrypted backup file of this wallet',
    'walletDetails.action.checkAddresses': 'Look for used addresses on each chain',
    'walletDetails.action.upgradeRecovery': 'Move this wallet to a standard recovery phrase',
    'walletDetails.action.exitDemo': 'Wipe the demo wallet and its throwaway data',
    'walletDetails.action.remove': 'Take this wallet off this device',
    // --- wallet mode (§20): chosen at create, import or pair; read-only after
    'walletDetails.walletMode': 'Wallet mode',
    'walletDetails.walletMode.full': 'Normal',
    'walletDetails.walletMode.watcher': 'Signs on another phone',
    'walletDetails.walletMode.signer': 'Signer for another phone',
    'walletDetails.walletMode.fullHint': 'Sign and send transactions on this device.',
    'walletDetails.walletMode.watcherHint': 'Shows balances and builds unsigned transactions for the other phone to sign. This phone never signs.',
    'walletDetails.walletMode.signerHint': 'Signs transactions built on the other phone. This phone hides Send and Receive and never broadcasts.',
    'walletDetails.walletMode.help': 'How this wallet handles transactions: Normal signs and sends here, Signs on another phone builds unsigned transactions for the paired phone, and Signer for another phone only signs transactions the paired phone builds.',
    'walletDetails.walletMode.final': 'Chosen once for this wallet. To use another mode, set the wallet up again with that mode.',
    // --- Remove Wallet page, scoped to the wallet whose details opened it
    'walletDetails.remove.title': 'Remove Wallet',
    'walletDetails.remove.notListed': 'This wallet is no longer listed.',
};

addEnglish(messages);

export default messages;
