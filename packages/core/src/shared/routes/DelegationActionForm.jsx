import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
 Icon,} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * DELEGATE + REVOKE_DELEGATION combined form — §42.7.2 delegation-lane.
 *
 * One component, two modes via the `mode` prop. Both actions share a
 * chassis (address load / SignCredentials / HW branch / review / done)
 * and a 64-hex Ed25519 pubkey input; they diverge only in field name
 * (`NEW_SIGNING_PUBKEY` vs `SIGNING_PUBKEY`), which messaging helper
 * is called, and the verb rendered on the submit button.
 *
 *   - `mode: 'delegate'` — VERSION|NEW_SIGNING_PUBKEY. Points
 *     hub-signing authority at a fresh key without touching the
 *     stake amount. The form asks for a pubkey and explains it
 *     replaces any currently-active delegation.
 *   - `mode: 'revoke'` — VERSION|SIGNING_PUBKEY. Removes a
 *     previously-delegated key. The form pre-loads current
 *     delegations for the source address (via
 *     `messaging.getDelegationsForAddress`) and pre-fills the most
 *     recent pubkey; the user can override to revoke a specific key.
 *
 * @param {object} props
 * @param {'delegate' | 'revoke'} props.mode
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {() => void} props.onBack
 */
export function DelegationActionForm({ mode, walletId, chainId, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const isDelegate = mode === 'delegate';
    const verb = isDelegate ? 'Delegate signing key' : 'Revoke delegation';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [pubkey, setPubkey] = useState('');
    const [password, setPassword] = useState('');

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
                setAddressesByChain(byChain || {});
                const addrs = (byChain?.[chainId] || []).filter(
                    (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
                );
                if (addrs.length === 0) {
                    setLoadError('No address on this chain. Use Receive to generate one first.');
                    return;
                }
                const sorted = [...addrs].sort((a, b) => {
                    const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                    const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                    return bi - ai;
                });
                setFromAddressId(sorted[0].id);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    // Revoke mode: pre-populate the pubkey input with the most recent
    // active delegation for the source address. The user can still
    // override — they might want to revoke an older key.
    useEffect(() => {
        if (isDelegate) return;
        if (!fromAddressId || !addressesByChain) return;
        const addr = (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId);
        if (!addr) return;
        let cancelled = false;
        messaging.getDelegationsForAddress({ chainId, address: addr.address })
            .then((resp) => {
                if (cancelled) return;
                const rows = extractRows(resp);
                rows.sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0));
                const latest = rows[0];
                const pk = latest?.signing_pubkey || latest?.SIGNING_PUBKEY;
                if (pk && typeof pk === 'string' && /^[0-9a-fA-F]{64}$/.test(pk)) {
                    setPubkey(pk.toLowerCase());
                }
            })
            .catch(() => { /* user will paste manually */ });
        return () => { cancelled = true; };
    }, [isDelegate, fromAddressId, addressesByChain, chainId, messaging]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const descriptor = chainRegistry.get(chainId);
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    const actionParams = useMemo(() => {
        const pk = pubkey.trim().toLowerCase();
        if (isDelegate) return { VERSION: '0', NEW_SIGNING_PUBKEY: pk };
        return { VERSION: '0', SIGNING_PUBKEY: pk };
    }, [isDelegate, pubkey]);

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) {
            setFormError('No source address available.');
            return;
        }
        const pk = pubkey.trim();
        if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
            setFormError('Signing pubkey must be exactly 64 hex characters (Ed25519 public key).');
            return;
        }
        setFormError(null);
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isHwSource && password.length === 0) return;
        if (isHwSource && hwStatus !== 'available') return;
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
            const fn = isDelegate
                ? (isHwSource ? messaging.delegateActionHw : messaging.delegateAction)
                : (isHwSource ? messaging.revokeDelegationActionHw : messaging.revokeDelegationAction);
            const args = isHwSource
                ? { ...base, signerId: fromAddress.signerId }
                : { ...base, password };
            const res = await fn(args);
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword ? 'Incorrect password.' : err?.message || (verb + ' failed.'),
            );
            setStage('review');
            if (!isHwSource) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back"
            >
                <Icon.BackIcon />
            </button>
            <span className={styles.title}>
                {stage === 'review' || stage === 'submitting'
                    ? `Review ${verb.toLowerCase()}`
                    : verb}
            </span>
            <span className={styles.spacer} />
        </div>
    );

    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (loadError) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{loadError}</div>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }
    if (!addressesByChain) return wrap(<p>Loading addresses…</p>);

    if (stage === 'done' && result) {
        return wrap(
            <>
                <p className={styles.summary}>
                    {isDelegate
                        ? 'Delegation broadcast. The new signing key becomes active after the indexer processes the action.'
                        : 'Revocation broadcast. The signing key will stop authorizing hub PBFT votes once the indexer processes the action.'}
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}>{String(result?.txid || result?.tx_hash || '—')}</dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const shownPubkey = actionParams.NEW_SIGNING_PUBKEY || actionParams.SIGNING_PUBKEY;
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    {isDelegate
                        ? `Delegate hub-signing authority to ${shownPubkey.slice(0, 12)}…`
                        : `Revoke the delegated signing key ${shownPubkey.slice(0, 12)}…`}
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>
                        {isDelegate ? 'New signing pubkey' : 'Signing pubkey'}
                    </dt>
                    <dd className={styles.detailsValue} style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {shownPubkey}
                    </dd>
                </dl>
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
                />
                {isHwSource && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={isHwSource ? hwStatus !== 'available' : password.length === 0}
                    >
                        {isHwSource
                            ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : verb}
                    </Button>
                </div>
            </form>,
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <div className={styles.chainLine}>
                {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
            </div>
            {fromAddress ? (
                <div className={styles.fromLine}>
                    <span className={styles.fromLabel}>
                        {isDelegate ? 'Delegating from' : 'Revoking for'}
                    </span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : null}

            <Input
                label={isDelegate ? 'New signing pubkey' : 'Signing pubkey to revoke'}
                hint={isDelegate
                    ? '64-character hex-encoded Ed25519 public key. Replaces any currently-active delegation for this address.'
                    : '64-character hex-encoded Ed25519 public key. Pre-filled with your most recent active delegation — override to revoke a specific older key.'}
                value={pubkey}
                onChange={(e) => setPubkey(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
            />

            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || !pubkey.trim()}
                >
                    Preview
                </Button>
            </div>
        </form>,
    );
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}
