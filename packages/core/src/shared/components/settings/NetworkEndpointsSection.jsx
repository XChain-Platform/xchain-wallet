// NetworkEndpointsSection — §35.1 Network & Endpoints panel.
//
// Per-chain Explorer / Encoder / Hub URL editor. Writes through to
// `settings.sdkEndpoints[chainId]`. The schema's SdkEndpoint shape is
// { explorerUrl, encoderUrl, hubUrl, custom: boolean } — the `custom`
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

    const developerMode = Boolean(settings.developerMode);
    const descriptors = chainRegistry.supportedChains()
        .filter((d) => developerMode || d.networkKind !== 'regtest')
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
