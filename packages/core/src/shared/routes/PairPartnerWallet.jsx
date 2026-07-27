// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import {
    Screen, PageHeader, Button, Input, Textarea, Icon, StatusMessage,
    QrScanner, AnimatedQrFrames, CopyButton, InfoTip,
} from '@xchain-wallet/core/ui';
import { flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';

const MIN_PASSWORD_LENGTH = 8;
const ACCEPTED_WORD_COUNTS = [12, 15, 18, 21, 24];

// A single QR frame stops being scannable somewhere past ~1200 bytes in
// byte mode. Past that we still show the text (copy / paste always works,
// including across an air gap via a USB stick or a typed transfer) and
// say why the QR is missing rather than rendering an unreadable block.
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
        const qrTooBig = !!localCode && localCode.length > MAX_QR_CHARS;
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
                            {qrTooBig ? (
                                <StatusMessage>
                                    This wallet has too many chains switched on for a single QR
                                    code. Copy the text below instead.
                                </StatusMessage>
                            ) : (
                                <AnimatedQrFrames
                                    frames={[localCode]}
                                    fps={1}
                                    alt="Pairing code for the partner wallet to scan"
                                />
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
                        <QrScanner
                            onFrame={(text) => {
                                if (typeof text !== 'string' || text.length === 0) return;
                                setPartnerCode(text.trim());
                                setScanning(false);
                                setError(null);
                            }}
                        />
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
                            onClick={() => setScanning((s) => !s)}
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
