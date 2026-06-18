// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// NetworkEndpointsSection (§35.1): Network & Endpoints panel.
//
// Per-chain Explorer / Encoder / Hub URL editor. Writes through to
// `settings.sdkEndpoints[chainId]`. The schema's SdkEndpoint shape is
// { explorerUrl, encoderUrl, hubUrl, custom: boolean }. The `custom`
// flag distinguishes "user overrode the default" from "user typed the
// default value back in", which matters for the §49 reachability
// banner and any future hub-driven endpoint refresh.
//
// Chains without an override entry render the registry defaults as
// placeholders. "Reset to default" wipes the entry; "Save" commits
// the local edit buffer to the persisted record.

import { useEffect, useState } from 'react';
import { registry as registryLib } from '@xchain-wallet/core';
import { useSettings } from '../../hooks/useSettings.js';
import { useMessaging } from '../../useMessaging.js';
import { INPUT, ROW_HINT, STACK, Status } from './_settingsPrimitives.jsx';

const chainRegistry = registryLib.defaultRegistry();

const CHAIN_BLOCK = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-2)',
    padding: 'var(--xc-space-3) var(--xc-space-3)',
    background: 'var(--xc-surface-raised)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
};
const HEADER_ROW = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--xc-space-2)',
};
const FIELD_LABEL = {
    fontSize: 'var(--xc-text-xs)',
    color: 'var(--xc-text-muted)',
    marginBottom: 2,
};
const ACTION_BTN = {
    background: 'transparent',
    border: '1px solid var(--xc-border)',
    color: 'var(--xc-text)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-2)',
    fontSize: 'var(--xc-text-xs)',
    cursor: 'pointer',
};
const ACTION_PRIMARY = {
    ...ACTION_BTN,
    background: 'var(--xc-accent-primary)',
    borderColor: 'var(--xc-accent-primary)',
    color: 'var(--xc-bg)',
};

export function NetworkEndpointsSection() {
    const { settings, loading, error, update } = useSettings();
    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const descriptors = registryLib.filterChainsForUser(chainRegistry.supportedChains(), settings)
        .slice()
        .sort((a, b) => {
            if (a.coin !== b.coin) return a.coin.localeCompare(b.coin);
            const order = { mainnet: 0, testnet: 1, regtest: 2 };
            return (order[a.networkKind] ?? 9) - (order[b.networkKind] ?? 9);
        });

    if (descriptors.length === 0) {
        return <Status text="No chains registered." />;
    }

    return (
        <div style={STACK}>
            <ChainRegistryRefreshRow />
            {descriptors.map((d) => (
                <ChainEndpointBlock
                    key={d.id}
                    descriptor={d}
                    override={settings.sdkEndpoints[d.id]}
                    onSave={async (next) => {
                        try {
                            await update({ sdkEndpoints: { [d.id]: next } });
                        } catch (err) {
                            // eslint-disable-next-line no-console
                            console.error(`sdkEndpoints.${d.id} update failed:`, err);
                        }
                    }}
                />
            ))}
        </div>
    );
}

// §9.7 / G007: Runtime chain-registry refresh from hub. The wallet
// boot sequence kicks off one refresh; this row surfaces the result
// + offers a manual refresh. The hub-side endpoint is pending; the
// row shows a clear "not yet available" hint when the hub returns a
// non-2xx (any HTTP error means the route doesn't exist yet today).
function ChainRegistryRefreshRow() {
    const { messaging } = useMessaging();
    const wired = typeof messaging?.getChainRegistryStatus === 'function'
        && typeof messaging?.refreshChainRegistry === 'function';
    const [status, setStatus] = useState(/** @type {any} */ (null));
    const [refreshing, setRefreshing] = useState(false);
    useEffect(() => {
        if (!wired) return;
        messaging.getChainRegistryStatus()
            .then((s) => setStatus(s))
            .catch(() => setStatus(null));
    }, [wired, messaging]);
    if (!wired) return null;

    const onRefresh = async () => {
        try {
            setRefreshing(true);
            const next = await messaging.refreshChainRegistry();
            setStatus(next);
        } finally {
            setRefreshing(false);
        }
    };

    return (
        <div style={CHAIN_BLOCK}>
            <div style={HEADER_ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>
                        Chain registry refresh
                    </span>
                    <span style={ROW_HINT}>
                        {status?.ok
                            ? `Last refreshed ${formatRelative(status.lastRefreshedAt)} · ${status.descriptorCount} descriptors`
                            : status?.error
                                ? `Last attempt failed: ${status.error}`
                                : 'No refresh yet; bundled descriptors active.'}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={refreshing}
                    style={ACTION_BTN}
                >
                    {refreshing ? 'Refreshing…' : 'Refresh now'}
                </button>
            </div>
        </div>
    );
}

function formatRelative(iso) {
    if (!iso) return 'never';
    try {
        const t = Date.parse(iso);
        if (!Number.isFinite(t)) return iso;
        const ageS = Math.max(0, (Date.now() - t) / 1000);
        if (ageS < 60) return 'just now';
        if (ageS < 3600) return `${Math.floor(ageS / 60)}m ago`;
        if (ageS < 86400) return `${Math.floor(ageS / 3600)}h ago`;
        return new Date(t).toISOString().slice(0, 10);
    } catch {
        return iso;
    }
}

function ChainEndpointBlock({ descriptor, override, onSave }) {
    const defaults = {
        explorerUrl: descriptor.explorer?.defaultUrl || '',
        encoderUrl: descriptor.encoder?.defaultUrl || '',
        hubUrl: descriptor.hub?.defaultUrl || '',
    };
    const [draft, setDraft] = useState(() => ({
        explorerUrl: override?.explorerUrl ?? defaults.explorerUrl,
        encoderUrl: override?.encoderUrl ?? defaults.encoderUrl,
        hubUrl: override?.hubUrl ?? defaults.hubUrl,
    }));
    const [editing, setEditing] = useState(false);

    useEffect(() => {
        // re-sync draft when the persisted record changes underneath
        setDraft({
            explorerUrl: override?.explorerUrl ?? defaults.explorerUrl,
            encoderUrl: override?.encoderUrl ?? defaults.encoderUrl,
            hubUrl: override?.hubUrl ?? defaults.hubUrl,
        });
        setEditing(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [override?.explorerUrl, override?.encoderUrl, override?.hubUrl]);

    const isCustom = Boolean(override?.custom);
    const networkSuffix = descriptor.networkKind !== 'mainnet'
        ? ` · ${descriptor.networkKind}`
        : '';

    const dirty = (
        draft.explorerUrl !== (override?.explorerUrl ?? defaults.explorerUrl)
        || draft.encoderUrl !== (override?.encoderUrl ?? defaults.encoderUrl)
        || draft.hubUrl !== (override?.hubUrl ?? defaults.hubUrl)
    );

    const onCommit = () => {
        const matchesDefault = (
            draft.explorerUrl === defaults.explorerUrl
            && draft.encoderUrl === defaults.encoderUrl
            && draft.hubUrl === defaults.hubUrl
        );
        onSave({
            explorerUrl: draft.explorerUrl,
            encoderUrl: draft.encoderUrl,
            hubUrl: draft.hubUrl,
            custom: !matchesDefault,
        });
        setEditing(false);
    };
    const onReset = () => {
        setDraft(defaults);
        onSave({
            explorerUrl: defaults.explorerUrl,
            encoderUrl: defaults.encoderUrl,
            hubUrl: defaults.hubUrl,
            custom: false,
        });
        setEditing(false);
    };

    return (
        <div style={CHAIN_BLOCK}>
            <div style={HEADER_ROW}>
                <span style={{ fontWeight: 600, color: 'var(--xc-text)', fontSize: 'var(--xc-text-sm)' }}>
                    {descriptor.displayName}{networkSuffix}
                </span>
                <span style={ROW_HINT}>
                    {isCustom ? 'Custom' : 'Default'}
                </span>
            </div>
            <UrlField
                label="Explorer URL"
                value={draft.explorerUrl}
                placeholder={defaults.explorerUrl}
                onChange={(v) => { setDraft((d) => ({ ...d, explorerUrl: v })); setEditing(true); }}
            />
            <UrlField
                label="Encoder URL"
                value={draft.encoderUrl}
                placeholder={defaults.encoderUrl}
                onChange={(v) => { setDraft((d) => ({ ...d, encoderUrl: v })); setEditing(true); }}
            />
            <UrlField
                label="Hub URL"
                value={draft.hubUrl}
                placeholder={defaults.hubUrl}
                onChange={(v) => { setDraft((d) => ({ ...d, hubUrl: v })); setEditing(true); }}
            />
            <div style={{ display: 'flex', flexDirection: 'row', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                {isCustom || dirty ? (
                    <button type="button" onClick={onReset} style={ACTION_BTN}>Reset to default</button>
                ) : null}
                {dirty || editing ? (
                    <button type="button" onClick={onCommit} style={ACTION_PRIMARY} disabled={!dirty}>
                        Save
                    </button>
                ) : null}
            </div>
        </div>
    );
}

function UrlField({ label, value, placeholder, onChange }) {
    return (
        <div>
            <div style={FIELD_LABEL}>{label}</div>
            <input
                type="url"
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                aria-label={label}
                style={{ ...INPUT, width: '100%' }}
            />
        </div>
    );
}
