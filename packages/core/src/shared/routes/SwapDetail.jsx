// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Swap Details: one swap a My Swaps row opened, by chain and action index,
// in the ring layout (wallet-orders-layout-1-ring). The header card is the
// large fill ring (0% or 100%: a swap is single-fill), "Swapping", the give
// amount, what it is for and the status. Then the Actions | Details |
// Matches toggle (G102, G13), Actions first: Edit (SWAP v2) and Cancel (SWAP
// v1) while the swap is open and the wallet holds its owner address, the
// explorer and Copy transaction ID, one ActionList row each (G101). Details
// holds the facts; Matches the lifecycle timeline, the same layout as Order
// detail. Edit and Cancel open the edit-swap and cancel-swap routes
// (standard forms) where the host wires them, and draw the same form
// (SwapActionPanel) in place where it does not.
//
// Reads are fixed for the page, whatever the swap's history holds: the
// wallet's addresses, the swap's action detail and its owner's cancels
// feed, plus the activity timeline's own four lanes. A demo wallet reads its
// bundled demo swap and nothing from the network.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    EmptyState,
    Icon,
    ListPage,
    PageHeader,
    Screen,
    Skeleton,
} from '@xchain-wallet/core/ui';
import { flows as flowsLib, registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { copyText } from '../clipboard.js';
import { explorerPageUrl } from '../utils/explorerLinks.js';
import { shortHash } from '../utils/orderView.js';
import { boundListIndex } from '../../flows/accessListSlots.js';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { ActionsDetailsToggle } from '../components/ActionsDetailsToggle.jsx';
import { MarketLifecycleTimeline } from '../components/MarketLifecycleTimeline.jsx';
import { SwapDetailBody, SwapHeader, SwapMatches } from '../components/SwapDetailBody.jsx';
import { swapTerms } from '../components/SwapRow.jsx';
import V from '../components/SwapViews.module.css';
import {
    collectCancelledKeys,
    deriveStatus,
    extractRows,
    swapExpiryLabel,
    swapSides,
    swapStateOf,
} from '../utils/swapStatus.js';
import { hasSwapCancelBroadcast, markSwapCancelBroadcast } from '../utils/swapCancelMarks.js';
import { SwapActionPanel } from './MySwapsView.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/actionDetail.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/mySwaps.js';

const chainRegistry = registryLib.defaultRegistry();

/** The swap row inside an action detail response, or null when it is not a swap. */
function detailRow(detail) {
    const row = detail?.data && typeof detail.data === 'object' && !Array.isArray(detail.data)
        ? detail.data
        : detail;
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    if (row.action != null && String(row.action).toUpperCase() !== 'SWAP') return null;
    const hasTerms = ['give_amount', 'give_tick', 'give_coin', 'get_amount', 'get_tick', 'get_coin']
        .some((field) => row[field] != null && row[field] !== '');
    return hasTerms ? row : null;
}

/**
 * Read one swap for the page: a fixed set of reads, never one per row of
 * its history.
 *
 * @param {{ messaging: any, walletId: string, accountId?: string, chainId: string, actionIndex: string, nowMs?: number }} params
 * @returns {Promise<{ item: any, addresses: any[] } | null>}
 */
export async function loadSwapDetail({ messaging, walletId, accountId, chainId, actionIndex, nowMs = Date.now() }) {
    const index = String(actionIndex ?? '');
    const key = `${chainId}:${index}`;
    const readAddresses = typeof messaging?.getAddressesByChain === 'function'
        ? messaging.getAddressesByChain(walletId, accountId).catch(() => null)
        : Promise.resolve(null);

    if (flowsLib.isDemoWallet(walletId)) {
        // A demo wallet's swaps are the bundled ones its first address owns.
        const addresses = ((await readAddresses) || {})[chainId] || [];
        const owner = addresses.find((a) => typeof a?.address === 'string' && a.address.length > 0);
        if (!owner) return null;
        const row = flowsLib.synthesizeDemoSwaps(chainId, owner.address, { now: nowMs })
            .find((r) => String(r.action_index) === index);
        if (!row) return null;
        return {
            addresses,
            item: { chainId, owner, row, key, cancelledKeys: new Set(), live: swapStateOf(row), demo: true },
        };
    }

    const readDetail = typeof messaging?.getSwapDetail === 'function'
        ? messaging.getSwapDetail({ chainId, actionIndex: index })
        : Promise.resolve(null);
    const [chains, detail] = await Promise.all([readAddresses, readDetail]);
    const row = detailRow(detail);
    if (!row) return null;
    const addresses = (chains || {})[chainId] || [];
    const source = String(row.source ?? '');
    const record = addresses.find((a) => a?.address === source) || null;
    const owner = record || { address: source };
    let cancelledKeys = new Set();
    // The cancels feed is the immediate "no longer open" signal; only a swap
    // this wallet owns can be cancelled from here, so only then is it read.
    if (record && typeof messaging.getSwapCancelsForAddress === 'function') {
        const cancels = await messaging.getSwapCancelsForAddress({ chainId, address: source }).catch(() => null);
        cancelledKeys = collectCancelledKeys([{ p: { chainId, owner }, cancels: extractRows(cancels) }]);
    }
    return {
        addresses,
        item: {
            chainId,
            owner,
            ownerRecord: record,
            row: { ...row, action_index: row.action_index ?? index },
            key,
            cancelledKeys,
            live: swapStateOf(detail),
            demo: false,
        },
    };
}

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {string} props.chainId
 * @param {string} props.actionIndex
 * @param {() => void} props.onBack
 * @param {(ref: { chainId: string, actionIndex: string }) => void} [props.onEditSwap]
 *   opens the edit-swap route; without it Edit draws the form in place
 * @param {(ref: { chainId: string, actionIndex: string }) => void} [props.onCancelSwap]
 *   opens the cancel-swap route; without it Cancel draws the form in place
 */
export function SwapDetail({ walletId, accountId, chainId, actionIndex, onBack, onEditSwap, onCancelSwap }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const { settings } = useSettings();

    const [loaded, setLoaded] = useState(/** @type {{ item: any, addresses: any[] } | null | undefined} */ (undefined));
    const [action, setAction] = useState(/** @type {'cancel' | 'edit' | null} */ (null));
    // Bumped when a cancel broadcasts, so the page re-renders as Cancelling
    // from the session's mark (which My Swaps reads too) until the cancels
    // feed lists it.
    const [, setCancelMarks] = useState(0);
    const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
    const loadRequestId = useRef(0);
    // The Copy transaction ID row's brief "Copied" note, in place of its short id.
    const [copyNote, setCopyNote] = useState(/** @type {string | null} */ (null));
    const copyNoteTimer = useRef(/** @type {any} */ (null));
    useEffect(() => () => clearTimeout(copyNoteTimer.current), []);

    useEffect(() => {
        const timer = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30000);
        return () => clearInterval(timer);
    }, []);

    const load = useCallback(async () => {
        const requestId = ++loadRequestId.current;
        setLoaded(undefined);
        let result = null;
        try {
            result = await loadSwapDetail({ messaging, walletId, accountId, chainId, actionIndex });
        } catch {
            result = null;
        }
        if (requestId === loadRequestId.current) setLoaded(result);
    }, [messaging, walletId, accountId, chainId, actionIndex]);

    useEffect(() => {
        load();
        return () => { loadRequestId.current += 1; };
    }, [load]);

    const header = <PageHeader onBack={onBack} title={t('mySwaps.detail.title')} />;

    if (action && loaded?.item) {
        return (
            <SwapActionPanel
                type={action}
                item={loaded.item}
                chainAddresses={loaded.addresses}
                variant={variant}
                walletId={walletId}
                messaging={messaging}
                onDone={() => { setAction(null); load(); }}
                onCancelBroadcast={() => {
                    markSwapCancelBroadcast(messaging, loaded.item.key);
                    setCancelMarks((n) => n + 1);
                }}
                onBack={() => setAction(null)}
            />
        );
    }

    if (loaded === undefined) {
        return (
            <Screen variant={variant} header={header}>
                <ListPage>
                    <div role="status" aria-label={t('mySwaps.detail.loading')}>
                        <Skeleton.List rows={4} />
                    </div>
                </ListPage>
            </Screen>
        );
    }

    if (loaded === null) {
        return (
            <Screen variant={variant} header={header}>
                <ListPage>
                    <EmptyState title={t('mySwaps.detail.notFoundTitle')} body={t('mySwaps.detail.notFoundBody')} />
                </ListPage>
            </Screen>
        );
    }

    const { item } = loaded;
    const { row } = item;
    const derived = deriveStatus(item, item.cancelledKeys, nowSec);
    const status = derived === 'open' && hasSwapCancelBroadcast(messaging, item.key) ? 'cancelling' : derived;
    const { give, get } = swapSides(row);
    const txHash = typeof row.tx_hash === 'string' && row.tx_hash ? row.tx_hash : null;
    const explorerUrl = txHash && !item.demo
        ? explorerPageUrl({ chainId, kind: 'transaction', value: txHash, settings })
        : null;
    const state = row.state && typeof row.state === 'object' ? row.state : {};
    // Edit and Cancel need the swap open and its owner address in this wallet.
    const canAct = status === 'open' && Boolean(item.demo || item.ownerRecord);
    const terms = swapTerms(row, chainId, { give, get });

    // Edit and Cancel open their own routes where the host has them.
    const openAction = (type) => {
        const route = type === 'edit' ? onEditSwap : onCancelSwap;
        if (typeof route === 'function') route({ chainId, actionIndex: String(row.action_index) });
        else setAction(type);
    };

    async function copyTxHash() {
        const { ok } = await copyText(txHash);
        setCopyNote(ok ? t('history.copy.copied') : t('mySwaps.actions.copyFailed'));
        clearTimeout(copyNoteTimer.current);
        copyNoteTimer.current = setTimeout(() => setCopyNote(null), 1500);
    }

    // Every action this swap allows, one row each (G101). Edit and Cancel
    // show only while the swap is open and this wallet owns it; otherwise
    // they are left out rather than shown disabled. A swap has no market row.
    const actionRows = [
        canAct ? (
            <ActionListItem
                key="edit"
                icon={<Icon.PencilIcon />}
                title={t('mySwaps.actions.edit')}
                description={t('mySwaps.actions.editDetail')}
                onClick={() => openAction('edit')}
            />
        ) : null,
        explorerUrl ? (
            <ActionListItem
                key="explorer"
                icon={<Icon.ExternalLinkIcon />}
                title={t('actionDetail.actions.viewOnExplorer')}
                description={t('mySwaps.actions.explorerDetail')}
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
            />
        ) : null,
        txHash ? (
            <ActionListItem
                key="copy"
                icon={<Icon.CopyIcon />}
                title={t('mySwaps.detail.copyTransaction')}
                description={copyNote || shortHash(txHash)}
                onClick={copyTxHash}
                chevron={false}
            />
        ) : null,
        canAct ? (
            <ActionListItem
                key="cancel"
                icon={<Icon.XIcon />}
                title={t('mySwaps.actions.cancel')}
                // A swap is single-fill, so while it is open its whole give is still escrowed.
                description={t('mySwaps.actions.cancelDetail', { amount: terms.give })}
                tone="danger"
                onClick={() => openAction('cancel')}
            />
        ) : null,
    ].filter(Boolean);
    const actionList = actionRows.length > 0
        ? <ActionList label={t('mySwaps.actions.label')}>{actionRows}</ActionList>
        : null;
    const details = (
        <SwapDetailBody
            row={row}
            expiryText={swapExpiryLabel(item.live?.expiration ?? row.expiration, nowSec)}
            descriptor={chainRegistry.get(chainId)}
            actionIndex={row.action_index}
            ownerAddress={item.owner?.address || null}
            txHash={txHash}
            explorerUrl={explorerUrl}
            allowList={boundListIndex(state.allow_list ?? row.allow_list ?? row.allowList)}
            blockList={boundListIndex(state.block_list ?? row.block_list ?? row.blockList)}
        />
    );
    // The matches read only once their tab is chosen.
    const matches = item.demo || !item.owner?.address ? null : (
        <SwapMatches>
            <MarketLifecycleTimeline
                messaging={messaging}
                kind="swap"
                chainId={chainId}
                address={item.owner.address}
                actionIndex={row.action_index}
                createdBlock={row.block_index}
            />
        </SwapMatches>
    );

    return (
        <Screen variant={variant} header={header}>
            <ListPage>
                <div className={V.page}>
                    <SwapHeader give={terms.give} get={terms.get} status={status} />
                    {/* More than one action: the Actions | Details | Matches toggle, Actions first (G102). */}
                    {actionRows.length > 1 ? (
                        <ActionsDetailsToggle actions={actionList} details={details} matches={matches} />
                    ) : (
                        <>
                            {actionList}
                            {details}
                            {matches}
                        </>
                    )}
                </div>
            </ListPage>
        </Screen>
    );
}
