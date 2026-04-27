// BackupSection — §35.1 Backup panel.
//
// Live:
//   - Export encrypted backup (.xchain-wallet) — wires `exportBackupFile`
//     core flow through the `wallet.exportBackup` host handler.
//   - Back up seed phrase — wires `revealMnemonic` core flow through
//     the `wallet.revealMnemonic` host handler. Inline password gate;
//     mnemonic blurred until tapped; row collapses on done.
//
// Deferred (need additional flows / UI):
//   - Test backup (dry-run restore) — `dryRunRestore` flow exists but
//     wants its own multi-step UI (paste mnemonic, gap-limit picker,
//     per-chain comparison report).
//   - Published labels — §19.5.2 on-chain label sync; flow primitives
//     ship at v0.22.0 but the FILE-action submit/fetch wiring is still
//     pending.

import { useState } from 'react';
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
                ? 'This wallet was imported from a private key only — there is no seed phrase to reveal.'
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
                    hint="Saves a .xchain-wallet file containing this wallet's seed (encrypted), addresses, labels, contacts, and settings. Per §19.4."
                    actionLabel="Export…"
                    disabled={!activeWallet}
                    onClick={() => { setPendingPassword(''); setExportError(null); }}
                />
            )}

            {revealStage === 'password' ? (
                <UnlockPrompt
                    label="Reveal seed phrase"
                    hint="Enter your wallet password. The seed phrase is the master key — anyone who sees it can spend your funds. Make sure no one is looking over your shoulder."
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
            <BackupRow
                label="Test backup (dry-run restore)"
                hint="Coming soon — re-derive addresses from a mnemonic and confirm they match this wallet's balances per §19.6."
                actionLabel="Test…"
                disabled
                onClick={() => {}}
            />
            <BackupRow
                label="Published labels"
                hint="Coming soon — opt into §19.5.2 on-chain label sync via FILE-action transport."
                actionLabel="Configure…"
                disabled
                onClick={() => {}}
            />
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
 * Single-password unlock prompt — used by the §19.3 seed-phrase reveal
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
                recover this — losing the seed and your password loses the funds.
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
