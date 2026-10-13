// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// BackupSection: §35.1 Backup panel.
//
// Live:
//   - Export encrypted backup (.xchain-wallet): wires `exportBackupFile`
//     core flow through the `wallet.exportBackup` host handler.
//   - Back up recovery phrase: wires `revealMnemonic` core flow through
//     the `wallet.revealMnemonic` host handler. Inline password gate;
//     mnemonic blurred until tapped; row collapses on done.
//   - Test backup (dry-run restore): wires `dryRunRestore` core flow
//     through the `wallet.dryRunRestore` host handler. User pastes a
//     candidate mnemonic; the panel renders an overall match flag plus
//     a per-chain comparison report (matched / divergent / missing
//     counts and the address behind every difference).
//   - Publish labels (§19.5.2): prepares the encrypted FILE payload
//     through `wallet.prepareLabels`, then composes, dry-runs and confirms
//     it before `wallet.publishLabels` signs those exact bytes. The result
//     reports the txid + payload size.
//   - Label auto-sync (§19.5.2 cadence): the background debounces
//     label / contact edits and marks ONE publish due per unlock
//     window; this panel surfaces that as a notice which opens the
//     same publish form.
//   - Check chain for backed-up contacts (§19.5.2 restore, on-demand
//     half): the automatic restore only ever runs once, inside the
//     from-seed import flow, so a wallet that already exists has no way
//     to re-pull a payload it published earlier. This button runs the
//     same fetch-and-decrypt against the *current* wallet's seed for a
//     chosen chain, through `wallet.restoreLabels`, and applies whatever
//     it finds with `applyLabelSyncPayload`'s 'preserve' policy, which
//     only adds or updates matching records and never deletes a local
//     contact or label the chain copy doesn't know about.

import { useEffect, useRef, useState } from 'react';
import {
    crypto as cryptoLib,
    flows as flowsLib,
    registry as registryLib,
    uri as uriLib,
} from '@xchain-wallet/core';
import { ChainBadge } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../../useMessaging.js';
import { DiagnosticDetails } from '../DiagnosticDetails.jsx';
import { ActionConfirmScreen } from '../ActionConfirmScreen.jsx';
import { KeyQR } from '../KeyQR.jsx';
import { isUserRejection, useActionConfirmFlow } from '../../hooks/useActionConfirmFlow.js';
import { useSignerReady } from '../../hooks/useSignerReady.js';
import { userFacingMessage } from '../../utils/userFacingMessage.js';
import { copyText } from '../../clipboard.js';
import { useHapticFeedback } from '../../hooks/useHaptic.js';
import { ADDRESS_TYPE_LABEL } from '../../utils/addressTypeLabel.js';
import { ROW, ROW_HINT, STACK, Status } from './_settingsPrimitives.jsx';
import styles from './BackupSection.module.css';

/** How often the Backup panel asks the background whether a batched publish came due. */
const AUTO_SYNC_POLL_MS = 15_000;

const ACTION_BTN = {
    background: 'transparent',
    border: '1px solid var(--xc-border)',
    color: 'var(--xc-text)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-3)',
    fontSize: 'var(--xc-text-sm)',
    cursor: 'pointer',
};

// Treat a seed-decrypt tag mismatch as a mistyped password (its message is the cipher library's).
// Matched by name, since errors cross the shell messaging boundary as plain objects.
function isWrongPasswordError(err) {
    const name = err?.name;
    return name === 'AeadAuthError' || name === 'InvalidPasswordError';
}

/** Plain copy for a password-gated backup step that failed. */
function passwordStepFailure(err, fallback) {
    return isWrongPasswordError(err) ? 'Incorrect password.' : userFacingMessage(err, fallback);
}

/**
 * @param {object} props
 * @param {{ id: string, name: string } | null} [props.activeWallet]
 */
export function BackupSection({ activeWallet }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(activeWallet?.id);
    const actionConfirm = useActionConfirmFlow({ messaging, walletId: activeWallet?.id || '' });
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState(/** @type {string | null} */ (null));
    const [pendingPassword, setPendingPassword] = useState(/** @type {string | null} */ (null));
    const [exportResult, setExportResult] = useState(/** @type {{ fileName: string, walletName: string } | null} */ (null));

    // §19.3 reveal-seed state.
    const [revealStage, setRevealStage] = useState(
        /** @type {'idle' | 'password' | 'shown'} */ ('idle'),
    );
    const [revealing, setRevealing] = useState(false);
    const [revealError, setRevealError] = useState(/** @type {string | null} */ (null));
    const [mnemonic, setMnemonic] = useState('');
    const [mnemonicHidden, setMnemonicHidden] = useState(true);
    const [revealPassphraseEnabled, setRevealPassphraseEnabled] = useState(false);
    const [revealPassphrase, setRevealPassphrase] = useState(/** @type {string | null} */ (null));

    // §19.6 dry-run restore state.
    const [dryRunStage, setDryRunStage] = useState(
        /** @type {'idle' | 'form' | 'running' | 'result'} */ ('idle'),
    );
    const [dryRunError, setDryRunError] = useState(/** @type {string | null} */ (null));
    const [dryRunResult, setDryRunResult] = useState(/** @type {any} */ (null));

    // §19.5.2 publish-labels state.
    const [publishStage, setPublishStage] = useState(
        /** @type {'idle' | 'form' | 'running' | 'result'} */ ('idle'),
    );
    const [publishError, setPublishError] = useState(/** @type {string | null} */ (null));
    const [publishResult, setPublishResult] = useState(/** @type {any} */ (null));
    const [publishPreparation, setPublishPreparation] = useState(/** @type {any} */ (null));
    const [publishPassword, setPublishPassword] = useState('');
    const publishPasswordRef = useRef('');

    // §19.5.2 on-demand restore state ("Check chain for backed-up
    // contacts"). Separate from the auto-sync state above: that one
    // only ever fires once, silently, inside the from-seed import.
    const [restoreStage, setRestoreStage] = useState(
        /** @type {'idle' | 'form' | 'running' | 'result'} */ ('idle'),
    );
    const [restoreError, setRestoreError] = useState(/** @type {string | null} */ (null));
    const [restoreResult, setRestoreResult] = useState(/** @type {any} */ (null));

    // §19.5.2 auto-sync state. The background debounces label / contact
    // edits and marks ONE publish due per unlock window; this panel is
    // where that lands, because publishing needs the wallet password
    // and the wallet never caches the seed to avoid asking.
    const [autoSync, setAutoSync] = useState(/** @type {any} */ (null));
    useEffect(() => {
        if (typeof messaging?.labelSyncStatusRequest !== 'function') return undefined;
        let live = true;
        const poll = () => {
            messaging.labelSyncStatusRequest()
                .then((s) => { if (live) setAutoSync(s); })
                .catch(() => { /* locked or not wired: leave the row hidden */ });
        };
        poll();
        const id = setInterval(poll, AUTO_SYNC_POLL_MS);
        return () => { live = false; clearInterval(id); };
    }, [messaging]);

    const autoSyncDue = Boolean(autoSync?.due) && publishStage === 'idle';

    async function dismissAutoSync() {
        setAutoSync(null);
        if (typeof messaging?.labelSyncDismissRequest === 'function') {
            try { await messaging.labelSyncDismissRequest(); } catch { /* best-effort */ }
        }
    }

    const onExport = async (password) => {
        if (exporting) return;
        if (typeof messaging?.exportBackupFile !== 'function') {
            setExportError('Backup export is not wired in this shell yet.');
            return;
        }
        if (!activeWallet?.id) {
            setExportError('No active wallet to back up.');
            return;
        }
        setExporting(true);
        setExportError(null);
        try {
            const { fileContent } = await messaging.exportBackupFile({
                walletId: activeWallet.id,
                password,
            });
            const saved = triggerDownload(activeWallet.name || activeWallet.id, fileContent);
            // §19.7 / G034: successful encrypted-backup export counts as
            // a fresh backup verification for reminder purposes.
            try { flowsLib.markBackupVerified(activeWallet.id); } catch { /* best-effort */ }
            setExportResult(saved);
            setPendingPassword(null);
        } catch (err) {
            setExportError(userFacingMessage(err, 'Could not export the backup. Try again.'));
        } finally {
            setExporting(false);
        }
    };

    const onReveal = async (password) => {
        if (typeof messaging?.revealMnemonicRequest !== 'function') {
            setRevealError('Recovery phrase reveal is not wired in this shell yet.');
            return;
        }
        if (!activeWallet?.id) {
            setRevealError('No active wallet.');
            return;
        }
        setRevealing(true);
        setRevealError(null);
        try {
            const r = await messaging.revealMnemonicRequest({
                walletId: activeWallet.id,
                password,
            });
            setMnemonic(r?.mnemonic || '');
            setRevealPassphraseEnabled(Boolean(r?.passphraseEnabled));
            setRevealPassphrase(typeof r?.bip39Passphrase === 'string' ? r.bip39Passphrase : null);
            setRevealStage('shown');
            setMnemonicHidden(true);
        } catch (err) {
            const name = err?.name || '';
            const msg = name === 'NoMnemonicForWifOnlyError'
                ? 'This wallet was imported from a private key only. There is no recovery phrase to reveal.'
                : passwordStepFailure(err, 'Could not show the recovery phrase. Try again.');
            setRevealError(msg);
        } finally {
            setRevealing(false);
        }
    };

    function handleHideMnemonic() {
        setMnemonic('');
        setRevealPassphraseEnabled(false);
        setRevealPassphrase(null);
        setMnemonicHidden(true);
        setRevealStage('idle');
        setRevealError(null);
    }

    async function runDryRun({ mnemonic: candidate, format, bip39Passphrase, gapLimit }) {
        if (typeof messaging?.dryRunRestoreRequest !== 'function') {
            setDryRunError('Dry-run restore is not wired in this shell yet.');
            return;
        }
        if (!activeWallet?.id) {
            setDryRunError('No active wallet.');
            return;
        }
        setDryRunStage('running');
        setDryRunError(null);
        try {
            const r = await messaging.dryRunRestoreRequest({
                walletId: activeWallet.id,
                mnemonic: candidate,
                format,
                bip39Passphrase,
                gapLimit,
            });
            setDryRunResult(r);
            setDryRunStage('result');
        } catch (err) {
            // Say what to fix for a mistyped phrase; filter any other flow error to plain copy.
            setDryRunError(err?.name === 'InvalidMnemonicError'
                ? "That recovery phrase isn't valid. Check each word and its order against your backup, and that the format selected matches it."
                : userFacingMessage(err, 'Dry-run restore failed.'));
            setDryRunStage('form');
        }
    }

    function resetDryRun() {
        setDryRunResult(null);
        setDryRunError(null);
        setDryRunStage('idle');
    }

    async function runPublish({ chainId, password }) {
        // Require a chain with a source address for the FILE action.
        if (!chainId) { setPublishError('Choose a chain with an address to publish labels.'); return; }
        // Require the wallet credential before preparing encrypted labels.
        if (!password) { setPublishError('Enter your wallet password to publish labels.'); return; }
        if (typeof messaging?.prepareLabelsRequest !== 'function') {
            setPublishError('Label preparation is not wired in this shell yet.');
            return;
        }
        if (typeof messaging?.publishLabelsRequest !== 'function') {
            setPublishError('Label publish is not wired in this shell yet.');
            return;
        }
        if (!activeWallet?.id) {
            setPublishError('No active wallet.');
            return;
        }
        setPublishStage('running');
        setPublishError(null);
        setPublishPassword(password);
        publishPasswordRef.current = password;
        try {
            const preparation = await messaging.prepareLabelsRequest({
                walletId: activeWallet.id,
                password,
                chainId,
            });
            setPublishPreparation(preparation);
            const r = await actionConfirm.run({
                chainId: preparation.chainId,
                from: preparation.from,
                actionData: preparation.actionData,
                encoderOpts: preparation.encoderOpts,
                onApprove: (prebuiltPsbt) => messaging.publishLabelsRequest({
                    walletId: activeWallet.id,
                    password: publishPasswordRef.current,
                    chainId: preparation.chainId,
                    preparation,
                    prebuiltPsbt,
                }),
            });
            setPublishResult(r);
            setPublishStage('result');
            setPublishPreparation(null);
            // The background clears the pending batch on a successful
            // publish; drop it here too so the notice goes away without
            // waiting for the next poll. A queued publish has not landed,
            // so its batch stays pending and the notice stays.
            if (!r?.queued) setAutoSync(null);
        } catch (err) {
            if (!isUserRejection(err)) {
                setPublishError(passwordStepFailure(err, 'Failed to publish labels.'));
            }
            setPublishStage('form');
        } finally {
            setPublishPassword('');
            publishPasswordRef.current = '';
        }
    }

    function resetPublish() {
        setPublishResult(null);
        setPublishError(null);
        setPublishPreparation(null);
        setPublishPassword('');
        publishPasswordRef.current = '';
        setPublishStage('idle');
    }

    /**
     * §19.5.2 restore, on-demand half. No signature and no broadcast, so
     * this skips `actionConfirm` entirely: it is a read (fetch the FILE,
     * decrypt it against this wallet's own seed) and a vault write, not a
     * transaction. `wallet.restoreLabels` derives the seed itself from the
     * password and never returns it here.
     */
    async function runRestore({ chainId, password }) {
        if (typeof messaging?.restoreLabelsRequest !== 'function') {
            setRestoreError('Chain restore is not wired in this shell yet.');
            return;
        }
        if (!activeWallet?.id) {
            setRestoreError('No active wallet.');
            return;
        }
        setRestoreStage('running');
        setRestoreError(null);
        try {
            const r = await messaging.restoreLabelsRequest({
                walletId: activeWallet.id,
                password,
                chainId,
            });
            // The result never says which chain it searched when nothing
            // authenticated (chainId comes back null on a miss), so the
            // requested chain rides along for the "not found on X" copy.
            setRestoreResult({ ...r, requestedChainId: chainId });
            setRestoreStage('result');
        } catch (err) {
            setRestoreError(passwordStepFailure(err, 'Failed to check the chain for backed-up contacts.'));
            setRestoreStage('form');
        }
    }

    function resetRestore() {
        setRestoreResult(null);
        setRestoreError(null);
        setRestoreStage('idle');
    }

    if (actionConfirm.open) {
        // The decoder sees only FILE params, which carry no encryption flag
        // for this payload, so its warning can't tell the user that this one
        // is unreadable without the seed. The panel that built it can.
        return (
            <div style={STACK}>
                <div style={ROW_HINT} data-testid="publish-labels-encrypted-note">
                    Your labels and contacts are encrypted with a key from this wallet's
                    seed before publishing. The file on the blockchain is unreadable
                    without your seed.
                </div>
                <ActionConfirmScreen
                    confirmAction={actionConfirm.confirmAction}
                    screenVariant={screenVariantFor(shell)}
                    chainLabel={publishPreparation?.chainId || ''}
                    signerReady={signerReady}
                    password={publishPassword}
                    onPasswordChange={(value) => {
                        setPublishPassword(value);
                        publishPasswordRef.current = value;
                    }}
                    chainId={publishPreparation?.chainId}
                    getSignerStatus={messaging.getSignerStatus}
                />
            </div>
        );
    }

    return (
        <div style={STACK}>
            {exportResult ? (
                <BackupExportResult
                    result={exportResult}
                    onDone={() => setExportResult(null)}
                />
            ) : pendingPassword !== null ? (
                <PasswordPrompt
                    label="Backup password"
                    hint={`Choose a password of at least ${flowsLib.MIN_BACKUP_PASSWORD_LENGTH} characters to encrypt this file separately from your wallet password before the browser saves it to its configured download location, usually the Downloads folder.`}
                    busy={exporting}
                    onCancel={() => { setPendingPassword(null); setExportError(null); }}
                    onSubmit={(pw) => onExport(pw)}
                    error={exportError}
                />
            ) : (
                <BackupRow
                    label="Export encrypted backup"
                    /* Spec §19.4 */
                    hint="Save the wallet, addresses, labels, contacts, settings, and pending transactions in an encrypted .xchain-wallet file that requires its separate backup password."
                    actionLabel="Export…"
                    disabled={!activeWallet}
                    onClick={() => { setPendingPassword(''); setExportError(null); setExportResult(null); }}
                />
            )}

            {revealStage === 'password' ? (
                <UnlockPrompt
                    label="Reveal recovery phrase"
                    hint="Enter your wallet password only when no one else can see this master key to your funds."
                    busy={revealing}
                    onCancel={() => { setRevealStage('idle'); setRevealError(null); }}
                    onSubmit={(pw) => onReveal(pw)}
                    error={revealError}
                />
            ) : revealStage === 'shown' ? (
                <RevealedMnemonic
                    mnemonic={mnemonic}
                    hidden={mnemonicHidden}
                    walletName={activeWallet?.name || activeWallet?.id || 'Wallet'}
                    passphraseEnabled={revealPassphraseEnabled}
                    passphrase={revealPassphrase}
                    onToggle={() => setMnemonicHidden((h) => !h)}
                    onPrint={printRecoverySheet}
                    onDone={handleHideMnemonic}
                />
            ) : (
                <BackupRow
                    label="Back up recovery phrase"
                    hint="Use the wallet password to reveal the words for copying to paper or another device."
                    actionLabel="Show…"
                    disabled={!activeWallet}
                    onClick={() => { setRevealStage('password'); setRevealError(null); }}
                />
            )}
            {dryRunStage === 'form' || dryRunStage === 'running' ? (
                <DryRunForm
                    busy={dryRunStage === 'running'}
                    error={dryRunError}
                    onCancel={resetDryRun}
                    onSubmit={runDryRun}
                />
            ) : dryRunStage === 'result' ? (
                <DryRunReport
                    result={dryRunResult}
                    onDone={resetDryRun}
                />
            ) : (
                <BackupRow
                    label="Test backup (dry-run restore)"
                    /* Spec §19.6 */
                    hint="Check a recovery phrase against this wallet's existing addresses without saving it and erase it from memory afterward."
                    actionLabel="Test…"
                    disabled={!activeWallet}
                    onClick={() => { setDryRunStage('form'); setDryRunError(null); }}
                />
            )}
            {autoSyncDue ? (
                <LabelSyncDueNotice
                    changeCount={autoSync?.batch?.changeCount ?? autoSync?.changeCount ?? 0}
                    disabled={!activeWallet}
                    onPublish={() => { setPublishStage('form'); setPublishError(null); }}
                    onDismiss={dismissAutoSync}
                />
            ) : null}
            {publishStage === 'form' || publishStage === 'running' ? (
                <PublishLabelsForm
                    walletId={activeWallet?.id}
                    busy={publishStage === 'running'}
                    error={publishError}
                    password={publishPassword}
                    onPasswordChange={(value) => {
                        setPublishPassword(value);
                        publishPasswordRef.current = value;
                        if (publishError) setPublishError(null);
                    }}
                    onCancel={resetPublish}
                    onSubmit={runPublish}
                />
            ) : publishStage === 'result' ? (
                <PublishLabelsReport
                    result={publishResult}
                    onDone={resetPublish}
                />
            ) : (
                <BackupRow
                    label="Publish labels on-chain"
                    hint="Encrypt this wallet's labels + contacts and store a copy on the blockchain, so restoring from your seed can recover them."
                    actionLabel="Publish now…"
                    disabled={!activeWallet}
                    onClick={() => { setPublishStage('form'); setPublishError(null); }}
                />
            )}
            {restoreStage === 'form' || restoreStage === 'running' ? (
                <RestoreLabelsForm
                    walletId={activeWallet?.id}
                    busy={restoreStage === 'running'}
                    error={restoreError}
                    onCancel={resetRestore}
                    onSubmit={runRestore}
                />
            ) : restoreStage === 'result' ? (
                <RestoreLabelsReport
                    result={restoreResult}
                    onDone={resetRestore}
                />
            ) : (
                <BackupRow
                    label="Check chain for backed-up contacts"
                    hint="Looks for labels and contacts you published earlier on the selected chain and merges anything found into this wallet, without erasing what's already here."
                    actionLabel="Check…"
                    disabled={!activeWallet}
                    onClick={() => { setRestoreStage('form'); setRestoreError(null); }}
                />
            )}
        </div>
    );
}

/**
 * §19.5.2 auto-sync notice. Shown once per unlock window, after label
 * edits have settled, because the on-chain copy is now behind. It asks
 * rather than publishes: the wallet never keeps the seed around, so
 * only the user (with the password) can complete the write.
 *
 * @param {object} props
 * @param {number} props.changeCount
 * @param {boolean} [props.disabled]
 * @param {() => void} props.onPublish
 * @param {() => void} props.onDismiss
 */
function LabelSyncDueNotice({ changeCount, disabled, onPublish, onDismiss }) {
    const what = changeCount === 1 ? '1 label change' : `${changeCount} label changes`;
    return (
        <div
            style={{
                ...ROW,
                alignItems: 'flex-start',
                gap: 'var(--xc-space-2)',
                border: '1px solid var(--xc-border)',
                borderRadius: 'var(--xc-radius-sm)',
                padding: 'var(--xc-space-3)',
            }}
        >
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>
                    Labels changed since the last publish
                </span>
                <span style={ROW_HINT}>
                    {what}
                    {' '}
                    have not been saved to the blockchain yet. Publishing needs your
                    wallet password, so the wallet asks once instead of after every
                    rename.
                </span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)' }}>
                <button type="button" onClick={onDismiss} style={ACTION_BTN}>
                    Not now
                </button>
                <button
                    type="button"
                    onClick={onPublish}
                    disabled={disabled}
                    style={{
                        ...ACTION_BTN,
                        opacity: disabled ? 0.5 : 1,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                >
                    Publish…
                </button>
            </div>
        </div>
    );
}

function BackupRow({ label, hint, actionLabel, disabled, onClick }) {
    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>{label}</span>
                {hint ? <span style={ROW_HINT}>{hint}</span> : null}
            </div>
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                style={{
                    ...ACTION_BTN,
                    opacity: disabled ? 0.5 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                }}
            >
                {actionLabel}
            </button>
        </div>
    );
}

/**
 * Single-password unlock prompt used by the §19.3 seed-phrase reveal
 * flow. Differs from `<PasswordPrompt>` (the backup-export flow) by
 * not asking for confirmation, since the user is entering an EXISTING
 * password rather than picking a new one.
 */
function UnlockPrompt({ label, hint, busy, error, onCancel, onSubmit }) {
    const [pw, setPw] = useState('');
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: '1px solid var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{ color: 'var(--xc-text)', fontWeight: 500 }}>{label}</div>
            {hint ? <div style={ROW_HINT}>{hint}</div> : null}
            <input
                type="password"
                placeholder="Wallet password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoFocus
                autoComplete="current-password"
                aria-label="Wallet password"
                style={passwordStyle}
            />
            {error ? <Status text={error} tone="error" /> : null}
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                <button type="button" onClick={onCancel} style={ACTION_BTN} disabled={busy}>Cancel</button>
                <button
                    type="button"
                    onClick={() => onSubmit(pw)}
                    disabled={busy || pw.length === 0}
                    style={{
                        ...ACTION_BTN,
                        background: pw.length > 0 ? 'var(--xc-accent-primary)' : 'transparent',
                        borderColor: pw.length > 0 ? 'var(--xc-accent-primary)' : 'var(--xc-border)',
                        color: pw.length > 0 ? 'var(--xc-bg)' : 'var(--xc-text-muted)',
                    }}
                >
                    {busy ? 'Revealing…' : 'Reveal'}
                </button>
            </div>
        </div>
    );
}

/**
 * Tap-to-reveal mnemonic display. The seed is rendered with a CSS blur
 * filter when hidden, so the layout is stable but the text isn't
 * legible without an explicit user action. Window-blur privacy
 * (§26 / G069) layers on top via `usePrivacyBlur`.
 *
 * §15.6: a wallet with a stored 25th-word passphrase shows it under the
 * words, behind the same tap-to-reveal blur and the same password gate
 * as the seed itself. There is no separate reveal toggle and no copy
 * control for it, matching the seed row above (see the "never paste it
 * into anything else" hint), since a clipboard write here would
 * contradict that same sentence. A wallet without `passphraseEnabled`
 * renders nothing extra; a legacy wallet that has not captured its
 * passphrase yet (`passphraseEnabled` true, nothing stored) gets one
 * line saying so instead of a blank row.
 */
function RevealedMnemonic({
    mnemonic,
    hidden,
    walletName,
    passphraseEnabled,
    passphrase,
    onToggle,
    onPrint,
    onDone,
}) {
    return (
        <div className={styles.recoverySheet} data-xc-recovery-sheet style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: '1px solid var(--xc-warning, var(--xc-border-strong))',
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{ color: 'var(--xc-text)', fontWeight: 500 }}>
                Your recovery phrase
            </div>
            <div className={styles.sheetMeta}>Wallet: {walletName}</div>
            <div style={ROW_HINT}>
                Write it on paper or store it in a password manager. Never type or
                paste it into anything else. The wallet has nothing else that can
                recover this. Losing the seed and your password loses the funds.
            </div>
            <button
                type="button"
                onClick={onToggle}
                aria-label={hidden ? 'Reveal recovery phrase' : 'Hide recovery phrase'}
                className={styles.secret}
                style={{
                    background: 'var(--xc-bg)',
                    border: '1px solid var(--xc-border)',
                    borderRadius: 'var(--xc-radius-md)',
                    padding: 'var(--xc-space-3)',
                    fontFamily: 'var(--xc-font-mono)',
                    fontSize: 'var(--xc-text-sm)',
                    color: 'var(--xc-text)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    filter: hidden ? 'blur(8px)' : 'none',
                    transition: 'filter 200ms',
                    minHeight: 60,
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                }}
            >
                {mnemonic || ' '}
            </button>
            {passphraseEnabled && typeof passphrase === 'string' ? (
                <>
                    <div style={{ color: 'var(--xc-text)', fontWeight: 500 }}>
                        Passphrase (25th word)
                    </div>
                    <button
                        type="button"
                        onClick={onToggle}
                        aria-label={hidden ? 'Reveal passphrase' : 'Hide passphrase'}
                        className={styles.secret}
                        style={{
                            background: 'var(--xc-bg)',
                            border: '1px solid var(--xc-border)',
                            borderRadius: 'var(--xc-radius-md)',
                            padding: 'var(--xc-space-3)',
                            fontFamily: 'var(--xc-font-mono)',
                            fontSize: 'var(--xc-text-sm)',
                            color: 'var(--xc-text)',
                            textAlign: 'left',
                            cursor: 'pointer',
                            filter: hidden ? 'blur(8px)' : 'none',
                            transition: 'filter 200ms',
                            minHeight: 60,
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                        }}
                    >
                        {passphrase || ' '}
                    </button>
                </>
            ) : passphraseEnabled ? (
                <div style={ROW_HINT}>
                    This wallet uses a 25th-word passphrase, but it has not been
                    stored on this device yet.
                </div>
            ) : null}
            <div className={styles.screenOnly} style={{
                color: 'var(--xc-text-muted)',
                fontSize: 'var(--xc-text-xs)',
                textAlign: 'center',
            }}>
                {hidden ? 'Tap to reveal.' : 'Tap to hide again.'}
            </div>
            <div className={styles.screenOnly} style={{ display: 'flex', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                {!hidden ? (
                    <button type="button" onClick={onPrint} style={ACTION_BTN}>
                        Print recovery sheet
                    </button>
                ) : null}
                <button type="button" onClick={onDone} style={ACTION_BTN}>
                    Done
                </button>
            </div>
        </div>
    );
}

/**
 * Dry-run restore form: paste mnemonic, pick format / passphrase /
 * gap limit, fire the comparison.
 */
function DryRunForm({ busy, error, onCancel, onSubmit }) {
    const [mn, setMn] = useState('');
    const [format, setFormat] = useState(/** @type {'bip39' | 'counterwallet-legacy'} */ ('bip39'));
    const [passphrase, setPassphrase] = useState('');
    const [gapLimit, setGapLimit] = useState('10');

    const gapLimitNumber = Number(gapLimit);
    const gapLimitValid = /^\d+$/.test(gapLimit)
        && gapLimitNumber >= 1
        && gapLimitNumber <= 100;
    const canSubmit = mn.trim().length > 0 && gapLimitValid && !busy;

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: '1px solid var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Test backup</div>
            <div style={ROW_HINT}>
                Enter the recovery phrase from your paper backup (or password manager).
                The wallet rebuilds the first {gapLimitValid ? gapLimitNumber : 'selected'} addresses on every active chain
                from it and lists any that don't match. Nothing is saved.
            </div>
            <textarea
                value={mn}
                onChange={(e) => setMn(e.target.value)}
                placeholder="Recovery phrase, words separated by spaces"
                rows={3}
                autoComplete="off"
                spellCheck={false}
                aria-label="Recovery phrase to test"
                style={{ ...passwordStyle, fontFamily: 'var(--xc-font-mono)', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--xc-text-sm)' }}>
                    <span>Format:</span>
                    <select
                        value={format}
                        onChange={(e) => setFormat(/** @type {any} */ (e.target.value))}
                        aria-label="Phrase format"
                        style={passwordStyle}
                    >
                        <option value="bip39">Standard (BIP39)</option>
                        <option value="counterwallet-legacy">Counterwallet legacy</option>
                    </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--xc-text-sm)' }}>
                    <span>Addresses to check:</span>
                    <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={100}
                        step={1}
                        value={gapLimit}
                        onChange={(e) => setGapLimit(e.target.value)}
                        aria-label="Addresses to check"
                        style={{ ...passwordStyle, width: 70 }}
                    />
                </label>
            </div>
            {format === 'bip39' ? (
                <input
                    type="password"
                    placeholder="BIP39 passphrase (optional)"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    autoComplete="off"
                    aria-label="BIP39 passphrase"
                    style={passwordStyle}
                />
            ) : null}
            {!gapLimitValid ? (
                <Status text="Addresses to check must be a whole number from 1 to 100." tone="error" />
            ) : null}
            {error ? <Status text={error} tone="error" /> : null}
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                <button type="button" onClick={onCancel} style={ACTION_BTN} disabled={busy}>Cancel</button>
                <button
                    type="button"
                    onClick={() => onSubmit({
                        mnemonic: mn.trim(),
                        format,
                        bip39Passphrase: format === 'bip39' ? passphrase : '',
                        gapLimit: gapLimitNumber,
                    })}
                    disabled={!canSubmit}
                    style={{
                        ...ACTION_BTN,
                        background: canSubmit ? 'var(--xc-accent-primary)' : 'transparent',
                        borderColor: canSubmit ? 'var(--xc-accent-primary)' : 'var(--xc-border)',
                        color: canSubmit ? 'var(--xc-bg)' : 'var(--xc-text-muted)',
                    }}
                >
                    {busy ? 'Testing…' : 'Run test'}
                </button>
            </div>
        </div>
    );
}

/**
 * Dry-run comparison report. Shows the overall match flag and a
 * per-chain breakdown with every divergent or missing address.
 */
function DryRunReport({ result, onDone }) {
    const overall = result?.overallMatch === true;
    const perChain = Array.isArray(result?.perChain) ? result.perChain : [];
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: `1px solid ${overall ? 'var(--xc-accent-primary)' : 'var(--xc-danger)'}`,
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{
                color: overall ? 'var(--xc-text)' : 'var(--xc-danger)',
                fontWeight: 600,
            }}>
                {overall
                    ? '✓ Backup matches this wallet on every active chain.'
                    : '✗ Backup does NOT match this wallet on at least one chain.'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {perChain.map((c) => (
                    <DryRunChainReport key={`${c.chainId}-${c.addressType}`} chain={c} />
                ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" onClick={onDone} style={ACTION_BTN}>Done</button>
            </div>
        </div>
    );
}

const chainRegistry = registryLib.defaultRegistry();

function DryRunChainReport({ chain }) {
    const descriptor = chain.chainId ? chainRegistry.get(chain.chainId) : null;
    const typeLabel = ADDRESS_TYPE_LABEL[chain.addressType] || chain.addressType;
    const derivedByIndex = new Map(
        (Array.isArray(chain.derived) ? chain.derived : []).map((item) => [item.index, item]),
    );
    // List every address that differs in plain words, both addresses in full
    // so the user can reconcile them; the derivation path goes to the details.
    const differences = (Array.isArray(chain.comparisons) ? chain.comparisons : [])
        .filter((comparison) => comparison.match !== true)
        .map((comparison) => {
            const derived = derivedByIndex.get(comparison.index);
            const label = `Address #${comparison.index + 1}`;
            const address = comparison.derived || derived?.address || 'unknown';
            const reason = comparison.expected === null
                ? `not in your wallet yet; this recovery phrase gives ${address}`
                : `your wallet has ${comparison.expected}, but this recovery phrase gives ${address}`;
            return {
                key: `${comparison.index}-${comparison.expected || 'new'}`,
                text: `${label}: ${reason}`,
                detail: { subject: label, message: derived?.path || `index ${comparison.index}` },
            };
        });
    return (
        <div style={{ fontSize: 'var(--xc-text-sm)', color: 'var(--xc-text)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--xc-space-2)' }}>
                <span>
                    {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chain.chainId}{' '}
                    <span style={{ color: 'var(--xc-text-muted)' }} title={chain.addressType}>{typeLabel}</span>
                </span>
                <span style={{ fontFamily: 'var(--xc-font-mono)' }}>
                    <span style={{ color: 'var(--xc-accent-text)' }}>{chain.matchedCount} ✓</span>
                    {chain.divergentCount > 0
                        ? <span style={{ color: 'var(--xc-danger-fg)' }}> · {chain.divergentCount} ✗</span>
                        : null}
                    {chain.missingCount > 0
                        ? <span style={{ color: 'var(--xc-text-muted)' }}> · {chain.missingCount} new</span>
                        : null}
                </span>
            </div>
            {differences.length > 0 ? (
                <ul style={{ marginBlock: 4, paddingInlineStart: 'var(--xc-space-5)' }}>
                    {differences.map((difference) => (
                        <li key={difference.key} style={{ fontFamily: 'var(--xc-font-mono)', overflowWrap: 'anywhere' }}>
                            {difference.text}
                        </li>
                    ))}
                </ul>
            ) : null}
            <DiagnosticDetails
                summary="Technical details"
                items={differences.map((difference) => difference.detail)}
            />
        </div>
    );
}

function PasswordPrompt({ label, hint, busy, error, onCancel, onSubmit }) {
    const [pw1, setPw1] = useState('');
    const [pw2, setPw2] = useState('');
    const passwordStrongEnough = pw1.length >= flowsLib.MIN_BACKUP_PASSWORD_LENGTH;
    const mismatch = pw2.length > 0 && pw1 !== pw2;
    const canSubmit = passwordStrongEnough && pw2.length > 0 && pw1 === pw2 && !busy;
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: '1px solid var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{ color: 'var(--xc-text)', fontWeight: 500 }}>{label}</div>
            {hint ? <div style={ROW_HINT}>{hint}</div> : null}
            <input
                type="password"
                placeholder="Backup password"
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                autoFocus
                autoComplete="new-password"
                aria-label="Backup password"
                disabled={busy}
                style={passwordStyle}
            />
            <input
                type="password"
                placeholder="Confirm password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                autoComplete="new-password"
                aria-label="Confirm backup password"
                disabled={busy}
                style={passwordStyle}
            />
            {pw1.length > 0 && !passwordStrongEnough ? (
                <Status
                    text={`Backup password must be at least ${flowsLib.MIN_BACKUP_PASSWORD_LENGTH} characters.`}
                    tone="error"
                />
            ) : null}
            {mismatch ? (
                <Status text="Backup passwords do not match." tone="error" />
            ) : null}
            {error ? <Status text={error} tone="error" /> : null}
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                <button type="button" onClick={onCancel} style={ACTION_BTN} disabled={busy}>Cancel</button>
                <button
                    type="button"
                    onClick={() => onSubmit(pw1)}
                    disabled={!canSubmit}
                    style={{
                        ...ACTION_BTN,
                        background: canSubmit ? 'var(--xc-accent-primary)' : 'transparent',
                        borderColor: canSubmit ? 'var(--xc-accent-primary)' : 'var(--xc-border)',
                        color: canSubmit ? 'var(--xc-bg)' : 'var(--xc-text-muted)',
                    }}
                >
                    {busy ? 'Exporting…' : 'Export'}
                </button>
            </div>
        </div>
    );
}

function BackupExportResult({ result, onDone }) {
    const [location, setLocation] = useState('');
    const [pointer, setPointer] = useState('');
    const [pointerError, setPointerError] = useState(/** @type {string | null} */ (null));

    const createPointer = () => {
        setPointer('');
        setPointerError(null);
        let url;
        try {
            url = new URL(location.trim());
        } catch {
            setPointerError('Enter the full HTTPS address where the encrypted backup file is stored.');
            return;
        }
        // Require an encrypted transport because another device fetches the backup from this exact address.
        if (url.protocol !== 'https:') {
            setPointerError('The backup location must use HTTPS.');
            return;
        }
        setPointer(uriLib.buildBackupPointer({
            location: url.toString(),
            name: result.walletName,
        }));
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: '1px solid var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Backup file saved</div>
            <Status text={result.fileName} />
            <div style={ROW_HINT}>
                Your browser sent this file to its configured download location, usually the Downloads folder. Move it somewhere safe and recoverable. The password is not in the file and cannot be recovered.
            </div>
            <div style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Optional backup pointer QR</div>
            <div style={ROW_HINT}>
                After uploading the encrypted file to an HTTPS address you control, enter that address to make a QR for another device. The QR contains only the address and wallet name. It does not contain the backup file or password.
            </div>
            <input
                type="url"
                placeholder="https://example.com/my-backup.xchain-wallet"
                value={location}
                onChange={(e) => { setLocation(e.target.value); setPointer(''); setPointerError(null); }}
                aria-label="Backup file HTTPS address"
                autoComplete="off"
                style={passwordStyle}
            />
            {pointerError ? <Status text={pointerError} tone="error" /> : null}
            {pointer ? (
                <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--xc-space-2)' }}>
                    <KeyQR value={pointer} alt="Backup pointer QR" />
                    <code style={{ overflowWrap: 'anywhere', color: 'var(--xc-text-muted)' }}>{pointer}</code>
                </div>
            ) : null}
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                <button type="button" onClick={createPointer} style={ACTION_BTN}>Create pointer QR</button>
                <button type="button" onClick={onDone} style={ACTION_BTN}>Done</button>
            </div>
        </div>
    );
}

function printRecoverySheet() {
    document.body.classList.add('xc-print-recovery-sheet');
    try {
        window.print();
    } finally {
        document.body.classList.remove('xc-print-recovery-sheet');
    }
}

const passwordStyle = {
    background: 'var(--xc-bg)',
    color: 'var(--xc-text)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-2) var(--xc-space-3)',
    fontSize: 'var(--xc-text-sm)',
    fontFamily: 'inherit',
};

function triggerDownload(fallbackWalletName, fileContent) {
    if (typeof fileContent !== 'string') {
        throw new Error('Backup export returned no file contents.');
    }
    let envelope;
    try {
        envelope = cryptoLib.parseBackupEnvelope(fileContent);
    } catch {
        throw new Error('Backup export returned an invalid file.');
    }
    const walletName = typeof envelope.walletName === 'string' && envelope.walletName.length > 0
        ? envelope.walletName
        : fallbackWalletName;
    const safeName = String(walletName || 'wallet')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^[._-]+|[._-]+$/g, '')
        .slice(0, 60)
        .replace(/[._-]+$/g, '') || 'wallet';
    const createdAt = new Date(envelope.createdAt);
    const stamp = Number.isNaN(createdAt.getTime())
        ? new Date().toISOString().slice(0, 10)
        : createdAt.toISOString().slice(0, 10);
    const fileName = `${safeName}-backup-${stamp}.xchain-wallet`;
    const blob = new Blob([fileContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { fileName, walletName: String(walletName || 'wallet') };
}

/**
 * §19.5.2 publish-labels form. Pulls the wallet's address-bearing
 * chains from `messaging.getAddressesByChain` so the picker only
 * surfaces chains where the FILE action can actually be broadcast,
 * then takes the wallet password and prepares the encrypted FILE payload.
 */
function PublishLabelsForm({ walletId, busy, error, password, onPasswordChange, onCancel, onSubmit }) {
    const { messaging } = useMessaging();
    const [chains, setChains] = useState(/** @type {string[] | null} */ (null));
    const [chainId, setChainId] = useState(/** @type {string} */ (''));
    const [chainsError, setChainsError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        if (!walletId || typeof messaging?.getAddressesByChain !== 'function') {
            setChains([]);
            return () => { cancelled = true; };
        }
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                const ids = Object.keys(byChain || {})
                    .filter((cid) => Array.isArray(byChain[cid]) && byChain[cid].length > 0);
                setChains(ids);
                if (ids.length > 0) setChainId(ids[0]);
            })
            .catch((err) => {
                if (cancelled) return;
                setChains([]);
                setChainsError(err?.message || 'Failed to load chains.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const loadingChains = chains === null;
    const canSubmit = !busy && !loadingChains;

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: '1px solid var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Publish labels on-chain</div>
            <div style={ROW_HINT}>
                The labels + contacts are encrypted under a key derived from this
                wallet's seed and stored on the blockchain. Only someone who already
                has your seed can decrypt them. The transaction pays a network fee.
            </div>
            {chains === null ? (
                <div style={ROW_HINT}>Loading chains…</div>
            ) : chains.length === 0 ? (
                <Status text={chainsError || 'No chains have addresses on this wallet. Generate one first.'} tone="error" />
            ) : (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--xc-text-sm)' }}>
                    <span style={ROW_HINT}>Chain</span>
                    <select
                        value={chainId}
                        onChange={(e) => setChainId(e.target.value)}
                        aria-label="Publish chain"
                        style={passwordStyle}
                    >
                        {chains.map((cid) => (
                            <option key={cid} value={cid}>{cid}</option>
                        ))}
                    </select>
                </label>
            )}
            <input
                type="password"
                placeholder="Wallet password"
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                autoFocus
                autoComplete="current-password"
                aria-label="Wallet password"
                style={passwordStyle}
            />
            {error ? <Status text={error} tone="error" /> : null}
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                <button type="button" onClick={onCancel} style={ACTION_BTN} disabled={busy}>Cancel</button>
                <button
                    type="button"
                    onClick={() => onSubmit({ chainId, password })}
                    disabled={!canSubmit}
                    style={{
                        ...ACTION_BTN,
                        background: canSubmit ? 'var(--xc-accent-primary)' : 'transparent',
                        borderColor: canSubmit ? 'var(--xc-accent-primary)' : 'var(--xc-border)',
                        color: canSubmit ? 'var(--xc-bg)' : 'var(--xc-text-muted)',
                    }}
                >
                    {busy ? 'Publishing…' : loadingChains ? 'Loading chains…' : 'Publish'}
                </button>
            </div>
        </div>
    );
}

/**
 * §19.5.2 publish-labels result panel: shows the broadcast txid + the
 * payload metadata (chain, encrypted size, discovery name). The user
 * can copy the txid; "Done" resets the section back to the idle row.
 */
function PublishLabelsReport({ result, onDone }) {
    const txid = result?.txid || '';
    const [copyStatus, setCopyStatus] = useState(/** @type {string | null} */ (null));
    const [copyError, setCopyError] = useState(/** @type {string | null} */ (null));
    const haptic = useHapticFeedback();

    const copyTxid = async () => {
        setCopyStatus(null);
        setCopyError(null);
        const { ok } = await copyText(txid);
        if (ok) {
            setCopyStatus('Transaction ID copied.');
            haptic.tap();
            return;
        }
        setCopyError('Copy is not available here. Select the transaction ID and copy it manually.');
        haptic.error();
    };
    // Say "published" only for a broadcast that returned a txid; a transient
    // failure resolves queued, with the signed bytes in the broadcast queue.
    if (!txid) {
        return (
            <div data-testid="publish-labels-queued" style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--xc-space-2)',
                padding: 'var(--xc-space-3)',
                background: 'var(--xc-surface-raised)',
                border: '1px solid var(--xc-border)',
                borderRadius: 'var(--xc-radius-md)',
            }}>
                <div style={{ color: 'var(--xc-text)', fontWeight: 600 }}>
                    Labels signed, not broadcast yet
                </div>
                <div style={ROW_HINT}>
                    {result?.queued
                        ? 'The label transaction is waiting in the queued-transactions banner and will be sent from there.'
                        : 'No transaction ID came back, so the labels may not be on-chain yet. Check the queued-transactions banner before publishing again.'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={onDone} style={ACTION_BTN}>Done</button>
                </div>
            </div>
        );
    }
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: '1px solid var(--xc-accent-primary)',
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{ color: 'var(--xc-text)', fontWeight: 600 }}>
                ✓ Labels published
            </div>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px var(--xc-space-3)', margin: 0 }}>
                <dt style={ROW_HINT}>Transaction ID</dt>
                <dd style={{ margin: 0, fontFamily: 'var(--xc-font-mono)', fontSize: 'var(--xc-text-xs)', wordBreak: 'break-all' }}>{txid}</dd>
                <dt style={ROW_HINT}>Chain</dt>
                <dd style={{ margin: 0, fontSize: 'var(--xc-text-sm)' }}>{result?.chainId || '-'}</dd>
                <dt style={ROW_HINT}>Encrypted size</dt>
                <dd style={{ margin: 0, fontSize: 'var(--xc-text-sm)' }}>{result?.sizeBytes ?? 0} bytes</dd>
                <dt style={ROW_HINT}>Discovery name</dt>
                <dd style={{ margin: 0, fontFamily: 'var(--xc-font-mono)', fontSize: 'var(--xc-text-xs)', wordBreak: 'break-all' }}>{result?.discoveryName || '-'}</dd>
            </dl>
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                <button
                    type="button"
                    onClick={copyTxid}
                    style={ACTION_BTN}
                    disabled={!txid}
                >
                    Copy txid
                </button>
                <button type="button" onClick={onDone} style={ACTION_BTN}>Done</button>
            </div>
            {copyStatus ? <Status text={copyStatus} /> : null}
            {copyError ? <Status text={copyError} tone="error" /> : null}
        </div>
    );
}

/**
 * §19.5.2 restore, on-demand half. Same chain picker as
 * `PublishLabelsForm` (only chains this wallet already has an address
 * on can carry a FILE the wallet itself would have published), because
 * a chain with nothing to publish from also never held a label-sync
 * publish to find.
 */
function RestoreLabelsForm({ walletId, busy, error, onCancel, onSubmit }) {
    const { messaging } = useMessaging();
    const [chains, setChains] = useState(/** @type {string[] | null} */ (null));
    const [chainId, setChainId] = useState(/** @type {string} */ (''));
    const [chainsError, setChainsError] = useState(/** @type {string | null} */ (null));
    const [password, setPassword] = useState('');

    useEffect(() => {
        let cancelled = false;
        if (!walletId || typeof messaging?.getAddressesByChain !== 'function') {
            setChains([]);
            return () => { cancelled = true; };
        }
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                const ids = Object.keys(byChain || {})
                    .filter((cid) => Array.isArray(byChain[cid]) && byChain[cid].length > 0);
                setChains(ids);
                if (ids.length > 0) setChainId(ids[0]);
            })
            .catch((err) => {
                if (cancelled) return;
                setChains([]);
                setChainsError(err?.message || 'Failed to load chains.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const canSubmit = !!chainId && password.length > 0 && !busy;

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: '1px solid var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Check chain for backed-up contacts</div>
            <div style={ROW_HINT}>
                Decrypts the labels + contacts FILE this wallet's seed published
                on the chain below, if any, and merges anything found into this
                wallet. Nothing already here is removed.
            </div>
            {chains === null ? (
                <div style={ROW_HINT}>Loading chains…</div>
            ) : chains.length === 0 ? (
                <Status text={chainsError || 'No chains have addresses on this wallet. Generate one first.'} tone="error" />
            ) : (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--xc-text-sm)' }}>
                    <span style={ROW_HINT}>Chain</span>
                    <select
                        value={chainId}
                        onChange={(e) => setChainId(e.target.value)}
                        aria-label="Restore chain"
                        style={passwordStyle}
                    >
                        {chains.map((cid) => (
                            <option key={cid} value={cid}>{cid}</option>
                        ))}
                    </select>
                </label>
            )}
            <input
                type="password"
                placeholder="Wallet password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
                aria-label="Wallet password"
                style={passwordStyle}
            />
            {error ? <Status text={error} tone="error" /> : null}
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                <button type="button" onClick={onCancel} style={ACTION_BTN} disabled={busy}>Cancel</button>
                <button
                    type="button"
                    onClick={() => onSubmit({ chainId, password })}
                    disabled={!canSubmit}
                    style={{
                        ...ACTION_BTN,
                        background: canSubmit ? 'var(--xc-accent-primary)' : 'transparent',
                        borderColor: canSubmit ? 'var(--xc-accent-primary)' : 'var(--xc-border)',
                        color: canSubmit ? 'var(--xc-bg)' : 'var(--xc-text-muted)',
                    }}
                >
                    {busy ? 'Checking…' : 'Check'}
                </button>
            </div>
        </div>
    );
}

/**
 * Turn a `wallet.restoreLabels` result into the one line the user reads.
 * The three outcomes worth telling apart are
 * "found and merged something", "authenticated nothing under this seed
 * on this chain", and "the search itself failed" (an unreachable
 * explorer, collected per-chain in `errors` rather than thrown, per
 * `restoreLabelSyncAfterImport`'s best-effort contract).
 *
 * @param {any} result
 * @returns {string}
 */
function restoreLabelsMessage(result) {
    if (!result) return '';
    if (result.skipped === 'wif-only') {
        return 'This wallet was imported from a private key only. There is no seed to check on-chain backups with.';
    }
    const chainLabel = result.chainId || result.requestedChainId || 'this chain';
    if (result.restored === true) {
        const contacts = Number(result.contactsAdded || 0) + Number(result.contactsUpdated || 0);
        const labels = Number(result.addressesUpdated || 0);
        return `Restored ${contacts} contact${contacts === 1 ? '' : 's'} and ${labels} label${labels === 1 ? '' : 's'}.`;
    }
    const firstError = Array.isArray(result.errors) && result.errors.length > 0 ? result.errors[0] : null;
    if (firstError) return firstError.message;
    return `No backed-up labels found on ${chainLabel}.`;
}

/**
 * §19.5.2 restore report. `applyLabelSyncPayload` runs with the
 * 'preserve' conflict policy here (see `wallet.restoreLabels`), so a
 * "Restored" result only ever added a missing contact/label or filled
 * one in that was blank; it never overwrote something the user typed
 * on this device since the last publish.
 */
function RestoreLabelsReport({ result, onDone }) {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: `1px solid ${result?.restored ? 'var(--xc-accent-primary)' : 'var(--xc-border)'}`,
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{ color: 'var(--xc-text)', fontWeight: 600 }}>
                {restoreLabelsMessage(result)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" onClick={onDone} style={ACTION_BTN}>Done</button>
            </div>
        </div>
    );
}
