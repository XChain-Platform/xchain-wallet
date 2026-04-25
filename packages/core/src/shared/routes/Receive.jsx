import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
    CopyButton,
    MultisigBadge,
} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    uri as uriLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
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
 * @param {() => void} [props.onBack]
 */
export function Receive({ walletId, onBack }) {
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
    const genInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // §22 + §42.9 multisig receive integration. When the wallet has a
    // persisted MultisigConfig (Step 17) and the active chain is a
    // valid network for that config, we fetch and surface the
    // multisig output address alongside the regular single-key QR.
    const [multisig, setMultisig] = useState(
        /** @type {null | { address: string, schemeLabel: string, threshold: number, cosignerCount: number, cosignerNames: string[], scheme: string }} */ (null),
    );
    const [multisigQr, setMultisigQr] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const byChain = await messaging.getAddressesByChain(walletId);
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
    }, [walletId, messaging]);

    useEffect(() => {
        if (!activeChainId) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const newest = await messaging.getNewestAddress(
                    walletId,
                    activeChainId,
                );
                if (!cancelled) setAddress(newest);
            } catch (err) {
                if (!cancelled) {
                    setLoadError(err?.message || 'Failed to load address.');
                }
            }
        })();
        return () => { cancelled = true; };
    }, [walletId, activeChainId, messaging]);

    // Derive the multisig output address whenever chain changes, if
    // this wallet has a MultisigConfig. Failures are non-fatal — we
    // simply don't render the multisig panel (e.g. wallet has no
    // multisig config, or the active chain doesn't match the config's
    // network kind). The single-key flow continues to work either way.
    useEffect(() => {
        if (!activeChainId) {
            setMultisig(null);
            setMultisigQr(null);
            return undefined;
        }
        if (typeof messaging.getMultisigReceiveAddress !== 'function') {
            // Older shell pin without the multisig helper — keep
            // backward compat by silently skipping the panel.
            return undefined;
        }
        let cancelled = false;
        messaging.getMultisigReceiveAddress({ walletId, chainId: activeChainId })
            .then((rec) => {
                if (cancelled) return;
                setMultisig(rec || null);
            })
            .catch(() => {
                if (cancelled) return;
                setMultisig(null);
            });
        return () => { cancelled = true; };
    }, [walletId, activeChainId, messaging]);

    useEffect(() => {
        if (!multisig) {
            setMultisigQr(null);
            return undefined;
        }
        const descriptor = chainRegistry.get(activeChainId ?? '');
        const uri = descriptor
            ? uriLib.encodeBip21Uri({
                scheme: descriptor.uriScheme,
                address: multisig.address,
            })
            : multisig.address;
        let cancelled = false;
        QRCode.toDataURL(uri, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 200,
            color: { dark: '#0F172A', light: '#FFFFFF' },
        })
            .then((dataUrl) => { if (!cancelled) setMultisigQr(dataUrl); })
            .catch(() => { if (!cancelled) setMultisigQr(null); });
        return () => { cancelled = true; };
    }, [multisig, activeChainId]);

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

    async function handleGenerate(event) {
        event.preventDefault();
        if (!activeChainId || genBusy || genPassword.length === 0) return;
        setGenBusy(true);
        setGenError(null);
        try {
            const fresh = await messaging.generateReceiveAddress({
                walletId,
                chainId: activeChainId,
                password: genPassword,
            });
            setAddress(fresh);
            setGenOpen(false);
            setGenPassword('');
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            setGenError(bad ? 'Incorrect password.' : err?.message || 'Failed to derive.');
            genInputRef.current?.focus();
            genInputRef.current?.select();
        } finally {
            setGenBusy(false);
        }
    }

    const availableChainIds = chainsByWallet ? Object.keys(chainsByWallet) : [];
    const descriptor = activeChainId ? chainRegistry.get(activeChainId) : null;

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back to home"
            >
                ← Back
            </button>
            <span className={styles.title}>Receive</span>
            <span className={styles.spacer} />
        </div>
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
                </div>
            ) : !loadError ? (
                <p className={styles.hint}>Loading address…</p>
            ) : null}

            {multisig ? (
                <section
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
                    {multisigQr ? (
                        <div className={styles.qrBox}>
                            <img
                                src={multisigQr}
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
            ) : null}

            {genOpen ? (
                <form onSubmit={handleGenerate} className={styles.genForm}>
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
                    <div className={styles.genButtons}>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => { setGenOpen(false); setGenError(null); }}
                            disabled={genBusy}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            size="sm"
                            loading={genBusy}
                            disabled={genPassword.length === 0}
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
