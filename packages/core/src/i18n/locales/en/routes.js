// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `routes.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // Copy moved out of JSX literals by the i18n sweep.
    'routes.addressList.generateAtIndex': 'Generate at index',
    'routes.addressList.generateAddressAtIndex': 'Generate address at index',
    'routes.addressList.generate': 'Generate',
    'routes.addressList.coin': 'Coin',
    'routes.addressList.startsWith': ' (starts with {hint})',
    'routes.addressList.derivationIndex': 'Derivation index',
    'routes.addressList.useTheExactExternalIndex':
        'Use the exact external index of the receive address you want to recover or recreate. It must not already be held by this account.',
    'routes.addressList.importAddress': 'Import address',
    'routes.addressList.startsWith2': 'Starts with {wifPrefixHintValue}',
    'routes.addressList.pasteYourWifPrivateKey': 'Paste your WIF private key',
    'routes.addressList.hidePrivateKey': 'Hide private key',
    'routes.addressList.showPrivateKey': 'Show private key',
    'routes.addressList.labelOptional': 'Label (optional)',
    'routes.addressList.eGColdStorage2024': 'e.g. Cold storage 2024',
    'routes.addressList.requiredEvenWhileUnlockedYour':
        "Required even while unlocked: your password derives the vault's encryption key, which is never kept in memory, and the imported key must be encrypted with it.",
    'routes.addressList.notCoveredByYourRecovery': 'Not covered by your recovery phrase.',
    'routes.addressList.keepACopyOfThe':
        'Keep a copy of the WIF, or a current backup file (Settings > Backup).',
    'routes.addressList.iUnderstandThisKeyIs': "I understand this key isn't backed up by my recovery phrase.",
    'routes.addressList.chooseAddress': 'Choose address',
    'routes.addressList.addOrImportAddress': 'Add or import address',
    'routes.addressList.addAddress': 'Add address',
    'routes.addressList.generateAtIndexAdvanced': 'Generate at index (advanced)',
    'routes.addressList.loadingAddresses': 'Loading addresses',
    'routes.addressList.label': 'Label',
    'routes.addressList.noLabel': 'No label',
    'routes.addressList.addressActions': 'Address actions',
    'routes.addressList.thisIsTheActiveAddress': 'This is the active address',
    'routes.addressList.makeThisTheActiveAddress': 'Make this the active address',
    'routes.addressList.switching': 'Switching…',
    'routes.addressList.secret': 'Secret',
    'routes.addressList.xchain': 'XChain',
    'routes.addressList.deleting': 'Deleting…',
    'routes.addressList.about': 'About',
    'routes.addressList.help': '{label} help',
    'routes.addressList.onChainPreferences': 'On-chain preferences',
    'routes.addressList.customPreferencesSet': 'Custom preferences set',
    'routes.addressList.protocolDefaults': 'Protocol defaults',
    'routes.addressList.incomingSends': 'Incoming sends',
    'routes.addressList.editOnChainPreferences': 'Edit on-chain preferences',
    'routes.addressList.generateAReceiveAddressTo': 'Generate a receive address to populate this list.',
    'routes.addressList.searchAddresses': 'Search addresses',
    'routes.addressList.filterByAddressType': 'Filter by address type',
    'routes.addressList.pickerOptions': 'Picker options',
    'routes.addressList.allMatchingAddressesAreHidden': 'All matching addresses are hidden',
    'routes.addressList.noMatchingAddresses': 'No matching addresses',
    'routes.addressList.showHiddenAddressesToSee': 'Show hidden addresses to see them again.',
    'routes.addressList.tryADifferentSearchOr': 'Try a different search or network filter.',
    'routes.addressList.viewAddress2': 'View address {address}',
    'routes.addressList.hidden': 'Hidden',
    'routes.addressList.used': 'Used',
    'routes.addressList.showMoreAddresses': 'Show more addresses',
    'routes.manageToken.backToMyTokens': 'Back to my tokens',
    'routes.manageToken.manageToken': 'Manage token',
    'routes.manageToken.tokenIdentity': 'Token identity',
    'routes.manageToken.ownedBy': 'Owned by',
    'routes.manageToken.copyOwnerAddress': 'Copy owner address',
    'routes.manageToken.thisTokenIsAnOfficial': 'This token is an official token in the',
    'routes.manageToken.tokenStats': 'Token stats',
    'routes.manageToken.supply': '{value} supply',
    'routes.manageToken.ofCap': 'of {formatTokenQuantityValue} cap',
    'routes.manageToken.noCap': 'no cap',
    'routes.manageToken.youHold': 'You hold',
    'routes.manageToken.ofSupply': '{value}% of supply',
    'routes.manageToken.holders': 'Holders',
    'routes.manageToken.openOffers': 'Open offers',
    'routes.manageToken.chartRange': 'Chart range',
    'routes.manageToken.noMarketDataYet': 'No market data yet',
    'routes.manageToken.noPriceHistoryYet': 'No price history yet',
    'routes.manageToken.indexedMarketActivityBuildsThis':
        "Indexed market activity builds this token's price history.",
    'routes.manageToken.thisWalletDoesnTHold':
        "This wallet doesn't hold the token's issuer address. Mint, Mint settings, Lock, Description, Artwork, Transfer, Broadcast, and Dividend require signing from",
    'routes.manageToken.manageActions': 'Manage actions',
    'routes.manageToken.tokenManagementPanels': 'Token management panels',
    'routes.manageToken.genesisAndSubassets': 'Genesis and subassets',
    'routes.manageToken.genesis': 'Genesis',
    'routes.manageToken.issueAction': 'Issue action',
    'routes.manageToken.issued': 'Issued',
    'routes.manageToken.issuer': 'Issuer',
    'routes.manageToken.copyGenesisIssuerAddress': 'Copy genesis issuer address',
    'routes.manageToken.noGenesisRecordYet': 'No genesis record yet',
    'routes.manageToken.theIndexedGenesisRecordFor': 'The indexed genesis record for {tick} appears here.',
    'routes.manageToken.noOpenDispensers': 'No open dispensers',
    'routes.manageToken.openDispensersSellingAppearHere': 'Open dispensers selling {tick} appear here.',
    'routes.manageToken.createOne': 'Create one',
    'routes.manageToken.open': 'Open',
    'routes.manageToken.noOpenOrders': 'No open orders',
    'routes.manageToken.openOrdersInvolvingAppearHere': 'Open orders involving {tick} appear here.',
    'routes.manageToken.noRecentSwaps': 'No recent swaps',
    'routes.manageToken.recentSwapsInvolvingAppearHere': 'Recent swaps involving {tick} appear here.',
    'routes.manageToken.holdersAppearHereAfterSupply':
        'Holders appear here after supply is minted or distributed.',
    'routes.manageToken.topHolderBalances': 'Top holder balances',
    'routes.manageToken.balance': 'Balance',
    'routes.manageToken.copyHolderAddress': 'Copy holder address {value}',
    'routes.manageToken.viewAll': 'View all',
    'routes.manageToken.holders2': 'holders',
    'routes.manageToken.indexedActivityForAppearsHere': 'Indexed activity for {tick} appears here.',
    'routes.manageToken.viewAllActivity': 'View all activity',
    'routes.manageToken.unconfirmed': 'unconfirmed',
    'routes.manageToken.locked': 'Locked',
    'routes.manageToken.unlocked': 'Unlocked',
    'routes.manageToken.pausedIndefinitely': 'Paused indefinitely',
    'routes.manageToken.pausedUntilBlock': 'Paused until block {resumeBlock}',
    'routes.manageToken.paused': 'Paused',
};

addEnglish(messages);

export default messages;
