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
    airdrop as airdropLib,
    schemas as schemasLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { LockedTokenContext } from '../components/LockedTokenContext.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useDropZone } from '../hooks/useDropZone.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();
const POLL_INTERVAL_MS = 10_000;

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * Airdrop form: §40.9.
 *
 * Authors an AIRDROP-to-address-list as two sequential transactions:
 *
 *   1. LIST (v0, TYPE=2): creates an on-chain ADDRESS list. Gets an
 *      ACTION_INDEX assigned by the indexer.
 *   2. AIRDROP (v0): references that ACTION_INDEX to distribute the
 *      per-recipient amount to each address on the list.
 *
 * Stage machine:
 *   compose         - user pastes/uploads addresses, picks token+amount
 *   review-list     - decoder-rendered LIST preview + sign
 *   wait-index      - poll explorer for LIST's ACTION_INDEX
 *   review-airdrop  - decoder-rendered AIRDROP preview + sign
 *   done            - both txids shown
 *
 * Progress is persisted to `vault.pendingAirdrops` at each stage
 * transition so the user can close the wallet between signs and
 * resume. AirdropForm accepts an optional `resumeId`; when set, it
 * hydrates from the saved record and jumps to the right stage.
 *
 * Address validation is light (length + base58/bech32 charset);
 * anything that slips through is caught by the encoder at sign time.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string | null} [props.resumeId]
 * @param {() => void} props.onBack
 */
export function AirdropForm({ walletId, resumeId = null, onBack, initialChainId, initialTick, initialFromAddress }) {
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
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    const [token, setToken] = useState((initialTick || '').toUpperCase());
    const [amountPer, setAmountPer] = useState('');
    const [memo, setMemo] = useState('');
    const [pasteText, setPasteText] = useState('');
    const [recipients, setRecipients] = useState(
        /** @type {{ valid: string[], invalid: string[], duplicates: number }} */
        ({ valid: [], invalid: [], duplicates: 0 }),
    );
    const [showInvalid, setShowInvalid] = useState(false);
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(
        /** @type {'compose' | 'review-list' | 'wait-index' | 'review-airdrop' | 'done'} */
        ('compose'),
    );
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [pendingId, setPendingId] = useState(/** @type {string | null} */ (null));
    const [listTxid, setListTxid] = useState(/** @type {string | null} */ (null));
    const [listActionIndex, setListActionIndex] = useState(
        /** @type {string | null} */ (null),
    );
    const [airdropTxid, setAirdropTxid] = useState(/** @type {string | null} */ (null));
    const [waitElapsed, setWaitElapsed] = useState(0);
    const [hydrated, setHydrated] = useState(false);
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const fileInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before airdropping.',
                    );
                    return;
                }
                if (!resumeId && !lockedToken) setChainId(first);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, resumeId]);

    useEffect(() => {
        if (!resumeId || hydrated || !addressesByChain) return;
        let cancelled = false;
        messaging.listPendingAirdropsForWallet({ walletId })
            .then((records) => {
                if (cancelled) return;
                const rec = (records || []).find((r) => r.id === resumeId);
                if (!rec) {
                    setLoadError('Pending airdrop not found. It may have been cleared.');
                    return;
                }
                setChainId(rec.chainId);
                setToken(rec.token);
                setAmountPer(rec.amountPer);
                setRecipients({ valid: [...rec.recipients], invalid: [], duplicates: 0 });
                setMemo(rec.memo || '');
                setPendingId(rec.id);
                setListTxid(rec.listTxid);
                setListActionIndex(rec.listActionIndex);
                setAirdropTxid(rec.airdropTxid);
                if (rec.stage === 'waiting-index') setStage('wait-index');
                else if (rec.stage === 'ready-to-airdrop') setStage('review-airdrop');
                else if (rec.stage === 'done') setStage('done');
                // Pick matching fromAddressId once addresses load.
                const addrs = addressesByChain[rec.chainId] || [];
                const match = addrs.find((a) => a.address === rec.fromAddress);
                if (match) setFromAddressId(match.id);
                setHydrated(true);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load pending airdrop.');
            });
        return () => { cancelled = true; };
    }, [resumeId, hydrated, addressesByChain, walletId, messaging]);

    // Default fromAddressId → preferred issuer address (when present)
    // or the newest external HD address on the chosen chain.
    useEffect(() => {
        if (!chainId || !addressesByChain || fromAddressId) return;
        const all = addressesByChain[chainId] || [];
        if (initialFromAddress) {
            const match = all.find((a) => a.address === initialFromAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        const addrs = all.filter(
            (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
        );
        if (addrs.length > 0) {
            const sorted = [...addrs].sort((a, b) => {
                const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                return bi - ai;
            });
            setFromAddressId(sorted[0].id);
        }
    }, [chainId, addressesByChain, fromAddressId, initialFromAddress]);

    useEffect(() => {
        if (stage !== 'compose') return;
        const parts = airdropLib.parsePaste(pasteText);
        setRecipients(airdropLib.classifyRecipients(parts));
    }, [pasteText, stage]);

    useEffect(() => {
        if (stage === 'review-list' || stage === 'review-airdrop') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    // Stage-4 polling: waits for the LIST to be indexed and resolves
    // its ACTION_INDEX. Pauses when the tab is hidden to avoid burning
    // explorer bandwidth for off-screen windows.
    useEffect(() => {
        if (stage !== 'wait-index' || !listTxid || !chainId || !pendingId) return undefined;
        let cancelled = false;
        const started = Date.now();
        const tick = async () => {
            if (cancelled) return;
            setWaitElapsed(Math.floor((Date.now() - started) / 1000));
            if (typeof document !== 'undefined'
                && document.visibilityState === 'hidden') return;
            try {
                const resp = await messaging.getActionByTxid({ chainId, txid: listTxid });
                if (cancelled) return;
                const idx = extractActionIndex(resp);
                if (idx) {
                    setListActionIndex(idx);
                    try {
                        await messaging.updatePendingAirdrop({
                            id: pendingId,
                            patch: { stage: 'ready-to-airdrop', listActionIndex: idx },
                        });
                    } catch (err) {
                        // Persistence failure is non-fatal here; the in-memory
                        // state still advances, and the user can re-sign.
                    }
                    setStage('review-airdrop');
                }
            } catch (err) {
                // Keep polling through transient network errors.
            }
        };
        tick(); // fire once immediately
        const handle = setInterval(tick, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(handle); };
    }, [stage, listTxid, chainId, pendingId, messaging]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    // Balance of the amount tick at the source address (Max + "available").
    const tickAmtBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: fromAddress?.address,
        tick: token,
    });

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // Network fee: Low / Normal / Fast / Custom via FeeSelector; feePerKb
    // prices both broadcasts (the LIST and the AIRDROP).
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

    const listParams = useMemo(() => {
        /** @type {Record<string, string | string[]>} */
        const p = {
            VERSION: '0',
            TYPE: '2',
            ITEM: [...recipients.valid],
        };
        return p;
    }, [recipients.valid]);

    const airdropParams = useMemo(() => {
        /** @type {Record<string, string> } */
        const p = {
            VERSION: '0',
            TICK: token.trim().toUpperCase(),
            AMOUNT: String(amountPer).trim(),
            LIST_ACTION_INDEX: listActionIndex || '',
        };
        if (memo.trim()) p.MEMO = memo.trim();
        return p;
    }, [token, amountPer, memo, listActionIndex]);

    const listDecoded = useMemo(() => {
        if (stage !== 'review-list' && stage !== 'wait-index') return null;
        return decoderLib.decodeAction({
            action: 'LIST',
            params: listParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, listParams, chainId]);

    const airdropDecoded = useMemo(() => {
        if (stage !== 'review-airdrop' && stage !== 'done') return null;
        return decoderLib.decodeAction({
            action: 'AIRDROP',
            params: airdropParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, airdropParams, chainId]);

    const totalDistribution = useMemo(() => {
        const amt = Number(String(amountPer).trim());
        if (!Number.isFinite(amt) || amt <= 0) return null;
        if (recipients.valid.length === 0) return null;
        return amt * recipients.valid.length;
    }, [amountPer, recipients.valid.length]);

    const handleFile = useCallback((event) => {
        const file = event.target?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const text = typeof reader.result === 'string' ? reader.result : '';
            const parts = airdropLib.parseCsv(text);
            setPasteText(parts.join('\n'));
        };
        reader.readAsText(file);
    }, []);

    // Cluster P FOLLOWUP 2: drag-and-drop a CSV / TXT recipient list
    // onto the textarea. Additive; the click-to-pick lane via the
    // `<input type="file">` below stays the primary affordance.
    const recipientsDrop = useDropZone({
        accept: ['.csv', '.txt', 'text/csv', 'text/plain'],
        readAs: 'text',
        onError: (msg) => setFormError(msg),
        onFile: ({ content }) => {
            const text = typeof content === 'string' ? content : '';
            const parts = airdropLib.parseCsv(text);
            setPasteText(parts.join('\n'));
        },
    });

    function handleReviewList(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!token.trim()) {
            setFormError('Token is required.');
            return;
        }
        if (!/^[A-Za-z0-9.^]+$/.test(token.trim())) {
            setFormError('Token ticker accepts A–Z, 0–9, period, or ^TICK_ID.');
            return;
        }
        const amt = String(amountPer).trim();
        if (!amt || Number(amt) <= 0) {
            setFormError('Per-recipient amount must be a positive number.');
            return;
        }
        if (recipients.valid.length === 0) {
            setFormError('Add at least one valid recipient address.');
            return;
        }
        if (memo && /[|;]/.test(memo)) {
            setFormError('Memo cannot contain | or ; characters.');
            return;
        }
        setFormError(null);
        setStage('review-list');
    }

    const hw = isHwSource(fromAddress);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5: AIRDROP is a multi-phase action. LIST is
    // broadcast first, then the wallet polls for indexer confirmation, then
    // AIRDROP is broadcast referencing the indexed LIST's ACTION_INDEX. The
    // index-wait step is fundamentally incompatible with the watcher-mode
    // contract (the wallet that builds the PSBT is not the wallet that
    // broadcasts it, so it can't observe the broadcast hitting the indexer).
    // Block the form in watcher mode with a redirect rather than ship a
    // partial flow that strands the user mid-LIST.
    const { isWatcherMode } = useWalletMode();

    //  ( §5.6 slice 2): AIRDROP is two signed transactions, so
    // BOTH legs get their own single-encode confirm round. The recipient-list
    // review stage stays: it is a data review (who gets what), not an encoded-
    // action preview, and the confirm page is what gates each signature.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = actionConfirm.enabled && !isWatcherMode && !hw;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // Which leg the confirm page is showing, so its decoded intent matches.
    const [confirmLeg, setConfirmLeg] = useState(/** @type {'LIST'|'AIRDROP'} */ ('LIST'));

    function sourceDescriptor() {
        return {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
    }

    // Leg 1: the LIST that names the recipients. On Approve the prebuilt PSBT
    // is signed and the pending-airdrop record is written before the wallet
    // starts polling the indexer for the LIST's ACTION_INDEX.
    async function openListConfirm() {
        const from = sourceDescriptor();
        setSubmitError(null);
        setConfirmLeg('LIST');
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'LIST', params: listParams },
                ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                onApprove: (prebuiltPsbt) => messaging.createList({
                    walletId,
                    chainId,
                    from,
                    params: listParams,
                    password: passwordValueRef.current,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('LIST broadcast did not return a txid.');
            const record = schemasLib.createPendingAirdrop({
                walletId,
                chainId,
                fromAddress: fromAddress.address,
                token: token.trim().toUpperCase(),
                amountPer: String(amountPer).trim(),
                recipients: recipients.valid,
                listTxid: txid,
                memo: memo.trim() || undefined,
            });
            await messaging.savePendingAirdrop({ record });
            setPendingId(record.id);
            setListTxid(txid);
            setPassword('');
            setStage('wait-index');
        } catch (err) {
            if (isUserRejection(err)) return;
            setSubmitError(err?.message || 'LIST broadcast failed.');
        }
    }

    // Leg 2: the AIRDROP that references the now-indexed LIST.
    async function openAirdropConfirm() {
        const from = sourceDescriptor();
        setSubmitError(null);
        setConfirmLeg('AIRDROP');
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'AIRDROP', params: airdropParams },
                ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                onApprove: (prebuiltPsbt) => messaging.airdropAction({
                    walletId,
                    chainId,
                    from,
                    params: airdropParams,
                    password: passwordValueRef.current,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('AIRDROP broadcast did not return a txid.');
            setAirdropTxid(txid);
            if (pendingId) {
                try {
                    await messaging.updatePendingAirdrop({
                        id: pendingId,
                        patch: { stage: 'done', airdropTxid: txid },
                    });
                } catch (_err) { /* non-fatal */ }
            }
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setSubmitError(err?.message || 'AIRDROP broadcast failed.');
        }
    }

    async function handleSignList(event) {
        event.preventDefault();
        if (singleEncode) { openListConfirm(); return; }
        if (submitting) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitting(true);
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
                params: listParams,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            const res = hw
                ? await messaging.createListHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.createList({ ...base, password });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('LIST broadcast did not return a txid.');
            const record = schemasLib.createPendingAirdrop({
                walletId,
                chainId,
                fromAddress: fromAddress.address,
                token: token.trim().toUpperCase(),
                amountPer: String(amountPer).trim(),
                recipients: recipients.valid,
                listTxid: txid,
                memo: memo.trim() || undefined,
            });
            await messaging.savePendingAirdrop({ record });
            setPendingId(record.id);
            setListTxid(txid);
            setPassword('');
            setStage('wait-index');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'LIST broadcast failed.',
            );
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setSubmitting(false);
        }
    }

    async function handleSignAirdrop(event) {
        event.preventDefault();
        if (singleEncode) { openAirdropConfirm(); return; }
        if (submitting) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitting(true);
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
                params: airdropParams,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            const res = hw
                ? await messaging.airdropActionHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.airdropAction({ ...base, password });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('AIRDROP broadcast did not return a txid.');
            setAirdropTxid(txid);
            if (pendingId) {
                try {
                    await messaging.updatePendingAirdrop({
                        id: pendingId,
                        patch: { stage: 'done', airdropTxid: txid },
                    });
                } catch (err) { /* non-fatal */ }
            }
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'AIRDROP broadcast failed.',
            );
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setSubmitting(false);
        }
    }

    async function handleClearPending() {
        if (pendingId) {
            try { await messaging.clearPendingAirdrop({ id: pendingId }); } catch (_) { /* */ }
        }
        onBack();
    }

        const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review-list' ? 'Review address list'
                    : stage === 'wait-index' ? 'Waiting for list to be indexed'
                        : stage === 'review-airdrop' ? 'Review airdrop'
                            : stage === 'done' ? 'Airdrop complete'
                                : `Airdrop tokens`}
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
    if (isWatcherMode) {
        return wrap(
            <>
                <h2 className={styles.successTitle}>Not available in watcher mode</h2>
                <p className={styles.hint}>
                    Airdrop is a two-phase action: the wallet broadcasts a
                    recipient-list transaction, waits for the network to
                    confirm it, then broadcasts the airdrop transaction
                    referencing the list. A watcher-mode wallet can't observe
                    the recipient list landing on-chain (broadcasting happens on a different
                    wallet), so this flow can't be split across an
                    air-gapped boundary today.
                </p>
                <p className={styles.hint}>
                    Switch this wallet to <strong>full</strong> mode to
                    author an airdrop, or use a Full-mode wallet that holds
                    the same seed.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Back</Button>
                </div>
            </>,
        );
    }

    //  confirm page, rendered in place of the review stage (the overlay
    // modal didn't fit small/mobile viewports); flow state stays intact.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                decoded={decoderLib.decodeAction({
                    action: confirmLeg,
                    params: confirmLeg === 'LIST' ? listParams : airdropParams,
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
                hintClassName={styles.hint}
            />
        );
    }

    if (stage === 'done') {
        return wrap(
            <>
                <h2 className={styles.successTitle}>Airdrop sent</h2>
                <p className={styles.successLabel}>Recipient list transaction</p>
                <code className={styles.txid}>{listTxid}</code>
                <p className={styles.successLabel}>Airdrop transaction</p>
                <code className={styles.txid}>{airdropTxid}</code>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={handleClearPending}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'wait-index') {
        const minutes = Math.floor(waitElapsed / 60);
        const slow = minutes >= 5;
        return wrap(
            <>
                <p className={styles.summary}>{listDecoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Recipient list transaction</dt>
                    <dd className={styles.detailsValue}>
                        <code className={styles.txid}>{listTxid}</code>
                    </dd>
                    <dt className={styles.detailsLabel}>Elapsed</dt>
                    <dd className={styles.detailsValue}>
                        {minutes > 0 ? `${minutes} min ${waitElapsed % 60}s` : `${waitElapsed}s`}
                    </dd>
                </dl>
                <p className={styles.hint}>
                    Waiting for the recipient-list transaction to be indexed. Once the
                    explorer assigns an action index, we'll continue to the
                    airdrop step. Safe to close the wallet; we'll resume from
                    Home when you reopen it.
                </p>
                {slow ? (
                    <p className={styles.hint}>
                        This is taking longer than usual. Typical wait is 1–2
                        block confirmations. You can leave it running or come
                        back later.
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={onBack}>Close (keep waiting)</Button>
                    <Button variant="ghost" onClick={handleClearPending}>Cancel airdrop</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review-list') {
        return wrap(
            <form onSubmit={handleSignList} noValidate>
                <p className={styles.summary}>{listDecoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    {(listDecoded?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                    <DetailRow
                        label="Network fee"
                        value={feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    />
                </dl>
                {listDecoded && listDecoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {listDecoded.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                <p className={styles.hint}>
                    Airdrop is a two-transaction flow. Step 1 broadcasts the
                    address list; once it's indexed, step 2 signs the AIRDROP
                    that references it. {hw
                        ? 'You will confirm on your hardware device twice.'
                        : 'You will enter your password twice.'}
                </p>
                {/* : on the single-encode path the credentials live on
                    the confirm page, so this stage stays a pure recipient
                    review and the button opens that page. */}
                {singleEncode ? null : (
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
                        disabled={submitting}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
                {(hw || singleEncode) && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        block
                        loading={submitting || actionConfirm.composing}
                        disabled={singleEncode
                            ? actionConfirm.composing
                            : (hw ? hwStatus !== 'available' : (!signerReady && password.length === 0))}
                    >
                        {hw
                            ? `Sign LIST on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : (descriptor ? `Sign LIST on ${descriptor.displayName}` : 'Sign LIST')}
                    </Button>
                </div>
            </form>,
        );
    }

    if (stage === 'review-airdrop') {
        return wrap(
            <form onSubmit={handleSignAirdrop} noValidate>
                <p className={styles.summary}>{airdropDecoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    {(airdropDecoded?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                    <dt className={styles.detailsLabel}>Recipients</dt>
                    <dd className={styles.detailsValue}>{recipients.valid.length}</dd>
                    {totalDistribution !== null ? (
                        <>
                            <dt className={styles.detailsLabel}>Total distribution</dt>
                            <dd className={styles.detailsValue}>
                                ~{totalDistribution} {token.trim().toUpperCase()}
                            </dd>
                        </>
                    ) : null}
                    <DetailRow
                        label="Network fee"
                        value={feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    />
                </dl>
                {airdropDecoded && airdropDecoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {airdropDecoded.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                <p className={styles.hint}>
                    Airdrops charge an XChain fee based on the number of
                    recipients. The network computes the exact
                    fee at execute time; make sure the source address holds
                    enough of {token.trim().toUpperCase() || 'the token'} +
                    fee tick to cover the full distribution.
                </p>
                {/* : credentials live on the confirm page for leg 2 too. */}
                {singleEncode ? null : (
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
                        disabled={submitting}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
                {(hw || singleEncode) && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
                        Close (resume later)
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={submitting || actionConfirm.composing}
                        disabled={
                            !listActionIndex
                            || (singleEncode
                                ? actionConfirm.composing
                                : (hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)))
                        }
                    >
                        {hw
                            ? `Sign AIRDROP on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : (descriptor ? `Sign AIRDROP on ${descriptor.displayName}` : 'Sign AIRDROP')}
                    </Button>
                </div>
            </form>,
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
                    setToken(String(sel.tick || '').toUpperCase());
                    if (!lockedToken && sel.chainId) setChainId(sel.chainId);
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    // stage === 'compose'
    return wrap(
        <form onSubmit={handleReviewList} noValidate>
            {lockedToken && chainId ? (
                <LockedTokenContext chainId={chainId} tick={token} label="Token to drop" />
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
                    label="Token to drop"
                    value={token && chainId ? { chainId, tick: token } : null}
                    onOpenPicker={() => setTokenPickerOpen(true)}
                />
            )}
            <AmountField
                label="Per-recipient amount"
                hint="Amount sent to each address on the list."
                amount={amountPer}
                tick={token}
                onAmountFieldChange={(rawValue) => {
                    const stripped = String(rawValue).replace(/,/g, '');
                    if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                    setAmountPer(stripped);
                }}
                onMax={tickAmtBalance && Number(tickAmtBalance) > 0
                    ? () => setAmountPer(tickAmtBalance)
                    : undefined}
                maxDisabled={!tickAmtBalance}
                balanceText={tickAmtBalance != null && (token)
                    ? `${formatWithThousands(tickAmtBalance)} ${String(token).toUpperCase()} available`
                    : null}
            />

            <label
                className={styles.pickerLabel}
                {...recipientsDrop.rootProps}
                data-drop-active={recipientsDrop.isDragOver ? 'true' : 'false'}
            >
                Recipients
                <textarea
                    className={styles.picker}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={recipientsDrop.isDragOver
                        ? 'Drop the CSV / TXT file here'
                        : 'Paste addresses, one per line or comma-separated.'}
                    rows={8}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                />
            </label>
            <div className={styles.fromLine}>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    onChange={handleFile}
                    aria-label="Upload CSV of addresses"
                />
            </div>

            {pasteText.trim() ? (
                <p className={styles.hint}>
                    {recipients.valid.length} valid address
                    {recipients.valid.length === 1 ? '' : 'es'}
                    {recipients.duplicates > 0
                        ? ` · ${recipients.duplicates} duplicate${recipients.duplicates === 1 ? '' : 's'} removed`
                        : ''}
                    {recipients.invalid.length > 0
                        ? ` · ${recipients.invalid.length} invalid skipped`
                        : ''}
                    {totalDistribution !== null
                        ? ` · total ~${totalDistribution} ${token.trim().toUpperCase() || 'TOKEN'}`
                        : ''}
                </p>
            ) : null}

            {recipients.invalid.length > 0 ? (
                <div className={styles.hint}>
                    <button
                        type="button"
                        className={styles.back}
                        onClick={() => setShowInvalid((s) => !s)}
                    >
                        {showInvalid ? 'Hide' : 'Show'} {recipients.invalid.length} invalid
                    </button>
                    {showInvalid ? (
                        <ul>
                            {recipients.invalid.map((a, i) => (
                                <li key={i}><code>{a}</code></li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            ) : null}

            <Input
                label="Memo (optional)"
                hint="Protocol rejects | or ;."
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
            />

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

            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    disabled={!fromAddress || recipients.valid.length === 0 || !token || !amountPer}
                >
                    Review recipients
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

// Resolve the ACTION_INDEX from whatever shape the explorer returns.
// Transactions endpoint returns the action row merged with tx data;
// historically the field is either `action_index` (snake_case from
// the DB) or `actionIndex` (camelCase if wrapped by a newer layer).
function extractActionIndex(resp) {
    if (!resp || typeof resp !== 'object') return null;
    const raw = resp.action_index ?? resp.actionIndex ?? null;
    if (raw === null || raw === undefined) return null;
    const s = String(raw);
    return s.length > 0 ? s : null;
}
