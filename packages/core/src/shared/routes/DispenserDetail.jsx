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
import { AddressText, Button, ChainBadge, FeeSelector, Icon, Input, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
    flows as flowsLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { PreflightPanel } from '../components/PreflightPanel.jsx';
import { formatWithThousands } from '../utils/amountFormat.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { compareAmounts, multiplyAmounts } from '../../market/orderMath.js';
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
import { externalIndexOf } from '../addressSelection.js';
import { refillsUsed, refillCeilingMessage } from '../utils/dispenserRefills.js';
import {
    buyerListMessage,
    buyerListVerdict,
    dispenserRefusesEveryoneMessage,
    listMembers,
    ownerOffAllowList,
} from '../../flows/allowListSelfCheck.js';

const chainRegistry = registryLib.defaultRegistry();

// The buy pre-flight is generated locally and has nothing overridable in it,
// so PreflightPanel's acknowledgment set is a constant rather than state.
const NO_ACKNOWLEDGMENTS = new Set();

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
    // Bumped when an owner action (refill / edit / close) finishes, to re-read
    // the dispenser. Without it the page returning from a successful refill
    // still showed the PRE-refill escrow - the one number the owner just
    // changed - until they navigated away and back (D-44).
    const [reloadKey, setReloadKey] = useState(0);
    const [dispenser, setDispenser] = useState(/** @type {any | null} */ (null));
    const [action, setAction] = useState(/** @type {any | null} */ (null));
    const [dispenses, setDispenses] = useState(/** @type {any[]} */ ([]));
    // The live quote of the ORACLE a Mode B dispenser is priced by. Its price is
    // not on the dispenser row - it lives on the oracle's own published feed -
    // so a panel that does not fetch it cannot state a price at all, and told
    // buyers only that "an oracle" sets one. Null while unknown, which the copy
    // distinguishes from a feed that has genuinely gone dark.
    const [oracleQuote, setOracleQuote] = useState(/** @type {any | null} */ (null));
    const [oracleQuoteChecked, setOracleQuoteChecked] = useState(false);
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
    // D-147: how many of the five refills are gone, derived from the lifecycle
    // events this page already loads. Nothing else can answer it: this lane has
    // no confirm screen and owes no protocol fee, so no network dry run runs on
    // it, and a sixth refill used to be signed and broadcast against a rule that
    // rejects it every time.
    const refillCount = useMemo(() => refillsUsed(lifecycle), [lifecycle]);

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

    //  / PC-51: the owner actions on this screen compose DISPENSER
    // updates, and off Bitcoin the native-coin output IS the protocol fee
    // . Without this flag the action confirms on chain and the indexer
    // then rejects it "insufficient fee (native coin output required)" while
    // this screen reports the edit as applied.
    //
    // Threaded on ALL THREE owner paths, not just the one known to be priced.
    // Which DISPENSER updates carry a fee is consensus knowledge (the gas
    // schedule plus the expiration free-days rule) that changes without the
    // wallet, and `protocolFeeRow.js` is explicit that the client must not keep
    // a list of unpriced actions to check against. The submit path quotes for
    // real and `applyNativeFeePreflight` builds no fee output for a zero quote,
    // so threading it everywhere is correct on a free action and correct when
    // consensus starts pricing one; enumerating would be wrong the day it does.
    const nativeFee = useNativeFee(chainId);
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
                        && externalIndexOf(a.derivationPath) !== null,
                );
                setBuyerAddresses(spendable);
                if (spendable.length > 0) {
                    const sorted = [...spendable].sort((a, b) => {
                        const ai = (externalIndexOf(a.derivationPath) ?? -1);
                        const bi = (externalIndexOf(b.derivationPath) ?? -1);
                        return bi - ai;
                    });
                    setBuyerAddressId(sorted[0].id);
                }
            }
            setLoading(false);

            if (isDemo) {
                setDispenses(flowsLib.synthesizeDemoDispenses(actionIndex));
            } else if (source) {
                // Fills of THIS dispenser, keyed by its action index. The source
                // lane answers "fills on this address", which over-reports as soon
                // as the address hosts a second dispenser - the normal case, since
                // dispensers open on their creator's source. Older explorers have
                // no dispenser lane, so fall back to the source lane and let
                // matchingDispenses() filter what it can (D-38).
                messaging.getDispenses({ chainId, query: actionIndex, type: 'dispenser' })
                    .then((d) => { if (!cancelled) setDispenses(extractRows(d)); })
                    .catch(() => messaging.getDispenses({ chainId, query: source, type: 'source' })
                        .then((d) => { if (!cancelled) setDispenses(extractRows(d)); }))
                    .catch(() => { /* best-effort; detail still usable without dispenses */ });
                // PC-21: the rest of the lifecycle (refills/edits, closes,
                // expirations). Best-effort; scoped to this dispenser by its
                // action index when the event rows carry it.
                if (typeof messaging.getDispenserLifecycle === 'function') {
                    // 'cancels' is the owner's own cancel action - the one that STARTS
                    // the 1-hour close window - while 'closes' is the completion the chain
                    // writes when the window ends. Omitting it left the cancel invisible on
                    // the timeline for that whole hour, right after the owner took it (D-45).
                    Promise.all(['edits', 'cancels', 'closes', 'expires'].map((kind) => messaging
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
    }, [walletId, chainId, actionIndex, messaging, reloadKey]);

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
    // D-144: a FIAT-priced dispenser stores NO coin price. GET_AMOUNT is 0 by
    // protocol convention and the real price is derived at settlement from
    // FIAT_AMOUNT and the validator snapshot for GET_COIN (dispense.js ->
    // reversePriceMatch). This panel priced straight off GET_AMOUNT and so told
    // a buyer to "Send exactly 0 LTC per fill" - an instruction that costs them
    // a network fee and buys nothing. The explorer already serves `fiat`,
    // `fiat_amount` and `oracle_address` on the dispenser row; read them and say
    // what is actually true instead of quoting a zero as if it were a price.
    const fiatCode = dispenser?.fiat || dispenser?.fiat_code || '';
    const fiatAmount = dispenser?.fiat_amount;
    const oracleAddress = dispenser?.oracle_address || '';
    const isFiatPriced = Boolean(fiatCode) && (Boolean(oracleAddress) || fiatAmount != null);
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
    // A Mode B dispenser prices its fills from a quote published by SOMEONE
    // ELSE, at an address named on the dispenser row - so the price a buyer
    // needs is one lookup away and the panel used to make it nobody's job. The
    // consequences of not knowing are asymmetric and both bad: pay too little
    // and the dispense is refused with the coin KEPT (dispense.js runs the
    // price match after the payment has already moved), pay too much and the
    // remainder is floored away and kept as a tip.
    useEffect(() => {
        if (!oracleAddress || fiatAmount != null) { setOracleQuoteChecked(true); return undefined; }
        if (typeof messaging?.oracleFeeds !== 'function') { setOracleQuoteChecked(true); return undefined; }
        let cancelled = false;
        messaging.oracleFeeds({ chainId, address: oracleAddress })
            .then((feeds) => {
                if (cancelled) return;
                // An oracle may run many feeds in parallel; a dispenser is
                // priced by exactly the one matching its own (coin, tick,
                // fiat). Picking any other would quote a different asset's
                // price with total confidence.
                const match = (Array.isArray(feeds) ? feeds : []).find((f) => f
                    && String(f.tick || '').toUpperCase() === String(giveTick || '').toUpperCase()
                    && String(f.fiat || '').toUpperCase() === String(fiatCode || '').toUpperCase());
                // `live`, never `pending`: a published quote is inert for 24
                // hours, so the maturing one prices nothing yet and showing it
                // would be a price no payment made today can buy at.
                setOracleQuote(match?.live || null);
                setOracleQuoteChecked(true);
            })
            .catch(() => { if (!cancelled) setOracleQuoteChecked(true); });
        return () => { cancelled = true; };
    }, [oracleAddress, fiatAmount, fiatCode, giveTick, chainId, messaging]);

    // Live status: everything that can change after the create - the 1-hour
    // "cancelling" close window, expiry, sold-out - plus the post-edit
    // expiration and allow/block lists. The by-action-index read path returns
    // these in a `state` block (the create columns beside it keep their
    // ORIGINAL values, so reading those shows stale terms after an edit).
    // `current_status` is the list-lane spelling and demo fixtures carry only
    // the create `status`; both stay as fallbacks. Reading `current_status`
    // alone left liveStatus at 'valid' forever, which disabled Close / Refill /
    // Edit on every real dispenser and hid the close-window banner (D-39).
    const liveState = flowsLib.dispenserLiveState(dispenser);
    const liveStatus = liveState.status;
    const isOpen = liveStatus === 'open';
    const isClosing = liveStatus === 'cancelling';
    const currentExpiration = liveState.expiration;
    const currentAllowList = liveState.allowList;
    const currentBlockList = liveState.blockList;
    // Fills this dispenser can still pay out, shown as a bubble next to the
    // dispense count and used to cap the buy panel's Max. Needs the LIVE
    // escrow: `escrow_remaining` is the demo fixtures' spelling and the real
    // read path serves the drawn-down figure as state.give_remaining, so
    // reading the fixture name alone left this null on every real dispenser
    // (no escrow shown, and Max bounded only by what the buyer could afford).
    const escrowRemaining = liveState.giveRemaining;
    const remainingFills = useMemo(
        () => remainingFillsFrom(escrowRemaining, dispenser?.give_amount),
        [escrowRemaining, dispenser],
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

    // D-162: the panel already tells a buyer this dispenser is restricted and
    // names the list, then tells them to "check you are on the right side of
    // the list before sending" - which is a read the wallet can just do. Both
    // list details, fetched once per dispenser; best-effort, since a failed
    // read must leave the existing generic warning standing rather than
    // replace it with a specific claim that is not backed by anything.
    const [allowMembers, setAllowMembers] = useState(/** @type {string[]|null} */ (null));
    const [blockMembers, setBlockMembers] = useState(/** @type {string[]|null} */ (null));
    useEffect(() => {
        setAllowMembers(null);
        setBlockMembers(null);
        if (!chainId || typeof messaging.getListByActionIndex !== 'function') return undefined;
        let live = true;
        const read = (idx, set) => {
            if (!idx) return;
            messaging.getListByActionIndex({ chainId, actionIndex: String(idx) })
                .then((detail) => { if (live) set(listMembers(detail)); })
                .catch(() => { /* best-effort */ });
        };
        read(currentAllowList, setAllowMembers);
        read(currentBlockList, setBlockMembers);
        return () => { live = false; };
    }, [chainId, currentAllowList, currentBlockList, messaging]);

    // The verdict that does NOT depend on who pays: a dispenser whose own
    // pay-to address is off its own allow-list sells to nobody, so checking
    // your own membership cannot help (D-161, from the buyer's side).
    const dispenserSelfBarred = ownerOffAllowList({
        members: allowMembers, getAddress: dispAddr,
    });
    // And the one that does: whether any address THIS wallet holds on this
    // chain would be accepted. A coin-paid dispenser takes a bare payment from
    // anywhere, so the wallet cannot know the payer - it can only answer for
    // the addresses it has.
    const buyerVerdict = useMemo(() => buyerListVerdict({
        addresses: buyerAddresses
            .filter((a) => !chainId || a.chainId === chainId || a.chain_id === chainId)
            .map((a) => a.address)
            .filter(Boolean),
        allowMembers,
        blockMembers,
    }), [buyerAddresses, chainId, allowMembers, blockMembers]);
    const buyerListNotice = dispenserSelfBarred
        ? dispenserRefusesEveryoneMessage()
        : buyerListMessage(buyerVerdict);

    // D-37 : what the paying address actually holds of the payment
    // token, through the same hook that backs every other form's Max +
    // "N available" footer. Without it the buy panel was the one spending
    // surface in the wallet with no funding check, and a buyer holding zero
    // could sign and broadcast a SEND the chain rejected as `invalid:
    // insufficient funds` - a network fee paid for nothing.
    const buyBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: canBuyWithSend ? buyerAddress?.address : null,
        tick: getTick,
    });

    // Largest whole fill count the balance covers: floor(balance / price),
    // exact (the same reason remainingFillsFrom exists - float division
    // misfloors ordinary token amounts).
    const affordableFills = useMemo(
        () => remainingFillsFrom(buyBalance, getAmount),
        [buyBalance, getAmount],
    );
    // Max offers what the buyer can both afford AND actually receive: paying
    // past the escrow's remaining fills buys nothing.
    const maxBuyFills = useMemo(() => {
        if (affordableFills == null) return null;
        if (remainingFills == null) return affordableFills;
        return affordableFills < remainingFills ? affordableFills : remainingFills;
    }, [affordableFills, remainingFills]);
    const onMaxFills = useCallback(() => {
        if (maxBuyFills == null || maxBuyFills <= 0n) return;
        setFills(maxBuyFills.toString());
    }, [maxBuyFills]);

    // Funding pre-flight, rendered through the shared PreflightPanel so the
    // verdict chip reads exactly like Send's. It is local and funding-only,
    // hence `restricted`: it can prove the buyer cannot pay, never that the
    // fill will land.
    const buyPreflight = useMemo(() => {
        if (!canBuyWithSend || !totalPayAmount || buyBalance == null) return null;
        const covered = compareAmounts(buyBalance, totalPayAmount);
        if (covered == null) return null;
        const tickLabel = String(getTick || '').toUpperCase();
        return {
            verdict: covered < 0 ? 'fail' : 'pass',
            restricted: true,
            findings: covered < 0
                ? [{
                    code: 'insufficient_funds',
                    severity: 'error',
                    overridable: false,
                    message: `This buy pays ${formatWithThousands(totalPayAmount)} ${tickLabel},`
                        + ` but this address holds ${formatWithThousands(buyBalance)} ${tickLabel}.`,
                }]
                : [],
            unverified: [{
                check: 'dispenser_state',
                reason: 'Only your payment-token balance was checked. The dispenser can still'
                    + ' close or sell out before your payment confirms.',
            }],
        };
    }, [canBuyWithSend, totalPayAmount, buyBalance, getTick]);
    const buyUnderfunded = buyPreflight?.verdict === 'fail';

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
        // D-37: last gate before signing. The balance can also resolve (or
        // drop) while the review screen is open, so the check is repeated
        // here rather than trusted from the panel's disabled button.
        if (buyUnderfunded) {
            setBuyError('Not enough of the payment token at this address.');
            return;
        }
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
                // : `flag` is true or undefined, never false, so on Bitcoin
                // (where the fee is opt-in) this leaves the payload untouched.
                payFeeInNativeCoin: nativeFee.flag,
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
                // : `flag` is true or undefined, never false, so on Bitcoin
                // (where the fee is opt-in) this leaves the payload untouched.
                payFeeInNativeCoin: nativeFee.flag,
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
                // : `flag` is true or undefined, never false, so on Bitcoin
                // (where the fee is opt-in) this leaves the payload untouched.
                payFeeInNativeCoin: nativeFee.flag,
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
    if (loadError) return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);

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
                    <Button variant="primary" onClick={() => { setRefillStage('idle'); setRefillAmount(''); setReloadKey((k) => k + 1); }}>
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
                {/*
                  * D-147: this used to be policy copy alone ("a dispenser allows
                  * up to 5 refills … a 6th is rejected") with no count, on the one
                  * lane the wallet cannot dry-run. It now says where THIS dispenser
                  * stands, and when the ceiling is spent it says so as an alert and
                  * the sign button goes away, because the alternative is a signed
                  * transaction the chain always rejects.
                  */}
                {refillCount.remaining <= 0 && refillCount.exact ? (
                    <StatusMessage variant="error" className={styles.error}>
                        {refillCeilingMessage(refillCount)}
                    </StatusMessage>
                ) : (
                    <p className={styles.hint}>{refillCeilingMessage(refillCount)}</p>
                )}
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
                {/* : off Bitcoin this is mandatory, so the toggle renders
                    as a disclosure rather than a choice - the same treatment the
                    other DISPENSER authoring surfaces give it. */}
                <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={feeCoinTicker} />
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
                    <StatusMessage variant="error" className={styles.error}>{refillError}</StatusMessage>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={refillStage === 'submitting'}
                        disabled={(refillCount.remaining <= 0 && refillCount.exact)
                            || (cancelHw ? cancelHwStatus !== 'available' : (!signerReady && password.length === 0))}
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
                            setReloadKey((k) => k + 1);
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
                {/* : off Bitcoin this is mandatory, so the toggle renders
                    as a disclosure rather than a choice - the same treatment the
                    other DISPENSER authoring surfaces give it. */}
                <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={feeCoinTicker} />
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
                    <StatusMessage variant="error" className={styles.error}>{editError}</StatusMessage>
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
                    <dt className={styles.detailsLabel}>Your balance</dt>
                    <dd className={styles.detailsValue}>
                        {buyBalance == null
                            ? 'Checking…'
                            : `${formatWithThousands(buyBalance)} ${String(getTick).toUpperCase()}`}
                    </dd>
                </dl>
                {buyPreflight ? (
                    <PreflightPanel
                        report={buyPreflight}
                        acknowledged={NO_ACKNOWLEDGMENTS}
                        onAcknowledge={() => {}}
                    />
                ) : null}
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
                    <StatusMessage variant="error" className={styles.error}>{buyError}</StatusMessage>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={buyStage === 'submitting'}
                        disabled={buyUnderfunded
                            || (buyHw ? buyHwStatus !== 'available' : (!signerReady && buyPassword.length === 0))}
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
                {/* : off Bitcoin this is mandatory, so the toggle renders
                    as a disclosure rather than a choice - the same treatment the
                    other DISPENSER authoring surfaces give it. */}
                <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={feeCoinTicker} />
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
                    <StatusMessage variant="error" className={styles.error}>{cancelError}</StatusMessage>
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
    // D-38: a fill belongs to this dispenser only when it names it (see
    // dispensesOfDispenser for why ticks cannot decide it).
    const matchingDispenses = flowsLib.dispensesOfDispenser(dispenses, actionIndex, dispenser);

    // PC-21: one chronological lifecycle timeline (newest first) merging
    // dispenses with the refill/edit, close, and expire events.
    const LIFECYCLE_LABEL = {
        dispense: 'Dispensed',
        edits: 'Refilled / edited',
        cancels: 'Close requested',
        closes: 'Closed',
        expires: 'Expired',
    };
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
                {escrowRemaining != null ? (
                    <>
                        <dt className={styles.detailsLabel}>Balance</dt>
                        <dd className={styles.detailsValue}>
                            {formatNum(escrowRemaining)} {giveTick || ''} in escrow
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
                    <div className={local.buyFillsRow}>
                        <Input
                            label="Fills"
                            hint="Multiply per-fill amounts by this number (integer ≥ 1)."
                            inputMode="numeric"
                            value={fills}
                            onChange={(e) => setFills(e.target.value)}
                            autoComplete="off"
                        />
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={onMaxFills}
                            disabled={maxBuyFills == null || maxBuyFills <= 0n}
                        >
                            Max
                        </Button>
                    </div>
                    <p className={styles.hint} data-testid="buy-balance">
                        {buyBalance == null
                            ? `Checking your ${String(getTick).toUpperCase()} balance…`
                            : `${formatWithThousands(buyBalance)} ${String(getTick).toUpperCase()} available`}
                    </p>
                    {buyPreflight ? (
                        <PreflightPanel
                            report={buyPreflight}
                            acknowledged={NO_ACKNOWLEDGMENTS}
                            onAcknowledge={() => {}}
                        />
                    ) : null}
                    <Button
                        variant="primary"
                        onClick={() => setBuyStage('confirm')}
                        disabled={fillsNum <= 0 || !buyerAddress || !dispAddr || buyUnderfunded}
                    >
                        Buy {fillsNum > 0 ? `${fillsNum} ` : ''}fill{fillsNum === 1 ? '' : 's'}
                    </Button>
                </section>
            ) : null}

            {showPayHere ? (
                <section style={{ marginTop: '1rem', padding: '0.75rem', border: '1px solid var(--xc-border)', borderRadius: '4px' }}>
                    <p className={styles.successLabel}>Pay to buy</p>
                    {/*
                      * D-148: this used to say "Any {coin} wallet can trigger a
                      * fill" unconditionally, and for a dispenser carrying an
                      * allow- or block-list that is the opposite of the truth.
                      * The gate runs in dispense.js AFTER the coin has moved -
                      * a dispenser is triggered by a BARE payment - so a buyer
                      * the list refuses is out the trigger price and the miner
                      * fee and receives nothing. Measured on Litecoin regtest:
                      * 5,005,460 sats for a refused fill, unrecoverable.
                      */}
                    {currentAllowList || currentBlockList ? (
                        <p role="alert" className={styles.warning}>
                            <strong>This dispenser is restricted.</strong>{' '}
                            {currentAllowList
                                ? `Only addresses on list #${currentAllowList} can trigger a fill.`
                                : ''}
                            {currentAllowList && currentBlockList ? ' ' : ''}
                            {currentBlockList
                                ? `Addresses on list #${currentBlockList} are barred from triggering it.`
                                : ''}
                            {' '}A payment from an address it refuses is <strong>not returned</strong>:
                            the {getCoin} is spent, the dispense is recorded invalid, and nothing
                            comes back.
                        </p>
                    ) : null}
                    {/*
                      * D-162: the line above used to end "Check you are on the
                      * right side of the list before sending", which hands the
                      * buyer a lookup the wallet can do itself off the read the
                      * list picker already makes. Two verdicts, and the first
                      * does not depend on who pays: a dispenser whose own
                      * pay-to address is off its allow-list sells to nobody
                      * (D-161 from the other side), so no amount of checking
                      * your own membership helps. Silent when the read failed
                      * or the answer is "you are fine" - the generic warning
                      * above still stands on its own.
                      */}
                    {buyerListNotice ? (
                        <p role="alert" className={styles.warning}>{buyerListNotice}</p>
                    ) : null}
                    <p className={styles.hint}>
                        This dispenser accepts bare {getCoin} payments.
                        {currentAllowList || currentBlockList
                            ? ''
                            : ` Any ${getCoin} wallet can trigger a fill.`}
                        {isFiatPriced
                            ? ` Its price is set in ${fiatCode}, not in ${getCoin}: the `
                              + `${getCoin} each fill costs is worked out when your payment `
                              + 'lands, from the price feed the network was using at that '
                              + 'moment. Send at least that much or the payment buys nothing.'
                            : ` Send exactly ${getAmount} ${getCoin} per fill to the dispenser address.`}
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
                        {isFiatPriced ? (
                            <>
                                <dt className={styles.detailsLabel}>Price per fill</dt>
                                <dd className={styles.detailsValue}>
                                    {/* A price, or an explicit statement that there
                                        is none to show. "Set by an oracle" was
                                        neither: it named the mechanism and left the
                                        buyer to guess the number, on a payment that
                                        is not returned if it guesses low. The oracle
                                        prices ONE FILL, not one token - the indexer
                                        divides the payment by the published value and
                                        multiplies the result by GIVE_AMOUNT
                                        (utility.reverseOraclePriceMatch), measured on
                                        chain 2026-07-31 - so a fill of several tokens
                                        costs the published figure once. */}
                                    {oracleAddress && fiatAmount == null
                                        ? (oracleQuote?.value != null
                                            ? `${oracleQuote.value} ${fiatCode}`
                                            : (oracleQuoteChecked
                                                ? `Set by the oracle at ${oracleAddress}, in ${fiatCode}, `
                                                  + 'and it is publishing no price this wallet can read '
                                                  + 'right now. A payment made against a dark oracle is '
                                                  + 'refused and NOT returned.'
                                                : `Set by an oracle, in ${fiatCode}`))
                                        : `${fiatAmount} ${fiatCode}`}
                                    {` (paid in ${getCoin} at the rate when your payment lands)`}
                                </dd>
                            </>
                        ) : (
                            <>
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
                            </>
                        )}
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
