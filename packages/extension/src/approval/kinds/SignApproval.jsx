import { useEffect, useMemo, useRef, useState } from 'react';
import { Screen, Button, Input, ChainBadge } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { BalanceChanges } from '@xchain-wallet/core/shared/components/BalanceChanges.jsx';
import { RawPsbtViewer } from '@xchain-wallet/core/shared/components/RawPsbtViewer.jsx';
import {
    listWallets,
    resolveApproval,
    getAddressBalances,
    getAddressesByChain,
    getSettings,
} from '../messaging.js';
import shared from '../approval.module.css';
import styles from './SignApproval.module.css';

const chainRegistry = registryLib.defaultRegistry();

const KIND_TITLE = {
    signMessage: 'Sign message',
    signPsbt: 'Sign transaction',
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

    // §21.3 / §48.4 raw-view gate. The approval window doesn't sit
    // inside the shared MessagingProvider, so it can't use the
    // `useDeveloperMode` hook directly — fetch settings once on mount.
    // Defaults to `false` so a fetch failure or cold start hides the
    // raw view (consistent with the spec's "developer mode hidden by
    // default" stance).
    const [developerMode, setDeveloperMode] = useState(false);
    useEffect(() => {
        let cancelled = false;
        getSettings()
            .then((s) => {
                if (cancelled) return;
                setDeveloperMode(Boolean(s?.developerMode));
            })
            .catch(() => { /* keep developerMode false on failure */ });
        return () => { cancelled = true; };
    }, []);

    // §21.2 balance-change preview — only meaningful for the
    // `signAction` kind (signMessage / signPsbt / signIn don't move
    // value). Source address: prefer `payload.payload.from.address`
    // when the dApp passes it; otherwise fall back to the wallet's
    // first address on the requested chain. Fetch failures degrade
    // gracefully — the section reads "(preview unavailable)" so the
    // user can still approve.
    const [previewBalances, setPreviewBalances] = useState(
        /** @type {{ loading: boolean, error: string | null, sdkShape: any | null, fromAddress: string | null }} */
        ({ loading: false, error: null, sdkShape: null, fromAddress: null }),
    );
    useEffect(() => {
        if (kind !== 'signAction' || !chainId || !walletId) return undefined;
        let cancelled = false;
        const dappFrom = payload?.payload?.from?.address || payload?.from?.address || null;
        async function loadPreview() {
            setPreviewBalances({ loading: true, error: null, sdkShape: null, fromAddress: null });
            let address = dappFrom;
            try {
                if (!address) {
                    const byChain = await getAddressesByChain(walletId);
                    address = byChain?.[chainId]?.[0]?.address || null;
                }
                if (!address) throw new Error('no signing address');
                const sdkShape = await getAddressBalances(chainId, address);
                if (cancelled) return;
                setPreviewBalances({ loading: false, error: null, sdkShape, fromAddress: address });
            } catch (err) {
                if (cancelled) return;
                setPreviewBalances({
                    loading: false,
                    error: err?.message || 'balance fetch failed',
                    sdkShape: null,
                    fromAddress: address,
                });
            }
        }
        loadPreview();
        return () => { cancelled = true; };
    }, [kind, chainId, walletId, payload]);

    const previewResult = useMemo(() => {
        if (kind !== 'signAction') return null;
        if (previewBalances.loading || previewBalances.error || !previewBalances.sdkShape) {
            return null;
        }
        return decoderLib.simulateAction({
            action: payload?.action,
            params: payload?.payload || {},
            balances: decoderLib.balancesFromSdk(previewBalances.sdkShape),
            // Fee defaults to '0' — the dApp request doesn't carry an
            // estimate today; once the §44.2 fee selector lands the
            // host can attach one alongside the bridge payload.
            feeEstimate: '0',
            chainId,
            chainRegistry,
        });
    }, [kind, payload, previewBalances, chainId]);

    const title = KIND_TITLE[kind] ?? 'Approval required';
    const showSavePermanent =
        kind === 'signAction' ||
        (kind === 'signMessage' && !payload?.payload?.alreadyGranted);

    // §21.7 button-label conventions. Action / PSBT signing reads
    // "Approve & Sign on <chain>" so the user sees which chain is
    // about to commit a signature; mitigates approval-drift between
    // tabs (§21.3). Message / sign-in keep "Approve" — no signature
    // commits balance, so the chain suffix would mislead.
    const chainName = descriptor?.displayName || '';
    const approveLabel =
        kind === 'signAction' || kind === 'signPsbt'
            ? chainName
                ? `Approve & Sign on ${chainName}`
                : 'Approve & Sign'
            : kind === 'signIn'
                ? 'Sign in'
                : 'Approve';

    // §21.3 dApp Source block — Origin + App name (when the dApp
    // attached one). Only renders when an origin is present; in
    // practice every dApp request carries one, but user-initiated
    // sign flows that re-use this screen wouldn't.
    const appName = payload?.appName || payload?.payload?.appName || '';

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
                        {approveLabel}
                    </Button>
                </div>
            }
        >
            {descriptor ? (
                <div className={styles.chainLine}>
                    <ChainBadge descriptor={descriptor} size="sm" />
                </div>
            ) : null}

            {origin ? (
                <section className={styles.source} aria-label="Source">
                    <p className={styles.sourceLabel}>Source</p>
                    <p className={styles.sourceOrigin}>{origin}</p>
                    {appName ? <p className={styles.sourceApp}>{appName}</p> : null}
                </section>
            ) : null}

            <SignSummary kind={kind} payload={payload} />

            {kind === 'signAction' ? (
                <BalanceChanges
                    result={previewResult}
                    loading={previewBalances.loading}
                    error={previewBalances.error}
                />
            ) : null}

            <RawPsbtViewer
                developerMode={developerMode}
                psbtHex={kind === 'signPsbt' ? payload?.payload?.psbtHex : undefined}
                actionFields={
                    kind === 'signAction'
                        ? { action: payload?.action, ...(payload?.payload || {}) }
                        : kind === 'signPsbt'
                            ? payload?.payload
                            : undefined
                }
            />

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
                    <p className={shared.summaryLabel}>Transaction</p>
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
        case 'signAction': {
            const decoded = decoderLib.decodeAction({
                action: payload?.action,
                params: inner,
                chainId: payload?.chainId,
                chainRegistry,
            });
            return (
                <>
                    <div className={shared.summary}>
                        <p className={shared.summaryLabel}>{payload?.action || 'Action'}</p>
                        <p
                            className={shared.summaryValue}
                            style={{ whiteSpace: 'normal', fontFamily: 'var(--xc-font-sans)', fontSize: 13, lineHeight: 1.4 }}
                        >
                            {decoded.summary}
                        </p>
                        {decoded.details.length > 0 ? (
                            <details className={styles.details}>
                                <summary className={styles.detailsToggle}>
                                    Details ({decoded.details.length})
                                </summary>
                                <dl className={styles.detailsList}>
                                    {decoded.details.map((row) => (
                                        <div className={styles.detailsRow} key={row.label}>
                                            <dt className={styles.detailsLabel}>{row.label}</dt>
                                            <dd className={styles.detailsValue}>{row.value}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </details>
                        ) : null}
                    </div>
                    {decoded.warnings.length > 0 ? (
                        <ul className={styles.warnings} role="alert">
                            {decoded.warnings.map((w, i) => (
                                <li key={i}>{w}</li>
                            ))}
                        </ul>
                    ) : null}
                </>
            );
        }
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
