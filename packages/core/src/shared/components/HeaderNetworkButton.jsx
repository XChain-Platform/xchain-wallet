import { useEffect, useMemo, useRef, useState } from 'react';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { Icon } from '@xchain-wallet/core/ui';
import styles from './HeaderSettingsButton.module.css';
import filterStyles from './NetworkFilter.module.css';
import localStyles from './HeaderNetworkButton.module.css';

/**
 * Filter-icon button in the header that, when clicked, opens a popover
 * containing the list of networks directly (no nested trigger). One
 * click to open, one click to pick — total two interactions vs the
 * three-click chain when this wrapped the full `NetworkFilter`
 * dropdown component.
 *
 * The icon shows an accent dot when a non-`all` filter is active so
 * the user has a passive indicator that something is being filtered.
 *
 * @param {object} props
 * @param {import('../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {string[]} props.coinFamilies
 * @param {string} props.networkFilter
 * @param {(coin: string) => void} props.onNetworkFilterChange
 */
export function HeaderNetworkButton({
    chainRegistry,
    coinFamilies,
    networkFilter,
    onNetworkFilterChange,
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
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

    const filterActive = networkFilter && networkFilter !== 'all';

    const entries = useMemo(() => {
        return coinFamilies.map((coin) => {
            const desc = chainRegistry.byCoin(coin)[0];
            return {
                coin,
                label: desc?.displayName || coin,
                ticker: shortLabelForCoin(coin),
                chainId: desc?.id,
            };
        });
    }, [coinFamilies, chainRegistry]);

    function pick(next) {
        onNetworkFilterChange(next);
        setOpen(false);
    }

    return (
        <div ref={wrapRef} className={styles.wrap}>
            <button
                type="button"
                className={`${styles.btn} ${filterActive ? styles.btnActive : ''}`}
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={open ? 'true' : 'false'}
                aria-label="Network filter"
                title="Network filter"
            >
                <Icon.FilterIcon />
                {filterActive ? <span className={styles.dot} aria-hidden="true" /> : null}
            </button>
            {open ? (
                <div className={`${styles.popover} ${localStyles.popoverFull}`} role="listbox" aria-label="Network filter">
                    <ul className={filterStyles.list}>
                        <li>
                            <button
                                type="button"
                                role="option"
                                aria-selected={networkFilter === 'all' ? 'true' : 'false'}
                                className={`${filterStyles.item} ${networkFilter === 'all' ? filterStyles.itemActive : ''}`}
                                onClick={() => pick('all')}
                            >
                                <span className={filterStyles.itemIcon} aria-hidden="true">
                                    <Icon.FilterIcon />
                                </span>
                                <span className={filterStyles.itemLabel}>All networks</span>
                                <span className={filterStyles.itemTicker}>{entries.length}</span>
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
                                        className={`${filterStyles.item} ${networkFilter === e.coin ? filterStyles.itemActive : ''}`}
                                        onClick={() => pick(e.coin)}
                                    >
                                        <span className={filterStyles.itemIcon} aria-hidden="true">
                                            {iconUrl ? <img src={iconUrl} alt="" /> : null}
                                        </span>
                                        <span className={filterStyles.itemLabel}>{e.label}</span>
                                        <span className={filterStyles.itemTicker}>{e.ticker}</span>
                                    </button>
                                </li>
                            );
                        })}
                        {entries.length === 0 ? (
                            <li className={filterStyles.empty}>No networks yet.</li>
                        ) : null}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

function shortLabelForCoin(coin) {
    const map = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
    return map[coin] || coin.toUpperCase();
}
