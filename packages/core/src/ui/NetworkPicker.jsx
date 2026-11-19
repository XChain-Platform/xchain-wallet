// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId, useLayoutEffect, useMemo, useRef } from 'react';
import { useFocusTrap } from '../shared/utils/focusTrap.js';
import { ACTIVE_NETWORK_OPTIONS, activeNetworkLabel } from '../shared/utils/activeNetworkSwitch.js';
import { FilterIcon, ForwardIcon } from './icons/index.jsx';
import { tickerForDescriptor } from '../registry/coinTicker.js';
import { AssetMark } from './AssetMark.jsx';
import { ListPage } from './ListPage.jsx';
import { ListRow } from './ListRow.jsx';
import { PageHeader } from './PageHeader.jsx';
import { Screen } from './Screen.jsx';
import { useBackHandler } from './backStack.js';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/components.js';
import '../i18n/locales/en/firstPaint.js';
import '../i18n/locales/en/ui.js';
// The token picker's row sheet, so a network row and a token row share one
// anatomy: the 40px mark, the name over a muted line, the right chevron, the
// list-row inset and the divider between rows (operator ruling 2026-11-13).
import rowStyles from '../shared/components/BalanceList.module.css';
import styles from './NetworkPicker.module.css';

/**
 * One row of the network list.
 *
 * @typedef {object} NetworkOption
 * @property {string} value         what a pick hands back (a chain id, a coin family)
 * @property {string} [chainId]     the chain whose icon the row draws
 * @property {string} title         the network's name, e.g. Bitcoin
 * @property {string} [description] the muted line under the name, e.g. BTC · Mainnet
 * @property {string} [ticker]      the coin ticker, drawn in the mark when the chain has no icon
 * @property {string} [actionName]  the network named in the row's accessible name
 */

/**
 * Rows for a list of chain ids: the chain's name over its coin ticker and
 * network kind, which is what tells Bitcoin on Mainnet from Bitcoin on Testnet.
 *
 * @param {string[]} chainIds
 * @param {import('../registry/index.js').ChainRegistry} chainRegistry
 * @returns {NetworkOption[]}
 */
export function networkOptionsForChains(chainIds, chainRegistry) {
    return (chainIds || []).map((id) => {
        const descriptor = chainRegistry?.get(id);
        const title = descriptor?.displayName || id;
        const networkKind = descriptor?.networkKind || 'mainnet';
        const ticker = descriptor ? tickerForDescriptor(descriptor) : '';
        const network = networkKindLabel(descriptor?.networkKind);
        // A chain the registry does not describe gets no line, rather than a
        // guessed ticker or network.
        const parts = [ticker, network].filter(Boolean);
        return {
            value: id,
            chainId: id,
            title,
            ticker,
            description: parts.length === 2
                ? t('ui.networkPicker.rowDescription', { ticker, network })
                : (parts[0] || ''),
            // Every network of a coin shares a name, so a non-mainnet row says
            // its network in its accessible name.
            actionName: networkKind === 'mainnet' ? title : `${title} ${networkKind} ${ticker}`,
        };
    });
}

// Mainnet, Testnet and Regtest read as Settings names them; any other kind a
// custom chain declares is shown as declared, never normalised to Mainnet.
function networkKindLabel(kind) {
    const value = String(kind || '').trim();
    if (!value) return '';
    if (ACTIVE_NETWORK_OPTIONS.some((option) => option.value === value)) return activeNetworkLabel(value);
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Full-screen list of networks used by NetworkField and NetworkFilter. Each
 * row is drawn like a TokenPicker row: big icon, name, a description line
 * under it, and a right chevron.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(value: string) => void} props.onSelect
 * @param {() => void} props.onBack
 * @param {string[]} [props.chainIds]         chains offered; ignored when options is given
 * @param {import('../registry/index.js').ChainRegistry} [props.chainRegistry]
 * @param {NetworkOption[]} [props.options]   rows whose values are not chain ids (coin families)
 * @param {string} [props.label]              the screen title
 * @param {boolean} [props.contained]
 * @param {boolean} [props.allOption]         offer the all-networks sentinel first
 */
export function NetworkPicker({
    value,
    onSelect,
    onBack,
    chainIds,
    chainRegistry,
    options,
    label = t('settings.network.label'),
    contained = false,
    allOption = false,
}) {
    const titleId = useId();
    const pickerRef = useRef(null);
    const initialFocusRef = useRef(null);
    // Focus lands on the current row, as it did in the old dropdown; with no
    // current row it falls back to the first control (Back). A layout effect
    // runs before the trap's effect reads the ref.
    useLayoutEffect(() => {
        initialFocusRef.current = pickerRef.current
            ?.querySelector('button[data-network-option][aria-current="true"]') || null;
    }, []);
    useBackHandler(onBack);
    useFocusTrap(pickerRef, { active: true, initialFocusRef });

    return (
        <div
            ref={pickerRef}
            className={`${styles.overlay} ${contained ? styles.contained : ''}`.trim()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            // A filter panel that closes on an outside press or focus leaves
            // this layer alone, so a pick made here reaches its handler.
            data-picker-layer=""
        >
            <Screen
                variant="full"
                bodyAs="section"
                bodyLabelledBy={titleId}
                header={(
                    <PageHeader
                        title={label}
                        titleId={titleId}
                        onBack={onBack}
                        nested
                    />
                )}
            >
                <ListPage>
                    <NetworkOptionList
                        value={value}
                        onSelect={onSelect}
                        chainIds={chainIds}
                        chainRegistry={chainRegistry}
                        options={options}
                        allOption={allOption}
                    />
                </ListPage>
            </Screen>
        </div>
    );
}

/**
 * The network rows on their own, for a screen that lists networks in its
 * own body (Stake's network step) rather than in the picker screen.
 *
 * @param {object} props
 * @param {string} [props.value]
 * @param {(value: string) => void} props.onSelect
 * @param {string[]} [props.chainIds]
 * @param {import('../registry/index.js').ChainRegistry} [props.chainRegistry]
 * @param {NetworkOption[]} [props.options]
 * @param {boolean} [props.allOption]
 */
export function NetworkOptionList({
    value,
    onSelect,
    chainIds,
    chainRegistry,
    options,
    allOption = false,
}) {
    const entries = useMemo(
        () => (Array.isArray(options) ? options : networkOptionsForChains(chainIds, chainRegistry)),
        [options, chainIds, chainRegistry],
    );

    // The arrows move between rows as they do in the token list.
    const onListKeyDown = (event) => {
        const rows = Array.from(event.currentTarget.querySelectorAll('button[data-network-option]'));
        const index = rows.indexOf(document.activeElement);
        let next = null;
        if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % rows.length;
        if (event.key === 'ArrowUp') next = index < 0 ? rows.length - 1 : (index - 1 + rows.length) % rows.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = rows.length - 1;
        if (next === null || rows.length === 0) return;
        event.preventDefault();
        rows[next]?.focus();
    };

    return (
        <ul className={`${styles.list} ${rowStyles.list}`} onKeyDown={onListKeyDown}>
            {allOption ? (
                <NetworkRow
                    selected={value === 'all'}
                    actionName={t('common.allNetworks')}
                    leading={(
                        <span className={rowStyles.iconWrap} aria-hidden="true">
                            <span className={`${rowStyles.iconLetter} ${styles.allMark}`}>
                                <FilterIcon />
                            </span>
                        </span>
                    )}
                    title={t('common.allNetworks')}
                    description={t('components.networkFilter.networkCount', { count: entries.length })}
                    onClick={() => onSelect('all')}
                />
            ) : null}
            {entries.map((entry, index) => (
                <NetworkRow
                    // A caller may list one family twice; the index keeps keys unique.
                    key={`${entry.value}:${index}`}
                    selected={entry.value === value}
                    actionName={entry.actionName || entry.title}
                    leading={(
                        <AssetMark
                            chainId={entry.chainId || entry.value}
                            tick={entry.ticker || entry.title}
                            isNative
                        />
                    )}
                    title={entry.title}
                    description={entry.description}
                    onClick={() => onSelect(entry.value)}
                />
            ))}
        </ul>
    );
}

function NetworkRow({ selected, actionName, leading, title, description, onClick }) {
    return (
        <li className={rowStyles.row}>
            <ListRow
                className={`${rowStyles.rowContent} ${rowStyles.rowClickable}`}
                aria-current={selected ? 'true' : undefined}
                aria-label={t('ui.networkPicker.selectNetwork', { network: actionName })}
                data-network-option=""
                leading={leading}
                title={(
                    <span className={rowStyles.title}>
                        <span className={rowStyles.name}>{title}</span>
                    </span>
                )}
                subtitle={description ? (
                    <span className={rowStyles.subtitle} data-network-description="">{description}</span>
                ) : null}
                contentClassName={rowStyles.rowBody}
                chevron={<span className={rowStyles.rowChevron}><ForwardIcon /></span>}
                onClick={onClick}
            />
        </li>
    );
}
