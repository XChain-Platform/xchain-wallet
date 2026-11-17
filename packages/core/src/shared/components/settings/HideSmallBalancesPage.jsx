// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings > Appearance > Hide Small Balances (operator ruling 2026-11-14).
//
// The switch sits at the top; under it an Options | Hidden balances toggle.
// The whole page shows whether the switch is on or off, so turning it never
// makes anything appear or vanish here. Options holds the amount in the
// display currency (a balance worth less folds away on Home); Hidden balances
// lists the wallet's balances with the ones under that amount greyed and
// tagged, judged by the same rule Home uses (smallBalanceKeys) and updated as
// the amount is typed.
//
// The list costs no network reads: the balances are Home's saved copy (one
// local read) and the prices are the ones Home already loaded, read from the
// shared rate store without refreshing.

import { useEffect, useId, useMemo, useState } from 'react';
import { Icon, Input, ListRow, StatusMessage, Tabs } from '@xchain-wallet/core/ui';
import { isDemoWallet } from '@xchain-wallet/core/flows';
import groupListStyles from '../../routes/CoSignerAccountList.module.css';
import { AssetMark } from '../../../ui/AssetMark.jsx';
import { useSettings } from '../../hooks/useSettings.js';
import { useEscrowedBalances } from '../../hooks/useEscrowedBalances.js';
import { useMessaging } from '../../useMessaging.js';
import {
    useNativeFiatRates,
    useTokenFiatRates,
    priceNativeRows,
    priceTokenRows,
} from '../../hooks/useFiatRate.js';
import {
    SMALL_BALANCE_FIAT_MAX,
    isSmallBalanceFiat,
    pinnedTokensForWallet,
    resolveSmallBalanceFiat,
} from '../../../schemas/settings.js';
import {
    buildBalanceRows,
    coinFromChainId,
    formatAmount,
    smallBalanceKeys,
} from '../BalanceList.jsx';
import { readBalanceCache } from '../../utils/balanceCache.js';
import { readActiveWallet } from '../../utils/activeWalletMemory.js';
import { readActiveAccount } from '../../utils/activeAccountMemory.js';
import { isMainnetChainId } from '../../utils/mainnetChain.js';
import { formatFiatAmount } from '../../utils/fiatAmountFormat.js';
import { tickerForCoin } from '../../../registry/coinTicker.js';
import { defaultRegistry } from '../../../registry/index.js';
import { SettingsInlineRow, SettingsLoadError } from './SettingsInlineRow.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/settings.js';
import styles from './HideSmallBalancesPage.module.css';

// The same inline surface as Settings' group lists: the page surface is a
// card, so the shared nested-card rule strips a class border (2026-11-15).
const LIST_SURFACE = { border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', background: 'var(--xc-surface)' };

/** The Hide small balances row's value: "Off", or "Under $1.00" when on. */
export function smallBalancesSummary(settings) {
    if (!settings) return '-';
    if (settings.privacy?.hideSmallBalances !== true) return t('settings.privacy.off');
    const amount = formatFiatAmount(resolveSmallBalanceFiat(settings), settings.fiatCurrency || 'USD');
    return t('settings.smallBalances.summaryUnder', { amount });
}

/** The typed amount in its stored form ("1,000" -> "1000", "0.50" -> "0.5"), or null. */
export function normalizeSmallBalanceAmount(raw) {
    const text = String(raw ?? '').trim().replace(/[,\s]/g, '');
    const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
    if (!match || (match[1] === '' && !match[2])) return null;
    const whole = (match[1] || '0').replace(/^0+(?=\d)/, '');
    const frac = (match[2] || '').replace(/0+$/, '');
    const value = frac ? `${whole}.${frac}` : whole;
    return isSmallBalanceFiat(value) ? value : null;
}

// The stored amount as the field shows it: always two decimals ("1.00").
function draftFor(value) {
    const [whole, frac = ''] = String(value).split('.');
    return `${whole}.${frac.padEnd(2, '0')}`;
}

/**
 * The wallet's balance rows as Home last saw them, priced with the rates Home
 * already loaded. One local read for the balances, none per row; the rate
 * hooks read the shared store with refreshing off, so nothing is fetched.
 * Open-offer escrow joins through Home's own shared escrow read (one per
 * shown address, reused from Home's when it is under a minute old), so a
 * token held in full in an offer stays listed here as it does on Home.
 */
function usePreviewRows({ walletId, accountId, settings }) {
    const { messaging } = useMessaging();
    const network = settings ? (settings.activeNetwork || 'mainnet') : null;
    const cached = useMemo(
        () => (walletId && network ? readBalanceCache(walletId, accountId, network) : null),
        [walletId, accountId, network],
    );
    const withEscrow = useEscrowedBalances({
        balances: cached?.balances || null,
        activeByChain: cached?.activeByChain || null,
        messaging,
    });
    const rows = useMemo(
        () => (withEscrow ? buildBalanceRows(withEscrow, defaultRegistry(), cached?.activeByChain) : []),
        [withEscrow, cached],
    );
    const demo = isDemoWallet(walletId);
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    const nativeCoins = useMemo(() => (demo ? [] : rows
        .filter((r) => r.kind === 'native' && isMainnetChainId(r.chainId))
        .map((r) => r.coin || coinFromChainId(r.chainId))), [rows, demo]);
    const tokenRequests = useMemo(() => (demo ? [] : rows
        .filter((r) => r.kind !== 'native' && isMainnetChainId(r.chainId) && typeof r.fiatRate !== 'number')
        .map((r) => {
            const coin = r.coin || coinFromChainId(r.chainId);
            return { chainCoin: coin, tick: r.tick, nativeTicker: tickerForCoin(coin) };
        })), [rows, demo]);
    const nativeRates = useNativeFiatRates({ chainCoins: nativeCoins, fiatCurrency, refreshEnabled: false });
    const tokenRates = useTokenFiatRates({ tokens: tokenRequests, fiatCurrency, refreshEnabled: false });
    const priced = useMemo(() => {
        const out = priceTokenRows(priceNativeRows(rows, nativeRates), tokenRates);
        // Test coins have no market price, as on Home; the demo wallet prices its own.
        return demo ? out : out.map((r) => (isMainnetChainId(r.chainId) ? r : { ...r, fiatRate: null }));
    }, [rows, nativeRates, tokenRates, demo]);
    return { rows: priced, loaded: Boolean(cached) };
}

function RowIcon({ icon: Glyph }) {
    return (
        <span className={`${groupListStyles.rowIcon} ${styles.rowIcon}`} aria-hidden="true">
            <Glyph />
        </span>
    );
}

/**
 * @param {object} props
 * @param {string | null} [props.walletId]    the wallet whose balances the preview lists (the active one)
 * @param {string | null} [props.accountId]   its active account
 */
export function HideSmallBalancesPage({ walletId: walletIdProp = null, accountId: accountIdProp = null } = {}) {
    const { settings, error, update } = useSettings({ reportsOwnError: true });
    const walletId = walletIdProp || readActiveWallet();
    const accountId = accountIdProp || readActiveAccount(walletId);
    const baseId = useId();
    const tabsId = `${baseId}-small-balances`;
    const panelId = `${tabsId}-panel`;
    const fieldId = `${baseId}-amount`;
    const [view, setView] = useState('options');
    const stored = settings ? resolveSmallBalanceFiat(settings) : null;
    const [draft, setDraft] = useState('');
    const [amountError, setAmountError] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        // The stored amount fills the field, and a value saved elsewhere refills it.
        if (stored !== null) setDraft(draftFor(stored));
    }, [stored]);
    const { rows, loaded } = usePreviewRows({ walletId, accountId, settings });

    if (error) return <SettingsLoadError error={error} />;

    const currency = settings?.fiatCurrency || 'USD';
    const on = settings?.privacy?.hideSmallBalances === true;
    // The preview follows the amount as it is typed; a half-typed or invalid
    // amount keeps the stored one.
    const threshold = normalizeSmallBalanceAmount(draft) ?? stored;

    const commit = async () => {
        if (!settings) return;
        const value = normalizeSmallBalanceAmount(draft);
        if (value === null) {
            setAmountError(t('settings.smallBalances.amountError', { max: formatFiatAmount(SMALL_BALANCE_FIAT_MAX, currency) }));
            return;
        }
        setAmountError(null);
        setDraft(draftFor(value));
        if (value === settings.smallBalanceFiat) return;
        try {
            await update({ smallBalanceFiat: value });
        } catch (err) {
            setAmountError(t('settings.smallBalances.saveFailed'));
            // eslint-disable-next-line no-console
            console.error('settings smallBalanceFiat update failed:', err);
        }
    };

    const switchRow = {
        id: 'display-balances-switch',
        title: t('settings.display.hideSmallBalances'),
        icon: Icon.EyeOffIcon,
        line: t('settings.smallBalances.switchLine'),
        help: t('settings.smallBalances.switchHelp'),
        control: {
            kind: 'switch',
            checked: (st) => st.privacy?.hideSmallBalances === true,
            patch: (next) => ({ privacy: { hideSmallBalances: next } }),
        },
    };

    const tabItems = [
        { id: 'options', label: t('settings.smallBalances.tabOptions'), icon: <Icon.FilterIcon />, controls: panelId },
        { id: 'hidden', label: t('settings.smallBalances.tabHidden'), icon: <Icon.EyeOffIcon />, controls: panelId },
    ];

    return (
        <div className={styles.page}>
            {/* Safari needs an explicit list role because this class removes list styling. */}
            <ul className={`${groupListStyles.list} ${styles.card}`} role="list" aria-label={t('settings.display.hideSmallBalances')} style={LIST_SURFACE}>
                <li data-settings-row-id={switchRow.id}>
                    <SettingsInlineRow row={switchRow} leading={<RowIcon icon={switchRow.icon} />} settings={settings} update={update} />
                </li>
            </ul>
            <Tabs
                id={tabsId}
                items={tabItems}
                value={view}
                onChange={setView}
                aria-label={t('settings.smallBalances.views')}
            />
            <div
                id={panelId}
                role="tabpanel"
                aria-labelledby={`${tabsId}-tab-${view}`}
                data-view={view}
                className={styles.panel}
            >
                {view === 'options' ? (
                    <>
                        <div className={`${styles.card} ${styles.amountCard}`} data-small-balance-options="" style={{ ...LIST_SURFACE, padding: 'var(--xc-space-3)' }}>
                            {/* The label sits above the row so the currency
                                lines up with the field box, not its label. */}
                            <label className={styles.amountLabel} htmlFor={fieldId}>
                                {t('settings.smallBalances.amountLabel')}
                            </label>
                            <div className={styles.amountRow}>
                                <span className={styles.currency} aria-hidden="true" data-small-balance-currency="">
                                    <Icon.DollarIcon />
                                    {currency}
                                </span>
                                <div className={styles.amountField}>
                                    <Input
                                        id={fieldId}
                                        hint={t('settings.smallBalances.amountHint', { currency })}
                                        type="text"
                                        inputMode="decimal"
                                        enterKeyHint="done"
                                        autoComplete="off"
                                        value={draft}
                                        disabled={!settings}
                                        error={amountError || undefined}
                                        onChange={(e) => { setDraft(e.target.value); if (amountError) setAmountError(null); }}
                                        onBlur={commit}
                                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                        data-testid="small-balance-amount"
                                    />
                                </div>
                            </div>
                        </div>
                        <StatusMessage variant="info">{t('settings.smallBalances.noPriceNote')}</StatusMessage>
                    </>
                ) : (
                    <HiddenBalancesPreview
                        rows={rows}
                        loaded={loaded}
                        on={on}
                        threshold={threshold}
                        settings={settings}
                        walletId={walletId}
                    />
                )}
            </div>
        </div>
    );
}

/**
 * The wallet's balances with the ones under the amount greyed and tagged:
 * "Hidden" while the switch is on, "Would hide" while it is off.
 */
function HiddenBalancesPreview({ rows, loaded, on, threshold, settings, walletId }) {
    const hiddenKeys = useMemo(
        () => new Set(Array.isArray(settings?.hiddenTokens) ? settings.hiddenTokens : []),
        [settings?.hiddenTokens],
    );
    const pinnedKeys = useMemo(
        () => new Set(pinnedTokensForWallet(settings, walletId)),
        [settings, walletId],
    );
    // Rows the user hid by hand are in Home's Hidden group, not this list.
    const listed = useMemo(
        () => rows.filter((r) => !hiddenKeys.has(`${r.chainId}:${r.tick}`)),
        [rows, hiddenKeys],
    );
    const small = useMemo(
        () => (threshold ? smallBalanceKeys(listed, threshold, pinnedKeys) : new Set()),
        [listed, threshold, pinnedKeys],
    );
    if (!settings) return null;
    if (!loaded || listed.length === 0) {
        return <StatusMessage variant="info">{t('settings.smallBalances.previewEmpty')}</StatusMessage>;
    }
    const numberFormat = settings.numberFormat;
    return (
        <>
            <p className={styles.previewHeading} aria-live="polite" data-small-balance-count={small.size}>
                {on
                    ? t('settings.smallBalances.previewOn', { hidden: small.size, total: listed.length })
                    : t('settings.smallBalances.previewOff', { hidden: small.size, total: listed.length })}
            </p>
            {/* Safari needs an explicit list role because this class removes list styling. */}
            <ul className={`${groupListStyles.list} ${styles.card}`} role="list" aria-label={t('settings.smallBalances.previewLabel')} style={LIST_SURFACE}>
                {listed.map((r) => {
                    const key = `${r.chainId}:${r.tick}`;
                    const isSmall = small.has(key);
                    const isNative = r.kind === 'native';
                    const amount = `${formatAmount(r.quantity, r.divisibility, numberFormat)} ${r.tick}`;
                    return (
                        <li
                            key={key}
                            data-small-balance-row={key}
                            data-small={isSmall ? 'true' : 'false'}
                        >
                            <ListRow
                                leading={(
                                    <span className={isSmall ? styles.dimmedMark : undefined}>
                                        <AssetMark chainId={r.chainId} tick={r.tick} isNative={isNative} />
                                    </span>
                                )}
                                contentClassName={isSmall ? styles.dimmedText : undefined}
                                title={r.displayName || r.tick}
                                subtitle={isNative
                                    ? t('settings.smallBalances.nativeCoin')
                                    : t('settings.smallBalances.tokenOn', { chain: defaultRegistry().get(r.chainId)?.displayName || r.chainId })}
                                trailing={(
                                    <span className={styles.trailing}>
                                        <span className={isSmall ? `${styles.amount} ${styles.dimmedAmount}` : styles.amount}>{amount}</span>
                                        {isSmall ? (
                                            <span className={styles.tag} data-small-balance-tag="">
                                                {on ? t('settings.smallBalances.tagHidden') : t('settings.smallBalances.tagWouldHide')}
                                            </span>
                                        ) : null}
                                    </span>
                                )}
                            />
                        </li>
                    );
                })}
            </ul>
        </>
    );
}
