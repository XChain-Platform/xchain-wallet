import { Icon } from '@xchain-wallet/core/ui';
import styles from './LeftNav.module.css';

/**
 * §24.2 / G053 — full-layout left navigation. Renders a fixed-width
 * sidebar listing primary surfaces (Home, History, Send, Receive, DEX,
 * Dispensers, Contracts, Messaging) plus a contacts row, a wallet
 * switcher, Settings, and Lock. Active row gets `aria-current="page"`.
 *
 * Visibility is the parent's responsibility: this component renders
 * itself unconditionally; `<FullLayoutWithNav>` wraps it in a flex
 * container that hides the sidebar at viewports below the §24.1 full
 * breakpoint (900px).
 *
 * `currentView` is matched against each item's `id`, with two soft
 * mappings so the active highlight survives drilldowns:
 *   - 'token-detail' / 'addresses' / 'wallet-picker' / 'account-picker'
 *     / 'wallet-details' / 'wallet-rename' / 'add-account' / 'add-wallet'
 *     all highlight Home — they're entered from there.
 *   - 'compose-message' highlights Messaging.
 *   - 'dispenser-explorer' / 'dispenser-detail' / 'dispenser' highlight
 *     Dispensers.
 *   - 'contract-*' / 'staking-*' / 'operator-dashboard' / 'stake-form'
 *     highlight Contracts.
 *   - 'market' highlights DEX.
 */

const VIEW_GROUPS = {
    home: ['home', 'token-detail', 'addresses', 'wallet-picker', 'account-picker', 'wallet-details', 'wallet-rename', 'add-account', 'add-wallet'],
    history: ['history'],
    send: ['send'],
    receive: ['receive'],
    markets: ['markets', 'market'],
    'dispensers-list': ['dispensers-list', 'dispenser-detail', 'dispenser-explorer', 'dispenser'],
    'contracts-list': ['contracts-list', 'contract-detail', 'contract-deploy', 'contract-execute', 'contract-deposit', 'contract-withdraw', 'staking-dashboard', 'stake-form', 'staking-unstake', 'staking-claim', 'staking-delegate', 'staking-revoke', 'operator-dashboard'],
    messaging: ['messaging', 'compose-message'],
    contacts: ['contacts'],
};

function isActive(itemId, currentView) {
    const group = VIEW_GROUPS[itemId];
    return group ? group.includes(currentView) : itemId === currentView;
}

/**
 * @param {object} props
 * @param {string} props.currentView
 * @param {(view: string) => void} props.onSelect
 * @param {() => void} [props.onLock]
 * @param {() => void} [props.onOpenSettings]
 * @param {() => void} [props.onOpenWalletPicker]
 * @param {string} [props.walletName]
 * @param {boolean} [props.hasBtcAddress]
 */
export function LeftNav({
    currentView,
    onSelect,
    onLock,
    onOpenSettings,
    onOpenWalletPicker,
    walletName,
    hasBtcAddress = false,
}) {
    const primary = [
        { id: 'home', label: 'Home', Icon: Icon.HomeIcon },
        { id: 'history', label: 'History', Icon: Icon.HistoryIcon },
        { id: 'send', label: 'Send', Icon: Icon.SendIcon },
        { id: 'receive', label: 'Receive', Icon: Icon.ReceiveIcon },
        { id: 'markets', label: 'DEX', Icon: Icon.MarketIcon },
        { id: 'dispensers-list', label: 'Dispensers', Icon: Icon.DollarIcon },
        ...(hasBtcAddress
            ? [{ id: 'contracts-list', label: 'Contracts', Icon: Icon.ContractIcon }]
            : []),
        { id: 'messaging', label: 'Messaging', Icon: Icon.MessageIcon },
    ];

    const secondary = [
        { id: 'contacts', label: 'Contacts', Icon: Icon.UsersIcon },
    ];

    return (
        <nav className={styles.nav} aria-label="Primary navigation">
            <div className={styles.brand}>XChain Wallet</div>
            <ul className={styles.list} role="list">
                {primary.map((item) => {
                    const active = isActive(item.id, currentView);
                    return (
                        <li key={item.id}>
                            <button
                                type="button"
                                className={`${styles.item} ${active ? styles.itemActive : ''}`}
                                aria-current={active ? 'page' : undefined}
                                onClick={() => onSelect(item.id)}
                            >
                                <span className={styles.icon} aria-hidden="true">
                                    <item.Icon />
                                </span>
                                <span className={styles.label}>{item.label}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            <hr className={styles.divider} />
            <ul className={styles.list} role="list">
                {secondary.map((item) => {
                    const active = isActive(item.id, currentView);
                    return (
                        <li key={item.id}>
                            <button
                                type="button"
                                className={`${styles.item} ${active ? styles.itemActive : ''}`}
                                aria-current={active ? 'page' : undefined}
                                onClick={() => onSelect(item.id)}
                            >
                                <span className={styles.icon} aria-hidden="true">
                                    <item.Icon />
                                </span>
                                <span className={styles.label}>{item.label}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            <div className={styles.spacer} />
            <div className={styles.footer}>
                {walletName && onOpenWalletPicker ? (
                    <button
                        type="button"
                        className={styles.walletSwitcher}
                        onClick={onOpenWalletPicker}
                        title={walletName}
                    >
                        <span className={styles.walletName}>{walletName}</span>
                        <span aria-hidden="true">▾</span>
                    </button>
                ) : null}
                {onOpenSettings ? (
                    <button
                        type="button"
                        className={styles.item}
                        onClick={onOpenSettings}
                    >
                        <span className={styles.icon} aria-hidden="true">
                            <Icon.GearIcon />
                        </span>
                        <span className={styles.label}>Settings</span>
                    </button>
                ) : null}
                {onLock ? (
                    <button
                        type="button"
                        className={styles.item}
                        onClick={onLock}
                    >
                        <span className={styles.icon} aria-hidden="true">
                            <Icon.LockIcon />
                        </span>
                        <span className={styles.label}>Lock</span>
                    </button>
                ) : null}
            </div>
        </nav>
    );
}

/**
 * Wraps the unlocked-route render tree in a flex layout that places
 * `<LeftNav>` alongside the active route. Below 900px the sidebar
 * collapses (display:none); below 600px the optional `bottomBar` slot
 * (`<BottomTabBar>`, §24.3 / G054) renders fixed at the bottom of the
 * viewport instead.
 *
 * The wrapper sets `--xc-screen-h: 100%` on the main pane so the route's
 * `<Screen>` (which defaults to `100dvh`) fills its flex parent instead
 * of overflowing the document.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.nav
 * @param {import('react').ReactNode} [props.bottomBar]
 * @param {import('react').ReactNode} props.children
 */
export function FullLayoutWithNav({ nav, bottomBar, children }) {
    return (
        <div className={`${styles.layout} ${bottomBar ? styles.layoutWithBottomBar : ''}`}>
            <aside className={styles.sidebar}>{nav}</aside>
            <div className={styles.main}>{children}</div>
            {bottomBar ? <div className={styles.bottomBarSlot}>{bottomBar}</div> : null}
        </div>
    );
}
