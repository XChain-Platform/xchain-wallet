// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DisplaySection: §27.3 / §27.4 / Cluster I FOLLOWUP 1.
//
// Balance display options, the row pin and hide buttons, saved network
// filters and the reset. The watched, pinned and hidden token lists are the
// Tokens page (TokenListsSection), with the Add Watched Token page beside it.

import { useCallback, useState } from 'react';
import {
    Button,
    FormPage,
    FormSection,
    Icon,
    InfoTip,
    Select,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { useConfirmModal } from '../../hooks/useConfirmModal.js';
import { ConfirmModal } from '../ConfirmModal.jsx';
import layoutStyles from './DisplaySection.module.css';
import {
    NUMBER_FORMAT_DEFAULT,
    SMALL_BALANCE_FIAT_DEFAULT,
    SMALL_BALANCE_THRESHOLD_DEFAULT,
    resolveSmallBalanceFiat,
} from '../../../schemas/settings.js';
import { clearAllChainFilters } from '../../utils/chainFilterMemory.js';
import { formatFiatAmount } from '../../utils/fiatAmountFormat.js';

// The small-balance amounts this section offers, in the display currency; a
// stored amount off the list (typed on the Hide Small Balances page) is
// listed as its own choice.
const SMALL_BALANCE_PRESETS = ['0.01', '0.1', '1', '10'];
import {
    ROW,
    ROW_COPY,
    ROW_HINT,
    ROW_LABEL,
    SettingsLoadError,
    Status,
    ToggleRow,
} from './_settingsPrimitives.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/settings.js';
import '../../../i18n/locales/en/ui.js';

// `only` renders one part for its own Settings page: 'balances' (small
// balances, unknown tokens, threshold, number format), 'rows' (pin and hide
// buttons), 'lists' (saved network filters) or 'reset'. With no `only` every part renders.
export function DisplaySection({ only = null } = {}) {
    const show = (part) => !only || only === part;
    const { settings, loading, error, update } = useSettings({ reportsOwnError: true });
    const confirmDialog = useConfirmModal();
    // Cluster O FOLLOWUP 3: show a brief confirmation after a
    // filter-reset run so the click doesn't feel inert.
    const [resetMessage, setResetMessage] = useState(/** @type {{ text: string, variant: 'info' | 'success' } | null} */ (null));
    const [displayMessage, setDisplayMessage] = useState(/** @type {string | null} */ (null));
    const [saveError, setSaveError] = useState(/** @type {{ key: string, message: string } | null} */ (null));

    // Cluster O FOLLOWUP 3: reset all per-list chain-filter memory
    // entries. Affects History's enabledChains + the Home tab's coin-
    // family filter. Lives outside `update()` because the persistence
    // layer is localStorage, not vault settings (ephemeral UI prefs
    // that shouldn't survive a from-seed restore).
    const resetChainFilters = useCallback(() => {
        const count = clearAllChainFilters();
        setResetMessage(
            count === 0
                ? { text: t('settings.display.noFiltersToReset'), variant: 'info' }
                : { text: t('settings.display.resetFilters', { count }), variant: 'success' },
        );
    }, []);

    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    const showPinAffordance = settings?.showPinAffordance === true;
    const showHideAffordance = settings?.showHideAffordance === true;

    const setPinAffordance = (next) => {
        setSaveError(null);
        update({ showPinAffordance: !!next }).catch((err) => {
            setSaveError({ key: 'showPinAffordance', message: 'Could not save this display preference. Try again.' });
            // eslint-disable-next-line no-console
            console.error('display.showPinAffordance update failed:', err);
        });
    };
    const setHideAffordance = (next) => {
        setSaveError(null);
        update({ showHideAffordance: !!next }).catch((err) => {
            setSaveError({ key: 'showHideAffordance', message: 'Could not save this display preference. Try again.' });
            // eslint-disable-next-line no-console
            console.error('display.showHideAffordance update failed:', err);
        });
    };
    const updateDisplay = (key, patch) => {
        setDisplayMessage(null);
        setSaveError(null);
        update(patch).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('display preference update failed:', err);
            setSaveError({ key, message: 'Could not save this display preference. Try again.' });
        });
    };
    const resetDisplay = async () => {
        const confirmed = await confirmDialog.confirm({
            title: 'Reset display settings?',
            message: 'This restores all balance display options and clears pinned tokens, hidden tokens, and saved list preferences. This cannot be undone.',
            confirmLabel: 'Reset settings',
            danger: true,
        });
        if (!confirmed) return;
        setDisplayMessage(null);
        setSaveError(null);
        update({
            pinnedTokens: [],
            pinnedTokensByWallet: {},
            watchedTokens: [],
            hiddenTokens: [],
            hideUnknownTokens: false,
            showPinAffordance: false,
            showHideAffordance: false,
            smallBalanceThreshold: SMALL_BALANCE_THRESHOLD_DEFAULT,
            smallBalanceFiat: SMALL_BALANCE_FIAT_DEFAULT,
            numberFormat: NUMBER_FORMAT_DEFAULT,
            privacy: { hideSmallBalances: false },
        })
            .then(() => {
                clearAllChainFilters();
                setDisplayMessage('Display settings reset to defaults.');
            })
            .catch((err) => {
                // eslint-disable-next-line no-console
                console.error('display reset failed:', err);
                setSaveError({ key: 'reset', message: 'Could not reset display settings. Try again.' });
            });
    };

    return (
        <FormPage as="div" sectioned fullWidth label={t('settings.display.displaySettings')}>
            {/* On its own page the page title names the part, so each section
                drops its heading rather than repeat it (U18). */}
            {show('balances') ? (
            <FormSection title={only ? undefined : t('settings.display.balanceDisplay')}>
                <ToggleRow
                    label={t('settings.display.hideSmallBalances')}
                    help={t('settings.display.collapseBalancesBelowTheSelected')}
                    checked={settings.privacy?.hideSmallBalances === true}
                    onChange={(checked) => updateDisplay('hideSmallBalances', { privacy: { hideSmallBalances: checked } })}
                />
                <DisplaySaveError error={saveError} controlKey="hideSmallBalances" />
                <ToggleRow
                    label={t('settings.display.hideUnknownTokens')}
                    help={t('settings.display.collapseUnpricedTokensWithoutA')}
                    checked={settings.hideUnknownTokens === true}
                    onChange={(checked) => updateDisplay('hideUnknownTokens', { hideUnknownTokens: checked })}
                />
                <DisplaySaveError error={saveError} controlKey="hideUnknownTokens" />
                <div className={layoutStyles.fieldRow} style={{ ...ROW, display: 'grid' }}>
                    <div style={ROW_COPY}>
                        <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>
                            {t('settings.display.smallBalanceThreshold')}{' '}
                            <InfoTip
                                aria={t('ui.field.about', { label: t('settings.display.smallBalanceThreshold') })}
                                label={t('settings.smallBalances.noPriceNote')}
                            />
                        </span>
                    </div>
                    <Select
                        aria-label={t('settings.display.smallBalanceThreshold')}
                        value={resolveSmallBalanceFiat(settings)}
                        onChange={(e) => updateDisplay('smallBalanceFiat', { smallBalanceFiat: e.target.value })}
                    >
                        {(SMALL_BALANCE_PRESETS.includes(resolveSmallBalanceFiat(settings))
                            ? SMALL_BALANCE_PRESETS
                            : [...SMALL_BALANCE_PRESETS, resolveSmallBalanceFiat(settings)]).map((value) => (
                            <Select.Option key={value} value={value} icon={<Icon.FilterIcon />}>
                                {t('settings.smallBalances.summaryUnder', { amount: formatFiatAmount(value, settings.fiatCurrency || 'USD') })}
                            </Select.Option>
                        ))}
                    </Select>
                </div>
                <DisplaySaveError error={saveError} controlKey="smallBalanceFiat" />
                <div className={layoutStyles.fieldRow} style={{ ...ROW, display: 'grid' }}>
                    <div style={ROW_COPY}>
                        <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>
                            {t('settings.display.balanceNumberFormat')}{' '}
                            <InfoTip
                                aria={t('ui.field.about', { label: t('settings.display.balanceNumberFormat') })}
                                label={t('settings.display.changeDisplayedFormattingWithoutChanging')}
                            />
                        </span>
                    </div>
                    <Select
                        aria-label={t('settings.display.balanceNumberFormat')}
                        value={settings.numberFormat || NUMBER_FORMAT_DEFAULT}
                        onChange={(e) => updateDisplay('numberFormat', { numberFormat: e.target.value })}
                    >
                        <Select.Option value="full" icon={<Icon.ListIcon />}>1,234.50000000</Select.Option>
                        <Select.Option value="trim" icon={<Icon.MinusIcon />}>1,234.5</Select.Option>
                        <Select.Option value="plain" icon={<Icon.DocumentIcon />}>1234.50000000</Select.Option>
                    </Select>
                </div>
                <DisplaySaveError error={saveError} controlKey="numberFormat" />
            </FormSection>
            ) : null}

            {show('rows') ? (
            <FormSection
                title={only ? undefined : t('settings.display.rowAffordances')}
            >
                <ToggleRow
                    label={t('settings.display.showPinButtonOnRows')}
                    help={t('settings.display.displayAStarOnEach')}
                    checked={showPinAffordance}
                    onChange={setPinAffordance}
                />
                <DisplaySaveError error={saveError} controlKey="showPinAffordance" />
                <ToggleRow
                    label={t('settings.display.showHideButtonOnRows')}
                    help={t('settings.display.displayAHideAffordanceOn')}
                    checked={showHideAffordance}
                    onChange={setHideAffordance}
                />
                <DisplaySaveError error={saveError} controlKey="showHideAffordance" />
            </FormSection>
            ) : null}

            {show('lists') ? (
            <FormSection
                title={only ? undefined : t('settings.display.listPreferences')}
                description={t('settings.display.rememberTheLastSelectedChain')}
            >
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={ROW_LABEL}>{t('settings.display.savedChainFilters')}</span>
                </div>
                <Button size="sm" variant="secondary" icon={<Icon.RefreshIcon />} onClick={resetChainFilters}>
                    {t('settings.display.resetListPreferences')}
                </Button>
            </div>
            {/* Row results sit under the row at full width, like the other
                settings messages, not squeezed into the label column. */}
            {resetMessage ? (
                <StatusMessage variant={resetMessage.variant}>{resetMessage.text}</StatusMessage>
            ) : null}
            </FormSection>
            ) : null}

            {show('reset') ? (
            <FormSection title={only ? undefined : t('settings.display.defaults')}>
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={ROW_LABEL}>{t('settings.display.resetDisplaySettings')}</span>
                    <span style={ROW_HINT}>{t('settings.display.restoresBalanceDisplayOptionsAnd')}</span>
                </div>
                <Button size="sm" variant="secondary" icon={<Icon.RefreshIcon />} onClick={resetDisplay}>
                    {t('settings.display.resetToDefaults')}
                </Button>
            </div>
            {displayMessage ? <StatusMessage variant="success">{displayMessage}</StatusMessage> : null}
            <DisplaySaveError error={saveError} controlKey="reset" />
            </FormSection>
            ) : null}
            {/* Any part may ask to confirm, so the dialog sits outside the parts. */}
            {confirmDialog.request ? (
                <ConfirmModal
                    {...confirmDialog.request}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            ) : null}
        </FormPage>
    );
}

function DisplaySaveError({ error, controlKey }) {
    return error?.key === controlKey ? (
        <StatusMessage variant="error">{error.message}</StatusMessage>
    ) : null;
}
