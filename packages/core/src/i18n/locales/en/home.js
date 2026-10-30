// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `home.*` keys, loaded at startup by i18n/index.js.

import { addEnglish } from '../../store.js';

const messages = {
    // --- home -----------------------------------------------------
    'home.receive': 'Receive',
    'home.title': 'Home',
    'home.demoSendBlocked': "Demo wallets can't send. Create a real wallet to send.",
    'home.offline.cached':
        'You are offline. Showing cached balances and their last synced time. Network actions will be available when your connection returns.',
    'home.offline.empty': 'You are offline. Connect to load balances and use network actions.',
    'home.updatingBalances': 'Updating balances…',
    'home.interruptedAction':
        'A {action} was interrupted. Nothing was submitted automatically. Check Activity before trying again.',
    'home.loadingBalances': 'Loading balances',
    'home.retryBalances': 'Retry',
    'home.pendingAirdrops': 'Pending airdrops',
    'home.resumeAirdrop': 'Resume airdrop: {amount} {token} × {count}',
    'home.airdrop.waitingIndex': 'Recipient list sent, waiting to be indexed',
    'home.airdrop.readyToSign': 'Ready to sign the airdrop',
    'home.pendingPayments': 'Pending payments due',
    'home.paymentDue': 'Payment due: pay {amount} to complete matched order #{order}',
    'home.paymentDue.hint': 'Sign to finish paying for your matched order.',
    'home.paymentDue.watcherHint': 'Build an unsigned payment to export to a signer.',
    'home.quickActions': 'Quick actions',
    'home.exchange': 'Exchange',
    'home.exchangeOffline': 'Exchange needs a network connection',
    'home.createToken': 'Create token',
    'home.createTokenOffline': 'Creating a token needs a network connection',
    'home.markets': 'Markets',
    'home.messaging': 'Messaging',
    'home.addresses': 'Addresses',
    'home.contracts': 'Contracts',
    'home.staking': 'Staking',
    'home.sendOffline': 'Send needs a network connection',
    'home.settings': 'Settings',
    'home.lockWallet': 'Lock wallet',
    'home.signer.region': 'Signer mode home',
    'home.signer.title': 'Signer mode',
    'home.signer.body':
        "This wallet signs transactions from a paired watcher wallet. Sending, receiving, and balances aren't available. To use them on this device, switch modes under Settings → Wallet mode.",
    'home.signer.signTransaction': 'Sign a transaction',
    'home.signer.signMessage': 'Sign a message',
    'home.signer.verifySignature': 'Verify a signature',

    // Copy moved out of JSX literals by the i18n sweep.
    'home.tabs.walletView': 'Wallet view',
    'home.tabs.sortBalances': 'Sort balances',
    'home.tabs.24hChange': '24h change',
    'home.tabs.value': 'Value',
    'home.tabs.fundYourWallet': 'Fund your wallet',
    'home.tabs.receiveCoinsFromAnotherWallet':
        'Receive coins from another wallet or buy coins through Exchange to get started.',
    'home.tabs.generateAReceivingAddressThen':
        'Generate a receiving address, then transfer coins to it or buy coins through Exchange.',
    'home.tabs.buyCoins': 'Buy coins',
    'home.tabs.noCoinsYet': 'No coins yet',
    'home.tabs.noCoinsOnThisNetwork': 'No coins on this network',
    'home.tabs.coinsAppearHereAfterYou':
        'Coins appear here after you receive Bitcoin, Litecoin, or Dogecoin.',
    'home.tabs.coinsOnThisNetworkAppear': 'Coins on this network appear here after you receive them.',
    'home.tabs.noMatchingTokens': 'No matching tokens',
    'home.tabs.noTokensYet': 'No tokens yet',
    'home.tabs.noTokensOnThisNetwork': 'No tokens on this network',
    'home.tabs.matchingTokensAppearHereAfter':
        'Matching tokens appear here after you change or clear the filter.',
    'home.tabs.tokensAppearHereAfterYou':
        'Tokens appear here after you buy one in Markets or receive a transfer.',
    'home.tabs.tokensOnThisNetworkAppear': 'Tokens on this network appear here after you receive them.',
    'home.tabs.clearFilter': 'Clear filter',
    'home.tabs.unpricedTokens': 'Unpriced tokens',
    'home.tabs.issuedByYou': 'Issued by you',
    'home.tabs.aTickAppearsHereWhen':
        'A tick appears here when it can never be split and its supply can never grow. Everything you hold, collectible or not, is also under Tokens.',
    'home.tabs.noCollectiblesYet': 'No collectibles yet',
    'home.tabs.noCollectiblesOnThisNetwork': 'No collectibles on this network',
    'home.tabs.collectiblesAppearHereAfterYou':
        'Collectibles appear here after you receive an indivisible token with permanently locked supply.',
    'home.tabs.collectiblesOnThisNetworkAppear':
        'Collectibles on this network appear here after you receive them.',
    'home.tabs.yourActivityIsInHistory': 'Your activity is in History',
    'home.tabs.everySendReceiveAndOther': 'Every send, receive and other transaction, newest first.',
    'home.tabs.openHistory': 'Open History',
    'home.tabs.noDefiPositionsYet': 'No DeFi positions yet',
    'home.tabs.stakingDispensersContractBalancesAnd':
        'Staking, dispensers, contract balances and open orders will show here.',
    'home.tabs.synthesizedDemoActivityWillAppear':
        'Synthesized demo activity will appear here once the demo wallet has any networks active.',
    'home.tabs.noDefiPositions': 'No DeFi positions',
    'home.tabs.noDemoPositionsOnThe': 'No demo positions on the selected network.',
    'home.tabs.confirms': 'Confirms',
    'home.tabs.unconfirmed': 'Unconfirmed',
    'home.filter.searchTokens': 'Search tokens…',
    'home.filter.searchTokensByName': 'Search tokens by name',
    'home.filter.filterByNetwork': 'Filter by network',
    'home.tabs.blockNumber': 'Block {block, number}',
    'home.tabs.coins': 'Coins',
    'home.tabs.tokens': 'Tokens',
    'home.tabs.nfts': 'NFTs',
    'home.tabs.defi': 'DeFi',
    'home.tabs.activity': 'Activity',
};

addEnglish(messages);

export default messages;
