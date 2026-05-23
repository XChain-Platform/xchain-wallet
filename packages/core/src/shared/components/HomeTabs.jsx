import { useMemo, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import {
    BalanceList,
    buildBalanceRows,
    sortByChainThenAsset,
    coinFromChainId,
    tickerColor,
} from './BalanceList.jsx';
import balanceStyles from './BalanceList.module.css';
import { CollectiblesView } from './CollectiblesView.jsx';
import { TotalBalanceHero } from './TotalBalanceHero.jsx';
import { PortfolioChart } from './PortfolioChart.jsx';
import {
    isDemoWallet,
    synthesizeDemoHistory,
    synthesizeDemoDefiPositions,
} from '@xchain-wallet/core/flows';
import { classifyEntryAction, classifyEntryStatus } from '../utils/historyFilter.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
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
export function HomeTabs({ chainRegistry, balances, balancesFetchedAt, walletId, networkFilter, tokenQuery = '', multisig, multisigChainId, actions, onReceive, onSelectToken, onSelectEntry, pinnedKeys, onTogglePin, hiddenKeys, onToggleHide }) {
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
    // Tokens = every non-native tick, regardless of divisibility or
    // imagery. The single canonical "what do I hold?" surface.
    const tokens = useMemo(
        () => sortByChainThenAsset(filteredRows.filter(
            (r) => r.kind !== 'native',
        )),
        [filteredRows],
    );
    const tokenQueryTrim = tokenQuery.trim().toLowerCase();
    const filteredTokens = useMemo(() => {
        if (!tokenQueryTrim) return tokens;
        return tokens.filter((r) => {
            const tick = String(r.tick || '').toLowerCase();
            const name = String(r.displayName || '').toLowerCase();
            return tick.includes(tokenQueryTrim) || name.includes(tokenQueryTrim);
        });
    }, [tokens, tokenQueryTrim]);
    // NFTs = subset of Tokens that has a non-empty imageUrl. Purely a
    // visual gallery view — an tick can appear in BOTH Tokens (as a
    // row with balance) and NFTs (as a tile with the image), e.g. a
    // divisible token like PEPECASH that has an tick image.
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

            <PortfolioChart
                rows={filteredRows}
                walletId={walletId}
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
                        rows={filteredTokens}
                        emptyTitle={tokenQueryTrim
                            ? 'No matching tokens'
                            : (networkFilter === 'all' ? 'No tokens yet' : 'No tokens on this network')}
                        emptyBody={tokenQueryTrim
                            ? `Nothing matches "${tokenQuery.trim()}". Clear the filter from the top toolbar to see all tokens.`
                            : (networkFilter === 'all'
                                ? 'Browse markets or accept a token transfer to populate this view.'
                                : undefined)}
                        onReceive={!tokenQueryTrim && networkFilter === 'all' ? onReceive : undefined}
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
                        <DemoActivityList
                            chainIds={Object.keys(balances || {})}
                            balances={balances}
                            networkFilter={networkFilter}
                            walletId={walletId}
                            onSelectEntry={onSelectEntry}
                        />
                    ) : (
                        <Placeholder
                            title="Recent activity"
                            body="Sends, receives, sign events, broadcasts, multisig rounds, and approval grants surface here in reverse-chronological order. Wiring lands next — for now the Pancake → History entry shows the full chronological feed."
                        />
                    )
                ) : null}

                {active === 'defi' ? (
                    isDemoWallet(walletId) ? (
                        <DemoDefiList
                            networkFilter={networkFilter}
                            balances={balances}
                            onSelectEntry={onSelectEntry}
                        />
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

// Builds an tick lookup keyed by `${chainId}|${tick}` so ActivityRow
// can resolve a token's imageUrl + divisibility when rendering a
// non-native row. Falls back gracefully to null when the token doesn't
// appear in the wallet's balances (e.g. a SEND of an tick the user
// no longer holds).
function buildTokenLookup(balances) {
    /** @type {Map<string, { divisibility?: number, imageUrl?: string | null, displayName?: string }>} */
    const m = new Map();
    if (!balances || typeof balances !== 'object') return m;
    for (const [chainId, entries] of Object.entries(balances)) {
        if (!Array.isArray(entries)) continue;
        for (const e of entries) {
            const native = e?.balances?.native;
            if (native?.tick) {
                m.set(`${chainId}|${native.tick}`, {
                    divisibility: native.divisibility,
                    imageUrl: null,
                    displayName: native.tick,
                });
            }
            const tokens = e?.balances?.tokens || [];
            for (const a of tokens) {
                if (!a?.tick) continue;
                m.set(`${chainId}|${a.tick}`, {
                    divisibility: a.divisibility,
                    imageUrl: typeof a.imageUrl === 'string' && a.imageUrl.length > 0 ? a.imageUrl : null,
                    displayName: a.displayName || a.tick,
                });
            }
        }
    }
    return m;
}

function shortenAddress(s) {
    if (typeof s !== 'string' || s.length < 12) return s || '';
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function relativeTime(epochSec) {
    if (!epochSec) return '';
    const now = Math.floor(Date.now() / 1000);
    const d = now - epochSec;
    if (d < 60) return `${Math.max(1, d)}s ago`;
    if (d < 3600) return `${Math.floor(d / 60)}m ago`;
    if (d < 86_400) return `${Math.floor(d / 3600)}h ago`;
    return `${Math.floor(d / 86_400)}d ago`;
}

// Format a satoshi-string amount using the tick's divisibility. Plain
// string math, no BigInt — these are demo values and stay small.
function formatAmount(raw, divisibility) {
    const s = String(raw ?? '').trim();
    if (!s) return '';
    const div = Number.isFinite(divisibility) ? divisibility : 8;
    if (div === 0) return s;
    if (!/^\d+$/.test(s)) return s;
    const padded = s.padStart(div + 1, '0');
    const whole = padded.slice(0, -div);
    const frac = padded.slice(-div).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
}

const ACTION_ICON = {
    send:       (k) => <Icon.SendIcon key={k} />,
    receive:    (k) => <Icon.ReceiveIcon key={k} />,
    issue:      (k) => <Icon.PlusIcon key={k} />,
    mint:       (k) => <Icon.TokenIcon key={k} />,
    destroy:    (k) => <Icon.TrashIcon key={k} />,
    sweep:      (k) => <Icon.DownloadIcon key={k} />,
    dispenser:  (k) => <Icon.MarketIcon key={k} />,
    dispense:   (k) => <Icon.DownloadIcon key={k} />,
    order:      (k) => <Icon.MarketIcon key={k} />,
    swap:       (k) => <Icon.SwapIcon key={k} />,
    dividend:   (k) => <Icon.DollarIcon key={k} />,
    broadcast:  (k) => <Icon.BroadcastIcon key={k} />,
    message:    (k) => <Icon.MessageIcon key={k} />,
    crosschain: (k) => <Icon.LinkIcon key={k} />,
    stake:      (k) => <Icon.StakeIcon key={k} />,
    contract:   (k) => <Icon.ContractIcon key={k} />,
    other:      (k) => <Icon.HistoryIcon key={k} />,
};

const ACTION_LABEL = {
    send: 'SEND',         receive: 'RECEIVE',  issue: 'ISSUE',     mint: 'MINT',
    destroy: 'DESTROY',   sweep: 'SWEEP',      dispenser: 'DISPENSER', dispense: 'DISPENSE',
    order: 'ORDER',       swap: 'SWAP',        dividend: 'DIVIDEND',
    broadcast: 'BROADCAST', message: 'MESSAGE', crosschain: 'LINK',
};

// One activity row. Visual mirrors the DeFi row layout: 48px icon on
// the left (circular chain icon for native, square token tile for
// tokens with a chain overlay), three-line body on the right:
//   1. action icon + action label + status pill (right)
//   2. amount + tick (primary content)
//   3. Block N + Confirms pill + relative time (right)
function ActivityRow({ entry, walletAddresses, assetLookup, chainTip, onClick }) {
    const [balancesHidden] = useBalancesHidden();
    const kind = classifyEntryAction(entry, walletAddresses);
    const status = classifyEntryStatus(entry);
    const tick = entry.raw?.tick || entry.raw?.TICK || '';
    const chainIconUrl = branding.chainIconSmallUrl(entry.chainId);
    const tokenInfo = tick ? (assetLookup.get(`${entry.chainId}|${tick}`) || null) : null;
    const nativeTicker = (entry.chainId.split('-')[0] || '').toUpperCase()
        .replace('BITCOIN', 'BTC')
        .replace('LITECOIN', 'LTC')
        .replace('DOGECOIN', 'DOGE');
    const isNative = tick === nativeTicker;
    const rawAmount = entry.raw?.amount ?? entry.raw?.AMOUNT ?? entry.raw?.quantity ?? entry.raw?.QUANTITY ?? '';
    const amount = rawAmount ? formatAmount(rawAmount, tokenInfo?.divisibility ?? 8) : '';
    const primary = amount ? `${amount}${tick ? ` ${tick}` : ''}` : (tick || '');
    // Match the per-row quantity mask used by BalanceList — privacy
    // mode should opaque every financial figure the user sees, not
    // just balances on the Coins/Tokens tab.
    const displayPrimary = balancesHidden && primary ? '•••••' : primary;
    const label = ACTION_LABEL[kind] || (entry.action || 'EVENT');
    const iconFn = ACTION_ICON[kind] || ACTION_ICON.other;
    const statusLabel = status === 'confirmed' ? 'VALID'
        : status === 'failed' ? 'INVALID'
        : 'PENDING';
    const statusClass = status === 'confirmed' ? styles.statusValid
        : status === 'failed' ? styles.statusInvalid
        : styles.statusPending;
    const confirms = (chainTip && entry.blockIndex)
        ? Math.max(0, chainTip - Number(entry.blockIndex) + 1)
        : null;
    return (
        <li>
            <button
                type="button"
                onClick={onClick}
                className={styles.demoRowButton}
            >
                <div className={balanceStyles.iconWrap}>
                    {isNative && chainIconUrl ? (
                        <img src={chainIconUrl} alt="" aria-hidden="true" className={balanceStyles.iconImg} />
                    ) : tokenInfo?.imageUrl ? (
                        <img
                            src={tokenInfo.imageUrl}
                            alt=""
                            aria-hidden="true"
                            className={styles.tokenIconSquare}
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                    ) : (
                        <span
                            className={balanceStyles.iconLetter}
                            style={{ background: tickerColor(tick || 'X'), color: '#FFFFFF' }}
                            aria-hidden="true"
                        >
                            {(tick || '?').slice(0, 1)}
                        </span>
                    )}
                    {!isNative && chainIconUrl ? (
                        <img src={chainIconUrl} alt="" aria-hidden="true" className={balanceStyles.chainOverlay} />
                    ) : null}
                </div>
                <div className={styles.demoRowBody}>
                    <div className={styles.demoRowMain}>
                        <span className={styles.activityActionIcon} aria-hidden="true">{iconFn('icon')}</span>
                        <span className={styles.demoActionTag}>{label}</span>
                        <span className={`${styles.statusBadge} ${statusClass}`}>{statusLabel}</span>
                    </div>
                    {primary ? (
                        <div className={styles.demoRowPrimary}>{displayPrimary}</div>
                    ) : null}
                    <div className={styles.demoRowMeta}>
                        {entry.blockIndex ? (
                            <>
                                <span>Block {Number(entry.blockIndex).toLocaleString('en-US')}</span>
                                {confirms != null ? (
                                    <span className={styles.confirmationsPill}>
                                        {confirms} Confirms
                                    </span>
                                ) : null}
                            </>
                        ) : (
                            <span className={styles.confirmationsPill}>Unconfirmed</span>
                        )}
                        {entry.timestamp ? (
                            <span className={styles.rowRelativeTime}>
                                {relativeTime(entry.timestamp)}
                            </span>
                        ) : null}
                    </div>
                </div>
            </button>
        </li>
    );
}

// Demo activity feed — synthesizes per-chain rows, wraps each in the
// History entry shape so onSelectEntry can hand them to ActionDetail.
function DemoActivityList({ chainIds, balances, networkFilter, walletId, onSelectEntry }) {
    void walletId;
    const walletAddresses = useMemo(() => new Set(['demo-address']), []);
    const assetLookup = useMemo(() => buildTokenLookup(balances), [balances]);
    const entries = useMemo(() => {
        /** @type {Array<any>} */
        const all = [];
        for (const cid of chainIds) {
            if (networkFilter !== 'all' && coinFromChainId(cid) !== networkFilter) continue;
            const history = synthesizeDemoHistory(cid, 'demo-address');
            for (const h of history) {
                const aIdx = String(h.action_index ?? h.actionIndex ?? '');
                if (!aIdx) continue;
                all.push({
                    key: `${cid}|${aIdx}:demo-address`,
                    chainId: cid,
                    address: 'demo-address',
                    actionIndex: aIdx,
                    action: String(h.action || 'ACTION'),
                    blockIndex: Number(h.block_index ?? h.blockIndex ?? 0),
                    timestamp: Number(h.timestamp ?? 0),
                    txHash: String(h.tx_hash ?? h.txHash ?? ''),
                    source: String(h.source ?? ''),
                    raw: h,
                    link: null,
                });
            }
        }
        return all.sort((a, b) => b.timestamp - a.timestamp);
    }, [chainIds, networkFilter]);

    // Synthetic chain tip per chainId — max blockIndex across visible
    // entries + a small buffer so the Confirms pill on the freshest
    // confirmed entry reads as a plausible number instead of "1".
    const chainTips = useMemo(() => {
        /** @type {Record<string, number>} */
        const tips = {};
        for (const e of entries) {
            if (!e.chainId || !e.blockIndex) continue;
            if (!tips[e.chainId] || e.blockIndex > tips[e.chainId]) {
                tips[e.chainId] = e.blockIndex;
            }
        }
        for (const cid of Object.keys(tips)) tips[cid] += 8;
        return tips;
    }, [entries]);

    if (entries.length === 0) {
        return <Placeholder title="No activity yet" body="Synthesized demo activity will appear here once the demo wallet has any chains active." />;
    }
    return (
        <ul className={styles.demoList}>
            {entries.map((e) => (
                <ActivityRow
                    key={e.key}
                    entry={e}
                    walletAddresses={walletAddresses}
                    assetLookup={assetLookup}
                    chainTip={chainTips[e.chainId] || null}
                    onClick={() => {
                        if (typeof onSelectEntry === 'function') onSelectEntry(e);
                    }}
                />
            ))}
        </ul>
    );
}

// DeFi action list — three-line history-row style. Left side is always
// the XCHAIN product mark (the only thing stakeable on the protocol)
// with the chain icon overlaid in the bottom-right; right side surfaces
// the action label + status on line one, the primary subject (amount /
// token / lock) on line two, and block / confirms / relative time on
// line three.
// Convert a synthetic DeFi position into a History-shaped entry so the
// shared ActionDetail page can render it. action_index / tx_hash are
// fabricated (the position doesn't have a real on-chain index) but are
// stable per position, so navigating back and forth keeps the same key.
function defiPositionToEntry(position, idx) {
    const aIdx = String(300000 + idx);
    return {
        key: `${position.chainId}|${aIdx}:demo-address`,
        chainId: position.chainId,
        address: 'demo-address',
        actionIndex: aIdx,
        action: position.action,
        blockIndex: Number(position.blockIndex || 0),
        timestamp: Number(position.timestamp || 0),
        txHash: `demo-defi-${position.id}`,
        source: 'demo-address',
        raw: { ...position },
        link: null,
    };
}

function DemoDefiList({ networkFilter, balances, onSelectEntry }) {
    const [balancesHidden] = useBalancesHidden();
    const positions = useMemo(() => {
        const all = synthesizeDemoDefiPositions();
        const filtered = networkFilter === 'all'
            ? all
            : all.filter((p) => coinFromChainId(p.chainId) === networkFilter);
        return [...filtered].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }, [networkFilter]);
    const assetLookup = useMemo(() => buildTokenLookup(balances), [balances]);

    if (positions.length === 0) {
        return <Placeholder title="No DeFi positions" body="No demo positions on the selected network." />;
    }
    return (
        <ul className={styles.demoList}>
            {positions.map((p, idx) => {
                const chainIconUrl = branding.chainIconSmallUrl(p.chainId);
                const statusLabel = p.status === 'confirmed' ? 'VALID'
                    : p.status === 'failed' ? 'INVALID'
                    : 'PENDING';
                const statusClass = p.status === 'confirmed' ? styles.statusValid
                    : p.status === 'failed' ? styles.statusInvalid
                    : styles.statusPending;
                // Icon resolution:
                //   STAKE   → XCHAIN product mark (square) + chain overlay,
                //             because the only stakeable token on the
                //             protocol is XCHAIN and stake is BTC-only.
                //   native  → circular chain icon (no overlay), when the
                //             row's tick matches the chain's native ticker
                //             (e.g. a contract holding BTC on Bitcoin).
                //   token   → square token image / tinted-letter, with a
                //             chain icon overlay so the user can tell
                //             which chain it lives on.
                const isStake = p.action === 'STAKE';
                const nativeTicker = (p.chainId.split('-')[0] || '').toUpperCase()
                    .replace('BITCOIN', 'BTC')
                    .replace('LITECOIN', 'LTC')
                    .replace('DOGECOIN', 'DOGE');
                const tick = p.tick || '';
                const isNativeAsset = !isStake && tick && tick === nativeTicker;
                const tokenInfo = (!isStake && tick && !isNativeAsset)
                    ? assetLookup.get(`${p.chainId}|${tick}`)
                    : null;
                return (
                    <li key={p.id}>
                        <button
                            type="button"
                            className={styles.demoRowButton}
                            onClick={() => {
                                if (typeof onSelectEntry === 'function') {
                                    onSelectEntry(defiPositionToEntry(p, idx));
                                }
                            }}
                        >
                            <div className={balanceStyles.iconWrap}>
                                {isStake ? (
                                    <img
                                        src={branding.faviconUrl()}
                                        alt=""
                                        aria-hidden="true"
                                        className={styles.tokenIconSquare}
                                    />
                                ) : isNativeAsset ? (
                                    chainIconUrl ? (
                                        <img src={chainIconUrl} alt="" aria-hidden="true" className={balanceStyles.iconImg} />
                                    ) : null
                                ) : tokenInfo?.imageUrl ? (
                                    <img
                                        src={tokenInfo.imageUrl}
                                        alt=""
                                        aria-hidden="true"
                                        className={styles.tokenIconSquare}
                                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    />
                                ) : (
                                    <span
                                        className={balanceStyles.iconLetter}
                                        style={{ background: tickerColor(tick || p.action), color: '#FFFFFF' }}
                                        aria-hidden="true"
                                    >
                                        {(tick || p.action).slice(0, 1).toUpperCase()}
                                    </span>
                                )}
                                {!isNativeAsset && chainIconUrl ? (
                                    <img src={chainIconUrl} alt="" aria-hidden="true" className={balanceStyles.chainOverlay} />
                                ) : null}
                            </div>
                            <div className={styles.demoRowBody}>
                                <div className={styles.demoRowMain}>
                                    {(() => {
                                        const iconFn = ACTION_ICON[String(p.action || '').toLowerCase()] || ACTION_ICON.other;
                                        return (
                                            <span className={styles.activityActionIcon} aria-hidden="true">
                                                {iconFn('icon')}
                                            </span>
                                        );
                                    })()}
                                    <span className={styles.demoActionTag}>{p.action}</span>
                                    <span className={`${styles.statusBadge} ${statusClass}`}>{statusLabel}</span>
                                </div>
                                <div className={styles.demoRowPrimary}>
                                    {balancesHidden ? '•••••' : p.primary}
                                </div>
                                <div className={styles.demoRowMeta}>
                                    {p.blockIndex ? (
                                        <>
                                            <span>Block {Number(p.blockIndex).toLocaleString('en-US')}</span>
                                            <span className={styles.confirmationsPill}>
                                                {p.confirms} Confirms
                                            </span>
                                        </>
                                    ) : (
                                        <span className={styles.confirmationsPill}>Unconfirmed</span>
                                    )}
                                    {p.timestamp ? (
                                        <span className={styles.rowRelativeTime}>
                                            {relativeTime(p.timestamp)}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

