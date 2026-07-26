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
 NetworkField,  Icon, StatusMessage, FeeSelector, AddressField,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useGatedTickNotice, gatedTickWarningCopy } from '../hooks/useGatedTickNotice.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { AmountField } from '../components/AmountField.jsx';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import { formatWithThousands } from '../utils/amountFormat.js';
import { LockedTokenContext } from '../components/LockedTokenContext.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useFormDraft } from '../hooks/useFormDraft.js';
import { useSettings } from '../hooks/useSettings.js';
import styles from './IssueTokenForm.module.css';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// §40.7.1's Mode 1 FIAT dispenser uses the validator oracle (no
// ORACLE_ADDRESS); Mode 2 uses a user oracle (ORACLE_ADDRESS). For
// the initial form we expose the optional ORACLE_ADDRESS + FIAT_CODE
// fields under "Advanced options" so the §40.7.1 primary flow stays
// uncluttered.
const FIAT_CODES = ['USD', 'CAD', 'AUD', 'MXN', 'GBP', 'JPY', 'CNY', 'CHF', 'BRL', 'INR', 'EUR', 'KRW'];

// datetime-local string -> Unix seconds. DISPENSER EXPIRATION is a
// wall-clock Unix timestamp (indexer bclte(EXPIRATION, BLOCK_TIME)),
// same as the DISPENSER v2 edit (PC-19).
function localInputToUnix(localStr) {
    const ms = Date.parse(String(localStr));
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms / 1000);
}

/**
 * Dispenser authoring form (§40.7.1).
 *
 * Opens a new DISPENSER (v0 Create) so a token owner can vend
 * `GIVE_AMOUNT` of their token every time a buyer sends
 * `GET_AMOUNT` of the native coin (or, in the FIAT lane, an
 * oracle-priced fiat-equivalent amount) to the dispenser address.
 *
 * Spec defaults:
 *   - GIVE_COIN + GET_COIN = the current chain's protocol ticker
 *     (BTC / LTC / DOGE). Dispensers do not cross chains.
 *   - GET_TICK = '' (coin-paid) when the buyer pays in the native
 *     coin (the primary §40.7.1 lane). The SDK validator from
 *     xchain-sdk@1.8.1 accepts an empty GET_TICK as long as
 *     GET_COIN is set.
 *   - GET_ADDRESS left empty; protocol defaults to SOURCE.
 *
 * Cancel + Edit (v1 / v2) are not exposed here; those land alongside
 * a dispenser-detail surface in a later step.
 *
 * §16: each dispenser is opened on its own dedicated address. SOURCE
 * stays the token-holding main address (it signs and the escrow debits
 * from it); GET_ADDRESS is a fresh role='dispenser' external address
 * under the active account. This is a single DISPENSER action: it debits
 * SOURCE and escrows into the dispenser at GET_ADDRESS in one tx
 * (DISPENSER.md fresh-address exception; SOURCE keeps cancel authority).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.activeAccountId]   account the dispenser sub-address is derived under
 * @param {() => void} props.onBack
 */
export function DispenserForm({ walletId, activeAccountId, onBack, initialChainId, initialTick, initialFromAddress }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const { settings } = useSettings();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || null));
    const lockedToken = !!(initialChainId && initialTick);
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );
    // §16: the fresh role='dispenser' address used as GET_ADDRESS.
    // Derived once per (chain, account) at review time, so an abandoned
    // form consumes no dispenser index.
    const [dispenserGetAddress, setDispenserGetAddress] = useState(
        /** @type {any | null} */ (null),
    );
    const [derivingGetAddress, setDerivingGetAddress] = useState(false);

    const [ticker, setTicker] = useState((initialTick || '').toUpperCase());
    // PC-26: dispenses carry no gated-key handoff; warn when the
    // dispensed token has gated content.
    const gatedGiveNotice = useGatedTickNotice({ messaging, chainId, tick: ticker });
    const [giveAmount, setGiveAmount] = useState('');
    const [escrow, setEscrow] = useState('');
    const [triggerPrice, setTriggerPrice] = useState('');
    const [oracleAddress, setOracleAddress] = useState('');
    const [fiatCode, setFiatCode] = useState('');
    const [fiatAmount, setFiatAmount] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);
    // PC-20: the rest of the DISPENSER v0 field set. payWith 'token' opens
    // a token-priced lane (GET_TICK/GET_AMOUNT) instead of the native-coin
    // lane; EXPIRATION + allow/block lists complete the field set.
    const [payWith, setPayWith] = useState(/** @type {'coin' | 'token'} */ ('coin'));
    const [getTick, setGetTick] = useState('');
    const [getTokenAmount, setGetTokenAmount] = useState('');
    const [expMode, setExpMode] = useState(/** @type {'default' | 'custom'} */ ('default'));
    const [expInput, setExpInput] = useState('');
    const [allowListIdx, setAllowListIdx] = useState('');
    const [blockListIdx, setBlockListIdx] = useState('');
    const [listPickerFor, setListPickerFor] = useState(/** @type {'allow' | 'block' | null} */ (null));
    // SOURCE address's balance of `ticker` (coin-scale string), backing
    // the escrow AmountField's Max button + "available" footer. Null
    // while unresolved or when no ticker is entered.
    const [sourceTickBalance, setSourceTickBalance] = useState(
        /** @type {string | null} */ (null),
    );
    const [password, setPassword] = useState('');
    const [payFeeInNativeCoin, setPayFeeInNativeCoin] = useState(false);

    // §16 extension: where the dispenser itself lives (GET_ADDRESS).
    //   'new'      derive a fresh dispenser address at review (default)
    //   'current'  open on the active/current address (GET_ADDRESS omitted
    //              when it equals SOURCE; protocol defaults to SOURCE)
    //   'existing' reuse a previously derived role='dispenser' address
    const [addressMode, setAddressMode] = useState(
        /** @type {'new' | 'current' | 'existing'} */ ('new'),
    );
    const [existingAddressId, setExistingAddressId] = useState(
        /** @type {string | null} */ (null),
    );
    const [addressPickerOpen, setAddressPickerOpen] = useState(false);
    // Picker's "New dispenser address" row: generates immediately (same
    // flow as Add addresses with Purpose=Dispenser); guards double-taps.
    const [pickerGenerating, setPickerGenerating] = useState(false);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    // Source (SOURCE) picker: the QR icon on the Source field opens the
    // wallet's own address list. A manual pick pins the source: the newest-receive /
    // best-token-holder auto-selection effects stand down until the chain
    // changes.
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const manualSourceRef = useRef(false);

    // Network fee: Low / Normal / Fast / Custom via FeeSelector. Mirrors
    // SwapForm / ComposeMessage; `feePerKb` prices the broadcast.
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
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Cluster P FOLLOWUP 5: form-draft persistence. Persists every
    // user-visible composition field (chain / source / give terms /
    // advanced fields). Password stays in component state.
    const formDraftTtlMs = Number.isFinite(settings?.privacy?.formDraftTtlMs)
        ? Number(settings.privacy.formDraftTtlMs)
        : undefined;
    const draft = useFormDraft({ view: 'dispenser', walletId, ttlMs: formDraftTtlMs });
    const [draftPending, setDraftPending] = useState(() => draft.hasDraft());
    useEffect(() => {
        if (stage !== 'form' || !draftPending) return;
        draft.save({
            chainId, fromAddressId, ticker, giveAmount, escrow,
            triggerPrice, oracleAddress, fiatCode, fiatAmount,
            showAdvanced, payFeeInNativeCoin, addressMode, existingAddressId,
        });
    }, [
        stage, draftPending, draft,
        chainId, fromAddressId, ticker, giveAmount, escrow,
        triggerPrice, oracleAddress, fiatCode, fiatAmount,
        showAdvanced, payFeeInNativeCoin, addressMode, existingAddressId,
    ]);
    const restoreDraft = useCallback(() => {
        const v = draft.load();
        if (!v) { setDraftPending(false); return; }
        if (typeof v.chainId === 'string') setChainId(v.chainId);
        if (typeof v.fromAddressId === 'string') setFromAddressId(v.fromAddressId);
        if (typeof v.ticker === 'string') setTicker(v.ticker);
        if (typeof v.giveAmount === 'string') setGiveAmount(v.giveAmount);
        if (typeof v.escrow === 'string') setEscrow(v.escrow);
        if (typeof v.triggerPrice === 'string') setTriggerPrice(v.triggerPrice);
        if (typeof v.oracleAddress === 'string') setOracleAddress(v.oracleAddress);
        if (typeof v.fiatCode === 'string') setFiatCode(v.fiatCode);
        if (typeof v.fiatAmount === 'string') setFiatAmount(v.fiatAmount);
        if (typeof v.showAdvanced === 'boolean') setShowAdvanced(v.showAdvanced);
        if (typeof v.payFeeInNativeCoin === 'boolean') setPayFeeInNativeCoin(v.payFeeInNativeCoin);
        if (v.addressMode === 'new' || v.addressMode === 'current' || v.addressMode === 'existing') {
            setAddressMode(v.addressMode);
        }
        if (typeof v.existingAddressId === 'string') setExistingAddressId(v.existingAddressId);
        setDraftPending(true);
    }, [draft]);
    const dismissDraft = useCallback(() => {
        draft.clear();
        setDraftPending(false);
    }, [draft]);

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId, activeAccountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before opening a dispenser.',
                    );
                    return;
                }
                if (!lockedToken) setChainId(first);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, activeAccountId]);

    // §16: drop a previously derived dispenser sub-address when the chain
    // or account changes so review derives a fresh one for the selection.
    useEffect(() => {
        setDispenserGetAddress(null);
    }, [chainId, activeAccountId]);

    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        const all = addressesByChain[chainId] || [];
        if (initialFromAddress) {
            const match = all.find((a) => a.address === initialFromAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        if (manualSourceRef.current) {
            if (all.some((a) => a.id === fromAddressId)) return;
            manualSourceRef.current = false;
        }
        // role='dispenser' excluded: a freshly generated dispenser address
        // is the newest external index, and SOURCE must stay a personal
        // funding address (matches the activeAddress.js convention).
        const addrs = all.filter(
            (a) => a.source === 'hd' && a.role !== 'dispenser'
                && a.derivationPath?.split('/')?.[4] === '0',
        );
        if (addrs.length > 0) {
            const sorted = [...addrs].sort((a, b) => {
                const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                return bi - ai;
            });
            setFromAddressId(sorted[0].id);
        } else {
            setFromAddressId(null);
        }
    }, [chainId, addressesByChain, initialFromAddress]);

    // Balance-resolve SOURCE: the newest-receive default above is a guess
    // at where the token inventory lives. Once a ticker is entered, prefer
    // the account address (on the selected chain) that actually holds the
    // most of that tick, since SOURCE is what the escrow debits. Debounced
    // so typing the ticker doesn't fan out a balance query per keystroke;
    // any failure leaves the newest-receive default untouched. Skipped when
    // the source is pinned by an incoming `initialFromAddress`.
    useEffect(() => {
        const tick = ticker.trim().toUpperCase();
        if (initialFromAddress || manualSourceRef.current) return undefined;
        if (!chainId || !addressesByChain || !tick) return undefined;
        if (typeof messaging.getWalletBalances !== 'function') return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            messaging.getWalletBalances(walletId, activeAccountId)
                .then((byChain) => {
                    if (cancelled || !byChain) return;
                    const entries = byChain[chainId] || [];
                    let bestAddress = null;
                    let bestAmount = 0;
                    for (const entry of entries) {
                        if (!entry || !entry.balances) continue;
                        const rows = decoderLib.balancesFromSdk(entry.balances) || [];
                        const match = rows.find((b) => String(b.tick).toUpperCase() === tick);
                        const amount = match ? Number(match.amount) : 0;
                        if (Number.isFinite(amount) && amount > bestAmount) {
                            bestAmount = amount;
                            bestAddress = entry.address;
                        }
                    }
                    if (bestAddress) {
                        const holder = (addressesByChain[chainId] || [])
                            .find((a) => a.address === bestAddress);
                        if (holder) setFromAddressId(holder.id);
                    }
                })
                .catch(() => { /* keep the newest-receive default on failure */ });
        }, 400);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [ticker, chainId, addressesByChain, activeAccountId, walletId, messaging, initialFromAddress]);

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];

    // Previously derived dispenser addresses on this chain, reusable as
    // the open target when addressMode === 'existing'.
    const existingDispenserAddresses = useMemo(() => {
        if (!chainId || !addressesByChain) return [];
        return (addressesByChain[chainId] || []).filter((a) => a.role === 'dispenser');
    }, [chainId, addressesByChain]);
    const existingAddress = useMemo(() => {
        if (!chainId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === existingAddressId) || null;
    }, [chainId, addressesByChain, existingAddressId]);
    // Chain switch invalidates an 'existing' pick; fall back to 'new'.
    useEffect(() => {
        if (addressMode === 'existing' && !existingAddress) {
            setAddressMode('new');
            setExistingAddressId(null);
        }
    }, [addressMode, existingAddress]);

    // Effective SOURCE for signing / balance checks / review display. The
    // Source field (own-address picker) writes fromAddressId directly, so the
    // source can be any wallet address, including a dispenser address.
    const sourceAddress = fromAddress;

    // Resolve the SOURCE address's balance of the entered ticker for the
    // escrow AmountField (Max + "available"). Debounced on the ticker for
    // the same reason as the source-resolve effect above.
    useEffect(() => {
        const tick = ticker.trim().toUpperCase();
        setSourceTickBalance(null);
        if (!chainId || !sourceAddress || !tick) return undefined;
        if (typeof messaging.getWalletBalances !== 'function') return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            messaging.getWalletBalances(walletId, activeAccountId)
                .then((byChain) => {
                    if (cancelled || !byChain) return;
                    const entries = byChain[chainId] || [];
                    const entry = entries.find((e) => e && e.address === sourceAddress.address);
                    const rows = entry ? decoderLib.balancesFromSdk(entry.balances) || [] : [];
                    const match = rows.find((b) => String(b.tick).toUpperCase() === tick);
                    setSourceTickBalance(match ? String(match.amount) : '0');
                })
                .catch(() => { /* footer just stays empty on failure */ });
        }, 400);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [ticker, chainId, sourceAddress, activeAccountId, walletId, messaging]);

    const fillsEstimate = useMemo(() => {
        const ga = Number(giveAmount);
        const esc = Number(escrow);
        if (!Number.isFinite(ga) || ga <= 0) return null;
        if (!Number.isFinite(esc) || esc <= 0) return null;
        return Math.floor(esc / ga);
    }, [giveAmount, escrow]);

    const summaryLine = useMemo(() => {
        const tick = ticker.trim().toUpperCase() || 'TOKEN';
        const per = giveAmount.trim() || '?';
        const esc = escrow.trim() || '?';
        if (oracleAddress.trim() && fiatCode) {
            // The oracle's usage fee, if it charges one, is a real payment leaving this
            // transaction , so say so here rather than letting it appear only as
            // an unexplained output on the confirm screen.
            return `You will lock ${esc} ${tick}. Each fill sends ${per} ${tick} at the oracle-priced ${fiatCode} rate. If this oracle charges a usage fee, you pay it once, now, from this transaction.`;
        }
        if (fiatAmount.trim() && fiatCode) {
            return `You will lock ${esc} ${tick}. Each fill sends ${per} ${tick} when someone pays ${fiatAmount} ${fiatCode}.`;
        }
        const trig = triggerPrice.trim() || '?';
        const coin = coinTicker || 'coin';
        const fillsNote = fillsEstimate !== null ? ` The dispenser holds about ${fillsEstimate} fills.` : '';
        return `You will lock ${esc} ${tick}. Each time someone sends ${trig} ${coin}, they will receive ${per} ${tick}.${fillsNote}`;
    }, [ticker, giveAmount, escrow, triggerPrice, oracleAddress, fiatCode, fiatAmount, coinTicker, fillsEstimate]);

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = { VERSION: '0' };
        const tick = ticker.trim().toUpperCase();
        const ga = giveAmount.trim();
        const esc = escrow.trim();
        const trig = triggerPrice.trim();
        const oracle = oracleAddress.trim();
        const fa = fiatAmount.trim();

        if (tick) p.GIVE_TICK = tick;
        if (coinTicker) p.GIVE_COIN = coinTicker;
        if (ga) p.GIVE_AMOUNT = ga;
        if (esc) p.GIVE_ESCROW = esc;

        // Coin-paid lane: GET_COIN = chain coin, GET_TICK empty.
        if (coinTicker) p.GET_COIN = coinTicker;

        // §16: GET_ADDRESS by address mode. 'new' = the fresh dedicated
        // dispenser address derived at review; 'existing' = a reused
        // role='dispenser' address; 'current' omits GET_ADDRESS so the
        // protocol defaults to SOURCE. SOURCE stays the token-holding
        // signer and the escrow debits from it in all three modes.
        if (addressMode === 'new' && dispenserGetAddress?.address) {
            p.GET_ADDRESS = dispenserGetAddress.address;
        } else if (addressMode === 'existing' && existingAddress?.address
            && existingAddress.address !== sourceAddress?.address) {
            p.GET_ADDRESS = existingAddress.address;
        }

        if (payWith === 'token') {
            // PC-20 token-priced lane: buyers pay a fixed amount of a TOKEN
            // (GET_TICK) rather than the native coin. Oracle/fiat pricing is
            // coin-only and does not apply here.
            if (getTick.trim()) p.GET_TICK = getTick.trim().toUpperCase();
            if (getTokenAmount.trim()) p.GET_AMOUNT = getTokenAmount.trim();
        } else if (oracle) {
            // Oracle pricing: validator path (fiatAmount + code) or user-
            // oracle path (oracle + code, fiatAmount empty). GET_AMOUNT
            // is typically 0 per DISPENSER.md example 4/5 because the
            // effective coin price is derived dynamically.
            p.GET_AMOUNT = trig || '0';
            p.ORACLE_ADDRESS = oracle;
            if (fiatCode) p.FIAT_CODE = fiatCode;
            if (fa) p.FIAT_AMOUNT = fa;
        } else if (fiatCode && fa) {
            // Validator FIAT path: no oracle, but fiat code + amount set.
            p.GET_AMOUNT = trig || '0';
            p.FIAT_CODE = fiatCode;
            p.FIAT_AMOUNT = fa;
        } else {
            // Plain coin-paid dispenser.
            if (trig) p.GET_AMOUNT = trig;
        }

        // PC-20: EXPIRATION (Unix wall-clock, 'default' omits it) + the
        // allow/block access lists.
        if (expMode === 'custom' && expInput.trim()) {
            const unix = localInputToUnix(expInput.trim());
            if (unix) p.EXPIRATION = String(unix);
        }
        if (allowListIdx) p.ALLOW_LIST = allowListIdx;
        if (blockListIdx) p.BLOCK_LIST = blockListIdx;

        return p;
    }, [ticker, giveAmount, escrow, triggerPrice, oracleAddress, fiatCode, fiatAmount, coinTicker, dispenserGetAddress, addressMode, existingAddress, sourceAddress, payWith, getTick, getTokenAmount, expMode, expInput, allowListIdx, blockListIdx]);

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'DISPENSER',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, actionParams, chainId]);

    async function handleReview(event) {
        event.preventDefault();
        if (derivingGetAddress) return;
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!ticker.trim()) {
            setFormError('Token ticker is required.');
            return;
        }
        if (!/^[A-Za-z0-9.]+$/.test(ticker.trim())) {
            setFormError('Ticker must be A–Z, 0–9 (subtokens may include a period).');
            return;
        }
        const ga = giveAmount.trim();
        if (!ga || Number(ga) <= 0) {
            setFormError('Per-fill give amount must be a positive number.');
            return;
        }
        const esc = escrow.trim();
        if (!esc || Number(esc) <= 0) {
            setFormError('Escrow amount must be a positive number.');
            return;
        }
        if (Number(esc) < Number(ga)) {
            setFormError('Escrow is smaller than a single fill; the dispenser would never dispense.');
            return;
        }
        const oracle = oracleAddress.trim();
        const fa = fiatAmount.trim();
        const trig = triggerPrice.trim();
        if (payWith === 'token') {
            if (!getTick.trim()) { setFormError('Enter the token buyers pay with.'); return; }
            if (!/^\d+(\.\d+)?$/.test(getTokenAmount.trim()) || Number(getTokenAmount.trim()) <= 0) {
                setFormError('Enter a positive token amount buyers pay per fill.'); return;
            }
        } else if (!oracle && !fa && !trig) {
            setFormError('Set a trigger price, or enable fiat / oracle pricing under Advanced.');
            return;
        }
        if (expMode === 'custom') {
            const raw = expInput.trim();
            if (!raw) { setFormError('Pick an expiration date and time, or use the default window.'); return; }
            const unix = localInputToUnix(raw);
            if (!unix || unix <= Math.floor(Date.now() / 1000)) { setFormError('Expiration must be in the future.'); return; }
        }
        if (trig && Number(trig) < 0) {
            setFormError('Trigger price cannot be negative.');
            return;
        }
        if (oracle && !fiatCode) {
            setFormError('Oracle pricing needs a fiat currency. Pick one under Advanced.');
            return;
        }
        if (fa && !/^\d+\.\d{2}$/.test(fa)) {
            setFormError('Fiat amount must look like 12.34.');
            return;
        }
        if (addressMode === 'existing' && !existingAddress) {
            setFormError('Pick an existing dispenser address, or choose a new one.');
            return;
        }
        setFormError(null);
        // §16: derive the dedicated dispenser sub-address (GET_ADDRESS) once
        // per chain/account, after validation so an invalid form consumes no
        // index. SOURCE (fromAddress) is unchanged. If the wallet build has
        // no derivation handler, fall back to opening on SOURCE.
        if (addressMode === 'new' && !dispenserGetAddress && typeof messaging.generateDispenserAddress === 'function') {
            try {
                setDerivingGetAddress(true);
                const addr = await messaging.generateDispenserAddress({
                    walletId,
                    accountId: activeAccountId,
                    chainId,
                });
                setDispenserGetAddress(addr);
            } catch (err) {
                setFormError(err?.message || 'Could not derive a dispenser address.');
                return;
            } finally {
                setDerivingGetAddress(false);
            }
        }
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    const hw = isHwSource(sourceAddress);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    const { isWatcherMode } = useWalletMode();

    //  ( §5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page; hardware +
    // watcher keep the legacy review stage.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = actionConfirm.enabled && !isWatcherMode;
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // : hardware signs the SAME prebuilt PSBT through the same host
    // flow, with the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: sourceAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'dispenserAction',
        hardware: 'dispenserActionHw',
    });

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
    async function openConfirmScreen() {
        const from = {
            address: sourceAddress.address,
            publicKey: sourceAddress.publicKey,
            derivationPath: sourceAddress.derivationPath,
            addressId: sourceAddress.id,
            source: sourceAddress.source,
            signerId: sourceAddress.signerId,
        };
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'DISPENSER', params: actionParams },
                encoderOpts: {
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: actionParams,
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
            draft.clear();
            setDraftPending(false);
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(err?.message || 'Dispenser failed.');
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
        setStage('submitting');
        setSubmitError(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: sourceAddress.address,
                    publicKey: sourceAddress.publicKey,
                    derivationPath: sourceAddress.derivationPath,
                    addressId: sourceAddress.id,
                    source: sourceAddress.source,
                    signerId: sourceAddress.signerId,
                },
                params: actionParams,
                payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'DISPENSER', params: actionParams },
                    encoderOpts: {
                        payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (hw) {
                res = await messaging.dispenserActionHw({ ...base, signerId: sourceAddress.signerId });
            } else {
                res = await messaging.dispenserAction({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
            draft.clear();
            setDraftPending(false);
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            let submitMsg;
            if (isBadPassword) {
                submitMsg = 'Incorrect password.';
            } else if (err?.name === 'NativeFeeForfeitError' && err?.reason === 'unsupported') {
                submitMsg = `Paying the protocol fee in ${coinTicker || 'the native coin'} is not available for this action. Turn it off to pay in XCHAIN.`;
            } else if (err?.name === 'NativeFeeForfeitError') {
                submitMsg = 'The native-coin fee price is temporarily unavailable. Try again in a moment, or turn off native-coin fee payment.';
            } else {
                submitMsg = err?.message || 'Dispenser creation failed.';
            }
            setSubmitError(submitMsg);
            setStage('review');
            if (!isWatcherMode && !hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    function handleBuildAnother() {
        setResult(null);
        setSubmitError(null);
        setStage('form');
    }

        const header = (
        <PageHeader
            onBack={onBack}
            titleIcon={<Icon.TokenIcon />}
            title={stage === 'review' || stage === 'submitting'
                    ? 'Review dispenser'
                    : 'Create Dispenser'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(<div role="alert" className={styles.error}>{loadError}</div>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading…</p>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <WatcherResultPanel
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={onBack}
                />,
            );
        }
        return wrap(
            <>
                <h2 className={styles.successTitle}>Dispenser opened</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : (
                    <p className={styles.hint}>Broadcast complete.</p>
                )}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>{decoded?.summary}</p>
                <p className={styles.hint}>{summaryLine}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>Source</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={sourceAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>Dispenser address</dt>
                    <dd className={styles.detailsValue}>
                        {addressMode === 'new' && dispenserGetAddress ? (
                            <AddressText address={dispenserGetAddress.address} />
                        ) : addressMode === 'existing' && existingAddress ? (
                            <AddressText address={existingAddress.address} />
                        ) : (
                            <AddressText address={fromAddress.address} />
                        )}
                    </dd>
                    {(decoded?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                    <DetailRow
                        label="Network fee"
                        value={feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    />
                </dl>
                {payFeeInNativeCoin ? (
                    <div role="alert" className={styles.warnings}>
                        <p className={styles.warning}>{NATIVE_FEE_WARNING}</p>
                    </div>
                ) : null}
                {decoded && decoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decoded.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this wallet will build an unsigned transaction.
                        Sign it on your Signer-mode wallet, then bring the
                        signed transaction to a Full-mode wallet to broadcast.
                    </p>
                ) : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={sourceAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => {
                            setPassword(v);
                            if (submitError) setSubmitError(null);
                        }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        submitError={submitError}
                        disabled={stage === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
                {(isWatcherMode || hw) && submitError ? (
                    <StatusMessage
                        variant="error"
                        recovery={
                            // Cluster P FOLLOWUP 4: encoder /
                            // network / device errors are recoverable
                            // by returning to the form stage and
                            // adjusting an input or re-staging the HW
                            // device. Wrong-password isn't reachable
                            // here (no password input in HW / watcher
                            // modes).
                            { label: 'Edit', onAction: () => { setSubmitError(null); setStage('form'); } }
                        }
                    >
                        {submitError}
                    </StatusMessage>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={
                            isWatcherMode
                                ? false
                                : hw
                                    ? hwStatus !== 'available'
                                    : (!signerReady && password.length === 0)
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : hw
                                ? `Sign on ${sourceAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : (descriptor ? `Sign on ${descriptor.displayName}` : 'Sign')}
                    </Button>
                </div>
            </form>,
        );
    }

    // Full-screen dispenser-address picker: the standard own-address
    // selector (same screen as My Addresses / every From field), plus a
    // "New dispenser address" action row that generates a role-tagged
    // dispenser address on the spot (same flow as Add addresses with
    // Purpose=Dispenser) and selects it. Picking the SOURCE address
    // itself maps to mode 'current' (GET_ADDRESS omitted; protocol
    // defaults to SOURCE); any other record maps to mode 'existing'.
    // All other form state stays intact behind it.
    if (addressPickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Dispenser address"
                walletId={walletId}
                accountId={activeAccountId}
                chainId={chainId}
                pickerActions={[{
                    key: 'new-dispenser-address',
                    label: pickerGenerating ? 'Generating…' : 'New dispenser address',
                    onSelect: async () => {
                        if (pickerGenerating) return;
                        setPickerGenerating(true);
                        try {
                            const rec = await messaging.generateDispenserAddress({
                                walletId, chainId, accountId: activeAccountId,
                            });
                            const byChain = await messaging.getAddressesByChain(walletId, activeAccountId);
                            setAddressesByChain(byChain);
                            setAddressMode('existing');
                            setExistingAddressId(rec.id);
                            setAddressPickerOpen(false);
                        } catch (err) {
                            setFormError(err?.message || 'Could not generate a dispenser address.');
                            setAddressPickerOpen(false);
                        } finally {
                            setPickerGenerating(false);
                        }
                    },
                }]}
                onPick={(a) => {
                    if (fromAddress && a.id === fromAddress.id) {
                        setAddressMode('current');
                        setExistingAddressId(null);
                    } else {
                        setAddressMode('existing');
                        setExistingAddressId(a.id);
                    }
                    setAddressPickerOpen(false);
                }}
                onBack={() => setAddressPickerOpen(false)}
            />
        );
    }

    // Token picker: spendable balances, rendered in place of the form.
    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                accountId={activeAccountId}
                title="Select token"
                onSelect={(sel) => {
                    setTicker(String(sel.tick || '').toUpperCase());
                    if (!lockedToken && sel.chainId) setChainId(sel.chainId);
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    //  confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                decoded={decoderLib.decodeAction({
                    action: 'DISPENSER',
                    params: actionParams,
                    chainId: chainId || undefined,
                    chainRegistry,
                })}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                // : hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={hw ? sourceAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
    }

    // Source (SOURCE) picker: the wallet's own addresses on the active chain.
    if (listPickerFor) {
        return (
            <ListPickerScreen
                variant={variant}
                messaging={messaging}
                chainId={chainId}
                addresses={addressesByChain?.[chainId] || []}
                filterType="2"
                title={listPickerFor === 'allow' ? 'Choose allow-list' : 'Choose block-list'}
                onSelect={(row) => {
                    if (listPickerFor === 'allow') setAllowListIdx(row.actionIndex); else setBlockListIdx(row.actionIndex);
                    setListPickerFor(null);
                }}
                onBack={() => setListPickerFor(null)}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Source address"
                walletId={walletId}
                accountId={activeAccountId}
                chainId={chainId}
                onPick={(a) => {
                    manualSourceRef.current = true;
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    const draftBanner = draft.hasDraft() && !draftPending ? (
        <StatusMessage
            variant="status"
            recovery={{ label: 'Restore', onAction: restoreDraft }}
        >
            You have an unfinished dispenser draft.
            <button
                type="button"
                onClick={dismissDraft}
                aria-label="Discard saved draft"
                style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: 0,
                    marginInlineStart: 'var(--xc-space-2)',
                    fontSize: 'var(--xc-text-xs)',
                }}
            >
                Discard
            </button>
        </StatusMessage>
    ) : null;

    return wrap(
        <form onSubmit={handleReview} noValidate>
            {draftBanner}
            {lockedToken && chainId ? (
                <LockedTokenContext chainId={chainId} tick={ticker} />
            ) : (
                <>
                    <NetworkField value={chainId} onChange={setChainId} chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} />
                </>
            )}

            {fromAddress ? (
                <>
                    {/* Dispenser address: where the dispenser opens (GET_ADDRESS). */}
                    <AddressField
                        label="Dispenser address"
                        icon="addresses"
                        value={addressMode === 'new'
                            ? 'New dispenser address (generated at preview)'
                            : (addressMode === 'existing' && existingAddress
                                ? existingAddress.address
                                : fromAddress.address)}
                        readOnly
                        onChange={() => {}}
                        onIconClick={() => setAddressPickerOpen(true)}
                        iconLabel="Change dispenser address"
                    />

                    {/* Source: which address funds and signs the action. */}
                    <AddressField
                        label="Source"
                        icon="addresses"
                        value={fromAddress.address}
                        readOnly
                        onChange={() => {}}
                        onIconClick={() => setSourcePickerOpen(true)}
                        iconLabel="Choose source address"
                    />
                </>
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}

            {lockedToken ? null : (
                <TokenField
                    label="Token"
                    value={ticker && chainId ? { chainId, tick: ticker } : null}
                    onOpenPicker={() => setTokenPickerOpen(true)}
                />
            )}
            {gatedGiveNotice.gated ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        {gatedTickWarningCopy(ticker, 'buyers dispensed this token')}
                    </p>
                </div>
            ) : null}
            <AmountField
                label="Give amount (per fill)"
                hint="Tokens sent to the buyer every time the dispenser is triggered."
                amount={giveAmount}
                tick={ticker}
                onAmountFieldChange={(rawValue) => {
                    const stripped = String(rawValue).replace(/,/g, '');
                    if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                    setGiveAmount(stripped);
                }}
                onMax={sourceTickBalance && Number(sourceTickBalance) > 0
                    ? () => setGiveAmount(sourceTickBalance)
                    : undefined}
                maxDisabled={!sourceTickBalance}
                balanceText={sourceTickBalance != null && ticker.trim()
                    ? `${formatWithThousands(sourceTickBalance)} ${ticker.trim().toUpperCase()} available`
                    : null}
            />
            <AmountField
                label="Escrow amount"
                amount={escrow}
                tick={ticker}
                onAmountFieldChange={(rawValue) => {
                    const stripped = String(rawValue).replace(/,/g, '');
                    if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                    setEscrow(stripped);
                }}
                onMax={sourceTickBalance && Number(sourceTickBalance) > 0
                    ? () => setEscrow(sourceTickBalance)
                    : undefined}
                maxDisabled={!sourceTickBalance}
                balanceText={sourceTickBalance != null && ticker.trim()
                    ? `${formatWithThousands(sourceTickBalance)} ${ticker.trim().toUpperCase()} available`
                    : null}
            />
            <p className={styles.pickerLabel}>Buyers pay with</p>
            <label className={styles.pickerLabel} style={{ fontWeight: 'normal' }}>
                <input type="radio" name="disp-pay" checked={payWith === 'coin'} onChange={() => setPayWith('coin')} />
                {' '}Native {coinTicker || 'coin'}
            </label>
            <label className={styles.pickerLabel} style={{ fontWeight: 'normal' }}>
                <input type="radio" name="disp-pay" checked={payWith === 'token'} onChange={() => setPayWith('token')} />
                {' '}A token
            </label>
            {payWith === 'token' ? (
                <>
                    <Input
                        label="Payment token"
                        hint="Ticker buyers pay with (a token, not the native coin)."
                        value={getTick}
                        onChange={(e) => setGetTick(e.target.value.toUpperCase())}
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <Input
                        label="Payment amount (per fill)"
                        hint="Amount of the payment token buyers send per fill."
                        inputMode="decimal"
                        value={getTokenAmount}
                        onChange={(e) => setGetTokenAmount(e.target.value)}
                        autoComplete="off"
                    />
                </>
            ) : (
                <Input
                    label={`Trigger price${coinTicker ? ` (${coinTicker})` : ''}`}
                    hint={`Native ${coinTicker || 'coin'} amount buyers send per fill.`}
                    inputMode="decimal"
                    value={triggerPrice}
                    onChange={(e) => setTriggerPrice(e.target.value)}
                    autoComplete="off"
                />
            )}

            {payWith === 'coin' ? (
                <button
                    type="button"
                    className={styles.pickerLabel}
                    onClick={() => setShowAdvanced((v) => !v)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                >
                    {showAdvanced ? '▾ Advanced options' : '▸ Advanced options (fiat pricing, oracle)'}
                </button>
            ) : null}

            {showAdvanced && payWith === 'coin' ? (
                <>
                    <label className={styles.pickerLabel}>
                        Priced in fiat (optional)
                        <select
                            className={styles.picker}
                            value={fiatCode}
                            onChange={(e) => setFiatCode(e.target.value)}
                        >
                            <option value="">(none, coin-paid)</option>
                            {FIAT_CODES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </label>
                    <Input
                        label="Fiat amount (e.g. 12.34)"
                        hint="Validator-priced fiat dispenser. Leave blank if using a user oracle."
                        inputMode="decimal"
                        value={fiatAmount}
                        onChange={(e) => setFiatAmount(e.target.value)}
                        autoComplete="off"
                    />
                    <Input
                        label="Oracle address (optional)"
                        hint="User-oracle (PRICE v1) address for fiat pricing. Requires a fiat currency. If the oracle charges a usage fee you pay it once, now, from this transaction; the amount scales with the escrow you lock. Paste the full address, not a ^id reference."
                        value={oracleAddress}
                        onChange={(e) => setOracleAddress(e.target.value)}
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                </>
            ) : null}

            <p className={styles.pickerLabel}>Expiration</p>
            <label className={styles.pickerLabel} style={{ fontWeight: 'normal' }}>
                <input type="radio" name="disp-exp" checked={expMode === 'default'} onChange={() => setExpMode('default')} />
                {' '}Default window
            </label>
            <label className={styles.pickerLabel} style={{ fontWeight: 'normal' }}>
                <input type="radio" name="disp-exp" checked={expMode === 'custom'} onChange={() => setExpMode('custom')} />
                {' '}Expire at a specific time
            </label>
            {expMode === 'custom' ? (
                <Input
                    label="Expires"
                    type="datetime-local"
                    hint="Wall-clock time the dispenser closes. Must be in the future."
                    value={expInput}
                    onChange={(e) => setExpInput(e.target.value)}
                />
            ) : null}

            <p className={styles.pickerLabel}>Restrict who can buy (optional)</p>
            <div className={styles.actions}>
                <Button variant="secondary" size="sm" onClick={() => setListPickerFor('allow')}>
                    {allowListIdx ? `Allow-list #${allowListIdx}` : 'Set allow-list'}
                </Button>
                {allowListIdx ? <Button variant="secondary" size="sm" onClick={() => setAllowListIdx('')}>Clear</Button> : null}
                <Button variant="secondary" size="sm" onClick={() => setListPickerFor('block')}>
                    {blockListIdx ? `Block-list #${blockListIdx}` : 'Set block-list'}
                </Button>
                {blockListIdx ? <Button variant="secondary" size="sm" onClick={() => setBlockListIdx('')}>Clear</Button> : null}
            </div>

            {feeTiers ? (
                <FeeSelector
                    label="Network fee"
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                />
            ) : null}

            <div className={styles.feeToggleGap}>
                <NativeFeeToggle
                    checked={payFeeInNativeCoin}
                    onChange={setPayFeeInNativeCoin}
                    coinTicker={coinTicker}
                />
            </div>

            {formError ? (
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || derivingGetAddress || !ticker || !giveAmount || !escrow || actionConfirm.composing}
                >
                    {derivingGetAddress ? 'Preparing…' : 'Create'}
                </Button>
            </div>
        </form>,
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
