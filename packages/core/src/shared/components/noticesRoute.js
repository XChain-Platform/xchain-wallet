// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { createContext } from 'react';

/**
 * The current route key, provided around the layout's notices so a notice
 * can close its own disclosures when the user navigates.
 */
export const NoticesRouteContext = createContext(/** @type {string | null} */ (null));

/**
 * The shell's notices, published by `<FullLayoutWithNav>` to the route's
 * `<Screen>`. The notices stay mounted at the layout (their state, polls and
 * live regions survive route changes) and render into one detached `host`
 * element; the outermost Screen moves that element into its scrolling body,
 * above the route content and below the page header.
 *
 * `claim(slot)` moves the host into `slot` and returns a release function.
 * Claims stack, so an overlay Screen mounted beside the route hands the
 * notices back to the route when it closes. With no claim the host sits in
 * the layout's fallback slot at the top of the route area.
 *
 * @typedef {{
 *   claim: (slot: HTMLElement) => () => void,
 *   setReachabilityHidden: (update: (count: number) => number) => void,
 *   setReachabilityWanted: (update: (count: number) => number) => void,
 * }} ShellNotices
 */
export const ShellNoticesContext = createContext(/** @type {ShellNotices | null} */ (null));

/** True below a Screen that already renders the shell notices. */
export const NoticesClaimedContext = createContext(false);

/** True while the current screen states the reachability problem itself. */
export const ReachabilityNoticeHiddenContext = createContext(false);

/**
 * Where the shell's reachability notice reports what it says, so the route
 * below can carry it once. Provided to the notices only.
 *
 * @typedef {{ variant: 'error' | 'warning', text: string, retryLabel: string, retrying: boolean, retry: () => void, coins?: Array<{ key: string, name: string, iconUrl: string | null }>, lastChecked?: number | null, hiddenCount?: number }} ShellReachabilityNotice
 */
export const ReachabilityNoticeReportContext = createContext(
    /** @type {null | ((notice: ShellReachabilityNotice | null) => void)} */ (null),
);

/**
 * The shell's reachability notice while the services are degraded or
 * offline on a screen that holds network data, whether or not it is drawn
 * at the moment, with `hiddenCount`, the number of screens hiding it because
 * they state the outage themselves; null otherwise. A route reads it to keep its page at one
 * message: an empty state for data that could not be checked steps aside,
 * and a form folds the sentence into its own notice.
 */
export const ShellReachabilityNoticeContext = createContext(
    /** @type {ShellReachabilityNotice | null} */ (null),
);

// Screens that hold no balances and no balance-derived figures. The shell's
// reachability notice names balances only where a balance is on screen; on
// these it says the screen's information in general may be out of date.
const VIEWS_WITHOUT_BALANCES = new Set([
    'receive', 'receive-picker', 'contacts', 'obligations', 'settings',
    'scan', 'menu', 'lists', 'shared-lists', 'list-detail', 'messaging',
    'dispensers-list', 'contracts-list', 'markets', 'connected-sites',
    'alerts', 'addresses', 'address-preferences', 'advanced',
    'wallet-details', 'wallet-picker', 'account-picker', 'access-lists',
    'add-wallet', 'add-account', 'wallet-rename', 'account-rename',
    'sign-message', 'verify-signature', 'view-private-key', 'migrate-bip39',
    'pair-signer', 'dispenser-explorer', 'market-activity',
]);

// Screens whose content is held on this device (the address book, connected
// sites, alerts, agent accounts, the scanner, signature checks, Settings). Nothing on
// them goes out of date with the network, so the shell's reachability notice
// is not shown there and their own messages (an empty address book) stand.
const VIEWS_WITH_LOCAL_DATA_ONLY = new Set([
    'contacts', 'connected-sites', 'alerts', 'cosigner-accounts', 'scan',
    'verify-signature', 'settings',
]);

/**
 * Whether the route shows anything read from the network. The route key is
 * the shell's `<view>:<navigation key>`; a missing key counts as network data.
 *
 * @param {string | null | undefined} routeKey
 * @returns {boolean}
 */
export function routeHoldsNetworkData(routeKey) {
    if (!routeKey) return true;
    return !VIEWS_WITH_LOCAL_DATA_ONLY.has(String(routeKey).split(':')[0]);
}

/**
 * Whether the route may show a balance. The route key is the shell's
 * `<view>:<navigation key>`; a missing key is treated as a balance screen.
 *
 * @param {string | null | undefined} routeKey
 * @returns {boolean}
 */
export function routeMayShowBalances(routeKey) {
    if (!routeKey) return true;
    return !VIEWS_WITHOUT_BALANCES.has(String(routeKey).split(':')[0]);
}

/**
 * True while a screen on a local-data route asks for the reachability notice
 * (Settings' Network & endpoints section, where a user fixes reachability).
 */
export const ReachabilityNoticeWantedContext = createContext(false);
