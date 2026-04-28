// PsbtSignForm — §30.4 / G088 (closes paired G042).
//
// User-initiated PSBT paste-in. Mirrors SignMessageForm's structure but
// the input is an opaque PSBT (hex / base64) instead of a string.
// Workflow:
//
//   1. User pastes PSBT, picks chain + signing address, types password.
//   2. Form normalizes the input to hex (base64 prefix `cHNid` is auto-
//      converted) and round-trips through `messaging.parsePsbtRequest`
//      so we can show inputs / outputs / fee before any auth happens.
//   3. On Sign, `messaging.signPsbtUserInitiated` is called; background
//      decomposes the PSBT, matches inputs by address, builds
//      `signingPaths`, and runs `signPsbtFlow`.
//   4. Result page exposes the signed PSBT hex with a Copy button —
//      enough to round-trip into Sparrow / Specter / Coldcard. A
//      Broadcast affordance is queued for §20 follow-up.
//
// Out of scope for the V1 paste-in (tracked in FOLLOWUPS.md):
//   - QR scan (§20.4 — uses the same animated-QR transport)
//   - .psbt file drop / file picker
//   - HW signing path (Software signers only at v0.164.0)
//   - Multi-signer aware preview when the PSBT carries inputs the
//     wallet doesn't own — current preview shows them but the sign
//     attempt only covers wallet-owned inputs.

import { useEffect, useMemo, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
    ChainPicker,
    CopyButton,
    Icon,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDropZone } from '../hooks/useDropZone.js';
import pickerStyles from './WalletPicker.module.css';
import styles from './IssueTokenForm.module.css';

function arrayBufferToHex(buf) {
    const view = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < view.length; i += 1) {
        hex += view[i].toString(16).padStart(2, '0');
    }
    return hex;
}

const chainRegistry = registryLib.defaultRegistry();

const HEX_RE = /^[0-9a-fA-F]+$/;
// Base64-encoded PSBT magic bytes (`psbt` + 0xff) start with `cHNid` —
// reliable signal that an opaque blob is a base64 PSBT rather than hex.
const BASE64_PSBT_PREFIX = 'cHNid';

/**
 * Convert a pasted blob to a normalized hex PSBT. Returns `null` if the
 * input doesn't look like either a hex or a base64-encoded PSBT.
 *
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizePsbtInput(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim().replace(/\s+/g, '');
    if (trimmed.length === 0) return null;
    if (HEX_RE.test(trimmed) && trimmed.length % 2 === 0) {
        return trimmed.toLowerCase();
    }
    if (trimmed.startsWith(BASE64_PSBT_PREFIX)) {
        try {
            const bin = atob(trimmed);
            let hex = '';
            for (let i = 0; i < bin.length; i += 1) {
                hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
            }
            return hex;
        } catch (_err) {
            return null;
        }
    }
    return null;
}

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function PsbtSignForm({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [addressId, setAddressId] = useState(/** @type {string | null} */ (null));
    const [pasted, setPasted] = useState('');
    const [password, setPassword] = useState('');

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [parseError, setParseError] = useState(/** @type {string | null} */ (null));
    const [parsing, setParsing] = useState(false);
    const [decomposed, setDecomposed] = useState(
        /** @type {import('../../signers/types').DecomposedPsbt | null} */ (null),
    );
    const [signedPsbtHex, setSignedPsbtHex] = useState(
        /** @type {string | null} */ (null),
    );

    const psbtHex = useMemo(() => normalizePsbtInput(pasted), [pasted]);

    // .psbt file drop / picker — binary blobs are read as ArrayBuffer and
    // converted to hex before being routed through the same paste pipeline.
    const drop = useDropZone({
        accept: ['.psbt', 'application/octet-stream', 'text/plain'],
        readAs: 'arrayBuffer',
        onError: setError,
        disabled: busy,
        onFile: ({ content }) => {
            try {
                const hex = arrayBufferToHex(content);
                setPasted(hex);
                if (error) setError(null);
            } catch (_e) {
                setError('Could not decode the dropped PSBT file.');
            }
        },
    });

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before signing.',
                    );
                    return;
                }
                setChainId(first);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Default to the newest address on the active chain.
    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        const addrs = addressesByChain[chainId] || [];
        if (addrs.length === 0) {
            setAddressId(null);
            return;
        }
        const sorted = [...addrs].sort((a, b) => {
            const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
            const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
            return bi - ai;
        });
        setAddressId(sorted[0].id);
    }, [chainId, addressesByChain]);

    // Re-parse whenever the user pastes a fresh blob OR switches chains
    // — same PSBT under a different chain's SDK can produce different
    // address attribution (e.g. testnet vs mainnet).
    useEffect(() => {
        if (!psbtHex || !chainId) {
            setDecomposed(null);
            setParseError(null);
            return undefined;
        }
        if (typeof messaging.parsePsbtRequest !== 'function') {
            setParseError('messaging.parsePsbtRequest is not available in this shell.');
            return undefined;
        }
        let cancelled = false;
        setParsing(true);
        setParseError(null);
        messaging.parsePsbtRequest({ chainId, psbtHex })
            .then((res) => {
                if (cancelled) return;
                setDecomposed(res?.decomposed || null);
            })
            .catch((err) => {
                if (cancelled) return;
                setDecomposed(null);
                setParseError(err?.message || 'Failed to parse PSBT.');
            })
            .finally(() => { if (!cancelled) setParsing(false); });
        return () => { cancelled = true; };
    }, [psbtHex, chainId, messaging]);

    const chainOptions = useMemo(() => {
        if (!addressesByChain) return [];
        return Object.keys(addressesByChain)
            .filter((id) => (addressesByChain[id] || []).length > 0)
            .map((id) => {
                const desc = chainRegistry.get(id);
                return { id, label: desc?.displayName || id };
            });
    }, [addressesByChain]);

    const addressOptions = useMemo(() => {
        if (!chainId || !addressesByChain) return [];
        return addressesByChain[chainId] || [];
    }, [chainId, addressesByChain]);

    const selectedAddress = useMemo(
        () => addressOptions.find((a) => a.id === addressId) || null,
        [addressOptions, addressId],
    );

    // How many of the parsed PSBT's inputs match the chosen signer? The
    // sign attempt will cover exactly these — the rest stay unsigned for
    // a downstream cosigner.
    const ownedInputCount = useMemo(() => {
        if (!decomposed || !selectedAddress) return 0;
        let n = 0;
        for (const inp of decomposed.inputs) {
            if (inp.address === selectedAddress.address) n += 1;
        }
        return n;
    }, [decomposed, selectedAddress]);

    const totalIn = useMemo(() => {
        if (!decomposed) return 0;
        return decomposed.inputs.reduce((acc, inp) => acc + (inp.value || 0), 0);
    }, [decomposed]);
    const totalOut = useMemo(() => {
        if (!decomposed) return 0;
        return decomposed.outputs.reduce((acc, o) => acc + (o.value || 0), 0);
    }, [decomposed]);
    const fee = totalIn - totalOut;

    async function handleSubmit(event) {
        event.preventDefault();
        if (busy) return;
        setError(null);
        if (!chainId) { setError('Pick a chain.'); return; }
        if (!addressId) { setError('Pick a signing address.'); return; }
        if (!psbtHex) { setError('Paste a valid PSBT (hex or base64).'); return; }
        if (!decomposed) { setError('PSBT could not be parsed for this chain.'); return; }
        if (ownedInputCount === 0) {
            setError(
                `The chosen address signs none of this PSBT's inputs. Pick a different address or PSBT.`,
            );
            return;
        }
        if (password.length === 0) { setError('Enter your wallet password.'); return; }
        if (typeof messaging.signPsbtUserInitiated !== 'function') {
            setError('messaging.signPsbtUserInitiated is not available in this shell.');
            return;
        }
        setBusy(true);
        try {
            const result = await messaging.signPsbtUserInitiated({
                walletId,
                addressId,
                password,
                psbtHex,
            });
            setSignedPsbtHex(result?.signedPsbtHex || '');
            setPassword('');
        } catch (err) {
            setError(
                err?.name === 'InvalidPasswordError'
                    ? 'Incorrect password.'
                    : err?.message || 'Signing failed.',
            );
        } finally {
            setBusy(false);
        }
    }

    const header = (
        <div className={pickerStyles.header}>
            <button
                type="button"
                onClick={onBack}
                className={pickerStyles.iconBtn}
                aria-label="Back"
                title="Back"
                disabled={busy}
            >
                <Icon.BackIcon />
            </button>
            <span className={pickerStyles.title}>Sign PSBT</span>
            <span style={{ width: 28 }} />
        </div>
    );

    if (loadError) {
        return (
            <Screen variant={variant} header={header}>
                <div role="alert" style={{ color: 'var(--xc-danger)', padding: 'var(--xc-space-3)' }}>
                    {loadError}
                </div>
            </Screen>
        );
    }

    if (signedPsbtHex !== null) {
        const body = (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-3)' }}>
                <div>
                    <div style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)', marginBottom: 4 }}>
                        Signed by
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ChainBadge chainId={chainId || ''} />
                        <AddressText address={selectedAddress?.address || ''} />
                    </div>
                </div>
                <div>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 4,
                    }}>
                        <span style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                            Signed PSBT (hex)
                        </span>
                        <CopyButton value={signedPsbtHex} label="Copy signed PSBT" />
                    </div>
                    <pre style={{
                        background: 'var(--xc-surface)',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-md)',
                        padding: 'var(--xc-space-2)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        fontSize: 'var(--xc-text-xs)',
                        fontFamily: 'var(--xc-font-mono)',
                    }}>{signedPsbtHex}</pre>
                </div>
                <p style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                    Hand this signed PSBT to whoever broadcasts (or the next cosigner).
                    Broadcast from inside the wallet will arrive in a later release.
                </p>
                <Button
                    variant="ghost"
                    block
                    onClick={() => {
                        setSignedPsbtHex(null);
                        setPasted('');
                        setDecomposed(null);
                        setParseError(null);
                    }}
                >
                    Sign another PSBT
                </Button>
            </div>
        );
        return (
            <Screen variant={variant} header={header}>
                {isFull ? <div className={styles.card}>{body}</div> : body}
            </Screen>
        );
    }

    const previewBlock = decomposed ? (
        <div style={{
            background: 'var(--xc-surface)',
            border: '1px solid var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
            padding: 'var(--xc-space-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            fontSize: 'var(--xc-text-sm)',
        }}>
            <div>
                <strong>Inputs:</strong> {decomposed.inputs.length}
                {' · '}
                <strong>Outputs:</strong> {decomposed.outputs.length}
            </div>
            <div>
                <strong>Total in:</strong> {totalIn.toLocaleString()} sats
                {' · '}
                <strong>Total out:</strong> {totalOut.toLocaleString()} sats
                {' · '}
                <strong>Fee:</strong> {fee.toLocaleString()} sats
            </div>
            <div>
                <strong>Inputs this address signs:</strong> {ownedInputCount} of {decomposed.inputs.length}
            </div>
        </div>
    ) : null;

    const formBody = (
        <form onSubmit={handleSubmit} noValidate>
            <div style={{ marginBottom: 'var(--xc-space-3)' }}>
                <ChainPicker
                    chains={chainOptions}
                    selectedChainId={chainId}
                    onChange={setChainId}
                    label="Chain"
                />
            </div>
            <div style={{ marginBottom: 'var(--xc-space-3)' }}>
                <label
                    htmlFor="psbt-sign-address"
                    style={{
                        display: 'block',
                        color: 'var(--xc-text-muted)',
                        fontSize: 'var(--xc-text-sm)',
                        marginBottom: 4,
                    }}
                >
                    Signing address
                </label>
                <select
                    id="psbt-sign-address"
                    value={addressId || ''}
                    onChange={(e) => { setAddressId(e.target.value || null); if (error) setError(null); }}
                    aria-label="Signing address"
                    style={{
                        width: '100%',
                        background: 'var(--xc-bg)',
                        color: 'var(--xc-text)',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-sm)',
                        padding: 'var(--xc-space-2)',
                        fontSize: 'var(--xc-text-sm)',
                    }}
                >
                    {addressOptions.map((a) => (
                        <option key={a.id} value={a.id}>{a.address}</option>
                    ))}
                </select>
            </div>
            <div style={{ marginBottom: 'var(--xc-space-3)' }}>
                <label
                    htmlFor="psbt-sign-paste"
                    style={{
                        display: 'block',
                        color: 'var(--xc-text-muted)',
                        fontSize: 'var(--xc-text-sm)',
                        marginBottom: 4,
                    }}
                >
                    PSBT (hex or base64)
                </label>
                <div
                    {...drop.rootProps}
                    style={{
                        position: 'relative',
                        border: drop.isDragOver ? '2px dashed var(--xc-accent)' : '1px solid transparent',
                        borderRadius: 'var(--xc-radius-sm)',
                        padding: drop.isDragOver ? 0 : 1,
                        transition: 'border-color 120ms ease',
                    }}
                >
                    <textarea
                        id="psbt-sign-paste"
                        value={pasted}
                        onChange={(e) => { setPasted(e.target.value); if (error) setError(null); }}
                        placeholder="Paste PSBT hex (70736274ff…) or base64 (cHNid…) — or drop a .psbt file"
                        rows={6}
                        aria-label="PSBT"
                        style={{
                            width: '100%',
                            background: 'var(--xc-bg)',
                            color: 'var(--xc-text)',
                            border: '1px solid var(--xc-border)',
                            borderRadius: 'var(--xc-radius-sm)',
                            padding: 'var(--xc-space-2)',
                            fontSize: 'var(--xc-text-xs)',
                            fontFamily: 'var(--xc-font-mono)',
                            resize: 'vertical',
                            wordBreak: 'break-all',
                        }}
                    />
                    <input {...drop.pickerProps} />
                </div>
                <div style={{ marginTop: 4, fontSize: 'var(--xc-text-sm)', color: 'var(--xc-text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)' }}>
                    <span>Or</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={drop.openFilePicker}
                        disabled={busy}
                    >
                        Browse for .psbt file
                    </Button>
                </div>
                {pasted && !psbtHex ? (
                    <div role="alert" style={{ color: 'var(--xc-danger)', fontSize: 'var(--xc-text-sm)', marginTop: 4 }}>
                        Doesn't look like hex or base64 PSBT. Strip whitespace, paste the full blob.
                    </div>
                ) : null}
                {parsing ? (
                    <div style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)', marginTop: 4 }}>
                        Parsing PSBT…
                    </div>
                ) : null}
                {parseError ? (
                    <div role="alert" style={{ color: 'var(--xc-danger)', fontSize: 'var(--xc-text-sm)', marginTop: 4 }}>
                        {parseError}
                    </div>
                ) : null}
            </div>
            {previewBlock ? (
                <div style={{ marginBottom: 'var(--xc-space-3)' }}>
                    {previewBlock}
                </div>
            ) : null}
            <Input
                type="password"
                label="Wallet password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                autoComplete="current-password"
                error={error || undefined}
            />
            <Button
                type="submit"
                variant="primary"
                block
                loading={busy}
                disabled={
                    busy
                    || !psbtHex
                    || !decomposed
                    || ownedInputCount === 0
                    || password.length === 0
                    || !addressId
                }
            >
                Sign PSBT
            </Button>
        </form>
    );

    return (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{formBody}</div> : formBody}
        </Screen>
    );
}
