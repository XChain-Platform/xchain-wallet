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
import { Button, EmptyState, FormSection, Input } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { useMessaging } from '../../useMessaging.js';
import { userFacingMessage } from '../../utils/userFacingMessage.js';
import { ROW_HINT, STACK, SettingsLoadError, Status } from './_settingsPrimitives.jsx';
import styles from './NetworkEndpointsSection.module.css';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/history.js';
import '../../../i18n/locales/en/send.js';
import '../../../i18n/locales/en/settings.js';
import '../../../i18n/locales/en/ui.js';

const chainRegistry = registryLib.defaultRegistry();

export function NetworkEndpointsSection() {
    const { settings, loading, error, update } = useSettings({ reportsOwnError: true });
    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    const descriptors = registryLib.filterChainsForUser(chainRegistry.supportedChains(), settings)
        .slice()
        .sort((a, b) => {
            if (a.coin !== b.coin) return a.coin.localeCompare(b.coin);
            const order = { mainnet: 0, testnet: 1, regtest: 2 };
            return (order[a.networkKind] ?? 9) - (order[b.networkKind] ?? 9);
        });

    if (descriptors.length === 0) {
        return <EmptyState title={t('settings.endpoints.noChainsRegistered')} titleAs="p" body={t('settings.endpoints.registeredChainsAndTheirEndpoints')} />;
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
    const requestRef = useRef(0);
    useEffect(() => {
        if (!wired) return;
        const request = ++requestRef.current;
        setRefreshing(false);
        setManualResult(false);
        messaging.getChainRegistryStatus()
            .then((s) => { if (request === requestRef.current) setStatus(s); })
            .catch(() => { if (request === requestRef.current) setStatus(null); });
        return () => { requestRef.current += 1; };
    }, [wired, messaging]);
    if (!wired) return null;

    const onRefresh = async () => {
        const request = ++requestRef.current;
        try {
            setRefreshing(true);
            const next = await messaging.refreshChainRegistry();
            if (request !== requestRef.current) return;
            setStatus(next);
            setManualResult(true);
        } catch (err) {
            if (request !== requestRef.current) return;
            setStatus({
                ok: false,
                error: userFacingMessage(err, 'Could not refresh the network registry. Try again.'),
            });
            setManualResult(true);
        } finally {
            if (request === requestRef.current) setRefreshing(false);
        }
    };

    return (
        <FormSection
            headingLevel="h3"
            title={t('settings.endpoints.chainRegistryRefresh')}
            description={registryStatusText(status, manualResult)}
            className={styles.endpointCard}
        >
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                    type="button"
                    onClick={onRefresh}
                    disabled={refreshing}
                    size="sm"
                    variant="secondary"
                >
                    {refreshing ? t('settings.endpoints.refreshing') : t('settings.endpoints.refreshNow')}
                </Button>
            </div>
        </FormSection>
    );
}

function registryStatusText(status, manualResult) {
    if (status?.ok) {
        return manualResult
            ? t('settings.endpoints.refreshComplete', { count: status.descriptorCount })
            : t('settings.endpoints.lastRefreshed', {
                when: formatRelative(status.lastRefreshedAt),
                count: status.descriptorCount,
            });
    }
    if (!status?.error) {
        return t('settings.endpoints.noRefreshYet');
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
// The longest URL the editor stores; real endpoints are far shorter, and
// a multi-kilobyte value only bloats the settings record.
const URL_MAX_LENGTH = 2048;
// What a DNS name, IPv4 address or bracketed IPv6 literal can contain. The
// URL parser percent-encodes a space inside a host instead of refusing it.
const HOSTNAME_RE = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])$/i;

function endpointError(value, descriptor) {
    if (value.length > URL_MAX_LENGTH) return t('settings.endpoints.errorTooLong', { max: URL_MAX_LENGTH });
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return t('settings.endpoints.errorFullUrl');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return t('settings.endpoints.errorScheme');
    }
    if (!parsed.hostname) return t('settings.endpoints.errorNoHost');
    if (!HOSTNAME_RE.test(parsed.hostname)) return t('settings.endpoints.errorBadHost');
    if (parsed.username || parsed.password) return t('settings.endpoints.errorCredentials');
    const allowsHttp = descriptor?.networkKind === 'regtest' || LOOPBACK_HOSTS.has(parsed.hostname);
    if (parsed.protocol === 'http:' && !allowsHttp) {
        return t('settings.endpoints.errorHttpRemote');
    }
    return null;
}

function canonicalEndpoint(value) {
    const trimmed = value.trim();
    try {
        const parsed = new URL(trimmed);
        // Rebuilding from the origin would drop a user name and password
        // silently; keep the text so the validator can refuse it.
        if (parsed.username || parsed.password) return trimmed;
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
    }, [
        override?.explorerUrl,
        override?.encoderUrl,
        override?.hubUrl,
        defaults.explorerUrl,
        defaults.encoderUrl,
        defaults.hubUrl,
    ]);

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
            [t('settings.endpoints.explorerUrl'), next.explorerUrl, defaults.explorerUrl],
            [t('settings.endpoints.encoderUrl'), next.encoderUrl, defaults.encoderUrl],
            [t('settings.endpoints.hubUrl'), next.hubUrl, defaults.hubUrl],
        ]
            .map(([label, value, fallback]) => {
                // A chain that ships without this endpoint (testnet has no hub)
                // seeds the field empty; left empty, it keeps that default.
                if (value === '' && fallback === '') return null;
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
        <FormSection
            headingLevel="h3"
            title={`${descriptor.displayName}${networkSuffix}`}
            description={isCustom ? t('ui.feeSelector.custom') : t('settings.endpoints.default')}
            className={styles.endpointCard}
        >
            <UrlField
                label={t('settings.endpoints.explorerUrl')}
                value={draft.explorerUrl}
                placeholder={defaults.explorerUrl}
                onChange={(v) => { setDraft((d) => ({ ...d, explorerUrl: v })); setEditing(true); }}
            />
            <UrlField
                label={t('settings.endpoints.encoderUrl')}
                value={draft.encoderUrl}
                placeholder={defaults.encoderUrl}
                onChange={(v) => { setDraft((d) => ({ ...d, encoderUrl: v })); setEditing(true); }}
            />
            <UrlField
                label={t('settings.endpoints.hubUrl')}
                value={draft.hubUrl}
                placeholder={defaults.hubUrl}
                onChange={(v) => { setDraft((d) => ({ ...d, hubUrl: v })); setEditing(true); }}
            />
            {saveError ? <Status text={saveError} tone="error" /> : null}
            {dirty ? (
                <div style={ROW_HINT}>
                    {t('settings.endpoints.savingPointsThisChainS')}
                </div>
            ) : null}
            {isCustom || dirty ? (
                <div style={ROW_HINT}>
                    {t('settings.endpoints.urlFormatIsCheckedHere')}
                </div>
            ) : null}
            {/* The action row renders only with an action in it, so an untouched
                default card keeps even padding instead of a blank gap at its foot. */}
            {isCustom || dirty || editing ? (
                <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                    {isCustom || dirty ? (
                        <Button type="button" onClick={onReset} size="sm" variant="secondary" disabled={saving}>
                            {t('settings.endpoints.resetToDefault')}
                        </Button>
                    ) : null}
                    {dirty || editing ? (
                        <Button type="button" onClick={onCommit} size="sm" variant="primary" disabled={!dirty || saving}>
                            {saving ? t('send.saveRecipient.saving') : t('history.contact.save')}
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </FormSection>
    );
}

function UrlField({ label, value, placeholder, onChange }) {
    return (
        <Input
            type="url"
            label={label}
            enterKeyHint="done"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
        />
    );
}
