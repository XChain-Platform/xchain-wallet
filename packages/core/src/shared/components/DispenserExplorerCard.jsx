// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { registry as registryLib } from '@xchain-wallet/core';
import { Icon } from '@xchain-wallet/core/ui';
import { TickerIcon } from './TickerIcon.jsx';
import { formatDecimal } from '../utils/dispenserPricing.js';
import { formatRelativeTime } from '../utils/dateTime.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/dispenserExplorer.js';
import styles from './DispenserExplorerCard.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Tokens still in a dispenser's escrow, from the freshest field the row has.
 *
 * @param {any} row
 * @returns {number | null}
 */
export function dispenserStockLeft(row) {
    const raw = row?.state?.give_remaining ?? row?.escrow_remaining ?? row?.give_remaining;
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

/**
 * Tokens the dispenser was loaded with. Only the list lane's give_escrow
 * carries it; rows without it get no stock bar rather than a guessed one.
 *
 * @param {any} row
 * @returns {number | null}
 */
export function dispenserStockTotal(row) {
    const raw = row?.give_escrow;
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * One Dispenser Explorer row, three lines: the terms ("1,000 TOKEN for 147
 * DOGE"), a stock bar when the row says how much it was loaded with, and the
 * stock left with when it opened. The token icon's chain badge names the
 * network; the row prints no coin name and no address. The explorer rows
 * carry no last-fill time, so the opening time stands in.
 *
 * @param {object} props
 * @param {string} props.chainId
 * @param {any} props.row               an open dispenser row from the explorer list lane
 * @param {string} props.priceLabel      what one fill costs, from dispenserFillPriceLabel
 * @param {() => void} props.onSelect    opens Dispenser Detail
 */
export function DispenserExplorerCard({ chainId, row, priceLabel, onSelect }) {
    const tick = row?.give_tick || '?';
    const give = `${formatDecimal(row?.give_amount)} ${tick}`;
    const chainName = chainRegistry.get(chainId)?.displayName || String(chainId || '').split('-')[0];
    const left = dispenserStockLeft(row);
    const total = dispenserStockTotal(row);
    const showBar = left != null && total != null;
    const pct = showBar ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
    const low = showBar && pct < 25;
    const opened = formatRelativeTime(row?.timestamp ?? row?.block_time);
    const stockText = left == null
        ? null
        : showBar
            ? `${formatDecimal(String(left))} of ${formatDecimal(String(total))} left`
            : `${formatDecimal(String(left))} left`;
    const openedText = opened ? t('dispenserExplorer.opened', { when: opened }) : null;
    const footText = [stockText, openedText].filter(Boolean).join(' · ');
    return (
        <button
            type="button"
            className={styles.row}
            onClick={onSelect}
            aria-label={t('dispenserExplorer.cardLabel', { give, price: priceLabel, chain: chainName })}
        >
            <span className={styles.icon} aria-hidden="true">
                <TickerIcon chainId={chainId} tick={tick} context="list" />
            </span>
            <span
                className={styles.body}
                data-testid="dispenser-result-facts"
                role="list"
                aria-label={t('dispenserExplorer.terms')}
            >
                <span className={styles.title} role="listitem" data-row-line="terms">
                    <span className={styles.give}>{give}</span>
                    {t('dispenserExplorer.forPrice')}
                    <span className={styles.price}>{priceLabel}</span>
                </span>
                {showBar ? (
                    <span className={styles.stockBar} aria-hidden="true" data-row-line="bar">
                        <span className={`${styles.fill} ${low ? styles.fillLow : ''}`} style={{ width: `${pct}%` }} />
                    </span>
                ) : null}
                {footText ? (
                    <span className={styles.foot} role="listitem" data-row-line="stock">{footText}</span>
                ) : null}
            </span>
            <span className={`${styles.chevron} ${styles.forward}`} data-row-chevron aria-hidden="true"><Icon.ForwardIcon /></span>
        </button>
    );
}

/**
 * A typed-search group row (a token or a seller) that opens or
 * folds the dispenser cards under it.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.leading
 * @param {import('react').ReactNode} props.title
 * @param {string} props.subtitle
 * @param {boolean} props.expanded
 * @param {string} props.controls        id of the card list this row opens
 * @param {() => void} props.onToggle
 */
export function DispenserExplorerGroupRow({ leading, title, subtitle, expanded, controls, onToggle }) {
    return (
        <button
            type="button"
            className={`${styles.row} ${styles.groupRow}`}
            aria-expanded={expanded ? 'true' : 'false'}
            aria-controls={controls}
            onClick={onToggle}
        >
            <span className={styles.icon} aria-hidden="true">{leading}</span>
            <span className={styles.body}>
                <span className={styles.title}>{title}</span>
                <span className={styles.meta}>{subtitle}</span>
            </span>
            <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`} aria-hidden="true">
                <Icon.ChevronDownIcon />
            </span>
        </button>
    );
}
