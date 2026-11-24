// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The single source of the wallet-level alerts the Alerts panel lists.
// Keep every alert and its wording here, so no shell carries a copy that drifts.
//
// A shell surfaces an alert by passing its handler and hides it by passing
// nothing, the same contract as the Actions menu (actionEntries.js).

import { pendingMigrationSweeps } from '../flows/migrationSweeps.js';
import { defaultRegistry } from '../registry/index.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import { airdropCopy, fitAlertCopy, paymentDueCopy } from './alertCopy.js';

/** The coin ticker for a chain id, or '' when the chain is unknown. */
function tickerForChainId(chainId) {
    try {
        const descriptor = defaultRegistry().get(chainId);
        return descriptor ? tickerForCoin(descriptor.coin) : '';
    } catch {
        return '';
    }
}

/**
 * The Home notices that announce something to act on (a payment due on a
 * matched order, a pending airdrop to resume), as notification items with the
 * same wording and the same destination as the Home notice. Pure: the caller
 * passes the rows Home reads and the handlers that open each destination.
 *
 * `coinpaysIncomplete` marks a payments-due scan that was capped: the rows
 * passed may omit the oldest pending payment, so one extra item says the list
 * is partial and opens the pay form with no payment named, which runs its own
 * scan and says when that scan is partial too, even when no row was returned.
 *
 * @param {{ pendingCoinpays?: any[], coinpaysIncomplete?: boolean, pendingAirdrops?: any[], isWatcherMode?: boolean, at?: number }} state
 * @param {{ onResumeCoinpay?: (ref: object) => void, onResumeAirdrop?: (id: string) => void }} [handlers]
 * @returns {WalletAlert[]}
 */
export function buildPendingNoticeAlerts({ pendingCoinpays = [], coinpaysIncomplete = false, pendingAirdrops = [], isWatcherMode = false, at = Date.now() } = {}, handlers = {}) {
    const { onResumeCoinpay, onResumeAirdrop } = handlers || {};
    const alerts = [];
    if (typeof onResumeCoinpay === 'function' && coinpaysIncomplete === true) {
        alerts.push({
            id: 'payment-due:incomplete',
            type: 'payments',
            severity: 'info',
            ...fitAlertCopy({ label: 'Payment due', title: 'Some payments did not load', message: 'Older payments may be missing' }),
            at,
            read: false,
            action: { label: 'Review payments', onSelect: () => onResumeCoinpay({}) },
        });
    }
    if (typeof onResumeCoinpay === 'function') {
        for (const rec of Array.isArray(pendingCoinpays) ? pendingCoinpays : []) {
            if (!rec) continue;
            const ticker = tickerForChainId(rec.chainId);
            alerts.push({
                id: `payment-due:${rec.chainId}:${rec.orderMatchActionIndex}`,
                type: 'payments',
                severity: 'info',
                ...(rec.attention ? { attention: rec.attention } : {}),
                ...paymentDueCopy({ amount: rec.coinAmount, ticker, order: rec.orderMatchActionIndex, watcher: isWatcherMode }),
                at,
                read: false,
                action: {
                    label: 'Pay now',
                    onSelect: () => onResumeCoinpay({
                        chainId: rec.chainId,
                        address: rec.address,
                        orderMatchActionIndex: rec.orderMatchActionIndex,
                    }),
                },
            });
        }
    }
    if (!isWatcherMode && typeof onResumeAirdrop === 'function') {
        for (const rec of Array.isArray(pendingAirdrops) ? pendingAirdrops : []) {
            if (!rec?.id) continue;
            alerts.push({
                id: `airdrop-pending:${rec.id}`,
                type: 'activity',
                severity: 'info',
                ...airdropCopy({ amount: rec.amountPer, token: rec.token, count: rec.recipients?.length ?? 0, stage: rec.stage }),
                at,
                read: false,
                action: { label: 'Resume airdrop', onSelect: () => onResumeAirdrop(rec.id) },
            });
        }
    }
    return alerts;
}

const NOTICE_ID_PREFIXES = ['payment-due:', 'airdrop-pending:'];

// Alert ids that need the user to act, not just read, and that stay live only
// while the thing is pending: a payment due on a matched order, an airdrop
// waiting to be signed or resumed, an unfinished migration sweep. Everything
// else (a confirmed transaction, a price move, unread messages, the stored
// history rows, the older-phrase-format offer) is ordinary.
const ACTION_REQUIRED_ID_PREFIXES = ['payment-due:', 'airdrop-pending:', 'migration-sweeps'];

/** True for an alert that needs the user to act (drives the red bell). */
export function isActionRequiredAlert(alert) {
    const id = alert?.id;
    return typeof id === 'string' && ACTION_REQUIRED_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/** True for an id of a notice-backed item (payment due, pending airdrop). */
export function isNoticeAlertId(id) {
    return typeof id === 'string' && NOTICE_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/**
 * Drops the stored copy of a notice-backed item whose notice is no longer
 * pending. These items are live, not history: they list only while the notice
 * is pending, whether or not they were read. Every list and counter filters
 * stored rows through this, so no shell shows a dead copy.
 *
 * @param {any[]} rows        stored inbox rows
 * @param {any[]} liveNotices items buildPendingNoticeAlerts returned now
 * @returns {any[]}
 */
export function withoutDeadNoticeAlerts(rows, liveNotices = []) {
    const live = new Set((Array.isArray(liveNotices) ? liveNotices : []).map((alert) => alert?.id));
    return (Array.isArray(rows) ? rows : []).filter((row) => !isNoticeAlertId(row?.id) || live.has(row.id));
}

/**
 * @typedef {Object} WalletAlert
 * @property {string} id              stable alert id, also the list key
 * @property {'price'|'activity'|'payments'|'messages'|'security'|'wallet'} type
 * @property {string} title
 * @property {string} message
 * @property {{ label: string, onSelect: () => void }} action
 */

/**
 * Build the alerts for the active wallet, in the order the panel lists them.
 *
 * @param {{ activeWallet?: { format?: string }|null, messagingUnread?: number, inboxAlerts?: WalletAlert[], at?: number }} state
 * @param {{ onMessaging?: () => void, onMigrateToBip39?: () => void }} [handlers]
 * @returns {WalletAlert[]}
 */
export function buildWalletAlerts({ activeWallet = null, messagingUnread = 0, inboxAlerts = [], at = Date.now() } = {}, handlers = {}) {
    const { onMessaging, onMigrateToBip39 } = handlers || {};
    const alerts = [];
    // Show unread messages only when the shell can open Messaging.
    if (messagingUnread > 0 && typeof onMessaging === 'function') {
        alerts.push({
            id: 'unread-messages',
            type: 'messages',
            severity: 'info',
            label: 'Messages',
            title: 'Unread messages',
            message: messagingUnread === 1
                ? '1 conversation has unread messages'
                : `${messagingUnread > 99 ? '99+' : messagingUnread} conversations have unread messages`,
            at,
            read: false,
            action: { label: 'Open Messaging', onSelect: onMessaging },
        });
    }
    // Offer the BIP39 upgrade only for a legacy-format wallet the shell can migrate.
    // An upgrade with legacy addresses still to sweep offers its list instead,
    // since a second upgrade would make another phrase and another wallet.
    const migrationOpen = activeWallet?.format === 'counterwallet-legacy'
        && typeof onMigrateToBip39 === 'function'
        && pendingMigrationSweeps(activeWallet?.id) !== null;
    if (migrationOpen) {
        alerts.push({
            id: 'migration-sweeps',
            type: 'wallet',
            severity: 'info',
            label: 'Wallet',
            title: 'Migration in progress',
            message: 'Some addresses are not swept yet',
            at,
            read: false,
            action: { label: 'Continue migration', onSelect: onMigrateToBip39 },
        });
    } else if (activeWallet?.format === 'counterwallet-legacy' && typeof onMigrateToBip39 === 'function') {
        alerts.push({
            id: 'legacy-format',
            type: 'wallet',
            severity: 'info',
            label: 'Wallet',
            title: 'Older recovery phrase format',
            message: 'Upgrade to a standard BIP39 phrase',
            at,
            read: false,
            action: { label: 'Upgrade recovery phrase', onSelect: onMigrateToBip39 },
        });
    }
    const persistedById = new Map((Array.isArray(inboxAlerts) ? inboxAlerts : [])
        .filter(Boolean).map((alert) => [alert.id, alert]));
    for (let index = 0; index < alerts.length; index += 1) {
        const stored = persistedById.get(alerts[index].id);
        if (stored) alerts[index] = { ...stored, ...alerts[index], at: stored.at, read: stored.read === true };
    }
    const derivedIds = new Set(alerts.map((alert) => alert.id));
    const persisted = (Array.isArray(inboxAlerts) ? inboxAlerts : [])
        .filter((alert) => alert && !derivedIds.has(alert.id));
    return [...alerts, ...persisted].sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
}
