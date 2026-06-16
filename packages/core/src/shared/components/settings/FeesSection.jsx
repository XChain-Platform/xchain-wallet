// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// FeesSection — §35.1 Fees panel + §44 fee UX. Per-chain.
//
// Each row corresponds to one entry under `settings.fees`. The
// `seedSettingsForChains` flow ensures every active chain has an
// entry; entries that exist for inactive chains still render so the
// user can clean them up if needed.
//
// Per chain we surface:
//   - Strategy picker: low / normal / fast / custom (see schema's
//     FEE_STRATEGIES tuple).
//   - Custom rate input (sats per KB), visible when strategy='custom'.
//   - RBF-by-default toggle.

import { registry as registryLib } from '@xchain-wallet/core';
import { useSettings } from '../../hooks/useSettings.js';
import { INPUT, ROW_HINT, SELECT, STACK, Status, ToggleRow } from './_settingsPrimitives.jsx';

const chainRegistry = registryLib.defaultRegistry();

const STRATEGIES = /** @type {const} */ ([
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'fast', label: 'Fast' },
    { value: 'custom', label: 'Custom' },
]);

const CHAIN_BLOCK = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-1)',
    padding: 'var(--xc-space-2) var(--xc-space-3)',
    background: 'var(--xc-surface-raised)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
};
const CHAIN_HEADER = {
    fontWeight: 600,
    color: 'var(--xc-text)',
    fontSize: 'var(--xc-text-sm)',
};
const FIELD_ROW = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--xc-space-2)',
};

export function FeesSection() {
    const { settings, loading, error, update } = useSettings();

    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const chainIds = Object.keys(settings.fees).sort();
    if (chainIds.length === 0) {
        return (
            <Status
                text="No chain fee profiles yet — they're seeded automatically when a chain is activated."
            />
        );
    }

    const onPatch = async (chainId, patch) => {
        try {
            await update({ fees: { [chainId]: patch } });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`fees.${chainId} update failed:`, err);
        }
    };

    return (
        <div style={STACK}>
            {chainIds.map((chainId) => {
                const fees = settings.fees[chainId];
                const descriptor = chainRegistry.get(chainId);
                const displayName = descriptor?.displayName || chainId;
                const networkSuffix = descriptor && descriptor.networkKind !== 'mainnet'
                    ? ` · ${descriptor.networkKind}`
                    : '';
                return (
                    <div key={chainId} style={CHAIN_BLOCK}>
                        <div style={CHAIN_HEADER}>{displayName}{networkSuffix}</div>

                        <div style={FIELD_ROW}>
                            <span style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>Strategy</span>
                            <select
                                value={fees.strategy}
                                onChange={(e) => onPatch(chainId, {
                                    strategy: e.target.value,
                                    customSatsPerKb: e.target.value === 'custom' ? (fees.customSatsPerKb ?? 1000) : null,
                                    rbfByDefault: fees.rbfByDefault,
                                })}
                                aria-label={`${displayName} fee strategy`}
                                style={SELECT}
                            >
                                {STRATEGIES.map((s) => (
                                    <option key={s.value} value={s.value}>{s.label}</option>
                                ))}
                            </select>
                        </div>

                        {fees.strategy === 'custom' ? (
                            <div style={FIELD_ROW}>
                                <span style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                                    sats / KB
                                </span>
                                <input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    step={1}
                                    defaultValue={fees.customSatsPerKb ?? 1000}
                                    onBlur={(e) => {
                                        const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                                        onPatch(chainId, {
                                            strategy: 'custom',
                                            customSatsPerKb: n,
                                            rbfByDefault: fees.rbfByDefault,
                                        });
                                    }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                    aria-label={`${displayName} custom fee rate`}
                                    style={{ ...INPUT, width: 120, textAlign: 'right' }}
                                />
                            </div>
                        ) : null}

                        <ToggleRow
                            label="RBF by default"
                            hint="Replace-by-fee opt-in stays sticky for outgoing sends on this chain."
                            checked={Boolean(fees.rbfByDefault)}
                            onChange={(v) => onPatch(chainId, {
                                strategy: fees.strategy,
                                customSatsPerKb: fees.customSatsPerKb,
                                rbfByDefault: v,
                            })}
                            disabled={!descriptor?.feeStrategy?.rbfSupported}
                        />
                        {!descriptor?.feeStrategy?.rbfSupported ? (
                            <div style={ROW_HINT}>RBF is not supported on {displayName}.</div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}
