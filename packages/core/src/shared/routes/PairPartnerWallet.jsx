// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Screen, PageHeader, Button, Input, Textarea, Icon, StatusMessage,
    QrScanner, AnimatedQrFrames, CopyButton, InfoTip,
} from '@xchain-wallet/core/ui';
import { flows as flowsLib } from '@xchain-wallet/core';
import {
    encodeXcwChunks,
    createXcwCollector,
    addChunkToCollector,
    XCW_PREFIX,
} from '../../uri/psbtQr.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';

const MIN_PASSWORD_LENGTH = 8;
const ACCEPTED_WORD_COUNTS = [12, 15, 18, 21, 24];

// A single QR frame stops being scannable somewhere past ~1200 bytes in
// byte mode: at 1907 characters the symbol is version 40 (177x177 modules)
// and even the browser's own BarcodeDetector cannot read it off a clean
// 240px bitmap, never mind a camera. Past this threshold the code goes out
// as an ANIMATED sequence of §20.3 XCW chunks instead of one dense frame.
// It is a switch-over point, not a cap: nothing is suppressed above it.
//  - a default wallet has three mainnet chains and lands at ~1907
// characters, so the chunked path is the ORDINARY one, not the exception,
// and the QR is the only mechanism an air-gapped pair has.
const MAX_QR_CHARS = 1200;

/**
 * §20.5 / : the watcher + signer auto-pairing lane.
 *
 * Both halves of an air-gapped pair are the SAME recovery phrase restored
 * twice: one wallet online in `watcher` mode, one offline in `signer`
 * mode. Before this lane there was no guidance for that and no check that
 * the two halves matched, so a mistyped word surfaced as an unsignable
 * PSBT after the air-gap round-trip, with no explanation attached.
 *
 * The lane runs four stages:
 *
 *   role      pick which half THIS device is. Sets `settings.walletMode`.
 *   seed      import the shared recovery phrase (skipped when the caller
 *             passes an existing `walletId`, e.g. re-pairing from Settings).
 *   exchange  show this wallet's pairing code (account-level PUBLIC keys
 *             only) for the partner to scan, and take the partner's code
 *             back. `flows.pairPartner` proves both halves derive from one
 *             phrase before anything persists.
 *   done      confirmation + which chains matched.
 *
 * Nothing secret crosses the gap: the payload carries public keys, chain
 * codes and xpubs. The seed itself is typed separately into each device
 * by the user and never leaves either one.
 *
 * @param {object} props
 * @param {() => void} [props.onBack]
 * @param {() => void} [props.onPaired]        fires once the pairing persists; caller refreshes App state
 * @param {string} [props.walletId]            existing wallet to pair (Settings entry point). Absent = onboarding, which imports the shared phrase first.
 * @param {'watcher' | 'signer'} [props.initialMode]   preselects the role stage
 */
export function PairPartnerWallet({ onBack, onPaired, walletId: existingWalletId, initialMode }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [stage, setStage] = useState(
        /** @type {'role' | 'seed' | 'exchange' | 'done'} */ (initialMode ? 'seed' : 'role'),
    );
    const [walletMode, setWalletMode] = useState(
        /** @type {'watcher' | 'signer' | null} */ (initialMode || null),
    );
    const [walletId, setWalletId] = useState(existingWalletId || null);

    const [name, setName] = useState('Paired Wallet');
    const [mnemonic, setMnemonic] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');

    const [localCode, setLocalCode] = useState(/** @type {string | null} */ (null));
    const [localKeySetId, setLocalKeySetId] = useState(/** @type {string | null} */ (null));
    const [partnerCode, setPartnerCode] = useState('');
    const [scanning, setScanning] = useState(false);
    const [partnerCollector, setPartnerCollector] = useState(() => createXcwCollector());
    const [verification, setVerification] = useState(/** @type {any} */ (null));

    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);

    const lane = flowsLib.describePairingLane(walletMode);

    // On entering the exchange stage, ask the host for this wallet's
    // pairing code. The password is still in hand from the seed stage;
    // the Settings entry point has no password and relies on the host
    // falling back to the unlocked session signer.
    useEffect(() => {
        if (stage !== 'exchange' || !walletId || localCode) return undefined;
        let cancelled = false;
        (async () => {
            if (typeof messaging.pairingPayloadRequest !== 'function') {
                setError('Wallet pairing is not available in this shell.');
                return;
            }
            setBusy(true);
            try {
                const res = await messaging.pairingPayloadRequest({
                    walletId,
                    walletMode,
                    password: password || undefined,
                    label: name,
                });
                if (cancelled) return;
                setLocalCode(res?.encoded || null);
                setLocalKeySetId(
                    res?.payload?.keys ? flowsLib.keySetIdOf(res.payload.keys) : null,
                );
                setError(null);
            } catch (err) {
                if (!cancelled) setError(err?.message || 'Could not build this wallet\'s pairing code.');
            } finally {
                if (!cancelled) setBusy(false);
            }
        })();
        return () => { cancelled = true; };
    }, [stage, walletId, localCode, messaging, password, name]);

    // The frames this device shows. A short code is one still frame, exactly
    // as before. A long one (the normal case: three chains ≈ 1907 characters)
    // is chunked with the §20.3 transport the wallet already ships, so the
    // partner's camera collects it frame by frame instead of being handed a
    // symbol nothing can decode. The codec takes bytes, and a pairing code is
    // base64url text rather than hex, so it is encoded rather than passed raw.
    const localFrames = useMemo(() => {
        if (!localCode) return null;
        if (localCode.length <= MAX_QR_CHARS) return [localCode];
        try {
            return encodeXcwChunks(new TextEncoder().encode(localCode));
        } catch {
            // Falling through to null keeps the text box + Copy button as the
            // remaining path rather than rendering a broken <img>.
            return null;
        }
    }, [localCode]);

    // Every decoded frame from the partner's display. A single-frame code is
    // taken as-is (unchanged behaviour); an XCW chunk accrues in the collector
    // until the set completes and its SHA256 verifies, at which point the
    // reassembled bytes are the partner's code. An incomplete set never
    // produces one, which is the property that matters: half a pairing code
    // must not reach `pairPartner`.
    //
    // MUST be stable across renders. `QrScanner` lists `onFrame` in its effect
    // deps, so a handler re-created on every render tears the camera down and
    // re-acquires it after each collected frame - which for a multi-frame code
    // means the capture loses more frames than it keeps and never completes.
    // Only the setters are used, and those are stable, so the dep list is empty.
    const handleScanFrame = useCallback((text) => {
        if (typeof text !== 'string' || text.length === 0) return;
        if (text.startsWith(XCW_PREFIX)) {
            setPartnerCollector((prev) => {
                const next = addChunkToCollector({ ...prev }, text);
                if (next.error) {
                    setError(`QR scan: ${next.error}`);
                    return createXcwCollector();
                }
                if (next.complete && next.psbt) {
                    setPartnerCode(new TextDecoder().decode(next.psbt).trim());
                    setScanning(false);
                    setError(null);
                    return createXcwCollector();
                }
                return next;
            });
            return;
        }
        setPartnerCode(text.trim());
        setScanning(false);
        setError(null);
    }, []);

    function pickRole(mode) {
        setWalletMode(mode);
        setError(null);
        setStage(existingWalletId ? 'exchange' : 'seed');
    }

    async function handleSeedSubmit(event) {
        event.preventDefault();
        if (busy) return;
        const trimmed = mnemonic.trim().replace(/\s+/g, ' ');
        if (trimmed.length === 0) {
            setError('Recovery phrase is required.');
            return;
        }
        const wordCount = trimmed.split(' ').length;
        if (!ACCEPTED_WORD_COUNTS.includes(wordCount)) {
            setError(`Expected ${ACCEPTED_WORD_COUNTS.join(', ')} words, got ${wordCount}.`);
            return;
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
            return;
        }
        if (password !== confirm) {
            setError('Passwords do not match.');
            return;
        }
        if (typeof messaging.importMnemonic !== 'function') {
            setError('Wallet import is not available in this shell.');
            return;
        }
        setError(null);
        setBusy(true);
        try {
            const r = await messaging.importMnemonic({ password, mnemonic: trimmed, name });
            const id = r?.wallet?.id || r?.walletId || r?.id || null;
            if (!id) {
                throw new Error('The wallet imported but the shell returned no wallet id, so pairing cannot continue.');
            }
            // `walletMode` rides along on the pairing requests rather than
            // being flipped here: the host persists it as part of the same
            // call that reads the keys, so a payload can never advertise a
            // mode the wallet is not actually in.
            setWalletId(id);
            setStage('exchange');
        } catch (err) {
            setError(err?.message || 'Could not import the recovery phrase.');
        } finally {
            setBusy(false);
        }
    }

    async function handlePairSubmit(event) {
        event.preventDefault();
        if (busy) return;
        if (partnerCode.trim().length === 0) {
            setError('Paste or scan the pairing code from the other wallet.');
            return;
        }
        if (typeof messaging.pairPartnerRequest !== 'function') {
            setError('Wallet pairing is not available in this shell.');
            return;
        }
        setError(null);
        setBusy(true);
        try {
            const res = await messaging.pairPartnerRequest({
                walletId,
                walletMode,
                partner: partnerCode.trim(),
                password: password || undefined,
                label: name,
            });
            setVerification(res?.verification || null);
            setStage('done');
        } catch (err) {
            setError(err?.message || 'The two wallets could not be paired.');
        } finally {
            setBusy(false);
        }
    }

    const header = (
        <PageHeader
            onBack={onBack}
            backDisabled={busy}
            title={lane.title || 'Pair a partner wallet'}
        />
    );

    if (stage === 'role') {
        return (
            <Screen variant={variant} header={header}>
                <p style={COPY}>
                    An air-gapped pair is one recovery phrase held by two wallets: an
                    online watcher that builds transactions, and an offline signer that
                    signs them. Pick which one this device is.
                </p>
                <div style={STACK}>
                    <Button
                        variant="primary"
                        block
                        onClick={() => pickRole('watcher')}
                        icon={<Icon.EyeIcon />}
                    >
                        This device watches. Pair a signer
                    </Button>
                    <Button
                        variant="secondary"
                        block
                        onClick={() => pickRole('signer')}
                        icon={<Icon.KeyIcon />}
                    >
                        This device signs. Pair a watcher
                    </Button>
                </div>
                <InfoTip label="Both halves must come from the same recovery phrase. Write it down once, then type it into each device separately: it never travels between them." />
            </Screen>
        );
    }

    if (stage === 'seed') {
        return (
            <Screen variant={variant} header={header}>
                <form onSubmit={handleSeedSubmit} noValidate>
                    <p style={COPY}>{lane.help}</p>
                    <Input
                        label="Wallet name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={busy}
                    />
                    <Textarea
                        label="Shared recovery phrase"
                        hint="The same phrase you used (or will use) on the other half of the pair."
                        rows={3}
                        value={mnemonic}
                        onChange={(e) => setMnemonic(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={busy}
                    />
                    <Input
                        label="Password for this device"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        disabled={busy}
                    />
                    <Input
                        label="Confirm password"
                        type="password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        autoComplete="new-password"
                        disabled={busy}
                    />
                    {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
                    <div style={STACK}>
                        <Button type="submit" variant="primary" block loading={busy} disabled={busy}>
                            Continue
                        </Button>
                    </div>
                </form>
            </Screen>
        );
    }

    if (stage === 'exchange') {
        const frameCount = localFrames ? localFrames.length : 0;
        return (
            <Screen variant={variant} header={header}>
                <form onSubmit={handlePairSubmit} noValidate>
                    <p style={COPY}>
                        Show this code to the other wallet, then bring its code back here.
                        The code holds public keys only: no recovery phrase, no private key,
                        and nothing that can spend.
                    </p>

                    <h2 style={SECTION_TITLE}>This wallet&rsquo;s code</h2>
                    {localCode ? (
                        <>
                            {localFrames ? (
                                <>
                                    <AnimatedQrFrames
                                        frames={localFrames}
                                        fps={frameCount > 1 ? 3 : 1}
                                        alt="Pairing code for the partner wallet to scan"
                                    />
                                    {frameCount > 1 ? (
                                        // One text node on purpose: a sentence split across JSX
                                        // children renders as several text nodes, and both this
                                        // spec's unit matcher and a screen reader see it in pieces.
                                        <StatusMessage>
                                            {`This code is too long for one QR, so it cycles through ${frameCount} frames. `
                                                + 'Point the other wallet’s camera at it and hold still until it has them all.'}
                                        </StatusMessage>
                                    ) : null}
                                </>
                            ) : (
                                <StatusMessage variant="error">
                                    This wallet&rsquo;s pairing code could not be drawn as a QR.
                                    Copy the text below instead.
                                </StatusMessage>
                            )}
                            <div style={CODE_BOX}>{localCode}</div>
                            <CopyButton value={localCode} label="Copy pairing code" />
                            {localKeySetId ? (
                                <p style={FINGERPRINT}>
                                    Key fingerprint: {localKeySetId.slice(0, 16)}
                                </p>
                            ) : null}
                        </>
                    ) : (
                        <StatusMessage>{busy ? 'Building this wallet\'s pairing code…' : 'No pairing code yet.'}</StatusMessage>
                    )}

                    <h2 style={SECTION_TITLE}>
                        {lane.partnerMode === 'signer' ? 'Signer wallet\'s code' : 'Watcher wallet\'s code'}
                    </h2>
                    {scanning ? (
                        <>
                            <QrScanner onFrame={handleScanFrame} />
                            {partnerCollector.total ? (
                                <StatusMessage>
                                    Pairing frames received: {partnerCollector.receivedCount} of
                                    {' '}{partnerCollector.total}
                                </StatusMessage>
                            ) : null}
                        </>
                    ) : null}
                    <Textarea
                        label="Paste the other wallet's code"
                        rows={3}
                        value={partnerCode}
                        onChange={(e) => setPartnerCode(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={busy}
                    />
                    {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
                    <div style={STACK}>
                        <Button
                            variant="ghost"
                            block
                            onClick={() => {
                                // A re-opened scanner starts from nothing: half a
                                // set left over from a previous attempt would
                                // otherwise mix with frames from a different code.
                                setPartnerCollector(createXcwCollector());
                                setScanning((s) => !s);
                            }}
                            disabled={busy}
                            icon={<Icon.ScanIcon />}
                        >
                            {scanning ? 'Stop scanning' : 'Scan the other wallet\'s QR'}
                        </Button>
                        <Button type="submit" variant="primary" block loading={busy} disabled={busy}>
                            {lane.cta || 'Pair'}
                        </Button>
                    </div>
                </form>
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={header}>
            <StatusMessage variant="success">
                {verification?.message || 'Paired.'}
            </StatusMessage>
            {verification?.sharedChainIds?.length ? (
                <p style={COPY}>
                    Matching chains: {verification.sharedChainIds.join(', ')}.
                </p>
            ) : null}
            <p style={COPY}>{lane.help}</p>
            <div style={STACK}>
                <Button
                    variant="primary"
                    block
                    onClick={() => { if (typeof onPaired === 'function') onPaired(); }}
                >
                    Finish
                </Button>
            </div>
        </Screen>
    );
}

const STACK = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-2)',
    marginBlockStart: 'var(--xc-space-3)',
};

const COPY = {
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-text-sm)',
    marginBlockEnd: 'var(--xc-space-3)',
};

const SECTION_TITLE = {
    color: 'var(--xc-text)',
    fontSize: 'var(--xc-text-sm)',
    fontWeight: 600,
    marginBlockStart: 'var(--xc-space-4)',
    marginBlockEnd: 'var(--xc-space-2)',
};

const CODE_BOX = {
    fontFamily: 'var(--xc-font-mono, monospace)',
    fontSize: 'var(--xc-text-xs)',
    color: 'var(--xc-text-muted)',
    background: 'var(--xc-surface-2)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    padding: 'var(--xc-space-2)',
    marginBlock: 'var(--xc-space-2)',
    maxHeight: 120,
    overflowY: 'auto',
    overflowWrap: 'anywhere',
};

const FINGERPRINT = {
    fontFamily: 'var(--xc-font-mono, monospace)',
    fontSize: 'var(--xc-text-xs)',
    color: 'var(--xc-text-muted)',
};
