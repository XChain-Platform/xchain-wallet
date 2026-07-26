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
    Select,
    ChainBadge,
    AddressText,
    NetworkField,
    FeeSelector,
    AddressField,
} from '@xchain-wallet/core/ui';
import { registry as registryLib, decoder as decoderLib, airdrop as airdropLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useDropZone } from '../hooks/useDropZone.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { TokenPicker } from './TokenPicker.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * PC-10 "My Lists": LIST v0 create form. One transaction, so (unlike
 * AirdropForm/ProjectRosterForm's two-sign LIST+AIRDROP/LINK flows)
 * this is fully HW- and watcher-mode-compatible: it's just a LIST,
 * signed once.
 *
 * Two list types (LIST.md VERSION 0):
 *   TYPE=2 (ADDRESS) - paste/upload addresses, or add from Contacts.
 *   TYPE=1 (TICK)    - type ticks directly, or add from the token picker.
 *
 * Stage machine mirrors CreatePollForm: 'form' -> 'review' -> 'submitting'
 * -> 'done', with the  single-encode confirm page substituting for
 * 'review' when that slice is enabled and the source isn't HW/watcher.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.chainId]
 * @param {'1' | '2'} [props.initialType]   defaults to '2' (address list)
 * @param {() => void} props.onBack
 */
export function ListCreateForm({ walletId, chainId: initialChainId, initialType, onBack }) {
    const [chainId, setChainId] = useState(initialChainId || null);
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [contactPickerOpen, setContactPickerOpen] = useState(false);

    const [listType, setListType] = useState(
        /** @type {'1' | '2'} */ (initialType === '1' ? '1' : '2'),
    );

    // TYPE=2 (address list) member entry: same paste/CSV parsing as
    // AirdropForm, reused verbatim so behaviour (dedupe, invalid-address
    // detection, drag-and-drop) matches exactly.
    const [pasteText, setPasteText] = useState('');
    const [recipients, setRecipients] = useState(
        /** @type {{ valid: string[], invalid: string[], duplicates: number }} */
        ({ valid: [], invalid: [], duplicates: 0 }),
    );
    const [showInvalid, setShowInvalid] = useState(false);
    const fileInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // TYPE=1 (token list) member entry: same free-text tick parsing as
    // ProjectRosterForm.
    const [ticksText, setTicksText] = useState('');

    const [password, setPassword] = useState('');
    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const first = Object.keys(byChain || {})[0];
                if (!chainId && first) setChainId(first);
                if (!first) setLoadError('No addresses on any chain yet. Use Receive to generate one first.');
            })
            .catch((err) => { if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.'); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [walletId, messaging]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    useEffect(() => {
        if (listType !== '2') return;
        const parts = airdropLib.parsePaste(pasteText);
        setRecipients(airdropLib.classifyRecipients(parts));
    }, [pasteText, listType]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain || !chainId) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    useEffect(() => {
        if (!chainId || !addressesByChain || fromAddressId) return;
        const all = addressesByChain[chainId] || [];
        const hd = all.filter((a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0');
        const pool = hd.length > 0 ? hd : all;
        if (pool.length > 0) {
            const sorted = [...pool].sort((a, b) => {
                const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                return bi - ai;
            });
            setFromAddressId(sorted[0].id);
        }
    }, [chainId, addressesByChain, fromAddressId]);

    const hw = isHwSource(fromAddress);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const { isWatcherMode } = useWalletMode();
    const coinTicker = descriptor ? { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' }[descriptor.coin] : '';

    // PC-51: opt-in native-coin protocol fee (LIST is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee();

    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(() => estimateNativeSendFeeTiers({ chainId, chainRegistry }), [chainId]);
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

    // Parse the tick textarea into validated, deduplicated, uppercased
    // ticks (identical shape to ProjectRosterForm's memberTicks).
    const memberTicks = useMemo(() => {
        const seen = new Set();
        const out = [];
        for (const raw of ticksText.split(/[\n,]+/)) {
            const t = raw.trim().toUpperCase();
            if (!t || seen.has(t)) continue;
            seen.add(t);
            out.push(t);
        }
        return out;
    }, [ticksText]);
    const invalidTicks = useMemo(
        () => memberTicks.filter((t) => !/^[A-Z0-9.^]+$/.test(t)),
        [memberTicks],
    );

    const items = listType === '2' ? recipients.valid : memberTicks;

    const wireParams = useMemo(() => ({
        VERSION: '0',
        TYPE: listType,
        ITEM: items,
    }), [listType, items]);

    const recipientsDrop = useDropZone({
        accept: ['.csv', '.txt', 'text/csv', 'text/plain'],
        readAs: 'text',
        onError: (msg) => setFormError(msg),
        onFile: ({ content }) => {
            const text = typeof content === 'string' ? content : '';
            const parts = airdropLib.parseCsv(text);
            setPasteText((prev) => (prev.trim() ? `${prev}\n${parts.join('\n')}` : parts.join('\n')));
        },
    });

    function handleFile(event) {
        const file = event.target?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const text = typeof reader.result === 'string' ? reader.result : '';
            const parts = airdropLib.parseCsv(text);
            setPasteText((prev) => (prev.trim() ? `${prev}\n${parts.join('\n')}` : parts.join('\n')));
        };
        reader.readAsText(file);
    }

    // : software sources go through the single-encode confirm
    // page; hardware + watcher keep the legacy review stage (same split
    // as CreatePollForm / AirdropForm).
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // : hardware signs the SAME prebuilt PSBT through the same host
    // flow, with the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'createList',
        hardware: 'createListHw',
    });

    const decoded = useMemo(() => {
        if (stage !== 'review' && !actionConfirm.open) return null;
        return decoderLib.decodeAction({ action: 'LIST', params: wireParams, chainId: chainId || undefined, chainRegistry });
    }, [stage, actionConfirm.open, wireParams, chainId]);

    async function openConfirmScreen() {
        const from = sourceDescriptor();
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'LIST', params: wireParams },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: wireParams,
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
            setFormError(err?.message || 'Create list failed.');
        }
    }

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

    function validate() {
        if (!fromAddress) { setFormError('No signing address available on this chain.'); return false; }
        if (listType === '2') {
            if (recipients.valid.length === 0) { setFormError('Add at least one valid address.'); return false; }
        } else {
            if (memberTicks.length === 0) { setFormError('Add at least one token.'); return false; }
            if (invalidTicks.length > 0) {
                setFormError(`These don't look like token names: ${invalidTicks.join(', ')}`);
                return false;
            }
        }
        return true;
    }

    function handleReview(event) {
        event.preventDefault();
        if (!validate()) return;
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
        setStage('submitting');
        setSubmitError(null);
        try {
            const from = sourceDescriptor();
            const base = {
                walletId,
                chainId,
                from,
                params: wireParams,
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from,
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                    actionData: { action: 'LIST', params: wireParams },
                });
            } else {
                const fn = hw ? messaging.createListHw : messaging.createList;
                const args = hw ? { ...base, signerId: fromAddress.signerId } : { ...base, password };
                res = await fn(args);
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(isBadPassword ? 'Incorrect password.' : err?.message || 'Create list failed.');
            setStage('review');
            if (!isWatcherMode && !hw) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        }
    }

    const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting' ? 'Review list' : 'Create list'}
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
        const txid = result?.txid || result?.tx_hash;
        if (result?.psbtHex && !txid) {
            return wrap(<WatcherResultPanel result={result} onBuildAnother={() => { setResult(null); setStage('form'); }} onDone={onBack} />);
        }
        return wrap(
            <>
                <h2 className={styles.successTitle}>List published</h2>
                <p className={styles.summary}>
                    {listType === '2' ? 'Address' : 'Token'} list with {items.length} item{items.length === 1 ? '' : 's'} is on its way.
                    Once it's indexed you can view it from My Lists and reference it from an airdrop, gate, dispenser, or order.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}><code className={styles.txid}>{String(txid || 'n/a')}</code></dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    //  confirm page, rendered in place of the form.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                decoded={decoded}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                // : hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>{decoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>{descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}</dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                    <dt className={styles.detailsLabel}>Type</dt>
                    <dd className={styles.detailsValue}>{listType === '2' ? 'Address list' : 'Token list'}</dd>
                    <dt className={styles.detailsLabel}>Items</dt>
                    <dd className={styles.detailsValue}>{items.length}</dd>
                    <dt className={styles.detailsLabel}>Network fee</dt>
                    <dd className={styles.detailsValue}>
                        {feeEstimate ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}` : 'Estimate unavailable'}
                    </dd>
                </dl>
                {decoded && decoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decoded.warnings.map((w, i) => (<p key={i} className={styles.warning}>{w}</p>))}
                    </div>
                ) : null}
                {isWatcherMode ? (
                    <p className={styles.hint}>Watcher mode: this wallet will build an unsigned transaction. Sign it on your Signer-mode wallet, then broadcast from a Full-mode wallet.</p>
                ) : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => { setPassword(v); if (submitError) setSubmitError(null); }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        submitError={submitError}
                        disabled={stage === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
                {(isWatcherMode || hw) && submitError ? (<div role="alert" className={styles.error}>{submitError}</div>) : null}
                <div className={styles.actions}>
                    <Button type="button" variant="ghost" onClick={() => setStage('form')} disabled={stage === 'submitting'}>
                        Back
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={isWatcherMode ? false : hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        {isWatcherMode ? 'Create unsigned transaction' : hw ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}` : 'Publish list'}
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
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="receive"
                walletId={walletId}
                title="Add a token"
                onSelect={(sel) => {
                    const t = String(sel.tick || '').toUpperCase();
                    if (t) setTicksText((prev) => (prev.trim() ? `${prev}\n${t}` : t));
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    if (contactPickerOpen) {
        return (
            <ContactAddressPickerScreen
                variant={variant}
                messaging={messaging}
                chainCoin={descriptor?.coin}
                onAdd={(addresses) => {
                    setPasteText((prev) => (prev.trim() ? `${prev}\n${addresses.join('\n')}` : addresses.join('\n')));
                    setContactPickerOpen(false);
                }}
                onBack={() => setContactPickerOpen(false)}
            />
        );
    }

    // stage === 'form'
    return wrap(
        <form onSubmit={handleReview} noValidate>
            <NetworkField
                value={chainId}
                onChange={(cid) => { setChainId(cid); setFromAddressId(null); }}
                chainIds={addressesByChain ? Object.keys(addressesByChain) : [chainId]}
                chainRegistry={chainRegistry}
            />
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
                <div role="alert" className={styles.error}>No address on this chain. Use Receive to generate one first.</div>
            )}

            <Select
                label="List type"
                value={listType}
                onChange={(e) => setListType(/** @type {'1' | '2'} */ (e.target.value))}
                hint={listType === '2'
                    ? 'A reusable list of addresses. Used by airdrops, allow/block gates, dispensers, and orders.'
                    : 'A reusable list of tokens. Used for project rosters and allow/block gates.'}
            >
                <option value="2">Addresses</option>
                <option value="1">Tokens</option>
            </Select>

            {listType === '2' ? (
                <>
                    <label
                        className={styles.pickerLabel}
                        {...recipientsDrop.rootProps}
                        data-drop-active={recipientsDrop.isDragOver ? 'true' : 'false'}
                    >
                        Addresses
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
                        <Button type="button" variant="ghost" onClick={() => setContactPickerOpen(true)}>
                            Add from Contacts
                        </Button>
                    </div>
                    {pasteText.trim() ? (
                        <p className={styles.hint}>
                            {recipients.valid.length} valid address{recipients.valid.length === 1 ? '' : 'es'}
                            {recipients.duplicates > 0 ? ` · ${recipients.duplicates} duplicate${recipients.duplicates === 1 ? '' : 's'} removed` : ''}
                            {recipients.invalid.length > 0 ? ` · ${recipients.invalid.length} invalid skipped` : ''}
                        </p>
                    ) : null}
                    {recipients.invalid.length > 0 ? (
                        <div className={styles.hint}>
                            <button type="button" className={styles.back} onClick={() => setShowInvalid((s) => !s)}>
                                {showInvalid ? 'Hide' : 'Show'} {recipients.invalid.length} invalid
                            </button>
                            {showInvalid ? (
                                <ul>{recipients.invalid.map((a, i) => (<li key={i}><code>{a}</code></li>))}</ul>
                            ) : null}
                        </div>
                    ) : null}
                    {/* PC-10: pasted or contact-book addresses become permanent
                        public on-chain data once the list is broadcast. */}
                    <p className={styles.hint}>
                        These addresses become permanent public on-chain data once the list is published. There's no way to edit or delete an address out of a list later; forking (§ Fork &amp; edit) only creates a new list at a new index.
                    </p>
                </>
            ) : (
                <>
                    <label className={styles.pickerLabel} htmlFor="list-tokens">Tokens (one per line)</label>
                    <textarea
                        id="list-tokens"
                        className={styles.picker}
                        value={ticksText}
                        onChange={(e) => setTicksText(e.target.value)}
                        rows={6}
                        spellCheck={false}
                        autoCapitalize="characters"
                        placeholder="TICK1&#10;TICK2"
                    />
                    <div className={styles.fromLine}>
                        <Button type="button" variant="ghost" onClick={() => setTokenPickerOpen(true)}>
                            Add from token picker
                        </Button>
                    </div>
                    {memberTicks.length > 0 ? (
                        <p className={styles.hint}>{memberTicks.length} token{memberTicks.length === 1 ? '' : 's'}</p>
                    ) : null}
                </>
            )}

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
            <p className={styles.hint}>
                A bigger list is a bigger transaction: the network fee rises with the number of items. The exact fee is set when you broadcast.
            </p>

            {formError ? (<div role="alert" className={styles.error}>{formError}</div>) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || items.length === 0 || actionConfirm.composing}
                >
                    {singleEncode ? 'Publish list' : 'Review'}
                </Button>
            </div>
        </form>,
    );
}

/**
 * Small full-screen multi-select picker over the wallet's saved
 * contacts, filtered to entries on the create form's current chain
 * (when known). Appends the checked addresses back to the caller's
 * paste textarea; doesn't attempt Send.jsx's richer autocomplete-while-
 * typing UX, since this is a bulk add-many, not a single-recipient
 * field.
 *
 * @param {object} props
 * @param {'full' | 'compact'} props.variant
 * @param {{ listContacts: () => Promise<any[]> }} props.messaging
 * @param {string} [props.chainCoin]   e.g. 'bitcoin'; unset shows every entry
 * @param {(addresses: string[]) => void} props.onAdd
 * @param {() => void} props.onBack
 */
function ContactAddressPickerScreen({ variant, messaging, chainCoin, onAdd, onBack }) {
    const isFull = variant === 'full';
    const [contacts, setContacts] = useState(/** @type {any[] | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [checked, setChecked] = useState(/** @type {Set<string>} */ (new Set()));

    useEffect(() => {
        let cancelled = false;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setContacts(Array.isArray(rows) ? rows : []); })
            .catch((err) => { if (!cancelled) setLoadError(err?.message || 'Failed to load contacts.'); });
        return () => { cancelled = true; };
    }, [messaging]);

    const rows = useMemo(() => {
        if (!contacts) return [];
        /** @type {{ key: string, name: string, address: string, label: string }[]} */
        const out = [];
        for (const c of contacts) {
            for (const e of (c?.entries || [])) {
                if (!e?.address) continue;
                if (chainCoin && e.chain !== chainCoin) continue;
                out.push({ key: `${c.id}:${e.address}`, name: c.name, address: e.address, label: e.label || '' });
            }
        }
        return out;
    }, [contacts, chainCoin]);

    function toggle(key) {
        setChecked((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }

    const header = <PageHeader onBack={onBack} title="Add from Contacts" />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) return wrap(<div role="alert" className={styles.error}>{loadError}</div>);
    if (!contacts) return wrap(<p className={styles.hint}>Loading contacts…</p>);
    if (rows.length === 0) {
        return wrap(<p className={styles.hint}>No matching contact addresses on this chain.</p>);
    }

    return wrap(
        <>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {rows.map((r) => (
                    <li key={r.key} style={{ padding: 'var(--xc-space-2) 0', borderBottom: '1px solid var(--xc-border)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={checked.has(r.key)} onChange={() => toggle(r.key)} />
                            <span>
                                <strong>{r.name}</strong>{r.label ? ` (${r.label})` : ''}
                                <br />
                                <code>{r.address}</code>
                            </span>
                        </label>
                    </li>
                ))}
            </ul>
            <div className={styles.actions}>
                <Button
                    type="button"
                    variant="primary"
                    block
                    disabled={checked.size === 0}
                    onClick={() => onAdd(rows.filter((r) => checked.has(r.key)).map((r) => r.address))}
                >
                    Add {checked.size || ''} selected
                </Button>
            </div>
        </>,
    );
}
