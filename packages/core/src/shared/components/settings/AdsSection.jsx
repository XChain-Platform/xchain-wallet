// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// AdsSection: §35.1 + §36 Automatic Donation System panel.
//
// Master ON/OFF + per-chain config (per-tx amount, trigger threshold,
// donation address shown for verification, lifetime stats). Backed by
// `settings.ads.{enabled, perChain[chainId]}` (schema v1).
//
// Donation addresses come from each chain descriptor's
// `adsDonationAddress`. Per the §35 gap audit / §0.25.0 changelog
// these still ship as the `PLACEHOLDER_REPLACE_BEFORE_MAINNET`
// sentinel; the panel surfaces that fact rather than displaying the
// sentinel as if it were a real address.

import { registry as registryLib } from '@xchain-wallet/core';
import { InfoTip } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { ADS_DONATION_ADDRESS_PLACEHOLDER } from '../../../registry/validate.js';
import { resolveAdsChainConfig } from '../../../schemas/settings.js';
import { INPUT, ROW, ROW_HINT, ROW_LABEL, STACK, Status, ToggleRow } from './_settingsPrimitives.jsx';

const chainRegistry = registryLib.defaultRegistry();

const CHAIN_BLOCK = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-2)',
    padding: 'var(--xc-space-3)',
    background: 'var(--xc-surface-raised)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
};
const FIELD_ROW = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--xc-space-2)',
};
const SUBTLE = { color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' };
const NUMERIC = { ...INPUT, width: 140, textAlign: 'right' };
const ADDRESS_BOX = {
    fontFamily: 'var(--xc-font-mono, monospace)',
    fontSize: 'var(--xc-text-xs)',
    color: 'var(--xc-text)',
    background: 'var(--xc-bg)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-2)',
    overflow: 'auto',
    wordBreak: 'break-all',
};

export function AdsSection() {
    const { settings, loading, error, update } = useSettings();
    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const chainIds = Object.keys(settings.ads.perChain).filter((cid) => {
        const d = chainRegistry.get(cid);
        if (!d) return true; // surface stale entries so they can be edited away
        return registryLib.isChainVisibleToUser(d, settings);
    }).sort();

    const onToggleEnabled = async (next) => {
        try { await update({ ads: { enabled: next } }); } catch (err) {
            // eslint-disable-next-line no-console
            console.error('ads.enabled update failed:', err);
        }
    };
    const onChainPatch = async (chainId, patch) => {
        try {
            await update({ ads: { perChain: { [chainId]: patch } } });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`ads.perChain.${chainId} update failed:`, err);
        }
    };

    return (
        <div style={STACK}>
            <ToggleRow
                label="Automatic Donation System"
                hint="Sets aside a small amount on each outgoing transaction and sends it as one donation once it reaches the amount you choose below."
                checked={Boolean(settings.ads.enabled)}
                onChange={onToggleEnabled}
            />

            {chainIds.length === 0 ? (
                <Status text="No chains set up for donations yet. Each one is added automatically when you activate that chain." />
            ) : null}

            {chainIds.map((chainId) => {
                const chainState = settings.ads.perChain[chainId];
                const descriptor = chainRegistry.get(chainId);
                // §36.6: stored null = follow the release default; show the
                // resolved amount and label it, so the user can tell a value
                // that tracks releases from one they pinned themselves.
                const resolved = resolveAdsChainConfig(chainState, descriptor);
                const perTxIsDefault = chainState.perTxAmountSats == null;
                const triggerIsDefault = chainState.triggerAmountSats == null;
                const displayName = descriptor?.displayName || chainId;
                const networkSuffix = descriptor && descriptor.networkKind !== 'mainnet'
                    ? ` · ${descriptor.networkKind}`
                    : '';
                const donationAddress = descriptor?.adsDonationAddress || '';
                const isPlaceholder = donationAddress === ADS_DONATION_ADDRESS_PLACEHOLDER;
                return (
                    <div key={chainId} style={CHAIN_BLOCK}>
                        <div style={{ fontWeight: 600, color: 'var(--xc-text)', fontSize: 'var(--xc-text-sm)' }}>
                            {displayName}{networkSuffix}
                        </div>

                        <div style={FIELD_ROW}>
                            <span style={SUBTLE}>
                                Per tx (sats)
                                {perTxIsDefault ? ' · default' : ' · custom'}
                            </span>
                            <input
                                type="number"
                                min={0}
                                step={1}
                                inputMode="numeric"
                                defaultValue={resolved.perTxAmountSats}
                                onBlur={(e) => {
                                    // Empty field = drop the override and follow
                                    // the release default again (§36.6).
                                    if (e.target.value.trim() === '') {
                                        e.target.value = String(resolved.perTxAmountSats);
                                        onChainPatch(chainId, { perTxAmountSats: null });
                                        return;
                                    }
                                    const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                                    onChainPatch(chainId, { perTxAmountSats: n });
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                aria-label={`${displayName} per-transaction amount`}
                                style={NUMERIC}
                                disabled={!settings.ads.enabled}
                            />
                        </div>

                        <div style={FIELD_ROW}>
                            <span style={SUBTLE}>
                                Send when accumulated (sats)
                                {triggerIsDefault ? ' · default' : ' · custom'}
                                <InfoTip
                                    aria="Trigger threshold help"
                                    label="The wallet sets aside a small amount per chain and sends it as one donation transaction once it reaches this amount. Waiting for a bigger amount means one network fee covers a bigger donation; set it too high and the donation never fires before you stop using the wallet. 'default' follows this release's recommended amount (future releases may retune it); clear the field to go back to it."
                                />
                            </span>
                            <input
                                type="number"
                                min={0}
                                step={1}
                                inputMode="numeric"
                                defaultValue={resolved.triggerAmountSats}
                                onBlur={(e) => {
                                    if (e.target.value.trim() === '') {
                                        e.target.value = String(resolved.triggerAmountSats);
                                        onChainPatch(chainId, { triggerAmountSats: null });
                                        return;
                                    }
                                    const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                                    onChainPatch(chainId, { triggerAmountSats: n });
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                aria-label={`${displayName} trigger threshold`}
                                style={NUMERIC}
                                disabled={!settings.ads.enabled}
                            />
                        </div>

                        <div>
                            <div style={ROW_HINT}>Donation address</div>
                            {isPlaceholder ? (
                                <div style={{ ...ADDRESS_BOX, fontStyle: 'italic', color: 'var(--xc-text-muted)' }}>
                                    Not set yet. A donation address for {displayName} arrives in a future release; until then nothing is sent on this chain.
                                </div>
                            ) : (
                                <div style={ADDRESS_BOX} aria-label={`${displayName} donation address`}>
                                    {donationAddress}
                                </div>
                            )}
                        </div>

                        <div style={ROW}>
                            <span style={ROW_LABEL}>Lifetime stats</span>
                            <span style={{ color: 'var(--xc-text)', fontSize: 'var(--xc-text-xs)' }}>
                                {chainState.lifetimeDonatedSats.toLocaleString()} sats
                                {' · '}
                                {chainState.lifetimeTxCount} {chainState.lifetimeTxCount === 1 ? 'tx' : 'txs'}
                                {chainState.accumulatedSats > 0 ? (
                                    <>
                                        {' · '}
                                        <span style={SUBTLE}>{chainState.accumulatedSats.toLocaleString()} accumulated</span>
                                    </>
                                ) : null}
                            </span>
                        </div>
                        {chainState.lifetimeDonatedSats > 0 ? (
                            <div style={{ ...SUBTLE, fontStyle: 'italic', textAlign: 'right' }}>
                                You've donated {chainState.lifetimeDonatedSats.toLocaleString()} sats to XChain development. Thank you.
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}
