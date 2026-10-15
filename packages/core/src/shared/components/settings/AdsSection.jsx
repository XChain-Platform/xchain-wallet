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

import { useId } from 'react';
import { flows as flowsLib, registry as registryLib } from '@xchain-wallet/core';
import { InfoTip, Input } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { ADS_DONATION_ADDRESS_PLACEHOLDER } from '../../../registry/validate.js';
import { resolveAdsChainConfig } from '../../../schemas/settings.js';
import { t } from '../../../i18n/index.js';
import { ROW_HINT, STACK, SettingsLoadError, Status, ToggleRow } from './_settingsPrimitives.jsx';
import styles from './AdsSection.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * One whole-number sats field. Blank drops the override and follows the
 * release default again (§36.6); anything that is not a whole number snaps
 * back to the current value.
 */
function AmountField({ label, ariaLabel, current, disabled, onCommit, hint, tip }) {
    const hintId = useId();
    return (
        <div>
            <Input
                label={label}
                type="text"
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="off"
                defaultValue={current}
                onBlur={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === '') {
                        e.target.value = String(current);
                        onCommit(null);
                        return;
                    }
                    if (!/^\d+$/.test(raw)) {
                        e.target.value = String(current);
                        return;
                    }
                    onCommit(Math.max(0, Math.floor(Number(raw) || 0)));
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                aria-label={ariaLabel}
                aria-describedby={hint ? hintId : undefined}
                disabled={disabled}
            />
            {hint ? (
                <div className={styles.hintRow}>
                    <span id={hintId}>{hint}</span>
                    {tip}
                </div>
            ) : null}
        </div>
    );
}

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
                const placeholderDescription = `A donation address for ${displayName} arrives in a future release; until then nothing is sent on this network.`;
                return (
                    <div key={chainId} className={styles.chain}>
                        <h3 className={styles.chainName}>{displayName}</h3>

                        <AmountField
                            label={`${t('settings.ads.setAsidePerOutgoingTransaction')}${perTxIsDefault ? t('settings.ads.default') : t('settings.ads.custom')}`}
                            ariaLabel={t('settings.ads.perTransactionAmount', { displayName })}
                            current={resolved.perTxAmountSats}
                            disabled={!settings.ads.enabled}
                            onCommit={(value) => onChainPatch(chainId, { perTxAmountSats: value })}
                        />

                        <AmountField
                            label={`${t('settings.ads.sendDonationWhenPendingReaches')}${triggerIsDefault ? t('settings.ads.default') : t('settings.ads.custom')}`}
                            ariaLabel={t('settings.ads.triggerThreshold', { displayName })}
                            current={resolved.triggerAmountSats}
                            disabled={!settings.ads.enabled}
                            onCommit={(value) => onChainPatch(chainId, { triggerAmountSats: value })}
                            hint={transactionsToThreshold === null
                                ? t('settings.ads.noPendingAmountIsAdded')
                                : t('settings.ads.transactionsToThreshold', { count: transactionsToThreshold })}
                            tip={(
                                <InfoTip
                                    aria={t('settings.ads.triggerThresholdHelpLabel')}
                                    label={t('settings.ads.aSatIsTheSmallest')}
                                />
                            )}
                        />

                        {isPlaceholder ? (
                            <Input
                                label={t('settings.ads.donationAddress')}
                                readOnly
                                autoComplete="off"
                                value={t('settings.ads.notAvailableYet')}
                                className={`${styles.address} ${styles.unavailable}`}
                                aria-description={placeholderDescription}
                            />
                        ) : (
                            <Input
                                label={t('settings.ads.donationAddress')}
                                readOnly
                                autoComplete="off"
                                value={donationAddress}
                                className={styles.address}
                                aria-label={t('settings.ads.donationAddress2', { displayName })}
                            />
                        )}

                        <div className={styles.stat}>
                            <span className={styles.statLabel}>{t('settings.ads.pendingDonation')}</span>
                            <span className={styles.statValue}>
                                {t('settings.ads.satsAmount', { amount: chainState.accumulatedSats })}
                            </span>
                        </div>

                        <div className={styles.stat}>
                            <span className={styles.statLabel}>{t('settings.ads.lifetimeDonations')}</span>
                            <span className={styles.statValue}>
                                {t('settings.ads.lifetimeSummary', {
                                    sats: chainState.lifetimeDonatedSats,
                                    txs: t('settings.ads.txCount', { count: chainState.lifetimeTxCount }),
                                })}
                            </span>
                        </div>
                        {chainState.lifetimeDonatedSats > 0 ? (
                            <div className={styles.thanks}>
                                {t('settings.ads.thanksDonated', { sats: chainState.lifetimeDonatedSats })}
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}
