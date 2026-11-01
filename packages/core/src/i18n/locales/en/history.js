// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `history.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'history.refresh': 'Refresh history',
    'history.refreshing': 'Refreshing history',
    'history.offline.cached': 'You are offline. Showing the last saved history. Network actions will be available when your connection returns.',
    'history.offline.emptyBody': 'History loads when the connection returns.',
    'history.unreadChains': "History for {chains} couldn't be read. Showing the other networks.",
    'history.offline.refreshFailed': "History didn't refresh. Showing the last saved history.",
    'history.offline.refreshTitle': 'Refreshing history needs a network connection',
    'history.showMore': 'Show more history',
    'history.itemsShown':
        '{shown, number} of {total, plural, one {# history item} other {# history items}} shown',
    'history.showMoreGroupEntries': 'Show more group entries ({shown} of {total} shown)',
    'history.recipients.noHoldersFound': 'No holders yet',
    'history.recipients.noRecipientsFound': 'No recipients yet',
    'history.recipients.noHoldersBody': 'Token holders appear here after balances are indexed.',
    'history.recipients.noRecipientsBody': 'Matching recipients appear here after history is indexed.',
    'history.loading': 'Loading history',
    'history.empty.noAddressesTitle': 'No addresses yet',
    'history.empty.noAddressesBody': 'History appears here after you generate an address and send or receive funds.',
    'history.empty.noMatchesTitle': 'No results for these filters',
    'history.empty.noSearchResultsTitle': 'No results for "{query}"',
    'history.empty.noMatchesBody': 'Matching history appears here after you reset or change the filters.',
    'history.empty.clearFilters': 'Reset filters',
    'history.empty.noCrossChainTitle': 'No cross-chain actions yet',
    'history.empty.noCrossChainBody':
        'Cross-chain transfers appear here after you send or receive one.',
    'history.empty.noActivityTitle': 'No activity yet',
    'history.empty.noActivityBody':
        'Activity appears here after you send or receive on a selected network.',
    'history.empty.startReceiving': 'Start receiving',
    'history.filters.label': 'History filters',
    'history.filters.toggle': 'Filters ({count})',
    'history.filters.searchPlaceholder': 'Search by action, address, token, transaction ID, or memo…',
    'history.filters.searchLabel': 'Search history',
    'history.filters.clearSearch': 'Clear history search',
    'history.filters.fromDate': 'From date',
    'history.filters.toDate': 'To date',
    'history.filters.additionalDetails': 'More filters',
    'history.filters.fiatHelp': "Show local-currency values for the network's own coin.",
    'history.filters.fiatCurrency': 'Fiat: {currency}',
    'history.filters.showFiatOff': 'Show fiat: Off',
    'history.filters.fiatOff': 'Fiat: Off',
    'history.filters.groupingMode': 'Grouping mode',
    'history.filters.grouped': 'Grouped',
    'history.filters.flat': 'Flat',
    'history.filters.advanced': 'Advanced filters',
    'history.filters.allActionTypes': 'All action types',
    'history.filters.actionType': 'action type',
    'history.filters.actionTypes': 'Action types',
    'history.filters.allStatuses': 'All statuses',
    'history.filters.status': 'status',
    'history.filters.statusHeader': 'Status',
    'history.filters.noSpecialFilters': 'No special filters',
    'history.filters.filter': 'filter',
    'history.filters.special': 'Special',
    'history.filters.multisigOnly': 'Multisig only',
    'history.filters.datePresets': 'Date range presets',
    'history.filters.last7Days': '7 days',
    'history.filters.last30Days': '30 days',
    'history.filters.allDates': 'All dates',
    'history.filters.dateZone': 'Dates use local time.',
    'history.filters.activeRange': 'Date range: {from} to {to}',
    'history.filters.anyDate': 'Any date',
    'history.filters.clearDateRange': 'Clear date range',
    'history.detail.label': 'Transaction details',
    'history.detail.copyCounterparty': 'Copy counterparty address',
    'history.detail.openInExplorer': 'Open in explorer',
    'history.detail.options': 'Transaction actions',
    'history.detail.noAdditionalActions': 'No additional actions',
    'history.detail.view': 'Transaction detail tabs',
    'history.detail.copyRawJson': 'Copy raw JSON',
    'history.detail.peerHeading': 'Linked transaction · {ticker} #{index}',
    'history.detail.loadingPeer': 'Loading the linked transaction…',
    'history.detail.peerError': "Couldn't load the linked transaction. Try again.",
    'history.detail.copyPeerRawJson': 'Copy peer raw JSON',
    'history.detail.peerUnavailableTitle': 'Peer network unavailable',
    'history.detail.peerUnavailable':
        'Peer network not bundled in this wallet; open the block explorer for {ticker} to view {ticker} #{index}.',
    'history.contact.saveAs': 'Save {address} as',
    'history.contact.save': 'Save',
    'history.copy.clipboard': 'Copy to clipboard',
    'history.copy.copied': 'Copied',
    'history.copy.copiedTitle': 'Copied!',
    'history.copy.actionNumber': 'Copy action number',
    'history.copy.fromAddress': 'Copy from address',
    'history.copy.walletAddress': 'Copy address',
    'history.recipients.showHolders': 'Show holders',
    'history.recipients.showRecipients': 'Show recipients',
    'history.recipients.loadingHolders': 'Loading holders…',
    'history.recipients.loadingRecipients': 'Loading recipients…',
    'history.recipients.saved':
        'Saved {count, plural, one {# address} other {# addresses}} as a single contact "{name}".',
    'history.recipients.holderCount':
        '{count, plural, one {# holder} other {# holders}}',
    'history.recipients.recipientCount':
        '{count, plural, one {# recipient} other {# recipients}}',
    'history.recipients.moreNotShown': '… and {count} more not shown',
    'history.recipients.saveAsContact': 'Save {count} as one contact',
    'history.row.linkedTo': 'Linked to {ticker} #{index}',
    'history.row.block': 'Block {block}',
    'history.row.confirmations':
        '{count, plural, one {# Confirmation} other {# Confirmations}}',
    'history.row.receivedAt': 'Received at {label}',
    'history.group.latest': 'Latest {when}',
    'history.status.confirmed': 'Confirmed',
    'history.status.failed': 'Failed',
    'history.status.pending': 'Pending',
    'history.export.noMatchingRows': 'No rows match the current filters.',
    'history.export.open': 'Export…',
    'history.export.title': 'Export history',
    'history.export.format': 'Format',
    'history.export.csv': 'CSV (compact; opens in spreadsheets)',
    'history.export.json': 'JSON (includes linked and raw data)',
    'history.export.columns': 'Columns',
    'history.export.rowCount':
        '{count, plural, one {# history item will be exported.} other {# history items will be exported.}}',
    'history.export.confirm': 'Export',
    'history.export.preparing': 'Preparing…',
    'history.export.progress': 'Preparing {completed} of {total} rows…',
    'history.export.elapsed': '{seconds} seconds elapsed.',
    'history.export.slow': 'Export is taking longer than expected. Cancel, narrow the history filters, and try again.',

    // Copy moved out of JSX literals by the i18n sweep.
    'history.group.pending': 'Pending activity',
    'history.group.undated': 'Date unavailable',
    'history.group.today': 'Today',
    'history.group.yesterday': 'Yesterday',
    'history.summary.launched': 'Launched {tick}',
    'history.summary.launchedSupply': 'Launched {tick} (supply {supply})',
    'history.summary.dispenser':
        '{count, plural, one {Dispenser at {source}: # dispense} other {Dispenser at {source}: # dispenses}}',
    'history.summary.orderFills': '{count, plural, one {Limit order: # fill} other {Limit order: # fills}}',
    'history.summary.batch': '{count, plural, one {Batch: # action} other {Batch: # actions}}',
    'history.summary.link': 'Cross-chain link: {peer} ↔ {leader}',
    'history.summary.linkSolo': 'Cross-chain link: {leader}',
    'history.summary.linkSameChain': 'Link: {peer} ↔ {leader}',
    'history.summary.linkSameChainSolo': 'Link: {leader}',
};

addEnglish(messages);

export default messages;
