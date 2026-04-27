import { useEffect, useMemo, useState } from 'react';
import { Screen, Button, ChainBadge , Icon} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import {
    isEntryReplaceable,
    replaceFromHistoryEntry,
    RbfNotSupportedError,
    RbfInvalidEntryError,
} from '../../flows/rbfReplace.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './History.module.css';

const chainRegistry = registryLib.defaultRegistry();

// LINK action coin field is a ticker (e.g. "BTC", "DOGE", "LTC"). The
// chain registry's descriptor.coin is the lowercase coin name. This
// map covers every coin descriptor bundled in this wallet today;
// unknown tickers degrade to "render the raw coin code without
// chainId resolution," which keeps the row visible without crashing
// when the platform adds a coin before the wallet does.
const COIN_TICKER_TO_NAME = {
    BTC: 'bitcoin',
    DOGE: 'dogecoin',
    LTC: 'litecoin',
};

/**
 * History route — §23 unified timeline + §23.5 cross-chain thread
 * rendering.
 *
 * Read-only view that aggregates `getHistory(addr, 'address')` across
 * the wallet's addresses on every chain the wallet uses. Per row:
 *   - action label / amount / source / block / timestamp
 *   - 🔗 badge if the row is one side of a LINK pairing
 *   - vertical connector between two rows when both sides of a pair
 *     are visible in the current filtered view
 *
 * Click a row → opens an inline detail card. For LINK-threaded rows
 * the card renders side-by-side with the peer ACTION fetched via
 * `messaging.getActionByIndex`, matching the §23.5 dual-side layout.
 *
 * Filters:
 *   - Chain chips (toggle each chainId on/off)
 *   - "Cross-chain only" — keep only entries that are part of a LINK
 *     pairing (regardless of whether both peers are in the result set)
 *
 * Wallet addresses are resolved up-front via
 * `messaging.getAddressesByChain(walletId)`. Per (chain, address) we
 * fan out two parallel reads — `getAddressHistory` + `getLinksForAddress`
 * — and merge into a flat `entries` list with `linkIdx` pointing at
 * matching entries when both sides happen to be in the wallet's
 * history (typical case: cross-chain LINK between two addresses owned
 * by the same wallet).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]   active BIP44 account; when set, history is scoped to that account's addresses
 * @param {() => void} props.onBack
 */
export function History({ walletId, accountId, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [entries, setEntries] = useState(/** @type {HistoryEntry[]} */ ([]));
    const [loadingChains, setLoadingChains] = useState(/** @type {Set<string>} */ (new Set()));
    const [enabledChains, setEnabledChains] = useState(/** @type {Set<string>} */ (new Set()));
    const [crossChainOnly, setCrossChainOnly] = useState(false);
    const [multisigOnly, setMultisigOnly] = useState(false);
    const [multisigAddress, setMultisigAddress] = useState(/** @type {string | null} */ (null));
    const [selectedKey, setSelectedKey] = useState(/** @type {string | null} */ (null));
    const [peerCache, setPeerCache] = useState(
        /** @type {Record<string, { loading: boolean, action: any | null, error: string | null }>} */ ({}),
    );

    // Step 1 — resolve the wallet's addresses grouped by chainId.
    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId, accountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const initial = new Set(
                    Object.entries(byChain || {})
                        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
                        .map(([cid]) => cid),
                );
                setEnabledChains(initial);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging]);

    // §22 Multisig-only filter (Step 22). Resolve the wallet's
    // multisig receive address up-front so the chip can filter
    // entries by exact match without re-running deriveMultisigAddress
    // on every render. Best-effort — silently leaves the chip
    // disabled when no multisig is configured or when the BTC chain
    // isn't in the registry.
    useEffect(() => {
        let cancelled = false;
        const btcChain = chainRegistry.byCoin('bitcoin')[0]?.id;
        if (!btcChain) return undefined;
        messaging.getMultisigReceiveAddress({ walletId, chainId: btcChain })
            .then((r) => {
                if (cancelled) return;
                if (r && typeof r.address === 'string') setMultisigAddress(r.address);
            })
            .catch(() => { /* no multisig configured — chip stays disabled */ });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Step 2 — fan out history + links per (chain, address). Merge
    // results into a single sorted list.
    useEffect(() => {
        if (!addressesByChain) return;
        const chainsToLoad = Object.entries(addressesByChain)
            .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
            .map(([cid]) => cid);
        if (chainsToLoad.length === 0) {
            setEntries([]);
            return;
        }
        let cancelled = false;
        setLoadingChains(new Set(chainsToLoad));

        const tasks = [];
        for (const cid of chainsToLoad) {
            for (const a of addressesByChain[cid]) {
                tasks.push(
                    Promise.all([
                        messaging.getAddressHistory({ chainId: cid, address: a.address })
                            .then((r) => extractRows(r))
                            .catch(() => []),
                        messaging.getLinksForAddress({ chainId: cid, address: a.address })
                            .then((r) => extractRows(r))
                            .catch(() => []),
                    ]).then(([history, links]) => ({
                        chainId: cid,
                        address: a.address,
                        history,
                        links,
                    })),
                );
            }
        }

        Promise.all(tasks).then((perAddrResults) => {
            if (cancelled) return;
            // Build a (chainId, action_index) -> link record map so
            // history rows can identify their peer cheaply.
            /** @type {Map<string, { peerChainId: string | null, peerCoinTicker: string, peerActionIndex: string, linkActionIndex: string }>} */
            const linkMap = new Map();
            for (const r of perAddrResults) {
                for (const link of r.links) {
                    const sides = sidesFromLink(link, r.chainId);
                    if (!sides) continue;
                    linkMap.set(keyFor(sides.local.chainId, sides.local.actionIndex), {
                        peerChainId: sides.peer.chainId,
                        peerCoinTicker: sides.peer.coinTicker,
                        peerActionIndex: String(sides.peer.actionIndex),
                        linkActionIndex: String(link.action_index ?? link.actionIndex ?? ''),
                    });
                }
            }

            /** @type {HistoryEntry[]} */
            const all = [];
            for (const r of perAddrResults) {
                for (const row of r.history) {
                    const aIdx = String(row.action_index ?? row.actionIndex ?? '');
                    if (!aIdx) continue;
                    const k = keyFor(r.chainId, aIdx);
                    const link = linkMap.get(k) || null;
                    all.push({
                        key: `${k}:${r.address}`,
                        chainId: r.chainId,
                        address: r.address,
                        actionIndex: aIdx,
                        action: String(row.action || row.ACTION || 'ACTION'),
                        blockIndex: Number(row.block_index ?? row.blockIndex ?? 0),
                        timestamp: Number(row.timestamp ?? row.block_time ?? 0),
                        txHash: String(row.tx_hash ?? row.txHash ?? ''),
                        source: String(row.source ?? row.SOURCE ?? ''),
                        raw: row,
                        link,
                    });
                }
            }
            all.sort((a, b) => {
                if (b.blockIndex !== a.blockIndex) return b.blockIndex - a.blockIndex;
                return Number(b.actionIndex) - Number(a.actionIndex);
            });
            setEntries(all);
            setLoadingChains(new Set());
        });

        return () => { cancelled = true; };
    }, [addressesByChain, messaging]);

    const visibleEntries = useMemo(() => {
        let list = entries.filter((e) => enabledChains.has(e.chainId));
        if (crossChainOnly) list = list.filter((e) => Boolean(e.link));
        if (multisigOnly && multisigAddress) {
            const lower = multisigAddress.toLowerCase();
            list = list.filter((e) => {
                const a = (e.address || e.source || e.dest || '').toLowerCase();
                return a === lower;
            });
        }
        return list;
    }, [entries, enabledChains, crossChainOnly, multisigOnly, multisigAddress]);

    // For drawing the vertical connector: an entry is "threaded with
    // the entry above it" iff both sides are linked AND the row above
    // is its peer (same linkActionIndex). We render the connector on
    // the lower row in the visible list (DESC order: lower = older).
    const connectorByKey = useMemo(() => {
        /** @type {Set<string>} */
        const set = new Set();
        for (let i = 1; i < visibleEntries.length; i += 1) {
            const cur = visibleEntries[i];
            const prev = visibleEntries[i - 1];
            if (!cur.link || !prev.link) continue;
            if (
                cur.link.linkActionIndex
                && cur.link.linkActionIndex === prev.link.linkActionIndex
            ) {
                set.add(cur.key);
            }
        }
        return set;
    }, [visibleEntries]);

    const toggleChain = (cid) => {
        setEnabledChains((prev) => {
            const next = new Set(prev);
            if (next.has(cid)) next.delete(cid);
            else next.add(cid);
            return next;
        });
    };

    const onRowClick = (entry) => {
        setSelectedKey((cur) => (cur === entry.key ? null : entry.key));
        if (entry.link?.peerChainId && entry.link.peerActionIndex) {
            const pKey = peerCacheKey(entry.link.peerChainId, entry.link.peerActionIndex);
            if (!peerCache[pKey]) {
                setPeerCache((prev) => ({
                    ...prev,
                    [pKey]: { loading: true, action: null, error: null },
                }));
                messaging.getActionByIndex({
                    chainId: entry.link.peerChainId,
                    actionIndex: entry.link.peerActionIndex,
                })
                    .then((action) => {
                        setPeerCache((prev) => ({
                            ...prev,
                            [pKey]: { loading: false, action, error: null },
                        }));
                    })
                    .catch((err) => {
                        setPeerCache((prev) => ({
                            ...prev,
                            [pKey]: {
                                loading: false,
                                action: null,
                                error: err?.message || String(err),
                            },
                        }));
                    });
            }
        }
    };

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back to home"
            >
                <Icon.BackIcon />
            </button>
            <span className={styles.title}>History</span>
            <span className={styles.spacer} />
        </div>
    );

    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <div className={styles.body}>{children}</div>
            <div className={styles.actions}>
            </div>
        </Screen>
    );

    if (loadError) {
        return wrap(<p role="alert" className={styles.error}>{loadError}</p>);
    }
    if (!addressesByChain) {
        return wrap(<p className={styles.empty}>Loading addresses…</p>);
    }
    const activeChainIds = Object.entries(addressesByChain)
        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
        .map(([cid]) => cid);
    if (activeChainIds.length === 0) {
        return wrap(
            <p className={styles.empty}>
                No addresses yet. Use Receive to generate one before
                history can populate.
            </p>,
        );
    }

    return wrap(
        <>
            <div className={styles.filterBar} role="group" aria-label="History filters">
                <span className={styles.filterLabel}>Chains</span>
                {activeChainIds.map((cid) => {
                    const d = chainRegistry.get(cid);
                    const active = enabledChains.has(cid);
                    return (
                        <button
                            key={cid}
                            type="button"
                            onClick={() => toggleChain(cid)}
                            className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                            aria-pressed={active}
                        >
                            {d ? <ChainBadge descriptor={d} size="sm" /> : null}
                            <span>{d?.displayName || cid}</span>
                        </button>
                    );
                })}
                <span className={styles.divider} aria-hidden="true" />
                <button
                    type="button"
                    onClick={() => setCrossChainOnly((v) => !v)}
                    className={`${styles.chip} ${styles.chipCrossChain} ${crossChainOnly ? styles.chipActive : ''}`}
                    aria-pressed={crossChainOnly}
                    title="Show only entries that are one side of a LINK pairing (§23.5)."
                >
                    🔗 Cross-chain actions
                </button>
                <button
                    type="button"
                    onClick={() => setMultisigOnly((v) => !v)}
                    disabled={!multisigAddress}
                    className={`${styles.chip} ${styles.chipCrossChain} ${multisigOnly ? styles.chipActive : ''}`}
                    aria-pressed={multisigOnly}
                    title={multisigAddress
                        ? 'Show only entries on this wallet\'s multisig address (§22).'
                        : 'No multisig address configured for this wallet.'}
                >
                    🔐 Multisig only
                </button>
            </div>

            {loadingChains.size > 0 ? (
                <p className={styles.empty}>Loading history…</p>
            ) : null}

            {visibleEntries.length === 0 && loadingChains.size === 0 ? (
                <p className={styles.empty}>
                    {crossChainOnly
                        ? 'No cross-chain actions yet.'
                        : 'No history yet for the selected chains.'}
                </p>
            ) : null}

            <ul className={styles.timeline}>
                {visibleEntries.map((entry) => {
                    const d = chainRegistry.get(entry.chainId);
                    const selected = selectedKey === entry.key;
                    const showConnector = connectorByKey.has(entry.key);
                    return (
                        <li key={entry.key}>
                            <button
                                type="button"
                                onClick={() => onRowClick(entry)}
                                className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
                                aria-expanded={selected}
                            >
                                {showConnector ? (
                                    <span className={styles.connector} aria-hidden="true" />
                                ) : null}
                                <span className={styles.rowHeader}>
                                    {d ? <ChainBadge descriptor={d} size="sm" /> : null}
                                    <span className={styles.actionBadge}>{entry.action}</span>
                                    {entry.link ? (
                                        <span
                                            className={styles.crosschainBadge}
                                            title={`Linked to ${entry.link.peerCoinTicker} #${entry.link.peerActionIndex}`}
                                        >
                                            🔗
                                        </span>
                                    ) : null}
                                </span>
                                <span className={styles.rowSummary}>
                                    {summarizeRow(entry.raw, entry.action)}
                                </span>
                                <span className={styles.rowMeta}>
                                    {entry.blockIndex ? `Block ${entry.blockIndex}` : 'unconfirmed'}
                                    {' · '}
                                    {entry.timestamp ? formatTimestamp(entry.timestamp) : '—'}
                                    {entry.source ? ` · ${shorten(entry.source)}` : ''}
                                </span>
                            </button>
                            {selected ? (
                                <DetailCard
                                    entry={entry}
                                    peerCache={peerCache}
                                    isFull={isFull}
                                />
                            ) : null}
                        </li>
                    );
                })}
            </ul>
        </>,
    );
}

/**
 * Inline detail card. For LINK-threaded entries we render two
 * `detailSide` blocks side-by-side; for everything else, one block.
 */
function DetailCard({ entry, peerCache }) {
    const isLinked = Boolean(entry.link);
    const peerKey = entry.link?.peerChainId && entry.link?.peerActionIndex
        ? peerCacheKey(entry.link.peerChainId, entry.link.peerActionIndex)
        : null;
    const peer = peerKey ? peerCache[peerKey] : null;
    const replaceable = isEntryReplaceable(entry);

    return (
        <div className={`${styles.detail} ${isLinked ? styles.detailDual : ''}`} role="region" aria-label="Action detail">
            <div className={styles.detailSide}>
                <span className={styles.detailSideTitle}>
                    This side · {entry.action} #{entry.actionIndex}
                </span>
                <pre className={styles.detailDecoded}>
                    {decodeActionToText(entry.raw)}
                </pre>
                {replaceable.ok ? <RbfActions entry={entry} /> : null}
            </div>
            {isLinked ? (
                <div className={styles.detailSide}>
                    <span className={styles.detailSideTitle}>
                        Peer · {entry.link.peerCoinTicker}
                        {' '}#{entry.link.peerActionIndex}
                    </span>
                    {peer?.loading ? (
                        <p className={styles.empty}>Loading peer ACTION…</p>
                    ) : peer?.error ? (
                        <p className={styles.error}>Couldn't load peer: {peer.error}</p>
                    ) : peer?.action ? (
                        <pre className={styles.detailDecoded}>
                            {decodeActionToText(peer.action)}
                        </pre>
                    ) : (
                        <p className={styles.empty}>
                            Peer chain not bundled in this wallet — open the
                            block explorer for {entry.link.peerCoinTicker} to
                            view {entry.link.peerCoinTicker} #{entry.link.peerActionIndex}.
                        </p>
                    )}
                </div>
            ) : null}
        </div>
    );
}

/**
 * §29.9 / §44.4 RBF actions — Speed up + Cancel buttons for pending
 * (mempool-only) coin-moving entries. Replacement engine wiring is
 * §44.4 / §44.5 SDK / encoder work; until that lands, the messaging
 * layer surfaces an honest "RBF replacement is not supported by this
 * build" error and we render it inline.
 */
function RbfActions({ entry }) {
    const { messaging } = useMessaging();
    const [busy, setBusy] = useState(/** @type {'speedup' | 'cancel' | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [done, setDone] = useState(/** @type {string | null} */ (null));

    const run = async (strategy) => {
        if (busy) return;
        setBusy(strategy);
        setError(null);
        setDone(null);
        try {
            const res = await replaceFromHistoryEntry({
                messaging,
                entry,
                strategy,
            });
            setDone(`Replacement broadcast: ${res?.replacementTxHash || 'pending'}`);
        } catch (err) {
            if (err instanceof RbfNotSupportedError) {
                setError(err.message);
            } else if (err instanceof RbfInvalidEntryError) {
                setError(err.message);
            } else {
                setError(err?.message || 'Replacement failed.');
            }
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className={styles.rbfActions}>
            <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={busy === 'speedup'}
                disabled={busy !== null}
                onClick={() => run('speedup')}
            >
                Speed up
            </Button>
            <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={busy === 'cancel'}
                disabled={busy !== null}
                onClick={() => run('cancel')}
            >
                Cancel
            </Button>
            {error ? (
                <p className={styles.rbfError} role="alert">{error}</p>
            ) : null}
            {done ? (
                <p className={styles.rbfDone} role="status">{done}</p>
            ) : null}
        </div>
    );
}

/** @typedef {{
 *   key: string,
 *   chainId: string,
 *   address: string,
 *   actionIndex: string,
 *   action: string,
 *   blockIndex: number,
 *   timestamp: number,
 *   txHash: string,
 *   source: string,
 *   raw: any,
 *   link: { peerChainId: string | null, peerCoinTicker: string, peerActionIndex: string, linkActionIndex: string } | null
 * }} HistoryEntry
 */

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

/**
 * Given a LINK row and the chainId we read it from, identify which
 * (coin, action_index) is the local side and which is the peer.
 * Returns null if the row doesn't expose enough metadata.
 */
function sidesFromLink(link, localChainId) {
    if (!link) return null;
    const coin1 = link.coin1 || link.COIN1;
    const coin2 = link.coin2 || link.COIN2;
    const idx1 = link.coin1_action_index ?? link.COIN1_ACTION_INDEX;
    const idx2 = link.coin2_action_index ?? link.COIN2_ACTION_INDEX;
    if (!coin1 || !coin2 || idx1 == null || idx2 == null) return null;

    const localDescriptor = chainRegistry.get(localChainId);
    const localCoinName = localDescriptor?.coin || null;
    const c1Name = COIN_TICKER_TO_NAME[String(coin1).toUpperCase()] || null;
    const c2Name = COIN_TICKER_TO_NAME[String(coin2).toUpperCase()] || null;

    const networkKind = localDescriptor?.networkKind || 'mainnet';
    const c1ChainId = c1Name ? chainRegistry.chainIdFor(c1Name, networkKind) : null;
    const c2ChainId = c2Name ? chainRegistry.chainIdFor(c2Name, networkKind) : null;

    // Local side is whichever (coin, networkKind) maps to localChainId.
    const c1IsLocal = c1ChainId === localChainId
        || (localCoinName && c1Name === localCoinName);
    const c2IsLocal = c2ChainId === localChainId
        || (localCoinName && c2Name === localCoinName);

    if (c1IsLocal && !c2IsLocal) {
        return {
            local: { chainId: localChainId, coinTicker: String(coin1), actionIndex: idx1 },
            peer: { chainId: c2ChainId, coinTicker: String(coin2), actionIndex: idx2 },
        };
    }
    if (c2IsLocal && !c1IsLocal) {
        return {
            local: { chainId: localChainId, coinTicker: String(coin2), actionIndex: idx2 },
            peer: { chainId: c1ChainId, coinTicker: String(coin1), actionIndex: idx1 },
        };
    }
    // Same-chain LINK (rare but possible): treat side1 as local, side2
    // as peer so the connector still draws.
    if (c1IsLocal && c2IsLocal) {
        return {
            local: { chainId: localChainId, coinTicker: String(coin1), actionIndex: idx1 },
            peer: { chainId: localChainId, coinTicker: String(coin2), actionIndex: idx2 },
        };
    }
    return null;
}

function keyFor(chainId, actionIndex) {
    return `${chainId}:${actionIndex}`;
}

function peerCacheKey(chainId, actionIndex) {
    return `${chainId}:${actionIndex}`;
}

function shorten(addr) {
    if (!addr || addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatTimestamp(ts) {
    if (!ts) return '—';
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toISOString().replace('T', ' ').replace(/\..*/, ' UTC');
}

/**
 * Best-effort one-line summary for a row. Different ACTIONs join in
 * different fields; we surface the most useful per-action shape, then
 * fall back to a generic descriptor.
 */
function summarizeRow(row, action) {
    if (!row) return action;
    if (action === 'SEND') {
        const amt = row.amount ?? row.AMOUNT ?? row.quantity;
        const tick = row.tick ?? row.TICK ?? row.token;
        const dest = row.destination ?? row.DESTINATION ?? row.recipient;
        if (amt != null && tick && dest) return `${amt} ${tick} → ${shorten(String(dest))}`;
    }
    if (action === 'ISSUE') {
        const tick = row.tick ?? row.TICK;
        const amt = row.amount ?? row.AMOUNT ?? row.quantity;
        if (tick && amt != null) return `Issued ${amt} ${tick}`;
    }
    if (action === 'LINK') {
        const c1 = row.coin1 || row.COIN1;
        const c2 = row.coin2 || row.COIN2;
        if (c1 && c2) return `Link ${c1} ↔ ${c2}`;
    }
    if (row.memo || row.MEMO) return String(row.memo || row.MEMO);
    return action;
}

/** Render the row's raw fields as pretty-printed JSON for the detail card. */
function decodeActionToText(row) {
    if (!row) return '(no data)';
    try {
        return JSON.stringify(row, null, 2);
    } catch (err) {
        return String(err);
    }
}
