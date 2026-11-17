// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { Chip, Icon } from '@xchain-wallet/core/ui';
import { NetworkPicker } from '../../ui/NetworkPicker.jsx';
import { TokenListIcon } from '../../ui/icons/index.jsx';
import buttonStyles from '../../ui/Button.module.css';
import fieldStyles from '../../ui/ChainPicker.module.css';
import styles from './NetworkFilter.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/firstPaint.js';

/**
 * Single-select network filter that scales to N chains. Replaces the
 * fixed `[All] [BTC] [LTC] [DOGE]` chip row with one trigger button
 * that surfaces the currently selected filter; pressing it opens the
 * standard full-screen network list (NetworkPicker) with All networks
 * first and every coin family in the dataset after it, each row drawn
 * like a token row (operator ruling 2026-11-13: a network is always
 * chosen from that list, never a dropdown).
 *
 * `value` is the active filter: `'all'` or a coin family
 * (`'bitcoin'` / `'litecoin'` / `'dogecoin'` / …). `onChange`
 * fires with the new selection.
 *
 * @param {object} props
 * @param {import('../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {string[]} props.coinFamilies   coin families discovered in the active dataset, ordered for display
 * @param {string} props.value
 * @param {(coin: string) => void} props.onChange
 * @param {string} [props.ariaLabel]
 * @param {'sm' | 'md' | 'lg'} [props.size]
 * @param {boolean} [props.iconOnly]  draw only the filter or coin icon; the
 *   network name stays in the title and the accessible name (U12)
 * @param {boolean} [props.fieldTrigger]  draw the trigger like the standard
 *   network field (button base, network icon and name, list icon, no accent
 *   fill) instead of the chip; callers that leave it off keep the chip
 * @param {boolean} [props.fieldLook]  keep the chip trigger on the white
 *   field surface while a network is chosen, as every dropdown in a filter
 *   panel is (G96); the filter button's dot already says a filter is on
 */
export function NetworkFilter({
    chainRegistry,
    coinFamilies,
    value,
    onChange,
    ariaLabel,
    size = 'md',
    iconOnly = false,
    fieldTrigger = false,
    fieldLook = false,
}) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef(null);

    // The picker owns Back and Escape; closing returns focus to the trigger.
    const closeFilter = useCallback(() => {
        setOpen(false);
        triggerRef.current?.querySelector('button')?.focus();
    }, []);

    const chooseNetwork = useCallback((next) => {
        onChange(next);
        closeFilter();
    }, [closeFilter, onChange]);

    const entries = useMemo(() => {
        return coinFamilies.map((coin) => {
            const desc = chainRegistry.byCoin(coin)[0];
            return {
                coin,
                label: desc?.displayName || coin,
                ticker: shortLabelForCoin(coin),
                chainId: desc?.id,
                color: desc?.color,
            };
        });
    }, [coinFamilies, chainRegistry]);

    // A filter row is a coin family, not one chain, so its line under the
    // name is the ticker alone: the family's first descriptor need not be on
    // the network the wallet is using.
    const pickerOptions = useMemo(() => entries.map((e) => ({
        value: e.coin,
        chainId: e.chainId || '',
        title: e.label,
        ticker: e.ticker,
        description: e.ticker,
    })), [entries]);

    const triggerLabel = value === 'all'
        ? t('common.allNetworks')
        : (entries.find((e) => e.coin === value)?.label || value);
    const triggerCount = value === 'all'
        ? t('components.networkFilter.networkCount', { count: entries.length })
        : null;
    const triggerAriaLabel = ariaLabel
        || [triggerLabel, triggerCount].filter(Boolean).join(', ');
    const triggerIconUrl = value === 'all'
        ? null
        : branding.chainIconSmallUrl(entries.find((e) => e.coin === value)?.chainId || '');

    const triggerProps = {
        onClick: () => setOpen(true),
        // The arrows open the list as they opened the old dropdown.
        onKeyDown: (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            setOpen(true);
        },
        'aria-haspopup': 'dialog',
        'aria-expanded': open ? 'true' : 'false',
        'aria-label': triggerAriaLabel,
        title: triggerLabel,
    };
    const asField = fieldTrigger && !iconOnly;

    // The list fills the app frame as NetworkField's does.
    const portalTarget = typeof document === 'undefined'
        ? null
        : triggerRef.current?.closest('#xc-main')?.parentElement || document.body;

    return (
        <div
            ref={triggerRef}
            className={[styles.wrap, styles[size], iconOnly ? styles.iconOnly : '',
                asField ? fieldStyles.wrap : '', asField ? fieldStyles[size] : '']
                .filter(Boolean).join(' ')}
        >
            {asField ? (
                <button
                    type="button"
                    // The icon always shows, so it always takes its G112 slot.
                    className={`${buttonStyles.btn} ${fieldStyles.trigger} ${fieldStyles.leadIcon}`}
                    {...triggerProps}
                >
                    <span className={fieldStyles.triggerIcon} aria-hidden="true">
                        {triggerIconUrl ? <img src={triggerIconUrl} alt="" /> : <Icon.FilterIcon />}
                    </span>
                    <span className={fieldStyles.triggerText}>
                        <span className={fieldStyles.triggerLabel}>{triggerLabel}</span>
                    </span>
                    <span className={fieldStyles.triggerCaret} aria-hidden="true">
                        <TokenListIcon />
                    </span>
                </button>
            ) : (
                <Chip
                    pressed={value !== 'all'}
                    className={[styles.trigger, value === 'all' || fieldLook ? styles.idle : '',
                        fieldLook ? styles.fieldLook : ''].filter(Boolean).join(' ')}
                    {...triggerProps}
                >
                    <span className={styles.triggerIcon} aria-hidden="true">
                        {triggerIconUrl ? (
                            <img src={triggerIconUrl} alt="" />
                        ) : (
                            <Icon.FilterIcon />
                        )}
                    </span>
                    {iconOnly ? null : (
                        <span className={styles.triggerText}>
                            <span className={styles.triggerLabel}>{triggerLabel}</span>
                        </span>
                    )}
                    {/* The list mark, as on the Network field: this opens a
                        full-screen list, not a dropdown. */}
                    <span className={styles.triggerCaret} aria-hidden="true">
                        <TokenListIcon />
                    </span>
                </Chip>
            )}
            {open && portalTarget ? createPortal(
                <NetworkPicker
                    label={t('settings.network.label')}
                    value={value}
                    options={pickerOptions}
                    onSelect={chooseNetwork}
                    onBack={closeFilter}
                    contained={portalTarget !== document.body}
                    allOption
                />,
                portalTarget,
            ) : null}
        </div>
    );
}

function shortLabelForCoin(coin) {
    const map = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
    return map[coin] || coin.toUpperCase();
}
