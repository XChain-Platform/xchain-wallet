import { useEffect, useMemo, useRef, useState } from 'react';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { Icon } from '@xchain-wallet/core/ui';
import styles from './HeaderSettingsButton.module.css';
import localStyles from './HeaderNetworkButton.module.css';

/**
 * Filter-icon button in the header. Click → popover that hosts BOTH a
 * free-text token filter and the list of networks. The text input
 * narrows the Tokens tab to ticks/names matching the query; the list
 * narrows every tab to a single coin family.
 *
 * The icon shows an accent dot when either filter is active so the
 * user has a passive indicator that the view is constrained.
 *
 * @param {object} props
 * @param {import('../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {string[]} props.coinFamilies
 * @param {string} props.networkFilter
 * @param {(coin: string) => void} props.onNetworkFilterChange
 * @param {string} [props.tokenQuery]                       free-text query applied to the Tokens tab; when omitted, the text input is not shown
 * @param {(query: string) => void} [props.onTokenQueryChange]
 * @param {'all' | 'coins' | 'tokens'} [props.kindFilter]    optional asset-kind segmented control (All / Coins / Tokens); only shown when `onKindFilterChange` is provided
 * @param {(kind: 'all' | 'coins' | 'tokens') => void} [props.onKindFilterChange]
 */
export function HeaderNetworkButton({
    chainRegistry,
    coinFamilies,
    networkFilter,
    onNetworkFilterChange,
    tokenQuery,
    onTokenQueryChange,
    kindFilter,
    onKindFilterChange,
}) {
    const [open, setOpen] = useState(false);
    const [networksOpen, setNetworksOpen] = useState(false);
    const wrapRef = useRef(null);
    const showTokenQuery = typeof onTokenQueryChange === 'function';
    const tokenQueryActive = showTokenQuery && typeof tokenQuery === 'string' && tokenQuery.trim().length > 0;

    useEffect(() => {
        if (!open) {
            setNetworksOpen(false);
            return undefined;
        }
        const onClick = (e) => {
            if (wrapRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const networkActive = networkFilter && networkFilter !== 'all';
    const showKind = typeof onKindFilterChange === 'function';
    const kindActive = showKind && kindFilter && kindFilter !== 'all';
    const filterActive = networkActive || tokenQueryActive || kindActive;

    const entries = useMemo(() => {
        return coinFamilies.map((coin) => {
            const desc = chainRegistry.byCoin(coin)[0];
            return {
                coin,
                label: desc?.displayName || coin,
                chainId: desc?.id,
            };
        });
    }, [coinFamilies, chainRegistry]);

    const selectedEntry = networkActive ? entries.find((e) => e.coin === networkFilter) : null;
    const selectedLabel = selectedEntry?.label || 'All networks';
    const selectedIconUrl = selectedEntry ? branding.chainIconSmallUrl(selectedEntry.chainId || '') : '';

    function pickNetwork(next) {
        onNetworkFilterChange(next);
        setNetworksOpen(false);
    }

    return (
        <div ref={wrapRef} className={styles.wrap}>
            <button
                type="button"
                className={`${styles.btn} ${filterActive ? styles.btnActive : ''}`}
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="dialog"
                aria-expanded={open ? 'true' : 'false'}
                aria-label={showTokenQuery ? 'Filters' : 'Network filter'}
                title={showTokenQuery ? 'Filters' : 'Network filter'}
            >
                <Icon.FilterIcon />
                {filterActive ? <span className={styles.dot} aria-hidden="true" /> : null}
            </button>
            {open ? (
                <div className={`${styles.popover} ${localStyles.popoverFull}`} role="dialog" aria-label="Filters">
                    {showTokenQuery ? (
                        <input
                            type="search"
                            className={localStyles.tokenSearchInput}
                            placeholder="Type a token name…"
                            aria-label="Filter tokens by name"
                            value={tokenQuery || ''}
                            onChange={(ev) => onTokenQueryChange(ev.target.value)}
                            onKeyDown={(ev) => {
                                if (ev.key === 'Enter') {
                                    ev.preventDefault();
                                    setOpen(false);
                                }
                            }}
                            autoFocus
                        />
                    ) : null}
                    <div className={localStyles.networkSelectWrap}>
                        <button
                            type="button"
                            className={localStyles.networkSelect}
                            onClick={() => setNetworksOpen((v) => !v)}
                            aria-haspopup="listbox"
                            aria-expanded={networksOpen ? 'true' : 'false'}
                            aria-label="Networks"
                        >
                            {selectedIconUrl ? (
                                <img src={selectedIconUrl} alt="" aria-hidden="true" className={localStyles.networkSelectIcon} />
                            ) : (
                                <span className={localStyles.networkSelectIconPlaceholder} aria-hidden="true">
                                    <Icon.FilterIcon />
                                </span>
                            )}
                            <span className={localStyles.networkSelectLabel}>{selectedLabel}</span>
                            <span className={localStyles.networkSelectCaret} aria-hidden="true">
                                {networksOpen ? '▴' : '▾'}
                            </span>
                        </button>
                        {networksOpen ? (
                            <ul className={localStyles.networkOptions} role="listbox" aria-label="Networks">
                                <li>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={networkFilter === 'all' ? 'true' : 'false'}
                                        className={`${localStyles.networkOption} ${networkFilter === 'all' ? localStyles.networkOptionActive : ''}`}
                                        onClick={() => pickNetwork('all')}
                                    >
                                        <span className={localStyles.networkSelectIconPlaceholder} aria-hidden="true">
                                            <Icon.FilterIcon />
                                        </span>
                                        <span className={localStyles.networkSelectLabel}>All networks</span>
                                    </button>
                                </li>
                                {entries.map((e) => {
                                    const iconUrl = branding.chainIconSmallUrl(e.chainId || '');
                                    return (
                                        <li key={e.coin}>
                                            <button
                                                type="button"
                                                role="option"
                                                aria-selected={networkFilter === e.coin ? 'true' : 'false'}
                                                className={`${localStyles.networkOption} ${networkFilter === e.coin ? localStyles.networkOptionActive : ''}`}
                                                onClick={() => pickNetwork(e.coin)}
                                            >
                                                {iconUrl ? (
                                                    <img src={iconUrl} alt="" aria-hidden="true" className={localStyles.networkSelectIcon} />
                                                ) : (
                                                    <span className={localStyles.networkSelectIconPlaceholder} aria-hidden="true" />
                                                )}
                                                <span className={localStyles.networkSelectLabel}>{e.label}</span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        ) : null}
                    </div>
                    {showKind ? (
                        <div className={localStyles.kindToggle} role="radiogroup" aria-label="Asset kind">
                            {[
                                { id: 'all', label: 'All' },
                                { id: 'coins', label: 'Coins' },
                                { id: 'tokens', label: 'Tokens' },
                            ].map((opt) => {
                                const active = (kindFilter || 'all') === opt.id;
                                return (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        className={`${localStyles.kindToggleBtn} ${active ? localStyles.kindToggleBtnActive : ''}`.trim()}
                                        onClick={() => onKindFilterChange(opt.id)}
                                    >
                                        {opt.label}
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
