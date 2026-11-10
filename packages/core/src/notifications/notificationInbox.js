// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getDefaultAlertInbox } from '../shared/alertInbox.js';

const PAYMENT_KINDS = new Set(['coinpay-required', 'coinpay-autopay', 'payment-deadline', 'deadline']);
const MESSAGE_KINDS = new Set(['incoming-message', 'message']);

export function notificationType(kind) {
    if (kind === 'price-alert') return 'price';
    if (PAYMENT_KINDS.has(kind) || String(kind).includes('coinpay') || String(kind).includes('payment')) return 'payments';
    if (MESSAGE_KINDS.has(kind) || String(kind).includes('message')) return 'messages';
    if (String(kind).includes('security') || String(kind).includes('unlock')) return 'security';
    if (String(kind).includes('migration') || String(kind).includes('wallet')) return 'wallet';
    return 'activity';
}

function identity(payload, now) {
    const data = payload?.data || {};
    const sourceId = data.alertId ?? data.txHash ?? data.actionIndex ?? data.pollIndex
        ?? data.matchIndex ?? data.deadlineId ?? data.id;
    if (sourceId !== undefined && sourceId !== null && sourceId !== '') {
        return `notification:${payload.kind}:${String(sourceId)}`;
    }
    const text = `${payload.kind}|${payload.title}|${payload.body}`;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return `notification:${payload.kind}:${(hash >>> 0).toString(36)}:${now}`;
}

export function notificationToAlert(payload, at = Date.now()) {
    return {
        id: identity(payload, at),
        type: notificationType(payload?.kind),
        title: String(payload?.title || 'Wallet alert'),
        message: String(payload?.body || ''),
        at,
        read: false,
    };
}

export function withAlertInbox(notify, { recordAlert, now, logger } = {}) {
    const record = typeof recordAlert === 'function'
        ? recordAlert
        : (alert) => getDefaultAlertInbox().record(alert);
    const clock = typeof now === 'function' ? now : Date.now;
    return async (payload) => {
        try { await record(notificationToAlert(payload, clock())); }
        catch (error) { logger?.warn?.('Notification inbox write failed', error); }
        return notify(payload);
    };
}
