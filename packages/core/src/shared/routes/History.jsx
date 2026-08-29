// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, PageHeader, Screen, Skeleton, StatusMessage, VerifiedBadge } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import {
    isEntryReplaceable,
    replaceFromHistoryEntry,
    RbfNotSupportedError,
    RbfInvalidEntryError,
} from '../../flows/rbfReplace.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { useSettings } from '../hooks/useSettings.js';
import { useFiatRate } from '../hooks/useFiatRate.js';
import { useActionProofVerification } from '../hooks/useProofVerification.js';
import { EmptyStateNudge } from '../components/EmptyStateNudge.jsx';
import { formatFiat } from '../components/BalanceList.jsx';
import { coinToFiat } from '../../flows/priceLookup.js';
import { useToast } from '../components/ToastHost.jsx';
import { groupHistoryEntries } from '../utils/historyGrouping.js';
import { normalizeHistoryRow } from '../utils/historyRow.js';
import {
    compareMergedEntries,
    mempoolRowToEntry,
    mergePendingEntries,
    pendingDisplayState,
    pendingTxToEntry,
} from '../utils/pendingHistory.js';
import { t } from '../../i18n/index.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { TxStatusTimeline } from '../components/TxStatusTimeline.jsx';
import { StalenessLabel } from '../components/StalenessLabel.jsx';
import { flows as flowsLib } from '@xchain-wallet/core';
import {
    applyHistoryFilters,
    classifyEntryStatus,
    ACTION_TYPE_OPTIONS,
    STATUS_OPTIONS,
} from '../utils/historyFilter.js';
import { readChainSet, writeChainSet } from '../utils/chainFilterMemory.js';
import { useScreenShortcuts } from '../keyboard/useScreenShortcuts.js';
import styles from './History.module.css';

const HISTORY_CHAIN_FILTER_KEY = 'history';
const GROUPING_MODE_STORAGE_KEY = 'xc:historyGroupingMode';

function readPersistedGroupingMode() {
    try {
        const v = globalThis.localStorage?.getItem(GROUPING_MODE_STORAGE_KEY);
        return v === 'flat' ? 'flat' : 'grouped';
    } catch {
        return 'grouped';
    }
}

function writePersistedGroupingMode(mode) {
    try {
        globalThis.localStorage?.setItem(GROUPING_MODE_STORAGE_KEY, mode);
    } catch { /* best-effort */ }
}

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
 * M2.3: one copy table for every pending state, read by the row badge
 * and by the detail panel that row opens. Two tables would eventually
 * disagree, and a row reading "pending" above a panel saying the network
 * never saw the transaction teaches the user to believe neither.
 *
 * `pendingDisplayState` decides which entry applies; nothing here reads
 * the raw fields itself.
 */
const PENDING_COPY = {
    'awaiting-network': {
        row: 'pending.row.awaitingNetwork',
        headline: 'pending.detail.awaitingNetwork',
        help: 'pending.detail.awaitingNetworkHelp',
    },
    seen: {
        row: 'pending.row.seen',
        headline: 'pending.detail.seen',
        help: 'pending.detail.seenHelp',
    },
    'not-seen': {
        row: 'pending.row.notSeen',
        headline: 'pending.detail.notSeen',
        help: 'pending.detail.notSeenHelp',
    },
    dropped: {
        row: 'pending.row.dropped',
        headline: 'pending.detail.dropped',
        help: 'pending.detail.droppedHelp',
    },
    replaced: {
        row: 'pending.row.replaced',
        headline: 'pending.detail.replaced',
        help: 'pending.detail.replacedHelp',
    },
};

/**
 * The states where something has gone wrong enough that the user should
 * pick the row out of a list without reading it (M2 acceptance test 3).
 * Healthy pending and "nothing has ever reported this" must not look
 * alike.
 */
const PENDING_WARNING_STATES = new Set(['not-seen', 'dropped']);

/**
 * The pending state of an entry, or null when there is nothing to
 * describe. A blockless row carrying no pending metadata (an older
 * shell, a synthesized demo row) gets no state rather than a guessed
 * one: every state is a claim about the network, and for those rows we
 * hold no evidence for any of them.
 *
 * @param {{ pending?: object } | null | undefined} entry
 */
function pendingStateOf(entry) {
    return entry?.pending ? pendingDisplayState(entry, Date.now()) : null;
}

/**
 * The handle History keeps on the row the user opened, alongside its
 * key. Lowercased because the pending side normalizes hashes and the
 * confirmed feed does not.
 *
 * @param {{ chainId?: string, txHash?: string } | null | undefined} entry
 */
function rememberedSelection(entry) {
    return {
        chainId: String(entry?.chainId || ''),
        txHash: String(entry?.txHash || '').toLowerCase(),
    };
}

/**
 * SEND wire layouts, mirrored from the SDK's `parseActionString`
 * (`xchain-sdk/src/x402.js`). The wallet cannot import it: the SDK is a
 * host-side dependency and `@xchain-wallet/core` ships without it.
 *
 * The exact segment count is part of the contract, not a shortcut. A
 * memo containing a pipe shifts every field after it, so a layout that
 * merely required "at least N segments" would pair one output's amount
 * with another output's destination.
 */
const SEND_WIRE_LAYOUTS = {
    0: { count: 6,  outputs: [{ tick: 2, amount: 3, destination: 4, memo: 5 }] },
    1: { count: 8,  outputs: [{ tick: 2, amount: 3, destination: 4, memo: 7 },
                              { tick: 2, amount: 5, destination: 6, memo: 7 }] },
    2: { count: 9,  outputs: [{ tick: 2, amount: 3, destination: 4, memo: 8 },
                              { tick: 5, amount: 6, destination: 7, memo: 8 }] },
    3: { count: 10, outputs: [{ tick: 2, amount: 3, destination: 4, memo: 5 },
                              { tick: 6, amount: 7, destination: 8, memo: 9 }] },
};

const ACTION_NAME_RE = /^[A-Z_]{2,32}$/;

/**
 * The SDK's `isPosNum` (`xchain-sdk/src/x402.js`), the gate every output
 * of `parseActionString` passes: a bare decimal above zero, with no
 * sign, no exponent and no surrounding whitespace. Another hand-copy for
 * the same reason the layouts are, and it drifts as easily.
 *
 * The SDK settles "above zero" through a bignumber; the shape settles it
 * here, since a string of digits is zero exactly when none of them is
 * 1-9. Asking a JS number instead would answer in the wrong arithmetic
 * and there is no third party to hand the parsed value to anyway.
 *
 * @param {unknown} v
 */
function isWireAmount(v) {
    const s = String(v);
    return /^\d+(\.\d+)?$/.test(s) && /[1-9]/.test(s);
}

/**
 * What a pending transaction is about to do, read off its action data
 * (I-9). SEND v0-v3 is the only layout anything on this platform can
 * parse, so it is the only one this claims to understand. Every other
 * action shows its raw segments under its own name; deriving per-output
 * amounts for one would be inventing them.
 *
 * Amounts travel as the strings the wire carried. Nothing here does
 * arithmetic on them, so there is no precision to lose.
 *
 * @param {{ pending?: { data?: string | null }, raw?: object, action?: string }} entry
 * @returns {{ kind: 'send' | 'segments' | 'local' | 'none', action: string,
 *             outputs: Array<{tick: string, amount: string, destination: string, memo: string}>,
 *             segments: string[] }}
 */
function describePendingAction(entry) {
    const none = { kind: /** @type {'none'} */ ('none'), action: '', outputs: [], segments: [] };
    const data = entry?.pending?.data;
    if (typeof data !== 'string' || data === '') {
        // Nothing network-reported. Our own record of a send still knows
        // what we asked for, and the panel labels it as ours.
        const raw = entry?.raw || {};
        const amount = raw.amount == null ? '' : String(raw.amount);
        const tick = raw.tick ? String(raw.tick) : '';
        if (!amount || !tick) return none;
        return {
            kind: /** @type {'local'} */ ('local'),
            action: String(entry?.action || ''),
            outputs: [{ tick, amount, destination: String(raw.destination || ''), memo: '' }],
            segments: [],
        };
    }

    const segments = data.normalize('NFC').split('|');
    const wireAction = String(segments[0] || '').trim().toUpperCase();
    const action = ACTION_NAME_RE.test(wireAction)
        ? wireAction
        : String(entry?.action || '').toUpperCase();
    const asSegments = {
        kind: /** @type {'segments'} */ ('segments'), action, outputs: [], segments,
    };
    if (wireAction !== 'SEND') return asSegments;

    const layout = SEND_WIRE_LAYOUTS[Number(String(segments[1] || '').trim())];
    if (!layout || segments.length !== layout.count) return asSegments;
    const outputs = [];
    for (const map of layout.outputs) {
        const amount = String(segments[map.amount] || '');
        // Matched the count but the amount position holds something that
        // is not an amount: not a SEND we understand, and the segments
        // are the honest answer. Whitespace is not trimmed away first
        // because the SDK does not trim either, and this has to fail
        // wherever the SDK fails or the two disagree about what the
        // network will accept.
        if (!isWireAmount(amount)) return asSegments;
        outputs.push({
            tick: String(segments[map.tick] || '').toUpperCase(),
            amount,
            destination: String(segments[map.destination] || ''),
            memo: String(segments[map.memo] || '').trim(),
        });
    }
    return { kind: /** @type {'send'} */ ('send'), action, outputs, segments };
}

/**
 * M2.5: which verb the row annotation uses, keyed by the direction the
 * merge already decided (I-9). A null direction is not in the table on
 * purpose: it means neither party was identified as ours, and a plus or
 * a minus there would put a sign on money the wallet cannot attribute.
 */
const PENDING_AMOUNT_COPY = {
    out: 'pending.amount.sending',
    in: 'pending.amount.receiving',
};

/**
 * M2.5: what a pending transaction is about to move, or null when the
 * wallet cannot say.
 *
 * Null is the answer for every action but SEND v0-v3 and our own record
 * of a send. A MINT carries its supply at the same segment offset a SEND
 * carries its amount, so reading it positionally would invent a figure
 * rather than report one, which is the whole point of I-9. The decode
 * comes from `describePendingAction`, which yields outputs for nothing
 * else; the kind check below states that contract rather than enforcing
 * it a second time.
 *
 * Amount strings are the wire's own, untouched: a value too large or too
 * precise for a JS number reaches the screen intact because nothing here
 * parses one.
 *
 * @param {any} entry
 * @returns {{ direction: 'in' | 'out' | null,
 *             outputs: Array<{ tick: string, amount: string }> } | null}
 */
function pendingAmountAnnotation(entry) {
    if (!entry?.pending) return null;
    const desc = describePendingAction(entry);
    if (desc.kind !== 'send' && desc.kind !== 'local') return null;
    const outputs = desc.outputs.filter((o) => o.amount !== '' && o.tick !== '');
    if (outputs.length === 0) return null;
    return { direction: entry.pending.direction ?? null, outputs };
}

/**
 * History route: §23 unified timeline + §23.5 cross-chain thread
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
 *   - "Cross-chain only": keep only entries that are part of a LINK
 *     pairing (regardless of whether both peers are in the result set)
 *
 * Wallet addresses are resolved up-front via
 * `messaging.getAddressesByChain(walletId)`. Per (chain, address) we
 * fan out two parallel reads (`getAddressHistory` + `getLinksForAddress`)
 * and merge into a flat `entries` list with `linkIdx` pointing at
 * matching entries when both sides happen to be in the wallet's
 * history (typical case: cross-chain LINK between two addresses owned
 * by the same wallet).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]   active BIP44 account; when set, history is scoped to that account's addresses
 * @param {() => void} props.onBack
 * @param {() => void} [props.onReceive]   surfaces a Receive CTA in the empty-state nudges (G077)
 * @param {string} [props.initialSearchQuery]   pre-populates the search box on mount; lets TokenDetail open History scoped to one tick (G071)
 * @param {{ chainId?: string, actionIndex?: string, txHash?: string } | null} [props.initialFocus]
 *        when set, the matching entry is auto-selected and scrolled into
 *        view as soon as it loads. §24.6 / Cluster Y FOLLOWUP 4; used
 *        by the desktop detach-pending-tx path.
 */
export function History({ walletId, accountId, onBack, onReceive, onSelectEntry, initialSearchQuery = '', initialChainCoin = '', initialFocus = null }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const { showToast } = useToast();

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [entries, setEntries] = useState(/** @type {HistoryEntry[]} */ ([]));
    // Cluster G FOLLOWUP 5: Unix ms of the last successful per-chain
    // history+links fan-out completion. Surfaces as a "Last synced …"
    // hint in the filter bar so the user can spot stale views.
    const [historyFetchedAt, setHistoryFetchedAt] = useState(
        /** @type {number | null} */ (null),
    );
    const [loadingChains, setLoadingChains] = useState(/** @type {Set<string>} */ (new Set()));
    // §28.3 "Indexed" timeline stage: per-chain indexer watermark
    // (latest processed block index) keyed by chainId. Fetched once per
    // loaded chain via messaging.getIndexerWatermark; threaded into the
    // TxStatusTimeline so a confirmed row can show whether the indexer has
    // caught up to its block.
    const [indexerWatermarkByChainId, setIndexerWatermarkByChainId] = useState(
        /** @type {Record<string, number>} */ ({}),
    );
    const [enabledChains, setEnabledChains] = useState(/** @type {Set<string>} */ (new Set()));
    const [crossChainOnly, setCrossChainOnly] = useState(false);
    const [multisigOnly, setMultisigOnly] = useState(false);
    const [multisigAddress, setMultisigAddress] = useState(/** @type {string | null} */ (null));
    const [groupingMode, setGroupingModeState] = useState(/** @type {'grouped' | 'flat'} */ (readPersistedGroupingMode));
    const setGroupingMode = (mode) => {
        setGroupingModeState(mode);
        writePersistedGroupingMode(mode);
    };
    const [expandedGroups, setExpandedGroups] = useState(/** @type {Set<string>} */ (new Set()));
    const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '');
    const [actionTypeFilter, setActionTypeFilter] = useState(/** @type {Set<string>} */ (new Set()));
    const [statusFilter, setStatusFilter] = useState(/** @type {Set<string>} */ (new Set()));
    // Default to the last 30 days so a fresh History view surfaces
    // recent activity without the user having to pick a range. ISO
    // YYYY-MM-DD format matches what <input type="date"> expects.
    const [dateFrom, setDateFrom] = useState(() => isoDateDaysAgo(30));
    const [dateTo, setDateTo] = useState(() => isoDateDaysAgo(0));
    const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
    // Cluster I FOLLOWUP 5: single-modal export. Holds the modal's
    // open state + the field choices (format / column set / date-range
    // override). Initial column set = every field; date range defaults
    // to the active filter when the modal opens.
    const [exportModalOpen, setExportModalOpen] = useState(false);
    const [exportFormat, setExportFormat] = useState(/** @type {'csv' | 'json'} */ ('csv'));
    const [exportColumns, setExportColumns] = useState(
        /** @type {Set<string>} */ (new Set(flowsLib.EXPORT_COLUMNS)),
    );
    const [exportFromDate, setExportFromDate] = useState('');
    const [exportToDate, setExportToDate] = useState('');
    const [exportScope, setExportScope] = useState(/** @type {'filtered' | 'all'} */ ('filtered'));
    const [selectedKey, setSelectedKey] = useState(/** @type {string | null} */ (null));
    // M2.3: the open row is remembered by TRANSACTION as well as by key.
    // A pending entry is keyed on its hash and a confirmed one on its
    // action index, so the key of the row the user is reading changes at
    // the moment the transaction confirms, and changes again if a shallow
    // reorg reassigns that index. Without a second handle the detail
    // closes itself exactly when it finally has something new to say.
    const selectedTxRef = useRef(/** @type {{ chainId: string, txHash: string } | null} */ (null));
    const [peerCache, setPeerCache] = useState(
        /** @type {Record<string, { loading: boolean, action: any | null, error: string | null }>} */ ({}),
    );
    // §24.6 / Cluster Y FOLLOWUP 4; once a detached-window's initial
    // route resolves, ref-flag this so we don't re-select on every
    // re-render or after the user manually navigates away from the row.
    const initialFocusFiredRef = useRef(false);
    const searchInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // §34.2 context shortcuts: '/' focuses the search input, 'e' opens the
    // export modal. Single keys only, so they stay inert while any input has
    // focus (useScreenShortcuts applies the same editable-target gate as the
    // global dispatcher).
    useScreenShortcuts({
        keys: {
            '/': () => { searchInputRef.current?.focus(); },
            e: () => { setExportModalOpen(true); },
        },
    });

    // Step 1: resolve the wallet's addresses grouped by chainId.
    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId, accountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const all = new Set(
                    Object.entries(byChain || {})
                        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
                        .map(([cid]) => cid),
                );
                // When the caller asked us to scope to a specific coin
                // family (e.g. arrived from the Bitcoin TokenDetail's
                // History button), narrow enabledChains to only those
                // chains. One-shot override: we deliberately skip the
                // remembered-set restore and don't persist this scope,
                // so revisiting History via the menu reverts to the
                // user's last manually-chosen filter.
                if (initialChainCoin) {
                    const scoped = new Set(
                        [...all].filter((cid) => chainRegistry.get(cid)?.coin === initialChainCoin),
                    );
                    setEnabledChains(scoped.size > 0 ? scoped : all);
                    return;
                }
                // §23.5 / G052: restore the user's last chain-filter
                // choice if one is stored, intersected with the wallet's
                // currently-active chains so a removed chain doesn't
                // leave a stale entry. Falls back to "all enabled".
                const remembered = readChainSet(HISTORY_CHAIN_FILTER_KEY, all);
                setEnabledChains(remembered ?? all);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging, initialChainCoin]);

    // §22 Multisig-only filter (Step 22). Resolve the wallet's
    // multisig receive address up-front so the chip can filter
    // entries by exact match without re-running deriveMultisigAddress
    // on every render. Best-effort: silently leaves the chip
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
            .catch(() => { /* no multisig configured; chip stays disabled */ });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // M2.1: pending rows have to keep the same timestamp between polls or
    // they would jump around the list, so the moment WE first saw each one is
    // remembered here rather than recomputed. It is only ever a fallback: a
    // row the network has actually seen carries `first_seen` instead.
    const observedAtRef = useRef(/** @type {Map<string, number>} */ (new Map()));
    // Read inside the fetch effect, which must not re-run when the list it
    // produces changes, so the current list travels by ref rather than by dep.
    const entriesRef = useRef(/** @type {HistoryEntry[]} */ ([]));
    entriesRef.current = entries;
    const rememberObservedAt = (chainId, txHash, nowMs) => {
        const key = `${chainId}:${String(txHash || '').toLowerCase()}`;
        const seen = observedAtRef.current.get(key);
        if (seen != null) return seen;
        observedAtRef.current.set(key, nowMs);
        return nowMs;
    };
    // M2.2 needs to tell "the network never saw this" apart from "the network
    // saw it and no longer does", and the difference is only visible ACROSS
    // polls: once the mempool row is gone, the read that would have carried it
    // is simply absent. So the last poll that did list each transaction is
    // remembered here, and travels to the entry that outlives the row.
    const lastMempoolSeenRef = useRef(/** @type {Map<string, number>} */ (new Map()));

    // M2.1: History had no cadence of its own; a confirmed row only ever
    // appeared because the route remounted. Pending rows need one, so the
    // fetch below re-runs on the same 20s beat Home already uses for
    // balances, plus on focus, plus on mount. The tick is what re-triggers
    // it; the fetch itself decides whether to show the loading state.
    const [refreshTick, setRefreshTick] = useState(0);
    useEffect(() => {
        if (!addressesByChain) return undefined;
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        const bump = () => setRefreshTick((n) => n + 1);
        const id = setInterval(() => {
            // A hidden tab is not watching; polling it only burns the shared
            // rate limit the explorer zone is sized against.
            if (typeof document !== 'undefined' && document.hidden) return;
            bump();
        }, flowsLib.BALANCE_POLL_INTERVAL_MS);
        if (typeof window === 'undefined') return () => clearInterval(id);
        window.addEventListener('focus', bump);
        return () => {
            clearInterval(id);
            window.removeEventListener('focus', bump);
        };
    }, [addressesByChain, walletId]);

    // Step 2: fan out history + links + unconfirmed rows + our own in-flight
    // sends per (chain, address). Merge results into a single sorted list.
    useEffect(() => {
        if (!addressesByChain) return;
        const chainsToLoad = Object.entries(addressesByChain)
            .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
            .map(([cid]) => cid);
        if (chainsToLoad.length === 0) {
            setEntries([]);
            setHistoryFetchedAt(null);
            return;
        }
        let cancelled = false;
        // A background refresh must not blank the list it is refreshing; the
        // loading state belongs to the first load only.
        if (entriesRef.current.length === 0) setLoadingChains(new Set(chainsToLoad));

        // Cluster J FOLLOWUP 1: for the demo wallet, replace the SDK
        // fetch with synthesized fixture data so the History view
        // isn't an empty wasteland during the demo. Real history rows
        // arrive once the user exits demo mode + funds the wallet.
        const isDemo = flowsLib.isDemoWallet(walletId);

        const tasks = [];
        for (const cid of chainsToLoad) {
            for (const a of addressesByChain[cid]) {
                if (isDemo) {
                    tasks.push(Promise.resolve({
                        chainId: cid,
                        address: a.address,
                        history: flowsLib.synthesizeDemoHistory(cid, a.address),
                        links: flowsLib.synthesizeDemoLinks(),
                    }));
                    continue;
                }
                tasks.push(
                    Promise.all([
                        messaging.getAddressHistory({ chainId: cid, address: a.address })
                            .then((r) => extractRows(r))
                            .catch(() => []),
                        messaging.getLinksForAddress({ chainId: cid, address: a.address })
                            .then((r) => extractRows(r))
                            .catch(() => []),
                        // M2.1: both pending sources. Each degrades to [] on
                        // its own, so an explorer without the unconfirmed
                        // surface still shows our own broadcast sends, and a
                        // shell whose messaging predates these channels shows
                        // confirmed history exactly as it did before.
                        typeof messaging.getAddressMempool === 'function'
                            ? messaging.getAddressMempool({ chainId: cid, address: a.address })
                                .then((r) => extractRows(r))
                                .catch(() => [])
                            : Promise.resolve([]),
                        typeof messaging.getPendingTxsForAddress === 'function'
                            ? messaging.getPendingTxsForAddress({ chainId: cid, address: a.address })
                                .then((r) => extractRows(r))
                                .catch(() => [])
                            : Promise.resolve([]),
                    ]).then(([history, links, mempool, pendingTxs]) => (
                        { chainId: cid, address: a.address, history, links, mempool, pendingTxs }
                    )),
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
                    // Normalized through the shared helper rather than inline,
                    // so the standalone detail page can rebuild the SAME entry
                    // from the same row when a pending action confirms under it.
                    const entry = normalizeHistoryRow(row, {
                        chainId: r.chainId,
                        address: r.address,
                        link: linkMap.get(keyFor(r.chainId, aIdx)) || null,
                    });
                    if (entry) all.push(entry);
                }
            }
            // M2.1: build the pending side, then reconcile it against the
            // confirmed side by transaction hash. A hash present on both is
            // the SAME transaction that has just confirmed, and the confirmed
            // record replaces the pending one in place rather than joining it.
            const ownAddresses = new Set();
            for (const cid of Object.keys(addressesByChain || {})) {
                for (const a of (addressesByChain[cid] || [])) {
                    if (a && a.address) ownAddresses.add(String(a.address).toLowerCase());
                }
            }
            const nowMs = Date.now();
            /** @type {any[]} */
            const pendingCandidates = [];
            for (const r of perAddrResults) {
                for (const row of (r.mempool || [])) {
                    const hash = String(row?.tx_hash ?? row?.txHash ?? '');
                    if (!hash) continue;
                    lastMempoolSeenRef.current.set(`${r.chainId}:${hash.toLowerCase()}`, nowMs);
                    pendingCandidates.push(mempoolRowToEntry({
                        chainId: r.chainId,
                        address: r.address,
                        row,
                        ownAddresses,
                        observedAtMs: rememberObservedAt(r.chainId, hash, nowMs),
                    }));
                }
                for (const record of (r.pendingTxs || [])) {
                    if (!record?.txid) continue;
                    const key = `${r.chainId}:${String(record.txid).toLowerCase()}`;
                    pendingCandidates.push(pendingTxToEntry({
                        chainId: r.chainId,
                        address: r.address,
                        pendingTx: record,
                        ownAddresses,
                        observedAtMs: rememberObservedAt(r.chainId, record.txid, nowMs),
                        lastMempoolSeenMs: lastMempoolSeenRef.current.get(key) ?? null,
                    }));
                }
            }
            const merged = mergePendingEntries({ confirmed: all, pending: pendingCandidates });
            // Forget the observation times of transactions that are no longer
            // pending, so the map tracks the mempool rather than growing with
            // every transaction the wallet has ever made.
            const liveKeys = new Set(merged.pending.map((e) => `${e.chainId}:${e.txHash}`));
            for (const key of [...observedAtRef.current.keys()]) {
                if (!liveKeys.has(key)) observedAtRef.current.delete(key);
            }
            for (const key of [...lastMempoolSeenRef.current.keys()]) {
                if (!liveKeys.has(key)) lastMempoolSeenRef.current.delete(key);
            }
            merged.entries.sort(compareMergedEntries);
            setEntries(merged.entries);
            setLoadingChains(new Set());
            setHistoryFetchedAt(Date.now());
        });

        return () => { cancelled = true; };
    }, [addressesByChain, messaging, refreshTick]);

    // Lowercase set of every wallet address across every chain. Used by
    // the action-type filter to discriminate Send (wallet is source)
    // from Receive (wallet is destination).
    const walletAddressSet = useMemo(() => {
        const s = new Set();
        for (const cid of Object.keys(addressesByChain || {})) {
            for (const a of (addressesByChain[cid] || [])) {
                if (a && a.address) s.add(String(a.address).toLowerCase());
            }
        }
        return s;
    }, [addressesByChain]);

    // Cluster I FOLLOWUP 6: Per-chain tip used to compute confirmation
    // counts on confirmed rows. Derived from the highest blockIndex
    // seen across loaded history rows (lower bound for the chain tip,
    // since the wallet has no dedicated tip endpoint yet; explorer's
    // /network is still a placeholder, see FOLLOWUPS.md). A user with
    // any confirmed activity sees a meaningful count; a user with one
    // freshly-confirmed row gets "1 confirmation" (the tip is at the
    // row itself, which is correct).
    const chainTipByChainId = useMemo(() => {
        /** @type {Record<string, number>} */
        const tips = {};
        for (const e of entries) {
            if (!e || !e.chainId) continue;
            const b = Number(e.blockIndex || 0);
            if (b <= 0) continue;
            if (!(e.chainId in tips) || b > tips[e.chainId]) tips[e.chainId] = b;
        }
        return tips;
    }, [entries]);

    // §28.3: fetch the indexer watermark (latest processed block)
    // per loaded chain so the TxStatusTimeline's Indexed stage reflects real
    // indexer progress rather than the confirmed-implies-indexed fallback.
    // Best-effort: a null/failed watermark for a chain is simply omitted, and
    // the timeline degrades gracefully. Demo wallets skip the probe (there is
    // no real explorer behind synthesized history).
    useEffect(() => {
        if (!addressesByChain) return undefined;
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        const chains = Object.entries(addressesByChain)
            .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
            .map(([cid]) => cid);
        if (chains.length === 0) return undefined;
        let cancelled = false;
        Promise.all(
            chains.map((cid) =>
                messaging.getIndexerWatermark({ chainId: cid })
                    .then((r) => ({ cid, watermark: r && r.watermark != null ? Number(r.watermark) : null }))
                    .catch(() => ({ cid, watermark: null })),
            ),
        ).then((results) => {
            if (cancelled) return;
            const next = {};
            for (const { cid, watermark } of results) {
                if (Number.isFinite(watermark) && watermark > 0) next[cid] = watermark;
            }
            setIndexerWatermarkByChainId(next);
        });
        return () => { cancelled = true; };
    }, [addressesByChain, messaging, walletId]);

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
        return applyHistoryFilters(list, {
            searchQuery,
            actionTypes: actionTypeFilter,
            statusSet: statusFilter,
            dateFromMs: localDayStartMs(dateFrom),
            // dateTo is interpreted as end-of-day so a "to: 2026-04-27"
            // pick includes everything that happened that day.
            dateToMs: localDayEndMs(dateTo),
            walletAddresses: walletAddressSet,
        });
    }, [
        entries, enabledChains, crossChainOnly, multisigOnly, multisigAddress,
        searchQuery, actionTypeFilter, statusFilter, dateFrom, dateTo,
        walletAddressSet,
    ]);

    // §7/§8: SPV action verification. Verify only visible, confirmed
    // entries that carry a numeric action index (an unconfirmed action has
    // no checkpointable block yet). Off for demo wallets and when the user
    // opts out via `verifyProofs` (default on). The map is keyed by
    // entry.key; EntryRow badges from it.
    const proofSettings = useSettings();
    const verifyProofsEnabled = proofSettings.settings?.verifyProofs !== false
        && !flowsLib.isDemoWallet(walletId);
    // History-local fiat toggle, persisted on the Settings record
    // (same nested-patch pattern as the other §35 settings writes) so the
    // choice survives navigation and syncs across shells.
    const showFiatInHistory = Boolean(proofSettings.settings?.showFiatInHistory);
    const fiatCurrency = proofSettings.settings?.fiatCurrency || 'USD';
    const toggleShowFiatInHistory = async () => {
        try {
            await proofSettings.update({ showFiatInHistory: !showFiatInHistory });
        } catch {
            // Best-effort; the toggle simply won't persist this time.
        }
    };
    const verifyItems = useMemo(
        () => visibleEntries
            .filter((e) => Number(e.blockIndex) > 0 && e.actionIndex != null && e.actionIndex !== '')
            .map((e) => ({ key: e.key, chainId: e.chainId, actionIndex: e.actionIndex })),
        [visibleEntries],
    );
    const actionVerifyMap = useActionProofVerification({
        messaging,
        items: verifyItems,
        enabled: verifyProofsEnabled,
    });

    const filtersActive = (
        searchQuery
        || actionTypeFilter.size > 0
        || statusFilter.size > 0
        || dateFrom
        || dateTo
    );

    const toggleSetMember = (setter) => (id) => {
        setter((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const clearAllFilters = () => {
        // Snapshot the active filter set so the §37.2 Undo toast can
        // restore exactly what the user had before pressing Clear.
        const snapshot = {
            searchQuery,
            actionTypeFilter: new Set(actionTypeFilter),
            statusFilter: new Set(statusFilter),
            dateFrom,
            dateTo,
        };
        const hadAny = Boolean(filtersActive);
        setSearchQuery('');
        setActionTypeFilter(new Set());
        setStatusFilter(new Set());
        setDateFrom('');
        setDateTo('');
        if (hadAny) {
            showToast({
                message: 'Filter cleared',
                actionLabel: 'Undo',
                onAction: () => {
                    setSearchQuery(snapshot.searchQuery);
                    setActionTypeFilter(snapshot.actionTypeFilter);
                    setStatusFilter(snapshot.statusFilter);
                    setDateFrom(snapshot.dateFrom);
                    setDateTo(snapshot.dateTo);
                },
            });
        }
    };

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

    // §28.2 activity-feed grouping. Computed AFTER all filters so a
    // group only collapses when both leader and members survive the
    // current filter set; otherwise members render as ungrouped rows.
    const groupedItems = useMemo(
        () => groupHistoryEntries(visibleEntries, groupingMode),
        [visibleEntries, groupingMode],
    );

    // §24.6 / Cluster Y FOLLOWUP 4: auto-select the entry matching
    // `initialFocus` once entries have loaded, then scroll it into
    // view. Fires at most once per History mount so a user who
    // explicitly de-selects the row doesn't get the row re-selected
    // on every re-render.
    useEffect(() => {
        if (initialFocusFiredRef.current) return;
        if (!initialFocus) return;
        if (entries.length === 0) return;
        const match = entries.find((e) => {
            if (initialFocus.chainId && e.chainId !== initialFocus.chainId) return false;
            if (initialFocus.actionIndex && String(e.actionIndex) !== String(initialFocus.actionIndex)) return false;
            // Case-insensitive because the two sides are normalized
            // differently by design: a merged pending entry carries a
            // lowercased hash (it is the merge key), while a caller like the
            // send success card hands us the txid exactly as the node
            // returned it. An exact compare would fail silently, landing the
            // user on an unfocused list with nothing to explain why.
            if (initialFocus.txHash
                && String(e.txHash).toLowerCase() !== String(initialFocus.txHash).toLowerCase()) {
                return false;
            }
            return true;
        });
        if (!match) return;
        initialFocusFiredRef.current = true;
        selectedTxRef.current = rememberedSelection(match);
        setSelectedKey(match.key);
        // Defer scrollIntoView until after the row's <li> has rendered;
        // looking up the DOM node by `data-history-key` keeps the
        // selector decoupled from React's internals.
        if (typeof window !== 'undefined') {
            setTimeout(() => {
                const node = document.querySelector(
                    `[data-history-key="${cssEscape(match.key)}"]`,
                );
                if (node && typeof node.scrollIntoView === 'function') {
                    node.scrollIntoView({ block: 'center', behavior: 'auto' });
                }
            }, 0);
        }
    }, [entries, initialFocus]);

    // M2.3 handoff: the open row's key has just stopped existing, which
    // is what confirming looks like from here (the pending entry is
    // dropped and the confirmed one arrives under a different key). Point
    // the selection at the entry carrying the same transaction so the
    // detail upgrades in place instead of closing. A shallow reorg that
    // reassigns the action index lands here for the same reason, and gets
    // the same answer, because the transaction hash is the one handle
    // that survives both.
    //
    // A key that matches nothing at all is deliberately left alone: an
    // empty poll must not close a card the user is reading.
    useEffect(() => {
        if (!selectedKey) return;
        const tracked = selectedTxRef.current;
        if (!tracked?.txHash) return;
        if (entries.some((e) => e.key === selectedKey)) return;
        const match = entries.find((e) => e.chainId === tracked.chainId
            && String(e.txHash || '').toLowerCase() === tracked.txHash);
        if (match) setSelectedKey(match.key);
    }, [entries, selectedKey]);

    const toggleGroupExpanded = (groupKey) => {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupKey)) next.delete(groupKey);
            else next.add(groupKey);
            return next;
        });
    };

    const toggleChain = (cid) => {
        // §23.5 / G052: persist the new filter set so the user's
        // choice survives navigation. Capture the post-toggle Set
        // inside the updater so the write reflects the new state
        // even if React batches multiple toggles.
        setEnabledChains((prev) => {
            const next = new Set(prev);
            if (next.has(cid)) next.delete(cid);
            else next.add(cid);
            writeChainSet(HISTORY_CHAIN_FILTER_KEY, next);
            return next;
        });
    };

    const onRowClick = (entry) => {
        // When the parent shell wired the navigation callback, send the
        // selected entry up so it can route to the standalone ActionDetail
        // page. Falls back to the legacy inline expand for builds /
        // contexts where no handler is provided.
        if (typeof onSelectEntry === 'function') {
            onSelectEntry(entry);
            return;
        }
        const closing = selectedKey === entry.key;
        selectedTxRef.current = closing ? null : rememberedSelection(entry);
        setSelectedKey(closing ? null : entry.key);
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
        <PageHeader
            onBack={onBack}
            backLabel="Back to home"
            title="History"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <div className={styles.body}>{children}</div>
            <div className={styles.actions}>
            </div>
        </Screen>
    );

    if (loadError) {
        return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
    }
    if (!addressesByChain) {
        return wrap(
            <div role="status" aria-label="Loading history">
                <Skeleton.List rows={5} />
            </div>,
        );
    }
    const activeChainIds = Object.entries(addressesByChain)
        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
        .map(([cid]) => cid);
    if (activeChainIds.length === 0) {
        return wrap(
            <EmptyStateNudge
                title="No addresses yet"
                body="Generate a receive address to populate history."
                actionLabel={onReceive ? 'Receive' : undefined}
                onAction={onReceive}
                icon={onReceive ? <Icon.ReceiveIcon /> : undefined}
            />,
        );
    }

    return wrap(
        <>
            {/* Unified filter card: search, chain picker, and the
                collapsible Filters section all in one container. */}
            <div className={styles.filterCard} role="group" aria-label="History filters">
                <input
                    ref={searchInputRef}
                    type="search"
                    className={styles.searchInput}
                    placeholder="Search action, address, token, txid, memo…"
                    aria-label="Search history"
                    value={searchQuery}
                    onChange={(ev) => setSearchQuery(ev.target.value)}
                />

                <div className={styles.dateRow}>
                    <input
                        type="date"
                        aria-label="From date"
                        value={dateFrom}
                        onChange={(ev) => setDateFrom(ev.target.value)}
                        className={styles.dateInput}
                    />
                    <span className={styles.dateSep}>→</span>
                    <input
                        type="date"
                        aria-label="To date"
                        value={dateTo}
                        onChange={(ev) => setDateTo(ev.target.value)}
                        className={styles.dateInput}
                    />
                </div>

                <div className={styles.filterFooter}>
                    <button
                        type="button"
                        className={`${styles.filterDisclosure} ${moreFiltersOpen ? styles.filterDisclosureActive : ''}`}
                        onClick={() => setMoreFiltersOpen((v) => !v)}
                        aria-expanded={moreFiltersOpen}
                        aria-controls="history-more-filters"
                    >
                        <span>Additional details</span>
                        {moreFiltersOpen
                            ? <DoubleChevron direction="up" />
                            : <DoubleChevron direction="down" />}
                    </button>
                    <button
                        type="button"
                        className={`${styles.filterDisclosure} ${showFiatInHistory ? styles.filterDisclosureActive : ''}`}
                        aria-pressed={showFiatInHistory}
                        onClick={toggleShowFiatInHistory}
                        title="Show the fiat equivalent for native-coin amounts"
                    >
                        {showFiatInHistory ? `Fiat: ${fiatCurrency}` : 'Show fiat'}
                    </button>
                    <div className={styles.segGroup} role="radiogroup" aria-label="Grouping mode">
                        <button
                            type="button"
                            role="radio"
                            aria-checked={groupingMode === 'grouped'}
                            onClick={() => setGroupingMode('grouped')}
                            className={`${styles.segBtn} ${groupingMode === 'grouped' ? styles.segBtnActive : ''}`}
                        >Grouped</button>
                        <button
                            type="button"
                            role="radio"
                            aria-checked={groupingMode === 'flat'}
                            onClick={() => setGroupingMode('flat')}
                            className={`${styles.segBtn} ${groupingMode === 'flat' ? styles.segBtnActive : ''}`}
                        >Flat</button>
                    </div>
                </div>

                {moreFiltersOpen ? (
                    <div
                        id="history-more-filters"
                        className={styles.morePanel}
                        role="group"
                        aria-label="Advanced filters"
                    >
                        <ChainPicker
                            activeChainIds={activeChainIds}
                            chainRegistry={chainRegistry}
                            enabledChains={enabledChains}
                            onChange={(next) => {
                                setEnabledChains(next);
                                writeChainSet(HISTORY_CHAIN_FILTER_KEY, next);
                            }}
                        />

                        <CheckboxPicker
                            options={ACTION_TYPE_OPTIONS}
                            selected={actionTypeFilter}
                            onToggle={toggleSetMember(setActionTypeFilter)}
                            allLabel="All action types"
                            summaryNoun="action type"
                            iconForId={actionTypeIcon}
                            menuHeader="Action types"
                        />

                        <CheckboxPicker
                            options={STATUS_OPTIONS}
                            selected={statusFilter}
                            onToggle={toggleSetMember(setStatusFilter)}
                            allLabel="All statuses"
                            summaryNoun="status"
                            menuHeader="Status"
                        />

                        <CheckboxPicker
                            options={[
                                { id: 'crosschain', label: 'Cross-chain only' },
                            ]}
                            selected={new Set([
                                ...(crossChainOnly ? ['crosschain'] : []),
                            ])}
                            onToggle={(id) => {
                                if (id === 'crosschain') setCrossChainOnly((v) => !v);
                            }}
                            allLabel="No special filters"
                            summaryNoun="filter"
                            iconForId={specialFilterIcon}
                            menuHeader="Special"
                        />

                        {multisigAddress ? (
                            <button
                                type="button"
                                className={`${styles.chip} ${multisigOnly ? styles.chipActive : ''}`}
                                aria-pressed={multisigOnly}
                                onClick={() => setMultisigOnly((v) => !v)}
                            >
                                Multisig only
                            </button>
                        ) : null}

                    </div>
                ) : null}
            </div>

            {exportModalOpen ? (
                <ExportModal
                    onClose={() => setExportModalOpen(false)}
                    format={exportFormat}
                    setFormat={setExportFormat}
                    columns={exportColumns}
                    setColumns={setExportColumns}
                    fromDate={exportFromDate}
                    setFromDate={setExportFromDate}
                    toDate={exportToDate}
                    setToDate={setExportToDate}
                    scope={exportScope}
                    setScope={setExportScope}
                    activeFilterFromDate={dateFrom}
                    activeFilterToDate={dateTo}
                    visibleCount={visibleEntries.length}
                    totalCount={entries.length}
                    onConfirm={() => {
                        const sourceEntries = exportScope === 'all' ? entries : visibleEntries;
                        const ranged = (exportFromDate || exportToDate)
                            ? flowsLib.filterEntriesByDateRange(sourceEntries, {
                                // Same local-day reading as the filter bar, so an
                                // export of "today" contains what the list showed.
                                fromTs: exportFromDate ? Math.floor(localDayStartMs(exportFromDate) / 1000) : null,
                                toTs: exportToDate ? Math.floor(localDayEndMs(exportToDate) / 1000) : null,
                            })
                            : sourceEntries;
                        runExport({
                            entries: ranged,
                            scope: chainScopeLabel(enabledChains, activeChainIds),
                            format: exportFormat,
                            columns: Array.from(exportColumns),
                        });
                        setExportModalOpen(false);
                    }}
                />
            ) : null}

            {loadingChains.size > 0 ? (
                <div role="status" aria-label="Loading history">
                    <Skeleton.List rows={Math.max(3, loadingChains.size)} />
                </div>
            ) : null}

            {visibleEntries.length === 0 && loadingChains.size === 0 ? (
                filtersActive ? (
                    <EmptyStateNudge
                        title="No matches for the current filters"
                        body="Adjust or clear the filters to see more history."
                        actionLabel="Clear filters"
                        onAction={clearAllFilters}
                    />
                ) : (
                    <EmptyStateNudge
                        title={crossChainOnly
                            ? 'No cross-chain actions yet'
                            : 'No history yet'}
                        body={crossChainOnly
                            ? 'Make a cross-chain transfer or receive one to see entries here.'
                            : 'Once you send or receive on the selected chains, the activity feed populates.'}
                        actionLabel={!crossChainOnly && onReceive ? 'Receive' : undefined}
                        onAction={!crossChainOnly ? onReceive : undefined}
                        icon={!crossChainOnly && onReceive ? <Icon.ReceiveIcon /> : undefined}
                    />
                )
            ) : null}

            {(visibleEntries.length > 0 || historyFetchedAt) ? (
                <div className={styles.resultsHeader}>
                    {historyFetchedAt && loadingChains.size === 0 ? (
                        <StalenessLabel lastSyncedAt={historyFetchedAt} />
                    ) : <span />}
                    <button
                        type="button"
                        className={styles.exportTrigger}
                        aria-haspopup="dialog"
                        aria-expanded={exportModalOpen}
                        onClick={() => setExportModalOpen(true)}
                        disabled={entries.length === 0}
                    >
                        Export…
                    </button>
                </div>
            ) : null}

            <ul className={styles.timeline}>
                {groupedItems.map((item) => {
                    if (item.kind === 'group') {
                        const expanded = expandedGroups.has(item.key);
                        return (
                            <li key={item.key}>
                                <div className={`${styles.groupCardWrap} ${expanded ? styles.groupCardWrapExpanded : ''}`}>
                                    <GroupCard
                                        item={item}
                                        expanded={expanded}
                                        onToggle={() => toggleGroupExpanded(item.key)}
                                    />
                                    {expanded ? (
                                        <ul className={styles.groupMembers}>
                                            {item.members.map((entry) => (
                                                <EntryRow
                                                    key={entry.key}
                                                    entry={entry}
                                                    selected={selectedKey === entry.key}
                                                    showConnector={
                                                        item.subkind === 'link-pair'
                                                            ? false
                                                            : connectorByKey.has(entry.key)
                                                    }
                                                    onClick={() => onRowClick(entry)}
                                                    peerCache={peerCache}
                                                    isFull={isFull}
                                                    chainTip={chainTipByChainId[entry.chainId]}
                                                    indexerWatermark={indexerWatermarkByChainId[entry.chainId]}
                                                    walletId={walletId}
                                                    verify={actionVerifyMap[entry.key]}
                                                    showFiatInHistory={showFiatInHistory}
                                                    fiatCurrency={fiatCurrency}
                                                />
                                            ))}
                                        </ul>
                                    ) : null}
                                </div>
                            </li>
                        );
                    }
                    const entry = item.entry;
                    return (
                        <EntryRow
                            key={entry.key}
                            entry={entry}
                            selected={selectedKey === entry.key}
                            showConnector={connectorByKey.has(entry.key)}
                            onClick={() => onRowClick(entry)}
                            peerCache={peerCache}
                            isFull={isFull}
                            chainTip={chainTipByChainId[entry.chainId]}
                            indexerWatermark={indexerWatermarkByChainId[entry.chainId]}
                            walletId={walletId}
                            verify={actionVerifyMap[entry.key]}
                            showFiatInHistory={showFiatInHistory}
                            fiatCurrency={fiatCurrency}
                        />
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
export function DetailCard({ entry, peerCache, chainTip, indexerWatermark, walletId, showFiatInHistory, fiatCurrency }) {
    const { messaging, shell } = useMessaging();
    const [balancesHidden] = useBalancesHidden();
    const [activeDetailTab, setActiveDetailTab] = useState(/** @type {'status' | 'details' | 'raw'} */ ('status'));

    // Fiat equivalent, native-coin amounts only. `nativeAmountFieldOf`
    // returns null for anything that isn't unambiguously a native-coin SEND
    // (in particular, a token SEND carrying a non-native tick), so a token
    // amount never gets priced against the coin's rate - the exact bug this
    // deliberately avoids replicating (in the old numbering).
    const nativeAmount = showFiatInHistory ? nativeAmountFieldOf(entry) : null;
    const entryCoin = coinOfChainId(entry?.chainId);
    const fiatRate = useFiatRate({
        chainCoin: nativeAmount != null ? entryCoin : null,
        fiatCurrency: fiatCurrency || 'USD',
    });
    const nativeFiatValue = nativeAmount != null && fiatRate
        ? coinToFiat(nativeAmount, fiatRate)
        : null;

    // ───── More-menu / Save-as-contact state ─────
    // Contacts are fetched once so the "already a contact" check can run
    // synchronously when deciding whether to expose the Save-as-contact
    // option in the More dropdown.
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));
    const [contactsLoaded, setContactsLoaded] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [contactSaveStage, setContactSaveStage] = useState(
        /** @type {'hidden' | 'editing' | 'saving' | 'saved'} */ ('hidden'),
    );
    const [contactName, setContactName] = useState('');
    const [contactSaveError, setContactSaveError] = useState(/** @type {string | null} */ (null));
    const moreWrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));

    // ───── RBF (Speed up / Cancel) state ─────
    // Exposed through the More menu now instead of as a standalone
    // button cluster below the tabs. The status message renders inline
    // between the action row and the tabs so the user sees the result
    // of their tap without scrolling.
    const [rbfBusy, setRbfBusy] = useState(/** @type {'speedup' | 'cancel' | null} */ (null));
    const [rbfError, setRbfError] = useState(/** @type {string | null} */ (null));
    const [rbfDone, setRbfDone] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.listContacts()
            .then((rows) => {
                if (cancelled) return;
                setContacts(Array.isArray(rows) ? rows : []);
                setContactsLoaded(true);
            })
            .catch(() => { if (!cancelled) setContactsLoaded(true); });
        return () => { cancelled = true; };
    }, [messaging]);

    useEffect(() => {
        if (!moreOpen) return undefined;
        const onClick = (e) => {
            if (moreWrapRef.current?.contains(e.target)) return;
            setMoreOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [moreOpen]);

    // M2.3: a pending entry has no block, so the LINK pairing it would
    // render has not been indexed either. Suppressed outright rather
    // than left to render an empty peer block that reads like a failed
    // fetch. It comes back on its own when the confirmed entry replaces
    // this one, because that entry carries the link record.
    const isLinked = Boolean(entry.link) && Number(entry.blockIndex) > 0;
    const peerKey = entry.link?.peerChainId && entry.link?.peerActionIndex
        ? peerCacheKey(entry.link.peerChainId, entry.link.peerActionIndex)
        : null;
    const peer = peerKey ? peerCache[peerKey] : null;
    const replaceable = isEntryReplaceable(entry);
    // §24.6 / Cluster Y FOLLOWUP 4: desktop-only "Open in new window"
    // affordance for pending (mempool-only) entries. The detached
    // window opens directly on this row via the History `initialFocus`
    // prop and keeps its own auto-lock + last-view memory because the
    // shared MessageHost stays singleton across windows. Surfaces on
    // desktop only; extension popup + web SPA have no equivalent
    // multi-window primitive.
    const isPending = !entry.blockIndex;
    const detachAvailable = shell === 'desktop'
        && isPending
        && typeof globalThis.xchainWalletWindow?.openDetached === 'function';

    const detailRows = basicDetailRows(entry, chainTip, nativeAmount, nativeFiatValue, balancesHidden);
    const explorerButtons = explorerLinksFor(entry);

    const fullRows = fullDetailRows(entry, balancesHidden);
    // Redact entry + peer raw payloads before stringifying. Cheap walk;
    // returns the same shape so the JSON pretty-printer indents identically.
    const rawForDisplay = balancesHidden ? redactAmountFields(entry.raw) : entry.raw;
    const detailTabs = [
        { id: 'status',  label: 'Status'  },
        { id: 'details', label: 'Details' },
        { id: 'raw',     label: 'Raw'     },
    ];

    // Compute Save-as-contact saveability + assemble the More menu so
    // the rightmost button on the explorer row reads as a single
    // entry-point for follow-up actions instead of being buried below
    // the tab panels.
    const contactPeer = peerAddressOfEntry(entry);
    const contactPeerCoin = coinOfChainId(entry?.chainId);
    const contactPeerIsSelf = Boolean(entry?.address && contactPeer === entry.address);
    const contactAlreadySaved = Boolean(contactPeer && contacts.some((c) =>
        Array.isArray(c?.entries) && c.entries.some((e) => e?.address === contactPeer),
    ));
    const canSaveContact = contactsLoaded
        && Boolean(contactPeer)
        && !contactPeerIsSelf
        && !contactAlreadySaved
        && Boolean(contactPeerCoin)
        && contactSaveStage !== 'saved';
    async function runRbf(strategy) {
        if (rbfBusy) return;
        setMoreOpen(false);
        setRbfBusy(strategy);
        setRbfError(null);
        setRbfDone(null);
        try {
            const res = await replaceFromHistoryEntry({ messaging, entry, strategy });
            setRbfDone(`Replacement broadcast: ${res?.replacementTxHash || 'pending'}`);
        } catch (err) {
            if (err instanceof RbfNotSupportedError || err instanceof RbfInvalidEntryError) {
                setRbfError(err.message);
            } else {
                setRbfError(err?.message || 'Replacement failed.');
            }
        } finally {
            setRbfBusy(null);
        }
    }

    const moreOptions = [];
    if (canSaveContact) {
        moreOptions.push({
            id: 'save-contact',
            label: 'Save as contact',
            icon: <Icon.UsersIcon />,
            onClick: () => {
                setMoreOpen(false);
                setContactSaveStage('editing');
                setContactName('');
                setContactSaveError(null);
            },
        });
    }
    // A transaction we have already replaced still satisfies the field
    // contract `isEntryReplaceable` checks (it has a hash, no block, and
    // an allowlisted action), so the offer has to be withdrawn here.
    // Replacing a replacement bumps the fee on a transaction the network
    // has already dropped, spends a fee, and moves nothing.
    if (replaceable.ok && !entry.pending?.replaced) {
        moreOptions.push({
            id: 'rbf-speedup',
            label: rbfBusy === 'speedup' ? 'Speeding up…' : 'Speed up',
            icon: <Icon.ForwardIcon />,
            disabled: rbfBusy !== null,
            onClick: () => runRbf('speedup'),
        });
        moreOptions.push({
            id: 'rbf-cancel',
            label: rbfBusy === 'cancel' ? 'Cancelling…' : 'Cancel transaction',
            icon: <Icon.XIcon />,
            disabled: rbfBusy !== null,
            onClick: () => runRbf('cancel'),
        });
    }
    // Universal option: every entry can have a sharable link copied,
    // so the menu is never empty (DeFi rows, in particular, hit this
    // path since they don't have a peer or replaceable state).
    const shareUrl = xchainActionUrl(entry?.chainId, entry?.actionIndex);
    if (shareUrl) {
        moreOptions.push({
            id: 'copy-link',
            label: 'Copy action link',
            icon: <Icon.CopyIcon />,
            onClick: () => {
                setMoreOpen(false);
                if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(shareUrl).catch(() => { /* no-op */ });
                }
            },
        });
    }

    async function handleSaveContact(event) {
        event.preventDefault();
        const trimmed = contactName.trim();
        if (!trimmed) {
            setContactSaveError('Name is required.');
            return;
        }
        setContactSaveStage('saving');
        setContactSaveError(null);
        try {
            await messaging.saveContact({
                input: {
                    name: trimmed,
                    notes: '',
                    entries: [{ chain: contactPeerCoin, address: contactPeer, label: '' }],
                },
            });
            setContactSaveStage('saved');
        } catch (err) {
            setContactSaveError(err?.message || 'Save failed.');
            setContactSaveStage('editing');
        }
    }

    return (
        <div className={styles.detailContainer} role="region" aria-label="Action detail">
            {/* M2.3: the pending branch. First, because on a pending
                entry the thing the user came to find out is what is
                happening to it, and because the warning states have to
                be impossible to scroll past. Disappears of its own
                accord when the confirmed entry replaces this one. */}
            {isPending ? (
                <PendingDetailPanel entry={entry} balancesHidden={balancesHidden} />
            ) : null}

            {/* Basic details hero: concise summary at the top of the
                page. Flush variant: zero card padding so the table's
                row-divider lines run all the way to the card edges,
                with horizontal cell padding restoring the inner gutter
                so text doesn't crowd the border. */}
            <section className={`${styles.detailSection} ${styles.detailSectionFlush}`}>
                <table className={styles.detailsTable}>
                    <tbody>
                        {detailRows.map(([label, value]) => (
                            <tr key={label}>
                                <th scope="row">{label}</th>
                                <td>{value}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

            {/* Action row: explorer links followed by a "More" button
                that drops down a list of follow-up actions (e.g. Save
                as contact, Speed up, Cancel). The More button always
                renders so users get a consistent place to look across
                every action type; when no actions apply, the menu
                surfaces a placeholder message instead.

                The row also renders with no explorer links at all, which
                is the normal case for a pending entry: it has no action
                index for the XChain link and regtest has no third-party
                explorer, and gating the whole row on those links took
                Speed up and Cancel away from exactly the transactions
                they exist for. */}
            {explorerButtons.length > 0 || moreOptions.length > 0 ? (
                <div className={styles.detailActions} role="group" aria-label="Action options">
                    {explorerButtons.map((link) => (
                        <a
                            key={link.id}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.detailAction}
                        >
                            {link.iconImg ? (
                                <img
                                    src={link.iconImg}
                                    alt=""
                                    aria-hidden="true"
                                    className={styles.detailActionFavicon}
                                />
                            ) : (
                                <span className={styles.detailActionIcon} aria-hidden="true">{link.icon}</span>
                            )}
                            <span>{link.label}</span>
                        </a>
                    ))}
                    <div className={styles.detailActionMoreWrap} ref={moreWrapRef}>
                        <button
                            type="button"
                            className={styles.detailAction}
                            aria-haspopup="menu"
                            aria-expanded={moreOpen}
                            onClick={() => setMoreOpen((o) => !o)}
                        >
                            <span className={styles.detailActionIcon} aria-hidden="true"><Icon.MoreIcon /></span>
                            <span>More</span>
                        </button>
                        {moreOpen ? (
                            <div className={styles.moreMenu} role="menu">
                                {moreOptions.length > 0 ? (
                                    moreOptions.map((opt) => (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            role="menuitem"
                                            className={styles.moreMenuItem}
                                            onClick={opt.onClick}
                                            disabled={Boolean(opt.disabled)}
                                        >
                                            {opt.icon ? (
                                                <span className={styles.moreMenuItemIcon} aria-hidden="true">
                                                    {opt.icon}
                                                </span>
                                            ) : null}
                                            <span>{opt.label}</span>
                                        </button>
                                    ))
                                ) : (
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className={styles.moreMenuItem}
                                        disabled
                                    >
                                        <span>No additional actions</span>
                                    </button>
                                )}
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            {/* RBF status: surfaces the outcome of Speed up / Cancel
                picked from the More menu. Sits between the action row
                and the tab strip so the user sees the result without
                scrolling, mirroring the inline save-contact form. */}
            {rbfError ? (
                <StatusMessage variant="error" className={styles.rbfError}>{rbfError}</StatusMessage>
            ) : null}
            {rbfDone ? (
                <p className={styles.rbfDone} role="status">{rbfDone}</p>
            ) : null}

            {/* Inline Save-as-contact form. Shown when the user picks
                "Save as contact" from the More menu, sits between the
                action buttons and the tab strip so the user doesn't
                lose the page context the way the bottom-of-card prompt
                did. */}
            {contactSaveStage === 'editing' || contactSaveStage === 'saving' ? (
                <form className={styles.saveContactForm} onSubmit={handleSaveContact}>
                    <label className={styles.saveContactLabel}>
                        Save {shortenAddress(contactPeer || '')} as
                        <input
                            type="text"
                            className={styles.saveContactInput}
                            value={contactName}
                            onChange={(e) => setContactName(e.target.value)}
                            autoFocus
                            maxLength={80}
                            placeholder="Contact name"
                        />
                    </label>
                    {contactSaveError ? (
                        <StatusMessage variant="error" className={styles.saveContactError}>{contactSaveError}</StatusMessage>
                    ) : null}
                    <div className={styles.saveContactActions}>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setContactSaveStage('hidden');
                                setContactName('');
                                setContactSaveError(null);
                            }}
                            disabled={contactSaveStage === 'saving'}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            size="sm"
                            loading={contactSaveStage === 'saving'}
                        >
                            Save
                        </Button>
                    </div>
                </form>
            ) : null}

            {/* Tab strip: matches Home's HomeTabs visual rhythm. */}
            <div className={styles.detailTabs} role="tablist" aria-label="Action detail view">
                {detailTabs.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={activeDetailTab === t.id ? 'true' : 'false'}
                        className={`${styles.detailTab} ${activeDetailTab === t.id ? styles.detailTabActive : ''}`}
                        onClick={() => setActiveDetailTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <section
                className={`${styles.detailSection} ${activeDetailTab === 'details' ? styles.detailSectionFlush : ''}`}
                role="tabpanel"
            >
                {/* Details tab: full field dump (every value associated
                    with the action), as opposed to the curated hero
                    table at the top. */}
                {activeDetailTab === 'details' ? (
                    <table className={styles.detailsTable}>
                        <tbody>
                            {fullRows.map(([label, value]) => (
                                <tr key={label}>
                                    <th scope="row">{label}</th>
                                    <td>{value}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : null}

                {activeDetailTab === 'status' ? (
                    <TxStatusTimeline entry={entry} chainTip={chainTip} indexerWatermark={indexerWatermark} />
                ) : null}

                {activeDetailTab === 'raw' ? (
                    <>
                        <div className={styles.rawJsonWrap}>
                            <span className={styles.rawJsonCopy}>
                                <CopyIconButton
                                    value={decodeActionToText(rawForDisplay)}
                                    label="Copy raw JSON"
                                />
                            </span>
                            <pre className={styles.detailDecoded}>
                                {decodeActionToText(rawForDisplay)}
                            </pre>
                        </div>
                        {isLinked ? (
                            <div className={styles.detailPeerBlock}>
                                <h4 className={styles.detailSectionHeading}>
                                    Peer · {entry.link.peerCoinTicker} #{entry.link.peerActionIndex}
                                </h4>
                                {peer?.loading ? (
                                    <p className={styles.empty}>Loading the linked transaction…</p>
                                ) : peer?.error ? (
                                    <p className={styles.error}>Couldn't load peer: {peer.error}</p>
                                ) : peer?.action ? (
                                    <div className={styles.rawJsonWrap}>
                                        <span className={styles.rawJsonCopy}>
                                            <CopyIconButton
                                                value={decodeActionToText(balancesHidden ? redactAmountFields(peer.action) : peer.action)}
                                                label="Copy peer raw JSON"
                                            />
                                        </span>
                                        <pre className={styles.detailDecoded}>
                                            {decodeActionToText(balancesHidden ? redactAmountFields(peer.action) : peer.action)}
                                        </pre>
                                    </div>
                                ) : (
                                    <p className={styles.empty}>
                                        Peer chain not bundled in this wallet; open the
                                        block explorer for {entry.link.peerCoinTicker} to
                                        view {entry.link.peerCoinTicker} #{entry.link.peerActionIndex}.
                                    </p>
                                )}
                            </div>
                        ) : null}
                    </>
                ) : null}
            </section>

            {/* Interactive widgets appended below the static sections.
                Save-as-contact and Speed up / Cancel moved up to the
                More button in the action row; recipient bulk-save
                stays here because it's a per-row affordance for
                DIVIDEND / AIRDROP entries with its own UI. */}
            <RecipientsBlock entry={entry} />
            {detachAvailable ? (
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                        globalThis.xchainWalletWindow.openDetached({
                            initialView: 'history',
                            initialContext: {
                                walletId,
                                chainId: entry.chainId,
                                actionIndex: entry.actionIndex,
                                txHash: entry.txHash,
                            },
                        }).catch(() => { /* main returns ok:false on failure */ });
                    }}
                >
                    Open in new window
                </Button>
            ) : null}
        </div>
    );
}

/**
 * M2.3 pending branch of the detail card. Everything a user can be told
 * honestly about a transaction that has been sent and not yet indexed:
 * which of the five states it is in, when the network first reported it,
 * what it is about to do, and the one sentence that has to survive every
 * rewrite of this panel, that nothing has validated it yet.
 *
 * Deliberately absent: any SPV or LINK section. Both need an indexed
 * action, and rendering them empty reads as a fetch that failed rather
 * than as a stage that has not happened.
 *
 * @param {{ entry: any, balancesHidden?: boolean }} props
 */
function PendingDetailPanel({ entry, balancesHidden = false }) {
    const state = pendingStateOf(entry);
    const copy = state ? PENDING_COPY[state] : null;
    const warning = state != null && PENDING_WARNING_STATES.has(state);
    const meta = entry?.pending || null;
    const desc = describePendingAction(entry);
    const amountOf = (value) => (balancesHidden ? '•••••' : value);

    return (
        <section
            className={`${styles.pendingPanel} ${warning ? styles.pendingPanelWarning : ''}`}
            aria-label={t('pending.detail.sectionLabel')}
        >
            {copy ? (
                <>
                    <p className={styles.pendingHeadline}>{t(copy.headline)}</p>
                    <p className={styles.pendingHelp}>{t(copy.help)}</p>
                </>
            ) : null}
            {/* The honesty line (§7). A mempool sighting is not
                acceptance: the indexer can still reject this action when
                the block lands, so it renders in every pending state. */}
            <p className={styles.pendingNotValidated}>{t('pending.detail.notValidated')}</p>

            {meta?.firstSeenMs ? (
                <p className={styles.pendingTiming}>
                    {t('pending.detail.firstSeen', { when: formatRelativeTime(meta.firstSeenMs) })}
                </p>
            ) : null}
            {meta?.broadcastAtMs ? (
                <p className={styles.pendingTiming}>
                    {t('pending.detail.broadcastAt', { when: formatRelativeTime(meta.broadcastAtMs) })}
                </p>
            ) : null}
            {meta?.replaced && meta.replacementTxHash ? (
                <p className={styles.pendingTiming}>
                    {t('pending.detail.replacementTx', {
                        txHash: shortenAddress(meta.replacementTxHash),
                    })}
                </p>
            ) : null}

            <h4 className={styles.detailSectionHeading}>{t('pending.detail.decodedHeading')}</h4>
            {desc.kind === 'send' || desc.kind === 'local' ? (
                <ul className={styles.pendingOutputs}>
                    {desc.outputs.map((o, i) => (
                        <li key={`${o.destination}:${i}`}>
                            {t('pending.detail.sendOutput', {
                                amount: amountOf(o.amount),
                                tick: o.tick,
                                destination: o.destination,
                            })}
                            {o.memo ? (
                                <span className={styles.pendingMemo}>
                                    {' '}{t('pending.detail.memo', { memo: o.memo })}
                                </span>
                            ) : null}
                        </li>
                    ))}
                </ul>
            ) : null}
            {desc.kind === 'local' ? (
                <p className={styles.pendingHelp}>{t('pending.detail.localRecordNote')}</p>
            ) : null}
            {desc.kind === 'segments' ? (
                <>
                    <p className={styles.pendingHelp}>
                        {t('pending.detail.undecodable', { action: desc.action })}
                    </p>
                    <ul className={styles.pendingSegments}>
                        {desc.segments.map((seg, i) => (
                            <li key={`${i}:${seg}`}><code>{seg}</code></li>
                        ))}
                    </ul>
                </>
            ) : null}
            {desc.kind === 'none' ? (
                <p className={styles.pendingHelp}>{t('pending.detail.noData')}</p>
            ) : null}
        </section>
    );
}

function capitalize(s) {
    if (typeof s !== 'string' || s.length === 0) return '';
    return s[0].toUpperCase() + s.slice(1);
}

/**
 * Build the rows shown in the "Action details" table at the top of
 * ActionDetail. Each tuple is `[label, value]`. Empty / missing fields
 * are skipped so the table only shows what's actually populated.
 */
function basicDetailRows(entry, chainTip, nativeAmount, nativeFiatValue, balancesHidden) {
    if (!entry) return [];
    const rows = [];

    // Action: just the colored bubble. The action number now lives
    // on its own "Index" row below Block.
    rows.push(['Action', (
        <span className={styles.actionTag}>{entry.action ? actionDisplayLabel(entry.action) : '-'}</span>
    )]);

    // Fiat-display toggle. Only rendered when the caller resolved a
    // native-coin amount for this entry (see nativeAmountFieldOf) - token
    // amounts never reach here, so there's no coin-rate-on-token bug to
    // replicate.
    if (nativeAmount != null) {
        rows.push(['Amount', (
            <span>
                {balancesHidden ? '•••••' : formatNumberWithCommas(nativeAmount)}
                {nativeFiatValue != null ? (
                    <span className={styles.rowRelativeTime}>
                        {' '}(≈ {balancesHidden ? '•••' : formatFiat(nativeFiatValue)})
                    </span>
                ) : null}
            </span>
        )]);
    }

    // Status: second, so success / failure is visible immediately.
    const status = classifyEntryStatus(entry);
    const statusLabel = status === 'confirmed' ? 'Confirmed'
        : status === 'failed' ? 'Failed'
        : 'Pending';
    const statusColorClass = status === 'confirmed' ? styles.statusPillSuccess
        : status === 'failed' ? styles.statusPillError
        : styles.statusPillPending;
    rows.push(['Status', (
        <span className={`${styles.statusBubble} ${statusColorClass}`}>{statusLabel}</span>
    )]);

    // Network: coin icon + full chain name (e.g. "Dogecoin Mainnet").
    if (entry.chainId) {
        const [coin = '', network = 'mainnet'] = String(entry.chainId).split('-');
        const label = `${capitalize(coin)} ${capitalize(network)}`.trim();
        rows.push(['Network', (
            <span className={styles.copyableValue}>
                <img
                    src={branding.chainIconSmallUrl(entry.chainId)}
                    alt=""
                    aria-hidden="true"
                    className={styles.rowChainIcon}
                    width={16}
                    height={16}
                />
                <span>{label}</span>
            </span>
        )]);
    }
    // Hero stays minimal: Action, Status, Network, Time only. Block,
    // Index, Tx hash, Source, Destination, Amount, Memo, and every
    // per-action field live in the Details tab below.
    if (entry.timestamp) rows.push(['Time', formatRelativeTime(entry.timestamp) || formatTimestamp(entry.timestamp)]);
    return rows;
}

/**
 * Inline value + small copy-icon button. Used in the ActionDetail
 * table for fields a user typically needs to paste somewhere else
 * (action_index, tx_hash, source / destination addresses).
 */
function CopyableValue({ display, fullValue, ariaLabel }) {
    return (
        <span className={styles.copyableValue}>
            <CopyIconButton value={fullValue} label={ariaLabel} />
            <span className={styles.copyableText}>{display}</span>
        </span>
    );
}

function CopyIconButton({ value, label = 'Copy to clipboard' }) {
    const [copied, setCopied] = useState(false);
    const handleClick = async (event) => {
        event.stopPropagation();
        const text = String(value ?? '');
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else if (typeof document !== 'undefined') {
                // Fallback for non-secure contexts; hidden textarea + execCommand.
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard may be unavailable; swallow silently */ }
    };
    return (
        <button
            type="button"
            onClick={handleClick}
            className={styles.copyIconButton}
            aria-label={copied ? 'Copied' : label}
            title={copied ? 'Copied!' : label}
        >
            {copied ? <Icon.CheckIcon /> : <Icon.CopyIcon />}
        </button>
    );
}

/**
 * Comprehensive field-by-field dump shown in the Details tab. Lists
 * every entry-level identifier plus every key in `entry.raw`, in a
 * stable order so the user can scan all values associated with the
 * transaction in one place. The curated hero table at the top of the
 * page covers the most-relevant fields; this is the long-form view.
 */
function fullDetailRows(entry, balancesHidden = false) {
    if (!entry) return [];
    const rows = [];
    const raw = entry.raw || {};

    if (entry.action) rows.push(['action', entry.action]);
    if (entry.actionIndex) {
        rows.push(['index', (
            <CopyableValue
                display={Number(entry.actionIndex).toLocaleString('en-US')}
                fullValue={String(entry.actionIndex)}
                ariaLabel="Copy index"
            />
        )]);
    }
    // Split chainId (e.g. 'bitcoin-regtest') into two rows so the
    // chain family and network kind read separately.
    if (entry.chainId) {
        const [coin = '', network = 'mainnet'] = String(entry.chainId).split('-');
        if (coin) rows.push(['chain', coin]);
        rows.push(['network', network]);
    }
    if (entry.blockIndex) rows.push(['block_index', Number(entry.blockIndex).toLocaleString('en-US')]);
    else if (entry.blockIndex === 0) rows.push(['block_index', 'pending']);
    if (entry.timestamp) {
        rows.push(['time', formatRelativeTime(entry.timestamp) || formatTimestamp(entry.timestamp)]);
    }
    if (entry.txHash) {
        rows.push(['tx_hash', (
            <CopyableValue
                display={shortenAddress(entry.txHash)}
                fullValue={entry.txHash}
                ariaLabel="Copy tx hash"
            />
        )]);
    }
    if (entry.source) {
        rows.push(['source', (
            <CopyableValue
                display={shortenAddress(entry.source)}
                fullValue={entry.source}
                ariaLabel="Copy source address"
            />
        )]);
    }
    if (entry.address) {
        rows.push(['address', (
            <CopyableValue
                display={shortenAddress(entry.address)}
                fullValue={entry.address}
                ariaLabel="Copy address"
            />
        )]);
    }

    // Every other raw key, sorted alphabetically. Skip the
    // entry-level fields we already surfaced above so we don't print
    // the same datum twice (matched by snake_case and camelCase).
    // `params` is also skipped because the synth fixtures nest the
    // same fields there as at the top level; would render twice.
    const skipKeys = new Set([
        'action', 'ACTION',
        'action_index', 'actionIndex', 'ACTION_INDEX',
        'chain_id', 'chainId', 'CHAIN_ID',
        'block_index', 'blockIndex', 'BLOCK_INDEX',
        'timestamp', 'block_time', 'BLOCK_TIME',
        'tx_hash', 'txHash', 'TX_HASH',
        'source', 'SOURCE',
        'address', 'ADDRESS',
        'params', 'PARAMS',
    ]);
    const rawKeys = Object.keys(raw).sort();
    for (const k of rawKeys) {
        if (skipKeys.has(k)) continue;
        const v = raw[k];
        let display;
        if (balancesHidden && AMOUNT_KEY_RE.test(k)) {
            display = '•••••';
        } else if (v === null || v === undefined) display = '-';
        else if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+$/.test(v))) {
            display = formatNumberWithCommas(v);
        }
        else if (typeof v === 'object') {
            try { display = JSON.stringify(v); } catch { display = String(v); }
        } else {
            display = String(v);
        }
        rows.push([k, display]);
    }

    return rows;
}

// Thousands-separated formatting that handles strings of digits (which
// is how the explorer / synth data delivers large integer amounts) as
// well as JS numbers. Uses BigInt for pure-integer strings so values
// past Number.MAX_SAFE_INTEGER still round-trip correctly.
function formatNumberWithCommas(value) {
    if (value === null || value === undefined) return '';
    const s = String(value).trim();
    if (!s) return '';
    if (/^-?\d+$/.test(s)) {
        try { return BigInt(s).toLocaleString('en-US'); } catch { /* fall through */ }
    }
    const n = Number(s);
    if (Number.isFinite(n)) return n.toLocaleString('en-US');
    return s;
}

/**
 * Map a wallet chainId ("bitcoin-mainnet" / "bitcoin-regtest" / …)
 * to the ticker code XChain Explorer uses in its URL path:
 *
 *     /{COIN}/action/{action_index}
 *
 * where COIN is the network-prefixed ticker:
 *   - mainnet   → BTC,  LTC,  DOGE
 *   - testnet   → TBTC, TLTC, TDOGE
 *   - regtest   → RBTC, RLTC, RDOGE
 *
 * Returns null when the chainId is malformed or the coin family isn't
 * in the XChain explorer's recognized list; the caller skips the
 * XChain button in that case.
 */
function xchainCoinForChainId(chainId) {
    if (typeof chainId !== 'string' || !chainId.includes('-')) return null;
    const [coin, network = 'mainnet'] = chainId.split('-');
    const ticker = ({ bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' })[coin];
    if (!ticker) return null;
    if (network === 'mainnet') return ticker;
    if (network === 'testnet') return `T${ticker}`;
    if (network === 'regtest') return `R${ticker}`;
    return null;
}

/**
 * Build a full XChain explorer action URL from the chain descriptor.
 * The explorer base URL is bare on EVERY network (see the note on
 * `explorerCoinCode` in registry/coinTicker.js), so the coin segment is
 * always ours to append: `<base>[:port]/<COIN>/action/<index>`. Only the
 * port differs, and a standard 80/443 is left implicit.
 * Returns null when the descriptor or coin ticker is unavailable.
 */
function xchainActionUrl(chainId, actionIndex) {
    const desc = chainRegistry.get(chainId);
    const ex = desc?.explorer;
    if (!ex || !actionIndex) return null;
    const coin = xchainCoinForChainId(chainId);
    if (!coin) return null;
    const standardPort = ex.defaultPort === 80 || ex.defaultPort === 443;
    const origin = standardPort ? ex.defaultUrl : `${ex.defaultUrl}:${ex.defaultPort}`;
    return `${origin}/${coin}/action/${actionIndex}`;
}

/**
 * Per-chain block-explorer link list. Demo entries (synthesized
 * tx hashes) get no links since they wouldn't resolve. Always
 * surfaces the XChain explorer when an action_index is available.
 */
function explorerLinksFor(entry) {
    const links = [];
    if (!entry) return links;
    const txHash = entry.txHash;
    const [coin = '', network = 'mainnet'] = String(entry.chainId || '').split('-');

    // XChain explorer first: addresses ACTIONs by `coin/action/index`
    // where `coin` is the XChain ticker code for the (chain, network)
    // pair: BTC/LTC/DOGE for mainnet, T-prefix for testnet, R-prefix
    // for regtest. Works for demo / regtest data too. Naked favicon
    // (no circular icon-wrap), just the chain-link glyph above the
    // label.
    if (entry.actionIndex) {
        const xchainUrl = xchainActionUrl(entry.chainId, entry.actionIndex);
        if (xchainUrl) {
            links.push({
                id: 'xchain',
                label: 'XChain',
                iconImg: branding.faviconUrl(),
                url: xchainUrl,
            });
        }
    }

    // External chain explorers: only mainnet and testnet have
    // working third-party coverage. Regtest is local-only; suppress
    // external links so they don't render mainnet URLs that 404.
    if (!txHash) return links;
    if (network !== 'mainnet' && network !== 'testnet') return links;

    if (coin === 'bitcoin') {
        // Mempool.space serves Bitcoin testnet under `/testnet4/`
        // (current testnet variant). Blockstream.info still indexes
        // the legacy `/testnet/` (testnet3) endpoint, so testnet
        // links there may not resolve for testnet4 hashes; kept
        // anyway as a second affordance.
        const mempoolPath = network === 'testnet' ? 'testnet4/' : '';
        const blockstreamPath = network === 'testnet' ? 'testnet/' : '';
        links.push({
            id: 'mempool',
            label: 'Mempool',
            iconImg: 'https://mempool.space/resources/favicons/favicon.ico',
            url: `https://mempool.space/${mempoolPath}tx/${txHash}`,
        });
        links.push({
            id: 'blockstream',
            label: 'Blockstream',
            iconImg: 'https://blockstream.info/favicon.ico',
            url: `https://blockstream.info/${blockstreamPath}tx/${txHash}`,
        });
    } else if (coin === 'litecoin') {
        // LitecoinSpace mirrors mempool.space's URL scheme (it's a
        // fork); mainnet has no prefix, testnet is `/testnet/`.
        // Blockchair covers mainnet only.
        const litecoinSpacePath = network === 'testnet' ? 'testnet/' : '';
        links.push({
            id: 'litecoinspace',
            label: 'LitecoinSpace',
            iconImg: 'https://litecoinspace.org/favicon.ico',
            url: `https://litecoinspace.org/${litecoinSpacePath}tx/${txHash}`,
        });
        if (network === 'mainnet') {
            links.push({
                id: 'blockchair',
                label: 'Blockchair',
                iconImg: 'https://blockchair.com/favicon.ico',
                url: `https://blockchair.com/litecoin/transaction/${txHash}`,
            });
        }
    } else if (coin === 'dogecoin') {
        // No reliable third-party DOGE testnet explorer at time of
        // writing; show external links on mainnet only.
        if (network === 'mainnet') {
            links.push({
                id: 'blockchair',
                label: 'Blockchair',
                iconImg: 'https://blockchair.com/favicon.ico',
                url: `https://blockchair.com/dogecoin/transaction/${txHash}`,
            });
            links.push({
                id: 'blockcypher',
                label: 'BlockCypher',
                iconImg: 'https://www.blockcypher.com/tokens/favicon/favicon.ico',
                url: `https://live.blockcypher.com/doge/tx/${txHash}`,
            });
        }
    }
    return links;
}

/**
 * §31.4 / Cluster O FOLLOWUP 2: recipient list for DIVIDEND / AIRDROP
 * rows. The recipient set is derived (holders of TICK for DIVIDEND, the
 * referenced LIST's ITEM array for AIRDROP), so the user has to opt in
 * to the fetch by clicking Show recipients. Once loaded, a "Save N as
 * one contact" affordance bulk-saves the addresses into a single
 * Contact record with N entries; the address-book grouping that
 * matches the data model best (one DIVIDEND / AIRDROP = one address
 * book).
 *
 * @param {{ entry: any }} props
 */
function RecipientsBlock({ entry }) {
    const { messaging } = useMessaging();
    const action = String(entry?.action || '').toUpperCase();
    const isDividend = action === 'DIVIDEND';
    const isAirdrop = action === 'AIRDROP';
    const supported = isDividend || isAirdrop;

    const [stage, setStage] = useState(/** @type {'idle' | 'loading' | 'loaded' | 'saving' | 'saved'} */ ('idle'));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [recipients, setRecipients] = useState(/** @type {object[]} */ ([]));
    const [snapshotNote, setSnapshotNote] = useState(/** @type {string | null} */ (null));
    const [name, setName] = useState('');

    if (!supported) return null;
    if (typeof messaging?.getDividendRecipients !== 'function'
        && typeof messaging?.getAirdropRecipients !== 'function') {
        // No host wiring; degrade silently.
        return null;
    }

    const coin = coinOfChainId(entry?.chainId);
    if (!coin) return null;

    const tick = String(entry?.raw?.TICK || entry?.raw?.tick || '').trim();
    const listIdx = String(entry?.raw?.LIST_ACTION_INDEX || entry?.raw?.list_action_index || '').trim();
    const defaultName = isDividend
        ? `${actionDisplayLabel('DIVIDEND')} #${entry?.actionIndex || '?'}${tick ? ` (${tick})` : ''} holders`
        : `${actionDisplayLabel('AIRDROP')} #${entry?.actionIndex || '?'}${listIdx ? ` (list #${listIdx})` : ''} recipients`;

    async function load() {
        setStage('loading');
        setError(null);
        try {
            const r = isDividend
                ? await messaging.getDividendRecipients({
                    chainId: entry.chainId,
                    actionIndex: String(entry.actionIndex),
                    tick: tick || undefined,
                })
                : await messaging.getAirdropRecipients({
                    chainId: entry.chainId,
                    actionIndex: String(entry.actionIndex),
                    listActionIndex: listIdx || undefined,
                });
            setRecipients(Array.isArray(r?.recipients) ? r.recipients : []);
            setSnapshotNote(typeof r?.snapshotNote === 'string' ? r.snapshotNote : null);
            setName(defaultName);
            setStage('loaded');
        } catch (err) {
            setError(err?.message || 'Failed to load recipients.');
            setStage('idle');
        }
    }

    async function handleSaveAll() {
        if (recipients.length === 0) return;
        if (!name.trim()) {
            setError('Name is required.');
            return;
        }
        setStage('saving');
        setError(null);
        try {
            await messaging.saveContact({
                input: {
                    name: name.trim(),
                    notes: '',
                    entries: recipients
                        .map((r) => r?.address)
                        .filter((a) => typeof a === 'string' && a.length > 0)
                        .map((address) => ({ chain: coin, address, label: '' })),
                },
            });
            setStage('saved');
        } catch (err) {
            setError(err?.message || 'Save failed.');
            setStage('loaded');
        }
    }

    const blockStyle = {
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--xc-space-1)',
        marginTop: 'var(--xc-space-2)',
    };
    const headingStyle = { color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-xs)' };

    if (stage === 'idle') {
        return (
            <div style={blockStyle}>
                <Button type="button" variant="secondary" size="sm" onClick={load}>
                    {isDividend ? 'Show holders' : 'Show recipients'}
                </Button>
                {error ? <span style={{ color: 'var(--xc-error, #c33)', fontSize: 'var(--xc-text-xs)' }} role="alert">{error}</span> : null}
            </div>
        );
    }
    if (stage === 'loading') {
        return (
            <div style={blockStyle}>
                <span style={headingStyle}>{isDividend ? 'Loading holders…' : 'Loading recipients…'}</span>
            </div>
        );
    }
    if (stage === 'saved') {
        return (
            <div style={blockStyle}>
                <span style={headingStyle} role="status">
                    Saved {recipients.length} address{recipients.length === 1 ? '' : 'es'} as a single contact "{name.trim()}".
                </span>
            </div>
        );
    }

    // stage === 'loaded' or 'saving'
    return (
        <div style={blockStyle}>
            <span style={headingStyle}>
                {recipients.length} {isDividend ? 'holder' : 'recipient'}{recipients.length === 1 ? '' : 's'}
            </span>
            {snapshotNote ? <span style={headingStyle}>{snapshotNote}</span> : null}
            {recipients.length > 0 ? (
                <div style={{
                    maxHeight: 160,
                    overflowY: 'auto',
                    border: '1px solid var(--xc-border)',
                    borderRadius: 'var(--xc-radius-sm)',
                    padding: 'var(--xc-space-1)',
                    fontFamily: 'monospace',
                    fontSize: 'var(--xc-text-xs)',
                    color: 'var(--xc-text)',
                }}>
                    {recipients.slice(0, 200).map((r, i) => (
                        <div key={`${r.address}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--xc-space-1)' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.address}</span>
                            {r.balance !== undefined ? <span style={{ color: 'var(--xc-text-muted)' }}>{r.balance}</span> : null}
                        </div>
                    ))}
                    {recipients.length > 200 ? (
                        <div style={{ color: 'var(--xc-text-muted)', marginTop: 'var(--xc-space-1)' }}>
                            … and {recipients.length - 200} more not shown
                        </div>
                    ) : null}
                </div>
            ) : (
                <span style={headingStyle}>No {isDividend ? 'holders' : 'recipients'} found.</span>
            )}
            {recipients.length > 0 ? (
                <div style={{ display: 'flex', gap: 'var(--xc-space-1)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={120}
                        aria-label="Contact name"
                        disabled={stage === 'saving'}
                        style={{
                            flex: 1,
                            minWidth: 200,
                            background: 'var(--xc-bg)',
                            color: 'var(--xc-text)',
                            border: '1px solid var(--xc-border)',
                            borderRadius: 'var(--xc-radius-sm)',
                            padding: 'var(--xc-space-1) var(--xc-space-2)',
                            fontSize: 'var(--xc-text-sm)',
                        }}
                    />
                    <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        loading={stage === 'saving'}
                        onClick={handleSaveAll}
                    >
                        Save {recipients.length} as one contact
                    </Button>
                </div>
            ) : null}
            {error ? (
                <span style={{ color: 'var(--xc-error, #c33)', fontSize: 'var(--xc-text-xs)' }} role="alert">{error}</span>
            ) : null}
        </div>
    );
}

/**
 * Pull the peer-side address out of a history entry. Cluster O
 * FOLLOWUP 2: extended to action-kind-aware extractors so MESSAGE
 * incoming rows and ORDER_MATCH fill rows surface a usable counterparty
 * (the v0.207.0 implementation only handled the SEND case cleanly;
 * RECEIVE / MESSAGE-incoming / fill rows fell through to either a
 * self-address or null).
 *
 * Returns null when no salient peer address is on the row payload;
 * the caller suppresses the single-peer "Save as contact" prompt.
 *
 * DIVIDEND / AIRDROP rows have their *derived* recipient lists handled
 * by `<RecipientsBlock>` instead; those need an SDK round-trip
 * (holdersFor / listByActionIndex) to materialize the peer set.
 *
 * @param {any} entry
 * @returns {string | null}
 */
function peerAddressOfEntry(entry) {
    const raw = entry?.raw || {};
    const self = entry?.address;
    const isSelf = (a) => typeof self === 'string' && self.length > 0 && a === self;
    const action = String(entry?.action || '').toUpperCase();

    // ORDER_MATCH / fill rows carry both sides of the trade. The peer
    // is whichever address isn't the wallet's own. Different explorer
    // shapes use different field names; try them in priority order.
    if (action === 'ORDER_MATCH' || action === 'ORDER_FILL' || action === 'ORDERFILL') {
        const candidates = [
            raw.tx0_address, raw.TX0_ADDRESS,
            raw.tx1_address, raw.TX1_ADDRESS,
            raw.give_address, raw.GIVE_ADDRESS,
            raw.get_address, raw.GET_ADDRESS,
            raw.destination, raw.DESTINATION,
            raw.source, raw.SOURCE,
        ];
        for (const a of candidates) {
            if (typeof a === 'string' && a.length > 0 && !isSelf(a)) return a;
        }
        return null;
    }

    // SEND / RECEIVE / MESSAGE / generic: destination if it isn't
    // the wallet's own address (we received), otherwise source if
    // that isn't ours either (we sent).
    const dest = raw.destination ?? raw.DESTINATION ?? raw.recipient ?? raw.RECIPIENT;
    if (typeof dest === 'string' && dest.length > 0 && !isSelf(dest)) return dest;
    const src = raw.source ?? raw.SOURCE;
    if (typeof src === 'string' && src.length > 0 && !isSelf(src)) return src;
    return null;
}

/**
 * Map a chainId like "bitcoin-mainnet" / "litecoin-regtest" to the
 * coin family ("bitcoin" / "litecoin") that the contacts schema
 * expects. Returns null when the chainId is malformed.
 *
 * @param {string | undefined} chainId
 * @returns {string | null}
 */
function coinOfChainId(chainId) {
    if (typeof chainId !== 'string' || !chainId.includes('-')) return null;
    const [coin] = chainId.split('-', 1);
    return coin || null;
}

// Coin family -> native ticker, used to gate the History fiat
// toggle to genuinely native-coin amounts.
const NATIVE_TICKER_BY_COIN = { bitcoin: 'BTC', dogecoin: 'DOGE', litecoin: 'LTC' };

/**
 * Resolve a numeric native-coin amount for `entry`, or `null` when the
 * amount can't be trusted to price against the chain's own coin rate.
 *
 * IMPORTANT (old-numbering): a SEND action carries a
 * `tick` for BOTH native-coin sends and token sends. Only a SEND whose
 * `tick` is absent or matches the chain's own native ticker (BTC/DOGE/LTC)
 * is a native-coin movement; a token SEND (tick = a protocol asset ticker)
 * must never be priced with the coin's fiat rate, so this returns null for
 * those. This is the deliberate fix for the known latent bug elsewhere in
 * the app that conflates token amounts with the coin rate - don't
 * replicate it here.
 *
 * @param {import('./History.jsx').HistoryEntry | null | undefined} entry
 * @returns {number | null}
 */
function nativeAmountFieldOf(entry) {
    if (!entry || String(entry.action || '').toUpperCase() !== 'SEND') return null;
    const coin = coinOfChainId(entry.chainId);
    const nativeTicker = coin ? NATIVE_TICKER_BY_COIN[coin] : null;
    if (!nativeTicker) return null;
    const raw = entry.raw || {};
    const tick = raw.tick ?? raw.TICK ?? raw.token;
    if (tick && String(tick).toUpperCase() !== nativeTicker) return null; // token movement
    const amt = raw.amount ?? raw.AMOUNT ?? raw.quantity ?? raw.QUANTITY;
    if (amt == null) return null;
    const n = typeof amt === 'number' ? amt : parseFloat(amt);
    return Number.isFinite(n) ? n : null;
}

/**
 * M2.3: the meta-line label for a row with no block. It used to be the
 * flat word "unconfirmed", which was the wrong vocabulary (§7 fixes
 * "pending" for anything a user reads) and, worse, was the same word for
 * a healthy send and for one no node has ever reported.
 *
 * The warning treatment is the list-level half of M2 acceptance test 3:
 * a transaction the network has not seen has to be findable in a long
 * list without opening it.
 *
 * @param {{ entry: any }} props
 */
function PendingRowLabel({ entry }) {
    const state = pendingStateOf(entry);
    const warning = state != null && PENDING_WARNING_STATES.has(state);
    const label = state ? t(PENDING_COPY[state].row) : t('pending.row.generic');
    return (
        <span
            className={`${styles.pendingLabel} ${warning ? styles.pendingLabelWarning : ''}`}
            data-pending-state={state || 'pending'}
        >
            {warning ? <span aria-hidden="true">⚠</span> : null}
            {label}
        </span>
    );
}

/**
 * M2.5: what the pending row moves, on the row itself. Until now a
 * pending entry named its action, its state and its counterparty and
 * said nothing about the value at stake, so the list gave the user no
 * way to tell a dust send from their rent without opening every row.
 *
 * Renders nothing rather than a placeholder when no amount can be stood
 * behind. A blank says the wallet does not know; a zero would say the
 * transaction moves nothing, which is a different and false claim.
 *
 * The phrasing is a verb still in progress, and the accessible name
 * carries the pre-validation caveat for a reader who never sees the
 * styling. Neither is decoration: this figure sits inches from settled
 * amounts in the same list, and the indexer can still reject the action
 * when its block lands.
 *
 * @param {{ entry: any }} props
 */
function PendingAmountLabel({ entry }) {
    const [balancesHidden] = useBalancesHidden();
    const annotation = pendingAmountAnnotation(entry);
    if (!annotation) return null;
    const amounts = annotation.outputs
        .map((o) => t('pending.amount.entry', {
            amount: balancesHidden ? '•••••' : o.amount,
            tick: o.tick,
        }))
        .join(t('pending.amount.separator'));
    const summary = t(
        PENDING_AMOUNT_COPY[annotation.direction] || 'pending.amount.moving',
        { amounts },
    );
    const caveat = t('pending.amount.caveat', { summary });
    return (
        <span
            className={styles.pendingAmount}
            data-pending-amount={annotation.direction || 'unknown'}
            aria-label={caveat}
            title={caveat}
        >
            {summary}
        </span>
    );
}

/**
 * One history row. Used both for top-level entries and for member rows
 * inside an expanded group card.
 */
export function EntryRow({ entry, selected, showConnector, onClick, peerCache, isFull, chainTip, indexerWatermark, walletId, verify, showFiatInHistory, fiatCurrency }) {
    const d = chainRegistry.get(entry.chainId);
    return (
        <li data-history-key={entry.key}>
            <button
                type="button"
                onClick={onClick}
                className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
                aria-expanded={selected}
            >
                {showConnector ? (
                    <span className={styles.connector} aria-hidden="true" />
                ) : null}
                <span className={styles.rowHeader}>
                    {d ? (
                        <img
                            src={branding.chainIconSmallUrl(d.id)}
                            alt=""
                            aria-hidden="true"
                            className={styles.rowChainIcon}
                            width={16}
                            height={16}
                        />
                    ) : null}
                    <span className={styles.actionBadge}>{actionDisplayLabel(entry.action)}</span>
                    {entry.link ? (
                        <span
                            className={styles.crosschainBadge}
                            title={`Linked to ${entry.link.peerCoinTicker} #${entry.link.peerActionIndex}`}
                        >
                            🔗
                        </span>
                    ) : null}
                    <StatusPill status={classifyEntryStatus(entry)} />
                    {verify ? (
                        <VerifiedBadge status={verify.status} reason={verify.reason} size="sm" />
                    ) : null}
                </span>
                <span className={styles.rowSourceAddress}>
                    {entry.source || '-'}
                </span>
                <span className={styles.rowMeta}>
                    {entry.blockIndex ? (
                        <>
                            <span>Block {Number(entry.blockIndex).toLocaleString('en-US')}</span>
                            {chainTip ? (
                                <span className={styles.confirmationsPill}>
                                    {Math.max(0, chainTip - Number(entry.blockIndex) + 1)} Confirms
                                </span>
                            ) : null}
                        </>
                    ) : (
                        <>
                            <PendingRowLabel entry={entry} />
                            <PendingAmountLabel entry={entry} />
                        </>
                    )}
                    {entry.timestamp ? (
                        <span className={styles.rowRelativeTime}>
                            {formatRelativeTime(entry.timestamp)}
                        </span>
                    ) : null}
                </span>
            </button>
            {selected ? (
                <DetailCard
                    entry={entry}
                    peerCache={peerCache}
                    isFull={isFull}
                    chainTip={chainTip}
                    indexerWatermark={indexerWatermark}
                    walletId={walletId}
                    showFiatInHistory={showFiatInHistory}
                    fiatCurrency={fiatCurrency}
                />
            ) : null}
        </li>
    );
}

/**
 * Collapsed group card (§28.2). Renders a single summary row that
 * expands to reveal its member entries when clicked.
 */
function GroupCard({ item, expanded, onToggle }) {
    const [balancesHidden] = useBalancesHidden();
    const d = chainRegistry.get(item.leader.chainId);
    // §28.3: link-pair groups span two chains; surface both badges so
    // the user sees the cross-chain relationship without expanding.
    // Other subkinds keep their single-chain header.
    const isLinkPair = item.subkind === 'link-pair';
    const peer = isLinkPair ? item.members[0] : null;
    const peerDescriptor = peer ? chainRegistry.get(peer.chainId) : null;
    const newest = item.members[0];
    // Only issue-mint group summaries embed a financial amount
    // ("Launched TICK (supply 12345)"); strip the supply parenthetical
    // when privacy mode is on. Other subkinds carry counts or
    // chain-link metadata that aren't amounts.
    const displaySummary = (balancesHidden && item.subkind === 'issue-mint')
        ? stripSupplyParenthetical(item.summary)
        : item.summary;
    return (
        <button
            type="button"
            onClick={onToggle}
            className={`${styles.row} ${styles.groupCard} ${expanded ? styles.groupCardExpanded : ''}`}
            aria-expanded={expanded}
        >
            <span className={styles.rowHeader}>
                {d ? (
                    <img
                        src={branding.chainIconSmallUrl(d.id)}
                        alt=""
                        aria-hidden="true"
                        className={styles.rowChainIcon}
                        width={16}
                        height={16}
                    />
                ) : null}
                {isLinkPair && peerDescriptor && peerDescriptor !== d ? (
                    <>
                        <span className={styles.linkPairConnector} aria-hidden="true">↔</span>
                        <img
                            src={branding.chainIconSmallUrl(peerDescriptor.id)}
                            alt=""
                            aria-hidden="true"
                            className={styles.rowChainIcon}
                            width={16}
                            height={16}
                        />
                    </>
                ) : null}
                <span className={styles.actionBadge}>{groupBadgeLabel(item.subkind)}</span>
                {!isLinkPair ? (
                    <span className={styles.groupCount}>{item.members.length}</span>
                ) : null}
            </span>
            <span className={styles.rowSummary}>{displaySummary}</span>
            <span className={styles.rowMeta}>
                {newest?.timestamp ? `Latest ${formatRelativeTime(newest.timestamp)}` : '-'}
                <span className={styles.groupChevron} aria-hidden="true">
                    <DoubleChevron direction={expanded ? 'up' : 'down'} />
                </span>
            </span>
        </button>
    );
}

// Humanized labels (the badge CSS uppercases visually); raw opcodes like
// DISPENSER/ORDER route through the shared display map so the copy stays in
// the house voice if the styling ever changes.
function groupBadgeLabel(subkind) {
    if (subkind === 'issue-mint') return 'Launch';
    if (subkind === 'dispenser-dispense') return actionDisplayLabel('DISPENSER');
    if (subkind === 'order-fills') return actionDisplayLabel('ORDER');
    if (subkind === 'link-pair') return actionDisplayLabel('LINK');
    if (subkind === 'batch') return actionDisplayLabel('BATCH');
    return 'Group';
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

// Bare-bones CSS.escape replacement; we control the input shape (a
// chainId + ':' + actionIndex + ':' + address triple), so the only
// reliably-problematic chars are `:` and quotes; escape every non-
// alphanumeric to a backslash form rather than depending on
// `CSS.escape` (jsdom 25+ has it, but older renderers might not).
function cssEscape(s) {
    return String(s).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function peerCacheKey(chainId, actionIndex) {
    return `${chainId}:${actionIndex}`;
}

function shorten(addr) {
    if (!addr || addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Longer middle-ellipsis truncation used in the ActionDetail "Source"
// table cell. The cell has more horizontal room than the row meta so
// we can show more of each end before collapsing.
function shortenAddress(addr) {
    if (!addr) return '';
    if (addr.length <= 26) return addr;
    return `${addr.slice(0, 16)}…${addr.slice(-8)}`;
}

/**
 * Per-row success / error / pending indicator. Reads the entry's
 * classified status and renders a colored pill so the user can scan a
 * long list and pick out failures at a glance.
 */
function StatusPill({ status }) {
    if (status === 'confirmed') {
        return <span className={`${styles.statusPill} ${styles.statusPillSuccess}`} title="Confirmed">Confirmed</span>;
    }
    if (status === 'failed') {
        return <span className={`${styles.statusPill} ${styles.statusPillError}`} title="Failed">Failed</span>;
    }
    return <span className={`${styles.statusPill} ${styles.statusPillPending}`} title="Pending">Pending</span>;
}

function formatTimestamp(ts) {
    if (!ts) return '-';
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toISOString().replace('T', ' ').replace(/\..*/, ' UTC');
}

// Human-readable "X ago" from a unix timestamp (seconds or ms).
function formatRelativeTime(ts) {
    if (!ts) return '';
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const diffSec = Math.floor((Date.now() - ms) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec} seconds ago`;
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    const hr = Math.floor(diffSec / 3600);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const day = Math.floor(diffSec / 86400);
    if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
    const month = Math.floor(day / 30);
    if (month < 12) return `${month} month${month === 1 ? '' : 's'} ago`;
    const year = Math.floor(day / 365);
    return `${year} year${year === 1 ? '' : 's'} ago`;
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

// Field names whose values are financial amounts the privacy toggle
// should opaque. Matched case-insensitively against both snake_case and
// camelCase variants. Keep this conservative: only known amount-bearing
// keys, not address / index / status fields.
const AMOUNT_KEY_RE = /^(amount|quantity|supply|max_supply|maxSupply|give_amount|giveAmount|get_amount|getAmount|give_remaining|giveRemaining|get_remaining|getRemaining|escrow_quantity|escrowQuantity|mainchainrate|dispense_quantity|dispenseQuantity|dispense_count|dispenseCount|fee|fee_per_kb|feePerKb)$/i;

// Drop the "(supply 12345)" tail from an issue-mint group summary when
// privacy mode is on. Matches the format emitted by historyGrouping's
// `summarizeGroup`: anything else is returned unchanged.
function stripSupplyParenthetical(summary) {
    if (typeof summary !== 'string') return summary;
    return summary.replace(/\s*\(supply [^)]+\)\s*$/, '');
}

/**
 * Recursively replace amount-field values with `'•••••'`. Object / array
 * traversal is preserved so the rest of the structure stays readable
 * when the redacted result is JSON.stringify'd into the Raw tab or
 * fed into the Details table. Returns the input unchanged when it
 * contains no amount fields, so the React identity stays stable.
 */
function redactAmountFields(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(redactAmountFields);
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = AMOUNT_KEY_RE.test(k) ? '•••••' : redactAmountFields(v);
        }
        return out;
    }
    return value;
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

/* ───── §28.5 / G081 history export ───────────────────────────────── */

/**
 * Multi-select dropdown: same trigger button as ChainPicker but the
 * popover contains a checkbox per option. The button summary shows
 * "All <label>" when nothing's filtered (everything passes), a single
 * option's label when one is selected, or "N selected" otherwise.
 */
/** Per-action-type icon lookup. Maps each option id to an Icon
 *  element from the shared ui library. */
function actionTypeIcon(id) {
    switch (id) {
        case 'send':       return <Icon.SendIcon />;
        case 'receive':    return <Icon.ReceiveIcon />;
        case 'issue':      return <Icon.PlusIcon />;
        case 'mint':       return <Icon.TokenIcon />;
        case 'destroy':    return <Icon.TrashIcon />;
        case 'sweep':      return <Icon.DownloadIcon />;
        case 'dispenser':  return <Icon.MarketIcon />;
        case 'dispense':   return <Icon.DownloadIcon />;
        case 'order':      return <Icon.MarketIcon />;
        case 'swap':       return <Icon.SwapIcon />;
        case 'dividend':   return <Icon.DollarIcon />;
        case 'broadcast':  return <Icon.BroadcastIcon />;
        case 'message':    return <Icon.MessageIcon />;
        case 'crosschain': return <Icon.LinkIcon />;
        default:           return null;
    }
}

function specialFilterIcon(id) {
    if (id === 'crosschain') return <Icon.LinkIcon />;
    if (id === 'multisig') return <Icon.KeyIcon />;
    return null;
}

function CheckboxPicker({ options, selected, onToggle, allLabel, summaryNoun, iconForId, menuHeader }) {
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

    // Empty filter = "no constraint" (everything passes). Match the
    // existing applyHistoryFilters semantics so this matches the prior
    // chip-toggle behavior exactly.
    const isAll = selected.size === 0;
    const summary = isAll
        ? allLabel
        : selected.size === 1
            ? (options.find((o) => o.id === Array.from(selected)[0])?.label || `1 ${summaryNoun}`)
            : `${selected.size} ${summaryNoun}s`;

    return (
        <div ref={wrapRef} className={styles.chainPickerWrap}>
            <button
                type="button"
                className={styles.chainPickerBtn}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                <span className={styles.chainPickerLeft}>{summary}</span>
                <SingleChevron direction="down" />
            </button>
            {open ? (
                <ul className={styles.chainPickerMenu} role="listbox" aria-multiselectable="true">
                    {menuHeader ? (
                        <li className={styles.checkboxMenuHeader} aria-hidden="true">
                            {menuHeader}
                        </li>
                    ) : null}
                    {options.map((opt) => {
                        const active = selected.has(opt.id);
                        const icon = typeof iconForId === 'function' ? iconForId(opt.id) : null;
                        return (
                            <li key={opt.id}>
                                <label
                                    className={`${styles.chainPickerOption} ${active ? styles.chainPickerOptionActive : ''}`}
                                    role="option"
                                    aria-selected={active}
                                >
                                    <input
                                        type="checkbox"
                                        checked={active}
                                        onChange={() => onToggle(opt.id)}
                                    />
                                    {icon ? <span className={styles.checkboxOptionIcon} aria-hidden="true">{icon}</span> : null}
                                    <span>{opt.label}</span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </div>
    );
}

/** Single chevron: render via SVG so the line weight matches the
 * surrounding text and stays crisp at any size. */
function SingleChevron({ direction = 'down' }) {
    const points = direction === 'up' ? '3,8 6,5 9,8' : '3,5 6,8 9,5';
    return (
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/** Two chevrons stacked, both pointing the same way. */
function DoubleChevron({ direction = 'down' }) {
    const top = direction === 'up' ? '3,6 6,3 9,6' : '3,3 6,6 9,3';
    const bot = direction === 'up' ? '3,11 6,8 9,11' : '3,8 6,11 9,8';
    return (
        <svg viewBox="0 0 12 14" width="12" height="14" aria-hidden="true">
            <polyline
                points={top}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <polyline
                points={bot}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/** Format a date N days ago in local time as YYYY-MM-DD for the
 *  native <input type="date"> control. */
/**
 * The date inputs speak in the user's own days. `isoDateDaysAgo` builds its
 * string from LOCAL calendar components and `<input type="date">` shows the
 * user a local day, but `Date.parse('2026-08-27')` is UTC midnight by spec.
 * Reading the two the same way is the whole point of these helpers.
 *
 * The asymmetry was not cosmetic. West of UTC, "today" as a UTC-parsed day
 * ends BEFORE the current moment for as long as the local date lags the UTC
 * date: in US Pacific that is every evening from 17:00 until midnight, and
 * for those seven hours the default 30-day window silently hid everything
 * that had just happened, which is exactly the moment a pending transaction
 * needs to be visible.
 *
 * @param {string} iso  `YYYY-MM-DD`, or empty for no bound
 * @returns {number | null}
 */
function localDayStartMs(iso) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!parts) return null;
    return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 0, 0, 0, 0).getTime();
}

/**
 * End of the local day named by `iso`, inclusive.
 *
 * @param {string} iso
 * @returns {number | null}
 */
function localDayEndMs(iso) {
    const start = localDayStartMs(iso);
    if (start == null) return null;
    const d = new Date(start);
    d.setDate(d.getDate() + 1);
    return d.getTime() - 1;
}

function isoDateDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function chainScopeLabel(enabledChains, activeChainIds) {
    if (!enabledChains) return 'all';
    const total = activeChainIds.length;
    if (enabledChains.size === 0 || enabledChains.size === total) return 'all';
    return Array.from(enabledChains).sort().join('+');
}

/**
 * Custom chain picker: full-width button that opens a popover with
 * each option rendered as its chain logo + display name. Used instead
 * of a native <select> because browsers don't render HTML / images
 * inside <option> elements.
 */
function ChainPicker({ activeChainIds, chainRegistry, enabledChains, onChange }) {
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

    const isAll = enabledChains.size === activeChainIds.length || enabledChains.size === 0;
    const selectedId = isAll ? null : Array.from(enabledChains)[0];
    const selectedDesc = selectedId ? chainRegistry.get(selectedId) : null;

    const choose = (id) => {
        const next = id === 'all'
            ? new Set(activeChainIds)
            : new Set([id]);
        onChange(next);
        setOpen(false);
    };

    return (
        <div ref={wrapRef} className={styles.chainPickerWrap}>
            <button
                type="button"
                className={styles.chainPickerBtn}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                <span className={styles.chainPickerLeft}>
                    {selectedDesc ? (
                        <img
                            src={branding.chainIconSmallUrl(selectedDesc.id)}
                            alt=""
                            aria-hidden="true"
                            className={styles.chainPickerIcon}
                        />
                    ) : (
                        <span className={styles.chainPickerAllIcon} aria-hidden="true">⛓</span>
                    )}
                    <span>{selectedDesc ? selectedDesc.displayName : 'All chains'}</span>
                </span>
                <SingleChevron direction="down" />
            </button>
            {open ? (
                <ul className={styles.chainPickerMenu} role="listbox">
                    <li>
                        <button
                            type="button"
                            role="option"
                            aria-selected={isAll}
                            className={`${styles.chainPickerOption} ${isAll ? styles.chainPickerOptionActive : ''}`}
                            onClick={() => choose('all')}
                        >
                            <span className={styles.chainPickerAllIcon} aria-hidden="true">⛓</span>
                            <span>All chains</span>
                        </button>
                    </li>
                    {activeChainIds.map((cid) => {
                        const d = chainRegistry.get(cid);
                        const isSel = selectedId === cid;
                        return (
                            <li key={cid}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={isSel}
                                    className={`${styles.chainPickerOption} ${isSel ? styles.chainPickerOptionActive : ''}`}
                                    onClick={() => choose(cid)}
                                >
                                    <img
                                        src={branding.chainIconSmallUrl(cid)}
                                        alt=""
                                        aria-hidden="true"
                                        className={styles.chainPickerIcon}
                                    />
                                    <span>{d?.displayName || cid}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </div>
    );
}

function runExport({ entries, scope, format, columns }) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const filename = flowsLib.buildExportFilename({ scope, format });
    const fileContent = format === 'csv'
        ? flowsLib.entriesToCsv(entries, { columns })
        : flowsLib.entriesToJson(entries, { scope, columns });
    const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json';
    const blob = new Blob([fileContent], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ───── Cluster I FOLLOWUP 5 - export modal ───────────────────────── */

const MODAL_SCRIM = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
};
const MODAL_CARD = {
    background: 'var(--xc-bg)',
    color: 'var(--xc-text)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    padding: 'var(--xc-space-3)',
    width: 'min(420px, 90vw)',
    maxHeight: '80vh',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-3)',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.25)',
};
const MODAL_FIELDSET = {
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-2)',
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-1)',
    fontSize: 'var(--xc-text-sm)',
};
const MODAL_LEGEND = {
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-text-xs)',
    padding: '0 var(--xc-space-1)',
};
const MODAL_LABEL = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--xc-space-2)',
    fontSize: 'var(--xc-text-sm)',
};
const MODAL_ACTIONS = {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 'var(--xc-space-2)',
};

function ExportModal({
    onClose,
    format, setFormat,
    columns, setColumns,
    fromDate, setFromDate,
    toDate, setToDate,
    scope, setScope,
    activeFilterFromDate, activeFilterToDate,
    visibleCount, totalCount,
    onConfirm,
}) {
    useEffect(() => {
        function onKey(e) { if (e.key === 'Escape') onClose(); }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const toggleColumn = (col) => {
        const next = new Set(columns);
        if (next.has(col)) next.delete(col);
        else next.add(col);
        setColumns(next);
    };

    const filterChanged = fromDate !== activeFilterFromDate || toDate !== activeFilterToDate;
    const sourceCount = scope === 'all' ? totalCount : visibleCount;

    return (
        <div
            style={MODAL_SCRIM}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            role="presentation"
            tabIndex={-1}
        >
            <div
                style={MODAL_CARD}
                role="dialog"
                aria-modal="true"
                aria-label="Export history"
            >
                <h2 style={{ margin: 0, fontSize: 'var(--xc-text-base)' }}>Export history</h2>

                <fieldset style={MODAL_FIELDSET}>
                    <legend style={MODAL_LEGEND}>Format</legend>
                    <label style={MODAL_LABEL}>
                        <input
                            type="radio"
                            name="export-format"
                            value="csv"
                            checked={format === 'csv'}
                            onChange={() => setFormat('csv')}
                        />
                        CSV (RFC-4180; compact, opens in spreadsheets)
                    </label>
                    <label style={MODAL_LABEL}>
                        <input
                            type="radio"
                            name="export-format"
                            value="json"
                            checked={format === 'json'}
                            onChange={() => setFormat('json')}
                        />
                        JSON (preserves the full row including link / raw)
                    </label>
                </fieldset>

                <fieldset style={MODAL_FIELDSET}>
                    <legend style={MODAL_LEGEND}>Columns</legend>
                    {flowsLib.EXPORT_COLUMNS.map((col) => (
                        <label key={col} style={MODAL_LABEL}>
                            <input
                                type="checkbox"
                                checked={columns.has(col)}
                                onChange={() => toggleColumn(col)}
                            />
                            <span style={{ fontFamily: 'var(--xc-font-mono, monospace)', fontSize: 'var(--xc-text-xs)' }}>{col}</span>
                        </label>
                    ))}
                </fieldset>

                <fieldset style={MODAL_FIELDSET}>
                    <legend style={MODAL_LEGEND}>Scope</legend>
                    <label style={MODAL_LABEL}>
                        <input
                            type="radio"
                            name="export-scope"
                            value="filtered"
                            checked={scope === 'filtered'}
                            onChange={() => setScope('filtered')}
                        />
                        Filtered ({visibleCount.toLocaleString()} row{visibleCount === 1 ? '' : 's'})
                    </label>
                    <label style={MODAL_LABEL}>
                        <input
                            type="radio"
                            name="export-scope"
                            value="all"
                            checked={scope === 'all'}
                            onChange={() => setScope('all')}
                        />
                        Everything loaded ({totalCount.toLocaleString()} row{totalCount === 1 ? '' : 's'})
                    </label>
                </fieldset>

                <fieldset style={MODAL_FIELDSET}>
                    <legend style={MODAL_LEGEND}>
                        Date range {filterChanged ? '(overrides active filter)' : '(matches active filter)'}
                    </legend>
                    <label style={MODAL_LABEL}>
                        From
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            style={{ marginLeft: 'auto' }}
                            aria-label="From date"
                        />
                    </label>
                    <label style={MODAL_LABEL}>
                        To
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            style={{ marginLeft: 'auto' }}
                            aria-label="To date"
                        />
                    </label>
                </fieldset>

                <div style={MODAL_ACTIONS}>
                    <button type="button" className={styles.chip} onClick={onClose}>Cancel</button>
                    <button
                        type="button"
                        className={styles.chip}
                        onClick={onConfirm}
                        disabled={sourceCount === 0 || columns.size === 0}
                    >
                        Export
                    </button>
                </div>
            </div>
        </div>
    );
}
