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
// and "expired" from the order's own EXPIRATION vs wall clock. Cancel/edit
// are offered only while an order is open.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AddressText, Button, ChainBadge, Input, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import { MarketLifecycleTimeline } from '../components/MarketLifecycleTimeline.jsx';
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

function deriveStatus(item, cancelledKeys, nowSec) {
    if (cancelledKeys.has(item.key)) return 'cancelled';
    if (String(item.row.status || 'valid') !== 'valid') return 'invalid';
    const exp = Number(item.row.expiration);
    if (Number.isFinite(exp) && exp > 0 && exp <= nowSec) return 'expired';
    return 'open';
}

function fmtDate(unixSec) {
    const n = Number(unixSec);
    if (!Number.isFinite(n) || n <= 0) return null;
    try { return new Date(n * 1000).toLocaleString(); } catch { return null; }
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
    const isFull = variant === 'full';

    const [items, setItems] = useState(/** @type {any[] | null} */ (null));
    const [byChain, setByChain] = useState(/** @type {Record<string, any[]>} */ ({}));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [autopayByKey, setAutopayByKey] = useState(/** @type {Map<string, any>} */ (new Map()));
    const [activeAction, setActiveAction] = useState(/** @type {{ type: 'cancel' | 'edit', item: any } | null} */ (null));
    // PC-21: which order's lifecycle timeline is expanded inline (by row key).
    const [timelineKey, setTimelineKey] = useState(/** @type {string | null} */ (null));
    const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

    useEffect(() => {
        const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30000);
        return () => clearInterval(t);
    }, []);

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
                messaging.getOrdersForAddress({ chainId: p.chainId, address: p.owner.address }).catch(() => null),
                (typeof messaging.getOrderCancelsForAddress === 'function'
                    ? messaging.getOrderCancelsForAddress({ chainId: p.chainId, address: p.owner.address }).catch(() => null)
                    : Promise.resolve(null)),
            ]).then(([o, c]) => ({ p, orders: extractRows(o), cancels: extractRows(c) }))));

            const cancelledKeys = new Set();
            for (const r of results) {
                for (const c of r.cancels) {
                    if (String(c.source) === r.p.owner.address) {
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
            setItems(all.map((it) => ({ ...it, cancelledKeys })));
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
            <div className={isFull ? L.wrapFull : L.wrapPopup}>{children}</div>
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
                onBack={() => setActiveAction(null)}
            />
        );
    }

    if (items === null) return wrap(<p className={L.hint}>Loading your orders…</p>);
    if (loadError) return wrap(<StatusMessage variant="error" className={L.hint}>{loadError}</StatusMessage>);
    if (items.length === 0) {
        return wrap(
            <div className={L.empty}>
                <p className={L.emptyTitle}>No orders yet</p>
                <p className={L.hint}>Orders you place on the DEX show up here across every pair.</p>
                {onCreateOrder ? <div className={F.actions}><Button variant="primary" onClick={onCreateOrder}>Create an order</Button></div> : null}
            </div>,
        );
    }

    const openItems = items.filter((it) => deriveStatus(it, it.cancelledKeys, nowSec) === 'open');
    const closedItems = items.filter((it) => deriveStatus(it, it.cancelledKeys, nowSec) !== 'open');

    const renderRow = (it) => {
        const status = deriveStatus(it, it.cancelledKeys, nowSec);
        const descriptor = chainRegistry.get(it.chainId);
        const give = sideLabel(it.row.give_tick, it.row.give_coin, it.row.give_amount, it.row.give_ownership);
        const get = sideLabel(it.row.get_tick, it.row.get_coin, it.row.get_amount, it.row.get_ownership);
        const expText = fmtDate(it.row.expiration);
        const consent = autopayByKey.get(it.key);
        const chip = status === 'open'
            ? <span className={`${L.chip} ${L.chipOpen}`}>Open</span>
            : <span className={`${L.chip} ${L.chipExpired}`}>{status === 'cancelled' ? 'Cancelled' : status === 'expired' ? 'Expired' : 'Invalid'}</span>;
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
                    {expText ? <div className={L.rowDetail}>Expires {expText}</div> : null}
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
            {openItems.length > 0 ? (
                <ul className={L.list} role="list" aria-label="Open orders">{openItems.map(renderRow)}</ul>
            ) : <p className={L.hint}>No open orders.</p>}
            {closedItems.length > 0 ? (
                <>
                    <p className={L.sectionLabel}>Closed</p>
                    <ul className={L.list} role="list" aria-label="Closed orders">{closedItems.map(renderRow)}</ul>
                </>
            ) : null}
        </>,
    );
}

/**
 * Cancel (ORDER v1) or Edit (ORDER v2) an open order, signed from its
 * owner address. Mirrors OpenOrdersPanel's cancel confirm: software
 * signers type their password, HW signers slot in through SignCredentials.
 */
function OrderActionPanel({ type, item, chainAddresses, variant, walletId, messaging, onDone, onBack }) {
    const { chainId, owner, row } = item;
    const descriptor = chainRegistry.get(chainId);
    const hw = isHwSource(owner);
    const from = {
        address: owner.address,
        publicKey: owner.publicKey,
        derivationPath: owner.derivationPath,
        addressId: owner.id,
        source: owner.source,
        signerId: owner.signerId,
    };

    const [password, setPassword] = useState('');
    const [hwStatus, setHwStatus] = useState('idle');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [done, setDone] = useState(false);

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
        if (submitting) return;
        if (!hw && password.length === 0) return;
        if (hw && hwStatus !== 'available') return;
        if (type === 'edit') {
            if (!editHasChange) { setError('Change at least one field (expiration, allow-list, or block-list).'); return; }
            if (editParams.EXPIRATION && Number(editParams.EXPIRATION) <= Math.floor(Date.now() / 1000)) {
                setError('Expiration must be a future date and time.'); return;
            }
        }
        setSubmitting(true);
        setError(null);
        const base = { walletId, chainId, from, orderActionIndex: String(row.action_index) };
        try {
            if (type === 'cancel') {
                if (hw) await messaging.cancelOrderHw({ ...base, signerId: owner.signerId });
                else await messaging.cancelOrder({ ...base, password });
            } else {
                const withParams = { ...base, params: editParams };
                if (hw) await messaging.editOrderHw({ ...withParams, signerId: owner.signerId });
                else await messaging.editOrder({ ...withParams, password });
            }
            setDone(true);
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            setError(bad ? 'Incorrect password.' : (err?.message || `${type === 'cancel' ? 'Cancel' : 'Edit'} failed.`));
            setSubmitting(false);
        }
    }

    const isCancel = type === 'cancel';
    const header = <PageHeader onBack={done ? onDone : onBack} title={isCancel ? 'Cancel order' : 'Edit order'} />;
    const isFull = variant === 'full';
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={F.card}>{children}</div> : children}
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

    if (done) {
        return wrap(
            <>
                <h2 className={F.successTitle}>{isCancel ? 'Cancel broadcast' : 'Edit broadcast'}</h2>
                <p className={F.hint}>
                    {isCancel
                        ? 'The order will close and any escrow returns to you once the cancel confirms.'
                        : 'The order update will take effect once it confirms.'}
                </p>
                <div className={F.actions}><Button variant="primary" onClick={onDone}>Done</Button></div>
            </>,
        );
    }

    return wrap(
        <form onSubmit={submit} noValidate>
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
                        hint="Unix wall-clock time. Leave blank to keep the current expiration."
                        value={expInput}
                        onChange={(e) => setExpInput(e.target.value)}
                    />
                    <p className={F.successLabel}>Access lists (optional)</p>
                    <div className={F.actions}>
                        <Button variant="secondary" size="sm" onClick={() => setListPickerFor('allow')}>
                            {allowListIdx ? `Allow-list #${allowListIdx}` : 'Set allow-list'}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setListPickerFor('block')}>
                            {blockListIdx ? `Block-list #${blockListIdx}` : 'Set block-list'}
                        </Button>
                    </div>
                    <p className={F.hint}>
                        A blank field is left unchanged. A bound list can be replaced but not removed
                        (point it at an empty list to lift a restriction).
                    </p>
                </>
            )}

            <SignCredentials
                unlocked={false}
                fromAddress={from}
                chainId={chainId}
                password={password}
                onPasswordChange={(v) => { setPassword(v); if (error) setError(null); }}
                onStatusChange={setHwStatus}
                submitError={error}
                disabled={submitting}
                getSignerStatus={messaging.getSignerStatus}
            />
            {error && hw ? <StatusMessage variant="error" className={F.error}>{error}</StatusMessage> : null}

            <div className={F.actions}>
                <Button
                    type="submit"
                    variant={isCancel ? 'danger' : 'primary'}
                    loading={submitting}
                    disabled={hw ? hwStatus !== 'available' : (password.length === 0 || (type === 'edit' && !editHasChange))}
                >
                    {hw ? `Sign on ${owner.source === 'trezor' ? 'Trezor' : 'Ledger'}` : (isCancel ? 'Sign cancel' : 'Sign edit')}
                </Button>
            </div>
        </form>,
    );
}
