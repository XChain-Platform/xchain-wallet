// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// ConnectedSitesSection — §35.1 + §43.5 Connected Sites panel.
//
// Lists ConnectedSite records sorted by lastUsedAt desc. Each row:
//   - origin / appName / lastUsedAt
//   - expandable permissions summary (chains, accounts, sign-message,
//     per-action signAction map)
//   - Disconnect button that deletes the record
//   - Block button that adds the origin to the blocklist (§12 / G009)
//     and evicts the record so any in-flight session stops signing.
//
// A "Blocked origins" subsection at the bottom lists user-blocked
// origins with Unblock buttons, plus an inline form to manually
// block an origin without it being connected first.
//
// Per-action permission *editing* (toggling a single ACTION's
// allow/ask/deny) needs a write handler that's narrower than full
// record replacement; that lands in a follow-up step.

import { useEffect, useState } from 'react';
import { useMessaging } from '../../useMessaging.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useToast } from '../ToastHost.jsx';
import { ROW_HINT, STACK, Status } from './_settingsPrimitives.jsx';
import {
    SIGN_THROTTLE_BURST_MIN,
    SIGN_THROTTLE_BURST_MAX,
    SIGN_THROTTLE_WINDOW_MS_MIN,
    SIGN_THROTTLE_WINDOW_MS_MAX,
} from '../../../schemas/settings.js';
import {
    SIGN_THROTTLE_DEFAULT_BURST,
    SIGN_THROTTLE_DEFAULT_WINDOW_MS,
} from '../../../flows/signThrottle.js';

const ACTION_BTN = {
    background: 'transparent',
    border: '1px solid var(--xc-border)',
    color: 'var(--xc-text)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-2)',
    fontSize: 'var(--xc-text-xs)',
    cursor: 'pointer',
};

const SITE_BLOCK = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-2)',
    padding: 'var(--xc-space-3)',
    background: 'var(--xc-surface-raised)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
};

export function ConnectedSitesSection() {
    const { messaging } = useMessaging();
    const { showToast } = useToast();
    const [sites, setSites] = useState(/** @type {any[] | null} */ (null));
    const [blocked, setBlocked] = useState(/** @type {string[]} */ ([]));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [expanded, setExpanded] = useState(/** @type {Set<string>} */ (new Set()));
    const [manualBlock, setManualBlock] = useState('');

    const blocklistWired = typeof messaging?.listBlockedOrigins === 'function'
        && typeof messaging?.blockOrigin === 'function'
        && typeof messaging?.unblockOrigin === 'function';

    const reload = async () => {
        if (typeof messaging?.listConnectedSites !== 'function') {
            setError('Connected-sites is not wired in this shell yet.');
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const [siteList, blockedList] = await Promise.all([
                messaging.listConnectedSites(),
                blocklistWired ? messaging.listBlockedOrigins() : Promise.resolve([]),
            ]);
            setSites(Array.isArray(siteList) ? siteList : []);
            setBlocked(Array.isArray(blockedList) ? blockedList : []);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const onDisconnect = async (id) => {
        // §37.2 / Cluster D FOLLOWUP 1 — snapshot the full ConnectedSite
        // record before tearing it down so the Undo toast can re-create
        // it with the same permissions / lastUsedAt / appName instead
        // of forcing the dApp to re-prompt.
        const snapshot = sites ? sites.find((s) => s.id === id) : null;
        try {
            await messaging.deleteConnectedSite({ id });
            await reload();
            if (snapshot && typeof messaging.restoreConnectedSite === 'function') {
                showToast({
                    message: `Disconnected ${snapshot.appName || snapshot.origin}`,
                    actionLabel: 'Undo',
                    onAction: async () => {
                        try {
                            await messaging.restoreConnectedSite({ site: snapshot });
                            await reload();
                        } catch (err) {
                            setError(err instanceof Error ? err.message : String(err));
                        }
                    },
                });
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const onBlock = async (origin) => {
        try {
            await messaging.blockOrigin({ origin });
            await reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const onUnblock = async (origin) => {
        try {
            await messaging.unblockOrigin({ origin });
            await reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const onManualBlockSubmit = async (e) => {
        e.preventDefault();
        const trimmed = manualBlock.trim();
        if (!trimmed) return;
        try {
            await messaging.blockOrigin({ origin: trimmed });
            setManualBlock('');
            await reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Connected sites unavailable: ${error}`} tone="error" />;

    return (
        <div style={STACK}>
            {(!sites || sites.length === 0) ? (
                <Status text="No dApps connected. Sites that call window.xchain.connect appear here." />
            ) : (
                sites.map((site) => {
                    const isOpen = expanded.has(site.id);
                    return (
                        <div key={site.id} style={SITE_BLOCK}>
                            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--xc-space-2)' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                                    <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>
                                        {site.appName || site.origin}
                                    </span>
                                    <span style={ROW_HINT}>{site.origin}</span>
                                    <span style={ROW_HINT}>
                                        Last used {formatLastUsed(site.lastUsedAt)} · connected {formatLastUsed(site.connectedAt)}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', gap: 'var(--xc-space-1)' }}>
                                    <button
                                        type="button"
                                        onClick={() => setExpanded((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(site.id)) next.delete(site.id); else next.add(site.id);
                                            return next;
                                        })}
                                        style={ACTION_BTN}
                                    >
                                        {isOpen ? 'Hide' : 'Permissions'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onDisconnect(site.id)}
                                        style={ACTION_BTN}
                                    >
                                        Disconnect
                                    </button>
                                    {blocklistWired ? (
                                        <button
                                            type="button"
                                            onClick={() => onBlock(site.origin)}
                                            style={{ ...ACTION_BTN, color: 'var(--xc-error, #c33)', borderColor: 'var(--xc-error, #c33)' }}
                                        >
                                            Block
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                            {isOpen ? <PermissionsSummary permissions={site.permissions} /> : null}
                        </div>
                    );
                })
            )}
            {blocklistWired ? (
                <BlockedOriginsPanel
                    blocked={blocked}
                    manualBlock={manualBlock}
                    setManualBlock={setManualBlock}
                    onSubmit={onManualBlockSubmit}
                    onUnblock={onUnblock}
                />
            ) : null}
            {blocklistWired
                && typeof messaging?.listBlocklistAuditLog === 'function' ? (
                    <BlocklistAuditPanel />
                ) : null}
            <SignThrottlePanel />
        </div>
    );
}

// Cluster S FOLLOWUP 4 — Blocklist audit-log panel.
// Reads the persisted ring-buffer via messaging.listBlocklistAuditLog,
// renders newest-first, and exposes a Clear log button.
function BlocklistAuditPanel() {
    const { messaging } = useMessaging();
    const [entries, setEntries] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [clearing, setClearing] = useState(false);

    const reload = async () => {
        try {
            const list = await messaging.listBlocklistAuditLog();
            setEntries(Array.isArray(list) ? list : []);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const onClear = async () => {
        setClearing(true);
        try {
            await messaging.clearBlocklistAuditLog();
            await reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setClearing(false);
        }
    };

    if (entries === null) return null;
    return (
        <div style={SITE_BLOCK}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--xc-space-2)' }}>
                <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Blocklist audit log</span>
                <button
                    type="button"
                    onClick={onClear}
                    disabled={clearing || entries.length === 0}
                    style={ACTION_BTN}
                >
                    {clearing ? 'Clearing…' : 'Clear log'}
                </button>
            </div>
            <span style={ROW_HINT}>
                Recent blocklist mutations (most recent last). Capped at 50
                entries; older ones fall off automatically. Use this to spot
                an unexpected change to the blocklist before it costs you.
            </span>
            {entries.length === 0 ? (
                <span style={ROW_HINT}>No mutations yet.</span>
            ) : (
                <ul
                    style={{
                        margin: 0,
                        padding: 0,
                        listStyle: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--xc-space-1)',
                        maxHeight: '12rem',
                        overflowY: 'auto',
                    }}
                >
                    {[...entries].reverse().map((entry, idx) => (
                        <li
                            key={`${entry.at}:${idx}`}
                            style={{
                                display: 'flex',
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 'var(--xc-space-2)',
                                fontSize: 'var(--xc-text-xs)',
                            }}
                        >
                            <span style={{ color: 'var(--xc-text-muted)', minWidth: '6.5rem' }}>
                                {formatLastUsed(new Date(entry.at).toISOString())}
                            </span>
                            <span style={{ color: entry.action === 'add' ? 'var(--xc-error, #c33)' : 'var(--xc-text)' }}>
                                {entry.action === 'add' ? 'block' : 'unblock'}
                            </span>
                            <span style={{ color: 'var(--xc-text)', flex: 1, wordBreak: 'break-all', textAlign: 'right' }}>
                                {entry.entry}
                                {Array.isArray(entry.evictedSiteIds) && entry.evictedSiteIds.length > 0 ? (
                                    <span style={{ color: 'var(--xc-text-muted)', marginLeft: 4 }}>
                                        (+{entry.evictedSiteIds.length} site
                                        {entry.evictedSiteIds.length === 1 ? '' : 's'} evicted)
                                    </span>
                                ) : null}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {error ? <Status text={error} tone="error" /> : null}
        </div>
    );
}

// Cluster S FOLLOWUP 1 — Sign-request throttle limits panel.
// Reads / edits `settings.signThrottle.{burst, windowMs}`. Empty values
// fall back to defaults at the throttle layer (createSignThrottle), so
// the user can clear an input to "unset" it without typing the default.
function SignThrottlePanel() {
    const { settings, update } = useSettings();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));

    const currentBurst = settings?.signThrottle?.burst;
    const currentWindowMs = settings?.signThrottle?.windowMs;

    const [burstInput, setBurstInput] = useState(
        typeof currentBurst === 'number' ? String(currentBurst) : '',
    );
    const [windowSecondsInput, setWindowSecondsInput] = useState(
        typeof currentWindowMs === 'number' ? String(Math.round(currentWindowMs / 1000)) : '',
    );

    useEffect(() => {
        setBurstInput(typeof currentBurst === 'number' ? String(currentBurst) : '');
        setWindowSecondsInput(
            typeof currentWindowMs === 'number' ? String(Math.round(currentWindowMs / 1000)) : '',
        );
    }, [currentBurst, currentWindowMs]);

    const onApply = async (e) => {
        e.preventDefault();
        setError(null);
        const next = {};
        if (burstInput.trim() === '') {
            next.burst = undefined;
        } else {
            const burstN = Math.floor(Number(burstInput));
            if (!Number.isFinite(burstN)
                || burstN < SIGN_THROTTLE_BURST_MIN
                || burstN > SIGN_THROTTLE_BURST_MAX) {
                setError(`Burst must be an integer between ${SIGN_THROTTLE_BURST_MIN} and ${SIGN_THROTTLE_BURST_MAX}.`);
                return;
            }
            next.burst = burstN;
        }
        if (windowSecondsInput.trim() === '') {
            next.windowMs = undefined;
        } else {
            const seconds = Math.floor(Number(windowSecondsInput));
            const ms = seconds * 1000;
            if (!Number.isFinite(ms)
                || ms < SIGN_THROTTLE_WINDOW_MS_MIN
                || ms > SIGN_THROTTLE_WINDOW_MS_MAX) {
                const minS = SIGN_THROTTLE_WINDOW_MS_MIN / 1000;
                const maxS = SIGN_THROTTLE_WINDOW_MS_MAX / 1000;
                setError(`Window must be an integer number of seconds between ${minS} and ${maxS}.`);
                return;
            }
            next.windowMs = ms;
        }
        try {
            setSubmitting(true);
            // Strip undefined keys so the patch doesn't overwrite a
            // sibling field with an explicit undefined.
            /** @type {Record<string, number>} */
            const patch = {};
            if (next.burst !== undefined) patch.burst = next.burst;
            if (next.windowMs !== undefined) patch.windowMs = next.windowMs;
            await update({ signThrottle: patch });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitting(false);
        }
    };

    const effectiveBurst = typeof currentBurst === 'number' ? currentBurst : SIGN_THROTTLE_DEFAULT_BURST;
    const effectiveWindowSec = typeof currentWindowMs === 'number'
        ? Math.round(currentWindowMs / 1000)
        : SIGN_THROTTLE_DEFAULT_WINDOW_MS / 1000;

    const FIELD = {
        background: 'var(--xc-surface)',
        border: '1px solid var(--xc-border)',
        color: 'var(--xc-text)',
        borderRadius: 'var(--xc-radius-sm)',
        padding: 'var(--xc-space-1) var(--xc-space-2)',
        fontSize: 'var(--xc-text-sm)',
        width: '5rem',
    };
    return (
        <div style={SITE_BLOCK}>
            <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Sign-request throttle</span>
            <span style={ROW_HINT}>
                Per-origin token bucket (§12 / G012) — caps how many sign requests
                a single dApp can fire inside a window before further requests
                reject with <code style={{ fontFamily: 'var(--xc-font-mono, monospace)' }}>THROTTLED</code>.
                Lower numbers harden against abuse; higher numbers help during
                heavy normal use. Defaults: {SIGN_THROTTLE_DEFAULT_BURST} per{' '}
                {SIGN_THROTTLE_DEFAULT_WINDOW_MS / 1000} s.
            </span>
            <span style={ROW_HINT}>
                Currently in effect: <strong>{effectiveBurst}</strong> per{' '}
                <strong>{effectiveWindowSec} s</strong>.
            </span>
            <form
                onSubmit={onApply}
                style={{
                    display: 'flex',
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 'var(--xc-space-2)',
                }}
            >
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--xc-text-xs)' }}>
                    <span style={{ color: 'var(--xc-text-muted)' }}>Burst</span>
                    <input
                        type="number"
                        min={SIGN_THROTTLE_BURST_MIN}
                        max={SIGN_THROTTLE_BURST_MAX}
                        step={1}
                        value={burstInput}
                        onChange={(e) => setBurstInput(e.target.value)}
                        placeholder={String(SIGN_THROTTLE_DEFAULT_BURST)}
                        aria-label="Sign-throttle burst (max requests per window)"
                        style={FIELD}
                    />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--xc-text-xs)' }}>
                    <span style={{ color: 'var(--xc-text-muted)' }}>Window (seconds)</span>
                    <input
                        type="number"
                        min={SIGN_THROTTLE_WINDOW_MS_MIN / 1000}
                        max={SIGN_THROTTLE_WINDOW_MS_MAX / 1000}
                        step={1}
                        value={windowSecondsInput}
                        onChange={(e) => setWindowSecondsInput(e.target.value)}
                        placeholder={String(SIGN_THROTTLE_DEFAULT_WINDOW_MS / 1000)}
                        aria-label="Sign-throttle window in seconds"
                        style={FIELD}
                    />
                </label>
                <button
                    type="submit"
                    disabled={submitting}
                    style={{ ...ACTION_BTN, padding: 'var(--xc-space-2)' }}
                >
                    {submitting ? 'Applying…' : 'Apply'}
                </button>
            </form>
            {error ? (
                <Status text={error} tone="error" />
            ) : null}
        </div>
    );
}

function BlockedOriginsPanel({ blocked, manualBlock, setManualBlock, onSubmit, onUnblock }) {
    return (
        <div style={{ ...SITE_BLOCK, borderColor: 'var(--xc-border)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)' }}>
                <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Blocked origins</span>
                <span style={ROW_HINT}>
                    Blocked origins cannot connect or sign. Sign requests reject with{' '}
                    <code style={{ fontFamily: 'var(--xc-font-mono, monospace)' }}>BLOCKED_BY_USER</code>{' '}
                    until you remove the origin. Wildcards like{' '}
                    <code style={{ fontFamily: 'var(--xc-font-mono, monospace)' }}>*.example.com</code>{' '}
                    block every subdomain (the bare apex is separate — add{' '}
                    <code style={{ fontFamily: 'var(--xc-font-mono, monospace)' }}>example.com</code>{' '}
                    too if you want to cover it).
                </span>
                {blocked.length === 0 ? (
                    <span style={ROW_HINT}>No origins blocked.</span>
                ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-1)' }}>
                        {blocked.map((origin) => (
                            <li
                                key={origin}
                                style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--xc-space-2)' }}
                            >
                                <span style={{ color: 'var(--xc-text)', wordBreak: 'break-all' }}>{origin}</span>
                                <button type="button" onClick={() => onUnblock(origin)} style={ACTION_BTN}>
                                    Unblock
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'row', gap: 'var(--xc-space-2)' }}>
                    <input
                        type="text"
                        value={manualBlock}
                        onChange={(e) => setManualBlock(e.target.value)}
                        placeholder="https://example.com or *.example.com"
                        aria-label="Origin or wildcard to block"
                        style={{
                            flex: 1,
                            background: 'var(--xc-surface)',
                            border: '1px solid var(--xc-border)',
                            color: 'var(--xc-text)',
                            borderRadius: 'var(--xc-radius-sm)',
                            padding: 'var(--xc-space-1) var(--xc-space-2)',
                            fontSize: 'var(--xc-text-sm)',
                        }}
                    />
                    <button
                        type="submit"
                        disabled={!manualBlock.trim()}
                        style={{ ...ACTION_BTN, color: 'var(--xc-error, #c33)', borderColor: 'var(--xc-error, #c33)' }}
                    >
                        Block
                    </button>
                </form>
            </div>
        </div>
    );
}

function PermissionsSummary({ permissions }) {
    if (!permissions) {
        return <div style={ROW_HINT}>No permission record.</div>;
    }
    const chains = permissions.chains || [];
    const accounts = permissions.accounts || [];
    const actions = permissions.canSignAction || {};
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-1)', fontSize: 'var(--xc-text-xs)' }}>
            <PermRow label="Chains" value={chains.length === 0 ? 'none' : chains.join(', ')} />
            <PermRow label="Accounts" value={accounts.length === 0 ? 'none' : accounts.join(', ')} />
            <PermRow label="Sign messages" value={permissions.canSignMessage ? 'allow' : 'deny'} />
            {Object.keys(actions).length === 0 ? (
                <PermRow label="Sign actions" value="none granted" />
            ) : (
                <div>
                    <div style={{ color: 'var(--xc-text-muted)' }}>Sign actions</div>
                    <ul style={{ margin: 0, paddingLeft: 'var(--xc-space-3)', listStyle: 'disc' }}>
                        {Object.entries(actions).map(([action, perm]) => (
                            <li key={action} style={{ color: 'var(--xc-text)' }}>
                                <code style={{ fontFamily: 'var(--xc-font-mono, monospace)' }}>{action}</code>
                                {' — '}
                                <span style={{ color: permColor(perm) }}>{perm}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function PermRow({ label, value }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--xc-text-muted)' }}>{label}</span>
            <span style={{ color: 'var(--xc-text)', wordBreak: 'break-all' }}>{value}</span>
        </div>
    );
}

function permColor(perm) {
    if (perm === 'allow') return 'var(--xc-success, #2a8)';
    if (perm === 'deny') return 'var(--xc-error, #c33)';
    return 'var(--xc-text-muted)';
}

function formatLastUsed(iso) {
    if (!iso) return 'never';
    try {
        const d = new Date(iso);
        const now = Date.now();
        const diff = (now - d.getTime()) / 1000;
        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (diff < 86400 * 14) return `${Math.floor(diff / 86400)}d ago`;
        return d.toISOString().slice(0, 10);
    } catch {
        return iso;
    }
}
