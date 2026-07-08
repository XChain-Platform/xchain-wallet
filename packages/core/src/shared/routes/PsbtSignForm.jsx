// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PsbtSignForm (§30.4 / G088, closes paired G042).
//
// User-initiated PSBT paste-in. Mirrors SignMessageForm's structure but
// the input is an opaque PSBT (hex / base64) instead of a string.
// Workflow:
//
//   1. User pastes PSBT, picks chain + signing address.
//   2. Form normalizes the input to hex (base64 prefix `cHNid` is auto-
//      converted) and round-trips through `messaging.parsePsbtRequest`
//      so we can show inputs / outputs / fee before any auth happens.
//   3. Software path: type wallet password, `messaging.signPsbtUserInitiated`
//      is called; background decomposes the PSBT, matches inputs by
//      address, builds `signingPaths`, and runs `signPsbtFlow`.
//      HW path: when the chosen address is sourced from a paired
//      Trezor/Ledger (Cluster E FOLLOWUP 1), the password input is
//      replaced with `<HwSignBlock>` and the form calls
//      `messaging.signPsbtUserInitiatedHw`; background routes the
//      sign call through the renderer-hosted signer transport.
//   4. Result page exposes the signed PSBT hex with a Copy button plus
//      an in-wallet Broadcast button (Cluster W FOLLOWUP 1), enough
//      to round-trip into Sparrow / Specter / Coldcard or finalize on
//      this wallet directly.
//
// Out of scope for the V1 paste-in (tracked in FOLLOWUPS.md):
//   - Multi-signer aware preview when the PSBT carries inputs the
//     wallet doesn't own. Current preview shows them but the sign
//     attempt only covers wallet-owned inputs.
//
// QR scan (Cluster E FOLLOWUP 4): the "Scan PSBT" button mounts the
// existing camera <QrScanner> and routes each detected frame through
// the format detector. XCW chunks accrue against an XCW collector
// until the SHA-256-verified payload is reassembled; BBQr / hex /
// base64 frames pass straight through to the paste pipeline.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
    ChainPicker,
    CopyButton,
    Icon,
    StatusMessage,
    QrScanner,
    PageHeader,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useDropZone } from '../hooks/useDropZone.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { HwSignBlock } from '../components/HwSignBlock.jsx';
import { decodeBbqrPsbt } from '../../uri/bbqrPsbt.js';
import { decodeUrPsbt, UrPsbtDecoder } from '../../uri/urPsbt.js';
import { detectQrFrameFormat, describeUnsupportedFormat } from '../../uri/qrPsbtFormat.js';
import {
    createXcwCollector,
    addChunkToCollector,
    XCW_PREFIX,
} from '../../uri/psbtQr.js';
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
// Base64-encoded PSBT magic bytes (`psbt` + 0xff) start with `cHNid`.
// Reliable signal that an opaque blob is a base64 PSBT rather than hex.
const BASE64_PSBT_PREFIX = 'cHNid';

/**
 * Convert a pasted blob to a normalized hex PSBT. Returns `null` if the
 * input doesn't look like a hex / base64 / BBQr PSBT.
 *
 * Recognized input forms:
 *   • hex: 0-9a-f, even-length
 *   • base64: starts with the standard PSBT magic ("cHNidP")
 *   • BBQr (H / B / Z): single or multi-frame, line-separated
 *                    (§20.4 / G043). All three encodings decode now.
 *   • UR (crypto-psbt): single or multi-part fountain frames,
 *                    line-separated (§20.4 Cluster U FU 2). Returns
 *                    null when the captured frames are insufficient to
 *                    reassemble (e.g. a partial multi-part paste), so
 *                    the caller's hint logic can explain why.
 *
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizePsbtInput(raw) {
    if (typeof raw !== 'string') return null;
    const trimmedRaw = raw.trim();
    if (trimmedRaw.length === 0) return null;

    // BBQr / UR: multi-frame inputs may arrive as one big paste with line
    // breaks between frames. Split on whitespace, detect each line, and
    // route to the matching decoder when every non-empty line is the same
    // known animated-QR format.
    const frames = trimmedRaw.split(/\s+/).filter((s) => s.length > 0);
    if (frames.length > 0 && frames.every((f) => detectQrFrameFormat(f) === 'bbqr')) {
        try {
            return decodeBbqrPsbt(frames).psbtHex;
        } catch {
            return null;
        }
    }
    if (frames.length > 0 && frames.every((f) => detectQrFrameFormat(f) === 'ur')) {
        try {
            return decodeUrPsbt(frames).psbtHex;
        } catch {
            return null;
        }
    }

    const trimmed = trimmedRaw.replace(/\s+/g, '');
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
    const signerReady = useSignerReady(walletId);
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
    // §20 / G040 FOLLOWUP 1: capture the broadcastable txHex + txid from
    // the sign result so the result page can offer in-wallet broadcast.
    const [signedTxHex, setSignedTxHex] = useState(/** @type {string} */ (''));
    const [broadcastState, setBroadcastState] = useState(
        /** @type {'idle' | 'broadcasting' | 'broadcast' | 'error'} */ ('idle'),
    );
    const [broadcastTxid, setBroadcastTxid] = useState(/** @type {string} */ (''));
    const [broadcastError, setBroadcastError] = useState(/** @type {string | null} */ (null));

    const psbtHex = useMemo(() => normalizePsbtInput(pasted), [pasted]);

    // §20.4 / G043: when a paste fails to normalize, check whether it
    // matched a known-but-unsupported QR format (UR) so the error
    // message tells the user *why* instead of saying "not hex or
    // base64". The first non-empty token is enough for UR; BBQr-Z
    // (Cluster U FOLLOWUP 1) and BBQr-H/B all decode now, but
    // malformed BBQr frames still surface via `decodeBbqrPsbt`'s
    // thrown error which we catch.
    const unsupportedFormatHint = useMemo(() => {
        if (!pasted || psbtHex) return null;
        const firstToken = pasted.trim().split(/\s+/)[0];
        const fmt = detectQrFrameFormat(firstToken);
        const generic = describeUnsupportedFormat(fmt);
        if (generic) return generic;
        if (fmt === 'bbqr') {
            // Format detected as BBQr but normalize returned null.
            // Most likely a malformed frame, an incomplete multi-frame
            // capture, or a future encoding the wallet doesn't yet
            // support. Try a one-frame decode to surface the
            // BBQr-specific error message.
            try { decodeBbqrPsbt([firstToken]); } catch (e) {
                return e?.message ?? 'BBQr decode failed';
            }
        }
        if (fmt === 'ur') {
            // Detected as UR but not decoded: usually an incomplete
            // multi-part fountain capture (one frame of many). Surface
            // the UR-specific message so the user knows to keep
            // scanning / paste every frame rather than thinking it failed.
            try { decodeUrPsbt([firstToken]); } catch (e) {
                return e?.message ?? 'UR decode failed';
            }
        }
        return null;
    }, [pasted, psbtHex]);

    // §20.4 / Cluster E FOLLOWUP 4: camera QR scan. Two transports:
    //   • XCW: each frame accrues into an XCW collector; the wallet
    //     emits the SHA-256-verified PSBT bytes once the chunk count
    //     matches the announced total.
    //   • BBQr / hex / base64: each detected frame is appended to the
    //     paste textarea (newline-separated for BBQr); the existing
    //     `normalizePsbtInput` pipeline handles assembly.
    //   • UR (crypto-psbt): each frame feeds a fountain decoder; the
    //     wallet emits the PSBT once enough frames reduce to the full
    //     message (Cluster U FOLLOWUP 2).
    const [scannerOpen, setScannerOpen] = useState(false);
    const [xcwCollector, setXcwCollector] = useState(() => createXcwCollector());
    // UR multi-part fountain frames accrue into a stateful decoder; it emits
    // the PSBT once enough frames have been mixed/reduced to recover the whole
    // message (Cluster U FU 2). A fresh decoder is minted on each completion
    // and on scanner re-open.
    const [urDecoder, setUrDecoder] = useState(() => new UrPsbtDecoder());
    const handleScannerFrame = useCallback((text) => {
        if (typeof text !== 'string' || text.length === 0) return;
        if (text.startsWith(XCW_PREFIX)) {
            // Use functional update to avoid stale closure on rapid
            // RAF emissions.
            setXcwCollector((prev) => {
                const next = addChunkToCollector({ ...prev }, text);
                if (next.error) {
                    setError(`QR scan: ${next.error}`);
                    return next;
                }
                if (next.complete && next.psbt) {
                    let hex = '';
                    for (let i = 0; i < next.psbt.length; i += 1) {
                        hex += next.psbt[i].toString(16).padStart(2, '0');
                    }
                    setPasted(hex);
                    setScannerOpen(false);
                    if (error) setError(null);
                    return createXcwCollector();
                }
                return next;
            });
            return;
        }
        const fmt = detectQrFrameFormat(text);
        if (fmt === 'ur') {
            // UR animated QR: feed each frame into the fountain decoder.
            // Malformed frames are ignored so an unrelated UR (e.g. an
            // address QR) doesn't abort the capture. When the decoder has
            // recovered the whole PSBT, hand it to the paste pipeline.
            let done = false;
            try {
                urDecoder.receive(text);
                done = urDecoder.complete;
            } catch {
                return;
            }
            if (done) {
                setPasted(urDecoder.psbtHex);
                setScannerOpen(false);
                if (error) setError(null);
                setUrDecoder(new UrPsbtDecoder());
            }
            return;
        }
        if (fmt === 'bbqr') {
            // Append BBQr frames newline-separated; the paste-pipeline
            // detects the multi-frame BBQr shape and decodes when all
            // pieces are present.
            setPasted((cur) => (cur.length > 0 ? `${cur}\n${text}` : text));
            return;
        }
        if (fmt === 'hex' || fmt === 'base64') {
            // A single QR carrying the whole PSBT. Stop scanning.
            setPasted(text);
            setScannerOpen(false);
            if (error) setError(null);
            return;
        }
        // Unrecognized / unsupported: silently ignore so the scanner can
        // keep running without flashing errors at every unrelated QR the
        // camera spots.
    }, [error, urDecoder]);

    // Reset XCW collector whenever the scanner re-opens so a partial
    // earlier set doesn't pollute a fresh capture.
    useEffect(() => {
        if (scannerOpen) {
            setXcwCollector(createXcwCollector());
            setUrDecoder(new UrPsbtDecoder());
        }
    }, [scannerOpen]);

    // .psbt file drop / picker: binary blobs are read as ArrayBuffer and
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
                setError('Could not decode the dropped transaction file.');
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
    // The same PSBT under a different chain's SDK can produce different
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
                setParseError(err?.message || 'Failed to parse transaction.');
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

    // §30.4 / Cluster E FOLLOWUP 1: HW source detection. When the chosen
    // signing address is paired to a Trezor / Ledger, the password input
    // is suppressed in favor of <HwSignBlock> and the submit branches to
    // the messaging.signPsbtUserInitiatedHw shim.
    const isHwSource = selectedAddress?.source === 'trezor' || selectedAddress?.source === 'ledger';
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? selectedAddress?.signerId : null,
    });
    const [hwStatus, setHwStatus] = useState(/** @type {string} */ ('idle'));
    const onHwStatusChange = useCallback(({ status }) => {
        setHwStatus(status);
    }, []);
    // Reset HW status whenever the chosen address changes. The previous
    // signer's poll loop tears down inside HwSignBlock, but this keeps
    // the parent's submit-gate from briefly inheriting the old status.
    useEffect(() => {
        if (!isHwSource) setHwStatus('idle');
    }, [addressId, isHwSource]);

    // How many of the parsed PSBT's inputs match the chosen signer? The
    // sign attempt will cover exactly these; the rest stay unsigned for
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

    // Own addresses on the selected chain, used to mark outputs that pay back
    // to this wallet (change) vs external recipients. Same signal the
    // extension's PsbtIntentSummary uses (getAddressesByChain). Without this
    // the air-gapped surface showed only aggregate totals, so a user could not
    // verify WHO gets paid (F2).
    const ownAddressSet = useMemo(
        () => new Set(addressOptions.map((a) => a.address)),
        [addressOptions],
    );

    async function handleSubmit(event) {
        event.preventDefault();
        if (busy) return;
        setError(null);
        if (!chainId) { setError('Pick a chain.'); return; }
        if (!addressId) { setError('Pick a signing address.'); return; }
        if (!psbtHex) { setError('Paste a valid transaction (hex or base64).'); return; }
        if (!decomposed) { setError('Transaction could not be parsed for this chain.'); return; }
        if (ownedInputCount === 0) {
            setError(
                `The chosen address signs none of this transaction's inputs. Pick a different address or transaction.`,
            );
            return;
        }
        if (isHwSource) {
            if (hwStatus !== 'available') {
                setError('Hardware signer is not ready yet. Connect + unlock your device.');
                return;
            }
            if (typeof messaging.signPsbtUserInitiatedHw !== 'function') {
                setError('messaging.signPsbtUserInitiatedHw is not available in this shell.');
                return;
            }
        } else {
            if ((!signerReady && password.length === 0)) { setError('Enter your wallet password.'); return; }
            if (typeof messaging.signPsbtUserInitiated !== 'function') {
                setError('messaging.signPsbtUserInitiated is not available in this shell.');
                return;
            }
        }
        setBusy(true);
        try {
            const result = isHwSource
                ? await messaging.signPsbtUserInitiatedHw({
                    walletId,
                    addressId,
                    psbtHex,
                })
                : await messaging.signPsbtUserInitiated({
                    walletId,
                    addressId,
                    password,
                    psbtHex,
                });
            setSignedPsbtHex(result?.signedPsbtHex || '');
            setSignedTxHex(typeof result?.txHex === 'string' ? result.txHex : '');
            setBroadcastState('idle');
            setBroadcastTxid('');
            setBroadcastError(null);
            if (!isHwSource) setPassword('');
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
        <PageHeader onBack={onBack} backDisabled={busy} title="Sign transaction" />
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
                            Signed transaction (hex)
                        </span>
                        <CopyButton value={signedPsbtHex} label="Copy signed transaction" />
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
                {broadcastState === 'broadcast' ? (
                    <div
                        role="status"
                        aria-live="polite"
                        style={{
                            background: 'var(--xc-surface-raised)',
                            border: '1px solid var(--xc-border)',
                            borderRadius: 'var(--xc-radius-md)',
                            padding: 'var(--xc-space-3)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                        }}
                    >
                        <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>
                            Broadcast (pending)
                        </span>
                        <span style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                            Transaction ID
                        </span>
                        <code style={{
                            fontFamily: 'var(--xc-font-mono)',
                            fontSize: 'var(--xc-text-xs)',
                            wordBreak: 'break-all',
                        }}>{broadcastTxid}</code>
                        <CopyButton value={broadcastTxid} label="Copy txid" />
                    </div>
                ) : broadcastState === 'error' ? (
                    <div role="alert" style={{ color: 'var(--xc-danger)', fontSize: 'var(--xc-text-sm)' }}>
                        Broadcast failed: {broadcastError}
                    </div>
                ) : (
                    <p style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                        Broadcast directly from this wallet, or hand the signed transaction
                        off to a different broadcaster (or the next cosigner).
                    </p>
                )}
                <div style={{ display: 'flex', gap: 'var(--xc-space-2)' }}>
                    {broadcastState !== 'broadcast' ? (
                        <Button
                            variant="primary"
                            block
                            disabled={!signedTxHex || broadcastState === 'broadcasting'}
                            loading={broadcastState === 'broadcasting'}
                            onClick={async () => {
                                if (!signedTxHex || !chainId) return;
                                if (typeof messaging.broadcastSignedTxRequest !== 'function') {
                                    setBroadcastError('messaging.broadcastSignedTxRequest is not available in this shell.');
                                    setBroadcastState('error');
                                    return;
                                }
                                setBroadcastState('broadcasting');
                                setBroadcastError(null);
                                try {
                                    const res = await messaging.broadcastSignedTxRequest({
                                        chainId,
                                        txHex: signedTxHex,
                                    });
                                    setBroadcastTxid(res?.txid || '');
                                    setBroadcastState('broadcast');
                                } catch (err) {
                                    setBroadcastError(err?.message || 'Broadcast failed.');
                                    setBroadcastState('error');
                                }
                            }}
                        >
                            {broadcastState === 'broadcasting' ? 'Broadcasting…' : 'Broadcast'}
                        </Button>
                    ) : null}
                    <Button
                        variant="ghost"
                        block
                        onClick={() => {
                            setSignedPsbtHex(null);
                            setSignedTxHex('');
                            setBroadcastState('idle');
                            setBroadcastTxid('');
                            setBroadcastError(null);
                            setPasted('');
                            setDecomposed(null);
                            setParseError(null);
                        }}
                    >
                        Sign another transaction
                    </Button>
                </div>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                <strong>Where the coins go:</strong>
                {decomposed.outputs.map((o, i) => {
                    const own = !!o.address && ownAddressSet.has(o.address);
                    return (
                        <div
                            key={`${o.address || 'data'}-${i}`}
                            style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}
                        >
                            <span
                                style={{
                                    color: own ? 'var(--xc-text-muted)' : 'var(--xc-text)',
                                    fontWeight: own ? 'normal' : 600,
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {own ? 'Change (back to you)' : 'Recipient'}
                            </span>
                            {o.address ? (
                                <AddressText address={o.address} />
                            ) : (
                                <span style={{ color: 'var(--xc-text-muted)' }}>
                                    (data / non-address output)
                                </span>
                            )}
                            <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                                {(o.value || 0).toLocaleString()} sats
                            </span>
                        </div>
                    );
                })}
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
                    Unsigned transaction (hex or base64)
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
                        placeholder="Paste transaction hex (70736274ff…) or base64 (cHNid…), or drop a .psbt file"
                        rows={6}
                        aria-label="Unsigned transaction (hex or base64)"
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
                    <input {...drop.pickerProps} aria-label="Upload transaction file" />
                </div>
                <div style={{ marginTop: 4, fontSize: 'var(--xc-text-sm)', color: 'var(--xc-text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)', flexWrap: 'wrap' }}>
                    <span>Or</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={drop.openFilePicker}
                        disabled={busy}
                    >
                        Browse for .psbt file
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setScannerOpen((open) => !open); if (error) setError(null); }}
                        disabled={busy}
                    >
                        {scannerOpen ? 'Close scanner' : 'Scan transaction'}
                    </Button>
                </div>
                {scannerOpen ? (
                    <div style={{ marginTop: 'var(--xc-space-2)' }}>
                        <QrScanner onFrame={handleScannerFrame} alt="Transaction QR scanner" />
                        {xcwCollector.total !== null ? (
                            <p style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)', marginTop: 4 }}>
                                XCW frames received: {xcwCollector.receivedCount} of {xcwCollector.total}
                            </p>
                        ) : null}
                    </div>
                ) : null}
                {pasted && !psbtHex ? (
                    <StatusMessage
                        variant="error"
                        recovery={{ label: 'Clear', onAction: () => { setPasted(''); if (error) setError(null); } }}
                    >
                        {unsupportedFormatHint
                            || "Doesn't look like hex, base64, or BBQr transaction. Strip whitespace, paste the full blob."}
                    </StatusMessage>
                ) : null}
                {parsing ? (
                    <div style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)', marginTop: 4 }}>
                        Parsing transaction…
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
            {isHwSource && selectedAddress ? (
                <div style={{ marginBottom: 'var(--xc-space-3)' }}>
                    <HwSignBlock
                        signerKind={selectedAddress.source}
                        signerName={selectedAddress.signerLabel
                            || (selectedAddress.source === 'trezor' ? 'Trezor' : 'Ledger')}
                        path={selectedAddress.derivationPath || ''}
                        address={selectedAddress.address}
                        chainId={chainId}
                        getStatus={(opts) => messaging.getSignerStatus({
                            signerId: selectedAddress.signerId,
                            chainId: opts?.chainId ?? chainId,
                        })}
                        onStatusChange={onHwStatusChange}
                        signerInfo={hwSignerInfo}
                    />
                    {error ? (
                        <StatusMessage variant="error">{error}</StatusMessage>
                    ) : null}
                </div>
            ) : signerReady ? (
                <p style={{ margin: 'var(--xc-space-2) 0 0', display: 'flex', alignItems: 'center', gap: 'var(--xc-space-1)', fontSize: 'var(--xc-text-sm)', color: 'var(--xc-text-muted)' }}>
                    <span aria-hidden="true">🔓</span> Wallet unlocked. No password needed.
                </p>
            ) : (
                <Input
                    type="password"
                    label="Wallet password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                    autoComplete="current-password"
                    error={error || undefined}
                />
            )}
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
                    || !addressId
                    || (isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0))
                }
            >
                {isHwSource && selectedAddress
                    ? `Sign on ${selectedAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                    : 'Sign transaction'}
            </Button>
        </form>
    );

    return (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{formBody}</div> : formBody}
        </Screen>
    );
}
