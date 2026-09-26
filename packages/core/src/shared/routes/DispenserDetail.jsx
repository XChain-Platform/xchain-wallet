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
import { isHwSource } from '../components/SignCredentials.jsx';
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
import { externalIndexOf, preferredSourceId } from '../addressSelection.js';
import { refillsUsed, refillCeilingMessage } from '../utils/dispenserRefills.js';
import { isTerminalDispenserStatus, reopenTermsFrom, terminalDispenserNotice } from '../utils/dispenserReopen.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { dispenserPriceFloor } from '../../flows/dispenserDustFloor.js';
import {
    buyerListMessage,
    buyerListVerdict,
    dispenserRefusesEveryoneMessage,
    listMembers,
    ownerOffAllowList,
    ownerOffAllowListMessage,
} from '../../flows/allowListSelfCheck.js';
import { boundListIndex, editListConflict } from '../../flows/accessListSlots.js';
import { isListEditRemoveActive } from '../../flows/protocolActivations.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import {
    DISPENSER_PRICE_STALE_MESSAGE,
    isDispenserPriceStale,
} from '../utils/dispenserPricing.js';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { isUserRejection, useActionConfirmFlow, useConfirmSubmit } from '../hooks/useActionConfirmFlow.js';
import { dispenserDestinationNotice, useDispenserDestination } from '../hooks/useDispenserDestination.js';

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
 *     owner actions signed through the shared confirm page and its
 *     network pre-flight, via `messaging.dispenserAction` (HW via
 *     `dispenserActionHw`; watcher mode builds an unsigned transaction):
 *     Close (v1 cancel), Refill (v2 edit topping up GIVE_ESCROW), and
 *     Edit (v2 edit of EXPIRATION / ALLOW_LIST / BLOCK_LIST, PC-19). All
 *     owner actions gate on the live status (open only). On a status that
 *     can never be open again (sold out, closed, expired) they are hidden
 *     instead, and the owner is offered Open again.
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
 * @param {(terms: object) => void} [props.onOpenAgain]  opens DispenserForm prefilled with these
 *   terms; a shell that does not pass it gets no Open again button
 */
export function DispenserDetail({ walletId, chainId, actionIndex, onBack, onCanceled, onOpenAgain }) {
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
    const [dispensesLoaded, setDispensesLoaded] = useState(false);
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
    // events this page already loads. The refill now reaches the confirm page's
    // network dry run too, but this count is what says so on the form itself,
    // before a sixth refill is composed against a rule that rejects it every
    // time.
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
    const [cancelError, setCancelError] = useState(/** @type {string | null} */ (null));
    const [cancelResult, setCancelResult] = useState(/** @type {any | null} */ (null));

    // Buy state, shared by the token-paid and coin-paid lanes.
    const [fills, setFills] = useState('1');
    const [buyStage, setBuyStage] = useState(
        /** @type {'idle' | 'submitting' | 'done'} */ ('idle'),
    );
    const [buyPassword, setBuyPassword] = useState('');
    const [buyError, setBuyError] = useState(/** @type {string | null} */ (null));
    const [buyResult, setBuyResult] = useState(/** @type {any | null} */ (null));
    const buyPasswordRef = useRef('');
    buyPasswordRef.current = buyPassword;
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

    // PC-51: the owner actions on this screen compose DISPENSER
    // updates, and off Bitcoin the native-coin output IS the protocol fee
    //Without this flag the action confirms on chain and the indexer
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
        setDispenses([]);
        setDispensesLoaded(false);
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
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
        ]).then(([realResp, addrsByChain, activeByChain]) => {
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
                // sign. The default is the chain's active address, else
                // the newest external address, as Send does.
                const spendable = onChain.filter(
                    (a) => a.source === 'hd'
                        && externalIndexOf(a.derivationPath) !== null,
                );
                setBuyerAddresses(spendable);
                if (spendable.length > 0) {
                    setBuyerAddressId(preferredSourceId(spendable, activeByChain?.[chainId]));
                }
            }
            setLoading(false);

            if (isDemo) {
                setDispenses(flowsLib.synthesizeDemoDispenses(actionIndex));
                setDispensesLoaded(true);
            } else if (source) {
                // Fills of THIS dispenser, keyed by its action index. The source
                // lane answers "fills on this address", which over-reports as soon
                // as the address hosts a second dispenser - the normal case, since
                // dispensers open on their creator's source. Older explorers have
                // no dispenser lane, so fall back to the source lane and let
                // matchingDispenses() filter what it can (D-38).
                messaging.getDispenses({ chainId, query: actionIndex, type: 'dispenser' })
                    .then((d) => {
                        if (cancelled) return;
                        setDispenses(extractRows(d));
                        setDispensesLoaded(true);
                    })
                    .catch(() => messaging.getDispenses({ chainId, query: source, type: 'source' })
                        .then((d) => {
                            if (cancelled) return;
                            setDispenses(extractRows(d));
                            setDispensesLoaded(true);
                        }))
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

    // Buyer lanes, both through messaging.sendToken so the wallet signs and
    // broadcasts through the standard pipeline:
    //   - Token-paid (dispenser.get_tick non-empty): an XChain SEND of
    //     GET_TICK to the dispenser address.
    //   - Coin-paid (dispenser.get_coin set, dispenser.get_tick empty): a
    //     bare native-coin payment to the dispenser address per DISPENSER.md
    //     ("no XChain action needed from the buyer"). Sending the chain's
    //     native ticker through the same flow IS that payment: the flow
    //     appends the real destination output and drops the empty action
    //     (flows/nativePayment.js). A fiat-priced dispenser stays on the
    //     pay-here panel, because the coin owed is fixed only when the payment
    //     lands and the wallet cannot size it in advance.
    //   The pay-here panel stays for coin-paid dispensers either way, for a
    //   buyer paying from another wallet.
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
    const isTerminal = isTerminalDispenserStatus(liveStatus);
    // An ownership dispenser's form lane does not exist (DispenserForm has no
    // GIVE_OWNERSHIP), and a sold one no longer has the ownership to offer.
    const canOpenAgain = isTerminal && Boolean(ownerAddress) && typeof onOpenAgain === 'function'
        && Number(dispenser?.give_ownership || 0) !== 1;
    const priceStale = isDispenserPriceStale(dispenser);
    const currentExpiration = liveState.expiration;
    const currentAllowList = boundListIndex(liveState.allowList);
    const currentBlockList = boundListIndex(liveState.blockList);
    const canRemoveList = isListEditRemoveActive({ chainId });
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
    // What a buyer pays with: the payment token, or the chain's native coin.
    // The native ticker comes from the chain descriptor, because it is what
    // the send flow matches to recognise a native payment; the row's
    // `get_coin` must agree, or this wallet cannot pay the dispenser at all.
    const coinBuyable = isCoinPaid && !isFiatPriced && Boolean(feeCoinTicker)
        && String(getCoin).toUpperCase() === feeCoinTicker;
    const payTick = isTokenPaid ? getTick : (coinBuyable ? feeCoinTicker : '');
    const canBuyWithSend = (isTokenPaid || coinBuyable) && buyerAddresses.length > 0 && !ownerAddress;
    const showPayHere = isCoinPaid && !ownerAddress;

    // A coin-paid dispenser can be priced below the chain's dust floor (one
    // opened before the create form refused that, or by another client), and the
    // indexer still fills floor(paid / GET_AMOUNT) times - so the smallest
    // payment a buyer can send is many fills, and asking for fewer builds a
    // payment every node refuses. Gated on `coinBuyable` alone: that already
    // excludes FIAT-priced rows (GET_AMOUNT 0) and token-paid ones, which is
    // the only lane this floor applies to.
    const priceFloor = useMemo(
        () => (coinBuyable ? dispenserPriceFloor({ coin: descriptor?.coin, getAmount }) : null),
        [coinBuyable, descriptor, getAmount],
    );
    const minFills = priceFloor ? priceFloor.minFills : 1;

    const fillsCount = useMemo(() => {
        const value = String(fills).trim();
        if (!/^\d+$/.test(value)) return null;
        const count = BigInt(value);
        return count > 0n ? count : null;
    }, [fills]);

    // Default Fills to the floor the first time a dispenser needing one loads,
    // so a buyer who never learns dispensers can be priced under dust does not
    // find out by broadcasting a refused payment. Keyed to the load, not just
    // to `minFills`, so a buyer who edits Fills back down is not overridden a
    // second time by the same value recomputing.
    const fillsDefaultedForRef = useRef(/** @type {string | null} */ (null));
    useEffect(() => {
        const loadKey = `${actionIndex}:${reloadKey}`;
        if (loading || minFills <= 1 || fillsDefaultedForRef.current === loadKey) return;
        fillsDefaultedForRef.current = loadKey;
        setFills(String(minFills));
    }, [actionIndex, reloadKey, loading, minFills]);

    // True only when NO fill count helps: the dispenser's entire remaining
    // escrow can't reach the floor, so every payment it could still pay out
    // is refused regardless of what the buyer types.
    const dispenserPricedBelowFloor = useMemo(() => {
        if (!priceFloor || minFills <= 1 || remainingFills == null) return false;
        return remainingFills < BigInt(minFills);
    }, [priceFloor, minFills, remainingFills]);

    // The blocking message, in the same style as Send.jsx's dustBlock: either
    // a per-buy dust violation the buyer fixes by raising Fills, or, when the
    // dispenser can't be bought from at any fill count, a fixed refusal.
    const buyDustBlock = useMemo(() => {
        if (!priceFloor || minFills <= 1) return null;
        if (dispenserPricedBelowFloor) {
            return 'This dispenser cannot be bought from as priced: every payment it can '
                + `still pay out prices below the ${priceFloor.floor} ${feeCoinTicker} minimum `
                + 'the network will relay.';
        }
        if (fillsCount != null && fillsCount < BigInt(minFills)) {
            return `Buying fewer than ${minFills} fills builds a payment under `
                + `${priceFloor.floor} ${feeCoinTicker}, which every node refuses. Enter at `
                + `least ${minFills} fills to buy from this dispenser.`;
        }
        return null;
    }, [priceFloor, minFills, dispenserPricedBelowFloor, fillsCount, feeCoinTicker]);

    // Retract the refusal once Fills clears it, identity-matched against what
    // this guard itself pushed (mirrors Send.jsx's dustErrorRef) so an
    // unrelated submit failure sitting in buyError is never wiped out from
    // under the buyer.
    const buyDustErrorRef = useRef(/** @type {string | null} */ (null));
    useEffect(() => {
        if (buyDustBlock) return;
        const pushed = buyDustErrorRef.current;
        buyDustErrorRef.current = null;
        setBuyError((prev) => (prev !== null && prev === pushed ? null : prev));
    }, [buyDustBlock]);

    // The plain-language line shown whenever a purchase floor applies at all,
    // even before Fills holds an invalid value.
    const minFillsNotice = (priceFloor && minFills > 1 && !dispenserPricedBelowFloor)
        ? `The smallest purchase is ${minFills} fills (${priceFloor.minPayment} ${feeCoinTicker}): `
            + `${feeCoinTicker} payments under ${priceFloor.floor} ${feeCoinTicker} are refused by every node.`
        : null;

    const totalPayAmount = useMemo(() => {
        if (!getAmount || fillsCount == null) return null;
        // `buyRequest` sends this exact value on the wire as the SEND amount,
        // so it must be computed in exact decimal space. Float multiplication
        // drifts ('0.1' x 3 -> '0.30000000000000004') and collapses tiny
        // amounts to scientific notation ('0.00000001' x 3 -> '3e-8'), either
        // of which the encoder rejects or mis-prices. The display string is
        // derived from this same exact value.
        return multiplyAmounts(getAmount, fillsCount.toString());
    }, [getAmount, fillsCount]);

    const totalReceive = useMemo(() => {
        if (!giveAmount || fillsCount == null) return null;
        return multiplyAmounts(giveAmount, fillsCount.toString());
    }, [giveAmount, fillsCount]);

    // What ONE fill of a Mode B (oracle-priced) dispenser costs in its fiat
    // currency. The oracle publishes the price of one TOKEN - its own publishing
    // form says "Price of one <TICK> in <FIAT>" - and a fill is GIVE_AMOUNT
    // tokens, so the figure a buyer has to send is the quote multiplied out. The
    // panel used to print the bare quote as the fill price, which was right about
    // the chain of the day (settlement spent the quote as the price of one whole
    // fill) and wrong about the price: it under-stated a GIVE_AMOUNT-5 fill by
    // 5x. Settlement now divides by GIVE_AMOUNT
    // (DISPENSER_ORACLE_PER_TOKEN_PRICE), so per-token is what the quote means
    // everywhere and this multiplication is what a buyer owes.
    //
    // Exact decimal multiplication, never floats: a fiat price of '0.05' times a
    // GIVE_AMOUNT of '3' has to read 0.15, not 0.15000000000000002.
    // Null whenever there is nothing trustworthy to multiply (no live quote, or
    // an ownership dispenser, which carries no GIVE_AMOUNT and sells one record
    // rather than a token quantity), so the copy falls through to its explicit
    // "no price to show" branch instead of quoting a guess.
    const oracleFillPrice = useMemo(() => {
        if (oracleQuote?.value == null) return null;
        if (!giveAmount) return String(oracleQuote.value);
        return multiplyAmounts(String(oracleQuote.value), String(giveAmount));
    }, [oracleQuote, giveAmount]);

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

    // Apply the same three policy pairs as settlement: the dispenser, the
    // payment token, and the dispensed token. Each list read uses its resolved
    // current membership through listMembers().

    // Fetch current token-policy pointers on every assessment so token edits
    // cannot leave the detail page using metadata from an earlier render.
    // Deduplicate shared list references before reading their memberships.

    // Keep failed reads unknown; only a resolved membership answer drives a
    // refusal verdict.
    const readBuyerPolicies = useCallback(async () => {
        const readToken = async (tick) => {
            if (!tick || typeof messaging.getTokenInfo !== 'function') return null;
            try {
                return await messaging.getTokenInfo({ chainId, tick });
            } catch {
                return null;
            }
        };
        const [paymentInfo, giveInfo] = await Promise.all([
            readToken(getTick),
            readToken(giveTick),
        ]);
        const refs = [
            { scope: 'dispenser', allowList: currentAllowList, blockList: currentBlockList },
            { scope: 'payment token', allowList: paymentInfo?.allowList, blockList: paymentInfo?.blockList },
            { scope: 'dispensed token', allowList: giveInfo?.allowList, blockList: giveInfo?.blockList },
        ];
        const indexes = [...new Set(refs
            .flatMap((policy) => [policy.allowList, policy.blockList])
            .filter((index) => index != null && String(index) !== '')
            .map(String))];
        const members = new Map();
        if (typeof messaging.getListByActionIndex === 'function') {
            await Promise.all(indexes.map(async (index) => {
                try {
                    const detail = await messaging.getListByActionIndex({ chainId, actionIndex: index });
                    members.set(index, listMembers(detail));
                } catch {
                    members.set(index, null);
                }
            }));
        }
        return refs.map((policy) => ({
            ...policy,
            allowMembers: policy.allowList != null
                ? members.get(String(policy.allowList)) ?? null : null,
            blockMembers: policy.blockList != null
                ? members.get(String(policy.blockList)) ?? null : null,
        }));
    }, [chainId, currentAllowList, currentBlockList, getTick, giveTick, messaging]);

    const [buyerPolicies, setBuyerPolicies] = useState(/** @type {any[]} */ ([]));
    const [eligibilityChecking, setEligibilityChecking] = useState(true);
    useEffect(() => {
        let live = true;
        setEligibilityChecking(true);
        readBuyerPolicies()
            .then((policies) => {
                if (!live) return;
                setBuyerPolicies(policies);
                setEligibilityChecking(false);
            })
            .catch(() => { if (live) setEligibilityChecking(false); });
        return () => { live = false; };
    }, [readBuyerPolicies]);

    // Judge only the address the purchase flow will actually put in `from`.
    const buyerVerdict = useMemo(() => buyerListVerdict({
        addresses: buyerAddress?.address ? [buyerAddress.address] : [],
        policies: buyerPolicies,
    }), [buyerAddress, buyerPolicies]);
    const dispenserVerdict = useMemo(() => buyerListVerdict({
        addresses: dispAddr ? [dispAddr] : [],
        policies: buyerPolicies,
    }), [dispAddr, buyerPolicies]);
    const dispenserSelfBarred = dispenserVerdict.verdict === 'refused';
    const buyerEligibilityBarred = buyerVerdict.verdict === 'refused';
    const buyerListNotice = dispenserSelfBarred
        ? dispenserRefusesEveryoneMessage()
        : buyerListMessage(buyerVerdict);
    const tokenPolicyDescriptions = buyerPolicies.flatMap((policy) => {
        if (policy.scope === 'dispenser') return [];
        const descriptions = [];
        if (policy.allowList != null && String(policy.allowList) !== '') {
            descriptions.push(`${policy.scope} allow-list #${policy.allowList}`);
        }
        if (policy.blockList != null && String(policy.blockList) !== '') {
            descriptions.push(`${policy.scope} block-list #${policy.blockList}`);
        }
        return descriptions;
    });

    const refreshBuyerEligibility = useCallback(async () => {
        setEligibilityChecking(true);
        const policies = await readBuyerPolicies();
        setBuyerPolicies(policies);
        setEligibilityChecking(false);
        const payerVerdict = buyerListVerdict({
            addresses: buyerAddress?.address ? [buyerAddress.address] : [],
            policies,
        });
        const payToVerdict = buyerListVerdict({
            addresses: dispAddr ? [dispAddr] : [],
            policies,
        });
        return payerVerdict.verdict === 'refused' || payToVerdict.verdict === 'refused';
    }, [buyerAddress, dispAddr, readBuyerPolicies]);

    // D-37: what the paying address actually holds of the payment
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
        tick: payTick,
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
        const tickLabel = String(payTick || '').toUpperCase();
        return {
            verdict: covered < 0 ? 'fail' : 'pass',
            restricted: true,
            findings: covered < 0
                ? [{
                    // The registry code, hand-copied as a literal for the same
                    // reason PreflightPanel's Tier-1 codes are literals: nothing
                    // in packages/core may pull the SDK into the extension
                    // bundle. `findings[].code` has ONE normative home
                    // (FINDING_CODES in the SDK's preflight/constants.js)
                    // because the code is the IDENTITY every code-keyed consumer
                    // matches on - the override key (utils/preflightFindingKey.js),
                    // the Approve gate (hooks/useConfirmAction.js), the panel's
                    // ack test id - so a code invented at this call site is one
                    // none of them can recognise. The wallet's other producer of
                    // this report shape (packages/web/src/hostBridge.js) already
                    // emits the registry literal.
                    //
                    // `overridable: false` diverges from the registry's `network`
                    // classification of this code, deliberately. That
                    // classification exists to give the user an escape hatch from
                    // a censored or stale NETWORK answer; this report is local
                    // arithmetic against a balance this wallet already read, so
                    // there is no staleness to trade against and an override
                    // would buy only a rejected action and a wasted fee. The same
                    // reasoning is written out at length in
                    // test/e2e/tests/dispensers/buy-funding.regtest.spec.js.
                    code: 'BALANCE_INSUFFICIENT',
                    severity: 'error',
                    overridable: false,
                    message: `This buy pays ${formatWithThousands(totalPayAmount)} ${tickLabel},`
                        + ` but this address holds ${formatWithThousands(buyBalance)} ${tickLabel}.`,
                }]
                : [],
            unverified: [{
                check: 'dispenser_state',
                reason: (isTokenPaid
                    ? 'Only your payment-token balance was checked.'
                    : `Only your ${tickLabel} balance was checked, and the network fee comes on top.`)
                    + ' The dispenser can still close or sell out before your payment confirms.',
            }],
        };
    }, [canBuyWithSend, totalPayAmount, buyBalance, payTick, isTokenPaid]);
    const buyUnderfunded = buyPreflight?.verdict === 'fail';

    const buyHw = isHwSource(buyerAddress);
    const [buyHwStatus, setBuyHwStatus] = useState('idle');
    const onBuyHwStatusChange = useCallback(({ status }) => setBuyHwStatus(status), []);
    const buyConfirm = useActionConfirmFlow({ messaging, walletId, slice: 'send' });
    const buyFrom = useMemo(() => (buyerAddress ? {
        address: buyerAddress.address,
        publicKey: buyerAddress.publicKey,
        derivationPath: buyerAddress.derivationPath,
        addressId: buyerAddress.id,
        source: buyerAddress.source,
        signerId: buyerAddress.signerId,
    } : null), [buyerAddress]);
    const submitConfirmedBuy = useConfirmSubmit({
        messaging,
        isHw: buyHw,
        signerId: buyerAddress?.signerId,
        passwordRef: buyPasswordRef,
        software: 'sendToken',
        hardware: 'sendAssetHw',
    });
    const buyRequest = useMemo(() => {
        if (!buyFrom || !payTick || !dispAddr || !totalPayAmount) return null;
        return {
            walletId,
            chainId,
            from: buyFrom,
            to: dispAddr,
            tick: payTick,
            amount: totalPayAmount,
            ...(feePerKb != null ? { feePerKb } : {}),
            // Label the pending payment as a buy instead of a plain send.
            actionSummary: `Buy ${fillsCount} fill${fillsCount === 1n ? '' : 's'} from dispenser #${actionIndex}:`
                + ` ${totalPayAmount} ${payTick}`
                + (totalReceive ? ` for ${totalReceive} ${giveTick || ''}`.trimEnd() : ''),
        };
    }, [buyFrom, payTick, dispAddr, totalPayAmount, walletId, chainId, feePerKb,
        fillsCount, actionIndex, totalReceive, giveTick]);
    const dispensersAtBuyDestination = useDispenserDestination({
        messaging,
        chainId,
        to: dispAddr || '',
        paymentTick: payTick,
        isNativePayment: coinBuyable,
        enabled: canBuyWithSend,
    });
    const buyDestinationNotice = useMemo(() => dispenserDestinationNotice({
        dispensers: dispensersAtBuyDestination,
        payer: buyerAddress?.address,
        amount: totalPayAmount || '',
    }), [dispensersAtBuyDestination, buyerAddress?.address, totalPayAmount]);
    const buyConfirmNotes = (
        <>
            {buyDestinationNotice ? (
                <div data-testid="buy-dispenser-notice">
                    <StatusMessage variant="status">{buyDestinationNotice.summary}</StatusMessage>
                    {buyDestinationNotice.warnings.length > 0 ? (
                        <div role="alert" className={styles.warnings}>
                            {buyDestinationNotice.warnings.map((warning) => (
                                <p key={warning} className={styles.warning}>{warning}</p>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}
            <p className={styles.hint}>
                The dispenser triggers when your payment confirms. If the dispenser
                closes or runs out before then, the payment reaches the creator but
                no {giveTick} is released. This is a normal risk when buying on
                these chains.
            </p>
        </>
    );
    // Close, refill and edit all sign through the shared confirm page, which
    // runs the network dry run and signs the bytes it previewed.
    const ownerLane = useOwnerActionLane({
        messaging,
        walletId,
        chainId,
        owner: ownerAddress,
        software: 'dispenserAction',
        hardware: 'dispenserActionHw',
    });

    // The NEW allow-list's members, read as soon as the owner types a list
    // number, so the edit form can say before signing when the dispenser's
    // own address is missing from it. Keyed by index so a stale read for a
    // list the owner has since retyped never produces the warning.
    const editAllowIdx = boundListIndex(editAllowList) || '';
    const [editAllowRead, setEditAllowRead] = useState(
        /** @type {{ idx: string, members: string[] | null } | null} */ (null),
    );
    useEffect(() => {
        if (!editAllowIdx || !chainId || typeof messaging.getListByActionIndex !== 'function') return undefined;
        let live = true;
        const timer = setTimeout(() => {
            messaging.getListByActionIndex({ chainId, actionIndex: editAllowIdx })
                .then((detail) => { if (live) setEditAllowRead({ idx: editAllowIdx, members: listMembers(detail) }); })
                .catch(() => { /* best-effort: no warning beats a wrong one */ });
        }, 400);
        return () => { live = false; clearTimeout(timer); };
    }, [editAllowIdx, chainId, messaging]);
    const editAllowSelfWarning = editAllowIdx && editAllowRead?.idx === editAllowIdx
        && ownerOffAllowList({ members: editAllowRead.members, getAddress: dispAddr })
        ? ownerOffAllowListMessage(dispAddr)
        : null;
    // One list in both slots admits nobody; checked against the pair the
    // dispenser will hold after the edit, so the edit is refused.
    const editListConflictText = editListConflict({
        allowList: editAllowList.trim(),
        blockList: editBlockList.trim(),
        currentAllowList,
        currentBlockList,
    });

    // Turn a failed sign into house copy; the thrown text survives only as the fallback.
    const submitFailureText = (err, fallback) => (err?.name === 'InvalidPasswordError'
        ? 'Incorrect password.'
        : submitFailureMessage(err, {
            chainId, coinTicker: feeCoinTicker, mandatory: nativeFee.mandatory,
            fallback: err?.message || fallback,
        }));

    const beginBuy = useCallback(async () => {
        if (buyStage === 'submitting' || !buyRequest) return;
        if (priceStale) {
            setBuyError(DISPENSER_PRICE_STALE_MESSAGE);
            return;
        }
        // Resolve every buyer and pay-to list before any transaction reaches Confirm.
        if (await refreshBuyerEligibility()) return;
        if (buyUnderfunded || buyDustBlock) return;
        setBuyStage('submitting');
        setBuyError(null);
        try {
            const res = ownerLane.isWatcherMode
                ? await messaging.buildSendPsbtRequest(buyRequest)
                : await buyConfirm.run({
                    chainId,
                    from: buyRequest.from,
                    compose: () => messaging.composeForConfirm(buyRequest),
                    onApprove: async (prebuiltPsbt) => {
                        // Recheck at approval because list edits can land while Confirm is open.
                        if (await refreshBuyerEligibility()) {
                            throw new Error(
                                'The selected paying address or dispenser address is refused by a current access list.',
                            );
                        }
                        return submitConfirmedBuy({ ...buyRequest, prebuiltPsbt });
                    },
                });
            setBuyResult(res);
            setBuyStage('done');
        } catch (err) {
            setBuyStage('idle');
            if (!isUserRejection(err)) setBuyError(submitFailureText(err, 'Buy failed.'));
        } finally {
            setBuyPassword('');
        }
    }, [buyStage, buyRequest, priceStale, refreshBuyerEligibility, buyUnderfunded, buyDustBlock,
        ownerLane.isWatcherMode, buyConfirm, chainId, messaging, submitConfirmedBuy]);

    /**
     * Sign one owner action (close, refill or edit) and settle its stage.
     * A full wallet opens the shared confirm page, so the network dry run
     * runs and Approve signs the exact bytes previewed; Reject returns to
     * the form quietly. Watcher mode builds an unsigned transaction instead.
     */
    async function runOwnerAction({ params, setStage, setError, setResult, fallback, onSigned }) {
        setStage('submitting');
        setError(null);
        // Demo wallet: fabricated dispensers can't broadcast; simulate.
        if (flowsLib.isDemoWallet(walletId)) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            setResult({ txid: null });
            setStage('done');
            onSigned?.({ txid: null });
            return;
        }
        try {
            const res = await ownerLane.run({
                actionData: { action: 'DISPENSER', params },
                encoderOpts: {
                    // `flag` is true or undefined, never false, so on Bitcoin
                    // (where the fee is opt-in) this leaves the payload untouched.
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                submitExtra: { params },
            });
            setResult(res || {});
            setStage('done');
            onSigned?.(res || {});
        } catch (err) {
            setStage('confirm');
            if (!isUserRejection(err)) setError(submitFailureText(err, fallback));
        }
    }

    async function handleRefill(event) {
        event.preventDefault();
        if (refillStage === 'submitting' || !ownerAddress) return;
        const amt = refillAmount.trim();
        if (!amt || !(Number(amt) > 0)) { setRefillError('Enter a refill amount.'); return; }
        // D-147: a spent ceiling is refused here as well as on the button.
        if (refillCount.remaining <= 0 && refillCount.exact) return;
        await runOwnerAction({
            params: {
                VERSION: '2',
                DISPENSER_ACTION_INDEX: String(actionIndex),
                GIVE_ESCROW: amt,
            },
            setStage: setRefillStage,
            setError: setRefillError,
            setResult: setRefillResult,
            fallback: 'Refill failed.',
        });
    }

    async function handleEdit(event) {
        event.preventDefault();
        if (editStage === 'submitting' || !ownerAddress) return;

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
            if (!/^\d+$/.test(alTrim)) { setEditError('Allow list must be a list number (digits only).'); return; }
            params.ALLOW_LIST = alTrim;
            changedLists = true;
        }
        const blTrim = editBlockList.trim();
        if (blTrim) {
            if (!/^\d+$/.test(blTrim)) { setEditError('Block list must be a list number (digits only).'); return; }
            params.BLOCK_LIST = blTrim;
            changedLists = true;
        }
        if (params.EXPIRATION === undefined && params.ALLOW_LIST === undefined && params.BLOCK_LIST === undefined) {
            setEditError('Change at least one field to submit an edit.');
            return;
        }
        // The same list as both allow-list and block-list admits nobody, so
        // this edit is refused unless one slot carries the removal sentinel.
        if (editListConflictText) { setEditError(editListConflictText); return; }

        await runOwnerAction({
            params,
            setStage: setEditStage,
            setError: setEditError,
            setResult: setEditResult,
            fallback: 'Edit failed.',
            onSigned: () => setEditedLists(changedLists),
        });
    }

    async function handleCancel(event) {
        event.preventDefault();
        if (cancelStage === 'submitting' || !ownerAddress) return;
        await runOwnerAction({
            params: cancelParams,
            setStage: setCancelStage,
            setError: setCancelError,
            setResult: setCancelResult,
            fallback: 'Cancel failed.',
            // Only a broadcast cancel has started the close window.
            onSigned: (res) => { if (res.txid || res.broadcast?.txid) onCanceled?.(); },
        });
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
                            : buyStage === 'submitting'
                                ? 'Confirm buy'
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

    // The confirm page stands in for whichever owner form opened it; that
    // form's state stays intact behind it, so Reject lands back on it.
    if (ownerLane.open) {
        return (
            <ActionConfirmScreen
                {...ownerLane.confirmProps}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                coinTicker={feeCoinTicker}
                signerReady={signerReady}
                hintClassName={styles.hint}
                extraCredentials={(
                    <OwnerConfirmNotes
                        kind={editStage === 'submitting' ? 'edit' : refillStage === 'submitting' ? 'refill' : 'close'}
                        allowListWarning={editAllowSelfWarning}
                        listsChanged={Boolean(editAllowList.trim() || editBlockList.trim())}
                        refillNote={refillCeilingMessage(refillCount)}
                    />
                )}
            />
        );
    }

    if (buyConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={buyConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                coinTicker={feeCoinTicker}
                signerReady={signerReady}
                password={buyPassword}
                onPasswordChange={(value) => {
                    setBuyPassword(value);
                    if (buyError) setBuyError(null);
                }}
                hintClassName={styles.hint}
                hwSource={buyHw ? buyerAddress : null}
                hwStatus={buyHwStatus}
                onHwStatusChange={onBuyHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                extraCredentials={buyConfirmNotes}
            />
        );
    }

    // A watcher build or a signed-but-queued broadcast is not a success:
    // nothing reached the chain yet, so neither gets the "submitted" copy.
    const ownerPendingPanel = (res, onDone) => {
        if (res?.queued) return wrap(<QueuedResultPanel onDone={onDone} what="dispenser update" />);
        if (res?.psbtHex && !(res.txid || res.broadcast?.txid)) {
            return wrap(<WatcherResultPanel result={res} onDone={onDone} />);
        }
        return null;
    };

    if (cancelStage === 'done') {
        const pending = ownerPendingPanel(cancelResult, onBack);
        if (pending) return pending;
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
        const pending = ownerPendingPanel(refillResult, () => { setRefillStage('idle'); setRefillAmount(''); });
        if (pending) return pending;
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
                  * up to 5 refills … a 6th is rejected") with no count, on a
                  * lane that had no dry run then. It now says where THIS dispenser
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
                {/* Off Bitcoin this is mandatory, so the toggle renders
                    as a disclosure rather than a choice - the same treatment the
                    other DISPENSER authoring surfaces give it. */}
                <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={feeCoinTicker} />
                <OwnerLaneFooter
                    isWatcherMode={ownerLane.isWatcherMode}
                    error={refillError}
                    submitting={refillStage === 'submitting'}
                    disabled={refillCount.remaining <= 0 && refillCount.exact}
                    label="Refill dispenser"
                />
            </form>,
        );
    }

    if (editStage === 'done') {
        const pending = ownerPendingPanel(editResult, () => {
            setEditStage('idle');
            setEditExpiration('');
            setEditAllowList('');
            setEditBlockList('');
        });
        if (pending) return pending;
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
                    hint={`Current: ${currentAllowList ? `#${currentAllowList}` : 'none'}. Enter a list number to limit who can trigger this dispenser.`}
                    value={editAllowList}
                    onChange={(e) => { setEditAllowList(e.target.value); if (editError) setEditError(null); }}
                    autoComplete="off"
                />
                {canRemoveList && currentAllowList ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setEditAllowList('0')}>
                        Remove allow list
                    </Button>
                ) : null}
                <Input
                    label="Block list"
                    inputMode="numeric"
                    hint={`Current: ${currentBlockList ? `#${currentBlockList}` : 'none'}. Enter a list number to bar addresses from triggering it.`}
                    value={editBlockList}
                    onChange={(e) => { setEditBlockList(e.target.value); if (editError) setEditError(null); }}
                    autoComplete="off"
                />
                {canRemoveList && currentBlockList ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setEditBlockList('0')}>
                        Remove block list
                    </Button>
                ) : null}
                {anyListFilled ? (
                    <p className={styles.hint}>
                        Allow/block list changes take effect about 1 hour after this
                        transaction confirms, per the dispenser list-edit delay.
                    </p>
                ) : null}
                {/* D-161 on the edit lane: the NEW allow-list gates the
                    dispenser's own address too, so a list without it refuses
                    every buyer. Same check and copy as the create form. */}
                {editAllowSelfWarning ? (
                    <div role="alert" className={styles.warnings}>
                        <p className={styles.warning}>{editAllowSelfWarning}</p>
                    </div>
                ) : null}
                {editListConflictText && editListConflictText !== editError ? (
                    <StatusMessage variant="error" className={styles.error}>{editListConflictText}</StatusMessage>
                ) : null}
                {feeSelector}
                {/* Off Bitcoin this is mandatory, so the toggle renders
                    as a disclosure rather than a choice - the same treatment the
                    other DISPENSER authoring surfaces give it. */}
                <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={feeCoinTicker} />
                <OwnerLaneFooter
                    isWatcherMode={ownerLane.isWatcherMode}
                    error={editError}
                    submitting={editStage === 'submitting'}
                    disabled={Boolean(editListConflictText)}
                    label="Edit dispenser"
                />
            </form>,
        );
    }

    if (buyStage === 'done') {
        if (buyResult?.psbtHex && !(buyResult.txid || buyResult.broadcast?.txid)) {
            return wrap(<WatcherResultPanel result={buyResult} onDone={onBack} />);
        }
        const txid = buyResult?.txid || buyResult?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Buy submitted</h2>
                <p className={styles.hint}>
                    You paid {totalPayAmount} {payTick}. If the dispenser is still open
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
                {/* Off Bitcoin this is mandatory, so the toggle renders
                    as a disclosure rather than a choice - the same treatment the
                    other DISPENSER authoring surfaces give it. */}
                <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={feeCoinTicker} />
                <OwnerLaneFooter
                    isWatcherMode={ownerLane.isWatcherMode}
                    error={cancelError}
                    submitting={cancelStage === 'submitting'}
                    label="Close dispenser"
                    danger
                />
            </form>,
        );
    }

    const source = dispenser?.source || action?.source;
    // Same key trap as dispAddr above: the by-action-index row carries the
    // delegated pay-to address as `get_address`, not `address`. Reading only
    // `address` made the stats hero fall back to `source`, presenting the
    // WRONG pay-to address for a delegated-GET_ADDRESS dispenser (payments
    // to source do not fill; the coin arrives as a plain transfer).
    const dispAddress = dispenser?.address || dispenser?.get_address;
    // D-38: a fill belongs to this dispenser only when it names it (see
    // dispensesOfDispenser for why ticks cannot decide it). Each row arrives
    // tagged `valid`; a refused dispense stays in the list so the attempt is
    // visible, but counts for nothing.
    const matchingDispenses = flowsLib.dispensesOfDispenser(dispenses, actionIndex, dispenser);
    const validDispenseCount = matchingDispenses.filter((d) => d.valid).length;
    const vendedSoFar = flowsLib.vendedTotal(matchingDispenses);

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

    // Allow/block-list warnings, rendered once: in the Buy section when this
    // wallet can pay, otherwise in the pay-here panel.
    const listWarnings = (
        <>
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
            {currentAllowList || currentBlockList || tokenPolicyDescriptions.length > 0 ? (
                <p role="alert" className={styles.warning}>
                    <strong>This dispenser is restricted.</strong>{' '}
                    {currentAllowList
                        ? `Only addresses on list #${currentAllowList} can trigger a fill.`
                        : ''}
                    {currentAllowList && currentBlockList ? ' ' : ''}
                    {currentBlockList
                        ? `Addresses on list #${currentBlockList} are barred from triggering it.`
                        : ''}
                    {tokenPolicyDescriptions.length > 0
                        ? ` Settlement also checks the ${tokenPolicyDescriptions.join(' and ')}.`
                        : ''}
                    {' '}A payment from an address it refuses is <strong>not returned</strong>:
                    the {payTick || getCoin} is spent, the dispense is recorded invalid, and nothing
                    comes back.
                </p>
            ) : null}
            {/*
              * Show the specific eligibility verdict the wallet can resolve
              * from current list membership.
              */}
            {/*
              * Treat the pay-to verdict as payer-independent: a dispenser
              * address refused by any settlement policy sells to nobody.
              */}
            {/*
              * Keep this silent when a read failed or both addresses pass,
              * since the generic restriction warning still stands on its own.
              */}
            {buyerListNotice ? (
                <p role="alert" className={styles.warning}>{buyerListNotice}</p>
            ) : null}
        </>
    );

    return wrap(
        <>
            {isClosing ? (
                <p className={local.closeWindowNote} role="status">
                    Closing: this dispenser is in its 1-hour close window. Remaining escrow
                    returns to the owner when the window ends; dispenses that confirm before
                    then are still honored.
                </p>
            ) : null}
            {isTerminal ? (
                <p className={local.closeWindowNote} role="status">
                    {terminalDispenserNotice(liveStatus, { canReopen: canOpenAgain })}
                </p>
            ) : null}
            {priceStale ? (
                <p role="alert" className={styles.warning}>
                    <strong>{DISPENSER_PRICE_STALE_MESSAGE}</strong>
                    <span>. A payment made now would be refused and kept.</span>
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
                    {/* A fiat-priced dispenser stores GET_AMOUNT 0, which printed as a
                        price would read "0 DOGE", as if free. Same branches as the
                        pay-here panel's price line below, so the two agree. */}
                    {isFiatPriced
                        ? (oracleAddress && fiatAmount == null
                            ? (oracleFillPrice != null
                                ? `${oracleFillPrice} ${fiatCode} (oracle ${oracleAddress})`
                                : (oracleQuoteChecked
                                    ? `${fiatCode} via oracle ${oracleAddress}: no current price (stale)`
                                    : `${fiatCode} via oracle ${oracleAddress}…`))
                            : `${fiatAmount} ${fiatCode}`)
                        : `${formatNum(getAmount)} ${getTick || getCoin || '?'}${getTick ? ' (token)' : getCoin ? ' (native coin)' : ''}`}
                </dd>
                {escrowRemaining != null ? (
                    <>
                        <dt className={styles.detailsLabel}>Balance</dt>
                        <dd className={styles.detailsValue}>
                            {formatNum(escrowRemaining)} {giveTick || ''} in escrow
                        </dd>
                    </>
                ) : null}
                {dispensesLoaded ? (
                    <>
                        <dt className={styles.detailsLabel}>Dispenses</dt>
                        <dd className={styles.detailsValue}>
                            {formatNum(validDispenseCount)} of 1,000 this fill
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
                {vendedSoFar != null ? (
                    <>
                        <dt className={styles.detailsLabel}>Vended</dt>
                        <dd className={styles.detailsValue} data-testid="vended-total">
                            {formatNum(vendedSoFar)} {giveTick || ''} in {validDispenseCount} fill{validDispenseCount === 1 ? '' : 's'}
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
                <dt className={styles.detailsLabel}>Allow list</dt>
                <dd className={styles.detailsValue}>{currentAllowList ? `#${currentAllowList}` : 'none'}</dd>
                <dt className={styles.detailsLabel}>Block list</dt>
                <dd className={styles.detailsValue}>{currentBlockList ? `#${currentBlockList}` : 'none'}</dd>
                {dispenser?.memo ? (
                    <>
                        <dt className={styles.detailsLabel}>Memo</dt>
                        <dd className={styles.detailsValue}>{dispenser.memo}</dd>
                    </>
                ) : null}
            </dl>

            <div className={local.quickActions} role="group" aria-label="Dispenser actions">
                {/* Terminal statuses drop Close / Refill / Edit outright: the
                    chain refuses all three unless the status is open, and a
                    disabled button's tooltip never shows on a phone. */}
                {isTerminal ? (canOpenAgain ? (
                    <button
                        type="button"
                        className={local.quickAction}
                        onClick={() => onOpenAgain(reopenTermsFrom(dispenser, liveState, { chainId }))}
                        title="Open a new dispenser on this address with the same terms"
                    >
                        <span className={local.quickActionIcon} aria-hidden="true"><Icon.RefreshIcon /></span>
                        <span>Open again</span>
                    </button>
                ) : null) : (
                    <>
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
                    </>
                )}
                <button
                    type="button"
                    className={local.quickAction}
                    onClick={() => {
                        const base = descriptor?.explorer?.defaultUrl || branding.DEFAULT_EXPLORER_BASE;
                        // The explorer base is bare; append the coin path segment.
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
                    ) : lifecycleTimeline.slice(0, 40).map((e) => {
                        const refused = e.kind === 'dispense' && !e.row.valid;
                        return (
                            <li key={`${e.kind}-${e.row.action_index}`}>
                                <div className={`${local.dispenseRow} ${refused ? local.dispenseInvalid : ''}`}>
                                    <span className={local.dispenseAmount}>
                                        {refused ? 'Dispense refused' : (LIFECYCLE_LABEL[e.kind] || e.kind)}
                                    </span>
                                    <span className={local.dispensePaid}>
                                        {e.kind === 'dispense'
                                            ? `${formatNum(e.row.give_amount)} ${e.row.give_tick || giveTick || ''}`
                                            : (e.row.expiration ? `expires ${e.row.expiration}` : `#${e.row.action_index}`)}
                                        {refused ? <InvalidMarker row={e.row} /> : null}
                                    </span>
                                    <span className={local.dispenseWhen}>
                                        {e.row.block_index ? `block ${e.row.block_index}` : ''}
                                    </span>
                                </div>
                            </li>
                        );
                    })}
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
                            <div className={`${local.dispenseRow} ${d.valid ? '' : local.dispenseInvalid}`}>
                                <span className={local.dispenseAmount}>
                                    {formatNum(d.give_amount)} {d.give_tick || giveTick || ''}
                                </span>
                                <span className={local.dispensePaid}>
                                    {paidAmount != null ? `for ${formatNum(paidAmount)} ${paidUnit}`.trim() : ''}
                                    {d.valid ? null : <InvalidMarker row={d} />}
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
                        {isTokenPaid
                            ? `Send ${getAmount} ${getTick} per fill. Tokens dispense when the SEND`
                            : `Pay ${getAmount} ${payTick} per fill from this wallet. Tokens dispense when the payment`}
                        {' '}confirms and the dispenser is still open.
                    </p>
                    {listWarnings}
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
                    {minFillsNotice ? (
                        <p className={styles.hint} data-testid="min-fills-notice">{minFillsNotice}</p>
                    ) : null}
                    {buyDustBlock ? (
                        <p role="alert" className={styles.warning} data-testid="buy-dust-block">{buyDustBlock}</p>
                    ) : null}
                    <p className={styles.hint} data-testid="buy-balance">
                        {buyBalance == null
                            ? `Checking your ${String(payTick).toUpperCase()} balance…`
                            : `${formatWithThousands(buyBalance)} ${String(payTick).toUpperCase()} available`}
                    </p>
                    {buyPreflight ? (
                        <PreflightPanel
                            report={buyPreflight}
                            acknowledged={NO_ACKNOWLEDGMENTS}
                            onAcknowledge={() => {}}
                        />
                    ) : null}
                    {buyError ? (
                        <StatusMessage variant="error" className={styles.error}>{buyError}</StatusMessage>
                    ) : null}
                    {ownerLane.isWatcherMode ? (
                        <p className={styles.hint}>
                            Watcher mode: this wallet will build an unsigned transaction. Sign it on your
                            Signer-mode wallet, then broadcast from a Full-mode wallet.
                        </p>
                    ) : null}
                    <Button
                        variant="primary"
                        onClick={beginBuy}
                        loading={buyStage === 'submitting' || buyConfirm.composing}
                        disabled={fillsCount == null || !totalPayAmount || !buyerAddress || !dispAddr
                            || buyUnderfunded || Boolean(buyDustBlock) || eligibilityChecking
                            || buyerEligibilityBarred || dispenserSelfBarred || priceStale
                            || buyStage === 'submitting' || buyConfirm.composing}
                    >
                        {ownerLane.isWatcherMode
                            ? 'Create unsigned transaction'
                            : `Buy ${fillsCount != null ? `${fillsCount} ` : ''}fill${fillsCount === 1n ? '' : 's'}`}
                    </Button>
                </section>
            ) : null}

            {showPayHere ? (
                <section style={{ marginTop: '1rem', padding: '0.75rem', border: '1px solid var(--xc-border)', borderRadius: '4px' }}>
                    <p className={styles.successLabel}>Pay to buy</p>
                    {canBuyWithSend ? null : listWarnings}
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
                                        prices ONE TOKEN, and a fill is GIVE_AMOUNT
                                        tokens, so the fill price is the quote
                                        multiplied out (see oracleFillPrice). The
                                        per-token quote is shown beside it whenever a
                                        fill is more than one token, because that is
                                        the number the oracle's own feed publishes and
                                        a buyer comparing the two should not have to
                                        guess which is which. */}
                                    {oracleAddress && fiatAmount == null
                                        ? (oracleFillPrice != null
                                            ? `${oracleFillPrice} ${fiatCode}`
                                              + (giveAmount && String(giveAmount) !== '1'
                                                  ? ` (${giveAmount} ${giveTick || 'tokens'} at `
                                                    + `${oracleQuote.value} ${fiatCode} each)`
                                                  : '')
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
                        {canBuyWithSend
                            ? `Paying from another ${getCoin} wallet works too: send the amount above to this address.`
                            : isFiatPriced
                                ? `This wallet cannot size a fiat-priced payment before it lands; use any ${getCoin} wallet to trigger the dispense.`
                                : `No spendable ${getCoin} address in this wallet on this chain; use any ${getCoin} wallet to trigger the dispense.`}
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

/**
 * The bottom of an owner form: the watcher-mode note, the error, and the one
 * button. Credentials live on the confirm page, not here, because nothing is
 * signed until the dry run has been seen there.
 */
function OwnerLaneFooter({ isWatcherMode, error, submitting, disabled = false, label, danger = false }) {
    return (
        <>
            {isWatcherMode ? (
                <p className={styles.hint}>
                    Watcher mode: this wallet will build an unsigned transaction. Sign it on your
                    Signer-mode wallet, then broadcast from a Full-mode wallet.
                </p>
            ) : null}
            {error ? <StatusMessage variant="error" className={styles.error}>{error}</StatusMessage> : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant={danger ? 'danger' : 'primary'}
                    loading={submitting}
                    disabled={submitting || disabled}
                >
                    {isWatcherMode ? 'Create unsigned transaction' : label}
                </Button>
            </div>
        </>
    );
}

/**
 * The dispenser-only facts that must still sit in front of Approve on the
 * confirm page, which shows the decoded action but knows nothing of these.
 */
function OwnerConfirmNotes({ kind, allowListWarning, listsChanged, refillNote }) {
    if (kind === 'refill') return <p className={styles.hint}>{refillNote}</p>;
    if (kind === 'close') {
        return (
            <p className={styles.hint}>
                The dispenser enters a 1-hour close window before remaining escrow is released.
            </p>
        );
    }
    return (
        <>
            {allowListWarning ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>{allowListWarning}</p>
                </div>
            ) : null}
            {listsChanged ? (
                <p className={styles.hint}>
                    Allow/block list changes take effect about 1 hour after this
                    transaction confirms.
                </p>
            ) : null}
        </>
    );
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}

// The marker a refused dispense carries in both lists: the word, then the
// indexer's reason when it gave one, so the attempt stays visible without
// reading as a fill.
function InvalidMarker({ row }) {
    const reason = flowsLib.dispenseInvalidReason(row);
    return (
        <span className={local.dispenseInvalidMarker} data-testid="dispense-invalid">
            <span className={local.dispenseInvalidBadge}>Invalid</span>
            {reason ? <span className={local.dispenseInvalidReason}>{reason}</span> : null}
        </span>
    );
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
