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
import { AddressText, Button, EmptyState, Icon, ListPage, ListRow, NetworkField, PageHeader, Screen, SectionHeader, Skeleton, StatusMessage, Tabs } from '@xchain-wallet/core/ui';
import * as branding from '../../branding/branding.js';
// The standard title-line filter, as Bet Markets uses it.
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { LIST_DETAIL_MIN_WIDTH, ListDetailSplit, listDetailStyles, useWideContent } from '../components/PanelSplit.jsx';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useWalletSource } from '../hooks/useDemoGuard.jsx';
import { OfflineEmptyState } from '../components/OfflineEmptyState.jsx';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { useChainIdsWithAction } from '../hooks/useSupportedChains.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { contractDisplayLabel, contractMetaOf } from './contractResponseShape.js';
import styles from './ActionsMenu.module.css';
import contractStyles from './ContractScreens.module.css';

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
 *   1. "My contracts (published by me)": sdk.getContracts(addr, 'source').
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
 * CONTRACT_ACTION_INDEX prefix or name substring.
 *
 * Names: a contract's name, version and description are an export of its own
 * source (CONTRACT_META_REQUIRED), extracted by the indexer and served by the
 * explorer as `meta_name` / `meta_version` on every row here, so every viewer
 * sees the same name. Rows print it WITH the derived address
 * ("Escrow v1.0.0 (C:BTC:12)") because names are not unique and the address is
 * the identity. A contract deployed before the flag day exports none and reads
 * "Unnamed contract".
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {(chainId: string, actionIndex: string) => void} props.onOpenContract
 * @param {() => void} [props.onDeploy]   navigate to the §42.6 deploy form (Phase 4 Step 4+); when omitted the button is hidden
 * @param {() => void} props.onBack
 * @param {'all' | 'mine' | 'interactions'} [props.initialView]
 * @param {{ chainId: string, contractActionIndex: string } | null} [props.selectedContract]
 * @param {(ref: { chainId: string, contractActionIndex: string }) => void} [props.onSelectContract]
 * @param {(ref: { chainId: string, contractActionIndex: string }, panel: { toolsSlot: HTMLElement | null }) => import('react').ReactNode} [props.renderContract]
 * @param {(ref: { chainId: string, contractActionIndex: string }, page: { measureRef: (el: HTMLElement | null) => void }) => import('react').ReactNode} [props.renderContractPage]
 */
export function ContractsList({
    walletId,
    onOpenContract,
    onDeploy,
    onBack,
    initialView = 'all',
    selectedContract = null,
    onSelectContract,
    renderContract,
    renderContractPage,
}) {
    const { shell } = useMessaging();
    const source = useWalletSource(walletId);
    const { messaging } = source;
    const variant = screenVariantFor(shell);
    const canSplit = typeof renderContract === 'function';
    const [layoutRef, wideContent, measured] = useWideContent(LIST_DETAIL_MIN_WIDTH, canSplit);
    const twoPanel = canSplit && wideContent;
    const detailRoute = typeof renderContractPage === 'function' && Boolean(selectedContract);
    const listShown = !detailRoute || (measured && twoPanel);
    const [localPick, setLocalPick] = useState(/** @type {{ chainId: string, contractActionIndex: string } | null} */ (null));

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
    // The All | My Contracts | Interactions tabs above the list.
    const [view, setView] = useState(initialView);

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
    const [addressesReload, setAddressesReload] = useState(0);
    const [contractsReload, setContractsReload] = useState(0);
    const retryContracts = () => {
        setMyByChain({});
        setInteractionsByChain({});
        setBrowseByChain({});
        setContractsReload((value) => value + 1);
    };

    useEffect(() => {
        if (!listShown) return undefined;
        let cancelled = false;
        setAddressesByChain(null);
        setAddressesError(null);
        Promise.resolve()
            .then(() => messaging.getAddressesByChain(walletId))
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
            })
            .catch(() => {
                if (!cancelled) {
                    setAddressesError('Could not load addresses. Try again.');
                }
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, addressesReload, listShown]);

    const vmChainsWithAddresses = useMemo(() => {
        if (!addressesByChain) return [];
        return vmChains.filter((cid) => {
            const rows = addressesByChain[cid];
            return Array.isArray(rows)
                && rows.some((row) => typeof row?.address === 'string' && row.address.length > 0);
        });
    }, [vmChains, addressesByChain]);

    const activeChains = useMemo(() => {
        if (chainFilter === 'all') return vmChainsWithAddresses;
        return vmChainsWithAddresses.includes(chainFilter) ? [chainFilter] : [];
    }, [chainFilter, vmChainsWithAddresses]);

    // Offline the explorer reads cannot finish: the sections wait, the page
    // shows its offline state, and the reads run when the connection returns.
    const { offline, recheck } = useNetworkOffline({ walletId });

    // Phase 2: "My contracts" (deployed by one of my addresses on the
    // chain). Fan out one sdk.getContracts(addr, 'source') per address
    // per chain, merge, de-dupe.
    useEffect(() => {
        if (!listShown) return undefined;
        if (!addressesByChain) return;
        if (activeChains.length === 0) {
            setMyByChain(settledEmpty([]));
            return;
        }
        if (offline) return;
        const initial = {};
        for (const cid of activeChains) initial[cid] = { loading: true, rows: [], error: null };
        setMyByChain(initial);

        let cancelled = false;
        for (const cid of activeChains) {
            const addrs = (addressesByChain[cid] || [])
                .map((a) => a.address)
                .filter((address) => typeof address === 'string' && address.length > 0);
            Promise.all(addrs.map((addr) =>
                Promise.resolve()
                    .then(() => messaging.getContractsForSource({ chainId: cid, address: addr }))
                    .then((resp) => ({ addr, rows: extractRows(resp) }))
                    .catch((err) => ({ addr, error: userFacingMessage(err, 'Failed to load contracts.') }))
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
            }).catch((err) => {
                if (cancelled) return;
                setMyByChain((prev) => ({
                    ...prev,
                    [cid]: { loading: false, rows: [], error: userFacingMessage(err, 'Failed to load contracts.') },
                }));
            });
        }
        return () => { cancelled = true; };
    }, [addressesByChain, activeChains, messaging, contractsReload, offline, listShown]);

    // Phase 3: "My interactions": union of deposits + withdrawals
    // scoped to the user's addresses. Returns the set of distinct
    // CONTRACT_ACTION_INDEX values this address has interacted with.
    // Each entry is a synthesized row carrying { contract_action_index,
    // latestBlock, kinds: Set<'deposit'|'withdraw'> } for rendering.
    useEffect(() => {
        if (!listShown) return undefined;
        if (!addressesByChain) return;
        if (activeChains.length === 0) {
            setInteractionsByChain(settledEmpty([]));
            return;
        }
        if (offline) return;
        const initial = {};
        for (const cid of activeChains) initial[cid] = { loading: true, rows: [], error: null };
        setInteractionsByChain(initial);

        let cancelled = false;
        for (const cid of activeChains) {
            const addrs = (addressesByChain[cid] || [])
                .map((a) => a.address)
                .filter((address) => typeof address === 'string' && address.length > 0);
            const ops = [];
            for (const addr of addrs) {
                ops.push(
                    Promise.resolve()
                        .then(() => messaging.getDepositsForAddress({ chainId: cid, address: addr }))
                        .then((resp) => ({ kind: 'deposit', rows: extractRows(resp) }))
                        .catch((err) => ({ error: userFacingMessage(err, 'Failed to load contract activity.') })),
                );
                ops.push(
                    Promise.resolve()
                        .then(() => messaging.getWithdrawalsForAddress({ chainId: cid, address: addr }))
                        .then((resp) => ({ kind: 'withdraw', rows: extractRows(resp) }))
                        .catch((err) => ({ error: userFacingMessage(err, 'Failed to load contract activity.') })),
                );
            }
            Promise.all(ops).then((results) => {
                if (cancelled) return;
                /** @type {Map<string, { contract_action_index: string, latestBlock: number, kinds: Set<string>, meta_name: string | null, meta_version: string | null }>} */
                const byContract = new Map();
                const errs = [];
                for (const r of results) {
                    if (r.error) { errs.push(r.error); continue; }
                    for (const row of r.rows) {
                        const ci = String(row.contract_action_index ?? row.CONTRACT_ACTION_INDEX ?? '');
                        if (!ci) continue;
                        const block = Number(row.block_index || 0);
                        // A DEPOSIT / WITHDRAW payload names the contract it
                        // touched (`contract_meta_name` / `contract_meta_version`),
                        // which is the only identity this synthesized row has:
                        // these entries are built from action payloads, not from
                        // contract rows, so nothing else here carries a name.
                        const meta = contractMetaOf(row);
                        let entry = byContract.get(ci);
                        if (!entry) {
                            entry = {
                                contract_action_index: ci,
                                latestBlock: block,
                                kinds: new Set(),
                                meta_name: meta.name,
                                meta_version: meta.version,
                            };
                            byContract.set(ci, entry);
                        } else {
                            if (block > entry.latestBlock) entry.latestBlock = block;
                            // Keep the first name seen; a later payload with none
                            // must not blank a contract that already has one.
                            if (!entry.meta_name && meta.name) {
                                entry.meta_name = meta.name;
                                entry.meta_version = meta.version;
                            }
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
            }).catch((err) => {
                if (cancelled) return;
                setInteractionsByChain((prev) => ({
                    ...prev,
                    [cid]: { loading: false, rows: [], error: userFacingMessage(err, 'Failed to load contracts.') },
                }));
            });
        }
        return () => { cancelled = true; };
    }, [addressesByChain, activeChains, messaging, contractsReload, offline, listShown]);

    useEffect(() => {
        if (!listShown) return undefined;
        if (activeChains.length === 0) {
            setBrowseByChain(settledEmpty([]));
            return;
        }
        if (offline) return;
        const initial = {};
        for (const cid of activeChains) initial[cid] = { loading: true, rows: [], error: null };
        setBrowseByChain(initial);

        let cancelled = false;
        for (const cid of activeChains) {
            Promise.resolve()
                .then(() => messaging.getContractsBrowseAll({ chainId: cid }))
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
                        [cid]: { loading: false, rows: [], error: userFacingMessage(err, 'Failed to load contracts.') },
                    }));
                });
        }
        return () => { cancelled = true; };
    }, [activeChains, messaging, contractsReload, offline, listShown]);

    const statesForView = view === 'mine'
        ? myByChain
        : view === 'interactions' ? interactionsByChain : browseByChain;
    const viewRows = useMemo(() => activeChains.flatMap((chainId) => (
        statesForView[chainId]?.rows || []
    ).map((row) => ({
        chainId,
        contractActionIndex: String(rowKey(row)),
        row,
    }))), [activeChains, statesForView]);
    const viewLoading = activeChains.some((chainId) => !statesForView[chainId] || statesForView[chainId].loading);
    const shownContract = useMemo(() => {
        if (!twoPanel || !addressesByChain) return null;
        const pick = selectedContract ?? localPick;
        if (pick?.chainId && pick?.contractActionIndex != null) {
            return {
                chainId: String(pick.chainId),
                contractActionIndex: String(pick.contractActionIndex),
            };
        }
        if (viewLoading) return null;
        const first = viewRows[0];
        return first ? {
            chainId: first.chainId,
            contractActionIndex: first.contractActionIndex,
        } : null;
    }, [twoPanel, addressesByChain, selectedContract, localPick, viewLoading, viewRows]);
    // Once this is a supported wide Contracts page, the split and its docked
    // tabs stay mounted. An empty, loading or failed tab is left-panel state;
    // it must not collapse the layout or replace the selected detail.
    const showPanel = twoPanel && listShown && !addressesError
        && Boolean(addressesByChain) && vmChainsWithAddresses.length > 0;
    useEffect(() => {
        if (showPanel && shownContract && !sameContract(shownContract, selectedContract)) {
            onSelectContract?.(shownContract);
        }
    }, [showPanel, shownContract, selectedContract, onSelectContract]);
    const pickContract = (chainId, contractActionIndex) => {
        const ref = { chainId: String(chainId), contractActionIndex: String(contractActionIndex) };
        if (!twoPanel) {
            onOpenContract(ref.chainId, ref.contractActionIndex);
            return;
        }
        setLocalPick(ref);
        onSelectContract?.(ref);
    };

    // The title bar holds the filter (search, Network) and a plus for
    // Publish contract at the far right; the body is just the list.
    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to home"
            title="Contracts"
            trailing={addressesByChain && !addressesError && vmChainsWithAddresses.length > 0 ? (
                <>
                    <ListFilterMenu
                        query={searchQuery}
                        onQueryChange={setSearchQuery}
                        active={chainFilter !== 'all'}
                        label="Filter contracts"
                        searchPlaceholder="Search"
                        searchLabel="Search contracts"
                    >
                        {/* The standard Network field opens the full-screen
                            network list (operator ruling 2026-11-13). */}
                        <NetworkField
                            label="Network"
                            help="Shows only the contracts on the network you pick, or on every network."
                            size="md"
                            value={chainFilter}
                            onChange={setChainFilter}
                            chainIds={vmChainsWithAddresses}
                            chainRegistry={chainRegistry}
                            allOption
                            notSource
                        />
                    </ListFilterMenu>
                    {onDeploy ? (
                        <Button variant="secondary" icon={<Icon.PlusIcon />} aria-label="Publish contract" title="Publish contract" onClick={onDeploy}>
                            {null}
                        </Button>
                    ) : null}
                </>
            ) : null}
        />
    );
    const selectedRow = shownContract ? viewRows.find((item) => sameContract(item, shownContract)) : null;
    const detailSkeleton = <div aria-hidden="true"><Skeleton height={190} /></div>;
    const wrap = (children, toolbar, notices) => {
        const listPage = (
            <ListPage toolbar={showPanel ? undefined : toolbar} notices={notices}>{children}</ListPage>
        );
        if (!showPanel) {
            return (
                <Screen variant={variant} header={header}>
                    <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="list">
                        {listPage}
                    </div>
                </Screen>
            );
        }
        return (
            <Screen variant={variant} header={header} bodyClassName={listDetailStyles.twoPanelBody}>
                <ListDetailSplit
                    measureRef={layoutRef}
                    storageKey="contracts"
                    resizeLabel="Resize the contracts list"
                    resizeHint="Drag to resize the contracts list, or press Enter to reset."
                    layoutName="two-panel"
                    listHeader={toolbar}
                    list={listPage}
                    listLabel="Contracts list"
                    detailLabel={selectedRow
                        ? contractDisplayLabel(selectedRow.row, selectedRow)
                        : 'Contract detail'}
                    detailBusy={!shownContract}
                    detailFallback={detailSkeleton}
                    detail={shownContract
                        ? renderContract(shownContract, { toolsSlot: null })
                        : detailSkeleton}
                />
            </Screen>
        );
    };

    if (detailRoute && !(measured && twoPanel)) {
        if (!measured) {
            return (
                <Screen variant={variant} header={header}>
                    <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="measuring" />
                </Screen>
            );
        }
        return renderContractPage(selectedContract, { measureRef: layoutRef });
    }

    if (addressesError) {
        return wrap(
            <StatusMessage
                variant="error"
                className={styles.entryDescription}
                recovery={{
                    label: 'Try Again',
                    onAction: () => {
                        setAddressesError(null);
                        setAddressesByChain(null);
                        setAddressesReload((value) => value + 1);
                    },
                }}
            >
                {addressesError}
            </StatusMessage>,
        );
    }
    if (!addressesByChain) {
        return wrap(
            <div role="status" aria-label="Loading contracts">
                <Skeleton.List rows={5} />
            </div>,
        );
    }
    if (vmChainsWithAddresses.length === 0) {
        return wrap(
            <EmptyState
                title="No supported address"
                body="Contracts require an address on a network that supports them."
            />,
        );
    }

    // Icon tabs directly above the list.
    const toolbar = (
        <div className={contractStyles.tabsRow}>
            <Tabs
                aria-label="Contract views"
                items={[
                    { id: 'all', label: <span className={contractStyles.tabLabel}><Icon.GridIcon />All</span> },
                    { id: 'mine', label: <span className={contractStyles.tabLabel}><Icon.UserIcon />My Contracts</span> },
                    { id: 'interactions', label: <span className={contractStyles.tabLabel}><Icon.DollarIcon />Interactions</span> },
                ]}
                value={view}
                onChange={setView}
            />
        </div>
    );

    // Offline with nothing loaded, the page says so once in place of three
    // sections waiting on reads that cannot run.
    const anyContractRows = [myByChain, interactionsByChain, browseByChain]
        .some((byChain) => Object.values(byChain).some((state) => state.rows?.length > 0));
    if (offline && !anyContractRows) {
        return wrap(
            <OfflineEmptyState body="Contracts load when the connection returns." onRetry={recheck} />,
            toolbar,
        );
    }

    // One notice for the whole page. Three sections over every chain would
    // otherwise repeat the same sentence and the same retry up to nine times.
    const loadFailed = [myByChain, interactionsByChain, browseByChain]
        .some((byChain) => Object.values(byChain).some((state) => state.error));
    const loadFailedNotice = loadFailed ? (
        <StatusMessage
            variant="error"
            className={styles.entryDescription}
            recovery={{ label: 'Try Again', onAction: retryContracts }}
        >
            Couldn't load contracts. Try again.
        </StatusMessage>
    ) : null;
    // One list at a time, picked by the tab above it. Interactions is
    // the wallet's deposits and withdrawals (funded); calls that move no funds
    // are not readable by address, so the tab says so under the list.
    let tabBody;
    if (view === 'mine') {
        tabBody = (
            <ChainSection
                chains={activeChains}
                statesByChain={myByChain}
                searchQuery={searchQuery}
                emptyTitle="No published contracts"
                emptyText="Published contracts appear here after you publish one."
                onOpenContract={pickContract}
                selectedContract={showPanel ? shownContract : null}
                renderRow={contractRowParts}
            />
        );
    } else if (view === 'interactions') {
        tabBody = (
            <ChainSection
                chains={activeChains}
                statesByChain={interactionsByChain}
                searchQuery={searchQuery}
                emptyTitle="No contract interactions"
                emptyText={`${actionDisplayLabel('DEPOSIT')} and ${actionDisplayLabel('WITHDRAW').toLowerCase()} actions appear here after one of your addresses interacts with a contract.`}
                onOpenContract={pickContract}
                selectedContract={showPanel ? shownContract : null}
                renderRow={interactionRowParts}
            />
        );
    } else {
        tabBody = (
            <ChainSection
                chains={activeChains}
                statesByChain={browseByChain}
                searchQuery={searchQuery}
                emptyTitle="No contracts yet"
                emptyText="Published and indexed contracts appear here after one is created."
                onOpenContract={pickContract}
                selectedContract={showPanel ? shownContract : null}
                renderRow={contractRowParts}
            />
        );
    }

    return wrap(tabBody, toolbar, loadFailedNotice);
}

/**
 * Every chain marked loaded with nothing in it. A chain missing from a
 * section's map reads as still loading, so a demo wallet (whose addresses
 * never go to an explorer) settles each chain to its empty state instead.
 *
 * @param {string[]} chains
 */
function settledEmpty(chains) {
    return Object.fromEntries(chains.map((cid) => [cid, { loading: false, rows: [], error: null }]));
}

function Section({ title, children }) {
    return (
        <section>
            {title ? <SectionHeader title={title} /> : null}
            {children}
        </section>
    );
}

/**
 * One section of the page across every chain the wallet can publish on.
 * Chains that are loading, failed, or have rows get their own group; when
 * none of them has anything to show, the section says so once at full
 * width instead of repeating the same empty message under every chain. The
 * message carries no button: the toolbar's Publish contract is the one way in.
 */
function ChainSection({
    title,
    chains,
    statesByChain,
    searchQuery,
    emptyTitle,
    emptyText,
    onOpenContract,
    selectedContract,
    renderRow,
}) {
    const searchActive = searchQuery.trim().length > 0;
    const groups = chains.map((cid) => {
        const state = statesByChain[cid] || { loading: true, rows: [], error: null };
        return { cid, state, rows: applySearch(state.rows, searchQuery) };
    });
    const shown = groups.filter(({ state, rows }) => state.loading || rows.length > 0);
    // A failed read says nothing about what is on the chain, so the section
    // does not claim to be empty; the page notice carries the failure.
    const readFailed = groups.some(({ state }) => state.error);
    const filteredOut = searchActive && groups.some(({ state }) => state.rows.length > 0);
    return (
        <Section title={title}>
            {shown.length === 0 ? (readFailed ? null : (
                <EmptyState
                    title={filteredOut ? 'No matching contracts' : emptyTitle}
                    body={filteredOut ? 'Try a different name or number.' : emptyText}
                    titleAs="p"
                />
            )) : shown.map(({ cid, state, rows }) => (
                <ChainGroup key={cid} descriptor={chainRegistry.get(cid)} chainId={cid} state={{ ...state, rows }}
                            onOpenContract={onOpenContract}
                            selectedContract={selectedContract}
                            renderRow={(row) => renderRow(row, cid)} />
            ))}
        </Section>
    );
}

/** One chain's rows or its loading skeleton. A failed read is the page's notice. */
function ChainGroup({
    descriptor,
    chainId,
    state,
    onOpenContract,
    selectedContract,
    renderRow,
}) {
    // No network heading above the rows: the chain badge on each row's icon
    // names the network (U12, G61). The rows sit in one list card with
    // dividers, each ending in the standard chevron (G07, G97).
    const chainIconUrl = branding.chainIconSmallUrl(chainId);
    return (
        <section aria-label={`Contracts on ${descriptor?.displayName || chainId}`}>
            {state.loading ? (
                <div role="status" aria-label={`Loading contracts on ${descriptor?.displayName || chainId}`}>
                    <Skeleton.List rows={3} />
                </div>
            ) : (
                <ul className={contractStyles.list} data-xc-split-list={selectedContract ? '' : undefined}>
                    {state.rows.map((row, i) => {
                        const parts = renderRow(row);
                        const selected = sameContract(selectedContract, {
                            chainId,
                            contractActionIndex: String(rowKey(row)),
                        });
                        return (
                            <li
                                key={String(rowKey(row)) + ':' + i}
                                className={contractStyles.listItem}
                                data-selected={selected ? 'true' : undefined}
                            >
                                <ListRow
                                    className={contractStyles.contractRow}
                                    data-xc-split-row={selectedContract ? '' : undefined}
                                    aria-label={`Open ${contractDisplayLabel(row, { chainId, actionIndex: rowKey(row) })}`}
                                    aria-current={selected ? 'true' : undefined}
                                    onClick={() => onOpenContract(chainId, String(rowKey(row)))}
                                    chevron
                                    leading={(
                                        <span className={contractStyles.rowIcon} aria-hidden="true">
                                            <Icon.ContractIcon />
                                            {chainIconUrl ? (
                                                <img src={chainIconUrl} alt="" className={contractStyles.chainOverlay} />
                                            ) : null}
                                        </span>
                                    )}
                                    title={parts.title}
                                    subtitle={parts.subtitle}
                                    trailing={parts.trailing}
                                />
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

/** A status word in sentence case for the row's pill ("ACTIVE" -> "Active"). */
function statusText(value) {
    const text = String(value || '').trim().toLowerCase();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Unknown';
}

/** A live contract's status takes the success tint; every other status stays neutral. */
function statusIsLive(value) {
    return ['active', 'valid'].includes(String(value || '').trim().toLowerCase());
}

function contractRowParts(row, chainId) {
    // Name and version off the chain's own record, printed with the derived
    // address: "Escrow v1.0.0 (C:BTC:12)". Never the name alone - names are not
    // unique, so two contracts would look like one.
    const publisher = row.source || row.SOURCE;
    return {
        title: contractDisplayLabel(row, { chainId, actionIndex: row.action_index }),
        subtitle: publisher ? (
            <span className={contractStyles.publisher}>
                {/* An element, so AddressText's fit takes its width off the row. */}
                <span>Published by</span>
                <AddressText address={String(publisher)} fit focusable={false} />
            </span>
        ) : null,
        trailing: <span className={`${contractStyles.statusPill} ${statusIsLive(row.status || row.STATUS) ? contractStyles.statusLive : ''}`}>{statusText(row.status || row.STATUS)}</span>,
    };
}

function interactionRowParts(row, chainId) {
    const kinds = Array.from(row.kinds || []).sort().join(' + ');
    return {
        title: contractDisplayLabel(row, { chainId, actionIndex: row.contract_action_index }),
        subtitle: `${kinds || '(none)'} · last block ${row.latestBlock || '?'}`,
        trailing: null,
    };
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

function sameContract(a, b) {
    return Boolean(a && b)
        && String(a.chainId) === String(b.chainId)
        && String(a.contractActionIndex) === String(b.contractActionIndex);
}

function applySearch(rows, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
        const name = String(contractMetaOf(row).name || '').toLowerCase();
        const idx = String(row.action_index ?? row.contract_action_index ?? '').toLowerCase();
        return name.includes(q) || idx.startsWith(q.replace(/^#/, ''));
    });
}

function short(addr) {
    if (!addr || typeof addr !== 'string') return '?';
    return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
