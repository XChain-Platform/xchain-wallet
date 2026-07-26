// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
    FeeSelector,
 Icon,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
    flows as flowsLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { formatWithThousands } from '../utils/amountFormat.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { multiplyAmounts } from '../../market/orderMath.js';
import {
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { coinToFiat } from '../../flows/priceLookup.js';
import { useFiatRate } from '../hooks/useFiatRate.js';
import { useSettings } from '../hooks/useSettings.js';
import * as branding from '../../branding/branding.js';
import { explorerCoinCode } from '../../registry/coinTicker.js';
import styles from './IssueTokenForm.module.css';
import local from './DispenserDetail.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Address rows in the stats hero: one line, full address shown when it
// fits, CSS-ellipsized only when the cell actually runs out of width
// (never the fixed first6…last6 truncation, never a second line).
const ADDRESS_CELL_STYLE = {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
};

/**
 * Dispenser detail page (§40.7.1): management surface for a single
 * dispenser. Step 22a surfaces:
 *
 *   - Static metadata (rate, give/get coins + ticks, creator, memo,
 *     block + status) pulled via `dispensers.byActionIndex`.
 *   - Recent dispense events (fills) via `dispenses.query` with
 *     type='source' scoped to the dispenser's source address (the
 *     explorer doesn't yet have a by-dispenser-action-index dispense
 *     query).
 *   - For owners (source address is one of the wallet's addresses),
 *     owner actions via `messaging.dispenserAction` with a password
 *     re-prompt (HW via `dispenserActionHw`): Close (v1 cancel),
 *     Refill (v2 edit topping up GIVE_ESCROW), and Edit (v2 edit of
 *     EXPIRATION / ALLOW_LIST / BLOCK_LIST, PC-19). All owner actions
 *     gate on the live status (open only).
 *   - State display: current expiration + allow/block lists, dispenses
 *     this fill against the 1,000 cap, and a close-window banner while
 *     the dispenser sits in its 1-hour "cancelling" state.
 *
 * Refills-remaining (of the 5-refill / 6,000-lifetime ceiling) is the
 * one deferred counter: the explorer's dispenser row exposes neither a
 * refill_count nor per-edit give_escrow (getDispenserEdits omits it), so
 * the wallet states the cap as policy copy on the refill form instead of
 * a live count until that field lands (see xchain-explorer/src/db.js).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.actionIndex
 * @param {() => void} props.onBack
 * @param {() => void} [props.onCanceled]           called after a successful cancel broadcast
 */
export function DispenserDetail({ walletId, chainId, actionIndex, onBack, onCanceled }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [dispenser, setDispenser] = useState(/** @type {any | null} */ (null));
    const [action, setAction] = useState(/** @type {any | null} */ (null));
    const [dispenses, setDispenses] = useState(/** @type {any[]} */ ([]));
    // PC-21 trade lifecycle: non-dispense events (refills/edits, closes,
    // expirations) merged with dispenses into one timeline under a tab.
    const [lifecycle, setLifecycle] = useState(/** @type {any[]} */ ([]));
    const [tab, setTab] = useState(/** @type {'dispenses' | 'lifecycle'} */ ('dispenses'));
    const [ownerAddress, setOwnerAddress] = useState(
        /** @type {any | null} */ (null),
    );
    const [buyerAddresses, setBuyerAddresses] = useState(/** @type {any[]} */ ([]));
    const [buyerAddressId, setBuyerAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    // Refill (DISPENSER v2 edit: top up GIVE_ESCROW) mirrors the cancel flow.
    const [refillStage, setRefillStage] = useState(
        /** @type {'idle' | 'confirm' | 'submitting' | 'done'} */ ('idle'),
    );
    const [refillAmount, setRefillAmount] = useState('');
    const [refillError, setRefillError] = useState(/** @type {string | null} */ (null));
    const [refillResult, setRefillResult] = useState(/** @type {any | null} */ (null));
    // Owner's spendable balance of the give tick (coin-scale string),
    // backing the refill AmountField's Max button + "available" footer.
    const [refillBalance, setRefillBalance] = useState(
        /** @type {string | null} */ (null),
    );

    // Edit (DISPENSER v2: reschedule EXPIRATION / update ALLOW_LIST /
    // BLOCK_LIST). Blank = leave unchanged (the indexer treats a null
    // field as "keep current"), so the form shows current values as
    // read-only context and only sends the fields the owner fills in.
    const [editStage, setEditStage] = useState(
        /** @type {'idle' | 'confirm' | 'submitting' | 'done'} */ ('idle'),
    );
    const [editExpiration, setEditExpiration] = useState('');
    const [editAllowList, setEditAllowList] = useState('');
    const [editBlockList, setEditBlockList] = useState('');
    const [editError, setEditError] = useState(/** @type {string | null} */ (null));
    const [editResult, setEditResult] = useState(/** @type {any | null} */ (null));
    // Which fields the last submitted edit actually changed, so the done
    // screen can tailor its 1-hour-list-delay note.
    const [editedLists, setEditedLists] = useState(false);
    // Quick-action "More" popover.
    const [moreOpen, setMoreOpen] = useState(false);
    const moreWrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    useEffect(() => {
        if (!moreOpen) return undefined;
        const onDown = (e) => {
            if (moreWrapRef.current?.contains(e.target)) return;
            setMoreOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [moreOpen]);
    // Resolve the owner's give-tick balance when the refill form opens.
    useEffect(() => {
        const tick = String(dispenser?.give_tick || '').toUpperCase();
        if (refillStage === 'idle' || refillStage === 'done' || !ownerAddress || !tick) return undefined;
        if (typeof messaging.getWalletBalances !== 'function') return undefined;
        let cancelled = false;
        messaging.getWalletBalances(walletId)
            .then((byChain) => {
                if (cancelled || !byChain) return;
                const entries = byChain[chainId] || [];
                const entry = entries.find((e) => e && e.address === ownerAddress.address);
                const rows = entry ? decoderLib.balancesFromSdk(entry.balances) || [] : [];
                const match = rows.find((b) => String(b.tick).toUpperCase() === tick);
                setRefillBalance(match ? String(match.amount) : '0');
            })
            .catch(() => { /* footer just stays empty on failure */ });
        return () => { cancelled = true; };
    }, [refillStage, dispenser, ownerAddress, chainId, walletId, messaging]);

    const [cancelStage, setCancelStage] = useState(
        /** @type {'idle' | 'confirm' | 'submitting' | 'done'} */ ('idle'),
    );
    const [password, setPassword] = useState('');
    const [cancelError, setCancelError] = useState(/** @type {string | null} */ (null));
    const [cancelResult, setCancelResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Buy-one-fill state (token-paid lane only; coin-paid uses the
    // instructions panel rather than a signed XChain SEND).
    const [fills, setFills] = useState('1');
    const [buyStage, setBuyStage] = useState(
        /** @type {'idle' | 'confirm' | 'submitting' | 'done'} */ ('idle'),
    );
    const [buyPassword, setBuyPassword] = useState('');
    const [buyError, setBuyError] = useState(/** @type {string | null} */ (null));
    const [buyResult, setBuyResult] = useState(/** @type {any | null} */ (null));
    const buyPasswordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const [copied, setCopied] = useState(/** @type {string | null} */ (null));

    const descriptor = chainRegistry.get(chainId);

    // Network-fee tier picker (Low / Normal / Fast / Custom) shared by the
    // close and refill forms, mirroring ComposeMessage / Send.
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId, chainRegistry }),
        [chainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [chainId, feePick],
    );
    const selectedFeeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : null);
    // Picked rate in the encoder's feePerKb unit; null falls back to the
    // encoder's default pricing.
    const feePerKb = (selectedFeeEstimate && selectedFeeEstimate.unit
        && Number.isFinite(selectedFeeEstimate.rateValue) && selectedFeeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(selectedFeeEstimate.unit, selectedFeeEstimate.rateValue)
        : null;
    const { settings } = useSettings();
    const feeFiatRate = useFiatRate({
        chainCoin: descriptor?.coin,
        fiatCurrency: 'USD',
        allowCoingeckoFallback: settings?.privacy?.priceDataEnabled !== false,
    });
    const fiatForFee = useMemo(() => (coinAmount) => {
        const v = coinToFiat(coinAmount, feeFiatRate);
        if (v == null || !Number.isFinite(v) || v <= 0) return null;
        return v < 0.01 ? '< $0.01' : `$${v.toFixed(2)}`;
    }, [feeFiatRate]);
    const NATIVE_TICKER_BY_CHAIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
    const feeCoinTicker = descriptor?.coin
        ? (NATIVE_TICKER_BY_CHAIN[descriptor.coin] || descriptor.coin.toUpperCase())
        : '';
    const feeSelector = feeTiers ? (
        <FeeSelector
            label="Network fee"
            coinTicker={feeCoinTicker}
            formatFiat={fiatForFee}
            tiers={feeTiers}
            value={feePick}
            onChange={setFeePick}
            customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
        />
    ) : null;

    // Load the dispenser action + wallet addresses (to detect ownership)
    // in parallel. Recent dispenses come on a best-effort basis;
    // failure there still lets the user see the dispenser metadata.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        // Demo wallet: resolve the fixture row (owned by the first address
        // on this chain) instead of querying an explorer.
        const isDemo = flowsLib.isDemoWallet(walletId);
        Promise.all([
            isDemo
                ? Promise.resolve(null)
                : messaging.getDispenserByActionIndex({ chainId, actionIndex })
                    .then((resp) => (cancelled ? null : resp))
                    .catch((err) => { if (!cancelled) throw err; }),
            messaging.getAddressesByChain(walletId)
                .then((byChain) => (cancelled ? null : byChain))
                .catch(() => null),
        ]).then(([realResp, addrsByChain]) => {
            let resp = realResp;
            if (isDemo && !cancelled) {
                const first = (addrsByChain?.[chainId] || [])[0]?.address;
                const rows = first ? flowsLib.synthesizeDemoDispensers(chainId, first) : [];
                resp = rows.find((r) => String(r.action_index) === String(actionIndex)) || null;
            }
            if (cancelled) return;
            const act = pickAction(resp);
            const disp = pickDispenser(resp);
            if (!act) {
                setLoadError('Action not found.');
                setLoading(false);
                return;
            }
            setAction(act);
            setDispenser(disp);

            const source = disp?.source || act?.source;
            if (addrsByChain) {
                const onChain = (addrsByChain[chainId] || []);
                if (source) {
                    const matches = onChain.find((a) => a.address === source);
                    if (matches) setOwnerAddress(matches);
                }
                // Pre-populate the buyer-address picker with this wallet's
                // HD addresses on the dispenser's chain. Non-HD (watch-
                // only) addresses are filtered out because they can't
                // sign. The default is the newest external address,
                // matching the convention used by Send / MintForm.
                const spendable = onChain.filter(
                    (a) => a.source === 'hd'
                        && a.derivationPath?.split('/')?.[4] === '0',
                );
                setBuyerAddresses(spendable);
                if (spendable.length > 0) {
                    const sorted = [...spendable].sort((a, b) => {
                        const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                        const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                        return bi - ai;
                    });
                    setBuyerAddressId(sorted[0].id);
                }
            }
            setLoading(false);

            if (isDemo) {
                setDispenses(flowsLib.synthesizeDemoDispenses(actionIndex));
            } else if (source) {
                messaging.getDispenses({ chainId, query: source, type: 'source' })
                    .then((d) => { if (!cancelled) setDispenses(extractRows(d)); })
                    .catch(() => { /* best-effort; detail still usable without dispenses */ });
                // PC-21: the rest of the lifecycle (refills/edits, closes,
                // expirations). Best-effort; scoped to this dispenser by its
                // action index when the event rows carry it.
                if (typeof messaging.getDispenserLifecycle === 'function') {
                    Promise.all(['edits', 'closes', 'expires'].map((kind) => messaging
                        .getDispenserLifecycle({ chainId, kind, query: source, type: 'address' })
                        .then((r) => ({ kind, rows: extractRows(r) }))
                        .catch(() => ({ kind, rows: [] }))))
                        .then((results) => {
                            if (cancelled) return;
                            const evs = [];
                            for (const { kind, rows } of results) {
                                for (const row of rows) {
                                    const dai = row.dispenser_action_index;
                                    if (dai != null && String(dai) !== String(actionIndex)) continue;
                                    evs.push({ kind, row });
                                }
                            }
                            setLifecycle(evs);
                        })
                        .catch(() => { /* best-effort */ });
                }
            }
        }).catch((err) => {
            if (!cancelled) {
                setLoadError(err?.message || 'Failed to load dispenser.');
                setLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, [walletId, chainId, actionIndex, messaging]);

    useEffect(() => {
        if (cancelStage === 'confirm') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [cancelStage]);

    useEffect(() => {
        if (buyStage === 'confirm') {
            setTimeout(() => buyPasswordRef.current?.focus(), 0);
        }
    }, [buyStage]);

    const cancelParams = useMemo(() => ({
        VERSION: '1',
        DISPENSER_ACTION_INDEX: String(actionIndex),
    }), [actionIndex]);

    const decodedCancel = useMemo(() => {
        if (cancelStage !== 'confirm' && cancelStage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'DISPENSER',
            params: cancelParams,
            chainId,
            chainRegistry,
        });
    }, [cancelStage, cancelParams, chainId]);

    // Buyer lanes:
    //   - Token-paid (dispenser.get_tick non-empty): triggered by an
    //     XChain SEND of GET_TICK to the dispenser address. Uses the
    //     existing messaging.sendToken flow, so the wallet signs +
    //     broadcasts through the standard pipeline.
    //   - Coin-paid (dispenser.get_coin set, dispenser.get_tick empty):
    //     triggered by a bare native-coin payment to the dispenser
    //     address per DISPENSER.md ("no XChain action needed from the buyer").
    //     The wallet doesn't yet have a bare-coin-send path, so this lane
    //     renders a pay-here instruction panel that works with any native
    //     coin wallet (including this one, via future native-send infra).
    const getTick = dispenser?.get_tick || '';
    const getCoin = dispenser?.get_coin || '';
    const getAmount = dispenser?.get_amount;
    const giveTick = dispenser?.give_tick;
    const giveAmount = dispenser?.give_amount;
    // Where a buyer sends payment. The by-action-index read path returns the
    // flattened action row, which carries `get_address`/`source` but no
    // `address` column, so keying only on `address` left the pay-to-buy panel
    // showing a blank address and kept the token-paid Buy button disabled.
    // Order follows the protocol: GET_ADDRESS when the dispenser set one,
    // otherwise the source that opened it.
    const dispAddr = dispenser?.address
        || dispenser?.get_address
        || dispenser?.source
        || action?.source
        || '';
    // Live status: `current_status` reflects post-create transitions (the
    // 1-hour "cancelling" close window, expiry, sold-out), falling back to
    // the create `status` for demo fixtures that carry only that field.
    const liveStatus = String(dispenser?.current_status || dispenser?.status || '');
    const isOpen = liveStatus === 'open';
    const isClosing = liveStatus === 'cancelling';
    const currentExpiration = dispenser?.expiration;
    const currentAllowList = dispenser?.allow_list;
    const currentBlockList = dispenser?.block_list;
    // Fills this dispenser can still pay out, shown as a bubble next to the
    // dispense count. Needs both the live escrow and the per-fill give amount.
    const remainingFills = useMemo(
        () => remainingFillsFrom(dispenser?.escrow_remaining, dispenser?.give_amount),
        [dispenser],
    );
    const isTokenPaid = Boolean(getTick) && !!getAmount;
    const isCoinPaid = !getTick && Boolean(getCoin) && !!getAmount;
    const canBuyWithSend = isTokenPaid && buyerAddresses.length > 0 && !ownerAddress;
    const showPayHere = isCoinPaid && !ownerAddress;

    const fillsNum = useMemo(() => {
        const n = Number(String(fills).trim());
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }, [fills]);

    const totalPayAmount = useMemo(() => {
        if (!getAmount || fillsNum <= 0) return null;
        // `handleBuy` sends this exact value on the wire as the SEND amount,
        // so it must be computed in exact decimal space. Float multiplication
        // drifts ('0.1' x 3 -> '0.30000000000000004') and collapses tiny
        // amounts to scientific notation ('0.00000001' x 3 -> '3e-8'), either
        // of which the encoder rejects or mis-prices. The display string is
        // derived from this same exact value.
        return multiplyAmounts(getAmount, String(fillsNum));
    }, [getAmount, fillsNum]);

    const totalReceive = useMemo(() => {
        if (!giveAmount || fillsNum <= 0) return null;
        return multiplyAmounts(giveAmount, String(fillsNum));
    }, [giveAmount, fillsNum]);

    async function handleCopy(text, label) {
        try {
            await navigator.clipboard?.writeText(text);
            setCopied(label);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            /* swallow; older browsers or locked-down contexts */
        }
    }

    const buyerAddress = useMemo(() => {
        if (!buyerAddressId) return null;
        return buyerAddresses.find((a) => a.id === buyerAddressId) || null;
    }, [buyerAddressId, buyerAddresses]);

    const buyHw = isHwSource(buyerAddress);
    const cancelHw = isHwSource(ownerAddress);
    const [buyHwStatus, setBuyHwStatus] = useState('idle');
    const [cancelHwStatus, setCancelHwStatus] = useState('idle');
    const onBuyHwStatusChange = useCallback(({ status }) => setBuyHwStatus(status), []);
    const onCancelHwStatusChange = useCallback(({ status }) => setCancelHwStatus(status), []);

    async function handleBuy(event) {
        event.preventDefault();
        if (buyStage === 'submitting' || !buyerAddress) return;
        if (!buyHw && (!signerReady && buyPassword.length === 0)) return;
        if (buyHw && buyHwStatus !== 'available') return;
        if (!isTokenPaid || !dispAddr || !totalPayAmount) return;
        setBuyStage('submitting');
        setBuyError(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: buyerAddress.address,
                    publicKey: buyerAddress.publicKey,
                    derivationPath: buyerAddress.derivationPath,
                    addressId: buyerAddress.id,
                    source: buyerAddress.source,
                    signerId: buyerAddress.signerId,
                },
                to: dispAddr,
                tick: getTick,
                amount: totalPayAmount,
            };
            const res = buyHw
                ? await messaging.sendAssetHw({ ...base, signerId: buyerAddress.signerId })
                : await messaging.sendToken({ ...base, password: buyPassword });
            setBuyResult(res);
            setBuyPassword('');
            setBuyStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setBuyError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Buy failed.',
            );
            setBuyStage('confirm');
            if (!buyHw) {
                buyPasswordRef.current?.focus();
                buyPasswordRef.current?.select();
            }
        }
    }

    async function handleRefill(event) {
        event.preventDefault();
        if (refillStage === 'submitting' || !ownerAddress) return;
        const amt = refillAmount.trim();
        if (!amt || !(Number(amt) > 0)) { setRefillError('Enter a refill amount.'); return; }
        if (!cancelHw && (!signerReady && password.length === 0)) return;
        if (cancelHw && cancelHwStatus !== 'available') return;
        setRefillStage('submitting');
        setRefillError(null);
        // Demo wallet: fabricated dispensers can't broadcast; simulate.
        if (flowsLib.isDemoWallet(walletId)) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            setRefillResult({ txid: null });
            setPassword('');
            setRefillStage('done');
            return;
        }
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: ownerAddress.address,
                    publicKey: ownerAddress.publicKey,
                    derivationPath: ownerAddress.derivationPath,
                    addressId: ownerAddress.id,
                    source: ownerAddress.source,
                    signerId: ownerAddress.signerId,
                },
                params: {
                    VERSION: '2',
                    DISPENSER_ACTION_INDEX: String(actionIndex),
                    GIVE_ESCROW: amt,
                },
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            const res = cancelHw
                ? await messaging.dispenserActionHw({ ...base, signerId: ownerAddress.signerId })
                : await messaging.dispenserAction({ ...base, password });
            setRefillResult(res);
            setPassword('');
            setRefillStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setRefillError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Refill failed.',
            );
            setRefillStage('confirm');
            if (!cancelHw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    async function handleEdit(event) {
        event.preventDefault();
        if (editStage === 'submitting' || !ownerAddress) return;
        if (!cancelHw && (!signerReady && password.length === 0)) return;
        if (cancelHw && cancelHwStatus !== 'available') return;

        // Assemble only the fields the owner filled in; a blank field is
        // left unchanged (indexer null = keep current). Refill lives in its
        // own flow, so GIVE_ESCROW is never touched here.
        const params = { VERSION: '2', DISPENSER_ACTION_INDEX: String(actionIndex) };
        let changedLists = false;

        const expTrim = editExpiration.trim();
        if (expTrim) {
            const unix = localInputToUnix(expTrim);
            const nowSec = Math.floor(Date.now() / 1000);
            if (!unix || unix <= nowSec) {
                setEditError('Expiration must be a future date and time.');
                return;
            }
            params.EXPIRATION = String(unix);
        }
        const alTrim = editAllowList.trim();
        if (alTrim) {
            if (!/^\d+$/.test(alTrim)) { setEditError('Allow list must be a LIST action index (digits only).'); return; }
            params.ALLOW_LIST = alTrim;
            changedLists = true;
        }
        const blTrim = editBlockList.trim();
        if (blTrim) {
            if (!/^\d+$/.test(blTrim)) { setEditError('Block list must be a LIST action index (digits only).'); return; }
            params.BLOCK_LIST = blTrim;
            changedLists = true;
        }
        if (params.EXPIRATION === undefined && params.ALLOW_LIST === undefined && params.BLOCK_LIST === undefined) {
            setEditError('Change at least one field to submit an edit.');
            return;
        }

        setEditStage('submitting');
        setEditError(null);
        // Demo wallet: fabricated dispensers can't broadcast; simulate.
        if (flowsLib.isDemoWallet(walletId)) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            setEditResult({ txid: null });
            setEditedLists(changedLists);
            setPassword('');
            setEditStage('done');
            return;
        }
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: ownerAddress.address,
                    publicKey: ownerAddress.publicKey,
                    derivationPath: ownerAddress.derivationPath,
                    addressId: ownerAddress.id,
                    source: ownerAddress.source,
                    signerId: ownerAddress.signerId,
                },
                params,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            const res = cancelHw
                ? await messaging.dispenserActionHw({ ...base, signerId: ownerAddress.signerId })
                : await messaging.dispenserAction({ ...base, password });
            setEditResult(res);
            setEditedLists(changedLists);
            setPassword('');
            setEditStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setEditError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Edit failed.',
            );
            setEditStage('confirm');
            if (!cancelHw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    async function handleCancel(event) {
        event.preventDefault();
        if (cancelStage === 'submitting' || !ownerAddress) return;
        if (!cancelHw && (!signerReady && password.length === 0)) return;
        if (cancelHw && cancelHwStatus !== 'available') return;
        setCancelStage('submitting');
        setCancelError(null);
        // Demo wallet: fabricated dispensers can't broadcast; simulate.
        if (flowsLib.isDemoWallet(walletId)) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            setCancelResult({ txid: null });
            setPassword('');
            setCancelStage('done');
            return;
        }
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: ownerAddress.address,
                    publicKey: ownerAddress.publicKey,
                    derivationPath: ownerAddress.derivationPath,
                    addressId: ownerAddress.id,
                    source: ownerAddress.source,
                    signerId: ownerAddress.signerId,
                },
                params: cancelParams,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            const res = cancelHw
                ? await messaging.dispenserActionHw({ ...base, signerId: ownerAddress.signerId })
                : await messaging.dispenserAction({ ...base, password });
            setCancelResult(res);
            setPassword('');
            setCancelStage('done');
            onCanceled?.();
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setCancelError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Cancel failed.',
            );
            setCancelStage('confirm');
            if (!cancelHw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

        const header = (
        <PageHeader
            onBack={onBack}
            titleIcon={<Icon.TokenIcon />}
            title={cancelStage === 'confirm' || cancelStage === 'submitting'
                    ? 'Confirm close'
                    : refillStage === 'confirm' || refillStage === 'submitting'
                        ? 'Refill dispenser'
                        : editStage === 'confirm' || editStage === 'submitting'
                            ? 'Edit dispenser'
                            : buyStage === 'confirm' || buyStage === 'submitting'
                                ? 'Review buy'
                                : 'Dispenser detail'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loading) return wrap(<p className={styles.hint}>Loading…</p>);
    if (loadError) return wrap(<div role="alert" className={styles.error}>{loadError}</div>);

    if (cancelStage === 'done') {
        const txid = cancelResult?.txid || cancelResult?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Cancel submitted</h2>
                <p className={styles.hint}>
                    The dispenser enters a 1-hour close window before remaining escrow is released.
                </p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (refillStage === 'done') {
        const txid = refillResult?.txid || refillResult?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Refill submitted</h2>
                <p className={styles.hint}>
                    {refillAmount} {giveTick} moves into escrow when the edit confirms.
                </p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={() => { setRefillStage('idle'); setRefillAmount(''); }}>
                        Done
                    </Button>
                </div>
            </>,
        );
    }

    if (refillStage === 'confirm' || refillStage === 'submitting') {
        return wrap(
            <form onSubmit={handleRefill} noValidate>
                <p className={styles.summary}>
                    Refill dispenser #{actionIndex}: add {giveTick} to escrow.
                </p>
                <p className={styles.hint}>
                    A refill resets the per-fill dispense counter (1,000 dispenses per
                    fill). A dispenser allows up to 5 refills (6,000 lifetime dispenses);
                    a 6th refill is rejected.
                </p>
                <AmountField
                    label="Refill amount"
                    amount={refillAmount}
                    tick={giveTick || ''}
                    onAmountFieldChange={(rawValue) => {
                        const stripped = String(rawValue).replace(/,/g, '');
                        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                        setRefillAmount(stripped);
                        if (refillError) setRefillError(null);
                    }}
                    onMax={refillBalance && Number(refillBalance) > 0
                        ? () => {
                            setRefillAmount(refillBalance);
                            if (refillError) setRefillError(null);
                        }
                        : undefined}
                    maxDisabled={!refillBalance}
                    balanceText={refillBalance != null
                        ? `${formatWithThousands(refillBalance)} ${giveTick || ''} available`.replace(/\s+/g, ' ')
                        : null}
                />
                {feeSelector}
                <SignCredentials
                    unlocked={signerReady}
                    fromAddress={ownerAddress}
                    chainId={chainId}
                    password={password}
                    onPasswordChange={(v) => {
                        setPassword(v);
                        if (refillError) setRefillError(null);
                    }}
                    onStatusChange={onCancelHwStatusChange}
                    passwordRef={passwordRef}
                    submitError={refillError}
                    disabled={refillStage === 'submitting'}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {cancelHw && refillError ? (
                    <div role="alert" className={styles.error}>{refillError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={refillStage === 'submitting'}
                        disabled={cancelHw ? cancelHwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        {cancelHw
                            ? `Sign refill on ${ownerAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : 'Sign refill'}
                    </Button>
                </div>
            </form>,
        );
    }

    if (editStage === 'done') {
        const txid = editResult?.txid || editResult?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Edit submitted</h2>
                <p className={styles.hint}>
                    {editedLists
                        ? 'Allow/block list changes take effect about 1 hour after this transaction confirms; any expiration change applies on confirmation.'
                        : 'The change applies when this transaction confirms.'}
                </p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        variant="primary"
                        onClick={() => {
                            setEditStage('idle');
                            setEditExpiration('');
                            setEditAllowList('');
                            setEditBlockList('');
                        }}
                    >
                        Done
                    </Button>
                </div>
            </>,
        );
    }

    if (editStage === 'confirm' || editStage === 'submitting') {
        const anyListFilled = Boolean(editAllowList.trim() || editBlockList.trim());
        return wrap(
            <form onSubmit={handleEdit} noValidate>
                <p className={styles.summary}>
                    Edit dispenser #{actionIndex}: reschedule its close time or update its
                    allow/block lists. Leave a field blank to keep it unchanged.
                </p>
                <Input
                    type="datetime-local"
                    label="New expiration"
                    hint={currentExpiration
                        ? `Current: ${formatUnixDate(currentExpiration)}. Enter a new date to reschedule the automatic close.`
                        : 'No expiration set. Enter a date to schedule an automatic close.'}
                    value={editExpiration}
                    onChange={(e) => { setEditExpiration(e.target.value); if (editError) setEditError(null); }}
                    autoComplete="off"
                />
                <Input
                    label="Allow list"
                    inputMode="numeric"
                    hint={`Current: ${currentAllowList ? `#${currentAllowList}` : 'none'}. Enter a LIST action index to limit who can trigger this dispenser.`}
                    value={editAllowList}
                    onChange={(e) => { setEditAllowList(e.target.value); if (editError) setEditError(null); }}
                    autoComplete="off"
                />
                <Input
                    label="Block list"
                    inputMode="numeric"
                    hint={`Current: ${currentBlockList ? `#${currentBlockList}` : 'none'}. Enter a LIST action index to bar addresses from triggering it.`}
                    value={editBlockList}
                    onChange={(e) => { setEditBlockList(e.target.value); if (editError) setEditError(null); }}
                    autoComplete="off"
                />
                {anyListFilled ? (
                    <p className={styles.hint}>
                        Allow/block list changes take effect about 1 hour after this
                        transaction confirms, per the dispenser list-edit delay.
                    </p>
                ) : null}
                {feeSelector}
                <SignCredentials
                    unlocked={signerReady}
                    fromAddress={ownerAddress}
                    chainId={chainId}
                    password={password}
                    onPasswordChange={(v) => {
                        setPassword(v);
                        if (editError) setEditError(null);
                    }}
                    onStatusChange={onCancelHwStatusChange}
                    passwordRef={passwordRef}
                    submitError={editError}
                    disabled={editStage === 'submitting'}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {cancelHw && editError ? (
                    <div role="alert" className={styles.error}>{editError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={editStage === 'submitting'}
                        disabled={cancelHw ? cancelHwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        {cancelHw
                            ? `Sign edit on ${ownerAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : 'Sign edit'}
                    </Button>
                </div>
            </form>,
        );
    }

    if (buyStage === 'done') {
        const txid = buyResult?.txid || buyResult?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Buy submitted</h2>
                <p className={styles.hint}>
                    You paid {totalPayAmount} {getTick}. If the dispenser is still open
                    when this confirms, you should receive {totalReceive} {giveTick}.
                </p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (buyStage === 'confirm' || buyStage === 'submitting') {
        return wrap(
            <form onSubmit={handleBuy} noValidate>
                <p className={styles.summary}>
                    Buy {fillsNum} fill{fillsNum === 1 ? '' : 's'}: pay {totalPayAmount} {getTick}
                    {' '}→ receive ~{totalReceive} {giveTick}
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={buyerAddress?.address || ''} />
                    </dd>
                    <dt className={styles.detailsLabel}>Dispenser</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={dispAddr || ''} />
                    </dd>
                    <dt className={styles.detailsLabel}>Per-fill price</dt>
                    <dd className={styles.detailsValue}>{getAmount} {getTick}</dd>
                    <dt className={styles.detailsLabel}>Per-fill give</dt>
                    <dd className={styles.detailsValue}>{giveAmount} {giveTick}</dd>
                </dl>
                <p className={styles.hint}>
                    The dispenser triggers when your payment confirms. If the dispenser
                    closes or runs out before then, the payment reaches the creator but
                    no {giveTick} is released. This is a normal risk when buying on
                    these chains.
                </p>
                <SignCredentials
                        unlocked={signerReady}
                    fromAddress={buyerAddress}
                    chainId={chainId}
                    password={buyPassword}
                    onPasswordChange={(v) => {
                        setBuyPassword(v);
                        if (buyError) setBuyError(null);
                    }}
                    onStatusChange={onBuyHwStatusChange}
                    passwordRef={buyPasswordRef}
                    submitError={buyError}
                    disabled={buyStage === 'submitting'}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {buyHw && buyError ? (
                    <div role="alert" className={styles.error}>{buyError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={buyStage === 'submitting'}
                        disabled={buyHw ? buyHwStatus !== 'available' : (!signerReady && buyPassword.length === 0)}
                    >
                        {buyHw
                            ? `Sign buy on ${buyerAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : (descriptor ? `Sign buy on ${descriptor.displayName}` : 'Sign buy')}
                    </Button>
                </div>
            </form>,
        );
    }

    if (cancelStage === 'confirm' || cancelStage === 'submitting') {
        return wrap(
            <form onSubmit={handleCancel} noValidate>
                <p className={styles.summary}>{decodedCancel?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={ownerAddress?.address || ''} />
                    </dd>
                    {(decodedCancel?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                </dl>
                {decodedCancel && decodedCancel.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decodedCancel.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                {feeSelector}
                <SignCredentials
                        unlocked={signerReady}
                    fromAddress={ownerAddress}
                    chainId={chainId}
                    password={password}
                    onPasswordChange={(v) => {
                        setPassword(v);
                        if (cancelError) setCancelError(null);
                    }}
                    onStatusChange={onCancelHwStatusChange}
                    passwordRef={passwordRef}
                    submitError={cancelError}
                    disabled={cancelStage === 'submitting'}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {cancelHw && cancelError ? (
                    <div role="alert" className={styles.error}>{cancelError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="danger"
                        loading={cancelStage === 'submitting'}
                        disabled={cancelHw ? cancelHwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        {cancelHw
                            ? `Sign cancel on ${ownerAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : 'Sign cancel'}
                    </Button>
                </div>
            </form>,
        );
    }

    const source = dispenser?.source || action?.source;
    const dispAddress = dispenser?.address;
    const matchingDispenses = dispenses.filter(
        (d) => String(d.get_tick || dispenser?.get_tick) === String(dispenser?.get_tick)
            && String(d.give_tick || dispenser?.give_tick) === String(dispenser?.give_tick),
    );

    // PC-21: one chronological lifecycle timeline (newest first) merging
    // dispenses with the refill/edit, close, and expire events.
    const LIFECYCLE_LABEL = { dispense: 'Dispensed', edits: 'Refilled / edited', closes: 'Closed', expires: 'Expired' };
    const lifecycleTimeline = [
        ...matchingDispenses.map((row) => ({ kind: 'dispense', row })),
        ...lifecycle,
    ]
        .map((e) => ({ ...e, sortKey: Number(e.row.block_index ?? e.row.timestamp ?? e.row.action_index ?? 0) }))
        .sort((a, b) => b.sortKey - a.sortKey);

    return wrap(
        <>
            {isClosing ? (
                <p className={local.closeWindowNote} role="status">
                    Closing: this dispenser is in its 1-hour close window. Remaining escrow
                    returns to the owner when the window ends; dispenses that confirm before
                    then are still honored.
                </p>
            ) : null}
            {/* Stats hero: what's dispensed at what rate, how it's paid,
                where it lives, how it's doing. Block height / action index
                are secondary (action index lives in the More menu). */}
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Dispensing</dt>
                <dd className={styles.detailsValue}>
                    {formatNum(giveAmount)} {giveTick || '?'} per fill
                </dd>
                <dt className={styles.detailsLabel}>Payment</dt>
                <dd className={styles.detailsValue}>
                    {formatNum(getAmount)} {getTick || getCoin || '?'}
                    {getTick ? ' (token)' : getCoin ? ' (native coin)' : ''}
                </dd>
                {dispenser?.escrow_remaining != null ? (
                    <>
                        <dt className={styles.detailsLabel}>Balance</dt>
                        <dd className={styles.detailsValue}>
                            {formatNum(dispenser.escrow_remaining)} {giveTick || ''} in escrow
                        </dd>
                    </>
                ) : null}
                {dispenser?.dispense_count != null ? (
                    <>
                        <dt className={styles.detailsLabel}>Dispenses</dt>
                        <dd className={styles.detailsValue}>
                            {formatNum(dispenser.dispense_count)} of 1,000 this fill
                            {remainingFills != null ? (
                                <span
                                    className={`${local.remainingPill} ${remainingFills > 0n ? local.remainingOk : local.remainingEmpty}`}
                                    title={`${remainingFills} more fill${remainingFills === 1n ? '' : 's'} at ${formatNum(giveAmount)} ${giveTick || ''} each`.trim()}
                                >
                                    {formatNum(String(remainingFills))} left
                                </span>
                            ) : null}
                        </dd>
                    </>
                ) : null}
                {source ? (
                    <>
                        <dt className={styles.detailsLabel}>Source</dt>
                        <dd className={styles.detailsValue} style={ADDRESS_CELL_STYLE}>
                            <AddressText address={source} truncate={false} />
                            {ownerAddress ? ' (you)' : ''}
                        </dd>
                    </>
                ) : null}
                {(dispAddress || source) ? (
                    <>
                        <dt className={styles.detailsLabel}>Address</dt>
                        <dd className={styles.detailsValue} style={ADDRESS_CELL_STYLE}>
                            <AddressText address={dispAddress || source} truncate={false} />
                        </dd>
                    </>
                ) : null}
                <dt className={styles.detailsLabel}>Status</dt>
                <dd className={styles.detailsValue}>
                    {isClosing ? 'closing (1-hour window)' : (liveStatus || 'unknown')}
                </dd>
                {currentExpiration ? (
                    <>
                        <dt className={styles.detailsLabel}>Expires</dt>
                        <dd className={styles.detailsValue}>{formatUnixDate(currentExpiration)}</dd>
                    </>
                ) : null}
                {currentAllowList ? (
                    <>
                        <dt className={styles.detailsLabel}>Allow list</dt>
                        <dd className={styles.detailsValue}>#{currentAllowList}</dd>
                    </>
                ) : null}
                {currentBlockList ? (
                    <>
                        <dt className={styles.detailsLabel}>Block list</dt>
                        <dd className={styles.detailsValue}>#{currentBlockList}</dd>
                    </>
                ) : null}
                {dispenser?.memo ? (
                    <>
                        <dt className={styles.detailsLabel}>Memo</dt>
                        <dd className={styles.detailsValue}>{dispenser.memo}</dd>
                    </>
                ) : null}
            </dl>

            <div className={local.quickActions} role="group" aria-label="Dispenser actions">
                <button
                    type="button"
                    className={local.quickAction}
                    onClick={() => setCancelStage('confirm')}
                    disabled={!ownerAddress || !isOpen}
                    title={!ownerAddress ? 'Only the owner can close'
                        : !isOpen ? 'Dispenser is not open'
                        : 'Close this dispenser'}
                >
                    <span className={local.quickActionIcon} aria-hidden="true"><Icon.XIcon /></span>
                    <span>Close</span>
                </button>
                <button
                    type="button"
                    className={local.quickAction}
                    onClick={() => setRefillStage('confirm')}
                    disabled={!ownerAddress || !isOpen}
                    title={!ownerAddress ? 'Only the owner can refill'
                        : !isOpen ? 'Dispenser is not open'
                        : 'Add escrow to this dispenser'}
                >
                    <span className={local.quickActionIcon} aria-hidden="true"><Icon.PlusIcon /></span>
                    <span>Refill</span>
                </button>
                <button
                    type="button"
                    className={local.quickAction}
                    onClick={() => setEditStage('confirm')}
                    disabled={!ownerAddress || !isOpen}
                    title={!ownerAddress ? 'Only the owner can edit'
                        : !isOpen ? 'Dispenser is not open'
                        : 'Change expiration or allow/block lists'}
                >
                    <span className={local.quickActionIcon} aria-hidden="true"><Icon.PencilIcon /></span>
                    <span>Edit</span>
                </button>
                <button
                    type="button"
                    className={local.quickAction}
                    onClick={() => {
                        const base = descriptor?.explorer?.defaultUrl || branding.DEFAULT_EXPLORER_BASE;
                        // : the explorer base is bare; append the coin path segment.
                        const code = explorerCoinCode(descriptor);
                        const path = code ? `/${code}/action/${actionIndex}` : `/action/${actionIndex}`;
                        try { window.open(`${base.replace(/\/$/, '')}${path}`, '_blank', 'noopener'); } catch { /* no-op */ }
                    }}
                    title="View on the XChain explorer"
                >
                    <img src={branding.logoUrl()} alt="" aria-hidden="true" className={local.quickActionLogo} />
                    <span>XChain</span>
                </button>
                <div className={local.quickActionMoreWrap} ref={moreWrapRef}>
                    <button
                        type="button"
                        className={local.quickAction}
                        aria-haspopup="menu"
                        aria-expanded={moreOpen}
                        onClick={() => setMoreOpen((o) => !o)}
                    >
                        <span className={local.quickActionIcon} aria-hidden="true"><Icon.MoreIcon /></span>
                        <span>More</span>
                    </button>
                    {moreOpen ? (
                        <div className={local.quickActionMoreMenu} role="menu">
                            <button
                                type="button"
                                role="menuitem"
                                className={local.quickActionMoreItem}
                                onClick={() => { setMoreOpen(false); handleCopy(dispAddress || source || '', 'address'); }}
                            >
                                <span aria-hidden="true"><Icon.CopyIcon /></span>
                                <span>{copied === 'address' ? 'Copied' : 'Copy dispenser address'}</span>
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className={local.quickActionMoreItem}
                                onClick={() => { setMoreOpen(false); handleCopy(String(actionIndex), 'index'); }}
                            >
                                <span aria-hidden="true"><Icon.CopyIcon /></span>
                                <span>{copied === 'index' ? 'Copied' : 'Copy action index'}</span>
                            </button>
                        </div>
                    ) : null}
                </div>
            </div>

            <div className={local.tabBar} role="tablist">
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'dispenses'}
                    className={`${local.tab} ${tab === 'dispenses' ? local.tabActive : ''}`}
                    onClick={() => setTab('dispenses')}
                >
                    Dispenses
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'lifecycle'}
                    className={`${local.tab} ${tab === 'lifecycle' ? local.tabActive : ''}`}
                    onClick={() => setTab('lifecycle')}
                >
                    Lifecycle
                </button>
            </div>
            {tab === 'lifecycle' ? (
                <ul className={local.dispenseList}>
                    {lifecycleTimeline.length === 0 ? (
                        <li><div className={local.dispenseEmpty}>No lifecycle events yet.</div></li>
                    ) : lifecycleTimeline.slice(0, 40).map((e) => (
                        <li key={`${e.kind}-${e.row.action_index}`}>
                            <div className={local.dispenseRow}>
                                <span className={local.dispenseAmount}>{LIFECYCLE_LABEL[e.kind] || e.kind}</span>
                                <span className={local.dispensePaid}>
                                    {e.kind === 'dispense'
                                        ? `${formatNum(e.row.give_amount)} ${e.row.give_tick || giveTick || ''}`
                                        : (e.row.expiration ? `expires ${e.row.expiration}` : `#${e.row.action_index}`)}
                                </span>
                                <span className={local.dispenseWhen}>
                                    {e.row.block_index ? `block ${e.row.block_index}` : ''}
                                </span>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
            <ul className={local.dispenseList}>
                {matchingDispenses.length === 0 ? (
                    <li><div className={local.dispenseEmpty}>No dispenses yet.</div></li>
                ) : matchingDispenses.slice(0, 25).map((d) => {
                    const paidAmount = d.get_amount ?? getAmount;
                    const paidUnit = d.get_tick || d.get_coin || getTick || getCoin || '';
                    return (
                        <li key={String(d.action_index)}>
                            <div className={local.dispenseRow}>
                                <span className={local.dispenseAmount}>
                                    {formatNum(d.give_amount)} {d.give_tick || giveTick || ''}
                                </span>
                                <span className={local.dispensePaid}>
                                    {paidAmount != null ? `for ${formatNum(paidAmount)} ${paidUnit}`.trim() : ''}
                                </span>
                                <span className={local.dispenseWhen}>
                                    {relativeTime(d.timestamp || d.block_time)}
                                </span>
                            </div>
                        </li>
                    );
                })}
            </ul>
            )}

            {canBuyWithSend ? (
                <section style={{ marginTop: '1rem', padding: '0.75rem', border: '1px solid var(--xc-border)', borderRadius: '4px' }}>
                    <p className={styles.successLabel}>Buy from this dispenser</p>
                    <p className={styles.hint}>
                        Send {getAmount} {getTick} per fill. Tokens dispense when the SEND
                        confirms and the dispenser is still open.
                    </p>
                    {buyerAddresses.length > 1 ? (
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                            <span className={styles.detailsLabel}>Pay from</span>
                            <select
                                value={buyerAddressId || ''}
                                onChange={(e) => setBuyerAddressId(e.target.value)}
                                style={{ marginLeft: '0.5rem' }}
                            >
                                {buyerAddresses.map((a) => (
                                    <option key={a.id} value={a.id}>{a.address}</option>
                                ))}
                            </select>
                        </label>
                    ) : buyerAddress ? (
                        <p className={styles.entryDescription}>
                            Paying from <AddressText address={buyerAddress.address} />
                        </p>
                    ) : null}
                    <Input
                        label="Fills"
                        hint="Multiply per-fill amounts by this number (integer ≥ 1)."
                        inputMode="numeric"
                        value={fills}
                        onChange={(e) => setFills(e.target.value)}
                        autoComplete="off"
                    />
                    <Button
                        variant="primary"
                        onClick={() => setBuyStage('confirm')}
                        disabled={fillsNum <= 0 || !buyerAddress || !dispAddr}
                    >
                        Buy {fillsNum > 0 ? `${fillsNum} ` : ''}fill{fillsNum === 1 ? '' : 's'}
                    </Button>
                </section>
            ) : null}

            {showPayHere ? (
                <section style={{ marginTop: '1rem', padding: '0.75rem', border: '1px solid var(--xc-border)', borderRadius: '4px' }}>
                    <p className={styles.successLabel}>Pay to buy</p>
                    <p className={styles.hint}>
                        This dispenser accepts bare {getCoin} payments. Any {getCoin} wallet
                        can trigger a fill. Send exactly {getAmount} {getCoin} per fill to
                        the dispenser address.
                    </p>
                    <dl className={styles.detailsList}>
                        <dt className={styles.detailsLabel}>Send to</dt>
                        <dd className={styles.detailsValue}>
                            <code style={{ wordBreak: 'break-all' }}>{dispAddr}</code>
                            {' '}
                            <button
                                type="button"
                                onClick={() => handleCopy(dispAddr, 'address')}
                                style={{ marginLeft: '0.5rem' }}
                            >
                                {copied === 'address' ? 'Copied' : 'Copy'}
                            </button>
                        </dd>
                        <dt className={styles.detailsLabel}>Send exactly</dt>
                        <dd className={styles.detailsValue}>
                            <code>{getAmount} {getCoin}</code>
                            {' '}
                            <button
                                type="button"
                                onClick={() => handleCopy(String(getAmount), 'amount')}
                                style={{ marginLeft: '0.5rem' }}
                            >
                                {copied === 'amount' ? 'Copied' : 'Copy amount'}
                            </button>
                            {' per fill'}
                        </dd>
                        <dt className={styles.detailsLabel}>Per-fill give</dt>
                        <dd className={styles.detailsValue}>{giveAmount} {giveTick}</dd>
                    </dl>
                    <p className={styles.hint}>
                        Native-coin sending from this wallet is on the roadmap; for now,
                        use any {getCoin} wallet to trigger the dispense.
                    </p>
                </section>
            ) : null}

        </>,
    );
}

// Thousands separators on the integer part of a decimal string, exact
// (no float round-trip): '4750' -> '4,750', '0.005' stays '0.005'.
/**
 * How many more times this dispenser can pay out:
 * floor(escrow_remaining / give_amount).
 *
 * Both values are decimal strings, so scale them to a common integer basis and
 * divide with BigInt. Float division misfloors on ordinary token amounts
 * (0.3 / 0.1 === 2.9999999999999996, which would floor to 2 fills, not 3).
 *
 * @returns {bigint | null} null when either input is missing or unparseable.
 */
function remainingFillsFrom(escrowRemaining, giveAmount) {
    if (escrowRemaining == null || giveAmount == null) return null;
    const decimals = (v) => (String(v).split('.')[1] || '').length;
    const scaled = (v, dp) => {
        const s = String(v).trim();
        if (!/^\d+(\.\d+)?$/.test(s)) return null;
        const [int, frac = ''] = s.split('.');
        return BigInt(int + frac.padEnd(dp, '0'));
    };
    const dp = Math.max(decimals(escrowRemaining), decimals(giveAmount));
    const left = scaled(escrowRemaining, dp);
    const perFill = scaled(giveAmount, dp);
    if (left == null || perFill == null || perFill <= 0n) return null;
    return left / perFill;
}

function formatNum(v) {
    if (v == null || v === '') return '?';
    const s = String(v);
    const [int, frac] = s.split('.');
    if (!/^\d+$/.test(int)) return s;
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return frac != null ? `${grouped}.${frac}` : grouped;
}

// Human-readable "X ago". Accepts unix seconds or ms; '' for invalid
// input so the row just omits the time. (Same shape as TxStatusTimeline's.)
function relativeTime(ts) {
    const n = Number(ts);
    if (!n || !Number.isFinite(n)) return '';
    const ms = n < 1e12 ? n * 1000 : n;
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

// Format a Unix timestamp (seconds; tolerates ms) as a short local
// date-time. '' for unparseable input so callers can omit the row.
function formatUnixDate(ts) {
    const n = Number(ts);
    if (!n || !Number.isFinite(n)) return '';
    const ms = n < 1e12 ? n * 1000 : n;
    try {
        return new Date(ms).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return new Date(ms).toISOString();
    }
}

// Convert a datetime-local input value ('2026-07-24T15:30', interpreted in
// the user's local zone) to Unix seconds. null on unparseable input.
function localInputToUnix(localStr) {
    const ms = Date.parse(String(localStr));
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms / 1000);
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}

function rateLabel(row) {
    if (!row) return 'unknown';
    const give = `${row.give_amount ?? '?'} ${row.give_tick || '?'}`;
    const coin = row.get_coin || '';
    const tick = row.get_tick || '';
    const amt = row.get_amount ?? '?';
    const payAsset = tick || coin || '?';
    return `${give} per ${amt} ${payAsset}`;
}

function pickAction(resp) {
    if (!resp) return null;
    if (resp.action) return resp.action;
    if (Array.isArray(resp.data) && resp.data.length > 0) return resp.data[0];
    return resp;
}

function pickDispenser(resp) {
    if (!resp) return null;
    if (resp.dispenser) return resp.dispenser;
    if (resp.data && resp.data.dispenser) return resp.data.dispenser;
    // Many explorer endpoints flatten DISPENSER fields onto the action.
    if (resp.give_tick || resp.get_amount) return resp;
    if (Array.isArray(resp.data) && resp.data.length > 0) return resp.data[0];
    return null;
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}
