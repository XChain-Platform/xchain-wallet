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
import { formatWithThousands } from '../utils/amountFormat.js';
import {
    perUnitMax,
    sumHolderUnits,
    multiplyDecimal,
    exceedsBalance,
} from '../utils/dividendPerUnit.js';
import { TokenField } from '../components/TokenField.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { nativeFeeErrorMessage } from '../../sdk/nativeFeePreflight.js';
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
import styles from './IssueTokenForm.module.css';
import { externalIndexOf } from '../addressSelection.js';

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

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before paying dividends.',
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
            messaging.getHoldersForToken({ chainId, tick: trimmed })
                .then((resp) => {
                    if (cancelled) return;
                    setHolders({ loading: false, rows: extractRows(resp), error: null });
                })
                .catch((err) => {
                    if (cancelled) return;
                    setHolders({
                        loading: false,
                        rows: null,
                        error: err?.message || 'Failed to load holders.',
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

    // PC-51: native-coin protocol fee (DIVIDEND is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);

    // Source balance of the dividend ticker, backing the per-unit
    // AmountField's "available" footer. It is NOT the Max: see
    // `maxPerUnit` below .
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
        const sourceAddr = fromAddress?.address;
        const eligible = sourceAddr
            ? holders.rows.filter((r) => r.address !== sourceAddr)
            : holders.rows;
        // : the divisor is exact decimal math, not a float sum. It
        // prices the preview AND bounds the Max button, so an ulp of
        // drift here is the difference between a payable rate and one the
        // chain rejects for insufficient funds.
        const eligibleUnits = sumHolderUnits(eligible);
        const amt = String(amount).trim();
        const total = (eligibleUnits && Number(eligibleUnits) > 0 && Number(amt) > 0)
            ? multiplyDecimal(amt, eligibleUnits)
            : null;
        return {
            eligibleCount: eligible.length,
            eligibleUnits,
            sourceExcluded: Boolean(sourceAddr && holders.rows.some((r) => r.address === sourceAddr)),
            total,
        };
    }, [holders.rows, fromAddress, amount]);

    //  (E2E D-86): AMOUNT is a RATE - dividend tokens per one unit
    // of the holder-of token - so the whole balance is the wrong
    // dimension for it. Max used to fill the balance, and the form's own
    // summary then quoted a distribution 500x what the address held, with
    // submit still live. The payable ceiling is balance / eligible units,
    // and the eligible set is already resolved one line above for the
    // preview. Same family as D-23 (contract Withdraw sized off the
    // wallet) and  (Mint sized off holdings, not headroom).
    const maxPerUnit = useMemo(
        () => perUnitMax({
            balance: dividendBalance,
            eligibleUnits: preview?.eligibleUnits,
            divisibility: dividendInfo?.divisibility ?? null,
        }),
        [dividendBalance, preview?.eligibleUnits, dividendInfo],
    );
    const maxPayable = maxPerUnit !== null && Number(maxPerUnit) > 0;

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
        if (!/^[A-Za-z0-9.^]+$/.test(tick.trim())) {
            setFormError('Holder-of ticker accepts A–Z, 0–9, period, or ^TICK_ID.');
            return;
        }
        if (!dividendTick.trim()) {
            setFormError('Dividend ticker is required.');
            return;
        }
        if (!/^[A-Za-z0-9.^]+$/.test(dividendTick.trim())) {
            setFormError('Dividend ticker accepts A–Z, 0–9, period, or ^TICK_ID.');
            return;
        }
        const amt = String(amount).trim();
        if (!amt || Number(amt) <= 0) {
            setFormError('Per-unit amount must be a positive number.');
            return;
        }
        // : stop a payout the balance cannot cover here, not three
        // screens later behind a "sign anyway" tick. Only fires when both
        // the projected total and the balance are known, so an explorer
        // hiccup leaves the form ungated.
        if (preview?.total && exceedsBalance(preview.total, dividendBalance)) {
            const DTICK = dividendTick.trim().toUpperCase();
            setFormError(
                `This pays ~${formatWithThousands(preview.total)} ${DTICK} in total, more than the `
                + `${formatWithThousands(dividendBalance)} ${DTICK} this address holds.`
                + (maxPayable ? ` Up to ${formatWithThousands(maxPerUnit)} per unit is payable.` : ''),
            );
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
    // Bitcoin, where there is no XCHAIN lane to fall back to .
    function nativeFeeAwareMessage(err) {
        if (err?.name === 'NativeFeeForfeitError') {
            return nativeFeeErrorMessage(err, { coinTicker, mandatory: nativeFee.mandatory });
        }
        return err?.message;
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
                    : err?.message || 'Dividend failed.',
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
                    ? 'Review dividend'
                    : `Pay dividend`}
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
                <p className={styles.hint}>
                    DIVIDEND charges an XChain fee based on the number of database
                    hits (§DIVIDEND.md). Make sure the source address holds enough
                    DIVIDEND ticker to cover the full payout.
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
                {(isWatcherMode || isHwSource) && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <div className={styles.actions}>
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
        <form onSubmit={handleReview} noValidate>
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
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}

            {lockedToken ? null : (
                <TokenField
                    label="Holder-of token"
                    value={tick && chainId ? { chainId, tick } : null}
                    onOpenPicker={() => setTokenPickerOpen(true)}
                />
            )}
            <TokenField
                label="Dividend token"
                value={dividendTick && chainId ? { chainId, tick: dividendTick } : null}
                onOpenPicker={() => setDividendPickerOpen(true)}
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
                hint="Protocol rejects | or ;."
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
                        : holders.error ? `Couldn't load holders: ${holders.error}`
                            : holders.rows ? `${preview?.eligibleCount ?? 0} eligible holder${(preview?.eligibleCount ?? 0) === 1 ? '' : 's'}`
                                : ''}
                    {preview?.total
                        ? ` · total distribution ~${formatWithThousands(preview.total)} ${dividendTick.trim().toUpperCase() || 'tokens'}`
                        : ''}
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
                    disabled={!fromAddress || !tick || !dividendTick || !amount || actionConfirm.composing}
                >
                    {singleEncode ? 'Pay dividend' : 'Preview'}
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

// The explorer's holder envelope is normalized in one place now
// (utils/holderRows.js), after ManageToken shipped without an equivalent
// and reported zero holders for every token - D-76.
const extractRows = extractHolderRows;
