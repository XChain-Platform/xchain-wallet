import { useMemo, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import {
    BalanceList,
    buildBalanceRows,
    sortByChainThenAsset,
    coinFromChainId,
} from './BalanceList.jsx';
import { CollectiblesView } from './CollectiblesView.jsx';
import { TotalBalanceHero } from './TotalBalanceHero.jsx';
import {
    isDemoWallet,
    synthesizeDemoHistory,
    synthesizeDemoDefiPositions,
} from '@xchain-wallet/core/flows';
import styles from './HomeTabs.module.css';

/**
 * Top-level tabbed view for Home.
 *
 *   Coins    — native rows (BTC / LTC / DOGE / …) only
 *   Tokens   — non-native, divisible (issuance tokens, stablecoins, …)
 *   NFTs     — non-native, indivisible (divisibility === 0)
 *   History  — chronological transaction stream (placeholder)
 *   DeFi     — staking, dispensers, contracts (placeholder)
 *
 * Network filter applies across every tab so flipping `BTC` filters
 * all tabs to BTC at once. Filter state owned here so it persists
 * when the user moves between tabs.
 *
 * @param {object} props
 * @param {import('../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {Record<string, Array<{ balances: any | null }>>} props.balances
 * @param {number | null} [props.balancesFetchedAt]   Unix ms of the last successful balance fetch — drives the staleness label below the tab strip (Cluster G FOLLOWUP 5 / G155).
 * @param {string} props.networkFilter   'all' or a coin family
 * @param {{ threshold: number, cosignerCount: number, scheme: string } | null} [props.multisig]
 * @param {string} [props.multisigChainId]
 * @param {import('react').ReactNode} [props.actions]   slot rendered between the total-balance hero and the tab strip — used by Home for the Send / Receive / Swap / Buy quick-action row
 * @param {() => void} [props.onReceive]   forwarded to empty-state nudges so the "No balances yet" cards can render a one-tap Receive CTA (G077)
 */
export function HomeTabs({ chainRegistry, balances, balancesFetchedAt, walletId, networkFilter, multisig, multisigChainId, actions, onReceive, onSelectToken, pinnedKeys, onTogglePin, hiddenKeys, onToggleHide }) {
    const [active, setActive] = useState('coins');

    const allRows = useMemo(
        () => buildBalanceRows(balances, chainRegistry),
        [balances, chainRegistry],
    );
    const filteredRows = useMemo(() => {
        if (networkFilter === 'all') return allRows;
        return allRows.filter((r) => coinFromChainId(r.chainId) === networkFilter);
    }, [allRows, networkFilter]);

    const coins = useMemo(
        () => sortByChainThenAsset(filteredRows.filter((r) => r.kind === 'native')),
        [filteredRows],
    );
    // Tokens = every non-native asset, regardless of divisibility or
    // imagery. The single canonical "what do I hold?" surface.
    const tokens = useMemo(
        () => sortByChainThenAsset(filteredRows.filter(
            (r) => r.kind !== 'native',
        )),
        [filteredRows],
    );
    // NFTs = subset of Tokens that has a non-empty imageUrl. Purely a
    // visual gallery view — an asset can appear in BOTH Tokens (as a
    // row with balance) and NFTs (as a tile with the image), e.g. a
    // divisible token like PEPECASH that has an asset image.
    const nfts = useMemo(
        () => sortByChainThenAsset(filteredRows.filter(
            (r) => r.kind !== 'native'
                && typeof r.imageUrl === 'string'
                && r.imageUrl.length > 0,
        )),
        [filteredRows],
    );

    const tabs = [
        { id: 'coins',    label: 'Coins'    },
        { id: 'tokens',   label: 'Tokens'   },
        { id: 'nfts',     label: 'NFTs'     },
        { id: 'defi',     label: 'DeFi'     },
        { id: 'activity', label: 'Activity' },
    ];

    return (
        <div className={styles.wrap}>
            {/* Hero rolls up coins + tokens + NFTs (everything that
                lives in `filteredRows`). DeFi + Activity contribute
                their own dollar amounts via separate flows once they
                wire — for now they're not in the sum. */}
            <TotalBalanceHero
                rows={filteredRows}
                networkFilter={networkFilter}
                lastSyncedAt={balancesFetchedAt}
            />

            {actions}

            <div className={styles.tabs} role="tablist" aria-label="Wallet view">
                {tabs.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={active === t.id ? 'true' : 'false'}
                        className={`${styles.tab} ${active === t.id ? styles.tabActive : ''}`}
                        onClick={() => setActive(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div className={styles.panel} role="tabpanel">
                {active === 'coins' ? (
                    <BalanceList
                        rows={coins}
                        multisig={multisig}
                        multisigChainId={multisigChainId}
                        emptyTitle={networkFilter === 'all' ? 'No coins yet' : 'No coins on this network'}
                        emptyBody={networkFilter === 'all'
                            ? 'Receive Bitcoin, Litecoin, or Dogecoin to populate this list.'
                            : undefined}
                        onReceive={networkFilter === 'all' ? onReceive : undefined}
                        onSelectToken={onSelectToken}
                        pinnedKeys={pinnedKeys}
                        onTogglePin={onTogglePin}
                        hiddenKeys={hiddenKeys}
                        onToggleHide={onToggleHide}
                    />
                ) : null}

                {active === 'tokens' ? (
                    <BalanceList
                        rows={tokens}
                        emptyTitle={networkFilter === 'all' ? 'No tokens yet' : 'No tokens on this network'}
                        emptyBody={networkFilter === 'all'
                            ? 'Browse markets or accept a token transfer to populate this view.'
                            : undefined}
                        onReceive={networkFilter === 'all' ? onReceive : undefined}
                        onSelectToken={onSelectToken}
                        pinnedKeys={pinnedKeys}
                        onTogglePin={onTogglePin}
                        hiddenKeys={hiddenKeys}
                        onToggleHide={onToggleHide}
                    />
                ) : null}

                {active === 'nfts' ? (
                    <CollectiblesView
                        rows={nfts}
                        emptyTitle={networkFilter === 'all' ? 'No collectibles yet' : 'No collectibles on this network'}
                        emptyBody={networkFilter === 'all'
                            ? 'Indivisible tokens (Rare Pepe, Ordinals, Bitcoin Stamps) appear here once received.'
                            : undefined}
                        onReceive={networkFilter === 'all' ? onReceive : undefined}
                        onSelectToken={onSelectToken}
                        pinnedKeys={pinnedKeys}
                        onTogglePin={onTogglePin}
                        hiddenKeys={hiddenKeys}
                        onToggleHide={onToggleHide}
                    />
                ) : null}

                {active === 'activity' ? (
                    isDemoWallet(walletId) ? (
                        <DemoActivityList chainIds={Object.keys(balances || {})} networkFilter={networkFilter} />
                    ) : (
                        <Placeholder
                            title="Recent activity"
                            body="Sends, receives, sign events, broadcasts, multisig rounds, and approval grants surface here in reverse-chronological order. Wiring lands next — for now the Pancake → History entry shows the full chronological feed."
                        />
                    )
                ) : null}

                {active === 'defi' ? (
                    isDemoWallet(walletId) ? (
                        <DemoDefiList networkFilter={networkFilter} />
                    ) : (
                        <Placeholder
                            title="DeFi positions"
                            body="Staking, dispensers, contract balances, and active orders consolidate here. Each gets its own card with a quick-action button."
                        />
                    )
                ) : null}
            </div>
        </div>
    );
}

function Placeholder({ title, body }) {
    return (
        <div className={styles.placeholder}>
            <div className={styles.placeholderTitle}>{title}</div>
            <p className={styles.placeholderBody}>{body}</p>
        </div>
    );
}

function DemoActivityList({ chainIds, networkFilter }) {
    const rows = useMemo(() => {
        const all = [];
        for (const cid of chainIds) {
            if (networkFilter !== 'all' && coinFromChainId(cid) !== networkFilter) continue;
            const history = synthesizeDemoHistory(cid, 'demo-address');
            for (const h of history) all.push({ ...h, chainId: cid });
        }
        return all.sort((a, b) => b.timestamp - a.timestamp);
    }, [chainIds, networkFilter]);

    if (rows.length === 0) {
        return <Placeholder title="No activity yet" body="Synthesized demo activity will appear here once the demo wallet has any chains active." />;
    }
    return (
        <ul className={styles.demoList}>
            {rows.map((r) => {
                const kind = activityKind(r);
                const chainIconUrl = branding.chainIconSmallUrl(r.chainId);
                return (
                    <li key={r.txHash} className={styles.demoRow}>
                        <span className={styles.demoIconWrap}>
                            <span
                                className={`${styles.demoIconInner} ${styles[`activity_${kind}`] || ''}`}
                                aria-hidden="true"
                            >
                                {iconFor(kind)}
                            </span>
                            {chainIconUrl ? (
                                <img
                                    src={chainIconUrl}
                                    className={styles.demoIconChainOverlay}
                                    alt=""
                                    aria-hidden="true"
                                />
                            ) : null}
                        </span>
                        <div className={styles.demoRowBody}>
                            <div className={styles.demoRowMain}>
                                <span className={styles.demoActionTag}>{labelFor(kind)}</span>
                                <span className={styles.demoRowTitle}>{describeAction(r)}</span>
                            </div>
                            <div className={styles.demoRowMeta}>
                                <span>{coinFromChainId(r.chainId).toUpperCase()}</span>
                                <span>·</span>
                                <span>{r.blockIndex == null ? 'pending' : `block ${r.blockIndex}`}</span>
                                <span>·</span>
                                <span>{relTime(r.timestamp)}</span>
                            </div>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}

function activityKind(r) {
    if (r.action === 'SEND') {
        return r?.params?.destination === 'demo-address' ? 'receive' : 'send';
    }
    if (r.action === 'ISSUE') return 'issue';
    if (r.action === 'DIVIDEND') return 'dividend';
    if (r.action === 'ORDER') return 'order';
    if (r.action === 'EXECUTE') return 'execute';
    return 'other';
}

function labelFor(kind) {
    switch (kind) {
        case 'receive':  return 'RECEIVE';
        case 'send':     return 'SEND';
        case 'issue':    return 'ISSUE';
        case 'dividend': return 'DIVIDEND';
        case 'order':    return 'ORDER';
        case 'execute':  return 'EXECUTE';
        default:         return 'EVENT';
    }
}

function iconFor(kind) {
    switch (kind) {
        case 'receive':  return <Icon.ReceiveIcon />;
        case 'send':     return <Icon.SendIcon />;
        case 'issue':    return <Icon.TokenIcon />;
        case 'dividend': return <Icon.DollarIcon />;
        case 'order':    return <Icon.MarketIcon />;
        case 'execute':  return <Icon.ContractIcon />;
        default:         return <Icon.HistoryIcon />;
    }
}

function DemoDefiList({ networkFilter }) {
    const positions = useMemo(() => {
        const all = synthesizeDemoDefiPositions();
        if (networkFilter === 'all') return all;
        return all.filter((p) => coinFromChainId(p.chainId) === networkFilter);
    }, [networkFilter]);

    if (positions.length === 0) {
        return <Placeholder title="No DeFi positions" body="No demo positions on the selected network." />;
    }
    return (
        <ul className={styles.demoList}>
            {positions.map((p) => {
                const chainIconUrl = branding.chainIconSmallUrl(p.chainId);
                return (
                    <li key={p.id} className={styles.demoRow}>
                        <span className={styles.demoIconWrap}>
                            <span
                                className={`${styles.demoIconInner} ${styles[`tag_${p.kind}`] || ''}`}
                                aria-hidden="true"
                            >
                                {defiIconFor(p.kind)}
                            </span>
                            {chainIconUrl ? (
                                <img
                                    src={chainIconUrl}
                                    className={styles.demoIconChainOverlay}
                                    alt=""
                                    aria-hidden="true"
                                />
                            ) : null}
                        </span>
                        <div className={styles.demoRowBody}>
                            <div className={styles.demoRowMain}>
                                <span className={styles.demoActionTag}>{p.kind}</span>
                                <span className={styles.demoRowTitle}>{p.title}</span>
                                <span className={styles.demoRowBadge}>{p.badge}</span>
                            </div>
                            <div className={styles.demoRowPrimary}>{p.primary}</div>
                            <div className={styles.demoRowMeta}>{p.secondary}</div>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}

function defiIconFor(kind) {
    switch (kind) {
        case 'stake':     return <Icon.StakeIcon />;
        case 'dispenser': return <Icon.DownloadIcon />;
        case 'contract':  return <Icon.ContractIcon />;
        default:          return <Icon.HistoryIcon />;
    }
}

function describeAction(r) {
    const p = r.params || {};
    // Platform uses `tick` (and falls back to top-level r.tick when
    // not nested). `asset` is not an XChain field — never read it.
    const tick = p.tick || r.tick || '';
    switch (r.action) {
        case 'SEND':
            return p.memo
                ? `${p.amount} ${tick} — ${p.memo}`
                : `${p.amount} ${tick} → ${shortAddr(p.destination)}`;
        case 'ISSUE':
            return `${tick} (${p.divisible ? 'divisible' : 'indivisible'})`;
        case 'DIVIDEND':
            return `${tick} dividend`;
        case 'ORDER':
            return `${p.give_asset || ''} → ${p.get_asset || ''} (${p.status || 'open'})`;
        case 'EXECUTE':
            return `${p.contract}.${p.method}(${p.amount || ''})`;
        default:
            return r.action;
    }
}

function shortAddr(s) {
    if (typeof s !== 'string' || s.length < 12) return s || '';
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function relTime(epochSec) {
    const now = Math.floor(Date.now() / 1000);
    const d = now - epochSec;
    if (d < 60) return `${Math.max(1, d)}s ago`;
    if (d < 3600) return `${Math.floor(d / 60)}m ago`;
    if (d < 86_400) return `${Math.floor(d / 3600)}h ago`;
    return `${Math.floor(d / 86_400)}d ago`;
}
