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
    FieldIconButton, FieldNote,
    Screen, PageHeader, Button, FormPage, FormSection, Input, Textarea, Icon,
    ListPage, Notice, StatusMessage, QrScanner, AnimatedQrFrames, CopyButton, useFormErrors,
} from '@xchain-wallet/core/ui';
import { flows as flowsLib } from '@xchain-wallet/core';
import { useProtectedScreen } from '../utils/screenGuard.js';
import { normalizeRecoveryPhrase } from '../../crypto/recoveryPhrase.js';
import {
    encodeXcwChunks,
    createXcwCollector,
    addChunkToCollector,
    XCW_PREFIX,
} from '../../uri/psbtQr.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { formatOrList } from '../../i18n/index.js';
import '../../i18n/locales/en/flows.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { useDocumentTitleSection } from '../hooks/useDocumentTitle.js';
import { NAME_MAX_LENGTH, hasVisibleText, nameLength } from '../../util/display_name.js';
import { useOwnWalletWriteHold } from '../hooks/useOwnWalletWriteHold.js';
import { notifyWalletModesChanged } from '../hooks/useWalletMode.js';
import styles from './PairPartnerWallet.module.css';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { formatWithThousands } from '../utils/amountFormat.js';
import {
    importPhraseFormat,
    importPhraseFormatArg,
    importPhraseRefusal,
} from '../utils/importPhraseCheck.js';

const PAGE_TITLE = 'Phone Signer';
const ACCEPTED_WORD_COUNTS = [12, 15, 18, 21, 24];
const INVALID_PARTNER_CODE = 'That pairing code is invalid or incomplete. '
    + 'Paste or scan the complete code from the other wallet.';

// A single QR frame stops being scannable somewhere past ~1200 bytes in
// byte mode: at 1907 characters the symbol is version 40 (177x177 modules)
// and even the browser's own BarcodeDetector cannot read it off a clean
// 240px bitmap, never mind a camera. Past this threshold the code goes out
// as an ANIMATED sequence of §20.3 XCW chunks instead of one dense frame.
// It is a switch-over point, not a cap: nothing is suppressed above it.
// - a default wallet has three mainnet chains and lands at ~1907
// characters, so the chunked path is the ORDINARY one, not the exception,
// and the QR is the only mechanism an air-gapped pair has.
const MAX_QR_CHARS = 1200;

/**
 * §20.5: the two-phone pairing lane, "Use another phone as a signer".
 *
 * Both halves of the pair are the SAME recovery phrase restored twice: one
 * wallet online in `watcher` mode, one offline in `signer` mode. Before this
 * lane there was no guidance for that and no check that the two halves
 * matched, so a mistyped word surfaced as an unsignable PSBT after the
 * round-trip between the phones, with no explanation attached.
 *
 * It lives in Settings, Advanced (operator ruling 2026-11-15), so the vault is
 * already open: the shared phrase is ADDED to it as a new wallet through
 * `addImportedWallet`, under the vault's own password.
 *
 * The lane runs four stages:
 *
 *   role      pick which half THIS phone is: the wallet's own mode (§20).
 *   seed      add the shared recovery phrase as a new wallet (skipped when
 *             the caller passes an existing `walletId` to re-pair).
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
 * @param {string} [props.walletId]            existing wallet to re-pair. Absent = the Settings, Advanced entry, which adds the shared phrase first.
 * @param {'watcher' | 'signer'} [props.initialMode]   preselects the role stage
 * @param {{ report: (holding: boolean) => void }} [props.ownWriteGuard]   told while this lane imports the shared phrase and until it hands back
 */
export function PairPartnerWallet({ onBack, onPaired, walletId: existingWalletId, initialMode, ownWriteGuard }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [stage, setStage] = useState(
        /** @type {'role' | 'seed' | 'exchange' | 'done'} */ (
            initialMode ? (existingWalletId ? 'exchange' : 'seed') : 'role'
        ),
    );
    // The seed step accepts the shared recovery phrase. Public pairing-code
    // stages remain capturable so the partner device can scan them.
    useProtectedScreen(stage === 'seed');
    const [walletMode, setWalletMode] = useState(
        /** @type {'watcher' | 'signer' | null} */ (initialMode || null),
    );
    const [walletId, setWalletId] = useState(existingWalletId || null);

    const [name, setName] = useState('Paired Wallet');
    // A cleared or blank name field names the wallet by its default; the vault refuses an empty name.
    const walletName = name.trim() || 'Paired Wallet';
    const [mnemonic, setMnemonic] = useState('');
    // The open vault's own password: an added wallet is sealed under it.
    const [password, setPassword] = useState('');

    const [localCode, setLocalCode] = useState(/** @type {string | null} */ (null));
    const [localKeySetId, setLocalKeySetId] = useState(/** @type {string | null} */ (null));
    const [partnerCode, setPartnerCode] = useState('');
    const [scanning, setScanning] = useState(false);
    const [partnerCollector, setPartnerCollector] = useState(() => createXcwCollector());
    const [verification, setVerification] = useState(/** @type {any} */ (null));

    const [error, setError] = useState(/** @type {string | null} */ (null));
    const formErrors = useFormErrors();
    const { clear: clearFormError, fail: failFormError, reset: resetFormErrors } = formErrors;
    const [busy, setBusy] = useState(false);

    const lane = flowsLib.describePairingLane(walletMode);
    // The code exchange follows the lane's own import of the shared phrase, so
    // the lane holds the screen from that import until Finish or Back.
    useOwnWalletWriteHold(ownWriteGuard, !existingWalletId && (walletId !== null || (stage === 'seed' && busy)));

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
                    label: walletName,
                });
                if (cancelled) return;
                // The host wrote the role onto this wallet; readers re-read it.
                notifyWalletModesChanged();
                setLocalCode(res?.encoded || null);
                setLocalKeySetId(
                    res?.payload?.keys ? flowsLib.keySetIdOf(res.payload.keys) : null,
                );
                setError(null);
            } catch (err) {
                if (!cancelled) setError(userFacingMessage(err, 'Could not build this wallet\'s pairing code.'));
            } finally {
                if (!cancelled) setBusy(false);
            }
        })();
        return () => { cancelled = true; };
    }, [stage, walletId, localCode, messaging, password, walletName]);

    // The frames this device shows. A short code uses one still frame. A long
    // one (the normal case: three chains ≈ 1907 characters)
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
    // parsed before it fills the field; XCW chunks accrue until the set and
    // its SHA256 verify. An incomplete set never reaches `pairPartner`.
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
                    failFormError(INVALID_PARTNER_CODE, 'partner-code');
                    return createXcwCollector();
                }
                if (next.complete && next.psbt) {
                    const code = new TextDecoder().decode(next.psbt).trim();
                    try {
                        flowsLib.parsePairingPayload(code);
                    } catch {
                        failFormError(INVALID_PARTNER_CODE, 'partner-code');
                        return createXcwCollector();
                    }
                    setPartnerCode(code);
                    setScanning(false);
                    clearFormError('partner-code');
                    return createXcwCollector();
                }
                clearFormError('partner-code');
                return next;
            });
            return;
        }
        const code = text.trim();
        try {
            flowsLib.parsePairingPayload(code);
        } catch {
            failFormError(INVALID_PARTNER_CODE, 'partner-code');
            return;
        }
        setPartnerCode(code);
        setScanning(false);
        clearFormError('partner-code');
    }, [clearFormError, failFormError]);

    function pickRole(mode) {
        setWalletMode(mode);
        setError(null);
        resetFormErrors();
        setStage(existingWalletId ? 'exchange' : 'seed');
    }

    async function handleSeedSubmit(event) {
        event.preventDefault();
        if (busy) return;
        const trimmed = normalizeRecoveryPhrase(mnemonic);
        const typedName = name.trim();
        const wordCount = trimmed ? trimmed.split(' ').length : 0;
        const acceptedFormat = trimmed && ACCEPTED_WORD_COUNTS.includes(wordCount)
            ? importPhraseFormat(trimmed, false)
            : null;
        const nameError = typedName.length > 0 && !hasVisibleText(typedName)
            ? 'Wallet name must include a visible character.'
            : nameLength(typedName) > NAME_MAX_LENGTH
                ? `Wallet name must be ${NAME_MAX_LENGTH} characters or fewer.`
                : null;
        const phraseError = !trimmed
            ? 'Recovery phrase is required.'
            : !ACCEPTED_WORD_COUNTS.includes(wordCount)
                ? `Expected ${formatOrList(ACCEPTED_WORD_COUNTS)} words, got ${wordCount}.`
                : !acceptedFormat ? importPhraseRefusal(trimmed, false) : null;
        if (!formErrors.validate({
            'wallet-name': nameError,
            'shared-recovery-phrase': phraseError,
            'wallet-password': password.length === 0 ? 'Enter your wallet password.' : null,
        })) return;
        if (typeof messaging.addImportedWallet !== 'function') {
            failFormError('Adding a wallet is not available in this shell.');
            return;
        }
        setError(null);
        setBusy(true);
        try {
            const formatArg = importPhraseFormatArg(acceptedFormat, false);
            // The role picked above is this wallet's mode (§20), so the
            // wallet is added in it.
            const r = await messaging.addImportedWallet({
                password, mnemonic: trimmed, name: walletName, walletMode, ...formatArg,
            });
            const id = r?.wallet?.id || r?.walletId || r?.id || null;
            if (!id) {
                throw new Error('The wallet was added but the shell returned no wallet id, so pairing cannot continue.');
            }
            // `walletMode` also rides along on the pairing requests: the host
            // writes it onto this wallet's record in the same call that reads
            // the keys, so a payload can never advertise a mode the wallet is
            // not actually in.
            setWalletId(id);
            resetFormErrors();
            setStage('exchange');
        } catch (err) {
            failFormError(userFacingMessage(err, 'Could not add the recovery phrase as a wallet.'));
        } finally {
            setBusy(false);
        }
    }

    async function handlePairSubmit(event) {
        event.preventDefault();
        if (busy) return;
        if (partnerCode.trim().length === 0) {
            formErrors.validate({ 'partner-code': 'Paste or scan the pairing code from the other wallet.' });
            return;
        }
        let normalizedPartnerCode;
        try {
            normalizedPartnerCode = normalizePartnerCodeInput(partnerCode);
        } catch (err) {
            formErrors.validate({ 'partner-code': userFacingMessage(err, INVALID_PARTNER_CODE) });
            return;
        }
        if (typeof messaging.pairPartnerRequest !== 'function') {
            failFormError('Wallet pairing is not available in this shell.');
            return;
        }
        setError(null);
        resetFormErrors();
        setBusy(true);
        try {
            const res = await messaging.pairPartnerRequest({
                walletId,
                walletMode,
                partner: normalizedPartnerCode,
                password: password || undefined,
                label: walletName,
            });
            setVerification(res?.verification || null);
            setStage('done');
        } catch (err) {
            // The flow prefixes its refusals with its own name; the reason after it is the copy.
            failFormError(userFacingMessage(
                String(err?.message || '').replace(/^pairPartner:\s*/, ''),
                'The two wallets could not be paired.',
            ));
        } finally {
            setBusy(false);
        }
    }

    // Once the shared phrase is added here the new wallet exists, so leaving
    // hands back through the completion callback, which re-reads the shell's
    // wallets before it shows anything.
    function handleBack() {
        if (!existingWalletId && walletId && typeof onPaired === 'function') {
            onPaired();
            return;
        }
        // Back from the phrase step returns to the role step the indicator
        // counts as step 1, and the typed secrets leave the screen with it.
        if (stage === 'seed' && !initialMode) {
            setMnemonic('');
            setPassword('');
            setError(null);
            resetFormErrors();
            setStage('role');
            return;
        }
        onBack?.();
    }

    // The window title names the page the heading shows.
    useDocumentTitleSection(PAGE_TITLE);
    const step = pairingStep(stage, Boolean(existingWalletId), Boolean(initialMode));
    // G01: the step count is the header subtitle under the title, never a
    // line above the page content. The page opens inside the unlocked shell,
    // so it has no logo header of its own.
    const header = (
        <PageHeader
            onBack={handleBack}
            backDisabled={busy}
            title={PAGE_TITLE}
            subtitle={<StepIndicator {...step} />}
        />
    );

    if (stage === 'role') {
        return (
            <Screen variant={variant} header={header}>
                <ListPage>
                    <Notice tone="info" title="How Pairing Works" role="note">
                        <p>You are pairing this phone with a second phone that keeps the keys offline.</p>
                        <p>Choose what this phone does, then set up the other phone as its partner.</p>
                        <p>Write the recovery phrase down once, then type it into each phone separately. It never travels between them.</p>
                    </Notice>
                    <ActionList label="Phone signer roles">
                        <ActionListItem
                            icon={<Icon.EyeIcon />}
                            title="Sign on another phone"
                            description="This phone stays online. It holds no keys that can sign, builds transactions, and shows balances."
                            onClick={() => pickRole('watcher')}
                        />
                        <ActionListItem
                            icon={<Icon.KeyIcon />}
                            title="Make this phone the signer"
                            description="This phone stays offline. It holds the recovery phrase and signs transactions the other phone builds."
                            onClick={() => pickRole('signer')}
                        />
                    </ActionList>
                </ListPage>
            </Screen>
        );
    }

    if (stage === 'seed') {
        return (
            <Screen variant={variant} header={header}>
                <FormPage
                    label="Pairing setup"
                    onSubmit={handleSeedSubmit}
                    errors={formErrors}
                    status={(
                        <Notice tone="info" title="Shared Phrase" role="note">
                            Enter the same recovery phrase on both phones. The phrase never travels between them.
                        </Notice>
                    )}
                    actions={(
                        <Button
                            type="submit"
                            variant="success"
                            icon={<Icon.ForwardIcon />}
                            loading={busy}
                            disabled={busy}
                        >
                            Continue
                        </Button>
                    )}
                >
                    <Input
                        id="wallet-name"
                        label="Wallet name"
                        help="The name this wallet shows on this phone. Only you see it."
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={busy}
                    />
                    <Textarea
                        id="shared-recovery-phrase"
                        label="Shared recovery phrase"
                        help={lane.help}
                        rows={3}
                        value={mnemonic}
                        onChange={(e) => setMnemonic(e.target.value)}
                        autoComplete="off"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        disabled={busy}
                    />
                    <Input
                        id="wallet-password"
                        label="Wallet password"
                        help="The password you unlock this app with. The added wallet is saved under it too."
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        disabled={busy}
                    />
                </FormPage>
            </Screen>
        );
    }

    if (stage === 'exchange') {
        const frameCount = localFrames ? localFrames.length : 0;
        return (
            <Screen variant={variant} header={header}>
                <FormPage
                    label="Partner code exchange"
                    onSubmit={handlePairSubmit}
                    sectioned
                    errors={formErrors}
                    status={[
                        <Notice key="public-code" tone="info" title="Public Codes" role="note">
                            Pairing codes contain public keys only. They contain no recovery phrase, private key, or spending access.
                        </Notice>,
                        error ? <StatusMessage key="load-error" variant="error">{error}</StatusMessage> : null,
                    ]}
                    actions={(
                        <Button
                            type="submit"
                            variant="success"
                            icon={<Icon.LinkIcon />}
                            loading={busy}
                            disabled={busy}
                        >
                            {lane.cta || 'Pair'}
                        </Button>
                    )}
                >
                    <FormSection title="This wallet’s code">
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
                                        <FieldNote variant="info" role="status">
                                            {`This code is too long for one QR, so it cycles through ${formatWithThousands(String(frameCount))} frames. `
                                                + 'Point the other wallet’s camera at it and hold still until it has them all.'}
                                        </FieldNote>
                                    ) : null}
                                </>
                            ) : (
                                <FieldNote variant="error">
                                    This wallet&rsquo;s pairing code could not be drawn as a QR.
                                    Copy the text below instead.
                                </FieldNote>
                            )}
                            <div className={styles.pairingCode} dir="ltr">
                                <span className={styles.pairingCodeCopy}>
                                    <CopyButton value={localCode} label="Copy Pairing Code" iconOnly />
                                </span>
                                {localCode}
                            </div>
                            {localKeySetId ? (
                                <p className={styles.fullWidthText} style={FINGERPRINT}>
                                    Key fingerprint: {localKeySetId.slice(0, 16)}
                                </p>
                            ) : null}
                        </>
                    ) : (
                        <FieldNote variant="info" role="status">{busy ? 'Building this wallet\'s pairing code…' : 'No pairing code yet.'}</FieldNote>
                    )}
                    </FormSection>

                    <FormSection title={lane.partnerMode === 'signer' ? 'Signer phone\'s code' : 'Other phone\'s code'}>
                    {scanning ? (
                        <>
                            <QrScanner onFrame={handleScanFrame} />
                            {partnerCollector.total ? (
                                <FieldNote variant="info" role="status">
                                    Pairing frames received: {formatWithThousands(String(partnerCollector.receivedCount))} of
                                    {' '}{formatWithThousands(String(partnerCollector.total))}
                                </FieldNote>
                            ) : null}
                        </>
                    ) : null}
                    <Textarea
                        id="partner-code"
                        label="Paste the other wallet's code"
                        help="The pairing code the other wallet shows. Paste it here or scan its QR, and the two wallets are linked."
                        rows={3}
                        value={partnerCode}
                        onChange={(e) => {
                            setPartnerCode(e.target.value);
                        }}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={busy}
                        fieldAction={(
                            <FieldIconButton
                                icon={<Icon.QrCodeIcon />}
                                label={scanning ? 'Stop scanning' : 'Scan the other wallet\'s QR'}
                                aria-pressed={scanning}
                                onClick={() => {
                                    // A re-opened scanner starts from nothing: half a
                                    // set left over from a previous attempt would
                                    // otherwise mix with frames from a different code.
                                    setPartnerCollector(createXcwCollector());
                                    clearFormError('partner-code');
                                    setScanning((s) => !s);
                                }}
                                disabled={busy}
                            />
                        )}
                    />
                    </FormSection>
                </FormPage>
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={header}>
            <ListPage>
                <Notice tone="success" title="Phones Paired">
                    <p>{verification?.message || 'Paired.'}</p>
                    {verification?.sharedChainIds?.length ? (
                        <p style={COPY}>Matching networks: {verification.sharedChainIds.join(', ')}.</p>
                    ) : null}
                </Notice>
                <div style={STACK}>
                    <Button
                        variant="success"
                        block
                        icon={<Icon.CheckIcon />}
                        onClick={() => { (typeof onPaired === 'function' ? onPaired : onBack)?.(); }}
                    >
                        Finish
                    </Button>
                </div>
            </ListPage>
        </Screen>
    );
}

function normalizePartnerCodeInput(input) {
    const trimmed = input.trim();
    const frames = trimmed
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter(Boolean);
    let code = trimmed;

    // Accept a copied capture log as well as the complete text code.
    if (frames.length > 0 && frames.every((frame) => frame.startsWith(XCW_PREFIX))) {
        let collector = createXcwCollector();
        for (const frame of frames) {
            collector = addChunkToCollector(collector, frame);
            if (collector.error) throw new Error(INVALID_PARTNER_CODE);
        }
        if (!collector.complete || !collector.psbt) {
            throw new Error(
                `This multi-frame pairing code is incomplete: received ${collector.receivedCount} `
                + `of ${collector.total || '?'} frames.`,
            );
        }
        code = new TextDecoder().decode(collector.psbt).trim();
    }

    try {
        flowsLib.parsePairingPayload(code);
    } catch {
        throw new Error(INVALID_PARTNER_CODE);
    }
    return code;
}

function pairingStep(stage, hasExistingWallet, hasInitialMode) {
    const stages = hasExistingWallet
        ? (hasInitialMode ? ['exchange', 'done'] : ['role', 'exchange', 'done'])
        : (hasInitialMode ? ['seed', 'exchange', 'done'] : ['role', 'seed', 'exchange', 'done']);
    return { current: Math.max(1, stages.indexOf(stage) + 1), total: stages.length };
}

/** The header subtitle's step count; PageHeader styles the subtitle line. */
function StepIndicator({ current, total }) {
    return (
        <span aria-current="step">
            {`Step ${current} of ${total}`}
        </span>
    );
}

const STACK = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-2)',
};

const COPY = {
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-text-sm)',
    maxWidth: 'none',
};

const FINGERPRINT = {
    fontFamily: 'var(--xc-font-mono, monospace)',
    fontSize: 'var(--xc-text-xs)',
    color: 'var(--xc-text-muted)',
};
