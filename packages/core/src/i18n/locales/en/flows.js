// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `flows.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'flows.nameSale.alreadyListed': '{tick} is already listed for sale from this wallet.',
    'flows.dispenserAddress.self':
        'This is the source address itself, so it can always host its own dispenser.',
    'flows.dispenserAddress.preference':
        'Allowed: this address lets anyone open a dispenser on it.',
    'flows.dispenserAddress.fresh':
        'Allowed: this address has no on-chain history, so anyone may open the first dispenser on it.',
    'flows.dispenserAddress.origin':
        'Allowed: your source address opened a dispenser here before, so it may open another.',
    'flows.dispenserAddress.ownerOnly': 'This address only lets its owner open dispensers.',
    'flows.dispenserAddress.unknown':
        "Couldn't confirm this address accepts your dispenser; the network will decide. If it refuses, the network fee is lost.",

    'flows.pairPartner.unavailableHelp':
        'Pairing applies to Watcher and Signer wallets. Pick one of those modes first, then pair this wallet with its other half.',
    'flows.pairPartner.pairSigner': 'Pair a signer',
    'flows.pairPartner.pairWatcher': 'Pair a watcher',
    'flows.pairPartner.watcherHelp':
        'This wallet watches your coins and builds unsigned transactions. Pair it with the offline wallet that holds the same recovery phrase and signs them.',
    'flows.pairPartner.signerHelp':
        'This wallet signs transactions offline. Pair it with the online wallet that holds the same recovery phrase and watches your coins.',
    'flows.pairPartner.modeMismatch':
        'This wallet is in {localMode} mode, so its partner must be in {partnerMode} mode. The wallet you scanned is in {scannedMode} mode.',
    'flows.pairPartner.noSharedChains':
        'The two wallets have no network in common, so there is nothing to compare. Switch on at least one matching network in both wallets and try again.',
    'flows.pairPartner.seedMismatch':
        "These two wallets were made from different recovery phrases ({chains} doesn't match). Restore both halves from the same phrase and pair again.",
    'flows.pairPartner.paired':
        'Paired. Both wallets come from the same recovery phrase and agree on {count, plural, one {# network} other {# networks}}.',

    'flows.protocolFee.freeLabel': 'This action has no protocol fee',
    'flows.protocolFee.freeHint':
        'Only the network fee applies, so there is nothing to pay on top of it.',
    'flows.protocolFee.forfeit': "The fee is sent on-chain and isn't refunded if the network rejects this transaction.",
    'flows.protocolFee.conditionalForfeit':
        "If this action charges one, it's sent on-chain and isn't refunded if the network rejects this transaction.",
    'flows.protocolFee.amount': "This action's protocol fee is {amount} XCHAIN.",
    'flows.protocolFee.paidIn': 'Protocol fee is paid in {ticker}',
    'flows.protocolFee.paidInPlural': 'Protocol fees are paid in {ticker}',
    'flows.protocolFee.onlyWay':
        '{ticker} is the only way to pay a protocol fee on this network.',
    'flows.protocolFee.unverifiedNotice':
        "The amount is exact, but the network doesn't check contract actions in advance, so it can't tell you beforehand whether this one will be accepted. If it's rejected, the fee is still spent.",
    'flows.protocolFee.toggleLabel': 'Pay protocol fee in {ticker} instead of XCHAIN',

    'flows.rbf.unsupportedBuild': "RBF replacement isn't supported by this build.",
    'flows.rbf.noEntry': 'No entry to replace.',
    'flows.rbf.noHash': 'No transaction hash on this entry.',
    'flows.rbf.alreadyConfirmed': 'Already confirmed.',
    'flows.rbf.actionUnsupported': "{action} actions aren't RBF-replaceable.",
    'flows.rbf.notAllowed': 'This transaction did not allow fee replacement.',
    'flows.rbf.nothingToUndo': 'Nothing to undo.',
    'flows.rbf.cancelConfirmed': 'The cancellation already confirmed.',

    'flows.signRisk.alwaysConfirm':
        "You've set the wallet to always require explicit cross-check confirm on hardware signs.",
    'flows.signRisk.multisig':
        'Multisig contributions deserve an explicit cross-check. Your cosigners trust this signature.',
    'flows.signRisk.firstRecipient':
        "First-time recipient. Confirm the address on your device matches what's shown here.",
    'flows.signRisk.largeAmount':
        'Large amount ({amount} sats). Confirm both path and address on your device.',

    'flows.pasteIntegrity.changed': 'Clipboard contents changed between paste and re-read.',

    'flows.submit.nothingSigned': 'Nothing was signed.',
    'flows.submit.spendConflict':
        'One of the coins this transaction spends was already used by another transaction. Nothing was sent.',
    'flows.coinpay.paymentInFlight':
        'A payment for this match is already on its way. Nothing was sent: paying again sends the coin a second time. Check History for the earlier payment.',
};

addEnglish(messages);

export default messages;
