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
//
// The draft is seeded with the FULL default URL, port included
// (`joinEndpoint`), not the descriptor's bare `defaultUrl`. Saving
// writes all three fields, so seeding a regtest endpoint as
// "http://localhost" (port dropped) meant editing Explorer alone
// silently rewrote Encoder and Hub to a port nothing listens on. The
// same item wired these overrides into SDKRegistry, so a bad value here
// now really does break that chain's traffic: URLs are validated before
// they are allowed to persist.

import { useEffect, useRef, useState } from 'react';
import { registry as registryLib, sdk as sdkLib } from '@xchain-wallet/core';
import { useSettings } from '../../hooks/useSettings.js';
import { useMessaging } from '../../useMessaging.js';
import { userFacingMessage } from '../../utils/userFacingMessage.js';
import { INPUT, ROW_HINT, STACK, SettingsLoadError, Status } from './_settingsPrimitives.jsx';

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
    flexWrap: 'wrap',
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
    if (error) return <SettingsLoadError error={error} />;
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
                    onSave={(next) => update({ sdkEndpoints: { [d.id]: next } })}
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
    const [manualResult, setManualResult] = useState(false);
    const manualRefreshRef = useRef(false);
    useEffect(() => {
        if (!wired) return;
        messaging.getChainRegistryStatus()
            .then((s) => { if (!manualRefreshRef.current) setStatus(s); })
            .catch(() => { if (!manualRefreshRef.current) setStatus(null); });
    }, [wired, messaging]);
    if (!wired) return null;

    const onRefresh = async () => {
        manualRefreshRef.current = true;
        try {
            setRefreshing(true);
            const next = await messaging.refreshChainRegistry();
            setStatus(next);
            setManualResult(true);
        } catch (err) {
            setStatus({
                ok: false,
                error: userFacingMessage(err, 'Could not refresh the chain registry. Try again.'),
            });
            setManualResult(true);
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
                    {/* "Descriptor" is the ChainDescriptor type name, and this
                        panel is an ordinary Settings section, not a
                        developer-gated one, so the count says "networks". It
                        stays qualified as "in the registry" on purpose:
                        descriptorCount is what the hub published registry-wide,
                        while the chain list below is filtered through
                        filterChainsForUser (regtest hidden unless developer
                        mode), so a bare count would name a bigger number than
                        the list under it. */}
                    <span style={ROW_HINT}>
                        {registryStatusText(status, manualResult)}
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

function registryStatusText(status, manualResult) {
    if (status?.ok) {
        const networks = `${status.descriptorCount} network${status.descriptorCount === 1 ? '' : 's'}`;
        return manualResult
            ? `Refresh complete: ${networks} available from the registry.`
            : `Last refreshed ${formatRelative(status.lastRefreshedAt)} · ${networks} in the registry`;
    }
    if (!status?.error) {
        return 'No refresh yet; the networks bundled with this wallet are active.';
    }
    const raw = userFacingMessage(status.error, 'The registry could not be refreshed.');
    const unreachable = /fetch|network|timed? out|timeout|unreachable|econn|enotfound|connection/i.test(raw);
    const reason = unreachable
        ? 'The registry host could not be reached.'
        : `The registry could not be refreshed: ${raw}`;
    return `Refresh failed. ${reason} The networks bundled with this wallet remain active.`;
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

// A URL the wallet can actually talk to: absolute, http(s), with a host.
// Anything else would be handed straight to the SDK now that overrides
// are live, so it is refused at the edit surface instead.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function endpointError(value, descriptor) {
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return 'Enter a full URL, for example http://localhost:18080';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'Only http:// and https:// URLs are supported.';
    }
    if (!parsed.hostname) return 'That URL has no host.';
    const allowsHttp = descriptor?.networkKind === 'regtest' || LOOPBACK_HOSTS.has(parsed.hostname);
    if (parsed.protocol === 'http:' && !allowsHttp) {
        return 'Use https:// for remote hosts. http:// is allowed only for regtest and local hosts.';
    }
    return null;
}

function canonicalEndpoint(value) {
    const trimmed = value.trim();
    try {
        const parsed = new URL(trimmed);
        parsed.pathname = parsed.pathname.replace(/\/+$/, '');
        const path = parsed.pathname === '/' ? '' : parsed.pathname;
        return `${parsed.origin}${path}${parsed.search}${parsed.hash}`;
    } catch {
        return trimmed;
    }
}

function ChainEndpointBlock({ descriptor, override, onSave }) {
    const defaults = {
        explorerUrl: sdkLib.joinEndpoint(descriptor.explorer),
        encoderUrl: sdkLib.joinEndpoint(descriptor.encoder),
        hubUrl: sdkLib.joinEndpoint(descriptor.hub),
    };
    // A persisted value equal to the descriptor's bare `defaultUrl` on a
    // ported endpoint is the seeding bug, not a choice: SDKRegistry
    // ignores it, so show what the wallet is really using.
    const seed = (value, endpoint, fallback) => {
        if (typeof value !== 'string' || value.trim() === '') return fallback;
        const trimmed = value.trim();
        if (endpoint && trimmed === endpoint.defaultUrl && trimmed !== fallback) return fallback;
        return trimmed;
    };
    const seeded = () => ({
        explorerUrl: seed(override?.explorerUrl, descriptor.explorer, defaults.explorerUrl),
        encoderUrl: seed(override?.encoderUrl, descriptor.encoder, defaults.encoderUrl),
        hubUrl: seed(override?.hubUrl, descriptor.hub, defaults.hubUrl),
    });
    const [draft, setDraft] = useState(seeded);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(/** @type {string|null} */ (null));

    useEffect(() => {
        // re-sync draft when the persisted record changes underneath
        setDraft(seeded());
        setEditing(false);
        setSaveError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [override?.explorerUrl, override?.encoderUrl, override?.hubUrl]);

    const isCustom = Boolean(override?.custom);
    const networkSuffix = descriptor.networkKind !== 'mainnet'
        ? ` · ${descriptor.networkKind}`
        : '';

    const persisted = seeded();
    const dirty = (
        draft.explorerUrl !== persisted.explorerUrl
        || draft.encoderUrl !== persisted.encoderUrl
        || draft.hubUrl !== persisted.hubUrl
    );

    const onCommit = async () => {
        // An emptied field means "use the default for this one", not
        // "send requests to nowhere".
        const next = {
            explorerUrl: canonicalEndpoint(draft.explorerUrl) || defaults.explorerUrl,
            encoderUrl: canonicalEndpoint(draft.encoderUrl) || defaults.encoderUrl,
            hubUrl: canonicalEndpoint(draft.hubUrl) || defaults.hubUrl,
        };
        const bad = [
            ['Explorer URL', next.explorerUrl],
            ['Encoder URL', next.encoderUrl],
            ['Hub URL', next.hubUrl],
        ]
            .map(([label, value]) => {
                const err = endpointError(value, descriptor);
                return err ? `${label}: ${err}` : null;
            })
            .filter(Boolean);
        if (bad.length > 0) {
            setSaveError(bad.join(' '));
            return;
        }
        const matchesDefault = (
            next.explorerUrl === defaults.explorerUrl
            && next.encoderUrl === defaults.encoderUrl
            && next.hubUrl === defaults.hubUrl
        );
        setSaveError(null);
        setDraft(next);
        setSaving(true);
        try {
            await onSave({ ...next, custom: !matchesDefault });
            setEditing(false);
        } catch (err) {
            setDraft(persisted);
            setEditing(false);
            setSaveError(userFacingMessage(err, 'Could not save these endpoints. Try again.'));
        } finally {
            setSaving(false);
        }
    };
    const onReset = async () => {
        setDraft(defaults);
        setSaveError(null);
        setSaving(true);
        try {
            await onSave({
                explorerUrl: defaults.explorerUrl,
                encoderUrl: defaults.encoderUrl,
                hubUrl: defaults.hubUrl,
                custom: false,
            });
            setEditing(false);
        } catch (err) {
            setDraft(persisted);
            setEditing(false);
            setSaveError(userFacingMessage(err, 'Could not reset these endpoints. Try again.'));
        } finally {
            setSaving(false);
        }
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
            {saveError ? (
                <div role="alert" style={{ ...ROW_HINT, color: 'var(--xc-danger-fg, #c33)' }}>
                    {saveError}
                </div>
            ) : null}
            {dirty ? (
                <div style={ROW_HINT}>
                    Saving points this chain&apos;s balances, history and broadcasts at these
                    addresses right away.
                </div>
            ) : null}
            {isCustom || dirty ? (
                <div style={ROW_HINT}>
                    URL format is checked here, but the host is not contacted until the wallet uses it.
                    If it is unreachable, this chain&apos;s balances, history and transactions may be unavailable.
                </div>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                {isCustom || dirty ? (
                    <button type="button" onClick={onReset} style={ACTION_BTN} disabled={saving}>Reset to default</button>
                ) : null}
                {dirty || editing ? (
                    <button type="button" onClick={onCommit} style={ACTION_PRIMARY} disabled={!dirty || saving}>
                        {saving ? 'Saving…' : 'Save'}
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
                enterKeyHint="done"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                aria-label={label}
                style={{ ...INPUT, width: '100%' }}
            />
        </div>
    );
}
