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
    'home.offline.cached':
        'You are offline. Showing cached balances and their last synced time. Network actions will be available when your connection returns.',
    'home.offline.empty': 'You are offline. Connect to load balances and use network actions.',
    'home.updatingBalances': 'Updating balances…',
    'home.interruptedAction':
        'A {action} was interrupted. Nothing was submitted automatically. Check History before trying again.',
    'home.loadingBalances': 'Loading balances',
    'home.retryBalances': 'Retry',
    'home.addresses': 'Addresses',
    'home.settings': 'Settings',
    'home.lockWallet': 'Lock wallet',
    // The same action on a button, where labels are Title Case.
    'home.lockWalletAction': 'Lock Wallet',
    'home.signer.region': 'Signer for another phone home',
    'home.signer.title': 'Signer for another phone',
    'home.signer.body':
        "This wallet signs transactions built on your other phone. Sending, receiving, and balances aren't available here. Its wallet mode is shown on Wallet Details.",
    'home.signer.signTransaction': 'Sign a Transaction',
    'home.signer.signMessage': 'Sign a Message',
    'home.signer.verifySignature': 'Verify a Signature',
    // One line under each signer action row saying what it does (G101).
    'home.signer.signTransactionDescription': 'Sign a transaction built on your other phone',
    'home.signer.signMessageDescription': 'Prove you hold an address with a signed message',
    'home.signer.verifySignatureDescription': 'Check a signed message against its address',
    'home.signer.settingsDescription': 'Change how this wallet looks and works',
    'home.signer.lockDescription': 'Close the wallet until you unlock it again',

    // Copy moved out of JSX literals by the i18n sweep.
    'home.tabs.walletView': 'Wallet view',
    'home.tabs.value': 'Value',
    'home.tabs.fundYourWallet': 'Fund your wallet',
    'home.tabs.receiveCoinsFromAnotherWallet':
        'Receive coins from another wallet or buy coins through Exchange to get started.',
    'home.tabs.generateAReceivingAddressThen':
        'Generate a receiving address, then transfer coins to it or buy coins through Exchange.',
    'home.tabs.buyCoins': 'Buy Coins',
    'home.tabs.noCoinsYet': 'No coins yet',
    'home.tabs.noCoinsOnThisNetwork': 'No coins on this network',
    'home.tabs.coinsAppearHereAfterYou':
        'Coins appear here after you receive Bitcoin, Litecoin, or Dogecoin.',
    'home.tabs.coinsOnThisNetworkAppear': 'Coins on this network appear here after you receive them.',
    'home.tabs.noMatchingTokens': 'No matching tokens',
    'home.tabs.noTokensYet': 'No tokens yet',
    'home.tabs.noTokensOnThisNetwork': 'No tokens on this network',
    'home.tabs.tokensCouldntBeLoaded': "Tokens couldn't be loaded",
    'home.tabs.tokensCouldntBeLoadedBody':
        "The token balances couldn't be read right now, so this list may be missing tokens you hold. Try again in a moment.",
    'home.tabs.matchingTokensAppearHereAfter':
        'Matching tokens appear here after you change or clear the filter.',
    'home.tabs.tokensAppearHereAfterYou':
        'Tokens appear here after you buy one in Markets or receive a transfer.',
    'home.tabs.tokensOnThisNetworkAppear': 'Tokens on this network appear here after you receive them.',
    'home.tabs.clearFilter': 'Clear Filter',
    'home.tabs.noMatches': 'No matches',
    'home.tabs.matchesAppearHereAfter': 'Matches appear here after you change or clear the filter.',
    'home.tabs.noCollectiblesYet': 'No collectibles yet',
    'home.tabs.noCollectiblesOnThisNetwork': 'No collectibles on this network',
    'home.tabs.collectiblesAppearHereAfterYou':
        'Collectibles appear here after you receive them.',
    'home.tabs.collectiblesOnThisNetworkAppear':
        'Collectibles on this network appear here after you receive them.',
    'home.tabs.recentActivity': 'Recent activity',
    'home.tabs.loadingRecentActivity': 'Loading recent activity…',
    'home.tabs.noActivityOnThisNetwork': 'No activity on this network',
    'home.tabs.sendsReceivesAndOtherActionsAppear':
        'Sends, receives and other actions appear here once this wallet makes or receives one.',
    'home.tabs.recentActivityUnavailable': 'Recent activity is unavailable',
    'home.tabs.recentActivityUnavailableBody': 'History reads every chain again and lists every action.',
    'home.tabs.openHistory': 'See All Activity',
    'home.tabs.loadingDefiPositions': 'Loading DeFi positions…',
    'home.tabs.defiPositionsUnavailable': 'DeFi positions are unavailable',
    'home.tabs.defiPositionsUnavailableBody': 'Try opening this tab again when the network is available.',
    'home.tabs.noDefiPositionsYet': 'No DeFi positions yet',
    'home.tabs.stakingDispensersContractBalancesAnd':
        'Staking, dispensers, contract balances and open orders will show here.',
    'home.filter.searchTokens': 'Search tokens…',
    'home.filter.searchTokensByName': 'Search tokens by name',
    'home.filter.searchCoins': 'Search coins…',
    'home.filter.searchCoinsByName': 'Search coins by name',
    'home.filter.searchNfts': 'Search NFTs…',
    'home.filter.searchNftsByName': 'Search NFTs by name',
    'home.filter.searchDefi': 'Search DeFi…',
    'home.filter.searchDefiByName': 'Search DeFi by name',
    'home.filter.searchActivity': 'Search activity…',
    'home.filter.searchActivityByName': 'Search activity by name',
    'home.filter.sortByName': 'Sort by name',
    'home.filter.sortByValue': 'Sort by value',
    'home.filter.filterByNetwork': 'Filter by network',
    'home.filter.filterAndSort': 'Filter and sort',
    'home.filter.sort': 'Sort',
    // The Balances list's Type field (operator 2026-11-15). Its All types
    // option is alerts.type.all and the Balances tab is balances.balances.
    'home.filter.type': 'Type',
    'home.tabs.coins': 'Coins',
    'home.tabs.tokens': 'Tokens',
    'home.tabs.nfts': 'NFTs',
    'home.tabs.defi': 'DeFi',
    'home.tabs.activity': 'Activity',
    // Wide Home (G115): the empty Balances copy, the collapsible top section
    // (its handle's labels), the allocation card and the list and detail split.
    'home.tabs.noAssetsYet': 'No coins or tokens yet',
    'home.tabs.assetsAppearHereAfterYou': 'Coins, tokens and NFTs appear here after you receive them.',
    'home.wide.overview': 'Overview',
    'home.wide.hideOverview': 'Collapse overview',
    'home.wide.showOverview': 'Expand overview',
    'home.wide.list': 'Balances list',
    'home.wide.resizeList': 'Resize the balances list',
    'home.wide.resizeListHint': 'Drag or use the arrow keys to resize the list. Press Enter for the default width.',
    'home.wide.detail': 'Selected item',
    'home.wide.noSelectionTitle': 'Nothing selected',
    'home.wide.noSelectionBody': 'Choose a coin, token or NFT to see it here.',
    'home.wide.allocation.title': 'Allocation',
    'home.wide.allocation.byValue': 'by value',
    'home.wide.allocation.legend': 'Share of the wallet value by asset',
    'home.wide.allocation.empty': 'No priced assets to show yet.',
    'home.wide.allocation.other': 'Other',
    'home.wide.allocation.otherIs': 'Other is {tick} + {count} more',
    'home.wide.allocation.asset': 'Asset',
    'home.wide.allocation.share': 'Share',
    'home.wide.allocation.assetWord': 'asset',
    'home.wide.allocation.assetsWord': 'assets',
    'home.wide.allocation.oneChain': '1 chain',
    'home.wide.allocation.chains': '{count} chains',
    'home.wide.nft.typeLine': '{tick} · NFT on {chain}',
    'home.wide.nft.holdOf': 'You hold {held} of {total}.',
    'home.wide.nft.hold': 'You hold {held}.',
    'home.wide.nft.worth': 'About {value}.',
    'home.wide.nft.worthLastSale': 'About {value} at the last sale.',
    'home.filter.searchAll': 'Search coins, tokens and NFTs…',
    'home.filter.searchAllByName': 'Search coins, tokens and NFTs by name',
};

addEnglish(messages);

export default messages;
