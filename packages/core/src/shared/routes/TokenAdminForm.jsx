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
 NetworkField,  Icon, FeeSelector, AddressField,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
    flows as flowsLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { LockedTokenContext } from '../components/LockedTokenContext.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ContactsPickerScreen } from '../components/ContactsPickerScreen.jsx';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { blockDateEstimateText } from '../utils/blockDateEstimate.js';
import { LOCK_FLAGS } from '../utils/issueAdvancedFields.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import styles from './IssueTokenForm.module.css';
import { externalIndexOf } from '../addressSelection.js';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// PC-02's lock matrix and PC-06's create-time lock panel drive the same
// seven ISSUE lock flags, so the table lives in one place (see
// utils/issueAdvancedFields.js) and neither matrix can drift.

/**
 * Token admin surfaces (§40.5).
 *
 * Thin forms on top of the ISSUE mechanism, selected via `mode`:
 *
 *   - `'lock'`:          granular lock matrix (PC-02) over the seven
 *                         independent, one-way ISSUE v3 flags
 *                         (LOCK_MAX_SUPPLY, LOCK_MAX_MINT, LOCK_MINT,
 *                         LOCK_MINT_SUPPLY, LOCK_DESCRIPTION, LOCK_SLEEP,
 *                         LOCK_CALLBACK). Current state is read from
 *                         `getToken` via `useTokenInfo` (same read
 *                         `'mint-settings'` uses): a flag already set on
 *                         the token renders checked and disabled (locks
 *                         cannot be unset - issue.js `isValidLock` only
 *                         allows 0→1 or no-op, never 1→0), everything
 *                         else is check-to-lock. Only the newly-checked
 *                         flags are sent; an omitted v3 field is a no-op
 *                         (issue.js repopulates it from the existing
 *                         token record), never a clear.
 *   - `'description'`:   updates the on-chain DESCRIPTION
 *                         (ISSUE v1 with a single DESCRIPTION field).
 *   - `'transfer'`:      transfers token ownership to another address
 *                         (ISSUE v0 with the TRANSFER field set).
 *   - `'mint-settings'`: edits the ISSUE v2 mint-configuration fields
 *                         (MAX_MINT, MINT_SUPPLY, TRANSFER_SUPPLY,
 *                         MINT_ADDRESS_MAX, MINT_START_BLOCK,
 *                         MINT_STOP_BLOCK). Current values are read
 *                         from `getToken` via `useTokenInfo` and
 *                         prefilled; a field locked by LOCK_MAX_MINT /
 *                         LOCK_MINT / LOCK_MINT_SUPPLY is disabled with
 *                         an explanatory warning (PC-01). Always
 *                         launched from ManageToken (never the free
 *                         Actions menu), since it needs a real token's
 *                         current values to edit.
 *
 * Until the Token detail page (§40.5 home) exists, `'lock'` /
 * `'description'` / `'transfer'` accept a user-entered ticker. Future
 * prop: `initialTicker` so Token detail can prefill. Every mode uses
 * `messaging.issueToken` (no new background handlers or core flows).
 *
 * @typedef {'lock' | 'description' | 'transfer' | 'mint-settings' | 'callback-settings' | 'access-lists'} AdminMode
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {AdminMode} props.mode
 * @param {() => void} props.onBack
 */
export function TokenAdminForm({ walletId, mode, onBack, initialChainId, initialTick, initialFromAddress }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
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

    const [ticker, setTicker] = useState((initialTick || '').toUpperCase());
    const [description, setDescription] = useState('');
    const [transferTo, setTransferTo] = useState('');
    // Mint settings (mode === 'mint-settings', PC-01): the four ISSUE v2
    // config fields (prefilled from the current token record) plus the
    // two "mint additional supply now" fields, which have no current
    // value to prefill (they're a one-shot action, not persisted state).
    const [maxMint, setMaxMint] = useState('');
    const [mintAddressMax, setMintAddressMax] = useState('');
    const [mintStartBlock, setMintStartBlock] = useState('');
    const [mintStopBlock, setMintStopBlock] = useState('');
    const [mintSupply, setMintSupply] = useState('');
    const [transferSupply, setTransferSupply] = useState('');
    // Callback settings (mode === 'callback-settings', PC-03, ISSUE v4):
    // the three CALLBACK config fields, prefilled from the current token
    // record. Editable only while supply is undistributed and while
    // LOCK_CALLBACK is unset.
    const [callbackBlock, setCallbackBlock] = useState('');
    const [callbackTick, setCallbackTick] = useState('');
    const [callbackAmount, setCallbackAmount] = useState('');
    // Access lists (mode === 'access-lists', PC-04, ISSUE v5): the ALLOW_LIST
    // / BLOCK_LIST address-list action indexes, prefilled from the token
    // record. `null` = unset; the picker sets a new action index. Member
    // counts are display-only.
    const [allowListIdx, setAllowListIdx] = useState(/** @type {string | null} */ (null));
    const [blockListIdx, setBlockListIdx] = useState(/** @type {string | null} */ (null));
    const [allowListCount, setAllowListCount] = useState(/** @type {number | null} */ (null));
    const [blockListCount, setBlockListCount] = useState(/** @type {number | null} */ (null));
    const [listPickerFor, setListPickerFor] = useState(/** @type {'allow' | 'block' | null} */ (null));
    const [password, setPassword] = useState('');
    // Lock-mode typed-confirmation gate. Locking is irreversible, so
    // the review stage requires the user to type LOCK before the Sign
    // button enables (on top of the existing password / HW gate).
    const [typedConfirm, setTypedConfirm] = useState('');
    const typedConfirmOk = typedConfirm.trim().toUpperCase() === 'LOCK';
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [contactsPickerOpen, setContactsPickerOpen] = useState(false);
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one first.',
                    );
                    return;
                }
                if (!lockedToken) setChainId(first);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        const all = addressesByChain[chainId] || [];
        // When the caller knows which address must sign (e.g. issuer
        // address from ManageToken), prefer that. Falls through to the
        // standard "newest HD-derived receive-chain address" otherwise.
        if (initialFromAddress) {
            const match = all.find((a) => a.address === initialFromAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        const addrs = all.filter(
            (a) => a.source === 'hd' && externalIndexOf(a.derivationPath) !== null,
        );
        if (addrs.length > 0) {
            const sorted = [...addrs].sort((a, b) => {
                const ai = (externalIndexOf(a.derivationPath) ?? -1);
                const bi = (externalIndexOf(b.derivationPath) ?? -1);
                return bi - ai;
            });
            setFromAddressId(sorted[0].id);
        } else {
            setFromAddressId(null);
        }
    }, [chainId, addressesByChain, initialFromAddress]);

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // PC-51: native-coin protocol fee (every ISSUE edit version this
    // form signs is quotable); authoritative check at submit via
    // applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);

    // Current on-chain lock state, read via the same useTokenInfo hook
    // ManageToken uses. Shared by `'mint-settings'` (PC-01, four of the
    // seven flags gate its own fields) and `'lock'` (PC-02, all seven
    // drive the lock matrix below). `'mint-settings'` is only ever
    // launched from ManageToken with a concrete (chainId, tick) pair
    // (lockedToken is always true for that mode), so `ticker` is stable
    // for the life of the form; `'lock'` can also be reached from the
    // free Actions menu, where `ticker` changes as the owner picks a
    // token and this hook simply refetches.
    const assetInfo = useTokenInfo({ chainId, tick: ticker, skip: mode !== 'mint-settings' && mode !== 'lock' && mode !== 'callback-settings' && mode !== 'access-lists' });
    const tokenLocks = assetInfo?.locks || {};
    // Callback config gate (PC-03): the indexer only allows CALLBACK_BLOCK
    // /TICK/AMOUNT edits while LOCK_CALLBACK is unset AND supply is
    // undistributed (issue.js). LOCK_CALLBACK reads straight off the lock
    // map; distribution needs a holder read (below).
    const callbackLocked = !!tokenLocks.callback;
    // LOCK_MAX_MINT: MAX_MINT itself can't change (issue.js "MAX_MINT (locked)").
    const maxMintLocked = !!tokenLocks.max_mint;
    // LOCK_MINT: the MINT command is permanently dead (mint.js "LOCK_MINT").
    // Not a protocol restriction on MINT_ADDRESS_MAX / the mint window, but
    // editing them has no effect once minting itself can never happen again,
    // so the UI disables them here as a courtesy rather than protocol law.
    const mintDeadLocked = !!tokenLocks.mint;
    // LOCK_MINT_SUPPLY: MINT_SUPPLY (mint-now) is blocked (issue.js "MINT_SUPPLY (locked)").
    const mintSupplyLocked = !!tokenLocks.mint_supply;
    // LOCK_MAX_SUPPLY doesn't gate any ISSUE v2 field (MAX_SUPPLY itself is
    // only editable via v0); surfaced as read-only context, nothing to disable.
    const maxSupplyLockedInfo = !!tokenLocks.max_supply;
    const maxMintFieldDisabled = maxMintLocked || mintDeadLocked;
    const mintWindowFieldsDisabled = mintDeadLocked;
    const mintNowFieldsDisabled = mintSupplyLocked;
    const nothingMintEditable = maxMintFieldDisabled && mintWindowFieldsDisabled && mintNowFieldsDisabled;

    // Lock matrix (PC-02): the seven independent, one-way ISSUE v3 locks.
    // `lockChecks` holds only flags the owner has newly checked THIS
    // session; a flag already set on the token (tokenLocks[key]) is never
    // written here; it renders checked-and-disabled straight off tokenLocks.
    const [lockChecks, setLockChecks] = useState(/** @type {Record<string, boolean>} */ ({}));
    const hasAnyNewLock = LOCK_FLAGS.some((f) => lockChecks[f.key] && !tokenLocks[f.key]);
    const allLocksSet = LOCK_FLAGS.every((f) => !!tokenLocks[f.key]);

    // Prefill the four persisted mint-config fields from the token's
    // current record, once, so re-fetches (or the user editing a field
    // to empty) don't clobber their in-progress edit. MINT_SUPPLY /
    // TRANSFER_SUPPLY have no current value to prefill: they're a
    // one-shot "mint more now" action bundled into the same edit, not
    // persisted token state.
    const [mintPrefilled, setMintPrefilled] = useState(false);
    useEffect(() => {
        if (mode !== 'mint-settings' || !assetInfo || mintPrefilled) return;
        setMaxMint(assetInfo.mintMax || '');
        setMintAddressMax(assetInfo.mintAddressMax || '');
        setMintStartBlock(assetInfo.mintStartBlock || '');
        setMintStopBlock(assetInfo.mintStopBlock || '');
        setMintPrefilled(true);
    }, [mode, assetInfo, mintPrefilled]);

    // Prefill the three callback-config fields once from the token record
    // (PC-03). Same once-only guard as the mint prefill so a re-fetch (or
    // the owner clearing a field) doesn't clobber an in-progress edit.
    const [callbackPrefilled, setCallbackPrefilled] = useState(false);
    useEffect(() => {
        if (mode !== 'callback-settings' || !assetInfo || callbackPrefilled) return;
        setCallbackBlock(assetInfo.callbackBlock || '');
        setCallbackTick(assetInfo.callbackTick || '');
        setCallbackAmount(assetInfo.callbackAmount || '');
        setCallbackPrefilled(true);
    }, [mode, assetInfo, callbackPrefilled]);

    // Prefill the current allow/block list action indexes once (PC-04).
    const [listsPrefilled, setListsPrefilled] = useState(false);
    useEffect(() => {
        if (mode !== 'access-lists' || !assetInfo || listsPrefilled) return;
        setAllowListIdx(assetInfo.allowList || null);
        setBlockListIdx(assetInfo.blockList || null);
        setListsPrefilled(true);
    }, [mode, assetInfo, listsPrefilled]);

    // Member counts for whichever allow/block lists are currently set
    // (display only; one detail read each, tolerant of failure).
    useEffect(() => {
        if (mode !== 'access-lists' || !chainId || !allowListIdx) { setAllowListCount(null); return undefined; }
        if (typeof messaging?.getListByActionIndex !== 'function') return undefined;
        let cancelled = false;
        messaging.getListByActionIndex({ chainId, actionIndex: allowListIdx })
            .then((d) => { if (!cancelled) setAllowListCount(listMemberCount(d)); })
            .catch(() => { if (!cancelled) setAllowListCount(null); });
        return () => { cancelled = true; };
    }, [mode, chainId, allowListIdx, messaging]);
    useEffect(() => {
        if (mode !== 'access-lists' || !chainId || !blockListIdx) { setBlockListCount(null); return undefined; }
        if (typeof messaging?.getListByActionIndex !== 'function') return undefined;
        let cancelled = false;
        messaging.getListByActionIndex({ chainId, actionIndex: blockListIdx })
            .then((d) => { if (!cancelled) setBlockListCount(listMemberCount(d)); })
            .catch(() => { if (!cancelled) setBlockListCount(null); });
        return () => { cancelled = true; };
    }, [mode, chainId, blockListIdx, messaging]);

    // A v5 edit is meaningful only when at least one list changed from the
    // token's current binding (blank = leave-unchanged, so re-submitting
    // the same indexes is a no-op the form shouldn't allow through).
    const listsChanged = mode === 'access-lists' && assetInfo != null && (
        (allowListIdx || null) !== (assetInfo.allowList || null)
        || (blockListIdx || null) !== (assetInfo.blockList || null)
    );

    // Distribution gate (PC-03): CALLBACK config is only editable while
    // supply is undistributed (indexer isDistributed = >1 holder or one
    // non-owner holder). Read the live holder summary so the form can
    // disable the fields with an honest reason. Null while loading /
    // when the read fails: fail toward ALLOWING the edit (the indexer is
    // the real gate; a false "distributed" would wrongly block a valid
    // config change), and let the on-chain validation reject if wrong.
    const [distribution, setDistribution] = useState(/** @type {{ isDistributed: boolean, holderCount: number } | null} */ (null));
    useEffect(() => {
        if (mode !== 'callback-settings' || !chainId || !ticker) { setDistribution(null); return undefined; }
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        if (typeof messaging?.tokenHolderSummary !== 'function') return undefined;
        let cancelled = false;
        const owner = assetInfo?.creator || null;
        messaging.tokenHolderSummary({ chainId, tick: ticker, owner })
            .then((s) => { if (!cancelled) setDistribution(s ? { isDistributed: !!s.isDistributed, holderCount: Number(s.holderCount) || 0 } : null); })
            .catch(() => { if (!cancelled) setDistribution(null); });
        return () => { cancelled = true; };
    }, [mode, chainId, ticker, messaging, walletId, assetInfo?.creator]);
    const callbackDistributed = distribution?.isDistributed === true;
    // Fields lock when LOCK_CALLBACK is set (permanent) or supply is
    // already distributed (config frozen once holders exist).
    const callbackFieldsDisabled = callbackLocked || callbackDistributed;

    // Current indexed block height (same read as History's Indexed-stage
    // timeline, messaging.getIndexerWatermark) so the block-height inputs
    // can caption themselves with an estimated date (blockDateEstimate.js).
    const [currentHeight, setCurrentHeight] = useState(/** @type {number | null} */ (null));
    useEffect(() => {
        if (mode !== 'mint-settings' && mode !== 'callback-settings') return undefined;
        if (!chainId) return undefined;
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        if (typeof messaging?.getIndexerWatermark !== 'function') return undefined;
        let cancelled = false;
        messaging.getIndexerWatermark({ chainId })
            .then((r) => { if (!cancelled) setCurrentHeight(r && r.watermark != null ? Number(r.watermark) : null); })
            .catch(() => { if (!cancelled) setCurrentHeight(null); });
        return () => { cancelled = true; };
    }, [mode, chainId, messaging, walletId]);
    const mintStartEstimate = blockDateEstimateText({ coin: descriptor?.coin, currentHeight, targetBlock: mintStartBlock });
    const mintStopEstimate = blockDateEstimateText({ coin: descriptor?.coin, currentHeight, targetBlock: mintStopBlock });
    const callbackBlockEstimate = blockDateEstimateText({ coin: descriptor?.coin, currentHeight, targetBlock: callbackBlock });
    const hasAnyCallbackField = !!(callbackBlock || callbackTick || callbackAmount);
    const hasAnyMintField = !!(maxMint || mintAddressMax || mintStartBlock || mintStopBlock || mintSupply || transferSupply);

    // Network fee: Low / Normal / Fast / Custom via FeeSelector; feePerKb
    // prices the broadcast (mirrors DispenserForm / SwapForm).
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

    useEffect(() => {
        let cancelled = false;
        if (mode !== 'transfer' || typeof messaging.listContacts !== 'function') return undefined;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setContacts(rows || []); })
            .catch(() => { if (!cancelled) setContacts([]); });
        return () => { cancelled = true; };
    }, [mode, messaging]);

    const actionParams = useMemo(
        () => composeAdminParams(mode, {
            ticker,
            description,
            transferTo,
            maxMint,
            mintAddressMax,
            mintStartBlock,
            mintStopBlock,
            mintSupply,
            transferSupply,
            lockChecks,
            callbackBlock,
            callbackTick,
            callbackAmount,
            allowListIdx,
            blockListIdx,
            currentAllowList: assetInfo?.allowList || null,
            currentBlockList: assetInfo?.blockList || null,
        }),
        [mode, ticker, description, transferTo, maxMint, mintAddressMax,
         mintStartBlock, mintStopBlock, mintSupply, transferSupply, lockChecks,
         callbackBlock, callbackTick, callbackAmount,
         allowListIdx, blockListIdx, assetInfo?.allowList, assetInfo?.blockList],
    );

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'ISSUE',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, actionParams, chainId]);

    function handleReview(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!ticker.trim()) {
            setFormError('Ticker is required.');
            return;
        }
        if (!/^[A-Za-z0-9.]+$/.test(ticker.trim())) {
            setFormError('Ticker must be A–Z, 0–9 (subtokens may include a period).');
            return;
        }
        if (mode === 'description' && !description.trim()) {
            setFormError('Description is required.');
            return;
        }
        if (mode === 'transfer' && !transferTo.trim()) {
            setFormError('New owner address is required.');
            return;
        }
        if (mode === 'lock' && !hasAnyNewLock) {
            setFormError('Select at least one lock to apply.');
            return;
        }
        if (mode === 'mint-settings') {
            if (!hasAnyMintField) {
                setFormError('Enter at least one field to update.');
                return;
            }
            if (mintAddressMax && maxMint && Number(mintAddressMax) < Number(maxMint)) {
                setFormError('Max mint per address must be at least the max mint per transaction.');
                return;
            }
            if (mintStartBlock && mintStopBlock && Number(mintStopBlock) <= Number(mintStartBlock)) {
                setFormError('Minting must close after it opens. Check the block numbers.');
                return;
            }
        }
        if (mode === 'callback-settings') {
            if (callbackLocked) {
                setFormError('Callback settings are permanently locked for this token (LOCK_CALLBACK).');
                return;
            }
            if (callbackDistributed) {
                setFormError('Callback settings can only be changed before any supply is distributed. This token already has holders.');
                return;
            }
            if (!hasAnyCallbackField) {
                setFormError('Enter at least one callback field to update.');
                return;
            }
            if (callbackBlock && (!/^\d+$/.test(String(callbackBlock).trim()) || (currentHeight != null && Number(callbackBlock) < currentHeight))) {
                setFormError('Callback block must be a whole block height at or after the current block.');
                return;
            }
            if (callbackTick && !/^[A-Za-z0-9.]+$/.test(String(callbackTick).trim())) {
                setFormError('Callback token must be a valid ticker.');
                return;
            }
            if (callbackAmount && !(Number(callbackAmount) > 0)) {
                setFormError('Callback amount must be a positive number.');
                return;
            }
            // A usable callback needs all three set (block + tick + amount);
            // warn if the owner is leaving the config half-built. This is a
            // soft guard: a partial edit is protocol-valid (blank = keep),
            // but a token with e.g. a block and no tick can never fire.
            const effTick = callbackTick || assetInfo?.callbackTick;
            const effAmount = callbackAmount || assetInfo?.callbackAmount;
            const effBlock = callbackBlock || assetInfo?.callbackBlock;
            if ((effBlock || effTick || effAmount) && !(effBlock && effTick && effAmount)) {
                setFormError('A working callback needs a block, a payout token, and a payout amount. Fill all three (values you leave blank keep their current setting).');
                return;
            }
        }
        if (mode === 'access-lists') {
            if (!listsChanged) {
                setFormError('Pick a different allow-list or block-list to apply. Leaving both unchanged does nothing.');
                return;
            }
        }
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5: watcher-mode encode-only branch.
    // Token admin uses the ISSUE action with admin-only field combinations.
    const { isWatcherMode } = useWalletMode();

    //  ( §5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page, hardware
    // included . Watcher mode still branches: it encodes, it
    // never signs.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // : hardware signs the SAME prebuilt PSBT through the same host
    // flow, with the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'issueToken',
        hardware: 'issueTokenHw',
    });

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
    async function openConfirmScreen() {
        const from = {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'ISSUE', params: actionParams },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: actionParams,
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(err?.message || 'Update failed.');
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
        setStage('submitting');
        setSubmitError(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                params: actionParams,
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'ISSUE', params: actionParams },
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (isHwSource) {
                res = await messaging.issueTokenHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.issueToken({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || `${MODE_LABEL[mode] || 'Action'} failed.`,
            );
            setStage('review');
            if (!isWatcherMode && !isHwSource) {
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
            title={stage === 'review' || stage === 'submitting'
                    ? `Review ${MODE_LABEL_LOWER[mode]}`
                    : `${MODE_LABEL[mode]}`}
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
                <h2 className={styles.successTitle}>{MODE_DONE_TITLE[mode]}</h2>
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
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
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
                        fromAddress={fromAddress}
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
                        signerInfo={hwSignerInfo}
                    />
                )}
                {(isWatcherMode || isHwSource) && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                {mode === 'lock' ? (
                    <Input
                        label="Type LOCK to confirm"
                        hint="Locking is permanent. Every flag checked below can never be unlocked."
                        value={typedConfirm}
                        onChange={(e) => setTypedConfirm(e.target.value)}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant={isWatcherMode ? 'primary' : (mode === 'lock' ? 'danger' : 'primary')}
                        loading={stage === 'submitting'}
                        disabled={
                            (mode === 'lock' && !typedConfirmOk) || (
                                isWatcherMode
                                    ? false
                                    : isHwSource
                                        ? hwStatus !== 'available'
                                        : (!signerReady && password.length === 0)
                            )
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : (descriptor ? `Sign on ${descriptor.displayName}` : 'Sign')}
                    </Button>
                </div>
            </form>,
        );
    }

    //  confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // : hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From address"
                walletId={walletId}
                chainId={chainId}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
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

    if (contactsPickerOpen) {
        return (
            <ContactsPickerScreen
                variant={variant}
                contacts={contacts}
                onPick={(entry) => {
                    setTransferTo(entry.address);
                    setContactsPickerOpen(false);
                }}
                onBack={() => setContactsPickerOpen(false)}
            />
        );
    }

    // PC-04: address-list picker for the allow/block-list fields. Only
    // TYPE=2 (address) lists are valid ALLOW_LIST/BLOCK_LIST targets
    // (issue.js isValidList(x, 2)), so filter to them.
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
                    if (listPickerFor === 'allow') {
                        setAllowListIdx(row.actionIndex);
                        setAllowListCount(row.memberCount);
                    } else {
                        setBlockListIdx(row.actionIndex);
                        setBlockListCount(row.memberCount);
                    }
                    setListPickerFor(null);
                }}
                onBack={() => setListPickerFor(null)}
            />
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            {lockedToken && chainId ? (
                <LockedTokenContext chainId={chainId} tick={ticker} />
            ) : (
                <>
                    <NetworkField value={chainId} onChange={setChainId} chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} />
                </>
            )}

            {fromAddress ? (
                <AddressField
                    label="From"
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel="Choose source address"
                />
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

            {mode === 'description' ? (
                <Input
                    label="New description"
                    hint="Up to 250 characters. Stored on-chain and replaces the current one."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    autoComplete="off"
                    maxLength={250}
                />
            ) : null}

            {mode === 'transfer' ? (
                <AddressField
                    label="New owner address"
                    icon="contacts"
                    hint="The address that will receive ownership."
                    value={transferTo}
                    onChange={(e) => setTransferTo(e.target.value)}
                    onIconClick={() => setContactsPickerOpen(true)}
                />
            ) : null}

            {mode === 'lock' ? (
                <>
                    <div role="alert" className={styles.warnings}>
                        <p className={styles.warning}>
                            <strong>Locking is permanent.</strong> Each flag below is a
                            one-way switch: once checked and submitted, it can never be
                            unlocked or reversed.
                        </p>
                    </div>
                    {allLocksSet ? (
                        <p className={styles.hint}>
                            Every lock is already permanently set for {ticker}.
                            There is nothing left to lock.
                        </p>
                    ) : (
                        <div role="group" aria-label="Lock flags">
                            {LOCK_FLAGS.map((f) => {
                                const isLocked = !!tokenLocks[f.key];
                                return (
                                    <div key={f.key} className={styles.lockFlagRow}>
                                        <label className={styles.checkRow}>
                                            <input
                                                type="checkbox"
                                                checked={isLocked || !!lockChecks[f.key]}
                                                disabled={isLocked}
                                                onChange={(e) => setLockChecks((prev) => ({
                                                    ...prev,
                                                    [f.key]: e.target.checked,
                                                }))}
                                            />
                                            <span>{f.label}{isLocked ? ' (already locked)' : ''}</span>
                                        </label>
                                        <p className={styles.lockFlagHint}>{f.hint}</p>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            ) : null}

            {mode === 'mint-settings' ? (
                <>
                    {nothingMintEditable ? (
                        <div role="alert" className={styles.warnings}>
                            <p className={styles.warning}>
                                Every mint setting for {ticker} is permanently locked.
                                There is nothing left to edit here.
                            </p>
                        </div>
                    ) : (
                        <>
                            {mintDeadLocked ? (
                                <div role="alert" className={styles.warnings}>
                                    <p className={styles.warning}>
                                        Minting is permanently locked for {ticker} (LOCK_MINT).
                                        The mint window, max mint per transaction, and per-address
                                        cap below can no longer take effect.
                                    </p>
                                </div>
                            ) : maxMintLocked ? (
                                <div role="alert" className={styles.warnings}>
                                    <p className={styles.warning}>
                                        Max mint per transaction is permanently locked for {ticker} (LOCK_MAX_MINT).
                                    </p>
                                </div>
                            ) : null}
                            {mintSupplyLocked ? (
                                <div role="alert" className={styles.warnings}>
                                    <p className={styles.warning}>
                                        Minting supply now is permanently locked for {ticker} (LOCK_MINT_SUPPLY).
                                    </p>
                                </div>
                            ) : null}
                            {maxSupplyLockedInfo ? (
                                <div role="alert" className={styles.warnings}>
                                    <p className={styles.warning}>
                                        Max supply is also permanently locked for {ticker} (LOCK_MAX_SUPPLY).
                                        That is a separate ISSUE field, not part of Mint settings.
                                    </p>
                                </div>
                            ) : null}
                        </>
                    )}

                    <Input
                        label="Max mint per transaction (optional)"
                        hint="Caps how much can be minted in one transaction. Leave blank for no limit."
                        inputMode="decimal"
                        value={maxMint}
                        onChange={(e) => setMaxMint(e.target.value)}
                        autoComplete="off"
                        disabled={maxMintFieldDisabled}
                    />
                    <Input
                        label="Max mint per address (optional)"
                        hint="The most this address can ever mint in total, across every MINT transaction. Leave blank for no limit."
                        inputMode="decimal"
                        value={mintAddressMax}
                        onChange={(e) => setMintAddressMax(e.target.value)}
                        autoComplete="off"
                        disabled={mintWindowFieldsDisabled}
                    />
                    <Input
                        label="Minting opens at block (optional)"
                        hint={mintStartEstimate
                            ? `Block height when public minting starts. Est. ${mintStartEstimate}.`
                            : 'Block height when public minting starts. Leave blank to open immediately.'}
                        inputMode="decimal"
                        value={mintStartBlock}
                        onChange={(e) => setMintStartBlock(e.target.value)}
                        autoComplete="off"
                        disabled={mintWindowFieldsDisabled}
                    />
                    <Input
                        label="Minting closes at block (optional)"
                        hint={mintStopEstimate
                            ? `Block height when public minting ends. Est. ${mintStopEstimate}.`
                            : 'Block height when public minting ends. Leave blank to keep it open.'}
                        inputMode="decimal"
                        value={mintStopBlock}
                        onChange={(e) => setMintStopBlock(e.target.value)}
                        autoComplete="off"
                        disabled={mintWindowFieldsDisabled}
                    />
                    {currentHeight != null ? (
                        <p className={styles.hint}>
                            Current block on {descriptor?.displayName || chainId}: {currentHeight.toLocaleString('en-US')}.
                            Dates above are rough estimates; real block times vary.
                        </p>
                    ) : null}
                    <Input
                        label="Mint supply now (optional)"
                        hint="Mints this amount immediately, in this same transaction, on top of the settings above."
                        inputMode="decimal"
                        value={mintSupply}
                        onChange={(e) => setMintSupply(e.target.value)}
                        autoComplete="off"
                        disabled={mintNowFieldsDisabled}
                    />
                    <AddressField
                        label="Send that new supply to (optional)"
                        icon="contacts"
                        hint="Only used together with Mint supply now above. Leave blank to keep it in your own address."
                        value={transferSupply}
                        onChange={(e) => setTransferSupply(e.target.value)}
                        onIconClick={() => setContactsPickerOpen(true)}
                        disabled={mintNowFieldsDisabled}
                    />
                </>
            ) : null}

            {mode === 'callback-settings' ? (
                <>
                    <p className={styles.hint}>
                        A callback lets you later recall <strong>all</strong> of {ticker || 'this token'}
                        {' '}back to your address in one action, paying every holder a set amount of
                        another token per unit they held. Configure it here; it can only be edited
                        before any supply is distributed.
                    </p>
                    {callbackLocked ? (
                        <div role="alert" className={styles.warnings}>
                            <p className={styles.warning}>
                                Callback settings are permanently locked for {ticker} (LOCK_CALLBACK).
                                They can no longer be changed.
                            </p>
                        </div>
                    ) : callbackDistributed ? (
                        <div role="alert" className={styles.warnings}>
                            <p className={styles.warning}>
                                {ticker} already has holders
                                {distribution?.holderCount ? ` (${distribution.holderCount.toLocaleString('en-US')})` : ''},
                                so its callback settings are frozen. They can only be set before any
                                supply leaves your address.
                            </p>
                        </div>
                    ) : null}
                    <Input
                        label="Callback token"
                        hint="The ticker holders are paid in when you call back. Must be a token you'll hold enough of to cover every holder."
                        value={callbackTick}
                        onChange={(e) => setCallbackTick(e.target.value.toUpperCase())}
                        autoComplete="off"
                        disabled={callbackFieldsDisabled}
                    />
                    <Input
                        label="Payout per unit"
                        hint="How much of the callback token each holder receives per unit of this token they hold."
                        inputMode="decimal"
                        value={callbackAmount}
                        onChange={(e) => setCallbackAmount(e.target.value)}
                        autoComplete="off"
                        disabled={callbackFieldsDisabled}
                    />
                    <Input
                        label="Callback allowed from block"
                        hint={callbackBlockEstimate
                            ? `The earliest block you can trigger the callback. Est. ${callbackBlockEstimate}.`
                            : 'The earliest block height you can trigger the callback. Must be a future block.'}
                        inputMode="decimal"
                        value={callbackBlock}
                        onChange={(e) => setCallbackBlock(e.target.value)}
                        autoComplete="off"
                        disabled={callbackFieldsDisabled}
                    />
                    {currentHeight != null ? (
                        <p className={styles.hint}>
                            Current block on {descriptor?.displayName || chainId}: {currentHeight.toLocaleString('en-US')}.
                            Date above is a rough estimate; real block times vary.
                        </p>
                    ) : null}
                    <p className={styles.hint}>
                        Values you leave blank keep their current setting. A working callback
                        needs all three fields set.
                    </p>
                </>
            ) : null}

            {mode === 'access-lists' ? (
                <>
                    <p className={styles.hint}>
                        Restrict who can interact with {ticker || 'this token'} by pointing it
                        at address lists you've published. An allow-list permits only its
                        members; a block-list denies its members. Both reference an address
                        list (create one in My Lists first).
                    </p>
                    <div className={styles.detailsList}>
                        <div className={styles.fromLine}>
                            <span className={styles.detailsLabel}>Allow-list</span>
                            <span className={styles.detailsValue}>
                                {allowListIdx
                                    ? `List #${allowListIdx}${allowListCount != null ? ` · ${allowListCount} member${allowListCount === 1 ? '' : 's'}` : ''}`
                                    : 'None (anyone may interact)'}
                            </span>
                        </div>
                        <Button type="button" variant="ghost" onClick={() => setListPickerFor('allow')}>
                            {allowListIdx ? 'Change allow-list' : 'Choose allow-list'}
                        </Button>
                    </div>
                    <div className={styles.detailsList}>
                        <div className={styles.fromLine}>
                            <span className={styles.detailsLabel}>Block-list</span>
                            <span className={styles.detailsValue}>
                                {blockListIdx
                                    ? `List #${blockListIdx}${blockListCount != null ? ` · ${blockListCount} member${blockListCount === 1 ? '' : 's'}` : ''}`
                                    : 'None'}
                            </span>
                        </div>
                        <Button type="button" variant="ghost" onClick={() => setListPickerFor('block')}>
                            {blockListIdx ? 'Change block-list' : 'Choose block-list'}
                        </Button>
                    </div>
                    <p className={styles.hint}>
                        A list can be replaced but not removed: the protocol has no
                        "clear" for a bound list. To lift a restriction, point it at an
                        empty address list. Blank entries keep the current binding.
                    </p>
                </>
            ) : null}

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
            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} />

            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || !ticker
                        || (mode === 'description' && !description)
                        || (mode === 'transfer' && !transferTo)
                        || (mode === 'mint-settings' && (nothingMintEditable || !hasAnyMintField))
                        || (mode === 'callback-settings' && (callbackFieldsDisabled || !hasAnyCallbackField))
                        || (mode === 'access-lists' && !listsChanged)
                        || (mode === 'lock' && (allLocksSet || !hasAnyNewLock))
                        || actionConfirm.composing}
                >
                    {singleEncode ? 'Update token' : 'Preview'}
                </Button>
            </div>
        </form>,
    );
}

/**
 * Compose ISSUE params for each admin mode. Each mode picks the
 * protocol ISSUE version that yields the cleanest decoded summary
 * (see action-decoder.smoke.js cases 2b–2d).
 *
 * - **lock**: ISSUE v3 (PC-02 lock matrix) with one LOCK_* field per
 *   flag the owner newly checked (`form.lockChecks`); a flag already
 *   set on the token is never re-sent. Decoded as "Lock TICK (max
 *   supply, minting…)" listing only the newly-checked flags, since
 *   collectLockFlags reads straight off the params sent.
 * - **description**: ISSUE v1 with only DESCRIPTION set, decoded as
 *   "Update description of TICK…".
 * - **transfer**: ISSUE v0 with only TRANSFER set, decoded as
 *   "Transfer ownership of TICK to ADDR…".
 * - **mint-settings**: ISSUE v2 with whichever of MAX_MINT / MINT_SUPPLY
 *   / TRANSFER_SUPPLY / MINT_ADDRESS_MAX / MINT_START_BLOCK /
 *   MINT_STOP_BLOCK the owner filled in; a blank field is omitted
 *   entirely rather than sent as an empty string, since the indexer
 *   treats an omitted v2 field as "leave unchanged" (issue.js `isNull`
 *   guards on every one of these), never as "clear to zero". Decoded
 *   as "Update mint parameters of TICK…".
 */
function composeAdminParams(mode, form) {
    const TICK = (form.ticker || '').trim().toUpperCase();
    if (mode === 'lock') {
        const p = { VERSION: '3', TICK };
        const checks = form.lockChecks || {};
        for (const f of LOCK_FLAGS) {
            if (checks[f.key]) p[f.field] = '1';
        }
        return p;
    }
    if (mode === 'description') {
        return {
            VERSION: '1',
            TICK,
            DESCRIPTION: (form.description || '').trim(),
        };
    }
    if (mode === 'mint-settings') {
        const p = { VERSION: '2', TICK };
        if (form.maxMint) p.MAX_MINT = String(form.maxMint).trim();
        if (form.mintSupply) p.MINT_SUPPLY = String(form.mintSupply).trim();
        if (form.transferSupply) p.TRANSFER_SUPPLY = form.transferSupply.trim();
        if (form.mintAddressMax) p.MINT_ADDRESS_MAX = String(form.mintAddressMax).trim();
        if (form.mintStartBlock) p.MINT_START_BLOCK = String(form.mintStartBlock).trim();
        if (form.mintStopBlock) p.MINT_STOP_BLOCK = String(form.mintStopBlock).trim();
        return p;
    }
    if (mode === 'callback-settings') {
        // ISSUE v4 (PC-03): only the callback fields the owner filled in.
        // Blank is OMITTED, never sent as empty: the indexer treats an
        // omitted v4 field as "leave unchanged" (issue.js populates it
        // from the current record), never "clear to zero".
        const p = { VERSION: '4', TICK };
        if (form.callbackBlock) p.CALLBACK_BLOCK = String(form.callbackBlock).trim();
        if (form.callbackTick) p.CALLBACK_TICK = String(form.callbackTick).trim().toUpperCase();
        if (form.callbackAmount) p.CALLBACK_AMOUNT = String(form.callbackAmount).trim();
        return p;
    }
    if (mode === 'access-lists') {
        // ISSUE v5 (PC-04): emit only the access list(s) that CHANGED from
        // the token's current binding. An omitted field is "leave
        // unchanged" (issue.js isNull), so re-sending an unchanged index
        // is a harmless no-op we skip to keep the decoded summary clean.
        // There is no null-clear in the protocol (0 fails isValidList), so
        // the picker never produces an empty value here.
        const p = { VERSION: '5', TICK };
        if (form.allowListIdx && form.allowListIdx !== form.currentAllowList) p.ALLOW_LIST = String(form.allowListIdx).trim();
        if (form.blockListIdx && form.blockListIdx !== form.currentBlockList) p.BLOCK_LIST = String(form.blockListIdx).trim();
        return p;
    }
    // mode === 'transfer'
    return {
        VERSION: '0',
        TICK,
        TRANSFER: (form.transferTo || '').trim(),
    };
}

const MODE_LABEL = {
    lock: 'Lock token',
    description: 'Update description',
    transfer: 'Transfer ownership',
    'mint-settings': 'Mint settings',
    'callback-settings': 'Callback settings',
    'access-lists': 'Access lists',
};

const MODE_LABEL_LOWER = {
    lock: 'lock',
    description: 'description update',
    transfer: 'ownership transfer',
    'mint-settings': 'mint settings update',
    'callback-settings': 'callback settings update',
    'access-lists': 'access lists update',
};

const MODE_DONE_TITLE = {
    lock: 'Locked',
    description: 'Description updated',
    transfer: 'Ownership transferred',
    'mint-settings': 'Mint settings updated',
    'callback-settings': 'Callback settings updated',
    'access-lists': 'Access lists updated',
};

// PC-04: current-member count of a LIST detail row (getListByActionIndex).
// The explorer exposes members as `list`; tolerate a couple of aliases.
function listMemberCount(detail) {
    const members = detail?.list ?? detail?.items ?? detail?.members;
    return Array.isArray(members) ? members.length : null;
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}
