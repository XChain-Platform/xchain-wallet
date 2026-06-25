// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Screen, Button, Input, ChainBadge } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { BalanceChanges } from '@xchain-wallet/core/shared/components/BalanceChanges.jsx';
import { RawPsbtViewer } from '@xchain-wallet/core/shared/components/RawPsbtViewer.jsx';
import { resolveDisplayTickers } from '@xchain-wallet/core/shared/utils/resolveDisplayTickers.js';
import {
    listWallets,
    resolveApproval,
    getAddressBalances,
    getAddressesByChain,
    getSettings,
    parsePsbt,
    getTokenInfo,
} from '../messaging.js';
import shared from '../approval.module.css';
import styles from './SignApproval.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Cache of `^id` -> resolved ticker name, keyed by chain. A ticker id is
// immutable, so entries never expire. Resolves a single compaction reference
// for display; returns null (caller keeps the `^id`) on any failure.
const tickNameCache = new Map();
async function resolveTickName(chainId, ref) {
    const key = chainId + '|' + ref;
    if (tickNameCache.has(key)) return tickNameCache.get(key);
    try {
        const info = await getTokenInfo(chainId, ref);
        const name = (info && info.canonicalTick) || null;
        if (name && name !== ref) {
            tickNameCache.set(key, name);
            return name;
        }
    } catch {
        // fall through; caller keeps the ^id form
    }
    return null;
}

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
 * Wrong-password detection happens server-side; the bridge handler
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
    // `useDeveloperMode` hook directly; fetch settings once on mount.
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

    // §21.2 balance-change preview: only meaningful for the
    // `signAction` kind (signMessage / signPsbt / signIn don't move
    // value). Source address: prefer `payload.payload.from.address`
    // when the dApp passes it; otherwise fall back to the wallet's
    // first address on the requested chain. Fetch failures degrade
    // gracefully; the section reads "(preview unavailable)" so the
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

    // Resolve any `^id` ticker references in a signAction's params back to
    // readable names for display, so the approval summary, details, and balance
    // preview show "JDOG" rather than "^1234" when a dApp built the action with
    // the SDK's ticker compaction. Best-effort: starts from the raw payload and
    // swaps in names as they resolve; unresolvable refs keep their `^id` form,
    // and resolution never blocks the approval. The raw value still shows in the
    // developer RawPsbtViewer below.
    const [resolvedPayload, setResolvedPayload] = useState(payload);
    useEffect(() => {
        setResolvedPayload(payload);
        if (kind !== 'signAction' || !payload?.payload) return undefined;
        let cancelled = false;
        (async () => {
            const resolved = await resolveDisplayTickers(
                payload.action,
                payload.payload,
                (ref) => resolveTickName(chainId, ref),
            );
            if (!cancelled && resolved !== payload.payload) {
                setResolvedPayload({ ...payload, payload: resolved });
            }
        })();
        return () => { cancelled = true; };
    }, [kind, payload, chainId]);

    const previewResult = useMemo(() => {
        if (kind !== 'signAction') return null;
        if (previewBalances.loading || previewBalances.error || !previewBalances.sdkShape) {
            return null;
        }
        return decoderLib.simulateAction({
            action: resolvedPayload?.action,
            params: resolvedPayload?.payload || {},
            balances: decoderLib.balancesFromSdk(previewBalances.sdkShape),
            // Fee defaults to '0'; the dApp request doesn't carry an
            // estimate today. Once the §44.2 fee selector lands the
            // host can attach one alongside the bridge payload.
            feeEstimate: '0',
            chainId,
            chainRegistry,
        });
    }, [kind, resolvedPayload, previewBalances, chainId]);

    // §21.2 / §48 signPsbt intent cross-check. A truncated hex string is
    // not something a user can verify; a compromised dApp could swap in a
    // drain PSBT and the displayed prefix would look unremarkable. Decode
    // the PSBT into destinations + amounts (via the same psbt.parse host
    // route the in-wallet sign form uses) and mark which outputs return to
    // the user's own addresses, so "how much leaves, and to where" is
    // legible before the password is entered. Degrades gracefully: a parse
    // failure shows an explicit warning rather than silently falling back
    // to the opaque hex.
    const psbtHexForSign = kind === 'signPsbt' ? payload?.payload?.psbtHex : null;
    const [psbtIntent, setPsbtIntent] = useState(
        /** @type {{ loading: boolean, error: string | null, decomposed: any | null, ownAddresses: Set<string> }} */
        ({ loading: false, error: null, decomposed: null, ownAddresses: new Set() }),
    );
    useEffect(() => {
        if (kind !== 'signPsbt') return undefined;
        if (!chainId || !psbtHexForSign) {
            setPsbtIntent({
                loading: false,
                error: !chainId ? 'No chain specified. Cannot decode this transaction.' : null,
                decomposed: null,
                ownAddresses: new Set(),
            });
            return undefined;
        }
        let cancelled = false;
        setPsbtIntent({ loading: true, error: null, decomposed: null, ownAddresses: new Set() });
        async function loadIntent() {
            try {
                // Own-address set is best-effort: it only labels change vs
                // external recipients, so a failure here must not block the
                // decode itself.
                let ownAddresses = new Set();
                if (walletId) {
                    try {
                        const byChain = await getAddressesByChain(walletId);
                        ownAddresses = new Set(
                            (byChain?.[chainId] || []).map((a) => a.address).filter(Boolean),
                        );
                    } catch { /* leave ownAddresses empty */ }
                }
                const res = await parsePsbt({ chainId, psbtHex: psbtHexForSign });
                if (cancelled) return;
                setPsbtIntent({
                    loading: false,
                    error: null,
                    decomposed: res?.decomposed || null,
                    ownAddresses,
                });
            } catch (err) {
                if (cancelled) return;
                setPsbtIntent({
                    loading: false,
                    error: err?.message || 'Failed to decode transaction.',
                    decomposed: null,
                    ownAddresses: new Set(),
                });
            }
        }
        loadIntent();
        return () => { cancelled = true; };
    }, [kind, chainId, psbtHexForSign, walletId]);

    const title = KIND_TITLE[kind] ?? 'Approval required';
    const showSavePermanent =
        kind === 'signAction' ||
        (kind === 'signMessage' && !payload?.payload?.alreadyGranted);

    // §21.7 button-label conventions. Action / PSBT signing reads
    // "Approve & Sign on <chain>" so the user sees which chain is
    // about to commit a signature; mitigates approval-drift between
    // tabs (§21.3). Message / sign-in keep "Approve"; no signature
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

    // §21.3 dApp Source block: Origin + App name (when the dApp
    // attached one). Only renders when an origin is present; in
    // practice every dApp request carries one, but user-initiated
    // sign flows that re-use this screen wouldn't.
    const appName = payload?.appName || payload?.payload?.appName || '';

    // For a PSBT sign, block approval whenever the independent decode failed
    // (or produced nothing). The summary already warns visually, but that is
    // presentational only: without this gate the user can still approve a
    // transaction whose effects could not be verified. Mirrors PsbtSignForm,
    // which already refuses to sign on `!decomposed`.
    const psbtDecodeFailed =
        kind === 'signPsbt' &&
        !!psbtHexForSign &&
        !psbtIntent.loading &&
        (psbtIntent.error !== null || psbtIntent.decomposed === null);

    async function handleApprove(event) {
        event.preventDefault();
        if (busy || password.length === 0 || !walletId || psbtDecodeFailed) return;
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
                        disabled={password.length === 0 || !walletId || psbtDecodeFailed}
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

            <SignSummary kind={kind} payload={resolvedPayload} />

            {kind === 'signPsbt' ? (
                <PsbtIntentSummary
                    loading={psbtIntent.loading}
                    error={psbtIntent.error}
                    decomposed={psbtIntent.decomposed}
                    ownAddresses={psbtIntent.ownAddresses}
                />
            ) : null}

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
                    hint="Required to sign. Your password stays in this window."
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
            // The decoded destinations/amounts/fee render in
            // <PsbtIntentSummary> below; the raw hex stays available in the
            // developer-mode RawPsbtViewer. Here we surface only the signing
            // paths (when the dApp scoped the request to specific inputs).
            return Array.isArray(inner.signingPaths) && inner.signingPaths.length > 0 ? (
                <div className={shared.summary}>
                    <p className={shared.summaryLabel}>Signing paths</p>
                    <pre className={shared.summaryValue}>
                        {inner.signingPaths.join('\n')}
                    </pre>
                </div>
            ) : null;
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

/**
 * §21.2 / §48: decoded signPsbt intent. Renders the transaction's real
 * destinations and amounts so the user can cross-check what they're
 * signing against the dApp's stated intent, instead of trusting an opaque
 * hex string. Outputs paying the user's own addresses are labelled as
 * change; everything else is money leaving the wallet.
 */
function PsbtIntentSummary({ loading, error, decomposed, ownAddresses }) {
    if (loading) {
        return (
            <div className={shared.summary}>
                <p className={shared.summaryLabel}>Transaction</p>
                <p className={shared.summaryValue} style={{ whiteSpace: 'normal' }}>
                    Decoding transaction…
                </p>
            </div>
        );
    }

    if (error || !decomposed) {
        // Fail loud: a transaction we can't decode is exactly the case
        // where the user most needs to be cautious. Never silently fall
        // back to an unreadable hex blob.
        return (
            <ul className={styles.warnings} role="alert">
                <li>
                    {error
                        ? `This transaction could not be decoded (${error}). `
                        : 'This transaction could not be decoded. '}
                    Only approve it if you trust the source. The raw transaction
                    is viewable in developer mode.
                </li>
            </ul>
        );
    }

    const own = ownAddresses instanceof Set ? ownAddresses : new Set();
    const outputs = Array.isArray(decomposed.outputs) ? decomposed.outputs : [];
    const inputs = Array.isArray(decomposed.inputs) ? decomposed.inputs : [];

    const external = outputs.filter((o) => !o.address || !own.has(o.address));
    const change = outputs.filter((o) => o.address && own.has(o.address));

    const sending = external.reduce((acc, o) => acc + (o.value || 0), 0);
    const changeTotal = change.reduce((acc, o) => acc + (o.value || 0), 0);

    const totalOut = outputs.reduce((acc, o) => acc + (o.value || 0), 0);
    const inputsHaveValue = inputs.length > 0 && inputs.every((i) => typeof i.value === 'number');
    const totalIn = inputsHaveValue
        ? inputs.reduce((acc, i) => acc + (i.value || 0), 0)
        : null;
    const fee = totalIn != null ? totalIn - totalOut : null;

    return (
        <div className={shared.summary}>
            <p className={shared.summaryLabel}>This transaction</p>

            {external.length === 0 ? (
                <p className={shared.summaryValue} style={{ whiteSpace: 'normal' }}>
                    All outputs return to your own addresses (no funds leave this wallet).
                </p>
            ) : (
                <dl className={styles.detailsList} style={{ marginTop: 4 }}>
                    {external.map((o, i) => (
                        <div className={styles.detailsRow} key={`ext-${i}`}>
                            <dt className={styles.detailsLabel}>
                                {o.address ? 'To' : 'To (unrecognized script)'}
                            </dt>
                            <dd className={styles.detailsValue}>
                                {formatSats(o.value)}
                                {o.address ? (
                                    <>
                                        <br />
                                        <span style={{ fontFamily: 'var(--xc-font-mono)', fontSize: 12 }}>
                                            {ellipsizeMiddle(o.address)}
                                        </span>
                                    </>
                                ) : null}
                            </dd>
                        </div>
                    ))}
                </dl>
            )}

            <dl className={styles.detailsList} style={{ marginTop: 6 }}>
                <div className={styles.detailsRow}>
                    <dt className={styles.detailsLabel}>Leaving wallet</dt>
                    <dd className={styles.detailsValue}>{formatSats(sending)}</dd>
                </div>
                {changeTotal > 0 ? (
                    <div className={styles.detailsRow}>
                        <dt className={styles.detailsLabel}>Change (back to you)</dt>
                        <dd className={styles.detailsValue}>{formatSats(changeTotal)}</dd>
                    </div>
                ) : null}
                <div className={styles.detailsRow}>
                    <dt className={styles.detailsLabel}>Network fee</dt>
                    <dd className={styles.detailsValue}>
                        {fee != null ? formatSats(fee) : 'unavailable'}
                    </dd>
                </div>
            </dl>
        </div>
    );
}

function formatSats(value) {
    const n = Number(value || 0);
    return `${n.toLocaleString()} sats`;
}

function ellipsizeMiddle(s, head = 12, tail = 8) {
    const str = String(s ?? '');
    return str.length > head + tail + 1
        ? `${str.slice(0, head)}…${str.slice(-tail)}`
        : str;
}
