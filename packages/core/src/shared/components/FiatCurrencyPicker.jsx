// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useRef, useState } from 'react';
import { EmptyState, Icon, ListPage, ListRow, PageHeader, Screen } from '@xchain-wallet/core/ui';
import { ListFilterMenu } from './ListFilterMenu.jsx';
import {
    fiatCurrencies,
    fiatCurrencyMatches,
    fiatCurrencySymbol,
} from '../utils/fiatCurrencies.js';
import styles from './FiatCurrency.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/settings.js';

const RESULTS_ID = 'xc-fiat-currency-picker-results';

/**
 * FiatCurrencyPicker: the page a FiatCurrencyField opens (G122). The standard
 * page header with Back and the title-bar filter holding the search (G95),
 * over one list card of currencies. Each row is the currency's symbol mark,
 * its code and full name, and a short description line; the chosen one shows
 * a check. Rows only select, so they carry no chevron (G97). A pick hands the
 * ISO code back and the host returns to the form.
 *
 * @param {object} props
 * @param {'small' | 'full'} [props.variant]
 * @param {readonly string[]} [props.codes]   the codes the form accepts, in order; defaults to the Settings display currencies
 * @param {string} [props.value]              the chosen code, checked in the list
 * @param {(code: string) => void} props.onSelect
 * @param {() => void} props.onBack
 * @param {string} [props.title]
 * @param {{ label: string, description?: string }} [props.noneOption]  an optional field's "no currency" row, picked as ''
 * @param {import('react').ReactNode} [props.notice]  a host's notice over the list, such as Settings' save error
 * @param {boolean} [props.disabled]                  rows wait while the host saves a pick
 * @param {string} [props.backLabel]                  the Back button's name, as the host page words it
 */
export function FiatCurrencyPicker({
    variant,
    codes,
    value = '',
    onSelect,
    onBack,
    title = t('components.fiatCurrencyPicker.title'),
    noneOption,
    notice = null,
    disabled = false,
    backLabel,
}) {
    const [query, setQuery] = useState('');
    const resultsRef = useRef(/** @type {HTMLUListElement | null} */ (null));
    const chosen = String(value || '').toUpperCase();
    const shown = fiatCurrencies(codes).filter((currency) => fiatCurrencyMatches(currency, query));
    const showNone = Boolean(noneOption) && !query.trim();

    // Enter in the search box picks the top row; the arrows move into the list.
    const onSearchKeyDown = (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
        const rows = Array.from(resultsRef.current?.querySelectorAll('button') || []);
        const row = event.key === 'ArrowUp' ? rows.at(-1) : rows[0];
        if (!row) return;
        event.preventDefault();
        if (event.key === 'Enter') row.click();
        else row.focus();
    };

    const onListKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onBack?.();
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const rows = Array.from(resultsRef.current?.querySelectorAll('button') || []);
        const index = rows.indexOf(document.activeElement);
        if (index < 0 || rows.length === 0) return;
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? (index + 1) % rows.length : (index - 1 + rows.length) % rows.length;
        rows[next].focus();
    };

    const check = (selected) => (selected ? (
        <span className={styles.check} aria-hidden="true" data-fiat-currency-check="">
            <Icon.CheckIcon />
        </span>
    ) : undefined);

    const header = (
        <PageHeader
            nested
            onBack={onBack}
            backLabel={backLabel}
            title={title}
            trailing={(
                <ListFilterMenu
                    query={query}
                    onQueryChange={setQuery}
                    label={t('components.fiatCurrencyPicker.filter')}
                    // The Settings currency page's search words.
                    searchPlaceholder={t('settings.languageRegion.searchByCodeOrName')}
                    searchLabel={t('settings.appearancePages.searchCurrencies')}
                    onSearchKeyDown={onSearchKeyDown}
                    resultsId={RESULTS_ID}
                />
            )}
        />
    );

    return (
        <Screen variant={variant} header={header}>
            <ListPage notices={notice}>
                {shown.length === 0 && !showNone ? (
                    <EmptyState
                        title={t('components.fiatCurrencyPicker.noMatchTitle')}
                        body={t('components.fiatCurrencyPicker.noMatchBody', { query: query.trim() })}
                        actionLabel={t('components.fiatCurrencyPicker.clearSearch')}
                        actionIcon={<Icon.RefreshIcon />}
                        onAction={() => setQuery('')}
                    />
                ) : (
                    /* Safari needs an explicit list role because this class removes list styling. */
                    <ul
                        id={RESULTS_ID}
                        ref={resultsRef}
                        className={styles.list}
                        role="list"
                        aria-label={t('components.fiatCurrencyPicker.list')}
                        onKeyDown={onListKeyDown}
                        data-fiat-currency-picker=""
                    >
                        {showNone ? (
                            <li data-fiat-currency-choice="">
                                <ListRow
                                    type="button"
                                    className={styles.row}
                                    onClick={() => onSelect('')}
                                    aria-current={chosen === '' ? 'true' : undefined}
                                    disabled={disabled}
                                    leading={(
                                        <span className={`${styles.symbol} ${styles.rowSymbol}`} aria-hidden="true">
                                            <Icon.CoinsIcon />
                                        </span>
                                    )}
                                    title={noneOption.label}
                                    subtitle={noneOption.description || undefined}
                                    trailing={check(chosen === '')}
                                />
                            </li>
                        ) : null}
                        {shown.map((currency) => {
                            const selected = currency.code === chosen;
                            return (
                                <li key={currency.code} data-fiat-currency-choice={currency.code}>
                                    <ListRow
                                        type="button"
                                        className={styles.row}
                                        onClick={() => onSelect(currency.code)}
                                        aria-current={selected ? 'true' : undefined}
                                        disabled={disabled}
                                        leading={(
                                            <span className={`${styles.symbol} ${styles.rowSymbol}`} aria-hidden="true">
                                                {fiatCurrencySymbol(currency.code)}
                                            </span>
                                        )}
                                        title={(
                                            <span className={styles.rowTitle}>
                                                <span className={styles.rowCode}>{currency.code}</span>
                                                <span className={styles.rowName}>{currency.name}</span>
                                            </span>
                                        )}
                                        subtitle={currency.description || undefined}
                                        trailing={check(selected)}
                                    />
                                </li>
                            );
                        })}
                    </ul>
                )}
            </ListPage>
        </Screen>
    );
}
