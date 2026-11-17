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
    'routes.marketsList.loading': 'Loading markets',
    'routes.myLists.loading': 'Loading lists',
    'routes.addressList.startsWith': ' (starts with {hint})',
    'routes.advancedActions.resumeBlock': 'Resume block',
    'routes.addressList.importAddress': 'Import Address',
    'routes.addressList.startsWith2': 'Starts with {wifPrefixHintValue}',
    'routes.addressList.pasteYourWifPrivateKey': 'Paste your WIF private key',
    'routes.addressList.hidePrivateKey': 'Hide Private Key',
    'routes.addressList.showPrivateKey': 'Show Private Key',
    'routes.addressList.eGColdStorage2024': 'e.g. Cold storage 2024',
    'routes.addressList.requiredEvenWhileUnlockedYour':
        "Required even while unlocked: your password derives the vault's encryption key, which is never kept in memory, and the imported key must be encrypted with it.",
    'routes.addressList.notCoveredByYourRecovery': 'Not covered by your recovery phrase.',
    'routes.addressList.keepACopyOfThe':
        'Keep a copy of the WIF, or a current backup file (Settings > Backup).',
    'routes.addressList.iUnderstandThisKeyIs': "I understand this key isn't backed up by my recovery phrase.",
    'routes.addressList.chooseAddress': 'Choose Address',
    'routes.addressList.addOrImportAddress': 'Add or import address',
    'routes.addressList.addAddress': 'Add Address',
    'routes.addressList.loadingAddresses': 'Loading addresses',
    'routes.addressList.label': 'Label',
    'routes.addressList.about': 'About',
    'routes.addressList.generateAReceiveAddressTo': 'Generate a receive address to populate this list.',
    'routes.addressList.searchAddresses': 'Search addresses',
    'routes.addressList.filterByAddressType': 'Filter by address type',
    'routes.addressList.filterAddresses': 'Filter addresses',
    'routes.addressList.pickerOptions': 'Picker options',
    'routes.addressList.allMatchingAddressesAreHidden': 'All matching addresses are hidden',
    'routes.addressList.noMatchingAddresses': 'No matching addresses',
    'routes.addressList.showHiddenAddressesToSee': 'Show hidden addresses to see them again.',
    'routes.addressList.tryADifferentSearchOr': 'Try a different search or network filter.',
    'routes.addressList.viewAddress2': 'View address {address}',
    'routes.addressList.hidden': 'Hidden',
    'routes.addressList.used': 'Used',
    'routes.addressList.showMoreAddresses': 'Show More Addresses',
    'routes.manageToken.balance': 'Balance',
    'routes.manageToken.chartRange': 'Chart range',
    'routes.manageToken.actions': 'Actions',
    'routes.manageToken.issueSubtoken': 'Issue subtoken',
    'routes.manageToken.dividend': 'Dividend',
    'routes.manageToken.mint': 'Mint',
    'routes.manageToken.mintSettings': 'Mint settings',
    'routes.manageToken.lockSettings': 'Lock settings',
    'routes.manageToken.destroy': 'Destroy',
    'routes.manageToken.dispenser': 'Dispenser',
    'routes.manageToken.sellName': 'Sell Ownership',
    'routes.manageToken.description': 'Description',
    'routes.manageToken.artwork': 'Artwork',
    'routes.manageToken.officialList': 'Official list',
    'routes.manageToken.broadcast': 'Broadcast',
    'routes.manageToken.transfer': 'Transfer',
    'routes.manageToken.controller': 'Controller',
    'routes.manageToken.unbindController': 'Unbind controller',
    'routes.manageToken.callbackSettings': 'Callback settings',
    'routes.manageToken.executeCallback': 'Execute callback',
    'routes.manageToken.accessLists': 'Access lists',
    'routes.manageToken.sharedBlockList': 'Shared block list',
    'routes.manageToken.bridge': 'Bridge',
    'routes.manageToken.pauseToken': 'Pause token',
    'routes.manageToken.resumeToken': 'Resume token',
    'routes.manageToken.actionUnavailable': "This action isn't available in this build.",
    'routes.manageToken.mintLocked': 'Minting is permanently locked for this token.',
    'routes.manageToken.allLocksSet': 'Every token setting is permanently locked.',
    'routes.manageToken.descriptionLocked': "The description is permanently locked and can't be updated.",
    'routes.manageToken.callbackNotConfigured': 'Set callback details before executing a callback.',
    'routes.manageToken.bridgeLocked': 'Bridge settings are frozen for this token and can never change.',
    'routes.manageToken.issuer': 'Issuer',
    'routes.manageToken.lockMaxSupply': 'Max supply',
    'routes.manageToken.lockMaxPerMint': 'Max per mint',
    'routes.manageToken.lockMinting': 'Minting',
    'routes.manageToken.lockCallback': 'Callback',
    'routes.manageToken.locked': 'Locked',
    'routes.manageToken.editable': 'Editable',
    'routes.manageToken.paused': 'Paused',
    // The one line under each Manage token action row's title (G101).
    'routes.manageToken.descriptions.destroy': 'Burn part of your balance for good',
    'routes.manageToken.descriptions.issueSubtoken': 'Create a new token under this one',
    'routes.manageToken.descriptions.lockSettings': 'Lock supply, minting and other settings for good',
    'routes.manageToken.descriptions.mint': 'Create more supply of this token',
    'routes.manageToken.descriptions.mintSettings': 'Change the limits on how much can be minted',
    'routes.manageToken.descriptions.airdrop': 'Send this token to a list of addresses',
    'routes.manageToken.descriptions.broadcast': 'Post a message on-chain from the owner address',
    'routes.manageToken.descriptions.dispenser': 'Sell this token at a fixed rate',
    'routes.manageToken.descriptions.dividend': 'Pay every holder in proportion to their balance',
    'routes.manageToken.descriptions.artwork': 'Attach an icon, image or other media',
    'routes.manageToken.descriptions.description': 'Change the text shown on the token page',
    'routes.manageToken.descriptions.gatedContent': 'Publish files only holders can open',
    'routes.manageToken.descriptions.officialList': 'Name the tokens that belong to this project',
    'routes.manageToken.descriptions.controller': 'Route this token through a guard contract',
    'routes.manageToken.descriptions.unbindController': 'Remove the guard contract from this token',
    'routes.manageToken.descriptions.sellName': 'Offer ownership of this token for sale',
    'routes.manageToken.descriptions.transfer': 'Hand ownership to another address',
    'routes.manageToken.descriptions.accessLists': 'Choose who can hold or receive this token',
    'routes.manageToken.descriptions.bridge': 'Choose which chains this token can move to',
    'routes.manageToken.descriptions.callbackSettings': 'Set the callback token and what it pays',
    'routes.manageToken.descriptions.executeCallback': 'Run the callback and pay its holders',
    'routes.manageToken.descriptions.pauseToken': 'Hold every action on this token for a set time or until resumed',
    'routes.manageToken.descriptions.resumeToken': 'Let actions on this token run again',
    'routes.manageToken.descriptions.sharedBlockList': 'Use a block list another address keeps',
    'routes.sleepForm.addressLockedUntil':
        "This address is locked until block {resumeBlock}. A locked address can't create any XChain action, a new lock included, until it wakes.",
    'routes.sleepForm.addressLockedForGood':
        "This address is locked for good. A locked address can't create any XChain action, a new lock included.",
    'routes.sleepForm.lockStateUnread':
        "The wallet couldn't check whether this address is already locked, so it can't lock it. Check your connection and try again.",
    'routes.sleepForm.lockStatePending': 'Wait for the wallet to check whether this address is already locked.',
    'routes.tokenAdmin.callbackHoldersUnread':
        "Couldn't check whether {tick} has holders. Callback settings can change only before any supply is distributed, so try again when the explorer answers.",
    'routes.tokenAdmin.freezeHelp':
        'Locks the destination networks and minimum confirmations for good, so no owner can ever change them again.',
    // Field help on forms that have no namespace of their own.
    'routes.callback.networkHelp': 'The network your token is on, where the callback runs and its fee is paid.',
    'routes.callback.tokenHelp': 'The token you own whose callback you run, paying its holders the payout set for it.',
    'routes.stakeForm.fromHelp': 'The address whose XCHAIN you stake; it signs the stake and pays the network fee.',
    'routes.stakingAction.fromHelp': 'The address that holds this stake; only it can unstake or claim the rewards.',
    'routes.delegationAction.fromHelp': 'The address that owns the stake; only it can set or revoke the delegated signing key.',
    'routes.listCreate.fromHelp': 'The address that publishes the list and owns it, so only it can edit the list later.',
    'routes.listCreate.addressesFile': 'Addresses file (CSV or TXT)',
    'routes.listCreate.addressesFileHelp':
        'A CSV or text file of addresses, one per line or comma-separated. Its addresses are added to the Addresses box above, where you can check them before publishing.',
    'routes.listCreate.addressesFileInput': 'Upload addresses file',
    'routes.listCreate.tickersFile': 'Tickers file (CSV or TXT)',
    'routes.listCreate.tickersFileHelp':
        'A CSV or text file of token tickers, one per line or comma-separated. Its tickers are added to the Tokens box above, where you can check them before publishing.',
    'routes.listCreate.tickersFileInput': 'Upload tickers file',
    'routes.listFork.networkHelp': 'The network this list lives on, where the edit is published and its fee is paid.',
    'routes.listShare.networkHelp': "The network this list lives on, where it's shared and the fee is paid.",
    'routes.listTransfer.networkHelp': 'The network this list lives on, where its ownership moves and the fee is paid.',
    'routes.psbtSign.fileHelp': 'A partly signed transaction file from another wallet or app that this wallet should sign.',
    'routes.psbtSign.passwordHelp': 'Your wallet password, which unlocks the key that signs this transaction.',
};

addEnglish(messages);

export default messages;
