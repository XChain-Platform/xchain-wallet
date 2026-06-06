// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
 ChainPicker,  Icon,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { LockedTokenContext } from '../components/LockedTokenContext.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Token admin surfaces — §40.5.
 *
 * Three thin one-field forms on top of the ISSUE mechanism, selected
 * via `mode`:
 *
 *   - `'lock'`        — permanently locks supply + minting
 *                       (ISSUE v3 with LOCK_MAX_SUPPLY + LOCK_MINT).
 *   - `'description'` — updates the on-chain DESCRIPTION
 *                       (ISSUE v1 with a single DESCRIPTION field).
 *   - `'transfer'`    — transfers token ownership to another address
 *                       (ISSUE v0 with the TRANSFER field set).
 *
 * Until the Token detail page (§40.5 home) exists, the ticker is
 * user-entered. Future prop: `initialTicker` so Token detail can
 * prefill. All three modes use `messaging.issueToken` — no new
 * background handlers or core flows.
 *
 * @typedef {'lock' | 'description' | 'transfer'} AdminMode
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {AdminMode} props.mode
 * @param {() => void} props.onBack
 */
export function TokenAdminForm({ walletId, mode, onBack, initialChainId, initialTick, initialFromAddress }) {
    const { messaging, shell } = useMessaging();
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
    const [password, setPassword] = useState('');
    // Lock-mode typed-confirmation gate. Locking is irreversible, so
    // the review stage requires the user to type LOCK before the Sign
    // button enables (on top of the existing password / HW gate).
    const [typedConfirm, setTypedConfirm] = useState('');
    const typedConfirmOk = typedConfirm.trim().toUpperCase() === 'LOCK';

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
            (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
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

    const actionParams = useMemo(
        () => composeAdminParams(mode, {
            ticker,
            description,
            transferTo,
        }),
        [mode, ticker, description, transferTo],
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
        setFormError(null);
        setStage('review');
    }

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5 — watcher-mode encode-only branch.
    // Token admin uses the ISSUE action with admin-only field combinations.
    const { isWatcherMode } = useWalletMode();

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !isHwSource && password.length === 0) return;
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
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'ISSUE', params: actionParams },
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

    const titleSuffix = descriptor ? ` on ${descriptor.displayName}` : '';
        const header = (
        <ScreenHeader
            onBack={onBack}
            title="{stage === 'review' || stage === 'submitting'
                    ? `Review ${MODE_LABEL_LOWER[mode]}`
                    : `${MODE_LABEL[mode]}${titleSuffix}`}"
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
                        Watcher mode — this wallet will build an unsigned transaction.
                        Sign it on your Signer-mode wallet, then bring the
                        signed transaction to a Full-mode wallet to broadcast.
                    </p>
                ) : (
                    <SignCredentials
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
                        hint="Locking is permanent — supply and minting freeze forever."
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
                                        : password.length === 0
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

    return wrap(
        <form onSubmit={handleReview} noValidate>
            {mode === 'lock' ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        <strong>Locking is permanent.</strong> Once locked, the token's supply and minting are frozen forever.
                    </p>
                </div>
            ) : null}

            {lockedToken && chainId ? (
                <LockedTokenContext chainId={chainId} tick={ticker} />
            ) : (
                <>
                    {chainsWithAddresses.length > 1 ? (
                        <ChainPicker label="Chain" value={chainId} onChange={setChainId} chainIds={chainsWithAddresses} chainRegistry={chainRegistry} />
                    ) : descriptor ? (
                        <div className={styles.chainLine}>
                            <ChainBadge descriptor={descriptor} size="sm" />
                        </div>
                    ) : null}
                </>
            )}

            {fromAddress ? (
                <div className={styles.fromLine}>
                    <span className={styles.fromLabel}>Fee paid by</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}

            {lockedToken ? null : (
                <Input
                    label="Ticker"
                    hint="The token you own. Uppercase."
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value.toUpperCase())}
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
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
                <Input
                    label="New owner address"
                    hint="The address that will receive ownership."
                    value={transferTo}
                    onChange={(e) => setTransferTo(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                />
            ) : null}

            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || !ticker
                        || (mode === 'description' && !description)
                        || (mode === 'transfer' && !transferTo)}
                >
                    Preview
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
 * - **lock**: ISSUE v3 with LOCK_MAX_SUPPLY + LOCK_MINT — "pure lock"
 *   on an existing token. Decoded as "Lock TICK max supply, minting…".
 * - **description**: ISSUE v1 with only DESCRIPTION set — decoded as
 *   "Update description of TICK…".
 * - **transfer**: ISSUE v0 with only TRANSFER set — decoded as
 *   "Transfer ownership of TICK to ADDR…".
 */
function composeAdminParams(mode, form) {
    const TICK = (form.ticker || '').trim().toUpperCase();
    if (mode === 'lock') {
        return {
            VERSION: '3',
            TICK,
            LOCK_MAX_SUPPLY: '1',
            LOCK_MINT: '1',
        };
    }
    if (mode === 'description') {
        return {
            VERSION: '1',
            TICK,
            DESCRIPTION: (form.description || '').trim(),
        };
    }
    // mode === 'transfer'
    return {
        VERSION: '0',
        TICK,
        TRANSFER: (form.transferTo || '').trim(),
    };
}

const MODE_LABEL = {
    lock: 'Lock supply',
    description: 'Update description',
    transfer: 'Transfer ownership',
};

const MODE_LABEL_LOWER = {
    lock: 'lock',
    description: 'description update',
    transfer: 'ownership transfer',
};

const MODE_DONE_TITLE = {
    lock: 'Locked',
    description: 'Description updated',
    transfer: 'Ownership transferred',
};

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}
