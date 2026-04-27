// BackupSection — §35.1 Backup panel.
//
// Live this step:
//   - Export encrypted backup (.xchain-wallet) — wires `exportBackupFile`
//     core flow through the new `wallet.exportBackup` host handler. The
//     renderer captures the JSON envelope and triggers a Blob download.
//
// Deferred (need additional flows / UI):
//   - Back up seed phrase — needs a `wallet.revealSeed` host handler
//     that re-derives the mnemonic via `unlockWallet` and returns it.
//     Sensitive enough to warrant its own dedicated reveal screen
//     rather than an inline panel.
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

            <BackupRow
                label="Back up seed phrase"
                hint="Coming soon — reveal the BIP39 mnemonic for offline copy. Needs a dedicated wallet.revealSeed flow + reveal-screen UX."
                actionLabel="Show…"
                disabled
                onClick={() => {}}
            />
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
