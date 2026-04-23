import { useEffect, useRef, useState } from 'react';
import { Screen, Button, Input, ChainBadge } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { listWallets, resolveApproval } from '../messaging.js';
import shared from '../approval.module.css';
import styles from './SignApproval.module.css';

const chainRegistry = registryLib.defaultRegistry();

const KIND_TITLE = {
    signMessage: 'Sign message',
    signPsbt: 'Sign PSBT',
    signAction: 'Sign action',
    signIn: 'Sign in',
};

/**
 * Shared approval screen for the four password-gated sign kinds
 * (`signMessage` / `signPsbt` / `signAction` / `signIn`). The inner
 * summary block renders per-kind; everything else (origin badge,
 * password input, always-allow toggle, footer buttons) is shared.
 *
 * Result envelope matches SignApprovalResult:
 *   `{ approved: true, walletId, password, bip39Passphrase?, savePermanent? }`
 *
 * Wrong-password detection happens server-side — the bridge handler
 * passes the password to the signer flow, and if decryption fails the
 * caller dApp sees a structured error. We surface that back to the
 * user here without closing the window so they can retry.
 *
 * @param {object} props
 * @param {string} props.id
 * @param {'signMessage' | 'signPsbt' | 'signAction' | 'signIn'} props.kind
 * @param {any} props.payload  The bridge-level request
 * @param {() => void} props.onReject
 */
export function SignApproval({ id, kind, payload, onReject }) {
    const origin = payload?.origin || '';
    const chainId = payload?.chainId || null;
    const descriptor = chainId ? chainRegistry.get(chainId) : null;

    const [walletId, setWalletId] = useState(/** @type {string | null} */ (null));
    const [password, setPassword] = useState('');
    const [savePermanent, setSavePermanent] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        listWallets()
            .then((list) => {
                if (Array.isArray(list) && list.length > 0) {
                    setWalletId(list[0].id);
                }
            })
            .catch((err) => {
                // Show the error but still let the user reject cleanly.
                setError(err?.message || 'Failed to load wallets.');
            });
        // Focus the password field once the screen paints.
        setTimeout(() => inputRef.current?.focus(), 0);
    }, []);

    const title = KIND_TITLE[kind] ?? 'Approval required';
    const showSavePermanent =
        kind === 'signAction' ||
        (kind === 'signMessage' && !payload?.payload?.alreadyGranted);

    async function handleApprove(event) {
        event.preventDefault();
        if (busy || password.length === 0 || !walletId) return;
        setBusy(true);
        setError(null);
        try {
            await resolveApproval(id, {
                approved: true,
                walletId,
                password,
                ...(savePermanent ? { savePermanent: true } : {}),
            });
            setPassword('');
            window.close();
        } catch (err) {
            setError(
                err?.name === 'InvalidPasswordError'
                    ? 'Incorrect password.'
                    : err?.message || 'Approval failed.',
            );
            setBusy(false);
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }

    return (
        <Screen
            variant="popup"
            header={
                <div className={shared.header}>
                    <span className={shared.title}>{title}</span>
                    <span className={shared.origin}>{origin}</span>
                </div>
            }
            footer={
                <div className={shared.footer}>
                    <Button
                        variant="ghost"
                        block
                        onClick={onReject}
                        disabled={busy}
                    >
                        Reject
                    </Button>
                    <Button
                        type="submit"
                        form="sign-approval-form"
                        variant="primary"
                        block
                        loading={busy}
                        disabled={password.length === 0 || !walletId}
                    >
                        Approve
                    </Button>
                </div>
            }
        >
            {descriptor ? (
                <div className={styles.chainLine}>
                    <ChainBadge descriptor={descriptor} size="sm" />
                </div>
            ) : null}

            <SignSummary kind={kind} payload={payload} />

            <form
                id="sign-approval-form"
                onSubmit={handleApprove}
                noValidate
                className={styles.form}
            >
                <Input
                    ref={inputRef}
                    type="password"
                    label="Password"
                    hint="Required to sign — your password stays in this window."
                    value={password}
                    onChange={(e) => {
                        setPassword(e.target.value);
                        if (error) setError(null);
                    }}
                    autoComplete="current-password"
                    disabled={busy}
                    error={error || undefined}
                />
                {showSavePermanent ? (
                    <label className={shared.toggleRow}>
                        <input
                            type="checkbox"
                            checked={savePermanent}
                            onChange={(e) => setSavePermanent(e.target.checked)}
                            disabled={busy}
                        />
                        <span>Always allow this on {origin}</span>
                    </label>
                ) : null}
            </form>
        </Screen>
    );
}

function SignSummary({ kind, payload }) {
    const inner = payload?.payload || {};
    switch (kind) {
        case 'signMessage':
            return (
                <div className={shared.summary}>
                    <p className={shared.summaryLabel}>Message</p>
                    <pre className={shared.summaryValue}>{String(inner.message ?? '')}</pre>
                    {inner.address ? (
                        <>
                            <p className={shared.summaryLabel} style={{ marginTop: 8 }}>Signer</p>
                            <pre className={shared.summaryValue}>{inner.address}</pre>
                        </>
                    ) : null}
                </div>
            );
        case 'signPsbt':
            return (
                <div className={shared.summary}>
                    <p className={shared.summaryLabel}>PSBT</p>
                    <pre className={shared.summaryValue}>
                        {truncate(inner.psbtHex, 96)}
                    </pre>
                    {Array.isArray(inner.signingPaths) && inner.signingPaths.length > 0 ? (
                        <>
                            <p className={shared.summaryLabel} style={{ marginTop: 8 }}>
                                Signing paths
                            </p>
                            <pre className={shared.summaryValue}>
                                {inner.signingPaths.join('\n')}
                            </pre>
                        </>
                    ) : null}
                </div>
            );
        case 'signAction':
            return (
                <div className={shared.summary}>
                    <p className={shared.summaryLabel}>Action</p>
                    <pre className={shared.summaryValue}>{String(payload?.action ?? '')}</pre>
                    <p className={shared.summaryLabel} style={{ marginTop: 8 }}>Parameters</p>
                    <pre className={shared.summaryValue}>
                        {safeJson(inner)}
                    </pre>
                </div>
            );
        case 'signIn':
            return (
                <div className={shared.summary}>
                    <p className={shared.summaryLabel}>Sign in to</p>
                    <pre className={shared.summaryValue}>{String(inner.appId || payload?.origin || '')}</pre>
                    <p className={shared.summaryLabel} style={{ marginTop: 8 }}>Nonce</p>
                    <pre className={shared.summaryValue}>{String(inner.nonce || '')}</pre>
                </div>
            );
        default:
            return null;
    }
}

function truncate(s, max) {
    const str = String(s ?? '');
    return str.length > max ? `${str.slice(0, max)}…` : str;
}

function safeJson(v) {
    try {
        return JSON.stringify(v, null, 2);
    } catch (_err) {
        return String(v);
    }
}
