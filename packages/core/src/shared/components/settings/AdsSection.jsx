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
// `adsDonationAddresses`: three per chain and network, carried from the
// platform coin registry. The user picks one per chain, stored as
// `ads.perChain[chainId].donationAddressRole` (DONATE1 by default), and the
// panel shows the chosen address read-only. A role whose address is absent
// or still the `PLACEHOLDER_REPLACE_BEFORE_MAINNET` sentinel cannot be
// picked, and the panel says so rather than showing the sentinel.

import { useId } from 'react';
import { flows as flowsLib, registry as registryLib } from '@xchain-wallet/core';
import { InfoTip, Input, Select } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import {
    ADS_DEFAULT_DONATION_ADDRESS_ROLE,
    ADS_DONATION_ADDRESS_ROLES,
    donationAddressForDescriptor,
    isDonationAddressConfigured,
} from '../../../registry/validate.js';
import { resolveAdsChainConfig } from '../../../schemas/settings.js';
import { t } from '../../../i18n/index.js';
import { STACK, SettingsLoadError, Status, ToggleRow } from './_settingsPrimitives.jsx';
import styles from './AdsSection.module.css';

const chainRegistry = registryLib.defaultRegistry();

// What the picker calls each stored role. The registry names the third
// destination EXPLORER; users know it as DONATE3.
const DONATION_ROLE_LABEL_KEYS = {
    DONATE1: 'settings.ads.roleDonate1',
    DONATE2: 'settings.ads.roleDonate2',
    EXPLORER: 'settings.ads.roleDonate3',
};

// The stored role when it is one the donation flow honours, else the default.
function selectedDonationRole(chainState) {
    const stored = chainState?.donationAddressRole;
    return ADS_DONATION_ADDRESS_ROLES.includes(stored) ? stored : ADS_DEFAULT_DONATION_ADDRESS_ROLE;
}

/**
 * The per-chain donation destination: a role picker and the chosen address,
 * read-only. Roles with no configured address are listed but cannot be chosen.
 */
function DonationAddressField({ chainId, descriptor, displayName, role, disabled, onPick }) {
    const configured = isDonationAddressConfigured(descriptor, role);
    return (
        <>
            <Select
                label={t('settings.ads.donationRecipient')}
                aria-label={t('settings.ads.donationRecipientFor', { displayName })}
                value={role}
                disabled={disabled}
                onChange={(event) => onPick(chainId, event.target.value)}
            >
                {ADS_DONATION_ADDRESS_ROLES.map((option) => (
                    <option
                        key={option}
                        value={option}
                        disabled={!isDonationAddressConfigured(descriptor, option)}
                    >
                        {t(DONATION_ROLE_LABEL_KEYS[option])}
                    </option>
                ))}
            </Select>

            {configured ? (
                <Input
                    label={t('settings.ads.donationAddress')}
                    readOnly
                    autoComplete="off"
                    value={donationAddressForDescriptor(descriptor, role)}
                    className={styles.address}
                    aria-label={t('settings.ads.donationAddress2', { displayName })}
                />
            ) : (
                <Input
                    label={t('settings.ads.donationAddress')}
                    readOnly
                    autoComplete="off"
                    value={t('settings.ads.notAvailableYet')}
                    className={`${styles.address} ${styles.unavailable}`}
                    aria-description={t('settings.ads.donationAddressArrivesLater', { displayName })}
                />
            )}
        </>
    );
}

/**
 * One whole-number sats field. Blank drops the override and follows the
 * release default again (§36.6); anything that is not a whole number snaps
 * back to the current value.
 */
function AmountField({ label, ariaLabel, current, disabled, onCommit, hint, tip, describedBy }) {
    const ownHintId = useId();
    const hintId = hint ? ownHintId : describedBy;
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
                aria-describedby={hintId}
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
    const sharedHintId = useId();
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

    // Every network reads the same default, so the threshold sentence is said once
    // above the cards. A network with its own amounts keeps its own sentence.
    const thresholdSentence = (chainId) => {
        const resolved = resolveAdsChainConfig(settings.ads.perChain[chainId], chainRegistry.get(chainId));
        return resolved.perTxAmountSats > 0
            ? t('settings.ads.transactionsToThreshold', { count: Math.ceil(resolved.triggerAmountSats / resolved.perTxAmountSats) })
            : t('settings.ads.noPendingAmountIsAdded');
    };
    const thresholdTip = (
        <InfoTip
            aria={t('settings.ads.triggerThresholdHelpLabel')}
            label={t('settings.ads.aSatIsTheSmallest')}
        />
    );
    const sentences = chainIds.map(thresholdSentence);
    const sharedSentence = chainIds.length > 1 && sentences.every((x) => x === sentences[0]) ? sentences[0] : null;

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

            {sharedSentence ? (
                <div className={styles.hintRow} style={{ padding: '0 var(--xc-space-3)' }}>
                    <span id={sharedHintId}>{sharedSentence}</span>
                    {thresholdTip}
                </div>
            ) : null}

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
                const displayName = descriptor?.displayName || chainId;
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
                            hint={sharedSentence ? undefined : thresholdSentence(chainId)}
                            describedBy={sharedSentence ? sharedHintId : undefined}
                            tip={sharedSentence ? undefined : thresholdTip}
                        />

                        <DonationAddressField
                            chainId={chainId}
                            descriptor={descriptor}
                            displayName={displayName}
                            role={selectedDonationRole(chainState)}
                            disabled={!settings.ads.enabled}
                            onPick={(id, role) => onChainPatch(id, { donationAddressRole: role })}
                        />

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
