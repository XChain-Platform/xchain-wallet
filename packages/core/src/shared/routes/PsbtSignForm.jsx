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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    FormPage,
    ListPage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useDropZone } from '../hooks/useDropZone.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useSettings } from '../hooks/useSettings.js';
import { useConfirmAction, isConfirmOpenPhase } from '../hooks/useConfirmAction.js';
import {
    exactNetworkFeeSats,
    formatExactSats,
    sumExactSats,
} from '../../flows/psbtNetworkFee.js';
import { isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { PsbtConfirmScreen } from '../components/PsbtConfirmScreen.jsx';
import { HwSignBlock } from '../components/HwSignBlock.jsx';
import { SigningReadyNote } from '../safety/PanicFreezeNotice.jsx';
import { decodeBbqrPsbt, parseBbqrFrame } from '../../uri/bbqrPsbt.js';
import { decodeUrPsbt, UrPsbtDecoder } from '../../uri/urPsbt.js';
import { detectQrFrameFormat, describeUnsupportedFormat } from '../../uri/qrPsbtFormat.js';
import {
    createXcwCollector,
    addChunkToCollector,
    XCW_PREFIX,
} from '../../uri/psbtQr.js';
import styles from './IssueTokenForm.module.css';
import { preferredSourceId } from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { psbtActionSummary } from '../utils/actionDisplayLabel.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';

// Show fixed copy for every parse failure: the parse handler throws only
// precondition text and decoder exceptions, never wording written for a user.
const PARSE_FAILED_MESSAGE = "This doesn't look like a transaction this wallet can read. "
    + 'Check that you pasted the whole thing and picked the right chain.';

// Say what the user cannot do here, not which shell API is missing.
const SIGN_UNAVAILABLE_MESSAGE = "This version of the wallet can't sign transactions on this screen.";

// Word a failed broadcast without the handler's prefix or the node's reject code.
// A missing txid can follow a node that accepted the bytes, so never say nothing went out.
function broadcastFailureMessage(err) {
    const raw = err && typeof err === 'object' ? String(/** @type {any} */ (err).message || '') : String(err || '');
    if (/did not return a txid/i.test(raw)) {
        return "The wallet couldn't confirm this transaction reached the network. "
            + 'Check your transaction history before broadcasting it again.';
    }
    return readFailureMessage(err, 'broadcast this transaction');
}

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
const PSBT_MAGIC_HEX = '70736274ff';
// Base64-encoded PSBT magic bytes (`psbt` + 0xff) start with `cHNid`.
const BASE64_PSBT_PREFIX = 'cHNid';

function hasPsbtMagic(hex) {
    return typeof hex === 'string' && hex.toLowerCase().startsWith(PSBT_MAGIC_HEX);
}

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
            const hex = decodeBbqrPsbt(frames).psbtHex;
            return hasPsbtMagic(hex) ? hex : null;
        } catch {
            return null;
        }
    }
    if (frames.length > 0 && frames.every((f) => detectQrFrameFormat(f) === 'ur')) {
        try {
            const hex = decodeUrPsbt(frames).psbtHex;
            return hasPsbtMagic(hex) ? hex : null;
        } catch {
            return null;
        }
    }

    const trimmed = trimmedRaw.replace(/\s+/g, '');
    if (HEX_RE.test(trimmed) && trimmed.length % 2 === 0 && hasPsbtMagic(trimmed)) {
        return trimmed.toLowerCase();
    }
    if (trimmed.startsWith(BASE64_PSBT_PREFIX)) {
        try {
            const bin = atob(trimmed);
            let hex = '';
            for (let i = 0; i < bin.length; i += 1) {
                hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
            }
            return hasPsbtMagic(hex) ? hex : null;
        } catch (_err) {
            return null;
        }
    }
    return null;
}

/**
 * Explain why a non-empty pasted value cannot be imported as a PSBT.
 *
 * @param {string} raw
 * @returns {string | null}
 */
export function psbtInputError(raw) {
    if (typeof raw !== 'string' || raw.trim().length === 0 || normalizePsbtInput(raw)) return null;
    const frames = raw.trim().split(/\s+/).filter(Boolean);
    const firstFormat = detectQrFrameFormat(frames[0]);
    if (firstFormat === 'bbqr') {
        return 'This BBQr transaction is incomplete or malformed. Scan every frame again.';
    }
    if (firstFormat === 'ur') {
        return 'This UR transaction is incomplete or malformed. Keep scanning, or paste every frame.';
    }
    const compact = raw.replace(/\s+/g, '');
    if (HEX_RE.test(compact)) {
        if (compact.length % 2 !== 0) {
            return 'Transaction hex must contain complete byte pairs.';
        }
        return `This hex is not a PSBT. A PSBT starts with ${PSBT_MAGIC_HEX}.`;
    }
    if (compact.startsWith(BASE64_PSBT_PREFIX)) {
        return 'Transaction base64 is incomplete or malformed.';
    }
    return 'Paste a PSBT as hex or base64, or import a .psbt file.';
}

/**
 * Decode either a binary .psbt file or a UTF-8 file containing hex/base64.
 *
 * @param {ArrayBuffer} content
 * @returns {string | null} normalized PSBT hex
 */
export function normalizePsbtFile(content) {
    if (Object.prototype.toString.call(content) !== '[object ArrayBuffer]') return null;
    const bytes = new Uint8Array(content);
    const binaryHex = arrayBufferToHex(content);
    if (hasPsbtMagic(binaryHex)) return binaryHex;
    let offset = 0;
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3;
    let text = '';
    for (let i = offset; i < bytes.length; i += 1) {
        if (bytes[i] > 0x7f) return null;
        text += String.fromCharCode(bytes[i]);
    }
    return normalizePsbtInput(text);
}

/**
 * One copyable hex artifact on the signing-result screen, under its own
 * label. Rendered per artifact rather than once, because the software and
 * hardware lanes return DIFFERENT artifacts and a single block had to name
 * one of them wrongly.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} props.copyLabel
 * @param {string} props.value
 * @param {string} props.testId
 */
function ArtifactBlock({ label, copyLabel, value, testId }) {
    return (
        <div>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 4,
            }}>
                <span style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                    {label}
                </span>
                <CopyButton value={value} label={copyLabel} />
            </div>
            <pre
                data-testid={testId}
                style={{
                    background: 'var(--xc-surface)',
                    border: '1px solid var(--xc-border)',
                    borderRadius: 'var(--xc-radius-md)',
                    padding: 'var(--xc-space-2)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    fontSize: 'var(--xc-text-xs)',
                    fontFamily: 'var(--xc-font-mono)',
                }}
            >{value}</pre>
        </div>
    );
}

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} [props.initialPsbt]: a transaction the shell already has, e.g. one just scanned off a QR. Seeds the paste box so the user does not have to fetch it again through the channel the scan replaced.
 */
export function PsbtSignForm({ walletId, onBack, initialPsbt }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    // getActiveAddresses()[chainId], loaded in the same batch as the
    // address list so the default resolves once, not fallback-then-swap.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, any> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [addressId, setAddressId] = useState(/** @type {string | null} */ (null));
    // Seeded from `initialPsbt` at mount. The user still reviews the
    // decoded action and types their password, so a scanned transaction is a
    // proposal in the box, never a signature - which is why prefilling it is
    // consistent with this route refusing to auto-import secret material.
    const [pasted, setPasted] = useState(typeof initialPsbt === 'string' ? initialPsbt : '');
    const [password, setPassword] = useState('');

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [parseError, setParseError] = useState(/** @type {string | null} */ (null));
    const [parsing, setParsing] = useState(false);
    // The XChain action decoded from the pasted PSBT (best-effort;
    // `null` + a reason is a state the confirm page renders loudly, and it is
    // what the fail-closed refusal rule keys on).
    const [parsedAction, setParsedAction] = useState(/** @type {any | null} */ (null));
    const [parsedActionReason, setParsedActionReason] = useState(/** @type {string | null} */ (null));
    const [decomposed, setDecomposed] = useState(
        /** @type {import('../../signers/types').DecomposedPsbt | null} */ (null),
    );
    const [signedPsbtHex, setSignedPsbtHex] = useState(
        /** @type {string | null} */ (null),
    );
    // §20 / G040 FOLLOWUP 1: capture the broadcastable txHex + txid from
    // the sign result so the result page can offer in-wallet broadcast.
    const [signedTxHex, setSignedTxHex] = useState(/** @type {string} */ (''));
    const [signedTxid, setSignedTxid] = useState(/** @type {string} */ (''));
    const [broadcastState, setBroadcastState] = useState(
        /** @type {'idle' | 'broadcasting' | 'broadcast' | 'queued' | 'error'} */ ('idle'),
    );
    const [broadcastTxid, setBroadcastTxid] = useState(/** @type {string} */ (''));
    const [broadcastError, setBroadcastError] = useState(/** @type {string | null} */ (null));

    const psbtHex = useMemo(() => normalizePsbtInput(pasted), [pasted]);

    // Keep decoder failures out of the UI and explain the detected input
    // shape in terms the user can act on.
    const inputError = useMemo(() => {
        if (!pasted || psbtHex) return null;
        const firstToken = pasted.trim().split(/\s+/)[0];
        return describeUnsupportedFormat(detectQrFrameFormat(firstToken))
            || psbtInputError(pasted);
    }, [pasted, psbtHex]);

    // §20.4 / Cluster E FOLLOWUP 4: camera QR scan. Four input shapes:
    //   • XCW: each frame accrues into an XCW collector; the wallet
    //     emits the SHA-256-verified PSBT bytes once the chunk count
    //     matches the announced total.
    //   • BBQr: distinct indexes accrue until the announced total arrives.
    //   • Hex / base64: a single frame routes through normalizePsbtInput.
    //   • UR (crypto-psbt): each frame feeds a fountain decoder; the
    //     wallet emits the PSBT once enough frames reduce to the full
    //     message (Cluster U FOLLOWUP 2).
    const [scannerOpen, setScannerOpen] = useState(false);
    const [xcwCollector, setXcwCollector] = useState(() => createXcwCollector());
    const bbqrFramesRef = useRef(/** @type {Map<number, string>} */ (new Map()));
    const bbqrStreamRef = useRef('');
    const [scanProgress, setScanProgress] = useState(
        /** @type {null | { format: 'XCW' | 'BBQr', received: number, total: number } | { format: 'UR', percent: number }} */ (null),
    );
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
                    setError('Could not read that transaction QR. Start the scan again.');
                    return next;
                }
                if (next.total !== null) {
                    setScanProgress({
                        format: 'XCW',
                        received: next.receivedCount,
                        total: next.total,
                    });
                }
                if (next.complete && next.psbt) {
                    let hex = '';
                    for (let i = 0; i < next.psbt.length; i += 1) {
                        hex += next.psbt[i].toString(16).padStart(2, '0');
                    }
                    const decoded = normalizePsbtInput(hex);
                    if (!decoded) {
                        setError('That XCW code does not contain a PSBT.');
                        return createXcwCollector();
                    }
                    setPasted(decoded);
                    setScannerOpen(false);
                    setScanProgress(null);
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
                setError('Could not read that UR transaction QR. Keep scanning every frame.');
                return;
            }
            if (done) {
                const decoded = normalizePsbtInput(urDecoder.psbtHex);
                if (!decoded) {
                    setError('That UR code does not contain a PSBT.');
                    return;
                }
                setPasted(decoded);
                setScannerOpen(false);
                setScanProgress(null);
                if (error) setError(null);
                setUrDecoder(new UrPsbtDecoder());
            } else {
                setScanProgress({ format: 'UR', percent: Math.round(urDecoder.progress * 100) });
            }
            return;
        }
        if (fmt === 'bbqr') {
            let parsed;
            try {
                parsed = parseBbqrFrame(text);
            } catch {
                setError('Could not read that BBQr transaction frame. Scan it again.');
                return;
            }
            const stream = `${parsed.encoding}:${parsed.fileType}:${parsed.total}`;
            if (bbqrStreamRef.current !== stream) {
                bbqrStreamRef.current = stream;
                bbqrFramesRef.current = new Map();
            }
            const trimmedFrame = text.trim();
            const priorFrame = bbqrFramesRef.current.get(parsed.index);
            if (priorFrame && priorFrame !== trimmedFrame) {
                setError('These BBQr frames do not belong to one transaction. Start the scan again.');
                bbqrFramesRef.current = new Map();
                setScanProgress(null);
                return;
            }
            bbqrFramesRef.current.set(parsed.index, trimmedFrame);
            const received = bbqrFramesRef.current.size;
            setScanProgress({ format: 'BBQr', received, total: parsed.total });
            if (received === parsed.total) {
                try {
                    const frames = [...bbqrFramesRef.current.entries()]
                        .sort(([a], [b]) => a - b)
                        .map(([, frame]) => frame);
                    const decoded = normalizePsbtInput(frames.join('\n'));
                    if (!decoded) throw new Error('not a PSBT');
                    setPasted(decoded);
                    setScannerOpen(false);
                    setScanProgress(null);
                    if (error) setError(null);
                } catch {
                    setError('Could not assemble that BBQr transaction. Scan every frame again.');
                }
            }
            return;
        }
        const decoded = normalizePsbtInput(text);
        if (decoded) {
            setPasted(decoded);
            setScannerOpen(false);
            setScanProgress(null);
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
            bbqrFramesRef.current = new Map();
            bbqrStreamRef.current = '';
            setScanProgress(null);
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
            const hex = normalizePsbtFile(content);
            if (!hex) {
                setError('This file does not contain a valid PSBT in binary, hex, or base64 form.');
                return;
            }
            setPasted(hex);
            if (error) setError(null);
        },
    });

    // The active map and the settings read are best-effort: a host without
    // `getActiveAddresses` / `getSettings`, or one whose call fails, still
    // yields a usable form (newest-HD source, first-chain default). This
    // reads its own settings snapshot rather than the `useSettings()` one
    // used below for developerMode, so the chain default resolves in the
    // same batch as the address list instead of racing that hook's own load.
    //
    // The chain here only tells the parser which network's rules to apply
    // to the pasted PSBT (`parsePsbtRequest({ chainId, psbtHex })`) - a PSBT
    // does not self-identify its chain, so this is a genuine default the
    // user can retarget, not a value derived from the PSBT itself.
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
            .then(([byChain, active, chainSettings]) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                setActiveByChain(active || {});
                if (Object.keys(byChain || {}).length === 0) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before signing.',
                    );
                    return;
                }
                // `byChain` is in address-creation order, so opening on its
                // first key opened PSBT sign on the wallet's OLDEST chain
                // forever. Open on the last-used chain instead, ahead of the
                // first-key fallback, exactly as Send does.
                setChainId((prev) => pickDefaultChainId(byChain, {
                    explicitChainId: prev,
                    settings: chainSettings,
                }));
            })
            .catch((err) => {
                if (!cancelled) setLoadError(readFailureMessage(err, 'load your addresses'));
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Default to the same address Send and every action form start on:
    // the chain's active address, else the newest HD external, else the
    // first remaining record. A dispenser-delegated address is never the
    // default; the user can still pick it.
    useEffect(() => {
        if (!chainId || !addressesByChain || !activeByChain) return;
        const addrs = addressesByChain[chainId] || [];
        if (addrs.length === 0) {
            setAddressId(null);
            return;
        }
        const own = addrs.filter((a) => a.role !== 'dispenser');
        setAddressId(preferredSourceId(own, activeByChain[chainId]) || own[0]?.id || addrs[0].id);
    }, [chainId, addressesByChain, activeByChain]);

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
            setParseError("This version of the wallet can't read pasted transactions.");
            return undefined;
        }
        let cancelled = false;
        setParsing(true);
        setParseError(null);
        messaging.parsePsbtRequest({ chainId, psbtHex })
            .then((res) => {
                if (cancelled) return;
                setDecomposed(res?.decomposed || null);
                // The action carried inside, when it decodes.
                // Additive on the host side, so an older shell simply reports
                // no action and the confirm page renders its loud
                // "could not read the action" state.
                setParsedAction(res?.action || null);
                setParsedActionReason(res?.actionDecodeReason || null);
            })
            .catch((err) => {
                if (cancelled) return;
                setDecomposed(null);
                setParsedAction(null);
                setParsedActionReason(null);
                setParseError(PARSE_FAILED_MESSAGE);
            })
            .finally(() => { if (!cancelled) setParsing(false); });
        return () => { cancelled = true; };
    }, [psbtHex, chainId, messaging]);

    const chainIds = useMemo(() => {
        if (!addressesByChain) return [];
        return Object.keys(addressesByChain)
            .filter((id) => (addressesByChain[id] || []).length > 0);
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
        if (!decomposed) return 0n;
        return sumExactSats(decomposed.inputs.map((input) => input.value)) ?? 0n;
    }, [decomposed]);
    const totalOut = useMemo(() => {
        if (!decomposed) return 0n;
        return sumExactSats(decomposed.outputs.map((output) => output.value)) ?? 0n;
    }, [decomposed]);
    const fee = exactNetworkFeeSats(decomposed) ?? 0;

    // Own addresses on the selected chain, used to mark outputs that pay back
    // to this wallet (change) vs external recipients. Same signal the
    // extension's PsbtIntentSummary uses (getAddressesByChain). Without this
    // the air-gapped surface showed only aggregate totals, so a user could not
    // verify WHO gets paid (F2).
    const ownAddressSet = useMemo(
        () => new Set(addressOptions.map((a) => a.address)),
        [addressOptions],
    );

    // §5.6 slice 3: software signing goes through the shared confirm
    // page in its PSBT variant (§5.5). Hardware keeps the legacy inline flow -
    // <HwSignBlock> is its own signing gate and device-dependent.
    //
    // Nothing is composed here: the PSBT already exists, so `compose` just
    // hands the parsed bytes to the state machine. That reuses the whole
    // contract (sync Approve disable, exits locked once a signature exists,
    // credential re-prompt, terminal states) without a second implementation.
    const { settings } = useSettings();
    const developerMode = Boolean(settings?.developerMode);
    const confirmAction = useConfirmAction();
    const useConfirmPage = !isHwSource;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    async function openConfirmScreen() {
        try {
            const result = await confirmAction.confirm({
                chainId,
                source: selectedAddress?.address,
                compose: async () => ({
                    psbt: psbtHex,
                    actionString: parsedAction?.actionString || null,
                    action: parsedAction?.action || null,
                    version: parsedAction?.version ?? null,
                    encoding: 'psbt',
                }),
                // Report-only (§5.5), and only when there is an action string to
                // check at all: a plain payment PSBT has nothing to pre-flight.
                ...(parsedAction?.actionString
                    ? { preflight: (o) => messaging.preflight({ chainId, ...o }) }
                    : {}),
                onApprove: () => messaging.signPsbtUserInitiated({
                    walletId,
                    addressId,
                    password: passwordValueRef.current,
                    psbtHex,
                }),
            });
            setSignedPsbtHex(result?.signedPsbtHex || '');
            setSignedTxHex(typeof result?.txHex === 'string' ? result.txHex : '');
            setSignedTxid(typeof result?.txid === 'string' ? result.txid : '');
            setBroadcastState('idle');
            setBroadcastTxid('');
            setBroadcastError(null);
            setPassword('');
        } catch (err) {
            if (isUserRejection(err)) return;
            setError(
                err?.name === 'InvalidPasswordError'
                    ? 'Incorrect password.'
                    : readFailureMessage(err, 'sign this transaction'),
            );
        }
    }

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
        if (useConfirmPage) {
            if (typeof messaging.signPsbtUserInitiated !== 'function') {
                setError(SIGN_UNAVAILABLE_MESSAGE);
                return;
            }
            // The password is collected ON the confirm page, so the credential
            // guard below must not gate getting there.
            openConfirmScreen();
            return;
        }
        if (isHwSource) {
            if (hwStatus !== 'available') {
                setError('Hardware signer is not ready yet. Connect + unlock your device.');
                return;
            }
            if (typeof messaging.signPsbtUserInitiatedHw !== 'function') {
                setError(SIGN_UNAVAILABLE_MESSAGE);
                return;
            }
        } else {
            if ((!signerReady && password.length === 0)) { setError('Enter your wallet password.'); return; }
            if (typeof messaging.signPsbtUserInitiated !== 'function') {
                setError(SIGN_UNAVAILABLE_MESSAGE);
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
            setSignedTxid(typeof result?.txid === 'string' ? result.txid : '');
            setBroadcastState('idle');
            setBroadcastTxid('');
            setBroadcastError(null);
            if (!isHwSource) setPassword('');
        } catch (err) {
            setError(
                err?.name === 'InvalidPasswordError'
                    ? 'Incorrect password.'
                    : readFailureMessage(err, 'sign this transaction'),
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
                        {/* ChainBadge takes a descriptor, not an id: passing an
                            id crashed this screen on every successful signing. */}
                        {chainRegistry.get(chainId)
                            ? <ChainBadge descriptor={chainRegistry.get(chainId)} size="sm" />
                            : <span>{chainId}</span>}
                        <AddressText address={selectedAddress?.address || ''} />
                    </div>
                </div>
                {/* Two DIFFERENT artifacts, each rendered only when it exists.
                    The software lane returns a signed PSBT and an empty txHex
                    until it finalizes; the hardware lane returns the reverse,
                    `signedPsbtHex: ''` plus a fully serialized transaction,
                    because the device hands back a tx rather than a PSBT
                    (LedgerSigner.signPsbt / TrezorSigner.signPsbt). Keying one
                    block on signedPsbtHex alone rendered an empty <pre> and a
                    copy button that copied nothing for every hardware signing,
                    under a label naming the artifact that was not there. */}
                {signedPsbtHex ? (
                    <ArtifactBlock
                        label="Signed PSBT (hex)"
                        copyLabel="Copy signed PSBT"
                        value={signedPsbtHex}
                        testId="signed-psbt-hex"
                    />
                ) : null}
                {signedTxHex ? (
                    <ArtifactBlock
                        label="Signed transaction (raw hex)"
                        copyLabel="Copy signed transaction"
                        value={signedTxHex}
                        testId="signed-tx-hex"
                    />
                ) : null}
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
                ) : broadcastState === 'queued' ? (
                    <div role="status" aria-live="polite" style={{ color: 'var(--xc-text-muted)' }}>
                        The network could not take the transaction yet. Its signed bytes are saved in the
                        queued-transactions banner, where you can retry without signing again.
                    </div>
                ) : broadcastState === 'error' ? (
                    <div role="alert" style={{ color: 'var(--xc-danger)', fontSize: 'var(--xc-text-sm)' }}>
                        {broadcastError}
                    </div>
                ) : signedPsbtHex ? (
                    <p style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                        Broadcast directly from this wallet, or hand the signed transaction
                        off to a different broadcaster (or the next cosigner).
                    </p>
                ) : (
                    // A device hands back a FULLY signed transaction, not a
                    // partial PSBT, so there is no cosigner left to pass it to.
                    // Promising one told hardware users to do something the
                    // result of this screen cannot support.
                    <p style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                        This transaction is fully signed. Broadcast it directly from this
                        wallet, or hand the raw hex to any other broadcaster.
                    </p>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--xc-space-2)' }}>
                    {broadcastState !== 'broadcast' && broadcastState !== 'queued' ? (
                        <Button
                            variant="primary"
                            block
                            disabled={!signedTxHex || broadcastState === 'broadcasting'}
                            loading={broadcastState === 'broadcasting'}
                            onClick={async () => {
                                if (!signedTxHex || !chainId) return;
                                if (typeof messaging.broadcastSignedTxRequest !== 'function') {
                                    setBroadcastError("This version of the wallet can't broadcast from here. "
                                        + 'Copy the signed transaction and broadcast it with another tool.');
                                    setBroadcastState('error');
                                    return;
                                }
                                setBroadcastState('broadcasting');
                                setBroadcastError(null);
                                try {
                                    const res = await messaging.broadcastSignedTxRequest({
                                        walletId,
                                        chainId,
                                        txHex: signedTxHex,
                                        txid: signedTxid || undefined,
                                        fromAddress: selectedAddress?.address || undefined,
                                    });
                                    if (res?.queued === true) {
                                        setBroadcastState('queued');
                                    } else {
                                        setBroadcastTxid(res?.txid || signedTxid);
                                        setBroadcastState('broadcast');
                                    }
                                } catch (err) {
                                    setBroadcastError(broadcastFailureMessage(err));
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
                            setSignedTxid('');
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
                <ListPage>{body}</ListPage>
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
                <strong>Total in:</strong> {formatExactSats(totalIn)} sats
                {' · '}
                <strong>Total out:</strong> {formatExactSats(totalOut)} sats
                {' · '}
                <strong>Fee:</strong> {formatExactSats(fee)} sats
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
                                {formatExactSats(o.value ?? 0)} sats
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    ) : null;

    const formBody = (
        <FormPage
            label="Sign transaction"
            onSubmit={handleSubmit}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                    loading={busy}
                    disabled={
                        busy
                        || !psbtHex
                        || !decomposed
                        || ownedInputCount === 0
                        || !addressId
                        // On the confirm-page path the password is typed there, so
                        // it must not gate the button that opens it.
                        || (useConfirmPage
                            ? false
                            : (isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0)))
                    }
                >
                    {isHwSource && selectedAddress
                        ? `Sign on ${selectedAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                        : 'Sign transaction'}
                </Button>
            )}
        >
            <div style={{ marginBottom: 'var(--xc-space-3)' }}>
                <ChainPicker
                    chainIds={chainIds}
                    chainRegistry={chainRegistry}
                    value={chainId || ''}
                    onChange={(nextChainId) => {
                        setChainId(nextChainId);
                        if (error) setError(null);
                    }}
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
                        {scanProgress ? (
                            <p
                                role="status"
                                aria-live="polite"
                                style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)', marginTop: 4 }}
                            >
                                {scanProgress.format === 'UR'
                                    ? `UR decoding progress: ${scanProgress.percent}%`
                                    : `${scanProgress.format} frames received: ${scanProgress.received} of ${scanProgress.total}`}
                            </p>
                        ) : null}
                    </div>
                ) : null}
                {pasted && !psbtHex ? (
                    <StatusMessage
                        variant="error"
                        recovery={{ label: 'Clear', onAction: () => { setPasted(''); if (error) setError(null); } }}
                    >
                        {inputError}
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
                // Withdraw the "ready to sign" claim while panic mode
                // has signing frozen.
                <SigningReadyNote>
                    <p style={{ margin: 'var(--xc-space-2) 0 0', display: 'flex', alignItems: 'center', gap: 'var(--xc-space-1)', fontSize: 'var(--xc-text-sm)', color: 'var(--xc-text-muted)' }}>
                        <span aria-hidden="true">🔓</span> Wallet unlocked. No password needed.
                    </p>
                </SigningReadyNote>
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
        </FormPage>
    );

    // §5.5 confirm page (PSBT variant), rendered in place of the form.
    // The pasted blob and every picker stay intact behind it, so Reject drops
    // the user back exactly where they were.
    if (isConfirmOpenPhase(confirmAction.phase)) {
        return (
            <PsbtConfirmScreen
                confirmAction={confirmAction}
                screenVariant={variant}
                decomposed={decomposed}
                ownAddresses={ownAddressSet}
                signingAddress={selectedAddress?.address}
                decodedAction={parsedAction
                    ? { ...parsedAction, summary: psbtActionSummary(parsedAction) }
                    : null}
                decodeError={parsedActionReason}
                // The refusal keys on the REASON, not merely on "no action":
                // an ordinary payment (NO_OP_RETURN) must sign normally.
                spendsOwnInputs={ownedInputCount > 0}
                developerMode={developerMode}
                chainLabel={chainRegistry.get(chainId)?.displayName || chainId}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
            />
        );
    }

    return (
        <Screen variant={variant} header={header}>
            {formBody}
        </Screen>
    );
}
