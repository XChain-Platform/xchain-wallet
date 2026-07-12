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
//   - Back up seed phrase: wires `revealMnemonic` core flow through
//     the `wallet.revealMnemonic` host handler. Inline password gate;
//     mnemonic blurred until tapped; row collapses on done.
//   - Test backup (dry-run restore): wires `dryRunRestore` core flow
//     through the `wallet.dryRunRestore` host handler. User pastes a
//     candidate mnemonic; the panel renders an overall match flag plus
//     a per-chain comparison report (matched / divergent / missing
//     counts).
//   - Publish labels (§19.5.2): wires `publishLabelsNow` core flow
//     through the `wallet.publishLabels` host handler. User picks a
//     chain + enters the wallet password; the panel encrypts the
//     labels + contacts payload, broadcasts it as a FILE action, and
//     reports the txid + payload size. Auto-sync on label change and
//     fetch-on-restore decryption are tracked in `claude/reports/
//     xchain-wallet/FOLLOWUPS.md`.

import { useEffect, useState } from 'react';
import { flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging } from '../../useMessaging.js';
import { ROW, ROW_HINT, STACK, Status } from './_settingsPrimitives.jsx';

const ACTION_BTN = {
    background: 'transparent',
    border: '1px solid var(--xc-border)',
    color: 'var(--xc-text)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-3)',
    fontSize: 'var(--xc-text-sm)',
    cursor: 'pointer',
};

/**
 * @param {object} props
 * @param {{ id: string, name: string } | null} [props.activeWallet]
 */
export function BackupSection({ activeWallet }) {
    const { messaging } = useMessaging();
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState(/** @type {string | null} */ (null));
    const [pendingPassword, setPendingPassword] = useState(/** @type {string | null} */ (null));

    // §19.3 reveal-seed state.
    const [revealStage, setRevealStage] = useState(
        /** @type {'idle' | 'password' | 'shown'} */ ('idle'),
    );
    const [revealing, setRevealing] = useState(false);
    const [revealError, setRevealError] = useState(/** @type {string | null} */ (null));
    const [mnemonic, setMnemonic] = useState('');
    const [mnemonicHidden, setMnemonicHidden] = useState(true);

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

    const onExport = async (password) => {
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
            triggerDownload(activeWallet.name || activeWallet.id, fileContent);
            // §19.7 / G034: successful encrypted-backup export counts as
            // a fresh backup verification for reminder purposes.
            try { flowsLib.markBackupVerified(activeWallet.id); } catch { /* best-effort */ }
            setPendingPassword(null);
        } catch (err) {
            setExportError(err instanceof Error ? err.message : String(err));
        } finally {
            setExporting(false);
        }
    };

    const onReveal = async (password) => {
        if (typeof messaging?.revealMnemonicRequest !== 'function') {
            setRevealError('Seed reveal is not wired in this shell yet.');
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
            setRevealStage('shown');
            setMnemonicHidden(true);
        } catch (err) {
            const name = err?.name || '';
            const msg = name === 'NoMnemonicForWifOnlyError'
                ? 'This wallet was imported from a private key only. There is no seed phrase to reveal.'
                : (err?.message || 'Failed to reveal seed phrase.');
            setRevealError(msg);
        } finally {
            setRevealing(false);
        }
    };

    function handleHideMnemonic() {
        setMnemonic('');
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
            setDryRunError(err?.message || 'Dry-run restore failed.');
            setDryRunStage('form');
        }
    }

    function resetDryRun() {
        setDryRunResult(null);
        setDryRunError(null);
        setDryRunStage('idle');
    }

    async function runPublish({ chainId, password }) {
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
        try {
            const r = await messaging.publishLabelsRequest({
                walletId: activeWallet.id,
                password,
                chainId,
            });
            setPublishResult(r);
            setPublishStage('result');
        } catch (err) {
            setPublishError(err?.message || 'Failed to publish labels.');
            setPublishStage('form');
        }
    }

    function resetPublish() {
        setPublishResult(null);
        setPublishError(null);
        setPublishStage('idle');
    }

    return (
        <div style={STACK}>
            {pendingPassword !== null ? (
                <PasswordPrompt
                    label="Backup password"
                    hint="Choose a password to encrypt the backup file. This is independent of the wallet-unlock password."
                    busy={exporting}
                    onCancel={() => { setPendingPassword(null); setExportError(null); }}
                    onSubmit={(pw) => onExport(pw)}
                    error={exportError}
                />
            ) : (
                <BackupRow
                    label="Export encrypted backup"
                    /* Spec §19.4 */
                    hint="Saves a .xchain-wallet file containing this wallet's seed (encrypted), addresses, labels, contacts, and settings."
                    actionLabel="Export…"
                    disabled={!activeWallet}
                    onClick={() => { setPendingPassword(''); setExportError(null); }}
                />
            )}

            {revealStage === 'password' ? (
                <UnlockPrompt
                    label="Reveal seed phrase"
                    hint="Enter your wallet password. The seed phrase is the master key: anyone who sees it can spend your funds. Make sure no one is looking over your shoulder."
                    busy={revealing}
                    onCancel={() => { setRevealStage('idle'); setRevealError(null); }}
                    onSubmit={(pw) => onReveal(pw)}
                    error={revealError}
                />
            ) : revealStage === 'shown' ? (
                <RevealedMnemonic
                    mnemonic={mnemonic}
                    hidden={mnemonicHidden}
                    onToggle={() => setMnemonicHidden((h) => !h)}
                    onDone={handleHideMnemonic}
                />
            ) : (
                <BackupRow
                    label="Back up seed phrase"
                    hint="Reveal the wallet's seed phrase so you can copy it onto paper or another device. Requires the wallet password every time."
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
                    hint="Check that a recovery phrase matches this wallet's existing addresses. Nothing is saved, and the phrase is erased from memory after the check."
                    actionLabel="Test…"
                    disabled={!activeWallet}
                    onClick={() => { setDryRunStage('form'); setDryRunError(null); }}
                />
            )}
            {publishStage === 'form' || publishStage === 'running' ? (
                <PublishLabelsForm
                    walletId={activeWallet?.id}
                    busy={publishStage === 'running'}
                    error={publishError}
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
 */
function RevealedMnemonic({ mnemonic, hidden, onToggle, onDone }) {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: '1px solid var(--xc-warning, var(--xc-border-strong))',
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{ color: 'var(--xc-text)', fontWeight: 500 }}>
                Your seed phrase
            </div>
            <div style={ROW_HINT}>
                Write it on paper or store it in a password manager. Never type or
                paste it into anything else. The wallet has nothing else that can
                recover this. Losing the seed and your password loses the funds.
            </div>
            <button
                type="button"
                onClick={onToggle}
                aria-label={hidden ? 'Reveal seed phrase' : 'Hide seed phrase'}
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
            <div style={{
                color: 'var(--xc-text-muted)',
                fontSize: 'var(--xc-text-xs)',
                textAlign: 'center',
            }}>
                {hidden ? 'Tap to reveal.' : 'Tap to hide again.'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
    const [gapLimit, setGapLimit] = useState(10);

    const canSubmit = mn.trim().length > 0 && !busy;

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
                Paste the mnemonic from your paper backup (or password manager). The
                wallet derives the first {gapLimit} addresses on every active chain and
                reports any mismatches without writing anything.
            </div>
            <textarea
                value={mn}
                onChange={(e) => setMn(e.target.value)}
                placeholder="Paste mnemonic, separated by spaces"
                rows={3}
                aria-label="Candidate mnemonic"
                style={{ ...passwordStyle, fontFamily: 'var(--xc-font-mono)', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--xc-text-sm)' }}>
                    <span>Format:</span>
                    <select
                        value={format}
                        onChange={(e) => setFormat(/** @type {any} */ (e.target.value))}
                        aria-label="Mnemonic format"
                        style={passwordStyle}
                    >
                        <option value="bip39">BIP39</option>
                        <option value="counterwallet-legacy">Counterwallet legacy</option>
                    </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--xc-text-sm)' }}>
                    <span>Gap:</span>
                    <input
                        type="number"
                        min={1}
                        max={100}
                        value={gapLimit}
                        onChange={(e) => setGapLimit(Math.max(1, Math.min(100, Number(e.target.value) || 10)))}
                        aria-label="Gap limit"
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
            {error ? <Status text={error} tone="error" /> : null}
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                <button type="button" onClick={onCancel} style={ACTION_BTN} disabled={busy}>Cancel</button>
                <button
                    type="button"
                    onClick={() => onSubmit({
                        mnemonic: mn.trim(),
                        format,
                        bip39Passphrase: format === 'bip39' ? passphrase : '',
                        gapLimit,
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
 * per-chain breakdown (matched / divergent / missing counts).
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
                    <div
                        key={`${c.chainId}-${c.addressType}`}
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 'var(--xc-text-sm)',
                            color: 'var(--xc-text)',
                        }}
                    >
                        <span>{c.chainId} <span style={{ color: 'var(--xc-text-muted)' }}>({c.addressType})</span></span>
                        <span style={{ fontFamily: 'var(--xc-font-mono)' }}>
                            <span style={{ color: 'var(--xc-accent-primary)' }}>{c.matchedCount} ✓</span>
                            {c.divergentCount > 0
                                ? <span style={{ color: 'var(--xc-danger)' }}> · {c.divergentCount} ✗</span>
                                : null}
                            {c.missingCount > 0
                                ? <span style={{ color: 'var(--xc-text-muted)' }}> · {c.missingCount} new</span>
                                : null}
                        </span>
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" onClick={onDone} style={ACTION_BTN}>Done</button>
            </div>
        </div>
    );
}

function PasswordPrompt({ label, hint, busy, error, onCancel, onSubmit }) {
    const [pw1, setPw1] = useState('');
    const [pw2, setPw2] = useState('');
    const mismatch = pw2.length > 0 && pw1 !== pw2;
    const canSubmit = pw1.length > 0 && pw1 === pw2 && !busy;
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
                aria-label="Backup password"
                style={passwordStyle}
            />
            <input
                type="password"
                placeholder="Confirm password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                aria-label="Confirm backup password"
                style={passwordStyle}
            />
            {mismatch ? (
                <Status text="Passwords don't match." tone="error" />
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

const passwordStyle = {
    background: 'var(--xc-bg)',
    color: 'var(--xc-text)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-2) var(--xc-space-3)',
    fontSize: 'var(--xc-text-sm)',
    fontFamily: 'inherit',
};

function triggerDownload(walletName, fileContent) {
    const safeName = String(walletName || 'wallet')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .slice(0, 60) || 'wallet';
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([fileContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}-${stamp}.xchain-wallet`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * §19.5.2 publish-labels form. Pulls the wallet's address-bearing
 * chains from `messaging.getAddressesByChain` so the picker only
 * surfaces chains where the FILE action can actually be broadcast,
 * then takes the wallet password and dispatches `publishLabelsRequest`.
 */
function PublishLabelsForm({ walletId, busy, error, onCancel, onSubmit }) {
    const { messaging } = useMessaging();
    const [chains, setChains] = useState(/** @type {string[] | null} */ (null));
    const [chainId, setChainId] = useState(/** @type {string} */ (''));
    const [password, setPassword] = useState('');
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
                    {busy ? 'Publishing…' : 'Publish'}
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
                <dt style={ROW_HINT}>Txid</dt>
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
                    onClick={() => {
                        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                            navigator.clipboard.writeText(txid).catch(() => {});
                        }
                    }}
                    style={ACTION_BTN}
                    disabled={!txid}
                >
                    Copy txid
                </button>
                <button type="button" onClick={onDone} style={ACTION_BTN}>Done</button>
            </div>
        </div>
    );
}
