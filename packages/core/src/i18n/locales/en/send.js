// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `send.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'send.demo.blocked': "Demo wallets can't move funds. Create a real wallet to send.",
    'send.demo.createRealWallet': 'Create a real wallet',
    'send.empty.title': 'Nothing to send yet',
    'send.max.coinsHeld':
        "Every coin at this address is held by another send from this wallet that hasn't gone out yet, so Max can't create a payment.",
    'send.empty.body': 'Receive coins or tokens on this network before creating a payment.',
    'send.review': 'Review and send',
    'send.backToEdit': 'Edit payment',
    'send.memoForbiddenChars': "A memo can't include a vertical bar (|) or semicolon (;).",
    'send.passwordHint': 'Enter your wallet password to sign this transaction.',
    'send.txid': 'Transaction ID',
    'send.testGate.title': 'First payment to this address. Send a small test first?',
    'send.testGate.body':
        'You are sending {amount} {ticker} to a new recipient. A small test payment helps you confirm the address before sending the full amount.',
    'send.testGate.sendSmall': 'Send a small test first',
    'send.testGate.continue': 'Continue with the full amount',
    'send.signerMode':
        "This wallet is in signer mode. It can sign transactions from a watch-only wallet, but it can't send them to the network. To send from this device, change the mode under Settings, Wallet mode.",
    'send.networkFeeValue': 'Network fee: {amount} {ticker}',
    'send.totalValue': 'Total: {amount} {ticker}',
    'send.totalTokenCostValue': 'Total token cost: {amount}',
    'send.queued.body':
        "Your transaction is signed but couldn't reach the network. It's waiting in the queued-transactions banner and only goes out when you broadcast it from there. The wallet reminds you when the network is back. Don't send this payment again.",
    'send.success.broadcastPending': 'Broadcast pending',
    'send.success.broadcastPendingBody':
        "The network accepted your transaction. It's waiting for confirmation, which usually takes a few blocks. You can leave this screen.",
    'send.success.confirmedBody': 'Confirmed on the network.',
    'send.success.failedBody': 'The transaction failed.',
    'send.contacts.refreshFailed': "Couldn't refresh contacts. Saved addresses may be out of date.",
    'send.success.viewOnExplorer': 'View in block explorer',
    'send.success.sendAnother': 'Send another',
    'send.fields.amount': 'Amount',
    'send.fields.to': 'To',
    'send.fields.chain': 'Network',
    'send.fields.from': 'From',
    'send.fields.token': 'Token',
    'send.reviewLabel': 'Review payment',
    'send.review.createUnsigned': 'Create transaction for signing',
    'send.review.signOn': 'Sign on {device}',
    'send.review.sign': 'Sign',
    'send.review.submitAction': '{label}',
    'send.memoCount':
        '{used, number} / {max, number} {used, plural, one {byte} other {bytes}}',
    'send.advanced.label': 'Advanced send choices',
    'send.advanced.none': 'None',
    'send.advanced.feeBumping': 'Fee bumping',
    'send.advanced.allowed': 'Allowed',
    'send.advanced.notAllowed': 'Not allowed',
    'send.advanced.coinControl': 'Coin control',
    'send.advanced.coinControlEnabled': 'Coin control enabled',
    'send.advanced.coinControlReady': 'Choose exactly which coins fund this transaction.',
    'send.advanced.coinControlUnavailable': "Coin control is unavailable while spendable inputs can't be loaded.",
    'send.advanced.loadingInputs': 'Loading spendable inputs…',
    'send.advanced.inputs': 'Inputs',
    'send.advanced.noInputsTitle': 'No spendable inputs',
    'send.advanced.noInputs': 'Inputs this wallet can spend appear here.',
    'send.advanced.changeAddress': 'Change address',
    'send.advanced.automaticChange': 'Automatic: {address}',
    'send.advanced.changeHint': 'Any leftover native coin returns here.',
    'send.advanced.availableCount': '{count} available',
    'send.advanced.selectAll': 'Select all',
    'send.advanced.rowsCapped': 'Showing {shown} of {count} inputs. Select all includes every input.',
    'send.advanced.dust': 'Dust',
    'send.advanced.dustTitle': 'Below the {sats} sat dust threshold',
    'send.advanced.summaryLabel': 'Coin control summary',
    'send.advanced.selectedTotal': 'Selected total',
    'send.advanced.approxChange': 'Approx. change',
    'send.review.multiTokenPreview':
        'This payment includes more than one token. The balance preview shows one token at a time, but every recipient and amount appears under Details.',
    'send.review.details': 'Details ({count})',
    'send.device.trezor': 'Trezor',
    'send.device.ledger': 'Ledger',
    'send.watcherMode':
        'Watch-only mode creates a transaction without signing or sending it. Move it to your signer wallet to sign, then to a normal wallet to send.',
    'send.watcherHardware':
        "This address is paired with {device}, but a watch-only wallet can't sign. Pair the same {device} with your signer wallet to sign the transaction.",
    'send.walletUnlocked': 'Wallet unlocked. No password needed.',
    'send.useMax': 'Use max',
    'send.fromAddress': 'From address',
    'send.draft.restore': 'Restore',
    'send.draft.unfinished': 'Your unfinished payment was saved as a draft. Restore it to continue. Nothing was sent.',
    'send.draft.discardLabel': 'Discard saved draft',
    'send.draft.discard': 'Discard',
    'send.source.choose': 'Choose source address',
    'send.source.hint': 'Only what this address holds can be sent.',
    'send.source.noAddress': 'No address on this network. Use Receive to generate one first.',
    'send.source.otherNetwork':
        'This payment link is for {network}, not the network this wallet is on. Switch networks in Settings to open it there.',
    'send.linkWaiting': 'A payment link is waiting and opens when you leave this screen.',
    'send.offline.bodyNoCache': 'Sending needs a network connection.',
    'send.offline.body': 'Sending needs a network connection. Your cached balance remains available.',
    'send.offline.title': 'Sending needs a network connection',
    'send.destination.placeholder': 'Enter an address or name…',
    'send.paste.checkLabel': 'Check pasted recipient',
    'send.paste.checkHint': 'Compare the first and last 6 characters.',
    'send.saveRecipient.open': 'Save recipient',
    'send.saveRecipient.save': 'Save contact',
    'send.saveRecipient.saving': 'Saving…',
    'send.saveRecipient.saved': 'Recipient saved to contacts.',
    'send.token.hint': "Choose the coin or token to send. The network's own coin is selected by default.",
    'send.balance.unavailable': 'Balance unavailable ({error})',
    'send.balance.unknown': 'Balance unavailable',
    'send.balance.available': '{amount} {ticker} available',
    'send.destroy.balanceShort':
        'This address holds {balance} {tick} now, less than the {amount} {tick} this destroy burns. Nothing was signed. Review the amount and try again.',
    'send.destroy.balanceUnread':
        "Couldn't read this address's {tick} balance, so nothing was signed. Check your connection and try again.",
    'send.dividend.retryHolders': 'Retry holder list',
    'send.dividend.holdersIncomplete':
        'The holder list is incomplete. Retry before paying this dividend.',
    'send.dividend.holdersChanged':
        'The holder list changed. Review the updated payout, then try again.',
    'send.recipient.heading': 'Recipient {number}',
    'send.recipient.removeLabel': 'Remove recipient {number}',
    'send.recipient.addressLabel': 'Recipient {number} address',
    'send.recipient.tokenLabel': 'Recipient {number} token',
    'send.recipient.amountLabel': 'Recipient {number} amount',
    'send.recipient.selectToken': 'Select token for recipient {number}',
    'send.recipient.differentToken': 'Different token per recipient',
    'send.recipient.differentTokenOff': 'Off: every recipient gets {token}.',
    'send.recipient.tokenAbove': 'the token above',
    'send.recipient.total':
        'Total: {total} across {count, plural, one {# recipient} other {# recipients}}, in one transaction and one network fee.',
    'send.recipient.add': '+ Add recipient',
    'send.recipient.maximum':
        '{count, plural, one {You can include up to # recipient in one payment.} other {You can include up to # recipients in one payment.}} Create another payment for any additional recipients.',
    'send.gated.ready':
        'This token includes protected content. Its unlock key will be attached securely so the recipient can open the content. You can send it only to an address that has already made a transaction.',
    'send.gated.partial':
        "This token includes {total, plural, one {# protected content pack} other {# protected content packs}}, but this wallet has unlock keys for only {available}. The recipient can't open the missing {missingCount, plural, one {pack} other {packs}}: {missing}… You can continue, or recover the missing keys by opening the content once from the address that received it.",
    'send.gated.blocked':
        "This token includes protected content, but this wallet has none of its unlock keys. The network will reject a payment without the key, and the recipient won't be able to open the content.",
    'send.gated.softwareSigner':
        'Recovering the key requires a software wallet because it must decrypt messages with the private key. Use a software wallet that holds this address to recover the key.',
    'send.gated.passwordLabel': 'Wallet password',
    'send.gated.passwordHint':
        'Scans messages sent to your addresses for the unlock key and stores it in this wallet.',
    'send.gated.recover': 'Recover keys',
    'send.networkFee': 'Network fee',
    'send.advanced': 'Advanced',
    'send.memo': 'Memo',
    'send.paymentRequestMessage': 'Payment request message:',
    'send.rbf.label': 'Allow a higher network fee later',
    'send.rbf.helpLabel': 'Learn about changing the network fee',
    'send.rbf.help':
        'Before confirmation, you can replace this transaction with one that pays a higher network fee. This can speed it up or cancel it.',
    'send.rbf.enabledHint':
        'You can speed up or cancel this transaction by paying a higher network fee before confirmation.',
    'send.rbf.unsupported': "Changing the network fee later isn't supported on {chain}.",
    'send.rbf.thisChain': 'this network',
    // M2.4: the success card's in-wallet link to the merged History entry.
    // The entry exists the moment this card does (built from the wallet's
    // own pending record), but the network has not necessarily reported it
    // yet, so the hint sets that expectation instead of letting a still-
    // "awaiting network" row read as broken.
    'send.success.viewInHistory': 'View in history',
    'send.success.viewInHistoryHint':
        'The transaction already appears in History. Its network status may take up to a minute to update.',
};

addEnglish(messages);

export default messages;
