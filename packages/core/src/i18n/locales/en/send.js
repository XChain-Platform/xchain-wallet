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
    'send.demo.createRealWallet': 'Create a Real Wallet',
    'send.empty.title': 'Nothing to send yet',
    'send.max.coinsHeld':
        "Every coin at this address is held by another send from this wallet that hasn't gone out yet, so Max can't create a payment.",
    'send.max.uneconomicalInputs':
        'Max leaves {amount} {ticker} at this address because those coins cost at least as much in network fees as they would add to the payment.',
    'send.empty.body': 'Receive coins or tokens on this network before creating a payment.',
    'send.backToEdit': 'Edit payment',
    'send.memoForbiddenChars': "A memo can't include a vertical bar (|) or semicolon (;).",
    'send.passwordHint': 'Enter your wallet password to sign this transaction.',
    'send.txid': 'Transaction ID',
    'send.testGate.title': 'First payment to this address. Send a small test first?',
    'send.testGate.body':
        'You are sending {amount} {ticker} to a new recipient. A small test payment helps you confirm the address before sending the full amount.',
    'send.testGate.sendSmall': 'Send a Small Test First',
    'send.testGate.continue': 'Continue with the Full Amount',
    'send.signerMode':
        "This wallet is the signer for another phone. It signs transactions built on that phone, but it can't send them to the network. Its wallet mode is shown on Wallet Details and was chosen when the wallet was set up.",
    'send.networkFeeValue': 'Network fee: {amount} {ticker}',
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
    'send.success.sendAnother': 'Send Another',
    'send.fields.amount': 'Amount',
    'send.fields.to': 'To',
    // A closed section's summary naming where it goes; the address is drawn
    // as a fitting AddressText at {address} (G99).
    'send.summary.toAddress': 'to {address}',
    'send.summary.toAddressStart': 'To {address}',
    'send.fields.chain': 'Network',
    'send.fields.from': 'From',
    'send.fields.token': 'Token',
    'send.asset': 'Asset',
    'send.selectAsset': 'Select an asset',
    'send.section.payment': 'Payment',
    'send.reviewLabel': 'Review payment',
    'send.review.createUnsigned': 'Create Transaction for Signing',
    'send.review.sign': 'Sign',
    'send.advanced.none': 'None',
    'send.advanced.feeBumping': 'Fee bumping',
    'send.advanced.allowed': 'Allowed',
    'send.advanced.coinControl': 'Coin control',
    'send.advanced.coinControlEnabled': 'Coin control enabled',
    'send.advanced.coinControlHelp': 'On lets you pick which coins at this address pay for this transaction; off lets the wallet choose.',
    'send.advanced.coinControlReady': 'Choose exactly which coins fund this transaction.',
    'send.advanced.coinControlUnavailable': "Coin control is unavailable while spendable inputs can't be loaded.",
    'send.advanced.loadingInputs': 'Loading spendable inputs…',
    'send.advanced.inputs': 'Inputs',
    'send.advanced.inputsHelp': 'Tick the coins that pay for this transaction. Only the ticked coins are spent.',
    'send.advanced.noInputsTitle': 'No spendable inputs',
    'send.advanced.noInputs': 'Inputs this wallet can spend appear here.',
    'send.advanced.changeAddress': 'Change address',
    'send.advanced.automaticChange': 'Automatic: {address}',
    'send.advanced.availableCount': '{count} available',
    'send.advanced.selectAll': 'Select All',
    'send.advanced.rowsCapped': 'Showing {shown} of {count} inputs. Select All includes every input.',
    'send.advanced.dust': 'Dust',
    'send.advanced.dustTitle': 'Below the {sats} sat dust threshold',
    'send.advanced.summaryLabel': 'Coin control summary',
    'send.advanced.selectedTotal': 'Selected total',
    'send.advanced.approxChange': 'Approx. change',
    'send.advanced.changeHelp': 'Where any leftover native coin from this transaction returns. Automatic sends it back to the paying address, or to a fresh one when change rotation is on.',
    'send.advanced.freshChange': 'a fresh address',
    'send.advanced.changeAddressTitle': 'Change Address',
    'send.advanced.coinsRequired': 'Choose at least one coin under Advanced, or turn coin control off.',
    'send.advanced.summaryDefault': 'Default',
    'send.advanced.summaryRbfOn': 'Fee bumping on',
    'send.advanced.summaryRbfOff': 'Fee bumping off',
    'send.advanced.summaryCoin': '1 coin',
    'send.advanced.summaryCoins': '{count} coins',
    'send.advanced.summaryChange': 'custom change',
    'send.device.trezor': 'Trezor',
    'send.device.ledger': 'Ledger',
    'send.watcherHardware':
        "This address belongs to {device}, but another phone signs for this wallet. Connect the same {device} on the phone that signs to sign the transaction.",
    'send.useMax': 'Use Max',
    'send.fromAddress': 'From Address',
    'send.draft.restore': 'Restore',
    'send.draft.unfinished': 'Your unfinished payment was saved as a draft. Restore it to continue. Nothing was sent.',
    'send.source.choose': 'Choose source address',
    'send.source.hint': 'Only what this address holds can be sent.',
    'send.source.multisigTitle': 'Multisig {threshold} of {count}',
    'send.source.unavailable': 'Address unavailable',
    'send.source.noAddress': 'No address on this network. Use Receive to generate one first.',
    'send.source.otherNetwork':
        'This payment link is for {network}, not the network this wallet is on. Switch networks in Settings to open it there.',
    'send.linkWaiting': 'A payment link is waiting and opens when you leave this screen.',
    'send.offline.bodyNoCache': 'Sending needs a network connection.',
    'send.offline.body': 'Sending needs a network connection. Your cached balance remains available.',
    'send.offline.title': 'Sending needs a network connection',
    'send.max.nothingToSend': 'Nothing is available to send from this address.',
    'send.destination.placeholder': 'Enter an address or name…',
    'send.destination.help':
        'The address or contact that receives this payment. Check the address carefully; a sent payment is final.',
    'send.destination.bridgeWarning':
        "This address is only for moving tokens between networks. A regular Send here can't be recovered and doesn't create tokens on the other network. Go back and use Move across chains instead.",
    'send.destination.burnWarning':
        "This is the network's burn address. Anything sent here is destroyed and can't be recovered.",
    'send.destination.recipientWarning': 'Recipient {number}: {warning}',
    'send.dispenser.belowFiatFill':
        "At the current rate, this payment is worth about {payment} {fiat}, below the {price} {fiat} needed for one fill. The price can move before the payment lands; if it's still too low, you receive nothing and the payment isn't returned.",
    'send.amount.help':
        'How much of the selected asset to send. Max fills the most this From address can send after the network fee.',
    'send.paste.checkLabel': 'Check pasted recipient',
    'send.paste.checkHint': 'Compare the first and last 6 characters.',
    'send.saveRecipient.open': 'Save Recipient',
    'send.saveRecipient.nameHelp': 'The name used for this recipient in your contacts.',
    'send.saveRecipient.save': 'Save Contact',
    'send.saveRecipient.saving': 'Saving…',
    'send.saveRecipient.saved': 'Recipient saved to contacts.',
    'send.token.hint': "Choose the coin or token to send. The network's own coin is selected by default.",
    'send.balance.unknown': 'Balance unavailable',
    'send.balance.pendingUnknown':
        'The balance service is still catching up on unconfirmed transactions, so part of this amount may already be spent.',
    'send.balance.available': '{amount} {ticker} available',
    'send.destroy.balanceShort':
        'This address holds {balance} {tick} now, less than the {amount} {tick} this destroy burns. Nothing was signed. Review the amount and try again.',
    'send.destroy.balanceUnread':
        "Couldn't read this address's {tick} balance, so nothing was signed. Check your connection and try again.",
    'send.dividend.retryHolders': 'Retry Holder List',
    'send.dividend.holdersIncomplete':
        'The holder list is incomplete. Retry before paying this dividend.',
    'send.dividend.holdersChanged':
        'The holder list changed. Review the updated payout, then try again.',
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
    'send.gated.recover': 'Recover Keys',
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
    'send.success.viewInHistory': 'View in History',
    'send.success.viewInHistoryHint':
        'The transaction already appears in History. Its network status may take up to a minute to update.',
    'send.sweep.missingKeysNotice':
        "Unlock keys for {ticks} aren't in the vault, so their gated content may never open in the new wallet.",
    // The Payment section's Single, Multi and Advanced tabs (Advanced reads
    // send.advanced). 'Recipients' names the Multi list, the Advanced box and
    // the review's recipients card alike.
    'send.mode.label': 'Send to',
    'send.mode.single': 'Single',
    'send.mode.multi': 'Multi',
    'send.multi.listLabel': 'Recipients',
    'send.multi.newRecipient': 'New recipient',
    'send.multi.editRecipient': 'Edit recipient {number}',
    'send.multi.toHelp':
        'The address that receives this amount. It must be an address on the network this payment is sent on.',
    'send.multi.tokenHelp': 'The token this recipient receives. Each recipient can get a different token.',
    'send.multi.amountHelp': 'How much of the token this recipient receives.',
    'send.multi.add': 'Add',
    'send.multi.save': 'Update',
    'send.multi.editRow': 'Edit recipient {number}: {amount} to {address}',
    'send.multi.removeRow': 'Remove Recipient {number}',
    'send.multi.addRecipient': 'Add Recipient',
    'send.multi.limit':
        'One transaction carries at most {count, plural, one {# recipient} other {# recipients}}. Send to anyone else in another payment.',
    'send.multi.total':
        'Total: {total} to {count, plural, one {# recipient} other {# recipients}}, in one transaction with one network fee.',
    'send.multiText.placeholder':
        'address, token, amount\naddress, token, amount\naddress, token, amount',
    'send.multiText.help': 'One recipient per line: address, token, amount.',
    'send.multiText.fileLabel': 'Upload CSV (up to 2 MB)',
    'send.multiText.fileHelp':
        'A .csv or .txt file with one recipient per line: {format}. A header row is fine. A valid file fills the box above, where you can still edit it.',
    'send.multiText.fileInput': 'Choose a CSV file of recipients',
    'send.fromSection.addressLabel': 'From address',
    'send.fromSection.pickerLockedReason': 'This action signs from this address only',
    'send.networkHelp': 'The chain this payment is sent on. Your From address, the token and the network fee are all on this network.',
};

addEnglish(messages);

export default messages;
