// AppHeader — persistent top strip that stays mounted across every
// unlocked route. Matches the layout used at the top of Home: brand on
// the left, network-filter button + pancake-menu button on the right.
// Living in the FullLayoutWithNav header slot means TokenDetail / Send
// / Receive / Settings all keep the wallet's top-level affordances
// visible without re-rendering their own copy.
//
// `chainRegistry` + `coinFamilies` + `networkFilter` + `onNetworkFilterChange`
// drive the HeaderNetworkButton. `onMenuOpen` fires when the pancake
// is tapped — the parent layout owns the menu drawer mount so it can
// span the viewport.

import * as branding from '../../branding/branding.js';
import { Icon } from '../../ui/index.js';
import { HeaderNetworkButton } from './HeaderNetworkButton.jsx';
import styles from './AppHeader.module.css';

/**
 * @param {object} props
 * @param {import('../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {string[]} props.coinFamilies                              ordered coin family list for the filter popover (e.g. ['bitcoin','litecoin','dogecoin'])
 * @param {string} props.networkFilter                               current filter value ('all' or a coin id)
 * @param {(coin: string) => void} props.onNetworkFilterChange
 * @param {() => void} [props.onMenuOpen]                            pancake-tap handler
 * @param {boolean} [props.showNetworkFilter]                        when false, the network-filter button is hidden — used to scope the filter to the home view only
 */
export function AppHeader({
    chainRegistry,
    coinFamilies,
    networkFilter,
    onNetworkFilterChange,
    onMenuOpen,
    showNetworkFilter = true,
}) {
    return (
        <header className={styles.bar} role="banner">
            <div className={styles.left}>
                <img
                    src={branding.logoUrl()}
                    alt={branding.PRODUCT_NAME}
                    className={styles.logo}
                />
            </div>
            <div className={styles.right}>
                {showNetworkFilter && chainRegistry && Array.isArray(coinFamilies) && coinFamilies.length > 0 ? (
                    <HeaderNetworkButton
                        chainRegistry={chainRegistry}
                        coinFamilies={coinFamilies}
                        networkFilter={networkFilter}
                        onNetworkFilterChange={onNetworkFilterChange}
                    />
                ) : null}
                {onMenuOpen ? (
                    <button
                        type="button"
                        className={styles.menuBtn}
                        onClick={onMenuOpen}
                        aria-label="Open menu"
                        aria-haspopup="dialog"
                    >
                        <Icon.MenuIcon />
                    </button>
                ) : null}
            </div>
        </header>
    );
}
