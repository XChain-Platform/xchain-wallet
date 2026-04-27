// ConnectedSitesSection — §35.1 + §43.5 Connected Sites panel.
//
// Lists ConnectedSite records sorted by lastUsedAt desc. Each row:
//   - origin / appName / lastUsedAt
//   - expandable permissions summary (chains, accounts, sign-message,
//     per-action signAction map)
//   - Disconnect button that deletes the record
//
// Per-action permission *editing* (toggling a single ACTION's
// allow/ask/deny) needs a write handler that's narrower than full
// record replacement; that lands in a follow-up step. This step
// covers list + disconnect, which is the majority of value: users
// who want to reset a site's grants can disconnect and re-approve.

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
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [expanded, setExpanded] = useState(/** @type {Set<string>} */ (new Set()));

    const reload = async () => {
        if (typeof messaging?.listConnectedSites !== 'function') {
            setError('Connected-sites is not wired in this shell yet.');
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const list = await messaging.listConnectedSites();
            setSites(Array.isArray(list) ? list : []);
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

    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Connected sites unavailable: ${error}`} tone="error" />;
    if (!sites || sites.length === 0) {
        return <Status text="No dApps connected. Sites that call window.xchain.connect appear here." />;
    }

    return (
        <div style={STACK}>
            {sites.map((site) => {
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
                                    style={{ ...ACTION_BTN, color: 'var(--xc-error, #c33)', borderColor: 'var(--xc-error, #c33)' }}
                                >
                                    Disconnect
                                </button>
                            </div>
                        </div>
                        {isOpen ? <PermissionsSummary permissions={site.permissions} /> : null}
                    </div>
                );
            })}
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
