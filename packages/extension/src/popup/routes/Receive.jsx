import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
    CopyButton,
} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    uri as uriLib,
} from '@xchain-wallet/core';
import {
    getAddressesByChain,
    getNewestAddress,
    generateReceiveAddress,
} from '../messaging.js';
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
    const [chainsByWallet, setChainsByWallet] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [activeChainId, setActiveChainId] = useState(
        /** @type {string | null} */ (null),
    );
    const [address, setAddress] = useState(
        /** @type {any | null} */ (null),
    );
    const [qrDataUrl, setQrDataUrl] = useState(
        /** @type {string | null} */ (null),
    );
    const [loadError, setLoadError] = useState(
        /** @type {string | null} */ (null),
    );

    // Generate-new-address flow (inline password prompt).
    const [genOpen, setGenOpen] = useState(false);
    const [genPassword, setGenPassword] = useState('');
    const [genError, setGenError] = useState(
        /** @type {string | null} */ (null),
    );
    const [genBusy, setGenBusy] = useState(false);
    const genInputRef = useRef(
        /** @type {HTMLInputElement | null} */ (null),
    );

    // Load which chains this wallet has addresses on, pick the first,
    // fetch its newest address.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const byChain = await getAddressesByChain(walletId);
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
    }, [walletId]);

    // When active chain changes (or after a new address is generated),
    // pull the newest address for that chain.
    useEffect(() => {
        if (!activeChainId) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const newest = await getNewestAddress(walletId, activeChainId);
                if (!cancelled) setAddress(newest);
            } catch (err) {
                if (!cancelled) {
                    setLoadError(err?.message || 'Failed to load address.');
                }
            }
        })();
        return () => { cancelled = true; };
    }, [walletId, activeChainId]);

    // Generate a QR whenever the displayed address changes.
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
            .then((dataUrl) => {
                if (!cancelled) setQrDataUrl(dataUrl);
            })
            .catch(() => {
                if (!cancelled) setQrDataUrl(null);
            });
        return () => { cancelled = true; };
    }, [address, activeChainId]);

    const openGen = useCallback(() => {
        setGenOpen(true);
        setGenError(null);
        setGenPassword('');
        // Focus after React paints.
        setTimeout(() => genInputRef.current?.focus(), 0);
    }, []);

    async function handleGenerate(event) {
        event.preventDefault();
        if (!activeChainId || genBusy || genPassword.length === 0) return;
        setGenBusy(true);
        setGenError(null);
        try {
            const fresh = await generateReceiveAddress({
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

    return (
        <Screen
            variant="popup"
            header={
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
            }
        >
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
        </Screen>
    );
}
