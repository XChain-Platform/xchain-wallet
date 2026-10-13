// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ConnectedSitesSection: §35.1 + §43.5 Connected Sites panel.
//
// Lists ConnectedSite records sorted by lastUsedAt desc. Each row:
//   - origin / appName / lastUsedAt
//   - expandable permissions summary (chains, accounts, sign-message,
//     per-action signAction map)
//   - Disconnect button that confirms revocation, then deletes the record
//   - Block button that adds the origin to the blocklist (§12 / G009)
//     and evicts the record so any in-flight session stops signing.
//
// A "Blocked origins" subsection at the bottom lists user-blocked
// origins with Unblock buttons, plus an inline form to manually
// block an origin without it being connected first.
//
import { useEffect, useState } from 'react';
import { Button, EmptyState, FormErrorSummary } from '@xchain-wallet/core/ui';
import { useMessaging } from '../../useMessaging.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useConfirmModal } from '../../hooks/useConfirmModal.js';
import { ConfirmModal } from '../ConfirmModal.jsx';
import { useToast } from '../ToastHost.jsx';
import { INPUT, ROW, ROW_HINT, ROW_VALUE, STACK, Status } from './_settingsPrimitives.jsx';
import { actionDisplayLabel } from '../../utils/actionDisplayLabel.js';
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
import { blurNumberInputOnWheel } from '../../utils/formInput.js';

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
    ...ROW,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 'var(--xc-space-2)',
};

export function ConnectedSitesSection() {
    const { messaging } = useMessaging();
    const { showToast } = useToast();
    const confirmDialog = useConfirmModal();
    const [sites, setSites] = useState(/** @type {any[] | null} */ (null));
    const [blocked, setBlocked] = useState(/** @type {string[]} */ ([]));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [expanded, setExpanded] = useState(/** @type {Set<string>} */ (new Set()));
    const [manualBlock, setManualBlock] = useState('');
    const [pendingAction, setPendingAction] = useState(/** @type {string | null} */ (null));

    const blocklistWired = typeof messaging?.listBlockedOrigins === 'function'
        && typeof messaging?.blockOrigin === 'function'
        && typeof messaging?.unblockOrigin === 'function';

    const reload = async () => {
        if (typeof messaging?.listConnectedSites !== 'function') {
            setError('Connected sites are unavailable in this app.');
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
        if (pendingAction) return;
        // §37.2 / Cluster D FOLLOWUP 1: snapshot the full ConnectedSite
        // record before tearing it down so the Undo toast can re-create
        // it with the same permissions / lastUsedAt / appName instead
        // of forcing the dApp to re-prompt.
        const snapshot = sites ? sites.find((s) => s.id === id) : null;
        if (!snapshot) return;
        const confirmed = await confirmDialog.confirm({
            title: `Disconnect ${snapshot.appName || snapshot.origin}?`,
            message: `${snapshot.origin} will lose access to the accounts you shared and will no longer be able to ask for signatures. You can reconnect the site later.`,
            confirmLabel: 'Disconnect site',
            danger: true,
        });
        if (!confirmed) return;
        setPendingAction(`disconnect:${id}`);
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
        } finally {
            setPendingAction(null);
        }
    };

    const onBlock = async (origin, pendingKey = `block:${origin}`) => {
        if (pendingAction) return false;
        const confirmed = await confirmDialog.confirm({
            title: `Block ${origin}?`,
            message: 'This disconnects the site and prevents it from connecting or asking you to sign until you unblock it.',
            confirmLabel: 'Block site',
            danger: true,
        });
        if (!confirmed) return false;
        setPendingAction(pendingKey);
        try {
            await messaging.blockOrigin({ origin });
            await reload();
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            return false;
        } finally {
            setPendingAction(null);
        }
    };

    const onUnblock = async (origin) => {
        if (pendingAction) return;
        setPendingAction(`unblock:${origin}`);
        try {
            await messaging.unblockOrigin({ origin });
            await reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setPendingAction(null);
        }
    };

    const onManualBlockSubmit = async (e) => {
        e.preventDefault();
        const trimmed = manualBlock.trim();
        if (!trimmed || pendingAction) return;
        const blockedOrigin = await onBlock(trimmed, 'block:manual');
        if (blockedOrigin) {
            setManualBlock('');
        }
    };

    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Connected sites unavailable: ${error}`} tone="error" />;

    return (
        <div style={STACK}>
            {(!sites || sites.length === 0) ? (
                <EmptyState
                    title="No sites connected yet"
                    body="When a website asks to connect to this wallet and you allow it, it appears here."
                    titleAs="p"
                />
            ) : (
                sites.map((site) => {
                    const isOpen = expanded.has(site.id);
                    return (
                        <div key={site.id} style={SITE_BLOCK}>
                            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--xc-space-2)' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                                    <span style={ROW_VALUE}>
                                        {site.appName || site.origin}
                                    </span>
                                    <span style={ROW_HINT}>{site.origin}</span>
                                    <span style={ROW_HINT}>
                                        Last used {formatLastUsed(site.lastUsedAt)} · connected {formatLastUsed(site.connectedAt)}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--xc-space-1)' }}>
                                    <button
                                        type="button"
                                        aria-expanded={isOpen}
                                        onClick={() => setExpanded((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(site.id)) next.delete(site.id); else next.add(site.id);
                                            return next;
                                        })}
                                        style={ACTION_BTN}
                                    >
                                        {isOpen ? 'Hide' : 'Permissions'}
                                    </button>
                                    <Button
                                        size="sm"
                                        variant="danger"
                                        onClick={() => onDisconnect(site.id)}
                                        loading={pendingAction === `disconnect:${site.id}`}
                                        disabled={pendingAction !== null}
                                    >
                                        Disconnect
                                    </Button>
                                    {blocklistWired ? (
                                        <Button
                                            size="sm"
                                            variant="danger"
                                            onClick={() => onBlock(site.origin)}
                                            loading={pendingAction === `block:${site.origin}`}
                                            disabled={pendingAction !== null}
                                        >
                                            Block
                                        </Button>
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
                    pendingAction={pendingAction}
                />
            ) : null}
            {blocklistWired
                && typeof messaging?.listBlocklistAuditLog === 'function' ? (
                    <BlocklistAuditPanel confirm={confirmDialog.confirm} />
                ) : null}
            <SignThrottlePanel />
            {confirmDialog.request ? (
                <ConfirmModal
                    {...confirmDialog.request}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            ) : null}
        </div>
    );
}

// Cluster S FOLLOWUP 4: Blocklist audit-log panel.
// Reads the persisted ring-buffer via messaging.listBlocklistAuditLog,
// renders newest-first, and exposes a clear-history button.
function BlocklistAuditPanel({ confirm }) {
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
        if (clearing) return;
        const confirmed = await confirm({
            title: 'Clear site block history?',
            message: 'This permanently deletes the record of sites you blocked or unblocked.',
            confirmLabel: 'Clear history',
            danger: true,
        });
        if (!confirmed) return;
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
                <span style={ROW_VALUE}>Site block history</span>
                <Button
                    type="button"
                    onClick={onClear}
                    disabled={clearing || entries.length === 0}
                    size="sm"
                    variant="danger"
                >
                    {clearing ? 'Clearing…' : 'Clear history'}
                </Button>
            </div>
            <span style={ROW_HINT}>
                Shows the 50 most recent changes, with the newest last. Use
                this history to spot a site that was blocked or unblocked
                unexpectedly.
            </span>
            {entries.length === 0 ? (
                <EmptyState
                    title="No site block history"
                    body="Sites you block or unblock appear here."
                    titleAs="p"
                />
            ) : (
                <ul
                    style={{
                        margin: 0,
                        padding: 0,
                        listStyle: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--xc-space-1)',
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
                            <span style={{ color: entry.action === 'add' ? 'var(--xc-danger-fg)' : 'var(--xc-text)' }}>
                                {entry.action === 'add' ? 'blocked' : 'unblocked'}
                            </span>
                            <span style={{ color: 'var(--xc-text)', flex: 1, wordBreak: 'break-all', textAlign: 'right' }}>
                                {entry.entry}
                                {Array.isArray(entry.evictedSiteIds) && entry.evictedSiteIds.length > 0 ? (
                                    <span style={{ color: 'var(--xc-text-muted)', marginLeft: 4 }}>
                                        ({entry.evictedSiteIds.length} site connection
                                        {entry.evictedSiteIds.length === 1 ? '' : 's'} removed)
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

// Cluster S FOLLOWUP 1: Sign-request throttle limits panel.
// Reads / edits `settings.signThrottle.{burst, windowMs}`. Empty values
// write the documented defaults because the settings patcher deep-merges
// nested objects and cannot remove an existing nested key.
function SignThrottlePanel() {
    const { settings, update } = useSettings();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [validationAttempt, setValidationAttempt] = useState(0);

    const currentBurst = settings?.signThrottle?.burst;
    const currentWindowMs = settings?.signThrottle?.windowMs;

    const [burstInput, setBurstInput] = useState(
        typeof currentBurst === 'number' ? String(currentBurst) : '',
    );
    const [windowSecondsInput, setWindowSecondsInput] = useState(
        typeof currentWindowMs === 'number' ? formatWindowSeconds(currentWindowMs) : '',
    );

    useEffect(() => {
        setBurstInput(typeof currentBurst === 'number' ? String(currentBurst) : '');
        setWindowSecondsInput(
            typeof currentWindowMs === 'number' ? formatWindowSeconds(currentWindowMs) : '',
        );
    }, [currentBurst, currentWindowMs]);

    const onApply = async (e) => {
        e.preventDefault();
        setValidationAttempt((attempt) => attempt + 1);
        if (submitting) return;
        setError(null);
        const patch = {};
        if (burstInput.trim() === '') {
            patch.burst = SIGN_THROTTLE_DEFAULT_BURST;
        } else {
            const burstN = Number(burstInput);
            if (!/^\d+$/.test(burstInput.trim())
                || !Number.isFinite(burstN)
                || burstN < SIGN_THROTTLE_BURST_MIN
                || burstN > SIGN_THROTTLE_BURST_MAX) {
                setError(`Burst must be an integer between ${SIGN_THROTTLE_BURST_MIN} and ${SIGN_THROTTLE_BURST_MAX}.`);
                return;
            }
            patch.burst = burstN;
        }
        if (windowSecondsInput.trim() === '') {
            patch.windowMs = SIGN_THROTTLE_DEFAULT_WINDOW_MS;
        } else {
            const ms = parseWindowSeconds(windowSecondsInput);
            if (ms === null
                || ms < SIGN_THROTTLE_WINDOW_MS_MIN
                || ms > SIGN_THROTTLE_WINDOW_MS_MAX) {
                const minS = SIGN_THROTTLE_WINDOW_MS_MIN / 1000;
                const maxS = SIGN_THROTTLE_WINDOW_MS_MAX / 1000;
                setError(`Window must be between ${minS} and ${maxS} seconds with at most three decimal places.`);
                return;
            }
            patch.windowMs = ms;
        }
        try {
            setSubmitting(true);
            await update({ signThrottle: patch });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitting(false);
        }
    };

    const effectiveBurst = typeof currentBurst === 'number' ? currentBurst : SIGN_THROTTLE_DEFAULT_BURST;
    const effectiveWindowSec = typeof currentWindowMs === 'number'
        ? formatWindowSeconds(currentWindowMs)
        : SIGN_THROTTLE_DEFAULT_WINDOW_MS / 1000;

    const FIELD = { ...INPUT, width: '5rem' };
    const throttleErrorTarget = /^Burst /i.test(error || '')
        ? { id: 'sign-throttle-burst', label: 'Burst' }
        : /^Window /i.test(error || '')
            ? { id: 'sign-throttle-window', label: 'Window' }
            : undefined;
    const throttleErrors = error ? [{ ...throttleErrorTarget, message: error }] : [];
    return (
        <div style={SITE_BLOCK}>
            <span style={ROW_VALUE}>Sign-request throttle</span>
            <span style={ROW_HINT}>
                Limits how many signing requests a single site can make in a
                short window; anything over the limit is rejected until the
                window resets. Lower numbers harden against abuse; higher
                numbers help during heavy normal use. Defaults:{' '}
                {SIGN_THROTTLE_DEFAULT_BURST} per{' '}
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
                        id="sign-throttle-burst"
                        type="number"
                        inputMode="numeric"
                        enterKeyHint="next"
                        autoComplete="off"
                        min={SIGN_THROTTLE_BURST_MIN}
                        max={SIGN_THROTTLE_BURST_MAX}
                        step={1}
                        value={burstInput}
                        onChange={(e) => {
                            setBurstInput(e.target.value);
                            if (error) setError(null);
                        }}
                        onWheel={blurNumberInputOnWheel}
                        placeholder={String(SIGN_THROTTLE_DEFAULT_BURST)}
                        aria-label="Sign-throttle burst (max requests per window)"
                        style={FIELD}
                    />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--xc-text-xs)' }}>
                    <span style={{ color: 'var(--xc-text-muted)' }}>Window (seconds)</span>
                    <input
                        id="sign-throttle-window"
                        type="number"
                        inputMode="decimal"
                        enterKeyHint="go"
                        autoComplete="off"
                        min={SIGN_THROTTLE_WINDOW_MS_MIN / 1000}
                        max={SIGN_THROTTLE_WINDOW_MS_MAX / 1000}
                        step={0.001}
                        value={windowSecondsInput}
                        onChange={(e) => {
                            setWindowSecondsInput(e.target.value);
                            if (error) setError(null);
                        }}
                        onWheel={blurNumberInputOnWheel}
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
            <FormErrorSummary errors={throttleErrors} focusKey={validationAttempt} />
        </div>
    );
}

function BlockedOriginsPanel({ blocked, manualBlock, setManualBlock, onSubmit, onUnblock, pendingAction }) {
    return (
        <div style={{ ...SITE_BLOCK, borderColor: 'var(--xc-border)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)' }}>
                <span style={ROW_VALUE}>Blocked sites</span>
                <span style={ROW_HINT}>
                    Blocked sites cannot connect or ask you to sign until you
                    unblock them. To block every subdomain, use a pattern like{' '}
                    <code style={{ fontFamily: 'var(--xc-font-mono, monospace)' }}>*.example.com</code>{' '}
                    and add{' '}
                    <code style={{ fontFamily: 'var(--xc-font-mono, monospace)' }}>example.com</code>{' '}
                    separately to block the main site too.
                </span>
                {blocked.length === 0 ? (
                    <EmptyState
                        title="No blocked sites"
                        body="Sites you block appear here."
                        titleAs="p"
                    />
                ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-1)' }}>
                        {blocked.map((origin) => (
                            <li
                                key={origin}
                                style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--xc-space-2)' }}
                            >
                                <span style={{ color: 'var(--xc-text)', wordBreak: 'break-all' }}>{origin}</span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => onUnblock(origin)}
                                    loading={pendingAction === `unblock:${origin}`}
                                    disabled={pendingAction !== null}
                                >
                                    Unblock
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
                <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 'var(--xc-space-2)' }}>
                    <input
                        type="text"
                        enterKeyHint="go"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        value={manualBlock}
                        onChange={(e) => setManualBlock(e.target.value)}
                        placeholder="https://example.com or *.example.com"
                        aria-label="Origin or wildcard to block"
                        style={{
                            ...INPUT,
                            flex: 1,
                        }}
                    />
                    <Button
                        type="submit"
                        size="sm"
                        variant="danger"
                        loading={pendingAction === 'block:manual'}
                        disabled={!manualBlock.trim() || pendingAction !== null}
                    >
                        Block
                    </Button>
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
            <PermRow label="Chains" text={chains.length === 0 ? 'None' : chains.join(', ')} />
            <PermRow label="Accounts" text={accounts.length === 0 ? 'None' : accounts.join(', ')} />
            <PermRow
                label="Sign messages"
                text={permissions.canSignMessage ? 'Always allow' : 'Ask every time'}
            />
            {Object.keys(actions).length === 0 ? (
                <PermRow label="Sign actions" text="Ask every time" />
            ) : (
                <div>
                    <div style={{ color: 'var(--xc-text-muted)' }}>Sign actions</div>
                    <ul style={{ margin: 0, paddingLeft: 'var(--xc-space-3)', listStyle: 'disc' }}>
                        {Object.entries(actions).map(([action, perm]) => (
                            <li key={action} style={{ color: 'var(--xc-text)' }}>
                                {actionDisplayLabel(action)}
                                {': '}
                                <span style={{ color: permColor(perm) }}>{permissionLabel(perm)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function PermRow({ label, text }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--xc-text-muted)' }}>{label}</span>
            <span style={{ color: 'var(--xc-text)', wordBreak: 'break-all' }}>{text}</span>
        </div>
    );
}

function permColor(perm) {
    if (perm === 'always') return 'var(--xc-success, #2a8)';
    if (perm === 'never') return 'var(--xc-danger-fg)';
    return 'var(--xc-text-muted)';
}

function permissionLabel(perm) {
    if (perm === 'always') return 'Always allow';
    if (perm === 'never') return 'Never allow';
    return 'Ask every time';
}

function formatWindowSeconds(windowMs) {
    return String(windowMs / 1000);
}

function parseWindowSeconds(value) {
    const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
    if (!match) return null;
    const wholeMs = Number(match[1]) * 1000;
    const fractionalMs = Number((match[2] || '').padEnd(3, '0'));
    return wholeMs + fractionalMs;
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
