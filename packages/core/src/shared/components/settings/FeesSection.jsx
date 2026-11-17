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
import { Icon, Input, Select, Switch } from '@xchain-wallet/core/ui';
import { flows as flowsLib, registry as registryLib } from '@xchain-wallet/core';
import { EmptyState } from '@xchain-wallet/core/ui';
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
    SettingsLoadError,
    Status,
} from './_settingsPrimitives.jsx';
import { NetworkRowList } from './NetworkRowsPage.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/settings.js';

const chainRegistry = registryLib.defaultRegistry();

const STRATEGIES = /** @type {const} */ ([
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'fast', label: 'Fast' },
    { value: 'custom', label: 'Custom' },
]);

// One network's fee page: plain fields 8px apart (G80), no card and no
// divider lines between them.
const FEE_PAGE = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-2)',
    minWidth: 0,
};
const STRATEGY_SUMMARY = {
    low: () => t('settings.fees.summary.low'),
    normal: () => t('settings.fees.summary.normal'),
    fast: () => t('settings.fees.summary.fast'),
    custom: () => t('settings.fees.summary.custom'),
};

// A network's fee page id carries the chain id after the prefix.
export const FEES_NETWORK_PAGE_PREFIX = 'fees-network:';

// Fees is a list of the active networks; a row opens that network's own page
// with the strategy picker, custom rate and fee-bump toggle (G117).
export function FeesSection({ onOpen }) {
    const { settings, loading, error } = useSettings({ reportsOwnError: true });

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
            <EmptyState
                title={t('settings.fees.noChainFeeProfilesYet')}
                titleAs="p"
                body={t('settings.fees.noChainFeeProfilesYetBody')}
            />
        );
    }

    const rows = chainIds.map((chainId) => {
        const descriptor = chainRegistry.get(chainId);
        const fees = resolveFeeConfig(settings.fees[chainId], descriptor);
        const summary = STRATEGY_SUMMARY[fees.strategy] || STRATEGY_SUMMARY.normal;
        return {
            id: chainId,
            descriptor: descriptor || { id: chainId, displayName: chainId },
            name: descriptor?.displayName || chainId,
            summary: summary(),
        };
    });
    return (
        // No "Active networks" heading over the rows (operator walk
        // 2026-11-15); the list keeps that name for assistive tech.
        <NetworkRowList
            listLabel={t('settings.fees.networksGroup')}
            rows={rows}
            onOpen={(chainId) => onOpen?.(`${FEES_NETWORK_PAGE_PREFIX}${chainId}`)}
        />
    );
}

// One network's fee controls: strategy picker, custom rate when the strategy
// is custom, and the fee-bump toggle.
export function FeesNetworkPage({ chainId }) {
    const { settings, loading, error, update } = useSettings({ reportsOwnError: true });
    const [rateErrors, setRateErrors] = useState(/** @type {Record<string, string>} */ ({}));
    const [saveErrors, setSaveErrors] = useState(/** @type {Record<string, string>} */ ({}));

    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;
    if (!settings.fees?.[chainId]) return <Status text={t('settings.fees.noChainFeeProfilesYet')} />;

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
                const rbfSupported = Boolean(descriptor?.feeStrategy?.rbfSupported);
                // The page title names the coin, so the page holds no card and no
                // second coin label (operator walk 2026-11-15): the fee-bump switch
                // first, then the Fee strategy field, then the custom rate when
                // Custom is chosen. Explanations live in each field's '?' tip (U57).
                return (
                    <div key={chainId} style={FEE_PAGE} role="group" aria-label={displayName} data-fee-page={chainId}>
                        <Switch
                            label={t('settings.fees.allowFeeBumpReplaceBy')}
                            help={rbfSupported
                                ? t('settings.help.fees.rbf')
                                : `${t('settings.help.fees.rbf')} ${t('settings.fees.feeBumpingIsNotSupported')}`}
                            aria-label={t('settings.fees.allowFeeBumpReplaceBy2', { displayName })}
                            checked={Boolean(fees.rbfByDefault)}
                            onChange={(e) => onPatch(chainId, {
                                rbfByDefault: e.target.checked,
                            })}
                            disabled={!descriptor?.feeStrategy?.rbfSupported}
                            data-testid="fee-bump-switch"
                        />

                        <Select
                            label={t('settings.fees.feeStrategy')}
                            help={t('settings.help.fees.strategy')}
                            value={fees.strategy}
                            onChange={(e) => onPatch(chainId, {
                                strategy: e.target.value,
                                customSatsPerKb: e.target.value === 'custom' ? (fees.customSatsPerKb ?? seedRate) : null,
                            })}
                            aria-label={t('settings.fees.feeStrategy2', { displayName })}
                            data-testid="fee-strategy-select"
                        >
                            {STRATEGIES.map((s) => (
                                <Select.Option
                                    key={s.value}
                                    value={s.value}
                                    icon={s.value === 'low' ? <Icon.ClockIcon /> : s.value === 'fast' ? <Icon.ZapIcon /> : s.value === 'custom' ? <Icon.PencilIcon /> : <Icon.CoinsIcon />}
                                >
                                    {s.label}
                                </Select.Option>
                            ))}
                        </Select>

                        {fees.strategy === 'custom' ? (
                                <Input
                                    label={t('settings.fees.customFeeRate')}
                                    help={`${t('settings.help.fees.customRate')} ${t('settings.fees.enterTheRateIn', { unit })}`}
                                    error={rateErrors[chainId] || undefined}
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
                                    data-testid="fee-custom-rate"
                                />
                        ) : null}
                        {saveErrors[chainId] ? <Status text={saveErrors[chainId]} tone="error" /> : null}
                    </div>
                );
}

/**
 * The Settings page for a network's fee controls, or null when `pageId` is
 * not one. Settings resolves ids it does not list itself here.
 *
 * @param {string | null} pageId
 */
export function feesNetworkSectionFor(pageId) {
    if (typeof pageId !== 'string' || !pageId.startsWith(FEES_NETWORK_PAGE_PREFIX)) return null;
    const chainId = pageId.slice(FEES_NETWORK_PAGE_PREFIX.length);
    const d = chainRegistry.get(chainId);
    return {
        id: pageId,
        kind: 'internal-drill',
        title: d?.displayName || chainId,
        // G126: cardless below 600px, one form card from 600px.
        formFrame: true,
        Component: FeesNetworkPage,
        props: { chainId },
    };
}
