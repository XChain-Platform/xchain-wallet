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
import { AddressField, AddressText, Button, ChainBadge, FeeSelector, FormPage, Icon, Input, NetworkField, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useGatedTickNotice, gatedTickWarningCopy } from '../hooks/useGatedTickNotice.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { LockedTokenContext } from '../components/LockedTokenContext.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { AmountField } from '../components/AmountField.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { formatWithThousands, tokenAmountPrecisionError } from '../utils/amountFormat.js';
import {
    perUnitMax,
    dividendPreview,
    addDecimal,
    exceedsBalance,
} from '../utils/dividendPerUnit.js';
import { TokenField } from '../components/TokenField.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';

import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { extractHolderRows } from '../utils/holderRows.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import { tickLookupVerdict } from '../utils/listTickItems.js';
import { isNativeCoinTick, nativeCoinTickMessage, unknownTickMessage } from '../utils/dividendTickChecks.js';
import styles from './IssueTokenForm.module.css';
import { preferredSourceId } from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';
import { MEMO_HINT } from '../utils/memoLimit.js';
import { listMembers } from '../../flows/allowListSelfCheck.js';
import { normalizeProtocolFee } from '../../flows/protocolFeeRow.js';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * Dividend form (§40.8).
 *
 * Pays a dividend of DIVIDEND_TICK to every holder of TICK at the
 * snapshot block (per DIVIDEND.md: the action is processed at the
 * block it confirms in; source address is excluded from receiving).
 *
 * Once the user fills in the "of token" ticker, the form fetches the
 * holder list via `messaging.getHoldersForToken` and renders a cost
 * preview (holder count + total distribution). The cost preview is
 * best-effort; a fetch failure falls back to a plain warning rather
 * than blocking review.
 *
 * Spec §40.8 shows the form reachable from a Token detail page with
 * TICK pre-filled. Until the Token detail page ships, TICK is typed
 * manually; a future step can accept a `tick` prop for pre-fill.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function DividendForm({ walletId, onBack, initialChainId, initialTick, initialFromAddress }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, { id?: string, address?: string }> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || null));
    const lockedToken = !!(initialChainId && initialTick);
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    const [tick, setTick] = useState((initialTick || '').toUpperCase());
    const [dividendTick, setDividendTick] = useState('');
    // PC-26: dividends carry no gated-key handoff; warn when the
    // distributed token has gated content.
    const gatedDividendNotice = useGatedTickNotice({ messaging, chainId, tick: dividendTick });
    const [amount, setAmount] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [dividendPickerOpen, setDividendPickerOpen] = useState(false);

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Holders preview: fetched when the user's TICK input stabilizes,
    // display-only. { loading, rows, error }. Rows per explorer shape:
    // { address, amount, percent }.
    const [holders, setHolders] = useState(
        /** @type {{ loading: boolean, rows: any[] | null, error: string | null }} */
        ({ loading: false, rows: null, error: null }),
    );

    // The active map and the settings read are best-effort: a host without
    // `getActiveAddresses` / `getSettings`, or one whose call fails, still
    // yields a usable form (newest-HD source, first-chain default). Settings
    // ride the same load so the last-used chain is known in the render that
    // first shows the form, never applied a beat later.
    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
            typeof messaging.getSettings === 'function'
                ? Promise.resolve(messaging.getSettings()).catch(() => null)
                : Promise.resolve(null),
        ])
            .then(([byChain, active, settings]) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                setActiveByChain(active || {});
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before paying dividends.',
                    );
                    return;
                }
                // `byChain` is in address-creation order, so opening on its
                // first key opened Pay dividend on the wallet's OLDEST chain
                // forever. Open on the last-used chain instead, behind a
                // caller-seeded one (a token context) and ahead of the
                // first-key fallback, exactly as Send and Swap do.
                if (!lockedToken) {
                    setChainId((prev) => pickDefaultChainId(byChain, {
                        explicitChainId: prev,
                        settings,
                    }));
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!chainId || !addressesByChain || !activeByChain) return;
        const all = addressesByChain[chainId] || [];
        if (initialFromAddress) {
            const match = all.find((a) => a.address === initialFromAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        // The same default as Send and every other spend-from-balance form:
        // the chain's active address, else the newest HD external. The
        // hand-rolled newest-index sort this replaces ignored the active
        // address entirely, so a wallet that had just generated a receive
        // address paid the dividend fee from an empty one. role='dispenser'
        // excluded: a delegated address vends rather than funds, and must
        // never be a default payer.
        const funding = all.filter((a) => a.role !== 'dispenser');
        setFromAddressId(preferredSourceId(funding, activeByChain[chainId]));
    }, [chainId, addressesByChain, activeByChain, initialFromAddress]);

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    // Fetch holders whenever TICK settles. Debounced so fast typing
    // doesn't fire one query per keystroke; the 400ms window is long
    // enough to feel snappy without hammering the explorer.
    useEffect(() => {
        const trimmed = tick.trim().toUpperCase();
        if (!chainId || !trimmed) {
            setHolders({ loading: false, rows: null, error: null });
            return;
        }
        setHolders((prev) => ({ ...prev, loading: true, error: null }));
        let cancelled = false;
        const handle = setTimeout(() => {
            messaging.getHoldersForToken({ chainId, tick: trimmed, all: true })
                .then((resp) => {
                    if (cancelled) return;
                    setHolders({ loading: false, rows: extractRows(resp), error: null });
                })
                .catch((err) => {
                    if (cancelled) return;
                    setHolders({
                        loading: false,
                        rows: null,
                        error: readFailureMessage(err, 'load the holders'),
                    });
                });
        }, 400);
        return () => { cancelled = true; clearTimeout(handle); };
    }, [tick, chainId, messaging]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // Native-coin protocol fee (DIVIDEND is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);

    // DIVIDEND pays holders of an XChain token: the chain's own coin has no
    // such holder set, so typing it (BTC/LTC/DOGE, or a testnet/regtest
    // explorer form like TDOGE) is refused here instead of at the
    // confirm-time dry run. A `^ID` reference never names the coin.
    const trimmedTick = tick.trim().toUpperCase();
    const tickIsNativeCoin = useMemo(
        () => !trimmedTick.startsWith('^') && isNativeCoinTick(trimmedTick, { coinTicker, descriptor }),
        [trimmedTick, coinTicker, descriptor],
    );

    // TICK / DIVIDEND_TICK existence: the indexer refuses the whole action
    // when either names no XChain token on this chain (validateDividend:
    // "TICK (unknown)" / "DIVIDEND_TICK (unknown)"). Checked the same way
    // ListCreateForm checks a token-list member - debounced, `^ID`
    // references left unchecked (the indexer resolves those, not a name
    // lookup) - so the form says which ticker is wrong before the dry run's
    // one generic sentence. `verdict` stays null on a network failure so an
    // explorer hiccup shows the same non-blocking style as the holders
    // count above, rather than refusing every dividend.
    const [tickCheck, setTickCheck] = useState(
        /** @type {{ verdict: 'found' | 'missing' | null, error: string | null }} */
        ({ verdict: null, error: null }),
    );
    const [dividendTickCheck, setDividendTickCheck] = useState(
        /** @type {{ verdict: 'found' | 'missing' | null, error: string | null }} */
        ({ verdict: null, error: null }),
    );

    useEffect(() => {
        setTickCheck({ verdict: null, error: null });
        // A locked TICK arrived from a real token context (Token Detail's
        // pre-fill), never hand-typed, so the existence check - built for
        // the manual-entry field this component also renders - stays off;
        // the field it would annotate isn't even on screen in this mode.
        if (lockedToken) return undefined;
        if (!chainId || !trimmedTick || trimmedTick.startsWith('^') || tickIsNativeCoin) return undefined;
        if (typeof messaging?.getTokenInfo !== 'function') return undefined;
        let cancelled = false;
        const handle = setTimeout(() => {
            messaging.getTokenInfo({ chainId, tick: trimmedTick })
                .then((info) => {
                    if (cancelled) return;
                    setTickCheck({ verdict: tickLookupVerdict(info), error: null });
                })
                .catch((err) => {
                    if (cancelled) return;
                    setTickCheck({ verdict: null, error: err?.message || 'Failed to verify this token.' });
                });
        }, 400);
        return () => { cancelled = true; clearTimeout(handle); };
    }, [trimmedTick, chainId, messaging, tickIsNativeCoin, lockedToken]);

    const trimmedDividendTick = dividendTick.trim().toUpperCase();
    useEffect(() => {
        setDividendTickCheck({ verdict: null, error: null });
        if (!chainId || !trimmedDividendTick || trimmedDividendTick.startsWith('^')) return undefined;
        if (typeof messaging?.getTokenInfo !== 'function') return undefined;
        let cancelled = false;
        const handle = setTimeout(() => {
            messaging.getTokenInfo({ chainId, tick: trimmedDividendTick })
                .then((info) => {
                    if (cancelled) return;
                    setDividendTickCheck({ verdict: tickLookupVerdict(info), error: null });
                })
                .catch((err) => {
                    if (cancelled) return;
                    setDividendTickCheck({ verdict: null, error: err?.message || 'Failed to verify this token.' });
                });
        }, 400);
        return () => { cancelled = true; clearTimeout(handle); };
    }, [trimmedDividendTick, chainId, messaging]);

    const tickFieldError = tickIsNativeCoin
        ? nativeCoinTickMessage(coinTicker, descriptor?.displayName || '')
        : tickCheck.verdict === 'missing'
            ? unknownTickMessage(trimmedTick, descriptor?.displayName || chainId)
            : tickCheck.error
                ? `Couldn't verify this token: ${tickCheck.error}`
                : undefined;
    const dividendTickFieldError = dividendTickCheck.verdict === 'missing'
        ? unknownTickMessage(trimmedDividendTick, descriptor?.displayName || chainId)
        : dividendTickCheck.error
            ? `Couldn't verify this token: ${dividendTickCheck.error}`
            : undefined;

    // Source balance of the dividend ticker, backing the per-unit
    // AmountField's "available" footer. It is NOT the Max: see
    // `maxPerUnit` below.
    const dividendBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: fromAddress?.address,
        tick: dividendTick,
    });

    // Divisibility of the DIVIDEND token, so the per-unit Max floors to a
    // rate the token can actually express (an indivisible dividend cannot
    // be paid at 9.998 per unit).
    const dividendInfo = useTokenInfo({
        chainId,
        tick: dividendTick.trim().toUpperCase(),
        skip: !dividendTick.trim(),
    });

    // DIVIDEND applies the payment token's allow/block lists before it counts
    // recipients or charges its per-recipient fee. Read the currently resolved
    // members so the authoring preview applies the same gates.
    const [accessLists, setAccessLists] = useState(
        /** @type {{ allow: string[] | null, block: string[] | null }} */
        ({ allow: [], block: [] }),
    );
    useEffect(() => {
        const allowIndex = dividendInfo?.allowList;
        const blockIndex = dividendInfo?.blockList;
        setAccessLists({ allow: allowIndex ? null : [], block: blockIndex ? null : [] });
        if ((!allowIndex && !blockIndex) || typeof messaging.getListByActionIndex !== 'function') {
            return undefined;
        }
        let cancelled = false;
        const read = (actionIndex) => (actionIndex
            ? messaging.getListByActionIndex({ chainId, actionIndex }).then(listMembers).catch(() => null)
            : Promise.resolve([]));
        Promise.all([read(allowIndex), read(blockIndex)]).then(([allow, block]) => {
            if (!cancelled) setAccessLists({ allow, block });
        });
        return () => { cancelled = true; };
    }, [chainId, dividendInfo?.allowList, dividendInfo?.blockList, messaging]);

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

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = {
            VERSION: '0',
            TICK: tick.trim().toUpperCase(),
            DIVIDEND_TICK: dividendTick.trim().toUpperCase(),
            AMOUNT: String(amount).trim(),
        };
        if (memo.trim()) p.MEMO = memo.trim();
        return p;
    }, [tick, dividendTick, amount, memo]);

    // The venue's forced-rollback quote prices these exact wire fields and
    // applies the current holder set, rounding and access lists. It is display
    // only here; compose and submit continue to receive actionParams unchanged.
    const [protocolFeeQuote, setProtocolFeeQuote] = useState(/** @type {any} */ (null));
    useEffect(() => {
        setProtocolFeeQuote(null);
        if (!chainId || !fromAddress?.address || !actionParams.TICK
            || !actionParams.DIVIDEND_TICK || !(Number(actionParams.AMOUNT) > 0)
            || typeof messaging.requoteNativeFee !== 'function') return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            messaging.requoteNativeFee({
                chainId,
                source: fromAddress.address,
                actionString: dividendActionString(actionParams),
            })
                .then((quote) => { if (!cancelled) setProtocolFeeQuote(quote || null); })
                .catch(() => { /* the confirm preflight remains authoritative */ });
        }, 400);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [chainId, fromAddress?.address, actionParams, messaging]);

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'DIVIDEND',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, actionParams, chainId]);

    // Holder-count preview excludes the source address per DIVIDEND.md
    // ("SOURCE address is excluded from receiving dividends"). When
    // `holders.rows` is null (unfetched / error), the preview just
    // shows the error / loading state.
    const preview = useMemo(() => {
        if (!holders.rows) return null;
        if (!Array.isArray(accessLists.allow) || !Array.isArray(accessLists.block)) return null;
        return dividendPreview({
            rows: holders.rows,
            sourceAddress: fromAddress?.address,
            amount: String(amount).trim(),
            divisibility: dividendInfo?.divisibility ?? 8,
            allowMembers: accessLists.allow,
            blockMembers: accessLists.block,
        });
    }, [holders.rows, fromAddress, amount, dividendInfo?.divisibility, accessLists]);
    const maxPreview = useMemo(() => {
        if (!holders.rows) return null;
        if (!Array.isArray(accessLists.allow) || !Array.isArray(accessLists.block)) return null;
        return dividendPreview({
            rows: holders.rows,
            sourceAddress: fromAddress?.address,
            amount: '',
            divisibility: dividendInfo?.divisibility ?? 8,
            allowMembers: accessLists.allow,
            blockMembers: accessLists.block,
        });
    }, [holders.rows, fromAddress, dividendInfo?.divisibility, accessLists]);

    const protocolFee = normalizeProtocolFee(protocolFeeQuote).amount;
    const protocolFeeTick = 'XCHAIN';
    const feeSharesPayoutBalance = !nativeFee.payFeeInNativeCoin
        && trimmedDividendTick === protocolFeeTick;
    const totalTokenCost = preview?.total != null
        ? addDecimal(preview.total, feeSharesPayoutBalance ? (protocolFee || '0') : '0')
        : null;
    const xchainBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: fromAddress?.address,
        tick: protocolFeeTick,
    });

    // Quote the fee at the unreserved ceiling. If that rate wakes up holders
    // whose smaller payout rounds to zero, the quote includes them and the
    // final ceiling reserves their fees as well.
    const unreservedMax = perUnitMax({
        balance: dividendBalance,
        eligibleUnits: maxPreview?.eligibleUnits,
        divisibility: dividendInfo?.divisibility ?? null,
    });
    const [maxFeeQuote, setMaxFeeQuote] = useState(/** @type {any} */ (null));
    useEffect(() => {
        setMaxFeeQuote(null);
        if (!feeSharesPayoutBalance || !unreservedMax || !chainId || !fromAddress?.address
            || !actionParams.TICK || !actionParams.DIVIDEND_TICK
            || typeof messaging.requoteNativeFee !== 'function') return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            messaging.requoteNativeFee({
                chainId,
                source: fromAddress.address,
                actionString: dividendActionString({ ...actionParams, AMOUNT: unreservedMax }),
            })
                .then((quote) => { if (!cancelled) setMaxFeeQuote(quote || null); })
                .catch(() => { /* an unknown fee leaves Max unavailable */ });
        }, 400);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [feeSharesPayoutBalance, unreservedMax, chainId, fromAddress?.address, actionParams, messaging]);

    // (E2E D-86): AMOUNT is a RATE - dividend tokens per one unit
    // of the holder-of token - so the whole balance is the wrong
    // dimension for it. Max used to fill the balance, and the form's own
    // summary then quoted a distribution 500x what the address held, with
    // submit still live. The payable ceiling is balance / eligible units,
    // and the eligible set is already resolved one line above for the
    // preview. Same family as D-23 (contract Withdraw sized off the
    // wallet) and (Mint sized off holdings, not headroom).
    const maxFee = normalizeProtocolFee(maxFeeQuote);
    const payoutBalanceAfterFee = feeSharesPayoutBalance
        ? (maxFee.known
            ? addDecimal(dividendBalance, `-${maxFee.amount || '0'}`)
            : null)
        : dividendBalance;
    const maxPerUnit = useMemo(
        () => perUnitMax({
            balance: payoutBalanceAfterFee,
            eligibleUnits: maxPreview?.eligibleUnits,
            divisibility: dividendInfo?.divisibility ?? null,
        }),
        [payoutBalanceAfterFee, maxPreview?.eligibleUnits, dividendInfo],
    );
    const maxPayable = maxPerUnit !== null && Number(maxPerUnit) > 0;
    const payoutShort = totalTokenCost != null
        && exceedsBalance(totalTokenCost, dividendBalance);
    const feeShort = !nativeFee.payFeeInNativeCoin && !feeSharesPayoutBalance
        && protocolFee != null && exceedsBalance(protocolFee, xchainBalance);
    const balanceError = payoutShort
        ? insufficientDividendBalanceMessage({
            balance: dividendBalance,
            payout: preview?.total,
            fee: feeSharesPayoutBalance ? protocolFee : null,
            tick: trimmedDividendTick,
            maxPerUnit,
        })
        : feeShort
            ? `The protocol fee is ${formatWithThousands(protocolFee)} XCHAIN, but this address holds ${formatWithThousands(xchainBalance)} XCHAIN.`
            : null;
    const nativeProtocolFee = protocolFeeQuote?.requiredFeeNative != null
        ? String(protocolFeeQuote.requiredFeeNative) : null;
    const protocolFeeText = nativeFee.payFeeInNativeCoin
        ? (nativeProtocolFee ? `${formatWithThousands(nativeProtocolFee)} ${coinTicker}` : null)
        : (protocolFee ? `${formatWithThousands(protocolFee)} XCHAIN` : null);
    const totalCostText = preview?.total != null && trimmedDividendTick
        ? feeSharesPayoutBalance && protocolFee
            ? `~${formatWithThousands(totalTokenCost)} ${trimmedDividendTick}`
            : protocolFeeText
                ? `~${formatWithThousands(preview.total)} ${trimmedDividendTick} + ${protocolFeeText} protocol fee`
                : `~${formatWithThousands(preview.total)} ${trimmedDividendTick}`
        : null;

    function handleReview(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!tick.trim()) {
            setFormError('Holder-of token is required.');
            return;
        }
        const tickError = tickerReferenceError(tick, { noun: 'Holder-of ticker', allowRef: true });
        if (tickError) {
            setFormError(tickError);
            return;
        }
        if (tickIsNativeCoin) {
            setFormError(nativeCoinTickMessage(coinTicker, descriptor?.displayName || ''));
            return;
        }
        if (tickCheck.verdict === 'missing') {
            setFormError(unknownTickMessage(trimmedTick, descriptor?.displayName || chainId));
            return;
        }
        if (!dividendTick.trim()) {
            setFormError('Dividend ticker is required.');
            return;
        }
        const dividendTickError = tickerReferenceError(dividendTick, { noun: 'Dividend ticker', allowRef: true });
        if (dividendTickError) {
            setFormError(dividendTickError);
            return;
        }
        if (dividendTickCheck.verdict === 'missing') {
            setFormError(unknownTickMessage(trimmedDividendTick, descriptor?.displayName || chainId));
            return;
        }
        const amt = String(amount).trim();
        if (!amt || Number(amt) <= 0) {
            setFormError('Per-unit amount must be a positive number.');
            return;
        }
        // Keep each payout within the dividend token's on-chain decimal scale.
        const precisionError = tokenAmountPrecisionError(amt, {
            divisibility: dividendInfo?.divisibility,
            tick: dividendTick,
            noun: 'Per-unit amount',
        });
        if (precisionError) {
            setFormError(precisionError);
            return;
        }
        // Stop a payout the balance cannot cover here, not three
        // screens later behind a "sign anyway" tick. Only fires when both
        // the projected total and the balance are known, so an explorer
        // hiccup leaves the form ungated.
        if (balanceError) {
            setFormError(balanceError);
            return;
        }
        if (memo && /[|;]/.test(memo)) {
            setFormError('Memo cannot contain | or ; characters.');
            return;
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

    const { isWatcherMode } = useWalletMode();

    // (§5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page, hardware
    // included. Watcher mode still branches: it encodes, it
    // never signs.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // Hardware signs the SAME prebuilt PSBT through the same host
    // flow, with the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'dividendAction',
        hardware: 'dividendActionHw',
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
                actionData: { action: 'DIVIDEND', params: actionParams },
                // PC-51: the opt-in must reach COMPOSE so the FEE_DESTINATION
                // output sits inside the PSBT the user approves.
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
            setFormError(nativeFeeAwareMessage(err) || 'Dividend failed.');
        }
    }

    // A native-fee refusal arrives as NativeFeeForfeitError, whose own message is wire
    // wording ("native-coin fee pre-flight failed (dust): ..."). nativeFeeErrorMessage turns
    // it into the sentence that says what to do about it, and knows the advice differs off
    // Bitcoin, where there is no XCHAIN lane to fall back to.
    function nativeFeeAwareMessage(err) {
        return submitFailureMessage(err, {
            chainId,
            coinTicker,
            mandatory: nativeFee.mandatory,
            fallback: err?.message,
        });
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
                    actionData: { action: 'DIVIDEND', params: actionParams },
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (isHwSource) {
                res = await messaging.dividendActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.dividendAction({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker: coinTicker,
                        mandatory: nativeFee.mandatory,
                        fallback: err?.message || 'Dividend failed.',
                    }),
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
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setStage('form'); }
                : onBack}
            backDisabled={stage === 'submitting'}
            title={stage === 'review' || stage === 'submitting'
                    ? 'Review dividend'
                    : `Pay dividend`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
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
        // This is the form the campaign proved it on. A queued result
        // means signed and NOT broadcast; "Dividend sent" told a user whose
        // node was briefly unreachable that their holders had been paid.
        if (result?.queued) {
            return wrap(
                <QueuedResultPanel onDone={onBack} what="dividend" unsaved={result.unsaved} />,
            );
        }
        return wrap(
            <>
                <h2 className={styles.successTitle}>Dividend sent</h2>
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
            <FormPage
                label="Review dividend"
                onSubmit={handleSubmit}
                status={(isWatcherMode || isHwSource) && submitError ? (
                    <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={
                            isWatcherMode
                                ? false
                                : isHwSource
                                    ? hwStatus !== 'available'
                                    : (!signerReady && password.length === 0)
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction: pay dividend'
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}: pay dividend`
                                : `Sign${descriptor ? ` on ${descriptor.displayName}` : ''}: pay dividend`}
                    </Button>
                )}
            >
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
                    {preview ? (
                        <>
                            <dt className={styles.detailsLabel}>Eligible holders</dt>
                            <dd className={styles.detailsValue}>
                                {preview.eligibleCount}
                                {preview.sourceExcluded ? ' (source excluded)' : ''}
                            </dd>
                            {preview.total !== null ? (
                                <>
                                    <dt className={styles.detailsLabel}>Total distribution</dt>
                                    <dd className={styles.detailsValue}>
                                        ~{formatWithThousands(preview.total)} {dividendTick.trim().toUpperCase()}
                                    </dd>
                                </>
                            ) : null}
                        </>
                    ) : null}
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
                <p className={styles.hint} data-testid="dividend-review-fee-hint">
                    Paying a dividend has a protocol fee that grows with the number
                    of holders paid, charged separately from the payout. Make sure
                    this address holds enough {dividendTick.trim().toUpperCase() || 'of the token you are paying out'}
                    {' '}to cover the full payout.
                </p>
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
            </FormPage>,
        );
    }

    // confirm page, rendered in place of the form (the overlay modal
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
                // Hardware swaps the password field for the device block
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
                purpose="receive"
                walletId={walletId}
                title="Select token"
                networkFilter={coinFromChainId(chainId)}
                onSelect={(sel) => {
                    setTick(String(sel.tick || '').toUpperCase());
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    if (dividendPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Select dividend token"
                networkFilter={coinFromChainId(chainId)}
                onSelect={(sel) => {
                    setDividendTick(String(sel.tick || '').toUpperCase());
                    setDividendPickerOpen(false);
                }}
                onBack={() => setDividendPickerOpen(false)}
            />
        );
    }

    return wrap(
        <FormPage
            label="Pay dividend"
            onSubmit={handleReview}
            status={(formError || balanceError) ? (
                <StatusMessage variant="error" className={styles.error}>{formError || balanceError}</StatusMessage>
            ) : null}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || !tick || !dividendTick || !amount || actionConfirm.composing
                        || tickIsNativeCoin || tickCheck.verdict === 'missing'
                        || dividendTickCheck.verdict === 'missing'}
                >
                    {singleEncode ? 'Pay dividend' : 'Preview'}
                </Button>
            )}
        >
            {lockedToken && chainId ? (
                <LockedTokenContext chainId={chainId} tick={tick} label="Holder-of token" />
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
                <StatusMessage variant="error" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </StatusMessage>
            )}

            {lockedToken ? null : (
                <TokenField
                    label="Holder-of token"
                    value={tick && chainId ? { chainId, tick } : null}
                    onOpenPicker={() => setTokenPickerOpen(true)}
                    error={tickFieldError}
                />
            )}
            <TokenField
                label="Dividend token"
                value={dividendTick && chainId ? { chainId, tick: dividendTick } : null}
                onOpenPicker={() => setDividendPickerOpen(true)}
                error={dividendTickFieldError}
            />
            <AmountField
                label="Per-unit amount"
                hint="Amount of dividend ticker per 1 unit of holder-of token."
                amount={amount}
                tick={dividendTick}
                onAmountFieldChange={(rawValue) => {
                    const stripped = String(rawValue).replace(/,/g, '');
                    if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                    setAmount(stripped);
                }}
                onMax={maxPayable ? () => setAmount(maxPerUnit) : undefined}
                maxDisabled={!maxPayable}
                balanceText={dividendBalance != null && dividendTick.trim()
                    ? `${formatWithThousands(dividendBalance)} ${dividendTick.trim().toUpperCase()} available${
                        maxPayable ? ` · up to ${formatWithThousands(maxPerUnit)} per unit` : ''}`
                    : null}
            />
            <Input
                label="Memo (optional)"
                hint={MEMO_HINT}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
            />
            {gatedDividendNotice.gated ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        {gatedTickWarningCopy(dividendTick, 'dividend recipients')}
                    </p>
                </div>
            ) : null}

            {tick.trim() ? (
                <p className={styles.hint}>
                    {holders.loading ? 'Counting holders…'
                        : holders.error ? holders.error
                            : holders.rows ? `${preview?.eligibleCount ?? 0} eligible holder${(preview?.eligibleCount ?? 0) === 1 ? '' : 's'}`
                                : ''}
                    {preview?.total
                        ? ` · total distribution ~${formatWithThousands(preview.total)} ${dividendTick.trim().toUpperCase() || 'tokens'}`
                        : ''}
                </p>
            ) : null}

            {totalCostText ? (
                <p className={styles.hint} data-testid="dividend-cost-preview">
                    Total token cost {totalCostText}
                    {feeSharesPayoutBalance && protocolFeeText
                        ? ` · includes ${protocolFeeText} protocol fee` : ''}
                </p>
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
            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} fee={protocolFeeQuote} />

        </FormPage>,
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

// The explorer's holder envelope is normalized in one place now
// (utils/holderRows.js), after ManageToken shipped without an equivalent
// and reported zero holders for every token - D-76.
const extractRows = extractHolderRows;

function dividendActionString(params) {
    const parts = [
        'DIVIDEND',
        String(params.VERSION ?? ''),
        String(params.TICK ?? ''),
        String(params.DIVIDEND_TICK ?? ''),
        String(params.AMOUNT ?? ''),
        String(params.MEMO ?? ''),
    ];
    while (parts.length > 2 && parts[parts.length - 1] === '') parts.pop();
    return parts.join('|');
}

function insufficientDividendBalanceMessage({ balance, payout, fee, tick, maxPerUnit }) {
    const ceiling = maxPerUnit && Number(maxPerUnit) > 0
        ? ` Up to ${formatWithThousands(maxPerUnit)} per unit is payable.` : '';
    if (fee) {
        const total = addDecimal(payout, fee);
        return `Total token cost is ~${formatWithThousands(total)} ${tick}: `
            + `${formatWithThousands(payout)} payout + ${formatWithThousands(fee)} protocol fee, `
            + `but this address holds ${formatWithThousands(balance)} ${tick}.${ceiling}`;
    }
    return `This pays ~${formatWithThousands(payout)} ${tick} in total, more than the `
        + `${formatWithThousands(balance)} ${tick} this address holds.${ceiling}`;
}
