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
    FormPage,
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
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useFormDraft } from '../hooks/useFormDraft.js';
import { useSettings } from '../hooks/useSettings.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ContactsPickerScreen } from '../components/ContactsPickerScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { TICKER_HINT, tickerGrammarError } from '../utils/tickerGrammar.js';
import { isValidAddressForChain } from '../utils/addressValidation.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useFeeFiat } from '../hooks/useFeeFiat.js';
import { useFormLeaveGuard } from '../hooks/useFormLeaveGuard.js';
import { preferredSourceId } from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';
import {
    compareDecimalStrings,
    subtractDecimalStrings,
} from '../utils/amountFormat.js';
import { t } from '../../i18n/index.js';

const PROTOCOL_COIN_TICKER = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };

function isPositiveDecimal(value) {
    const text = String(value || '').trim();
    return /^\d+(?:\.\d+)?$/.test(text) && compareDecimalStrings(text, '0') === 1;
}

function isNonNegativeDecimal(value) {
    const text = String(value || '').trim();
    return /^\d+(?:\.\d+)?$/.test(text) && compareDecimalStrings(text, '0') !== -1;
}

function isValidIssueAddress(value, descriptor) {
    return !!descriptor?.coin && !!descriptor?.networkKind
        && isValidAddressForChain(String(value).trim(), descriptor.coin, descriptor.networkKind);
}

const chainRegistry = registryLib.defaultRegistry();

/**
 * Standalone ISSUE form (§40.2).
 *
 * The Token Creation Wizard (§40.1) is the primary authoring surface.
 * This form is the escape hatch for users who want to compose ISSUE
 * without the template picker: every ISSUE v0 field the Custom
 * template exposes, on a single screen. Two stages: form -> review+sign,
 * mirroring Send.jsx.
 *
 * Backed by the same `messaging.issueToken` helper the wizard uses.
 * No new flow, no new background handler. The review step runs the
 * draft through `decoder.decodeAction` so the plain-English summary
 * matches the sign screen shown for dApp-initiated ISSUE requests.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function IssueTokenForm({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const { settings } = useSettings();
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    // getActiveAddresses()[chainId], loaded in the same batch as the
    // address list so the source default resolves once, not fallback-then-swap.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, any> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    const [ticker, setTicker] = useState('');
    const [supply, setSupply] = useState('');
    // Blank means "mint the whole supply now". Kept as its own
    // string so an explicit 0 stays distinguishable from an untouched field.
    const [initialMint, setInitialMint] = useState('');
    // Optional per-transaction MINT cap (ISSUE v0 MAX_MINT). Blank omits the
    // field entirely, which xchain-indexer stores as 0 and treats as "no
    // per-tx cap" (xchain-indexer src/actions/mint.js) - matching the Mint
    // settings panel (TokenAdminForm.jsx mode='mint-settings') left blank.
    const [maxMint, setMaxMint] = useState('');
    const [divisible, setDivisible] = useState(false);
    const [description, setDescription] = useState('');
    const [lockSupply, setLockSupply] = useState(false);
    // ISSUE v0 carries two separate destinations, and a form that offers only
    // the first reads as if it moved both: TRANSFER hands away the token's
    // issuer rights, TRANSFER_SUPPLY says where the initial mint lands. The
    // indexer credits MINT_SUPPLY to the issuing address and moves it only when
    // TRANSFER_SUPPLY is set (xchain-indexer src/actions/issue/settle.js), so a
    // tester who filled "Transfer ownership to" on testnet handed the operator
    // control of the token and kept every minted unit, then reported it as a
    // bug. Both fields live here so the form says what the chain will do.
    const [transferTo, setTransferTo] = useState('');
    const [transferSupplyTo, setTransferSupplyTo] = useState('');
    const { payFeeInNativeCoin, setPayFeeInNativeCoin, mandatory: nativeFeeMandatory } =
        useNativeFee(chainId);
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [contactsPickerOpen, setContactsPickerOpen] = useState(false);
    // Which address field the one contacts picker is filling.
    const [contactsTarget, setContactsTarget] = useState(/** @type {'owner' | 'supply'} */ ('owner'));
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const formDraftTtlMs = Number.isFinite(settings?.privacy?.formDraftTtlMs)
        ? Number(settings.privacy.formDraftTtlMs)
        : undefined;
    const draft = useFormDraft({ view: 'issue-token', walletId, ttlMs: formDraftTtlMs });
    // A stored draft waits for an explicit Restore. A fresh form starts
    // saving immediately so an auto-lock unmount cannot erase typed values.
    const [draftPending, setDraftPending] = useState(() => !draft.hasDraft());
    useEffect(() => {
        if (stage !== 'form' || !draftPending) return;
        draft.save({
            chainId, fromAddressId, ticker, supply, initialMint, maxMint, divisible,
            description, lockSupply, transferTo, transferSupplyTo, payFeeInNativeCoin,
        });
    }, [
        stage, draftPending, draft,
        chainId, fromAddressId, ticker, supply, initialMint, maxMint, divisible,
        description, lockSupply, transferTo, transferSupplyTo, payFeeInNativeCoin,
    ]);
    const restoreDraft = useCallback(() => {
        const v = draft.load();
        if (!v) { setDraftPending(false); return; }
        if (typeof v.chainId === 'string') setChainId(v.chainId);
        if (typeof v.fromAddressId === 'string') setFromAddressId(v.fromAddressId);
        if (typeof v.ticker === 'string') setTicker(v.ticker);
        if (typeof v.supply === 'string') setSupply(v.supply);
        if (typeof v.initialMint === 'string') setInitialMint(v.initialMint);
        if (typeof v.maxMint === 'string') setMaxMint(v.maxMint);
        if (typeof v.divisible === 'boolean') setDivisible(v.divisible);
        if (typeof v.description === 'string') setDescription(v.description);
        if (typeof v.lockSupply === 'boolean') setLockSupply(v.lockSupply);
        if (typeof v.transferTo === 'string') setTransferTo(v.transferTo);
        if (typeof v.transferSupplyTo === 'string') setTransferSupplyTo(v.transferSupplyTo);
        if (typeof v.payFeeInNativeCoin === 'boolean') setPayFeeInNativeCoin(v.payFeeInNativeCoin);
        setDraftPending(true);
    }, [draft]);
    const dismissDraft = useCallback(() => {
        draft.clear();
        setDraftPending(true);
    }, [draft]);
    const hasRealInput = useMemo(() => (
        [ticker, supply, initialMint, maxMint, description, transferTo, transferSupplyTo, password]
            .some((value) => String(value || '').trim().length > 0)
        || divisible
        || lockSupply
    ), [ticker, supply, initialMint, maxMint, description, transferTo, transferSupplyTo, password, divisible, lockSupply]);
    const leaveGuard = useFormLeaveGuard({
        dirty: stage !== 'done' && hasRealInput,
        submitting: stage === 'submitting',
        signedUnbroadcast: stage === 'done' && result?.queued === true && result?.unsaved === true,
        onLeave: onBack,
    });

    // The active map and the settings read are best-effort: a host without
    // `getActiveAddresses` / `getSettings`, or one whose call fails, still
    // yields a usable form (newest-HD source, first-chain default).
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
                        'No addresses on any chain yet. Use Receive to generate one before issuing a token.',
                    );
                    return;
                }
                // `byChain` is in address-creation order, so opening on its
                // first key issued on the wallet's OLDEST chain forever. Open
                // on the last-used chain instead, ahead of that fallback,
                // exactly as Send and Swap do.
                setChainId((prev) => pickDefaultChainId(byChain, {
                    explicitChainId: prev,
                    settings,
                }));
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Same default as Send and every other spend-from-balance form: the
    // chain's active address, else the newest HD external. A dispenser-
    // delegated address is never the default; it vends rather than funds.
    useEffect(() => {
        if (!chainId || !addressesByChain || !activeByChain) return;
        const addresses = addressesByChain[chainId] || [];
        const funding = addresses.filter((a) => a.role !== 'dispenser');
        setFromAddressId((current) => (
            addresses.some((address) => address.id === current)
                ? current
                : preferredSourceId(funding, activeByChain[chainId])
        ));
    }, [chainId, addressesByChain, activeByChain]);

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const { formatNativeFee, formatProtocolFee } = useFeeFiat({
        chainCoin: descriptor?.coin,
        nativeTicker: coinTicker,
        settings,
    });
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];

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
    const feeFiat = feeEstimate ? formatNativeFee(feeEstimate.coinAmount) : null;
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listContacts !== 'function') return undefined;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setContacts(rows || []); })
            .catch(() => { if (!cancelled) setContacts([]); });
        return () => { cancelled = true; };
    }, [messaging]);

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = {
            VERSION: '0',
            // As typed: the chain records the tick verbatim, so the
            // wallet must not decide the case of a name a user coined.
            TICK: ticker.trim(),
        };
        p.DECIMALS = divisible ? '8' : '0';
        if (supply) {
            const s = String(supply).trim();
            p.MAX_SUPPLY = s;
            // MAX_SUPPLY is the cap, MINT_SUPPLY is how much of it
            // exists the moment the token is created. Deriving both from the
            // one "Supply" box made every wallet-issued token born at its own
            // cap with zero mint headroom, which made the whole Mint surface
            // unreachable for anything issued here. "Initial mint" left blank
            // keeps that simple path (mint it all now); a smaller value leaves
            // the difference mintable later. A 0 omits MINT_SUPPLY entirely,
            // the fair-mint shape (see TokenWizard's `edition` template): the
            // cap is declared at issuance with nothing minted yet.
            const wantsMint = String(initialMint).trim();
            const mint = wantsMint === '' ? s : wantsMint;
            if (Number(mint) > 0) p.MINT_SUPPLY = mint;
        }
        if (maxMint.trim()) p.MAX_MINT = maxMint.trim();
        if (description) p.DESCRIPTION = description.trim();
        if (lockSupply) {
            p.LOCK_MAX_SUPPLY = '1';
            p.LOCK_MINT = '1';
        }
        if (transferTo.trim()) p.TRANSFER = transferTo.trim();
        // Only meaningful beside a MINT_SUPPLY: with nothing minted at issuance
        // there is nothing to deliver, and the indexer would ignore the field.
        // The submit check refuses that pairing before it gets here.
        if (transferSupplyTo.trim() && p.MINT_SUPPLY) p.TRANSFER_SUPPLY = transferSupplyTo.trim();
        return p;
    }, [ticker, supply, initialMint, maxMint, divisible, description, lockSupply, transferTo, transferSupplyTo]);

    // What is left mintable after the initial mint, as a display string, or
    // null when the pair is blank/invalid/fully minted (nothing to say).
    const mintHeadroom = useMemo(() => {
        const cap = String(supply).trim();
        const mintText = String(initialMint).trim();
        if (!mintText || compareDecimalStrings(cap, '0') !== 1) return null;
        if (compareDecimalStrings(mintText, '0') === -1
            || compareDecimalStrings(mintText, cap) === 1) return null;
        const left = subtractDecimalStrings(cap, mintText);
        return compareDecimalStrings(left, '0') === 1 ? left : null;
    }, [supply, initialMint]);

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
        // Same grammar module as the wizard, so the two authoring
        // surfaces cannot drift apart on what a ticker may be called. It covers
        // the empty case too, which is why the separate blank check went with it.
        const tickerError = tickerGrammarError(ticker);
        if (tickerError) {
            setFormError(tickerError);
            return;
        }
        if (!isPositiveDecimal(supply)) {
            setFormError('Supply must be a positive number.');
            return;
        }
        // An initial mint above the cap is rejected outright by the
        // indexer (issue.js), which costs the user the fee and the token, so
        // it is caught here rather than at broadcast.
        const mintText = initialMint.trim();
        if (mintText) {
            if (!isNonNegativeDecimal(mintText)) {
                setFormError('Initial mint must be zero or a positive number.');
                return;
            }
            if (compareDecimalStrings(mintText, supply.trim()) === 1) {
                setFormError('Initial mint cannot be more than the supply.');
                return;
            }
            // Minting nothing on a token that can never mint leaves a token
            // with no supply and no way to ever create any.
            if (compareDecimalStrings(mintText, '0') === 0 && lockSupply) {
                setFormError(
                    'An initial mint of 0 needs minting left unlocked, or the token can never have any supply.',
                );
                return;
            }
        }
        const maxMintText = maxMint.trim();
        if (maxMintText) {
            if (!isPositiveDecimal(maxMintText)) {
                setFormError('Max mint per transaction must be a positive number, or left blank for no limit.');
                return;
            }
        }
        if (transferTo.trim() && !isValidIssueAddress(transferTo, descriptor)) {
            setFormError(`Transfer ownership address is not valid for ${descriptor?.displayName || 'this chain'}.`);
            return;
        }
        if (transferSupplyTo.trim() && !isValidIssueAddress(transferSupplyTo, descriptor)) {
            setFormError(`Initial mint destination is not valid for ${descriptor?.displayName || 'this chain'}.`);
            return;
        }
        // A supply destination with no initial mint would be silently dropped
        // by the chain; say so instead of composing a transaction that does
        // less than the form showed.
        if (transferSupplyTo.trim() && mintText === '0') {
            setFormError('Sending the initial mint somewhere needs an initial mint above 0.');
            return;
        }
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5: watcher-mode wallets have pubkeys but
    // no keys to sign with. Submit path routes through buildActionPsbt
    // (encode-only, no vault unlock, no signer, no broadcast); the user
    // takes the resulting unsigned PSBT to a Signer-mode wallet.
    const { isWatcherMode } = useWalletMode();

    // (§5.6 slice 2): the path composes ONE PSBT host-side
    // and confirms it on the shared confirm page.: hardware comes
    // through here too - it was excluded, which sent the users most likely
    // to care about verification down the legacy rebuild-on-Approve path
    // with no output-set tamper check, while the confirm page's own
    // hardware note tells them this screen is where action intent gets
    // verified. Watcher mode still branches (it encodes, it never signs).
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
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
                // The native-fee opt-in has to reach the COMPOSE step: the
                // FEE_DESTINATION output must be inside the PSBT the user
                // approves, not folded in on a later rebuild.
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
        } catch (err) {
            if (isUserRejection(err)) return;
            // Same mapping the sign path already does: NativeFeeForfeitError's own message is
            // wire wording, and this confirm path is the one the flow actually takes.
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFeeMandatory,
                fallback: err?.message || 'Issue failed.',
            }));
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
                payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'ISSUE', params: actionParams },
                    encoderOpts: {
                        payFeeInNativeCoin: payFeeInNativeCoin || undefined,
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
            draft.clear();
            setDraftPending(false);
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker,
                        mandatory: nativeFeeMandatory,
                        fallback: err?.message || 'Issue failed.',
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
            onBack={leaveGuard.guardedOnBack}
            title={stage === 'review' || stage === 'submitting'
                    ? t('issue.reviewTitle')
                    : t('issue.title')}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
            {leaveGuard.confirmation}
        </Screen>
    );

    if (loadError) {
        return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>{t('common.loading')}</p>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <WatcherResultPanel
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={leaveGuard.guardedOnBack}
                />,
            );
        }
        // Signed but not broadcast, so the token does not exist yet.
        if (result?.queued) {
            return wrap(
                <QueuedResultPanel onDone={leaveGuard.guardedOnBack} what={t('issue.issuance')} unsaved={result.unsaved} />,
            );
        }
        return wrap(
            <>
                <h2 className={styles.successTitle}>{t('issue.success')}</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>{t('common.transactionId')}</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : (
                    <p className={styles.hint}>{t('issue.broadcastComplete')}</p>
                )}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={leaveGuard.guardedOnBack}>{t('common.done')}</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        // Cluster P FOLLOWUP 4: hardware and watcher failures offer Edit
        // because changing form inputs is the recovery path.
        return wrap(
            <FormPage
                label={t('issue.reviewTokenIssue')}
                onSubmit={handleSubmit}
                status={(isWatcherMode || isHwSource) && submitError ? (
                    <StatusMessage
                        variant="error"
                        recovery={{ label: t('common.edit'), onAction: () => { setSubmitError(null); setStage('form'); } }}
                    >
                        {submitError}
                    </StatusMessage>
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
                            ? t('common.createUnsignedTransaction')
                            : isHwSource
                                ? t('common.signOn', { device: fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger' })
                                : (descriptor
                                    ? t('common.signOn', { device: descriptor.displayName })
                                    : t('common.sign'))}
                    </Button>
                )}
            >
                <p className={styles.summary}>{decoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>{t('common.chain')}</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>{t('common.from')}</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    {(decoded?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                    <DetailRow
                        label={t('common.networkFee')}
                        value={feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                                + (feeFiat ? ` (${feeFiat})` : '')
                            : 'Fee estimate unavailable for this chain.'}
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
                        {t('common.watcherBuildsUnsigned')}
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
                    ? t('common.networkFeeValue', {
                        amount: feeEstimate.coinAmount,
                        ticker: coinTicker,
                    }).trim()
                        + (feeFiat ? ` (${feeFiat})` : '')
                    : t('common.networkFeeUnavailable')}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                formatNativeFee={formatNativeFee}
                formatProtocolFee={formatProtocolFee}
                hintClassName={styles.hint}
                // Hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title={t('common.fromAddress')}
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

    if (contactsPickerOpen) {
        return (
            <ContactsPickerScreen
                variant={variant}
                contacts={contacts}
                onPick={(entry) => {
                    if (contactsTarget === 'supply') setTransferSupplyTo(entry.address);
                    else setTransferTo(entry.address);
                    setContactsPickerOpen(false);
                }}
                onBack={() => setContactsPickerOpen(false)}
            />
        );
    }

    const draftBanner = draft.hasDraft() && !draftPending ? (
        <StatusMessage
            variant="status"
            recovery={{ label: t('common.restore'), onAction: restoreDraft }}
        >
            {t('issue.draft.unfinished')}
            <button
                type="button"
                onClick={dismissDraft}
                aria-label={t('issue.draft.discardLabel')}
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
                {t('common.discard')}
            </button>
        </StatusMessage>
    ) : null;

    return wrap(
        <FormPage
            label={t('issue.title')}
            onSubmit={handleReview}
            onChangeCapture={() => { if (formError) setFormError(null); }}
            status={formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || !ticker || !supply || actionConfirm.composing}
                >
                    {singleEncode ? t('issue.title') : t('common.preview')}
                </Button>
            )}
        >
            {draftBanner}
            <NetworkField value={chainId} onChange={setChainId} chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} />

            {fromAddress ? (
                <AddressField
                    label={t('common.from')}
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel={t('common.chooseSourceAddress')}
                />
            ) : (
                <StatusMessage variant="error" className={styles.error}>
                    {t('common.noAddressOnChain')}
                </StatusMessage>
            )}

            <Input
                label={t('issue.ticker')}
                hint={TICKER_HINT}
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
            />
            <Input
                label={t('issue.supply')}
                hint={t('issue.supplyHint')}
                inputMode="decimal"
                value={supply}
                onChange={(e) => setSupply(e.target.value)}
                autoComplete="off"
            />
            <Input
                label={t('issue.initialMintOptional')}
                hint={mintHeadroom
                    ? t('issue.initialMintHeadroom', { amount: mintHeadroom })
                    : t('issue.initialMintHint')}
                inputMode="decimal"
                value={initialMint}
                onChange={(e) => setInitialMint(e.target.value)}
                autoComplete="off"
            />
            <Input
                label={t('issue.maxMintOptional')}
                hint={t('issue.maxMintHint')}
                inputMode="decimal"
                value={maxMint}
                onChange={(e) => setMaxMint(e.target.value)}
                autoComplete="off"
            />
            <label className={styles.checkRow}>
                <input
                    type="checkbox"
                    checked={divisible}
                    onChange={(e) => setDivisible(e.target.checked)}
                />
                <span>{t('issue.divisible')}</span>
            </label>
            <Input
                label={t('issue.descriptionOptional')}
                hint={t('issue.descriptionHint')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                autoComplete="off"
                maxLength={250}
            />
            <label className={styles.checkRow}>
                <input
                    type="checkbox"
                    checked={lockSupply}
                    onChange={(e) => setLockSupply(e.target.checked)}
                />
                <span>{t('issue.lockSupply')}</span>
            </label>
            {lockSupply && mintHeadroom ? (
                // Locking minting alongside a partial initial mint strands the
                // remainder forever: the cap says one thing, the token can only
                // ever hold another. Say so before the fee is spent.
                <StatusMessage variant="status">
                    {t('issue.lockSupplyWarning', { amount: mintHeadroom })}
                </StatusMessage>
            ) : null}
            {/* Bridgeability, the ISSUE format 7 fields (xchain-token-bridge.md
                section 7). NOT set here, and the panel says so rather than
                offering boxes that would silently do nothing: format 0 carries
                no BRIDGE_CHAINS, MIN_DEPTH or LOCK_BRIDGE field, so the opt-in
                is a separate owner-only action on an existing row. What belongs
                on THIS screen is the one decision that is irreversible from
                here: binding an address list to the token shuts the bridge door
                for good in milestone 1. */}
            <div className={styles.warnings}>
                <p className={styles.hint}>
                    {t('issue.bridgingHint')}
                </p>
                <p className={styles.hint}>
                    {t('issue.boundListHint')}
                </p>
            </div>
            <AddressField
                label={t('issue.transferOwnershipOptional')}
                icon="contacts"
                hint={t('issue.transferOwnershipHint')}
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                onIconClick={() => { setContactsTarget('owner'); setContactsPickerOpen(true); }}
            />
            <AddressField
                label={t('issue.sendInitialMintOptional')}
                icon="contacts"
                hint={t('issue.sendInitialMintHint')}
                value={transferSupplyTo}
                onChange={(e) => setTransferSupplyTo(e.target.value)}
                onIconClick={() => { setContactsTarget('supply'); setContactsPickerOpen(true); }}
            />

            <FeeSelector
                label={t('common.networkFee')}
                coinTicker={coinTicker}
                formatFiat={formatNativeFee}
                tiers={feeTiers}
                value={feePick}
                onChange={setFeePick}
                customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
            />

            <NativeFeeToggle
                checked={payFeeInNativeCoin}
                onChange={setPayFeeInNativeCoin}
                coinTicker={coinTicker}
                mandatory={nativeFeeMandatory}
            />
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
