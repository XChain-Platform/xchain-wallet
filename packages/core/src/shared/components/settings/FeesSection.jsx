// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// FeesSection. §35.1 Fees panel + §44 fee UX. Per-chain.
//
// Each row corresponds to one entry under `settings.fees`. The
// `seedSettingsForChains` flow ensures every active chain has an
// entry; entries that exist for inactive chains still render so the
// user can clean them up if needed.
//
// Per chain we surface:
//   - Strategy picker: low / normal / fast / custom (see schema's
//     FEE_STRATEGIES tuple).
//   - Custom rate input in the chain's display fee unit (sat/vB or
//     DOGE/kB), stored as smallest-unit per KB, visible when strategy='custom'.
//   - RBF-by-default toggle.

import { useState } from 'react';
import { flows as flowsLib, registry as registryLib } from '@xchain-wallet/core';
import { resolveFeeConfig } from '../../../schemas/settings.js';
import {
    defaultCustomSettingsRate,
    displayRateToSettingsCustom,
    estimateNativeSendFeeTiers,
    resolveFeeUnit,
    settingsCustomToDisplayRate,
} from '../../../flows/feeEstimate.js';
import { useSettings } from '../../hooks/useSettings.js';
import {
    formatWithThousands,
    normalizeLocalizedDecimal,
} from '../../utils/amountFormat.js';
import {
    INPUT,
    SELECT,
    STACK,
    SettingsFieldRow,
    SettingsLoadError,
    Status,
    ToggleRow,
} from './_settingsPrimitives.jsx';
import { t } from '../../../i18n/index.js';

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
    padding: 'var(--xc-card-pad)',
    background: 'var(--xc-card-bg)',
    border: 'var(--xc-card-border)',
    borderRadius: 'var(--xc-card-radius)',
};
const CHAIN_HEADER = {
    fontWeight: 600,
    color: 'var(--xc-text)',
    fontSize: 'var(--xc-text-sm)',
};
export function FeesSection() {
    const { settings, loading, error, update } = useSettings();
    const [rateErrors, setRateErrors] = useState(/** @type {Record<string, string>} */ ({}));
    const [saveErrors, setSaveErrors] = useState(/** @type {Record<string, string>} */ ({}));

    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    // Chains are named without their network kind, so only the active
    // network's chains are listed and each chain appears once.
    const chainIds = flowsLib.filterChainIdsByActiveNetwork(
        Object.keys(settings.fees),
        settings,
        chainRegistry,
    ).sort();
    if (chainIds.length === 0) {
        return (
            <Status
                text={t('settings.fees.noChainFeeProfilesYet')}
            />
        );
    }

    const onPatch = async (chainId, patch, rollback) => {
        setSaveErrors((current) => {
            const next = { ...current };
            delete next[chainId];
            return next;
        });
        try {
            await update({ fees: { [chainId]: patch } });
        } catch (err) {
            rollback?.();
            setSaveErrors((current) => ({
                ...current,
                [chainId]: 'Could not save this fee setting. Try again.',
            }));
            // eslint-disable-next-line no-console
            console.error(`fees.${chainId} update failed:`, err);
        }
    };

    return (
        <div style={STACK}>
            {chainIds.map((chainId) => {
                // §35.10: stored null = follow the release default; render
                // the resolved preference. Writes may carry concrete
                // values - updateSettings normalizes a value equal to the
                // descriptor default back to null.
                const fees = resolveFeeConfig(settings.fees[chainId], chainRegistry.get(chainId));
                const descriptor = chainRegistry.get(chainId);
                const displayName = descriptor?.displayName || chainId;
                // Derive the unit and seed from the descriptor (a fixed 1000 is 1 sat/vB but 0.00001 DOGE/kB).
                const unit = resolveFeeUnit(descriptor);
                const seedRate = defaultCustomSettingsRate(unit);
                const rateBounds = estimateNativeSendFeeTiers({ chainId, chainRegistry });
                const headingId = `fee-settings-${chainId}`;
                const rateErrorId = `fee-rate-${chainId}-error`;
                return (
                    <div key={chainId} style={CHAIN_BLOCK} role="group" aria-labelledby={headingId}>
                        <div id={headingId} style={CHAIN_HEADER}>{displayName}</div>

                        <SettingsFieldRow
                            label={t('settings.fees.feeStrategy')}
                            hint={t('settings.fees.chooseTheBalanceBetweenConfirmation')}
                            embedded
                        >
                            <select
                                value={fees.strategy}
                                onChange={(e) => onPatch(chainId, {
                                    strategy: e.target.value,
                                    customSatsPerKb: e.target.value === 'custom' ? (fees.customSatsPerKb ?? seedRate) : null,
                                })}
                                aria-label={t('settings.fees.feeStrategy2', { displayName })}
                                style={SELECT}
                            >
                                {STRATEGIES.map((s) => (
                                    <option key={s.value} value={s.value}>{s.label}</option>
                                ))}
                            </select>
                        </SettingsFieldRow>

                        {fees.strategy === 'custom' ? (
                            <SettingsFieldRow
                                label={t('settings.fees.customFeeRate')}
                                hint={t('settings.fees.enterTheRateIn', { unit })}
                                embedded
                            >
                                <input
                                    id={`fee-rate-${chainId}`}
                                    type="text"
                                    inputMode="decimal"
                                    enterKeyHint="done"
                                    autoComplete="off"
                                    defaultValue={formatWithThousands(settingsCustomToDisplayRate(unit, fees.customSatsPerKb ?? seedRate))}
                                    onBlur={(e) => {
                                        // Store the typed display rate as the integer smallest-unit per KB the schema requires.
                                        const raw = e.target.value.trim();
                                        const canonical = normalizeLocalizedDecimal(raw);
                                        const displayRate = canonical !== null && canonical !== '' && canonical !== '.'
                                            ? Number(canonical)
                                            : Number.NaN;
                                        if (!Number.isFinite(displayRate) || displayRate < 0) {
                                            setRateErrors((current) => ({
                                                ...current,
                                                [chainId]: 'Enter a non-negative decimal fee rate.',
                                            }));
                                            return;
                                        }
                                        if (displayRate === 0) {
                                            setRateErrors((current) => ({
                                                ...current,
                                                [chainId]: t('settings.fees.rateGreaterThanZero'),
                                            }));
                                            return;
                                        }
                                        if (Number.isFinite(rateBounds?.minimumRate)
                                            && displayRate < rateBounds.minimumRate) {
                                            setRateErrors((current) => ({
                                                ...current,
                                                [chainId]: t('settings.fees.rateAtLeast', {
                                                    rate: formatWithThousands(rateBounds.minimumRate),
                                                    unit,
                                                }),
                                            }));
                                            return;
                                        }
                                        if (Number.isFinite(rateBounds?.maximumRate)
                                            && displayRate > rateBounds.maximumRate) {
                                            setRateErrors((current) => ({
                                                ...current,
                                                [chainId]: t('settings.fees.rateNoHigherThan', {
                                                    rate: formatWithThousands(rateBounds.maximumRate),
                                                    unit,
                                                }),
                                            }));
                                            return;
                                        }
                                        const n = displayRateToSettingsCustom(unit, displayRate);
                                        if (!Number.isSafeInteger(n) || n <= 0) {
                                            setRateErrors((current) => ({
                                                ...current,
                                                [chainId]: t('settings.fees.rateWithinSupportedRange'),
                                            }));
                                            return;
                                        }
                                        setRateErrors((current) => {
                                            const next = { ...current };
                                            delete next[chainId];
                                            return next;
                                        });
                                        const input = e.currentTarget;
                                        const previous = formatWithThousands(settingsCustomToDisplayRate(
                                            unit,
                                            fees.customSatsPerKb ?? seedRate,
                                        ));
                                        onPatch(chainId, {
                                            customSatsPerKb: n,
                                        }, () => { input.value = previous; });
                                    }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                    aria-label={t('settings.fees.customFeeRate2', { displayName })}
                                    aria-invalid={rateErrors[chainId] ? 'true' : undefined}
                                    aria-errormessage={rateErrors[chainId] ? rateErrorId : undefined}
                                    aria-describedby={rateErrors[chainId] ? rateErrorId : undefined}
                                    style={{ ...INPUT, width: 120, textAlign: 'right' }}
                                />
                            </SettingsFieldRow>
                        ) : null}
                        {rateErrors[chainId] ? <Status id={rateErrorId} text={rateErrors[chainId]} tone="error" /> : null}
                        {saveErrors[chainId] ? <Status text={saveErrors[chainId]} tone="error" /> : null}

                        <ToggleRow
                            label={t('settings.fees.allowFeeBumpReplaceBy')}
                            accessibleLabel={t('settings.fees.allowFeeBumpReplaceBy2', { displayName })}
                            hint={descriptor?.feeStrategy?.rbfSupported
                                ? t('settings.fees.keepThisOnSoYou')
                                : t('settings.fees.feeBumpingIsNotSupported', { displayName })}
                            checked={Boolean(fees.rbfByDefault)}
                            onChange={(v) => onPatch(chainId, {
                                rbfByDefault: v,
                            })}
                            disabled={!descriptor?.feeStrategy?.rbfSupported}
                            embedded
                        />
                    </div>
                );
            })}
        </div>
    );
}
