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
import { ROW_HINT, STACK, Status } from './_settingsPrimitives.jsx';

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
        try {
            await messaging.deleteConnectedSite({ id });
            await reload();
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
                    until you remove the origin.
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
                        placeholder="https://example.com"
                        aria-label="Origin to block"
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
