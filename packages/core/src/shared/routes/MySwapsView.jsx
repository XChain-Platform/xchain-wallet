// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MySwapsView (PC-18): the unified, cross-pair "My swaps" surface, the
// swap-side twin of PC-17's MyOrdersView. One plain list, newest first, of
// every SWAP the wallet placed (as SOURCE) across all chains and addresses,
// each row with its status chip (operator ruling 2026-11-13: no Open/Closed
// choice). A row opens the swap's details (SwapDetail), which holds Cancel
// (SWAP v1) and Edit (SWAP v2) while the swap is open. SWAP settles
// atomically with no COINPAY, so there is NO auto-pay toggle here.
//
// Reads: per wallet address, the swaps feed (with the owner's edits
// overlaid by swapsForAddress) and the swap cancels feed; never one read per
// swap. Status derivation lives in utils/swapStatus.js.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Button,
    EmptyState,
    Icon,
    ListPage,
    PageHeader,
    Screen,
    Select,
    Skeleton,
} from '@xchain-wallet/core/ui';
import { flows as flowsLib, registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
// The standard list filter, on the title line.
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { SwapRow, swapStatusLabel } from '../components/SwapRow.jsx';
import { hasSwapCancelBroadcast } from '../utils/swapCancelMarks.js';
import {
    collectCancelledKeys,
    deriveStatus,
    extractRows,
    isPositiveActionIndex,
    swapExpiryLabel,
    swapSides,
    swapStateOf,
} from '../utils/swapStatus.js';
import { sideAmountText } from '../utils/orderView.js';
// Edit Swap and Cancel Swap share the Form Standard frame with the order forms.
import { TradeOwnerActionForm } from './TradeOwnerActionForm.jsx';
import L from './ObligationsView.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

const chainRegistry = registryLib.defaultRegistry();

// The status helpers moved to utils/swapStatus.js; these stay exported here
// for the callers and tests that read them off the list module.
export { collectCancelledKeys, deriveStatus, swapExpiryLabel };

// The list items for a demo wallet: the bundled demo swaps, owned by the
// first address on each chain, each with its hydrated lifecycle state.
function demoSwapItems(chains, nowMs) {
    const items = [];
    for (const [chainId, addrs] of Object.entries(chains || {})) {
        const owner = (addrs || []).find((a) => typeof a?.address === 'string' && a.address.length > 0);
        if (!owner) continue;
        for (const row of flowsLib.synthesizeDemoSwaps(chainId, owner.address, { now: nowMs })) {
            const key = `${chainId}:${row.action_index}`;
            items.push({ chainId, owner, row, key, cancelledKeys: new Set(), live: swapStateOf(row) });
        }
    }
    items.sort((a, b) => Number(b.row.action_index || 0) - Number(a.row.action_index || 0));
    return items;
}

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {() => void} props.onBack
 * @param {() => void} [props.onCreateSwap]
 * @param {(chainId: string, actionIndex: string) => void} [props.onOpenSwap]  opens the swap's details page
 */
export function MySwapsView({ walletId, accountId, onBack, onCreateSwap, onOpenSwap }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [items, setItems] = useState(/** @type {any[] | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
    // The title-line filter's state (search text and Sort).
    const [query, setQuery] = useState('');
    const [sortBy, setSortBy] = useState('newest');
    const loadRequestId = useRef(0);

    useEffect(() => {
        const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30000);
        return () => clearInterval(t);
    }, []);

    const load = useCallback(async () => {
        const requestId = ++loadRequestId.current;
        if (flowsLib.isDemoWallet(walletId)) {
            // A demo wallet has no explorer history; it lists the bundled
            // demo swaps owned by its first address on each chain.
            const chains = typeof messaging?.getAddressesByChain === 'function'
                ? ((await messaging.getAddressesByChain(walletId, accountId).catch(() => null)) || {})
                : {};
            if (requestId !== loadRequestId.current) return;
            setItems(demoSwapItems(chains, Date.now()));
            setLoadError(null);
            return;
        }
        if (typeof messaging?.getAddressesByChain !== 'function'
            || typeof messaging?.getSwapsForAddress !== 'function') {
            setItems([]); return;
        }
        setItems(null);
        setLoadError(null);
        try {
            const chains = (await messaging.getAddressesByChain(walletId, accountId)) || {};
            if (requestId !== loadRequestId.current) return;
            const pairs = [];
            for (const [chainId, addrs] of Object.entries(chains)) {
                for (const a of addrs || []) pairs.push({ chainId, owner: a });
            }
            const results = await Promise.all(pairs.map((p) => Promise.all([
                messaging.getSwapsForAddress({ chainId: p.chainId, address: p.owner.address }),
                (typeof messaging.getSwapCancelsForAddress === 'function'
                    ? messaging.getSwapCancelsForAddress({ chainId: p.chainId, address: p.owner.address })
                    : Promise.resolve(null)),
            ]).then(([s, c]) => ({ p, swaps: extractRows(s), cancels: extractRows(c) }))));
            if (requestId !== loadRequestId.current) return;

            const cancelledKeys = collectCancelledKeys(results);
            const seen = new Set();
            const all = [];
            for (const r of results) {
                for (const s of r.swaps) {
                    if (String(s.source) !== r.p.owner.address) continue;
                    const key = `${r.p.chainId}:${s.action_index}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    all.push({ chainId: r.p.chainId, owner: r.p.owner, row: s, key });
                }
            }
            all.sort((a, b) => Number(b.row.action_index || 0) - Number(a.row.action_index || 0));
            // Each row's live state rides on the feed (swapsForAddress), so
            // the list costs no read per swap.
            setItems(all.map((it) => ({ ...it, cancelledKeys, live: swapStateOf(it.row) })));
            setLoadError(null);
        } catch {
            if (requestId !== loadRequestId.current) return;
            setLoadError('Could not load your swaps. Try again.');
            setItems([]);
        }
    }, [messaging, walletId, accountId]);

    useEffect(() => {
        load();
        return () => { loadRequestId.current += 1; };
    }, [load]);

    // The title bar holds the filter and New swap (plus) icons; the page body
    // is only the swap list. The filter searches and sorts; it never splits
    // the list by status (each row's chip says it).
    const filterMenu = (
        <ListFilterMenu
            query={query}
            onQueryChange={setQuery}
            active={sortBy !== 'newest'}
            label="Filter swaps"
            searchPlaceholder="Search"
            searchLabel="Search swaps"
        >
            {/* Filter-panel dropdowns carry no visible label; each option names itself. */}
            <Select
                aria-label="Sort"
                size="md"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
            >
                <Select.Option value="newest" icon={<Icon.HistoryIcon />}>Newest first</Select.Option>
                <Select.Option value="oldest" icon={<Icon.ClockIcon />}>Oldest first</Select.Option>
                <Select.Option value="expiring" icon={<Icon.PauseIcon />}>Expiring soonest</Select.Option>
            </Select>
        </ListFilterMenu>
    );
    const header = (
        <PageHeader
            onBack={onBack}
            title="My Swaps"
            trailing={(
                <>
                    {filterMenu}
                    {onCreateSwap ? (
                        <Button variant="secondary" icon={<Icon.PlusIcon />} aria-label="New swap" title="New swap" onClick={onCreateSwap}>
                            {null}
                        </Button>
                    ) : null}
                </>
            )}
        />
    );
    const wrap = (children, { notices } = {}) => (
        <Screen variant={variant} header={header}>
            <ListPage notices={notices}>
                {children}
            </ListPage>
        </Screen>
    );

    if (items === null) {
        return wrap(
            <div role="status" aria-label="Loading swaps">
                <Skeleton.List rows={5} />
            </div>,
        );
    }
    // A failed read shows the plain empty state: the app's reachability
    // banner reports network trouble once, so no page adds its own error or
    // Try Again (G91).
    if (loadError || items.length === 0) {
        return wrap(
            // The empty state is text only; New swap is in the title bar.
            <EmptyState
                title="No swaps yet"
                body="Atomic token swaps you offer show up here across every pair."
            />,
        );
    }

    // A cancel this session broadcast (on the swap's details page) shows
    // Cancelling until the cancels feed lists it.
    const statusOf = (it) => {
        const status = deriveStatus(it, it.cancelledKeys, nowSec);
        return status === 'open' && hasSwapCancelBroadcast(messaging, it.key) ? 'cancelling' : status;
    };
    // The title-line filter narrows by search text, and Sort orders the one list.
    const needle = query.trim().toLowerCase();
    const matches = (it) => {
        if (!needle) return true;
        const { give, get } = swapSides(it.row);
        const hay = [
            give, get, it.row.action_index, it.owner.address, it.chainId, swapStatusLabel(statusOf(it)),
        ].join(' ').toLowerCase();
        return hay.includes(needle);
    };
    const expiryOf = (it) => {
        const n = Number(it.live?.expiration ?? it.row.expiration);
        return Number.isFinite(n) && n > 0 ? n : Infinity;
    };
    const indexOf = (it) => Number(it.row.action_index || 0);
    const sortItems = (list) => [...list].sort((a, b) => {
        if (sortBy === 'oldest') return indexOf(a) - indexOf(b);
        if (sortBy === 'expiring') return (expiryOf(a) - expiryOf(b)) || (indexOf(b) - indexOf(a));
        return indexOf(b) - indexOf(a);
    });
    const shown = sortItems(items.filter(matches));

    // A search with no matches reads as one plain empty state.
    if (shown.length === 0) {
        return wrap(<EmptyState title="No matching swaps" body="Change or clear the filter to see more." titleAs="p" />);
    }
    // One list card, every swap in it; each row opens that swap's details.
    return wrap(
        /* Safari needs an explicit list role because this class removes list styling. */
        <ul className={L.list} role="list" aria-label="Swaps">
            {shown.map((it) => {
                const { give, get } = swapSides(it.row);
                return (
                    <li key={it.key} className={L.item} data-swap-row={it.key}>
                        <SwapRow
                            give={give}
                            get={get}
                            row={it.row}
                            chainId={it.chainId}
                            status={statusOf(it)}
                            actionIndex={it.row.action_index}
                            descriptor={chainRegistry.get(it.chainId)}
                            expiryText={swapExpiryLabel(it.live?.expiration ?? it.row.expiration, nowSec)}
                            onOpen={() => onOpenSwap?.(it.chainId, String(it.row.action_index))}
                        />
                    </li>
                );
            })}
        </ul>,
    );
}

// What Edit Swap and Cancel Swap own (SWAP v2 and v1, both through the one
// swapAction flow, VERSION picks the op): copy, checks and fresh re-reads,
// unchanged from when the form drew its own page. The layout is the shared
// Form Standard frame (TradeOwnerActionForm).
/** @type {import('./TradeOwnerActionForm.jsx').TradeOwnerActionKind} */
const SWAP_KIND = {
    action: 'SWAP',
    indexParam: 'SWAP_ACTION_INDEX',
    noun: 'Swap',
    lowerNoun: 'swap',
    software: { cancel: 'swapAction', edit: 'swapAction' },
    hardware: { cancel: 'swapActionHw', edit: 'swapActionHw' },
    icon: Icon.SwapIcon,
    indexLabel: 'Swap',
    // Grouped for display ("250,000 PEPE"), full precision kept.
    sideText: (row, side) => sideAmountText(row[`${side}_tick`], row[`${side}_coin`], row[`${side}_amount`], row[`${side}_ownership`]),
    confirmVerb: (type) => (type === 'cancel'
        ? t('components.confirmSummary.verbCancelSwap')
        : t('components.confirmSummary.verbEditSwap')),
    help: {
        network: 'The network this swap lives on. Its change is sent and its fee paid on this network.',
        from: 'The address that placed this swap. Only it can edit or cancel the swap, and it pays the network fee.',
        expiration: 'The date and time this swap offer stops matching. Leave it blank to keep the current expiration.',
        allow: 'Only addresses on this list can match the swap. Pick a list you own; a field you leave alone keeps the current list.',
        block: 'Addresses on this list cannot match the swap. Pick a list you own; a field you leave alone keeps the current list.',
    },
    resultCopy: {
        cancel: 'The swap offer will close and any escrow returns to you once the cancel confirms.',
        edit: 'The swap update will take effect once it confirms.',
    },
    resultWhat: { cancel: 'swap cancel', edit: 'swap edit' },
    confirmChainLabel: 'chainLabel',
    // Shown as soon as the fields hold it, and refused on submit.
    liveError({ isCancel, row, expInput, allowListIdx, blockListIdx }) {
        if (!isPositiveActionIndex(row.action_index)) return 'This swap has an invalid action ID and cannot be changed.';
        if (isCancel) return null;
        if (expInput.trim()) {
            const ms = Date.parse(expInput.trim());
            if (!Number.isFinite(ms)) return 'Expiration must be a valid date and time.';
            if (Math.floor(ms / 1000) <= Math.floor(Date.now() / 1000)) return 'Expiration must be a future date and time.';
        }
        if (allowListIdx && allowListIdx !== '0' && !isPositiveActionIndex(allowListIdx)) {
            return 'Allow-list ID must be a positive whole number.';
        }
        if (blockListIdx && blockListIdx !== '0' && !isPositiveActionIndex(blockListIdx)) {
            return 'Block-list ID must be a positive whole number.';
        }
        return null;
    },
    validate({ isCancel, editHasChange, editParams }) {
        if (isCancel) return null;
        if (!editHasChange) return 'Change at least one field (expiration, allow-list, or block-list).';
        if (editParams.EXPIRATION && Number(editParams.EXPIRATION) <= Math.floor(Date.now() / 1000)) {
            return 'Expiration must be a future date and time.';
        }
        return null;
    },
    // Fresh reads, so a cancel or fill since the page loaded is never
    // answered from the page's own reads.
    async recheck({ messaging, item, owner, actionIndex }) {
        const { chainId } = item;
        let freshCancelledKeys = item.cancelledKeys || new Set();
        if (typeof messaging.getSwapCancelsForAddress === 'function') {
            try {
                const response = await messaging.getSwapCancelsForAddress({ chainId, address: owner.address, fresh: true });
                freshCancelledKeys = collectCancelledKeys([{ p: { chainId, owner }, cancels: extractRows(response) }]);
            } catch {
                return 'Could not refresh this swap. Try again.';
            }
        }
        if (typeof messaging.getSwapDetail === 'function') {
            let freshDetail;
            try {
                freshDetail = await messaging.getSwapDetail({ chainId, actionIndex, fresh: true });
            } catch {
                return 'Could not refresh this swap. Try again.';
            }
            const freshState = swapStateOf(freshDetail);
            if (freshState) {
                const status = deriveStatus({ ...item, live: freshState }, freshCancelledKeys, Math.floor(Date.now() / 1000));
                if (status !== 'open') return 'This swap is no longer open. Refresh My swaps and try again.';
            }
        }
        if (freshCancelledKeys.has(item.key)) return 'This swap is no longer open. Refresh My swaps and try again.';
        return null;
    },
    submitExtra: ({ params }) => ({ params }),
    failFallback: (err, isCancel) => err?.message || `${isCancel ? 'Cancel' : 'Edit'} failed.`,
};

/**
 * Cancel (SWAP v1) or Edit (SWAP v2) an open swap, signed from its owner
 * address: the Edit Swap and Cancel Swap forms. The form is the input step;
 * signing happens on the shared confirm page with its network pre-flight,
 * or, in watcher mode, the form builds an unsigned transaction. The
 * edit-swap and cancel-swap routes (SwapActionForms.jsx) and Swap Details'
 * in-place fallback both render it.
 *
 * @param {object} props
 * @param {'cancel' | 'edit'} props.type
 * @param {any} props.item               the swap as loadSwapDetail returns it
 * @param {any[]} props.chainAddresses
 * @param {string} props.variant
 * @param {string} props.walletId
 * @param {any} props.messaging
 * @param {() => void} props.onDone
 * @param {() => void} [props.onCancelBroadcast]
 * @param {() => void} props.onBack
 */
export function SwapActionPanel(props) {
    return <TradeOwnerActionForm kind={SWAP_KIND} {...props} />;
}
