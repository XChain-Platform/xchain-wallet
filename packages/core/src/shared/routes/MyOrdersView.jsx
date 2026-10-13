// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MyOrdersView (PC-17): the unified, cross-pair "My orders" surface. It
// lists every ORDER the wallet placed (as SOURCE) across all chains and
// addresses - including native-coin pairs, which the per-market
// OpenOrdersPanel silently drops - and offers Cancel (ORDER v1) and Edit
// (ORDER v2) on the ones still open. Native-coin-GIVE rows carry the
// PC-16 auto-pay toggle (the same per-order revocation the interim
// OpenOrdersPanel row provided).
//
// Status derivation: the list feed (getOrdersForAddress) carries only the
// action-VALIDITY status, and a single order's getAction(...).state.status
// does NOT promptly reflect a cancel, so "cancelled" is read from the
// authoritative + immediate order_cancels table (getOrderCancelsForAddress)
// and "expired" from the order's own EXPIRATION vs wall clock. Neither
// feed carries fills, so every order those two leave open is read once
// through orders.detail, whose `state` block nets settled matches out of
// give_remaining and reports `complete` or `filled` once the order is fully filled.
// Cancel/edit are offered only while an order is open.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AddressText, Button, ChainBadge, EmptyState, FormPage, Input, ListPage, PageHeader, Screen, SectionHeader, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import { MarketLifecycleTimeline } from '../components/MarketLifecycleTimeline.jsx';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { compareDecimalStrings } from '../utils/amountFormat.js';
import { isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { boundListIndex } from '../../flows/accessListSlots.js';
import { isListEditRemoveActive } from '../../flows/protocolActivations.js';
import { useSettings } from '../hooks/useSettings.js';
import { explorerPageUrl } from '../utils/explorerLinks.js';
import { formatLocalDateTime } from '../utils/dateTime.js';
import L from './ObligationsView.module.css';
import F from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.orders)) return resp.orders;
    return [];
}

// A side's human label: ownership, a token amount, or a native-coin amount
// (empty tick = the chain's native coin).
function sideLabel(tick, coin, amount, ownership) {
    if (Number(ownership) === 1) return `ownership of ${tick || '?'}`;
    const unit = tick || coin || '';
    return `${amount ?? ''} ${unit}`.trim();
}

function isNativeGive(row) {
    return !row.give_tick || String(row.give_tick).length === 0;
}

// How many orders.detail reads are in flight at once while the open
// subset is enriched; the whole batch is still one wait.
const FILL_READ_CONCURRENCY = 6;

const CLOSED_LABELS = Object.freeze({
    filled: 'Filled',
    cancelling: 'Cancelling',
    cancelled: 'Cancelled',
    expiring: 'Expiring',
    expired: 'Expired',
    invalid: 'Invalid',
});

// The lifecycle half of an order detail. `state.status` is the indexer's
// latest order status (open / cancelling / cancelled / expiring / expired /
// complete / filled) and `state.give_remaining` is the give amount net of settled
// matches, zeroed once the order is terminal. Null when the detail lacks
// the block, so the caller falls back to the feeds alone.
export function fillStateOf(detail) {
    const state = detail && typeof detail === 'object' ? detail.state : null;
    if (!state || typeof state !== 'object') return null;
    return {
        status: String(state.status || ''),
        giveRemaining: state.give_remaining ?? null,
        expiration: state.expiration ?? null,
    };
}

export function deriveStatus(item, cancelledKeys, nowSec) {
    if (cancelledKeys.has(item.key)) return 'cancelled';
    if (String(item.row.status || 'valid') !== 'valid') return 'invalid';
    const fill = item.fill;
    if (fill) {
        if (fill.status === 'complete' || fill.status === 'filled') return 'filled';
        if (fill.status === 'cancelling') return 'cancelling';
        if (fill.status === 'cancelled') return 'cancelled';
        if (fill.status === 'expiring') return 'expiring';
        if (fill.status === 'expired') return 'expired';
        const remaining = compareDecimalStrings(fill.giveRemaining, '0');
        if (fill.status === 'open' && remaining !== null && remaining <= 0) return 'filled';
    }
    const exp = Number(fill?.expiration ?? item.row.expiration);
    if (Number.isFinite(exp) && exp > 0 && exp <= nowSec) return 'expired';
    return 'open';
}

// The give amount still on offer when an open order has been partly
// filled; null when nothing has filled or the detail did not say.
function partialRemaining(item) {
    const fill = item.fill;
    if (!fill || fill.status !== 'open') return null;
    const aboveZero = compareDecimalStrings(fill.giveRemaining, '0');
    const belowTotal = compareDecimalStrings(fill.giveRemaining, item.row.give_amount);
    if (aboveZero !== 1 || belowTotal !== -1) return null;
    return String(fill.giveRemaining);
}

// Read the open candidates' details a few at a time and return
// key -> fill state. A failed or shapeless read leaves the order as the
// feeds saw it rather than failing the whole list.
async function readFillStates(messaging, candidates) {
    const fills = new Map();
    if (typeof messaging?.getOrderDetail !== 'function') return fills;
    for (let i = 0; i < candidates.length; i += FILL_READ_CONCURRENCY) {
        const slice = candidates.slice(i, i + FILL_READ_CONCURRENCY);
        const details = await Promise.all(slice.map((it) => messaging
            .getOrderDetail({ chainId: it.chainId, actionIndex: String(it.row.action_index) })
            .catch(() => null)));
        slice.forEach((it, j) => {
            const fill = fillStateOf(details[j]);
            if (fill) fills.set(it.key, fill);
        });
    }
    return fills;
}

function fmtDate(unixSec) {
    const n = Number(unixSec);
    // Protocol expirations are Unix seconds. A current millisecond timestamp
    // otherwise renders as a plausible date tens of thousands of years away.
    if (!Number.isFinite(n) || n <= 0 || n >= 10_000_000_000) return null;
    return formatLocalDateTime(n);
}

function withFormattedExpiration(confirmAction) {
    const decoded = confirmAction?.composed?.decoded;
    if (!decoded || !Array.isArray(decoded.details)) return confirmAction;
    const replacements = [];
    const details = decoded.details.map((detail) => {
        if (!/expir/i.test(String(detail?.label || ''))) return detail;
        const formatted = fmtDate(detail.value);
        if (!formatted) return detail;
        replacements.push([String(detail.value), formatted]);
        return { ...detail, value: formatted };
    });
    if (replacements.length === 0) return confirmAction;
    const summary = replacements.reduce(
        (value, [raw, formatted]) => String(value).split(raw).join(formatted),
        decoded.summary,
    );
    return {
        ...confirmAction,
        composed: {
            ...confirmAction.composed,
            decoded: { ...decoded, summary, details },
        },
    };
}

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {() => void} props.onBack
 * @param {() => void} [props.onCreateOrder]
 */
export function MyOrdersView({ walletId, accountId, onBack, onCreateOrder }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [items, setItems] = useState(/** @type {any[] | null} */ (null));
    const [byChain, setByChain] = useState(/** @type {Record<string, any[]>} */ ({}));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [autopayByKey, setAutopayByKey] = useState(/** @type {Map<string, any>} */ (new Map()));
    const [activeAction, setActiveAction] = useState(/** @type {{ type: 'cancel' | 'edit', item: any } | null} */ (null));
    const [cancellingKeys, setCancellingKeys] = useState(/** @type {Set<string>} */ (new Set()));
    // PC-21: which order's lifecycle timeline is expanded inline (by row key).
    const [timelineKey, setTimelineKey] = useState(/** @type {string | null} */ (null));
    const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

    useEffect(() => {
        const current = Math.floor(Date.now() / 1000);
        setNowSec(current);
        const hasLiveExpiration = () => (items || []).some((item) => {
            const expiration = Number(item.fill?.expiration ?? item.row?.expiration);
            return Number.isFinite(expiration) && expiration > Math.floor(Date.now() / 1000);
        });
        if (!hasLiveExpiration()) return undefined;
        const t = setInterval(() => {
            setNowSec(Math.floor(Date.now() / 1000));
            if (!hasLiveExpiration()) clearInterval(t);
        }, 30000);
        return () => clearInterval(t);
    }, [items]);

    const load = useCallback(async () => {
        if (typeof messaging?.getAddressesByChain !== 'function'
            || typeof messaging?.getOrdersForAddress !== 'function') {
            setItems([]); return;
        }
        try {
            const chains = (await messaging.getAddressesByChain(walletId, accountId)) || {};
            setByChain(chains);
            const pairs = [];
            for (const [chainId, addrs] of Object.entries(chains)) {
                for (const a of addrs || []) pairs.push({ chainId, owner: a });
            }
            const results = await Promise.all(pairs.map((p) => Promise.all([
                messaging.getOrdersForAddress({ chainId: p.chainId, address: p.owner.address }),
                (typeof messaging.getOrderCancelsForAddress === 'function'
                    ? messaging.getOrderCancelsForAddress({ chainId: p.chainId, address: p.owner.address })
                    : Promise.resolve(null)),
            ]).then(([o, c]) => ({ p, orders: extractRows(o), cancels: extractRows(c) }))));

            // The cancels feed also lists rejected ORDER_CANCEL attempts (a
            // cancel sent against a filled order is recorded as invalid), and
            // only an applied cancel closes the order.
            const cancelledKeys = new Set();
            for (const r of results) {
                for (const c of r.cancels) {
                    if (String(c.source) === r.p.owner.address && String(c.status || 'valid') === 'valid') {
                        cancelledKeys.add(`${r.p.chainId}:${c.order_action_index}`);
                    }
                }
            }
            const seen = new Set();
            const all = [];
            for (const r of results) {
                for (const o of r.orders) {
                    // Only orders this wallet placed (is the seller/SOURCE of); the
                    // feed also returns orders where the address is the get_address.
                    if (String(o.source) !== r.p.owner.address) continue;
                    const key = `${r.p.chainId}:${o.action_index}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    all.push({ chainId: r.p.chainId, owner: r.p.owner, row: o, key });
                }
            }
            all.sort((a, b) => Number(b.row.action_index || 0) - Number(a.row.action_index || 0));
            for (const it of all) it.cancelled = cancelledKeys.has(it.key);
            // Read valid, uncancelled candidates before applying mutable expiration.
            const candidates = all.filter((it) => !cancelledKeys.has(it.key)
                && String(it.row.status || 'valid') === 'valid');
            const fills = await readFillStates(messaging, candidates);
            setItems(all.map((it) => ({ ...it, cancelledKeys, fill: fills.get(it.key) || null })));
            setLoadError(null);
        } catch (err) {
            setLoadError(err?.message || 'Failed to load orders.');
            setItems([]);
        }
    }, [messaging, walletId, accountId]);

    const loadAutopay = useCallback(async () => {
        if (typeof messaging?.listAutopayOrders !== 'function') return;
        try {
            if (typeof messaging.resolveAutopayIndexes === 'function') {
                await messaging.resolveAutopayIndexes({ walletId }).catch(() => {});
            }
            const records = await messaging.listAutopayOrders({ walletId });
            const map = new Map();
            for (const rec of records || []) {
                if (rec?.orderActionIndex != null) {
                    map.set(`${rec.chainId}:${rec.orderActionIndex}`, rec);
                }
            }
            setAutopayByKey(map);
        } catch { /* toggle is best-effort UI */ }
    }, [messaging, walletId]);

    useEffect(() => { load(); loadAutopay(); }, [load, loadAutopay]);

    async function handleAutopayToggle(record) {
        if (typeof messaging?.setAutopayEnabled !== 'function') return;
        await messaging.setAutopayEnabled({ id: record.id, enabled: record.autopay !== true }).catch(() => {});
        await loadAutopay();
    }

    const header = (
        <PageHeader
            onBack={onBack}
            title="My orders"
            action={onCreateOrder ? <Button variant="secondary" size="sm" onClick={onCreateOrder}>New order</Button> : undefined}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <ListPage>{children}</ListPage>
        </Screen>
    );

    if (activeAction) {
        return (
            <OrderActionPanel
                type={activeAction.type}
                item={activeAction.item}
                chainAddresses={byChain[activeAction.item.chainId] || []}
                variant={variant}
                walletId={walletId}
                messaging={messaging}
                onDone={() => { setActiveAction(null); load(); loadAutopay(); }}
                onCancelBroadcast={() => setCancellingKeys((current) => {
                    const next = new Set(current);
                    next.add(activeAction.item.key);
                    return next;
                })}
                onBack={() => setActiveAction(null)}
            />
        );
    }

    if (items === null) return wrap(<p className={L.hint}>Loading your orders…</p>);
    if (loadError) return wrap(<StatusMessage variant="error" className={L.hint}>{loadError}</StatusMessage>);
    if (items.length === 0) {
        return wrap(
            <EmptyState
                title="No orders yet"
                body="Orders you place on the DEX show up here across every pair."
                actionLabel={onCreateOrder ? 'Create an order' : undefined}
                onAction={onCreateOrder}
            />,
        );
    }

    const statusOf = (it) => {
        const status = deriveStatus(it, it.cancelledKeys, nowSec);
        return status === 'open' && cancellingKeys.has(it.key) ? 'cancelling' : status;
    };
    const openItems = items.filter((it) => statusOf(it) === 'open');
    const closedItems = items.filter((it) => statusOf(it) !== 'open');

    const renderRow = (it) => {
        const status = statusOf(it);
        const descriptor = chainRegistry.get(it.chainId);
        const give = sideLabel(it.row.give_tick, it.row.give_coin, it.row.give_amount, it.row.give_ownership);
        const get = sideLabel(it.row.get_tick, it.row.get_coin, it.row.get_amount, it.row.get_ownership);
        const expText = fmtDate(it.fill?.expiration ?? it.row.expiration);
        const remaining = partialRemaining(it);
        const allowList = boundListIndex(it.row.allow_list ?? it.row.allowList);
        const blockList = boundListIndex(it.row.block_list ?? it.row.blockList);
        const consent = autopayByKey.get(it.key);
        const chip = status === 'open'
            ? <span className={`${L.chip} ${L.chipOpen}`}>Open</span>
            : <span className={`${L.chip} ${L.chipExpired}`}>{CLOSED_LABELS[status] || 'Invalid'}</span>;
        return (
            <li key={it.key} className={L.row}>
                <div className={L.rowMain}>
                    <div className={L.rowHead}>
                        <span className={L.rowTitle}>Give {give} → get {get}</span>
                        {chip}
                    </div>
                    <div className={L.rowMeta}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : it.chainId}
                        {' · #'}{it.row.action_index}
                        {' · '}<AddressText address={it.owner.address} />
                    </div>
                    {remaining ? <div className={L.rowDetail}>Remaining {remaining} of {give}</div> : null}
                    {expText ? <div className={L.rowDetail}>Expires {expText}</div> : null}
                    <div className={L.rowDetail}>
                        Allow list {allowList ? `#${allowList}` : 'none'} · Block list {blockList ? `#${blockList}` : 'none'}
                    </div>
                    {consent && isNativeGive(it.row) ? (
                        <label className={F.checkRow}>
                            <input type="checkbox" checked={consent.autopay === true} onChange={() => handleAutopayToggle(consent)} />
                            {' '}CoinPay auto-pay {consent.autopay === true ? 'on' : 'off (notify-only)'}
                        </label>
                    ) : null}
                </div>
                <div className={L.rowActions}>
                    <Button
                        variant="secondary"
                        size="sm"
                        aria-expanded={timelineKey === it.key}
                        onClick={() => setTimelineKey(timelineKey === it.key ? null : it.key)}
                    >
                        {timelineKey === it.key ? 'Hide timeline' : 'Timeline'}
                    </Button>
                    {status === 'open' ? (
                        <>
                            <Button variant="secondary" size="sm" onClick={() => setActiveAction({ type: 'edit', item: it })}>Edit</Button>
                            <Button variant="danger" size="sm" onClick={() => setActiveAction({ type: 'cancel', item: it })}>Cancel</Button>
                        </>
                    ) : null}
                </div>
                {timelineKey === it.key ? (
                    <MarketLifecycleTimeline
                        messaging={messaging}
                        kind="order"
                        chainId={it.chainId}
                        address={it.owner.address}
                        actionIndex={it.row.action_index}
                        createdBlock={it.row.block_index}
                    />
                ) : null}
            </li>
        );
    };

    return wrap(
        <>
            <SectionHeader title="Open" />
            {openItems.length > 0 ? (
                /* Safari needs an explicit list role because this class removes list styling. */
                <ul className={L.list} role="list" aria-label="Open orders">{openItems.map(renderRow)}</ul>
            ) : <EmptyState title="No open orders" body="Open DEX orders appear here." titleAs="p" />}
            {closedItems.length > 0 ? (
                <>
                    <SectionHeader title="Closed" />
                    {/* Safari needs an explicit list role because this class removes list styling. */}
                    <ul className={L.list} role="list" aria-label="Closed orders">{closedItems.map(renderRow)}</ul>
                </>
            ) : null}
        </>,
    );
}

/**
 * Cancel (ORDER v1) or Edit (ORDER v2) an open order, signed from its
 * owner address. The form is the input step; signing happens on the shared
 * confirm page with its network pre-flight, or, in watcher mode, the form
 * builds an unsigned transaction.
 */
function OrderActionPanel({
    type, item, chainAddresses, variant, walletId, messaging, onDone, onCancelBroadcast, onBack,
}) {
    const { chainId, owner, row } = item;
    const { settings } = useSettings();
    const descriptor = chainRegistry.get(chainId);
    const isCancel = type === 'cancel';
    const currentAllowList = boundListIndex(row.allow_list ?? row.allowList);
    const currentBlockList = boundListIndex(row.block_list ?? row.blockList);
    const canRemoveList = isListEditRemoveActive({ chainId });
    const signerReady = useSignerReady(walletId);
    const lane = useOwnerActionLane({
        messaging,
        walletId,
        chainId,
        owner,
        software: isCancel ? 'cancelOrder' : 'editOrder',
        hardware: isCancel ? 'cancelOrderHw' : 'editOrderHw',
    });
    // An edit re-charges the expiration fee, and off Bitcoin that fee is a
    // native-coin output the transaction must carry or the indexer rejects it.
    const nativeFee = useNativeFee(chainId);

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const done = result !== null;

    // Edit fields (prefilled from the order's current values).
    const [expInput, setExpInput] = useState('');
    const [allowListIdx, setAllowListIdx] = useState('');
    const [blockListIdx, setBlockListIdx] = useState('');
    const [listPickerFor, setListPickerFor] = useState(/** @type {'allow' | 'block' | null} */ (null));

    const editParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = {};
        if (expInput.trim()) {
            const ms = Date.parse(expInput.trim());
            if (Number.isFinite(ms)) p.EXPIRATION = String(Math.floor(ms / 1000));
        }
        if (allowListIdx) p.ALLOW_LIST = allowListIdx;
        if (blockListIdx) p.BLOCK_LIST = blockListIdx;
        return p;
    }, [expInput, allowListIdx, blockListIdx]);

    const editHasChange = Object.keys(editParams).length > 0;

    async function submit(event) {
        event.preventDefault();
        if (submitting || lane.composing) return;
        if (type === 'edit') {
            if (!editHasChange) { setError('Change at least one field (expiration, allow-list, or block-list).'); return; }
            if (editParams.EXPIRATION && Number(editParams.EXPIRATION) <= Math.floor(Date.now() / 1000)) {
                setError('Expiration must be a future date and time.'); return;
            }
        }
        setSubmitting(true);
        setError(null);
        const orderActionIndex = String(row.action_index);
        // The wire params the confirm page composes and previews; the signing
        // flow rebuilds the same set from `orderActionIndex` and `params`.
        const params = isCancel
            ? { VERSION: '1', ORDER_ACTION_INDEX: orderActionIndex }
            : { VERSION: '2', ORDER_ACTION_INDEX: orderActionIndex, ...editParams };
        try {
            const res = await lane.run({
                actionData: { action: 'ORDER', params },
                encoderOpts: nativeFee.flag ? { payFeeInNativeCoin: true } : {},
                submitExtra: isCancel ? { orderActionIndex } : { orderActionIndex, params: editParams },
            });
            const txid = res?.txid || res?.broadcast?.txid;
            if (isCancel && txid && typeof onCancelBroadcast === 'function') onCancelBroadcast();
            setResult(res || {});
        } catch (err) {
            if (!isUserRejection(err)) {
                setError(err?.name === 'InvalidPasswordError' ? 'Incorrect password.' : submitFailureMessage(err, {
                    chainId,
                    mandatory: nativeFee.mandatory,
                    fallback: err?.message || `${isCancel ? 'Cancel' : 'Edit'} failed.`,
                }));
            }
        } finally {
            setSubmitting(false);
        }
    }

    const header = <PageHeader onBack={done ? onDone : onBack} title={isCancel ? 'Cancel order' : 'Edit order'} />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
    );

    if (listPickerFor) {
        return (
            <ListPickerScreen
                variant={variant}
                messaging={messaging}
                chainId={chainId}
                addresses={chainAddresses}
                filterType="2"
                title={listPickerFor === 'allow' ? 'Choose allow-list' : 'Choose block-list'}
                onSelect={(r) => {
                    if (listPickerFor === 'allow') setAllowListIdx(r.actionIndex); else setBlockListIdx(r.actionIndex);
                    setListPickerFor(null);
                }}
                onBack={() => setListPickerFor(null)}
            />
        );
    }

    if (lane.open) {
        return (
            <ActionConfirmScreen
                {...lane.confirmProps}
                confirmAction={withFormattedExpiration(lane.confirmProps.confirmAction)}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                signerReady={signerReady}
                hintClassName={F.hint}
            />
        );
    }

    if (done) {
        const txid = result.txid || result.broadcast?.txid;
        const explorerUrl = explorerPageUrl({
            chainId,
            kind: 'transaction',
            value: txid,
            settings,
        });
        // Signed but not broadcast yet: nothing changed on chain, so no success copy.
        if (result.queued) {
            return wrap(
                <QueuedResultPanel
                    onDone={onDone}
                    what={isCancel ? 'order cancel' : 'order edit'}
                    unsaved={result.unsaved}
                />,
            );
        }
        if (result.psbtHex && !txid) {
            return wrap(<WatcherResultPanel result={result} onDone={onDone} />);
        }
        return wrap(
            <>
                <h2 className={F.successTitle}>{isCancel ? 'Cancel broadcast' : 'Edit broadcast'}</h2>
                <p className={F.hint}>
                    {isCancel
                        ? 'The order will close and any escrow returns to you once the cancel confirms.'
                        : 'The order update will take effect once it confirms.'}
                </p>
                {txid ? (
                    <>
                        <p className={F.successLabel}>Transaction ID</p>
                        <code className={F.txid}>{txid}</code>
                        {explorerUrl ? (
                            <p className={F.hint}>
                                <a href={explorerUrl} target="_blank" rel="noopener noreferrer">View on explorer ↗</a>
                            </p>
                        ) : null}
                    </>
                ) : null}
                <div className={F.actions}><Button variant="primary" onClick={onDone}>Done</Button></div>
            </>,
        );
    }

    return wrap(
        <FormPage
            label={isCancel ? 'Cancel order' : 'Edit order'}
            onSubmit={submit}
            actions={(
                <Button
                    type="submit"
                    variant={isCancel ? 'danger' : 'primary'}
                    loading={submitting || lane.composing}
                    disabled={submitting || lane.composing || (type === 'edit' && !editHasChange)}
                >
                    {lane.isWatcherMode ? 'Create unsigned transaction' : (isCancel ? 'Cancel order' : 'Edit order')}
                </Button>
            )}
        >
            <p className={F.summary}>
                Give {sideLabel(row.give_tick, row.give_coin, row.give_amount, row.give_ownership)} → get{' '}
                {sideLabel(row.get_tick, row.get_coin, row.get_amount, row.get_ownership)}
            </p>
            <dl className={F.detailsList}>
                <dt className={F.detailsLabel}>Chain</dt>
                <dd className={F.detailsValue}>{descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}</dd>
                <dt className={F.detailsLabel}>Order</dt>
                <dd className={F.detailsValue}>#{row.action_index}</dd>
                <dt className={F.detailsLabel}>From</dt>
                <dd className={F.detailsValue}><AddressText address={owner.address} /></dd>
            </dl>

            {isCancel ? (
                <p className={F.hint}>
                    Cancelling closes the order and returns the escrowed
                    {isNativeGive(row) ? ' side' : ` ${row.give_tick}`} to you. If it has pending
                    CoinPay obligations, it stays &quot;cancelling&quot; until those settle.
                </p>
            ) : (
                <>
                    <Input
                        label="New expiration (optional)"
                        type="datetime-local"
                        hint="Choose a date and time. Leave blank to keep the current expiration."
                        value={expInput}
                        onChange={(e) => setExpInput(e.target.value)}
                    />
                    <p className={F.successLabel}>Access lists (optional)</p>
                    <div className={F.actions}>
                        <Button variant="secondary" size="sm" onClick={() => setListPickerFor('allow')}>
                            {allowListIdx === '0' ? 'Remove allow list' : (allowListIdx ? `Allow-list #${allowListIdx}` : 'Set allow-list')}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setListPickerFor('block')}>
                            {blockListIdx === '0' ? 'Remove block list' : (blockListIdx ? `Block-list #${blockListIdx}` : 'Set block-list')}
                        </Button>
                        {canRemoveList && currentAllowList && allowListIdx !== '0' ? (
                            <Button type="button" variant="secondary" size="sm" onClick={() => setAllowListIdx('0')}>Remove allow list</Button>
                        ) : null}
                        {canRemoveList && currentBlockList && blockListIdx !== '0' ? (
                            <Button type="button" variant="secondary" size="sm" onClick={() => setBlockListIdx('0')}>Remove block list</Button>
                        ) : null}
                    </div>
                    <p className={F.hint}>
                        Current: allow list {currentAllowList ? `#${currentAllowList}` : 'none'};
                        {' '}block list {currentBlockList ? `#${currentBlockList}` : 'none'}. A blank choice is left unchanged.
                    </p>
                </>
            )}

            {lane.isWatcherMode ? (
                <p className={F.hint}>
                    Watcher mode: this wallet will build an unsigned transaction. Sign it on your
                    Signer-mode wallet, then broadcast from a Full-mode wallet.
                </p>
            ) : null}
            {error ? <StatusMessage variant="error" className={F.error}>{error}</StatusMessage> : null}

        </FormPage>,
    );
}
