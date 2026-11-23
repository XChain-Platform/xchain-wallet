// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const DEFAULT_KEY = 'xchain.alertInbox.v1';
const DEFAULT_LIMIT = 500;
const TYPES = new Set(['price', 'activity', 'payments', 'messages', 'security', 'wallet']);
const ATTENTION = new Set(['autopay-cannot-sign']);

export const NOTIFICATIONS_CHANGED_EVENT = 'xc:notifications-changed';

/** Tells notification consumers to re-read state that changed. */
export function announceNotificationsChanged({ refreshCoinpayObligations = false } = {}) {
    try {
        const event = refreshCoinpayObligations && typeof CustomEvent === 'function'
            ? new CustomEvent(NOTIFICATIONS_CHANGED_EVENT, { detail: { refreshCoinpayObligations: true } })
            : new Event(NOTIFICATIONS_CHANGED_EVENT);
        globalThis.dispatchEvent?.(event);
    } catch { /* no window */ }
}

function normalizeAlert(value) {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id) return null;
    if (!TYPES.has(value.type) || typeof value.title !== 'string' || typeof value.message !== 'string') return null;
    const at = Number(value.at);
    if (!Number.isFinite(at) || at < 0) return null;
    return {
        id: value.id,
        type: value.type,
        ...(typeof value.label === 'string' && value.label ? { label: value.label } : {}),
        title: value.title,
        message: value.message,
        at,
        read: value.read === true,
        ...(ATTENTION.has(value.attention) ? { attention: value.attention } : {}),
        ...(value.action ? { action: value.action } : {}),
    };
}

async function storageRead(storage, key) {
    if (!storage) return null;
    if (typeof storage.getItem === 'function') return storage.getItem(key);
    if (typeof storage.get === 'function') {
        const value = await storage.get(key);
        return value && typeof value === 'object' && key in value ? value[key] : value;
    }
    return null;
}

async function storageWrite(storage, key, value) {
    if (!storage) return;
    if (typeof storage.setItem === 'function') await storage.setItem(key, value);
    else if (typeof storage.set === 'function') await storage.set({ [key]: value });
}

/** Pure inbox operations over an injected storage adapter. */
export function createAlertInbox(storage, { key = DEFAULT_KEY, limit = DEFAULT_LIMIT } = {}) {
    let memory = '[]';
    let writes = Promise.resolve();

    async function read() {
        let raw;
        try { raw = await storageRead(storage, key); } catch { raw = null; }
        if (typeof raw !== 'string') raw = memory;
        try {
            const rows = JSON.parse(raw);
            return (Array.isArray(rows) ? rows : []).map(normalizeAlert).filter(Boolean)
                .sort((a, b) => b.at - a.at)
                .slice(0, limit);
        } catch {
            return [];
        }
    }

    async function persist(rows) {
        const serialized = JSON.stringify(rows.slice(0, limit));
        memory = serialized;
        await storageWrite(storage, key, serialized);
        return rows.slice(0, limit);
    }

    function update(mutator) {
        const operation = writes.then(async () => persist(mutator(await read())));
        writes = operation.catch(() => {});
        return operation;
    }

    return {
        list: read,
        record(alert) {
            const normalized = normalizeAlert(alert);
            if (!normalized) return Promise.reject(new TypeError('Invalid alert'));
            return update((rows) => {
                const previous = rows.find((row) => row.id === normalized.id);
                const next = { ...normalized, read: previous?.read === true || normalized.read };
                return [next, ...rows.filter((row) => row.id !== next.id)]
                    .sort((a, b) => b.at - a.at);
            });
        },
        // A warning the wallet derives (older recovery phrase format, unread
        // messages) is recorded on its first read, so later builds of the same
        // id find it already read and do not offer it as new.
        markRead(id, alert) {
            return update((rows) => {
                if (!rows.some((row) => row.id === id)) {
                    const recorded = alert && alert.id === id ? normalizeAlert({ ...alert, read: true }) : null;
                    return recorded ? [recorded, ...rows].sort((a, b) => b.at - a.at) : rows;
                }
                return rows.map((row) => row.id === id ? { ...row, read: true } : row);
            });
        },
        markAllRead() {
            return update((rows) => rows.map((row) => row.read ? row : { ...row, read: true }));
        },
        async unreadCount() {
            return (await read()).filter((row) => !row.read).length;
        },
    };
}

function defaultStorage() {
    if (globalThis.chrome?.storage?.local) return globalThis.chrome.storage.local;
    try { return globalThis.localStorage || null; } catch { return null; }
}

let defaultInbox;
export function getDefaultAlertInbox() {
    if (!defaultInbox) defaultInbox = createAlertInbox(defaultStorage());
    return defaultInbox;
}

