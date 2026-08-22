// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import { AddressText, Button, ChainBadge, Icon, Input, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useChainIdsWithAction } from '../hooks/useSupportedChains.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import styles from './ActionsMenu.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Which chains have contracts to browse, asked of the LIVE registry rather
// than pinned to a coin here (useChainIdsWithAction('DEPLOY') in the
// component body). This file held the wallet's last hard-coded bitcoin pin
// for the VM surfaces: the gate has ONE home, the descriptor's
// supportedActions as registry/actions.js builds it (DEPLOY sits in
// COMMON_ACTIONS today, so every bundled chain qualifies), and a private copy
// in this file meant that when the registry opened contracts to LTC/DOGE the
// browse surface silently did not. Same descriptor-driven pattern as
// DeployContractForm, StakingList and BetFeedsList.
//
// DEPLOY is the right question to ask, not EXECUTE: a chain that can deploy is
// a chain that can have contracts to list, and the two travel together.
// The Contracts nav item is gated on the wallet having an address on one of
// these chains; this component assumes the caller did that gating but also
// surfaces the no-address case defensively.

/**
 * Contracts browse landing (§42.2).
 *
 * Three sections:
 *   1. "My contracts (deployed by me)": sdk.getContracts(addr, 'source').
 *   2. "My interactions (deposits/withdrawals/executes)": union of
 *      getDeposits + getWithdrawals by address, deduped by
 *      CONTRACT_ACTION_INDEX. Executions-by-address is not yet wired
 *      (SDK getExecutions is contract-scoped today); the detail page
 *      in Step 3 surfaces per-contract executions via the contract
 *      lane. Documented limitation, not a silent gap.
 *   3. "Browse all contracts": sdk.getContracts() paginated.
 *
 * The chain filter offers the chains whose descriptors advertise DEPLOY
 * (vmChains below), so it follows the registry rather than a coin pinned
 * here; testnet / regtest chains appear when present. The
 * search input filters the currently-rendered rows client-side on
 * CONTRACT_ACTION_INDEX prefix or NAME substring. The explorer
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

    const vmChains = useChainIdsWithAction('DEPLOY');

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

    const vmChainsWithAddresses = useMemo(() => {
        if (!addressesByChain) return [];
        return vmChains.filter((cid) => {
            const rows = addressesByChain[cid];
            return Array.isArray(rows) && rows.length > 0;
        });
    }, [vmChains, addressesByChain]);

    const activeChains = useMemo(() => {
        if (chainFilter === 'all') return vmChainsWithAddresses;
        return vmChainsWithAddresses.includes(chainFilter) ? [chainFilter] : [];
    }, [chainFilter, vmChainsWithAddresses]);

    // Phase 2: "My contracts" (deployed by one of my addresses on the
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

    // Phase 3: "My interactions": union of deposits + withdrawals
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
        <PageHeader
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
        return wrap(<StatusMessage variant="error" className={styles.entryDescription}>{addressesError}</StatusMessage>);
    }
    if (!addressesByChain) {
        return wrap(<p className={styles.entryDescription}>Loading addresses…</p>);
    }
    if (vmChainsWithAddresses.length === 0) {
        return wrap(
            <p className={styles.entryDescription}>
                Contracts ({actionDisplayLabel('DEPLOY')} / {actionDisplayLabel('EXECUTE')} /
                {' '}{actionDisplayLabel('DEPOSIT')} / {actionDisplayLabel('WITHDRAW')}) need an
                address on a chain that supports them. Use Receive to generate one first.
            </p>,
        );
    }

    return wrap(
        <>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <ChainFilterBar
                    chains={vmChainsWithAddresses}
                    value={chainFilter}
                    onChange={setChainFilter}
                />
                <Input
                    type="search"
                    placeholder="Filter by name or number"
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
                                    emptyText={`No ${actionDisplayLabel('DEPOSIT').toLowerCase()} or ${actionDisplayLabel('WITHDRAW').toLowerCase()} actions recorded against this chain's addresses yet.`}
                                    onOpenContract={onOpenContract}
                                    renderRow={(row) => <InteractionRow row={row} />} />
                    );
                })}
                {/* Keep the copy plain-language: this renders to end users, so no
                    SDK method names or internal shorthand (#2255). The technical
                    reason (SDK getExecutions is contract-scoped today) lives in
                    the header comment at the top of this file. */}
                <p className={styles.entryDescription}>
                    {actionDisplayLabel('EXECUTE')}-only interactions (method
                    calls that don&apos;t move funds) aren&apos;t listed here
                    yet. Open a contract to see its call history.
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
                <StatusMessage variant="error" className={styles.entryDescription}>
                    Couldn't load contracts: {state.error}
                </StatusMessage>
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
    const status = String(row.status || row.STATUS || '(unknown)');
    return (
        <>
            <span className={styles.entryLabel}>
                {name} #{row.action_index ?? '?'}
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
                {kinds || '(none)'} · last block {row.latestBlock || '?'}
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
