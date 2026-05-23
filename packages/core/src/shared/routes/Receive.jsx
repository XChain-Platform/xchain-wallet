import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
    CopyButton,
    MultisigBadge,
 Icon,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    uri as uriLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignerSelectForm } from './SignerSelectForm.jsx';
import styles from './Receive.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Receive view — pick a chain, show the newest persisted HD address as
 * a BIP21-encoded QR, copy-to-clipboard, and optionally derive a fresh
 * next-index address (prompts password, because seed decryption runs
 * Argon2id on each derivation — §26).
 *
 * Chain picker options are filtered to the chains this wallet has at
 * least one address on; a later piece may add "add a chain" when the
 * wallet is ready to grow into a new registry entry.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]   active BIP44 account; when set, scopes addresses + new-receive derivation to that account
 * @param {() => void} [props.onBack]
 */
export function Receive({ walletId, accountId, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [chainsByWallet, setChainsByWallet] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [activeChainId, setActiveChainId] = useState(
        /** @type {string | null} */ (null),
    );
    const [address, setAddress] = useState(/** @type {any | null} */ (null));
    const [qrDataUrl, setQrDataUrl] = useState(/** @type {string | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [genOpen, setGenOpen] = useState(false);
    const [genPassword, setGenPassword] = useState('');
    const [genError, setGenError] = useState(/** @type {string | null} */ (null));
    const [genBusy, setGenBusy] = useState(false);
    // null = software (implicit); string = HW SignerRecord id. SignerSelectForm
    // hides itself when only software is available so the common path
    // stays a single password prompt.
    const [genSignerId, setGenSignerId] = useState(/** @type {string | null} */ (null));
    const genInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // §22 + §42.9 multisig receive integration. When the wallet has a
    // persisted MultisigConfig (Step 17) and the active chain is a
    // valid network for that config, we fetch and surface the
    // multisig output address alongside the regular single-key QR.
    // §56.3 pre-launch Step 4 — multiple multisig configs per wallet.
    // Receive renders one section per config; the QR map keys QR data
    // URLs by config id so each section shows its own QR alongside
    // the badge + cosigner names.
    const [multisigs, setMultisigs] = useState(
        /** @type {Array<{ multisigConfigId: string, address: string, schemeLabel: string, threshold: number, cosignerCount: number, cosignerNames: string[], scheme: string }>} */ ([]),
    );
    const [multisigQrs, setMultisigQrs] = useState(/** @type {Record<string, string>} */ ({}));

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const byChain = await messaging.getAddressesByChain(walletId, accountId);
                if (cancelled) return;
                setChainsByWallet(byChain);
                const firstChain = Object.keys(byChain)[0];
                if (firstChain) {
                    setActiveChainId(firstChain);
                } else {
                    setLoadError('No addresses yet on any chain.');
                }
            } catch (err) {
                if (!cancelled) {
                    setLoadError(err?.message || 'Failed to load addresses.');
                }
            }
        })();
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging]);

    useEffect(() => {
        if (!activeChainId) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const newest = await messaging.getNewestAddress(
                    walletId,
                    activeChainId,
                    accountId,
                );
                if (!cancelled) setAddress(newest);
            } catch (err) {
                if (!cancelled) {
                    setLoadError(err?.message || 'Failed to load address.');
                }
            }
        })();
        return () => { cancelled = true; };
    }, [walletId, accountId, activeChainId, messaging]);

    // Derive the multisig output address whenever chain changes, if
    // this wallet has a MultisigConfig. Failures are non-fatal — we
    // simply don't render the multisig panel (e.g. wallet has no
    // multisig config, or the active chain doesn't match the config's
    // network kind). The single-key flow continues to work either way.
    useEffect(() => {
        if (!activeChainId) {
            setMultisigs([]);
            setMultisigQrs({});
            return undefined;
        }
        let cancelled = false;
        if (typeof messaging.listMultisigReceiveAddresses === 'function') {
            messaging.listMultisigReceiveAddresses({ walletId, chainId: activeChainId })
                .then((list) => {
                    if (cancelled) return;
                    setMultisigs(Array.isArray(list) ? list : []);
                })
                .catch(() => { if (!cancelled) setMultisigs([]); });
        } else if (typeof messaging.getMultisigReceiveAddress === 'function') {
            // Backward compat: shells pinned before pre-launch Step 4
            // ship only the singular helper.
            messaging.getMultisigReceiveAddress({ walletId, chainId: activeChainId })
                .then((rec) => {
                    if (cancelled) return;
                    setMultisigs(rec ? [rec] : []);
                })
                .catch(() => { if (!cancelled) setMultisigs([]); });
        }
        return () => { cancelled = true; };
    }, [walletId, activeChainId, messaging]);

    useEffect(() => {
        if (!multisigs || multisigs.length === 0) {
            setMultisigQrs({});
            return undefined;
        }
        const descriptor = chainRegistry.get(activeChainId ?? '');
        let cancelled = false;
        Promise.all(multisigs.map(async (m) => {
            const uri = descriptor
                ? uriLib.encodeBip21Uri({ scheme: descriptor.uriScheme, address: m.address })
                : m.address;
            try {
                const dataUrl = await QRCode.toDataURL(uri, {
                    errorCorrectionLevel: 'M',
                    margin: 2,
                    width: 200,
                    color: { dark: '#0F172A', light: '#FFFFFF' },
                });
                return [m.multisigConfigId, dataUrl];
            } catch {
                return [m.multisigConfigId, null];
            }
        })).then((entries) => {
            if (cancelled) return;
            const next = {};
            for (const [id, url] of entries) if (url) next[id] = url;
            setMultisigQrs(next);
        });
        return () => { cancelled = true; };
    }, [multisigs, activeChainId]);

    useEffect(() => {
        if (!address) {
            setQrDataUrl(null);
            return undefined;
        }
        const descriptor = chainRegistry.get(activeChainId ?? '');
        const uri = descriptor
            ? uriLib.encodeBip21Uri({
                scheme: descriptor.uriScheme,
                address: address.address,
            })
            : address.address;
        let cancelled = false;
        QRCode.toDataURL(uri, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 200,
            color: { dark: '#0F172A', light: '#FFFFFF' },
        })
            .then((dataUrl) => { if (!cancelled) setQrDataUrl(dataUrl); })
            .catch(() => { if (!cancelled) setQrDataUrl(null); });
        return () => { cancelled = true; };
    }, [address, activeChainId]);

    const openGen = useCallback(() => {
        setGenOpen(true);
        setGenError(null);
        setGenPassword('');
        setTimeout(() => genInputRef.current?.focus(), 0);
    }, []);

    // HW signer path skips the password prompt — the device confirms
    // derivation locally. Software path requires the password to re-run
    // Argon2id KDF on the encrypted seed.
    const usingHwSigner = genSignerId !== null;
    const canDerive = activeChainId
        && !genBusy
        && (usingHwSigner || genPassword.length > 0);

    async function handleGenerate(event) {
        event.preventDefault();
        if (!canDerive) return;
        setGenBusy(true);
        setGenError(null);
        try {
            const req = {
                walletId,
                accountId,
                chainId: activeChainId,
                signerId: genSignerId || undefined,
            };
            if (!usingHwSigner) req.password = genPassword;
            const fresh = await messaging.generateReceiveAddress(req);
            setAddress(fresh);
            setGenOpen(false);
            setGenPassword('');
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            setGenError(bad ? 'Incorrect password.' : err?.message || 'Failed to derive.');
            if (!usingHwSigner) {
                genInputRef.current?.focus();
                genInputRef.current?.select();
            }
        } finally {
            setGenBusy(false);
        }
    }

    const availableChainIds = chainsByWallet ? Object.keys(chainsByWallet) : [];
    const descriptor = activeChainId ? chainRegistry.get(activeChainId) : null;

    // §29.10 Request payment sub-form. Renders a BIP21 URI with the
    // user-specified amount / ticker / memo / expiry as a second QR
    // alongside the bare-address QR above.
    const [reqOpen, setReqOpen] = useState(false);
    const [reqAmount, setReqAmount] = useState('');
    const [reqTick, setReqTick] = useState('');
    const [reqMemo, setReqMemo] = useState('');
    const [reqExpiryMinutes, setReqExpiryMinutes] = useState('');
    const [reqQrDataUrl, setReqQrDataUrl] = useState(/** @type {string | null} */ (null));
    const [shareStatus, setShareStatus] = useState(/** @type {string | null} */ (null));

    const requestUri = useMemo(() => {
        if (!address || !descriptor) return null;
        const params = {};
        if (reqTick.trim()) params.tick = reqTick.trim().toUpperCase();
        if (reqExpiryMinutes.trim()) {
            const minutes = parseInt(reqExpiryMinutes.trim(), 10);
            if (Number.isFinite(minutes) && minutes > 0) {
                const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
                params.expiry = expiresAt;
            }
        }
        return uriLib.encodeBip21Uri({
            scheme: descriptor.uriScheme,
            address: address.address,
            amount: reqAmount.trim() || undefined,
            message: reqMemo.trim() || undefined,
            params,
        });
    }, [address, descriptor, reqAmount, reqTick, reqMemo, reqExpiryMinutes]);

    useEffect(() => {
        if (!reqOpen || !requestUri) {
            setReqQrDataUrl(null);
            return undefined;
        }
        let cancelled = false;
        QRCode.toDataURL(requestUri, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 200,
            color: { dark: '#0F172A', light: '#FFFFFF' },
        })
            .then((dataUrl) => { if (!cancelled) setReqQrDataUrl(dataUrl); })
            .catch(() => { if (!cancelled) setReqQrDataUrl(null); });
        return () => { cancelled = true; };
    }, [reqOpen, requestUri]);

    // §29.7 Share button. Uses Web Share API when available; falls
    // back to clipboard. Surfaces inline status (no toast system in
    // core yet — §37.2 adds the host).
    const onShare = useCallback(async (uri) => {
        if (!uri) return;
        setShareStatus(null);
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            try {
                await navigator.share({
                    title: 'Payment request',
                    text: `Pay ${reqAmount.trim() || ''} ${reqTick.trim() || (descriptor?.coin?.toUpperCase() || '')}`.trim(),
                    url: uri,
                });
                setShareStatus('Shared.');
                return;
            } catch (err) {
                // User cancelled or share failed; fall through to clipboard.
            }
        }
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(uri);
                setShareStatus('Copied to clipboard.');
                return;
            }
        } catch {
            // ignore — surfaced via fallback message
        }
        setShareStatus('Share unavailable — copy the link manually.');
    }, [reqAmount, reqTick, descriptor]);

        const header = (
        <ScreenHeader
            onBack={onBack}
            backLabel="Back to home"
            title="Receive"
        />
    );
    const body = (
        <>
            {loadError ? (
                <div role="alert" className={styles.error}>{loadError}</div>
            ) : null}

            {availableChainIds.length > 1 ? (
                <label className={styles.pickerLabel}>
                    Chain
                    <select
                        className={styles.picker}
                        value={activeChainId ?? ''}
                        onChange={(e) => setActiveChainId(e.target.value)}
                    >
                        {availableChainIds.map((cid) => {
                            const d = chainRegistry.get(cid);
                            return (
                                <option key={cid} value={cid}>
                                    {d ? `${d.displayName} (${d.networkKind})` : cid}
                                </option>
                            );
                        })}
                    </select>
                </label>
            ) : descriptor ? (
                <div className={styles.singleChain}>
                    <ChainBadge descriptor={descriptor} size="md" />
                </div>
            ) : null}

            {address && qrDataUrl ? (
                <div className={styles.qrBox}>
                    <img
                        src={qrDataUrl}
                        alt={`QR code for ${address.address}`}
                        width={200}
                        height={200}
                        className={styles.qr}
                    />
                </div>
            ) : address ? (
                <div className={styles.qrBox} aria-hidden="true">
                    <div className={styles.qrPlaceholder}>Rendering QR…</div>
                </div>
            ) : null}

            {address ? (
                <div className={styles.addressBox}>
                    <AddressText address={address.address} truncate={false} size="sm" />
                    <CopyButton value={address.address} />
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onShare(uriLib.encodeBip21Uri({
                            scheme: descriptor?.uriScheme || 'bitcoin',
                            address: address.address,
                        }))}
                        disabled={!descriptor}
                    >
                        Share
                    </Button>
                </div>
            ) : !loadError ? (
                <p className={styles.hint}>Loading address…</p>
            ) : null}

            {address ? (
                <section className={styles.requestPanel}>
                    <button
                        type="button"
                        className={styles.requestToggle}
                        onClick={() => setReqOpen((o) => !o)}
                        aria-expanded={reqOpen}
                    >
                        {reqOpen ? '− Request payment' : '+ Request payment'}
                    </button>
                    {reqOpen ? (
                        <div className={styles.requestForm}>
                            <Input
                                label={`Amount (${descriptor?.coin?.toUpperCase() || 'coin'})`}
                                inputMode="decimal"
                                value={reqAmount}
                                onChange={(e) => setReqAmount(e.target.value)}
                                placeholder="0.001"
                                autoComplete="off"
                            />
                            <Input
                                label="Token tick"
                                hint={`Defaults to ${descriptor?.coin?.toUpperCase() || 'native coin'}.`}
                                value={reqTick}
                                onChange={(e) => setReqTick(e.target.value)}
                                placeholder={descriptor?.coin?.toUpperCase() || ''}
                                autoComplete="off"
                                autoCapitalize="characters"
                            />
                            <Input
                                label="Memo (optional)"
                                value={reqMemo}
                                onChange={(e) => setReqMemo(e.target.value)}
                                autoComplete="off"
                            />
                            <Input
                                label="Expiry (minutes, optional)"
                                inputMode="numeric"
                                value={reqExpiryMinutes}
                                onChange={(e) => setReqExpiryMinutes(e.target.value)}
                                hint="Adds an `expiry` ISO timestamp to the URI."
                                autoComplete="off"
                            />
                            {requestUri ? (
                                <>
                                    {reqQrDataUrl ? (
                                        <div className={styles.qrBox}>
                                            <img
                                                src={reqQrDataUrl}
                                                alt="Payment request QR"
                                                width={200}
                                                height={200}
                                                className={styles.qr}
                                            />
                                        </div>
                                    ) : (
                                        <div className={styles.qrBox} aria-hidden="true">
                                            <div className={styles.qrPlaceholder}>Rendering QR…</div>
                                        </div>
                                    )}
                                    <code className={styles.requestUri}>{requestUri}</code>
                                    <div className={styles.requestActions}>
                                        <CopyButton value={requestUri} />
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => onShare(requestUri)}
                                        >
                                            Share
                                        </Button>
                                    </div>
                                </>
                            ) : null}
                            {shareStatus ? (
                                <p className={styles.hint} role="status">{shareStatus}</p>
                            ) : null}
                        </div>
                    ) : null}
                </section>
            ) : null}

            {multisigs.map((multisig) => (
                <section
                    key={multisig.multisigConfigId}
                    role="group"
                    aria-label="Multisig receive address"
                    style={{
                        marginTop: 'var(--xc-space-3)',
                        padding: 'var(--xc-space-3)',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-md)',
                        background: 'var(--xc-bg-muted)',
                    }}
                >
                    <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)', marginBottom: 'var(--xc-space-2)' }}>
                        <MultisigBadge
                            threshold={multisig.threshold}
                            cosignerCount={multisig.cosignerCount}
                            scheme={multisig.scheme}
                        />
                        <strong>{multisig.schemeLabel}</strong>
                    </header>
                    {multisigQrs[multisig.multisigConfigId] ? (
                        <div className={styles.qrBox}>
                            <img
                                src={multisigQrs[multisig.multisigConfigId]}
                                alt={`Multisig QR code for ${multisig.address}`}
                                width={200}
                                height={200}
                                className={styles.qr}
                            />
                        </div>
                    ) : (
                        <div className={styles.qrBox} aria-hidden="true">
                            <div className={styles.qrPlaceholder}>Rendering multisig QR…</div>
                        </div>
                    )}
                    <div className={styles.addressBox}>
                        <AddressText address={multisig.address} truncate={false} size="sm" />
                        <CopyButton value={multisig.address} />
                    </div>
                    {multisig.cosignerNames?.length > 0 ? (
                        <p className={styles.hint} style={{ marginTop: 'var(--xc-space-2)' }}>
                            Cosigners: {multisig.cosignerNames.join(' · ')}
                        </p>
                    ) : null}
                </section>
            ))}

            {genOpen ? (
                <form onSubmit={handleGenerate} className={styles.genForm}>
                    <SignerSelectForm
                        walletId={walletId}
                        value={genSignerId}
                        onChange={setGenSignerId}
                        disabled={genBusy}
                    />
                    {usingHwSigner ? (
                        <p className={styles.hint}>
                            Confirm the new address on your device when prompted.
                        </p>
                    ) : (
                        <Input
                            ref={genInputRef}
                            type="password"
                            label="Password"
                            hint="Deriving a new address re-runs the Argon2id KDF."
                            value={genPassword}
                            onChange={(e) => {
                                setGenPassword(e.target.value);
                                if (genError) setGenError(null);
                            }}
                            autoComplete="current-password"
                            disabled={genBusy}
                            error={genError || undefined}
                        />
                    )}
                    {usingHwSigner && genError ? (
                        <p className={styles.error} role="alert">{genError}</p>
                    ) : null}
                    <div className={styles.genButtons}>
                        <Button
                            type="submit"
                            variant="primary"
                            size="sm"
                            loading={genBusy}
                            disabled={!canDerive}
                        >
                            Derive
                        </Button>
                    </div>
                </form>
            ) : (
                <div className={styles.actions}>
                    <Button
                        variant="secondary"
                        block
                        onClick={openGen}
                        disabled={!activeChainId}
                    >
                        New address
                    </Button>
                </div>
            )}
        </>
    );

    return (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{body}</div> : body}
        </Screen>
    );
}
