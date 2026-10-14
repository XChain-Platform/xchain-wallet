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

import { flows as flowsLib, registry as registryLib } from '@xchain-wallet/core';
import { InfoTip, Input } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { ADS_DONATION_ADDRESS_PLACEHOLDER } from '../../../registry/validate.js';
import { resolveAdsChainConfig } from '../../../schemas/settings.js';
import { t } from '../../../i18n/index.js';
import { ROW, ROW_HINT, ROW_LABEL, STACK, SettingsLoadError, Status, ToggleRow } from './_settingsPrimitives.jsx';

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
const NUMERIC = { width: 140, textAlign: 'right' };
const ADDRESS_BOX = {
    fontFamily: 'var(--xc-font-mono, monospace)',
    fontSize: 'var(--xc-text-xs)',
    color: 'var(--xc-text)',
    background: 'var(--xc-bg)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-2)',
    overflow: 'auto',
    wordBreak: 'normal',
};
const PLACEHOLDER_BOX = {
    ...ADDRESS_BOX,
    fontFamily: 'inherit',
    fontStyle: 'italic',
    color: 'var(--xc-text-muted)',
    overflow: 'visible',
    wordBreak: 'normal',
    overflowWrap: 'break-word',
};

export function AdsSection() {
    const { settings, loading, error, update } = useSettings();
    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    const chainIds = Object.keys(settings.ads.perChain).filter((cid) => {
        const d = chainRegistry.get(cid);
        if (!d) return true; // surface stale entries so they can be edited away
        // Chains are named without their network kind, so only the active
        // network's chains are listed and each chain appears once.
        return registryLib.isChainVisibleToUser(d, settings)
            && flowsLib.filterChainIdsByActiveNetwork([cid], settings, chainRegistry).length > 0;
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
            {/* The page title already names the subject, so the switch reads as
                an action; screen readers hear the subject too. */}
            <ToggleRow
                label={t('settings.toggle.turnOn')}
                accessibleLabel={t('settings.ads.switchAccessibleLabel')}
                hint={t('settings.ads.itSetsAsideASmall')}
                checked={Boolean(settings.ads.enabled)}
                onChange={onToggleEnabled}
            />

            <div role="status" aria-live="polite" style={{ ...ROW_HINT, padding: '0 var(--xc-space-3)' }}>
                {settings.ads.enabled
                    ? t('settings.ads.onNewOutgoingTransactionsAdd')
                    : t('settings.ads.offNewOutgoingTransactionsDo')}
            </div>

            {chainIds.length === 0 ? (
                <Status text={t('settings.ads.noChainsSetUpFor')} />
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
                const transactionsToThreshold = resolved.perTxAmountSats > 0
                    ? Math.ceil(resolved.triggerAmountSats / resolved.perTxAmountSats)
                    : null;
                const displayName = descriptor?.displayName || chainId;
                const donationAddress = descriptor?.adsDonationAddress || '';
                const isPlaceholder = donationAddress === ADS_DONATION_ADDRESS_PLACEHOLDER;
                const placeholderDescription = `A donation address for ${displayName} arrives in a future release; until then nothing is sent on this chain.`;
                return (
                    <div key={chainId} style={CHAIN_BLOCK}>
                        <div style={{ fontWeight: 600, color: 'var(--xc-text)', fontSize: 'var(--xc-text-sm)' }}>
                            {displayName}
                        </div>

                        <div style={FIELD_ROW}>
                            <span style={SUBTLE}>
                                {t('settings.ads.setAsidePerOutgoingTransaction')}
                                {perTxIsDefault ? t('settings.ads.default') : t('settings.ads.custom')}
                            </span>
                            <Input
                                type="text"
                                inputMode="numeric"
                                enterKeyHint="done"
                                autoComplete="off"
                                defaultValue={resolved.perTxAmountSats}
                                onBlur={(e) => {
                                    // Empty field = drop the override and follow
                                    // the release default again (§36.6).
                                    if (e.target.value.trim() === '') {
                                        e.target.value = String(resolved.perTxAmountSats);
                                        onChainPatch(chainId, { perTxAmountSats: null });
                                        return;
                                    }
                                    if (!/^\d+$/.test(e.target.value.trim())) {
                                        e.target.value = String(resolved.perTxAmountSats);
                                        return;
                                    }
                                    const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                                    onChainPatch(chainId, { perTxAmountSats: n });
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                aria-label={t('settings.ads.perTransactionAmount', { displayName })}
                                style={NUMERIC}
                                disabled={!settings.ads.enabled}
                            />
                        </div>

                        <div style={FIELD_ROW}>
                            <div>
                                <span style={SUBTLE}>
                                    {t('settings.ads.sendDonationWhenPendingReaches')}
                                    {triggerIsDefault ? t('settings.ads.default') : t('settings.ads.custom')}
                                    <InfoTip
                                        aria={t('settings.ads.triggerThresholdHelpLabel')}
                                        label={t('settings.ads.aSatIsTheSmallest')}
                                    />
                                </span>
                                <div style={ROW_HINT}>
                                    {transactionsToThreshold === null
                                        ? t('settings.ads.noPendingAmountIsAdded')
                                        : t('settings.ads.transactionsToThreshold', { count: transactionsToThreshold })}
                                </div>
                            </div>
                            <Input
                                type="text"
                                inputMode="numeric"
                                enterKeyHint="done"
                                autoComplete="off"
                                defaultValue={resolved.triggerAmountSats}
                                onBlur={(e) => {
                                    if (e.target.value.trim() === '') {
                                        e.target.value = String(resolved.triggerAmountSats);
                                        onChainPatch(chainId, { triggerAmountSats: null });
                                        return;
                                    }
                                    if (!/^\d+$/.test(e.target.value.trim())) {
                                        e.target.value = String(resolved.triggerAmountSats);
                                        return;
                                    }
                                    const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                                    onChainPatch(chainId, { triggerAmountSats: n });
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                aria-label={t('settings.ads.triggerThreshold', { displayName })}
                                style={NUMERIC}
                                disabled={!settings.ads.enabled}
                            />
                        </div>

                        <div>
                            <div style={ROW_HINT}>{t('settings.ads.donationAddress')}</div>
                            {isPlaceholder ? (
                                <div style={PLACEHOLDER_BOX} aria-description={placeholderDescription}>
                                    {t('settings.ads.notAvailableYet')}
                                </div>
                            ) : (
                                <div style={{ ...ADDRESS_BOX, wordBreak: 'break-all' }} aria-label={t('settings.ads.donationAddress2', { displayName })}>
                                    {donationAddress}
                                </div>
                            )}
                        </div>

                        <div style={ROW}>
                            <span style={ROW_LABEL}>{t('settings.ads.pendingDonation')}</span>
                            <span style={{ color: 'var(--xc-text)', fontSize: 'var(--xc-text-xs)' }}>
                                {t('settings.ads.satsAmount', { amount: chainState.accumulatedSats })}
                            </span>
                        </div>

                        <div style={ROW}>
                            <span style={ROW_LABEL}>{t('settings.ads.lifetimeDonations')}</span>
                            <span style={{ color: 'var(--xc-text)', fontSize: 'var(--xc-text-xs)' }}>
                                {t('settings.ads.lifetimeSummary', {
                                    sats: chainState.lifetimeDonatedSats,
                                    txs: t('settings.ads.txCount', { count: chainState.lifetimeTxCount }),
                                })}
                            </span>
                        </div>
                        {chainState.lifetimeDonatedSats > 0 ? (
                            <div style={{ ...SUBTLE, fontStyle: 'italic', textAlign: 'right' }}>
                                {t('settings.ads.thanksDonated', { sats: chainState.lifetimeDonatedSats })}
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}
