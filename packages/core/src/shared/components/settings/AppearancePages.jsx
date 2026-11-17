// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings > Appearance pages (operator rulings 2026-11-14). Theme, Language,
// Fiat currency, Hide small balances and Number format are chevron rows that
// show their current value and open a page here; Clear remembered network
// filters and Reset display settings open a confirm page with one button.
//
// Theme, Language and Fiat Currency are lists of selectable rows with a check
// on the chosen one, so more themes (custom, seasonal) join as list entries.
// Language and Fiat Currency return to Appearance on a pick; Theme stays, so
// the new look shows with the check moved. Every page writes the same keys
// and values as the row it replaced.
//
// Language and Fiat Currency draw their own screen (the row's ownsScreen), so
// their search sits behind the title-bar filter button like every list page
// (G04, G95); the Fiat Currency page is the shared FiatCurrencyPicker (G122).
// Number Format is a form: a centred sample over the Display format picker
// field, which opens the Display Format picker page.

import { useState } from 'react';
import { Button, Icon, ListPage, ListRow, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import groupListStyles from '../../routes/CoSignerAccountList.module.css';
import { FiatCurrencyPicker } from '../FiatCurrencyPicker.jsx';
import { ListField } from '../ListField.jsx';
import { ListFilterMenu } from '../ListFilterMenu.jsx';
import { useSettings } from '../../hooks/useSettings.js';
import {
    NUMBER_FORMAT_DEFAULT,
    SMALL_BALANCE_FIAT_DEFAULT,
    SMALL_BALANCE_THRESHOLD_DEFAULT,
    createDefaultSettings,
} from '../../../schemas/settings.js';
import { clearAllChainFilters } from '../../utils/chainFilterMemory.js';
import { titleCase } from '../../utils/titleCase.js';
import { formatAmount } from '../BalanceList.jsx';
import { THEME_OPTIONS, reducedMotionLabel, themeLabel } from './AppearanceSection.jsx';
import { FIAT_CURRENCIES, buildLanguageOptions, currencySummary, languageSummary } from './LanguageRegionSection.jsx';
import { SettingsLoadError } from './SettingsInlineRow.jsx';
import { availableLocales, setLocale, t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/settings.js';
import styles from './AppearancePages.module.css';

// The same inline surface as Settings' group lists (Settings.jsx group rows,
// HideSmallBalancesPage): the Settings page surface is a card, so the shared
// nested-card rule strips a class border and the list lost its rounded card.
export const LIST_SURFACE = Object.freeze({ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', background: 'var(--xc-surface)' });

// The Number Format page opens this page from its Display format field.
export const NUMBER_FORMAT_PICKER_PAGE_ID = 'display-number-format-picker';

const LANGUAGE_RESULTS_ID = 'xc-settings-language-results';

// ─── Row values ────────────────────────────────────────────────────

/** The Theme row's value ("System default", "Light", "Dark"). */
export function themeRowSummary(settings) {
    return settings ? themeLabel(settings.theme) : '-';
}

/** The Language row's value, as the Language page names it. */
export function languageRowSummary(settings) {
    return settings ? languageSummary(settings) : '-';
}

/** The Fiat currency row's value: name and code ("US Dollar (USD)"). */
export function currencyRowSummary(settings) {
    return settings ? currencySummary(settings) : '-';
}

// The Hide Small Balances page and its row value ("Off", "Under $1.00") live
// in their own file.
export { HideSmallBalancesPage, smallBalancesSummary } from './HideSmallBalancesPage.jsx';

// The number the Number Format sample and row value show: 1234.5678 at eight
// decimal places, formatted by the same code as the balance lists.
const SAMPLE_QUANTITY = '123456780000';
const SAMPLE_DIVISIBILITY = 8;

/** The sample amount in one number format, exactly as Home would show it. */
export function numberFormatSample(format) {
    return formatAmount(SAMPLE_QUANTITY, SAMPLE_DIVISIBILITY, format || NUMBER_FORMAT_DEFAULT);
}

/** The Number format row's value: the sample in the chosen format. */
export function numberFormatSummary(settings) {
    return settings ? numberFormatSample(settings.numberFormat) : '-';
}

// The three formats the balance code supports (schemas/settings.js
// NUMBER_FORMATS); decimal places always follow each coin or token.
function numberFormatChoices() {
    return [
        { value: 'full', label: t('settings.appearancePages.formatFull'), glyph: Icon.ListIcon },
        { value: 'trim', label: t('settings.appearancePages.formatTrim'), glyph: Icon.MinusIcon },
        { value: 'plain', label: t('settings.appearancePages.formatPlain'), glyph: Icon.DocumentIcon },
    ];
}

// ─── Shared pieces ─────────────────────────────────────────────────

// Exported with ChoiceList for the other Settings picker pages (Choose Sound).
export function RowIcon({ icon: Glyph }) {
    return (
        <span className={`${groupListStyles.rowIcon} ${styles.rowIcon}`} aria-hidden="true">
            <Glyph />
        </span>
    );
}

/**
 * Selectable rows in one card: a tap picks the row, and the chosen one shows
 * a check and is marked current for assistive tech.
 *
 * @param {object} props
 * @param {string} props.label   the list's accessible name
 * @param {Array<{ value: string, title: string, subtitle?: string, leading: import('react').ReactNode }>} props.choices
 * @param {string} props.value
 * @param {(value: string) => void} props.onSelect
 * @param {boolean} [props.busy]
 * @param {string} [props.id]    the list's id, for a header search's aria-controls
 */
export function ChoiceList({ label, choices, value, onSelect, busy = false, id }) {
    return (
        /* Safari needs an explicit list role because this class removes list styling. */
        <ul
            id={id}
            className={`${groupListStyles.list} ${styles.list}`}
            role="list"
            aria-label={label}
            style={LIST_SURFACE}
            data-settings-choice-list=""
        >
            {choices.map((choice) => {
                const selected = choice.value === value;
                return (
                    <li key={choice.value} data-settings-choice={choice.value}>
                        <div className={choice.onDelete ? styles.choiceWithAction : undefined}>
                            <ListRow
                                type="button"
                                onClick={() => onSelect(choice.value)}
                                aria-current={selected ? 'true' : undefined}
                                disabled={busy}
                                leading={choice.leading}
                                title={choice.title}
                                subtitle={choice.subtitle}
                                trailing={selected ? (
                                    <span className={styles.check} aria-hidden="true" data-settings-choice-check="">
                                        <Icon.CheckIcon />
                                    </span>
                                ) : undefined}
                            />
                            {choice.onDelete ? (
                                <Button
                                    type="button"
                                    variant="link"
                                    size="sm"
                                    icon={<Icon.TrashIcon />}
                                    aria-label={choice.deleteLabel || t('settings.choice.delete', { title: choice.title })}
                                    title={choice.deleteLabel || t('settings.choice.delete', { title: choice.title })}
                                    disabled={busy}
                                    onClick={choice.onDelete}
                                />
                            ) : null}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}

function Loading() {
    return <StatusMessage variant="info">{t('common.loading')}</StatusMessage>;
}

/**
 * The screen a page with its own header draws (the row's ownsScreen):
 * Settings' nested header with Back, the page's title-bar filter (the shared
 * ListFilterMenu, once the list has loaded), then the list page body.
 * Loading and load errors draw inside it too.
 */
function OwnScreen({ variant, nested = true, onBack, backLabel, title, filterMenu = null, notices = null, children }) {
    return (
        <Screen
            variant={variant}
            header={<PageHeader nested={nested} onBack={onBack} backLabel={backLabel} title={title} trailing={filterMenu} />}
        >
            <ListPage notices={notices}>{children}</ListPage>
        </Screen>
    );
}

const matches = (query, ...fields) => {
    const q = query.trim().toLocaleLowerCase();
    return !q || fields.some((f) => String(f || '').toLocaleLowerCase().includes(q));
};

// ─── Theme ─────────────────────────────────────────────────────────

const THEME_LOOKS = {
    system: { icon: Icon.GearIcon, line: () => t('settings.appearancePages.themeSystemLine') },
    light: { icon: Icon.EyeIcon, line: () => t('settings.appearancePages.themeLightLine') },
    dark: { icon: Icon.EyeOffIcon, line: () => t('settings.appearancePages.themeDarkLine') },
};

/** The themes as rows; a new theme is one more entry here and in the schema. */
function themeChoices() {
    return THEME_OPTIONS.map((option) => {
        const look = THEME_LOOKS[option.value] || { icon: Icon.PaletteIcon, line: null };
        return {
            value: option.value,
            title: option.label,
            subtitle: look.line ? look.line() : undefined,
            leading: <RowIcon icon={look.icon} />,
        };
    });
}

/** Settings > Appearance > Theme: every theme as a row, the chosen one checked. */
export function ThemePage() {
    const { settings, error, update } = useSettings({ reportsOwnError: true });
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Loading />;
    const current = settings.theme || 'system';
    const onSelect = async (next) => {
        if (next === current) return;
        setSaveError(null);
        try {
            await update({ theme: next });
        } catch (err) {
            setSaveError(t('settings.appearancePages.themeSaveFailed'));
            // eslint-disable-next-line no-console
            console.error('appearance.theme update failed:', err);
        }
    };
    return (
        <div className={styles.page}>
            {saveError ? <StatusMessage variant="error">{saveError}</StatusMessage> : null}
            <ChoiceList label={t('settings.appearancePages.themes')} choices={themeChoices()} value={current} onSelect={onSelect} />
        </div>
    );
}

// ─── Language ──────────────────────────────────────────────────────

// A language's own name and its English name; a code the platform cannot
// name (the pseudo-RTL test locale) keeps the picker's label.
function languageNames(code, fallback) {
    const nameIn = (locale) => {
        try {
            return new Intl.DisplayNames([locale], { type: 'language' }).of(code) || null;
        } catch {
            return null;
        }
    };
    const english = nameIn('en') || fallback;
    const native = nameIn(code) || english;
    return { native, english };
}

// Only the newest pick may save: an older pick still loading its
// translations is superseded, not an error.
let languagePick = 0;

/**
 * Settings > Appearance > Language: every available language in one card,
 * with the search behind the title-bar filter button; a pick returns. The
 * page draws its own screen (the row's ownsScreen) so the filter sits in its
 * header, as on My Wallets and History.
 */
export function LanguagePage({ onDone, onBack, backLabel, variant, nested = true }) {
    const { settings, error, update } = useSettings({ reportsOwnError: true });
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState(false);
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));
    const screen = { variant, nested, onBack, backLabel, title: t('settings.languageRegion.language') };
    if (error) return <OwnScreen {...screen}><SettingsLoadError error={error} /></OwnScreen>;
    if (!settings) return <OwnScreen {...screen}><Loading /></OwnScreen>;
    const current = settings.language || 'en';
    const all = buildLanguageOptions(settings.developerMode === true).map((option) => {
        const { native, english } = languageNames(option.value, option.label);
        return {
            value: option.value,
            title: native,
            // English is said once when both names match.
            subtitle: english !== native ? english : undefined,
            leading: <RowIcon icon={Icon.MessageIcon} />,
            search: [native, english, option.value],
        };
    });
    const shown = all.filter((c) => matches(query, ...c.search));

    const onSelect = async (next) => {
        const pick = ++languagePick;
        setSaveError(null);
        if (next === current) {
            onDone?.();
            return;
        }
        if (!availableLocales().includes(next)) return;
        setBusy(true);
        try {
            // The translations load before the choice is saved, so a failed
            // load never becomes the next launch's language.
            const applied = await setLocale(next);
            if (pick !== languagePick) return;
            if (applied !== next) {
                setSaveError(t('settings.languageRegion.languageUnavailable'));
                return;
            }
            await update({ language: next });
            onDone?.();
        } catch (err) {
            if (pick !== languagePick) return;
            setSaveError(t('settings.appearancePages.languageSaveFailed'));
            // eslint-disable-next-line no-console
            console.error('appearance.language update failed:', err);
        } finally {
            setBusy(false);
        }
    };

    // Enter in the header search picks the one match.
    const onSearchKeyDown = (event) => {
        if (event.key !== 'Enter' || shown.length !== 1) return;
        event.preventDefault();
        onSelect(shown[0].value);
    };

    return (
        <OwnScreen
            {...screen}
            filterMenu={(
                <ListFilterMenu
                    query={query}
                    onQueryChange={setQuery}
                    label={t('settings.appearancePages.filterLanguages')}
                    searchPlaceholder={t('settings.appearancePages.searchLanguages')}
                    searchLabel={t('settings.appearancePages.searchLanguages')}
                    onSearchKeyDown={onSearchKeyDown}
                    resultsId={LANGUAGE_RESULTS_ID}
                />
            )}
            notices={saveError ? <StatusMessage variant="error">{saveError}</StatusMessage> : null}
        >
            {shown.length ? (
                <ChoiceList id={LANGUAGE_RESULTS_ID} label={t('settings.appearancePages.languages')} choices={shown} value={current} onSelect={onSelect} busy={busy} />
            ) : (
                <StatusMessage variant="info">{t('settings.appearancePages.noLanguagesMatch')}</StatusMessage>
            )}
        </OwnScreen>
    );
}

// ─── Fiat currency ─────────────────────────────────────────────────

// The display currencies Settings can save, in the picker's order.
const SETTINGS_CURRENCY_CODES = Object.freeze(FIAT_CURRENCIES.map((c) => c.code));

/**
 * Settings > Appearance > Fiat Currency: the shared Fiat currency picker page
 * (G122), the same page the Oracle and Dispenser forms open: one card of
 * currencies (symbol, code, name, a description line) with the search behind
 * the title-bar filter button; a pick saves and returns.
 */
export function CurrencyPage({ onDone, onBack, backLabel, variant, nested = true }) {
    const { settings, error, update } = useSettings({ reportsOwnError: true });
    const [busy, setBusy] = useState(false);
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));
    const title = titleCase(t('settings.languageRegion.fiatCurrency'));
    const screen = { variant, nested, onBack, backLabel, title };
    if (error) return <OwnScreen {...screen}><SettingsLoadError error={error} /></OwnScreen>;
    if (!settings) return <OwnScreen {...screen}><Loading /></OwnScreen>;
    const current = settings.fiatCurrency || 'USD';

    const onSelect = async (next) => {
        setSaveError(null);
        if (next === current) {
            onDone?.();
            return;
        }
        setBusy(true);
        try {
            await update({ fiatCurrency: next });
            onDone?.();
        } catch (err) {
            setSaveError(t('settings.appearancePages.currencySaveFailed'));
            // eslint-disable-next-line no-console
            console.error('fiatCurrency.update failed:', err);
        } finally {
            setBusy(false);
        }
    };

    return (
        <FiatCurrencyPicker
            variant={variant}
            codes={SETTINGS_CURRENCY_CODES}
            value={current}
            title={title}
            onSelect={onSelect}
            onBack={onBack}
            backLabel={backLabel}
            disabled={busy}
            notice={saveError ? <StatusMessage variant="error">{saveError}</StatusMessage> : null}
        />
    );
}


// ─── Number format ─────────────────────────────────────────────────

/**
 * Settings > Appearance > Number Format, a Form Standard form: the live
 * sample centred at the top, then the Display format picker field (the
 * standard ListField, full width) showing the chosen format. Tapping the
 * field opens the Display Format picker page.
 *
 * @param {object} props
 * @param {(pageId: string) => void} [props.onOpenPage]  opens a Settings page; Back returns here
 */
export function NumberFormatPage({ onOpenPage }) {
    const { settings, error } = useSettings({ reportsOwnError: true });
    if (error) return <SettingsLoadError error={error} />;
    const format = settings?.numberFormat || NUMBER_FORMAT_DEFAULT;
    const chosen = numberFormatChoices().find((o) => o.value === format);
    const ChosenIcon = chosen?.glyph;
    return (
        <div className={styles.page} data-number-format-form="">
            <div className={styles.sample} aria-live="polite" data-number-format-sample-card="">
                <span className={styles.sampleLabel}>{t('settings.appearancePages.sample')}</span>
                <span className={styles.sampleValue} data-number-format-sample="">
                    {settings ? numberFormatSample(settings.numberFormat) : '-'}
                </span>
            </div>
            <ListField
                id="display-number-format-field"
                label={t('settings.appearancePages.formatTitle')}
                help={t('settings.appearancePages.formatHelp')}
                valueText={settings ? (chosen?.label ?? format) : null}
                icon={ChosenIcon ? <ChosenIcon /> : null}
                placeholder={t('common.loading')}
                disabled={!settings || typeof onOpenPage !== 'function'}
                onOpenPicker={() => onOpenPage?.(NUMBER_FORMAT_PICKER_PAGE_ID)}
            />
        </div>
    );
}

/**
 * Settings > Appearance > Number Format > Display Format: the picker page the
 * Display format field opens. One card of the three formats, each its icon,
 * name and the sample in that format, the chosen one checked; rows only
 * select, so no chevron (G97). A pick saves and returns to Number Format.
 */
export function NumberFormatPickerPage({ onDone }) {
    const { settings, error, update } = useSettings({ reportsOwnError: true });
    const [busy, setBusy] = useState(false);
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Loading />;
    const current = settings.numberFormat || NUMBER_FORMAT_DEFAULT;
    const choices = numberFormatChoices().map((o) => ({
        value: o.value,
        title: o.label,
        subtitle: numberFormatSample(o.value),
        leading: <RowIcon icon={o.glyph} />,
    }));
    const onSelect = async (next) => {
        setSaveError(null);
        if (next === current) {
            onDone?.();
            return;
        }
        setBusy(true);
        try {
            await update({ numberFormat: next });
            onDone?.();
        } catch (err) {
            setSaveError(t('settings.appearancePages.formatSaveFailed'));
            // eslint-disable-next-line no-console
            console.error('numberFormat.update failed:', err);
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className={styles.page}>
            {saveError ? <StatusMessage variant="error">{saveError}</StatusMessage> : null}
            <ChoiceList label={t('settings.appearancePages.formats')} choices={choices} value={current} onSelect={onSelect} busy={busy} />
        </div>
    );
}

// ─── Confirm pages ─────────────────────────────────────────────────

function ResultView({ result, onDone }) {
    return (
        <div className={styles.page}>
            <StatusMessage variant={result.variant}>{result.message}</StatusMessage>
            <div className={styles.actions}>
                <Button type="button" variant="success" block icon={<Icon.CheckIcon />} onClick={() => onDone?.()}>
                    {t('common.done')}
                </Button>
            </div>
        </div>
    );
}

/**
 * Settings > Appearance > Clear Remembered Network Filters: says what
 * clearing does, then one button. The filters live in this device's local
 * storage, not the vault.
 */
export function ClearNetworkFiltersPage({ onDone }) {
    const [result, setResult] = useState(/** @type {{ message: string, variant: 'info' | 'success' } | null} */ (null));
    if (result) return <ResultView result={result} onDone={onDone} />;
    const clear = () => {
        const count = clearAllChainFilters();
        setResult(count === 0
            ? { message: t('settings.appearancePages.noFiltersToClear'), variant: 'info' }
            : { message: t('settings.appearancePages.filtersCleared', { count }), variant: 'success' });
    };
    return (
        <div className={styles.page}>
            <p className={styles.body}>{t('settings.appearancePages.clearFiltersBody')}</p>
            <p className={styles.body}>{t('settings.appearancePages.clearFiltersKeeps')}</p>
            <div className={styles.actions}>
                <Button type="button" variant="success" block icon={<Icon.FilterIcon />} onClick={clear}>
                    {t('settings.appearancePages.clearFiltersAction')}
                </Button>
            </div>
        </div>
    );
}

/**
 * Settings > Appearance > Reset Display Settings: lists every value that goes
 * back to its default and every list it empties, then one button.
 */
export function ResetDisplayPage({ onDone }) {
    const { settings, error, update } = useSettings({ reportsOwnError: true });
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(/** @type {{ message: string, variant: 'success' } | null} */ (null));
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));
    if (result) return <ResultView result={result} onDone={onDone} />;
    if (error) return <SettingsLoadError error={error} />;
    const defaults = createDefaultSettings();
    const reset = async () => {
        setSaveError(null);
        setBusy(true);
        try {
            // The language loads before it is saved, as a pick on the Language page does.
            if (availableLocales().includes(defaults.language)) {
                const applied = await setLocale(defaults.language);
                if (applied !== defaults.language) throw new Error(`language ${defaults.language} did not load`);
            }
            await update({
                theme: defaults.theme,
                reducedMotion: defaults.reducedMotion,
                language: defaults.language,
                fiatCurrency: defaults.fiatCurrency,
                learnMode: defaults.learnMode,
                pinnedTokens: [],
                pinnedTokensByWallet: {},
                watchedTokens: [],
                hiddenTokens: [],
                hideUnknownTokens: defaults.hideUnknownTokens,
                showPinAffordance: defaults.showPinAffordance,
                showHideAffordance: defaults.showHideAffordance,
                smallBalanceThreshold: SMALL_BALANCE_THRESHOLD_DEFAULT,
                smallBalanceFiat: SMALL_BALANCE_FIAT_DEFAULT,
                numberFormat: NUMBER_FORMAT_DEFAULT,
                privacy: { hideSmallBalances: false, hapticsEnabled: defaults.privacy.hapticsEnabled },
            });
            clearAllChainFilters();
            setResult({ message: t('settings.appearancePages.resetDone'), variant: 'success' });
        } catch (err) {
            setSaveError(t('settings.appearancePages.resetFailed'));
            // eslint-disable-next-line no-console
            console.error('display reset failed:', err);
        } finally {
            setBusy(false);
        }
    };
    const format = numberFormatChoices().find((o) => o.value === NUMBER_FORMAT_DEFAULT)?.label ?? NUMBER_FORMAT_DEFAULT;
    return (
        <div className={styles.page}>
            {saveError ? <StatusMessage variant="error">{saveError}</StatusMessage> : null}
            <p className={styles.body}>{t('settings.appearancePages.resetIntro')}</p>
            <ul className={styles.changes}>
                <li>{t('settings.appearancePages.resetLook', { theme: themeLabel(defaults.theme), motion: reducedMotionLabel(defaults.reducedMotion) })}</li>
                <li>{t('settings.appearancePages.resetFeel')}</li>
                <li>{t('settings.appearancePages.resetRegion', { language: languageSummary(defaults), currency: currencySummary(defaults) })}</li>
                <li>{t('settings.appearancePages.resetBalances', { format })}</li>
                <li>{t('settings.appearancePages.resetRows')}</li>
            </ul>
            <p className={styles.body}>{t('settings.appearancePages.resetClears')}</p>
            <div className={styles.actions}>
                <Button
                    type="button"
                    variant="danger"
                    block
                    icon={<Icon.RefreshIcon />}
                    disabled={!settings || busy}
                    onClick={reset}
                >
                    {busy ? t('settings.appearancePages.resetting') : t('settings.appearancePages.resetAction')}
                </Button>
            </div>
        </div>
    );
}
