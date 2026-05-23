import { useEffect, useMemo, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
 Icon,} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ActionsMenu.module.css';

const chainRegistry = registryLib.defaultRegistry();

// VM is BTC-only at launch (see xchain-wallet registry/actions.js
// BITCOIN_ACTIONS — DEPLOY / EXECUTE / DEPOSIT / WITHDRAW). The Contracts
// nav item is gated on the wallet having at least one BTC address; this
// component assumes the caller has already done that gating but also
// surfaces the no-BTC-address case defensively.
const VM_COIN = 'bitcoin';

/**
 * Contracts browse landing — §42.2.
 *
 * Three sections:
 *   1. "My contracts (deployed by me)" — sdk.getContracts(addr, 'source').
 *   2. "My interactions (deposits/withdrawals/executes)" — union of
 *      getDeposits + getWithdrawals by address, deduped by
 *      CONTRACT_ACTION_INDEX. Executions-by-address is not yet wired
 *      (SDK getExecutions is contract-scoped today); the detail page
 *      in Step 3 surfaces per-contract executions via the contract
 *      lane. Documented limitation, not a silent gap.
 *   3. "Browse all contracts" — sdk.getContracts() paginated.
 *
 * Chain filter is fixed to Bitcoin for now (only coin that supports
 * VM actions); testnet / regtest BTC chains appear when present. The
 * search input filters the currently-rendered rows client-side on
 * CONTRACT_ACTION_INDEX prefix or NAME substring — the explorer
 * doesn't expose a server-side contract-name search today.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {(chainId: string, actionIndex: string) => void} props.onOpenContract
 * @param {() => void} [props.onDeploy]   navigate to the §42.6 deploy form (Phase 4 Step 4+); when omitted the button is hidden
 * @param {() => void} props.onBack
 */
export function ContractsList({ walletId, onOpenContract, onDeploy, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const btcChains = useMemo(
        () => chainRegistry.byCoin(VM_COIN).map((d) => d.id),
        [],
    );

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [addressesError, setAddressesError] = useState(
        /** @type {string | null} */ (null),
    );
    const [chainFilter, setChainFilter] = useState(
        /** @type {string} */ ('all'),
    );
    const [searchQuery, setSearchQuery] = useState('');

    // Per-chain load state for each of the three sections.
    /** @typedef {{ loading: boolean, rows: any[], error: string | null }} LoadState */
    const [myByChain, setMyByChain] = useState(
        /** @type {Record<string, LoadState>} */ ({}),
    );
    const [interactionsByChain, setInteractionsByChain] = useState(
        /** @type {Record<string, LoadState>} */ ({}),
    );
    const [browseByChain, setBrowseByChain] = useState(
        /** @type {Record<string, LoadState>} */ ({}),
    );

    // Phase 1 — load wallet addresses so we know which BTC chains have
    // a source address we can filter by.
    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
            })
            .catch((err) => {
                if (!cancelled) {
                    setAddressesError(err?.message || 'Failed to load addresses.');
                }
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const btcChainsWithAddresses = useMemo(() => {
        if (!addressesByChain) return [];
        return btcChains.filter((cid) => {
            const rows = addressesByChain[cid];
            return Array.isArray(rows) && rows.length > 0;
        });
    }, [btcChains, addressesByChain]);

    const activeChains = useMemo(() => {
        if (chainFilter === 'all') return btcChainsWithAddresses;
        return btcChainsWithAddresses.includes(chainFilter) ? [chainFilter] : [];
    }, [chainFilter, btcChainsWithAddresses]);

    // Phase 2 — "My contracts" (deployed by one of my addresses on the
    // chain). Fan out one sdk.getContracts(addr, 'source') per address
    // per chain, merge, de-dupe.
    useEffect(() => {
        if (!addressesByChain) return;
        if (activeChains.length === 0) {
            setMyByChain({});
            return;
        }
        const initial = {};
        for (const cid of activeChains) initial[cid] = { loading: true, rows: [], error: null };
        setMyByChain(initial);

        let cancelled = false;
        for (const cid of activeChains) {
            const addrs = (addressesByChain[cid] || []).map((a) => a.address);
            Promise.all(addrs.map((addr) =>
                messaging.getContractsForSource({ chainId: cid, address: addr })
                    .then((resp) => ({ addr, rows: extractRows(resp) }))
                    .catch((err) => ({ addr, error: err?.message || String(err) }))
            )).then((results) => {
                if (cancelled) return;
                const merged = [];
                const errs = [];
                for (const r of results) {
                    if (r.error) errs.push(`${short(r.addr)}: ${r.error}`);
                    else merged.push(...r.rows);
                }
                const uniq = dedupeByActionIndex(merged);
                uniq.sort(newestFirst);
                setMyByChain((prev) => ({
                    ...prev,
                    [cid]: {
                        loading: false,
                        rows: uniq,
                        error: errs.length > 0 ? errs.join('; ') : null,
                    },
                }));
            });
        }
        return () => { cancelled = true; };
    }, [addressesByChain, activeChains, messaging]);

    // Phase 3 — "My interactions": union of deposits + withdrawals
    // scoped to the user's addresses. Returns the set of distinct
    // CONTRACT_ACTION_INDEX values this address has interacted with.
    // Each entry is a synthesized row carrying { contract_action_index,
    // latestBlock, kinds: Set<'deposit'|'withdraw'> } for rendering.
    useEffect(() => {
        if (!addressesByChain) return;
        if (activeChains.length === 0) {
            setInteractionsByChain({});
            return;
        }
        const initial = {};
        for (const cid of activeChains) initial[cid] = { loading: true, rows: [], error: null };
        setInteractionsByChain(initial);

        let cancelled = false;
        for (const cid of activeChains) {
            const addrs = (addressesByChain[cid] || []).map((a) => a.address);
            const ops = [];
            for (const addr of addrs) {
                ops.push(
                    messaging.getDepositsForAddress({ chainId: cid, address: addr })
                        .then((resp) => ({ kind: 'deposit', rows: extractRows(resp) }))
                        .catch((err) => ({ error: err?.message || String(err) })),
                );
                ops.push(
                    messaging.getWithdrawalsForAddress({ chainId: cid, address: addr })
                        .then((resp) => ({ kind: 'withdraw', rows: extractRows(resp) }))
                        .catch((err) => ({ error: err?.message || String(err) })),
                );
            }
            Promise.all(ops).then((results) => {
                if (cancelled) return;
                /** @type {Map<string, { contract_action_index: string, latestBlock: number, kinds: Set<string> }>} */
                const byContract = new Map();
                const errs = [];
                for (const r of results) {
                    if (r.error) { errs.push(r.error); continue; }
                    for (const row of r.rows) {
                        const ci = String(row.contract_action_index ?? row.CONTRACT_ACTION_INDEX ?? '');
                        if (!ci) continue;
                        const block = Number(row.block_index || 0);
                        let entry = byContract.get(ci);
                        if (!entry) {
                            entry = { contract_action_index: ci, latestBlock: block, kinds: new Set() };
                            byContract.set(ci, entry);
                        } else if (block > entry.latestBlock) {
                            entry.latestBlock = block;
                        }
                        entry.kinds.add(r.kind);
                    }
                }
                const rows = Array.from(byContract.values())
                    .sort((a, b) => b.latestBlock - a.latestBlock);
                setInteractionsByChain((prev) => ({
                    ...prev,
                    [cid]: {
                        loading: false,
                        rows,
                        error: errs.length > 0 ? errs.join('; ') : null,
                    },
                }));
            });
        }
        return () => { cancelled = true; };
    }, [addressesByChain, activeChains, messaging]);

    // Phase 4 — "Browse all" paginated list per chain. One request per
    // chain; no address fan-out.
    useEffect(() => {
        if (activeChains.length === 0) {
            setBrowseByChain({});
            return;
        }
        const initial = {};
        for (const cid of activeChains) initial[cid] = { loading: true, rows: [], error: null };
        setBrowseByChain(initial);

        let cancelled = false;
        for (const cid of activeChains) {
            messaging.getContractsBrowseAll({ chainId: cid })
                .then((resp) => {
                    if (cancelled) return;
                    const rows = extractRows(resp);
                    rows.sort(newestFirst);
                    setBrowseByChain((prev) => ({
                        ...prev,
                        [cid]: { loading: false, rows, error: null },
                    }));
                })
                .catch((err) => {
                    if (cancelled) return;
                    setBrowseByChain((prev) => ({
                        ...prev,
                        [cid]: { loading: false, rows: [], error: err?.message || String(err) },
                    }));
                });
        }
        return () => { cancelled = true; };
    }, [activeChains, messaging]);

        const header = (
        <ScreenHeader
            onBack={onBack}
            backLabel="Back to home"
            title="Contracts"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.listFull : styles.listPopup}>
                {children}
            </div>
            <div className={styles.actions}>
            </div>
        </Screen>
    );

    if (addressesError) {
        return wrap(<div role="alert" className={styles.entryDescription}>{addressesError}</div>);
    }
    if (!addressesByChain) {
        return wrap(<p className={styles.entryDescription}>Loading addresses…</p>);
    }
    if (btcChainsWithAddresses.length === 0) {
        return wrap(
            <p className={styles.entryDescription}>
                Contracts are available on Bitcoin only at launch (VM actions
                DEPLOY / EXECUTE / DEPOSIT / WITHDRAW). Use Receive on a
                Bitcoin network to generate an address first.
            </p>,
        );
    }

    return wrap(
        <>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <ChainFilterBar
                    chains={btcChainsWithAddresses}
                    value={chainFilter}
                    onChange={setChainFilter}
                />
                <Input
                    type="search"
                    placeholder="Filter by name or #action_index"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="Filter contracts"
                    style={{ flex: '1 1 200px', minWidth: 0 }}
                />
                {onDeploy ? (
                    <Button variant="primary" onClick={onDeploy}>
                        + Deploy new contract
                    </Button>
                ) : null}
            </div>
            <Section title="My contracts (deployed by me)">
                {activeChains.map((cid) => {
                    const d = chainRegistry.get(cid);
                    const state = myByChain[cid] || { loading: true, rows: [], error: null };
                    const rows = applySearch(state.rows, searchQuery);
                    return (
                        <ChainGroup key={cid} descriptor={d} chainId={cid} state={{ ...state, rows }}
                                    emptyText="No contracts deployed from this chain's addresses yet."
                                    onOpenContract={onOpenContract}
                                    renderRow={(row) => <ContractRow row={row} />} />
                    );
                })}
            </Section>
            <Section title="My interactions (deposits / withdrawals)">
                {activeChains.map((cid) => {
                    const d = chainRegistry.get(cid);
                    const state = interactionsByChain[cid] || { loading: true, rows: [], error: null };
                    const rows = applySearch(state.rows, searchQuery);
                    return (
                        <ChainGroup key={cid} descriptor={d} chainId={cid} state={{ ...state, rows }}
                                    emptyText="No DEPOSIT or WITHDRAW actions recorded against this chain's addresses yet."
                                    onOpenContract={onOpenContract}
                                    renderRow={(row) => <InteractionRow row={row} />} />
                    );
                })}
                <p className={styles.entryDescription}>
                    EXECUTE-only interactions (method calls with no deposit)
                    are not yet listed — the SDK's getExecutions is
                    contract-scoped today; that lane surfaces on the contract
                    detail page.
                </p>
            </Section>
            <Section title="Browse all contracts">
                {activeChains.map((cid) => {
                    const d = chainRegistry.get(cid);
                    const state = browseByChain[cid] || { loading: true, rows: [], error: null };
                    const rows = applySearch(state.rows, searchQuery);
                    return (
                        <ChainGroup key={cid} descriptor={d} chainId={cid} state={{ ...state, rows }}
                                    emptyText="No contracts indexed on this chain yet."
                                    onOpenContract={onOpenContract}
                                    renderRow={(row) => <ContractRow row={row} />} />
                    );
                })}
            </Section>
        </>,
    );
}

function Section({ title, children }) {
    return (
        <section style={{ marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1rem', margin: '0.5rem 0' }}>{title}</h2>
            {children}
        </section>
    );
}

function ChainFilterBar({ chains, value, onChange }) {
    return (
        <div role="tablist" aria-label="Chain filter" style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
            <button
                type="button"
                role="tab"
                aria-selected={value === 'all'}
                onClick={() => onChange('all')}
                className={styles.entry}
                style={{ padding: '0.25rem 0.5rem' }}
            >
                All
            </button>
            {chains.map((cid) => {
                const d = chainRegistry.get(cid);
                return (
                    <button
                        type="button"
                        role="tab"
                        key={cid}
                        aria-selected={value === cid}
                        aria-label={d?.displayName || cid}
                        onClick={() => onChange(cid)}
                        className={styles.entry}
                        style={{ padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                        {d ? <ChainBadge descriptor={d} size="sm" /> : <span>{cid}</span>}
                    </button>
                );
            })}
        </div>
    );
}

function ChainGroup({ descriptor, chainId, state, emptyText, onOpenContract, renderRow }) {
    return (
        <section>
            <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                {descriptor
                    ? <ChainBadge descriptor={descriptor} size="sm" />
                    : <span>{chainId}</span>}
            </header>
            {state.loading ? (
                <p className={styles.entryDescription}>Loading…</p>
            ) : state.error && state.rows.length === 0 ? (
                <p role="alert" className={styles.entryDescription}>
                    Couldn't load contracts: {state.error}
                </p>
            ) : state.rows.length === 0 ? (
                <p className={styles.entryDescription}>{emptyText}</p>
            ) : (
                state.rows.map((row, i) => (
                    <button
                        key={String(rowKey(row)) + ':' + i}
                        type="button"
                        className={styles.entry}
                        aria-label={row.name || row.NAME || `Contract ${rowKey(row)}`}
                        onClick={() => onOpenContract(chainId, String(rowKey(row)))}
                    >
                        {renderRow(row)}
                    </button>
                ))
            )}
        </section>
    );
}

function ContractRow({ row }) {
    const name = row.name || row.NAME || '(unnamed)';
    const owner = row.source || row.SOURCE || row.owner || row.OWNER;
    const status = String(row.status || row.STATUS || '—');
    return (
        <>
            <span className={styles.entryLabel}>
                {name} — #{row.action_index ?? '?'}
            </span>
            <span className={styles.entryDescription}>
                {owner ? (
                    <>owner <AddressText address={String(owner)} /> · </>
                ) : null}
                status {status}
            </span>
        </>
    );
}

function InteractionRow({ row }) {
    const kinds = Array.from(row.kinds || []).sort().join(' + ');
    return (
        <>
            <span className={styles.entryLabel}>
                Contract #{row.contract_action_index ?? '?'}
            </span>
            <span className={styles.entryDescription}>
                {kinds || '—'} · last block {row.latestBlock || '—'}
            </span>
        </>
    );
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

function dedupeByActionIndex(rows) {
    const seen = new Set();
    return rows.filter((row) => {
        const key = String(row.action_index ?? row.tx_hash ?? JSON.stringify(row));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function newestFirst(a, b) {
    return Number(b.block_index || 0) - Number(a.block_index || 0);
}

function rowKey(row) {
    return row.action_index ?? row.contract_action_index ?? row.tx_hash ?? '0';
}

function applySearch(rows, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
        const name = String(row.name || row.NAME || '').toLowerCase();
        const idx = String(row.action_index ?? row.contract_action_index ?? '').toLowerCase();
        return name.includes(q) || idx.startsWith(q.replace(/^#/, ''));
    });
}

function short(addr) {
    if (!addr || typeof addr !== 'string') return '?';
    return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
