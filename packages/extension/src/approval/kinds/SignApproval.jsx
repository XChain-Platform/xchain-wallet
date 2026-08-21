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
import { Screen, Button, Input, ChainBadge, Icon } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
    schemas as schemasLib,
} from '@xchain-wallet/core';
import { BalanceChanges } from '@xchain-wallet/core/shared/components/BalanceChanges.jsx';
import { RawPsbtViewer } from '@xchain-wallet/core/shared/components/RawPsbtViewer.jsx';
// §5.6 slice 4: the confirm surface's building blocks, reused here.
// The whole <ConfirmActionModal> deliberately is NOT reused: this window is
// already a confirm surface with its own Screen, origin block, always-allow
// toggle and Approve/Reject footer, so nesting the modal would mean two
// Screens and two footers. §5.5 exports the panels separately for exactly
// this case - the parts that verify intent are shared, the approval chrome
// stays the approval window's.
import { PsbtIntentPanel } from '@xchain-wallet/core/shared/components/PsbtIntentPanel.jsx';
import { PreflightPanel } from '@xchain-wallet/core/shared/components/PreflightPanel.jsx';
import { ActionIntentSummary } from '@xchain-wallet/core/shared/components/ActionIntentSummary.jsx';
import { psbtRefusalReason } from '@xchain-wallet/core/shared/components/PsbtConfirmScreen.jsx';
import { canApproveWithReport, toggleAcknowledged } from '@xchain-wallet/core/shared/hooks/useConfirmAction.js';
import { resolveDisplayTickers } from '@xchain-wallet/core/shared/utils/resolveDisplayTickers.js';
import { actionDisplayLabel } from '@xchain-wallet/core/shared/utils/actionDisplayLabel.js';
import {
    listWallets,
    resolveApproval,
    getAddressBalances,
    getAddressesByChain,
    getSettings,
    parsePsbt,
    parseCoSign,
    preflight,
    describeAction as describeActionOnHost,
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
    coSign: 'Co-sign transaction',
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
        /** @type {{ loading: boolean, error: string | null, decomposed: any | null, ownAddresses: Set<string>, action: any | null, actionDecodeReason: string | null }} */
        ({ loading: false, error: null, decomposed: null, ownAddresses: new Set(), action: null, actionDecodeReason: null }),
    );
    useEffect(() => {
        if (kind !== 'signPsbt') return undefined;
        if (!chainId || !psbtHexForSign) {
            setPsbtIntent({
                loading: false,
                error: !chainId ? 'No chain specified. Cannot decode this transaction.' : null,
                decomposed: null,
                ownAddresses: new Set(),
                action: null,
                actionDecodeReason: null,
            });
            return undefined;
        }
        let cancelled = false;
        setPsbtIntent({
            loading: true, error: null, decomposed: null, ownAddresses: new Set(),
            action: null, actionDecodeReason: null,
        });
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
                    // The XChain action carried inside, when it
                    // decodes. A punt is a state to render, not a parse failure.
                    action: res?.action || null,
                    actionDecodeReason: res?.actionDecodeReason || null,
                });
            } catch (err) {
                if (cancelled) return;
                setPsbtIntent({
                    loading: false,
                    error: err?.message || 'Failed to decode transaction.',
                    decomposed: null,
                    ownAddresses: new Set(),
                    action: null,
                    actionDecodeReason: null,
                });
            }
        }
        loadIntent();
        return () => { cancelled = true; };
    }, [kind, chainId, psbtHexForSign, walletId]);

    // §5.6 slice 4 / §6 "dApp-supplied action string": run pre-flight for
    // the requested action and render the same <PreflightPanel> the in-wallet
    // confirm page uses, so a dApp request gets the indexer's own verdict before
    // the password is entered rather than only a balance-delta guess.
    //
    // ONE report per approval request (§4.8): the window is created per request
    // and this runs once for it. The report stays in this window; the dApp only
    // ever learns approve or reject.
    const [preflightState, setPreflightState] = useState(
        /** @type {{ loading: boolean, report: any | null }} */
        ({ loading: false, report: null }),
    );
    const [acknowledged, setAcknowledged] = useState(() => new Set());
    // Shared with the hook: an add-only copy here made the "Sign anyway"
    // checkbox a one-way latch on the dApp approval surface too.
    const acknowledge = (code) => setAcknowledged((prev) => toggleAcknowledged(prev, code));
    useEffect(() => {
        if (kind !== 'signAction' || !chainId) return undefined;
        // The action string the dApp supplied IS the payload for this kind, so
        // it is what gets checked (never a re-serialization of form state).
        const actionString = payload?.payload?.actionString || payload?.actionString || null;
        if (typeof actionString !== 'string' || !actionString) return undefined;
        let cancelled = false;
        setPreflightState({ loading: true, report: null });
        preflight({
            chainId,
            actionString,
            source: previewBalances.fromAddress || undefined,
            mode: 'report',
        })
            .then((report) => {
                if (!cancelled) setPreflightState({ loading: false, report: report || null });
            })
            .catch(() => {
                // Best-effort (§4.2): a dead explorer must not block approval.
                // A null report reads as "no findings" and Approve stays live.
                if (!cancelled) setPreflightState({ loading: false, report: null });
            });
        return () => { cancelled = true; };
    }, [kind, chainId, payload, previewBalances.fromAddress]);

    // §22 / P4 co-sign preview: decode the action the agent wants co-signed and
    // dry-run the account policy, so the user approves a legible request (which
    // account, which action, in-policy or not) rather than an opaque hex.
    const coSignAccountId = kind === 'coSign' ? payload?.payload?.accountId : null;
    const coSignPsbtHex = kind === 'coSign' ? payload?.payload?.psbtHex : null;
    const [coSignPreview, setCoSignPreview] = useState(
        /** @type {{ loading: boolean, error: string | null, preview: any | null }} */
        ({ loading: false, error: null, preview: null }),
    );
    useEffect(() => {
        if (kind !== 'coSign') return undefined;
        if (!coSignAccountId || !coSignPsbtHex) {
            setCoSignPreview({ loading: false, error: 'Missing co-sign request details.', preview: null });
            return undefined;
        }
        let cancelled = false;
        setCoSignPreview({ loading: true, error: null, preview: null });
        (async () => {
            try {
                const preview = await parseCoSign({ accountId: coSignAccountId, psbtHex: coSignPsbtHex });
                if (!cancelled) setCoSignPreview({ loading: false, error: null, preview });
            } catch (err) {
                if (!cancelled) setCoSignPreview({ loading: false, error: err?.message || 'Failed to decode the co-sign request.', preview: null });
            }
        })();
        return () => { cancelled = true; };
    }, [kind, coSignAccountId, coSignPsbtHex]);

    // §3.2/§3.5: the plain-English intent, described by the SDK on the
    // host rather than by the wallet's own local describer here.
    //
    // Two reasons this window in particular must not keep its own copy. The
    // params are the one set on any signing surface that an ATTACKER wrote,
    // and the local describer applies none of §3.5's hardening - a bidi
    // override in a dApp's MEMO reordered the sentence the user read while
    // the bytes said something else. And the local copy described 13 actions
    // to the SDK's 30, so a dApp asking to sign an ORDER, a STAKE or a VOTE
    // got "no plain-English summary is available" on the screen where the
    // whole point is knowing what is being approved.
    //
    // Runs for signAction (params from the dApp) and coSign (params the host
    // decoded out of the PSBT). Best-effort: a failure leaves the intent null
    // and the surface says so, rather than falling back to unhardened text.
    const coSignDecoded = coSignPreviewDecodedFrom(coSignPreview);
    const describeAction_ = kind === 'signAction'
        ? { action: resolvedPayload?.action, params: resolvedPayload?.payload }
        : (kind === 'coSign' && coSignDecoded ? coSignDecoded : null);
    const [intent, setIntent] = useState(
        /** @type {{ loading: boolean, decoded: any | null }} */
        ({ loading: false, decoded: null }),
    );
    const intentKey = describeAction_ ? JSON.stringify(describeAction_) : null;
    useEffect(() => {
        if (!chainId || !intentKey) return undefined;
        const req = JSON.parse(intentKey);
        if (!req.action) return undefined;
        let cancelled = false;
        setIntent({ loading: true, decoded: null });
        describeActionOnHost({
            chainId,
            action: req.action,
            ...(req.version !== undefined && { version: req.version }),
            params: req.params || {},
        })
            .then((decoded) => { if (!cancelled) setIntent({ loading: false, decoded: decoded || null }); })
            .catch(() => { if (!cancelled) setIntent({ loading: false, decoded: null }); });
        return () => { cancelled = true; };
    }, [chainId, intentKey]);


    const title = KIND_TITLE[kind] ?? 'Approval required';
    const showSavePermanent =
        kind === 'signAction' ||
        (kind === 'signMessage' && !payload?.payload?.alreadyGranted);

    // Approve / Reject, thumbs up and thumbs down, matching the in-wallet confirm
    // screen (ConfirmActionModal.jsx). This REPLACES the older §21.7 convention
    // where action and PSBT signing appended the chain name to the approve verb:
    // operator decision, the verb is the decision being made and the chain belongs
    // in the request details, not on the button. The chain is still named on this
    // screen by its own ChainBadge, so approval-drift between tabs (§21.3) stays
    // addressed by the badge rather than by the button text. The smoke test
    // asserts the retired wording never reappears in this file.
    // Sign-in keeps its own verb: it is not an approval of a balance-moving
    // action, and "Approve" would understate what signing in to a site does.
    const approveLabel = kind === 'signIn' ? 'Sign in' : 'Approve';

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

    // Also hold approval while the independent decode is still in flight:
    // the intent summary (destinations / amounts / fee) has not rendered
    // yet, so approving now would be approving effects the user could not
    // see. Once decode settles this drops to false and either the summary
    // or `psbtDecodeFailed` governs.
    const psbtDecodePending =
        kind === 'signPsbt' && !!psbtHexForSign && psbtIntent.loading;

    const psbtApprovalBlocked = psbtDecodeFailed || psbtDecodePending;

    // Same gate for co-sign approvals (WYSIWYS parity with signPsbt): when
    // the wallet already knows the request is undecodable or out-of-policy,
    // Approve must not be clickable - the summary even tells the user the
    // co-signer will refuse it. The co-signer re-decodes and re-checks policy
    // server-side, so this is defense-in-depth, not the only gate. Also holds
    // while the preview is still loading (approving unseen effects).
    const coSignApprovalBlocked =
        kind === 'coSign' &&
        (coSignPreview.loading ||
            coSignPreview.error !== null ||
            !coSignPreview.preview ||
            !coSignPreview.preview.decodeOk ||
            !coSignPreview.preview.policyOk);

    // §5.5 refusal, layered ON TOP of the gates above (never replacing
    // them): a PSBT that decomposed fine but whose ACTION data will not decode,
    // while spending our own inputs, is the user authorizing bytes nobody can
    // read. Developer mode is the documented inspect-and-sign escape hatch.
    // Distinct from psbtDecodeFailed, which is "we cannot even show the
    // outputs" and blocks unconditionally.
    const psbtSpendsOwnInputs = kind === 'signPsbt'
        && Array.isArray(psbtIntent.decomposed?.inputs)
        && psbtIntent.decomposed.inputs.some(
            (i) => i.address && psbtIntent.ownAddresses.has(i.address),
        );
    const psbtRefusal = kind === 'signPsbt' && !psbtIntent.loading
        ? psbtRefusalReason({
            spendsOwnInputs: psbtSpendsOwnInputs,
            actionDecoded: !!psbtIntent.action,
            // Keys on the REASON: a dApp asking us to sign an ordinary payment
            // (NO_OP_RETURN) is not hiding anything and must not be refused.
            decodeReason: psbtIntent.actionDecodeReason,
            developerMode,
        })
        : null;

    // §4.2 pre-flight gate, using the SAME predicate the in-wallet confirm page
    // uses: a locally-provable error hard-blocks, a network-sourced one blocks
    // until the user acknowledges that specific finding.
    const preflightBlocked = kind === 'signAction'
        && !canApproveWithReport(preflightState.report, acknowledged);

    const approvalBlocked = psbtApprovalBlocked || coSignApprovalBlocked
        || !!psbtRefusal || preflightBlocked;

    async function handleApprove(event) {
        event.preventDefault();
        if (busy || password.length === 0 || !walletId || approvalBlocked) return;
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
                        icon={<Icon.ThumbsDownIcon />}
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
                        icon={<Icon.ThumbsUpIcon />}
                        loading={busy}
                        disabled={password.length === 0 || !walletId || approvalBlocked}
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

            <SignSummary
                kind={kind}
                payload={resolvedPayload}
                decoded={intent.decoded}
                intentLoading={intent.loading}
            />

            {/* §5.6 slice 4: the shared PSBT panel enumerates every
                input AND output (the local summary showed outputs + totals
                only), marks which input this wallet signs, and states a failed
                action-decode loudly. Legacy summary stays as the flag-off path
                for one release per §5.6. */}
            {kind === 'signPsbt' ? (
                <PsbtIntentPanel
                    loading={psbtIntent.loading}
                    decomposed={psbtIntent.error ? null : psbtIntent.decomposed}
                    ownAddresses={psbtIntent.ownAddresses}
                    decodedAction={psbtIntent.action
                        ? { ...psbtIntent.action, summary: psbtActionSummary(psbtIntent.action) }
                        : null}
                    decodeError={psbtIntent.error || psbtIntent.actionDecodeReason}
                />
            ) : null}

            {/* §5.5 fail-closed refusal: Approve is already disabled by
                `approvalBlocked`; this says why, in the same words the
                in-wallet PSBT confirm page uses. */}
            {psbtRefusal ? (
                <p className={styles.refusal} role="alert" data-testid="approval-refusal">
                    {psbtRefusal}
                </p>
            ) : null}

            {kind === 'coSign' ? (
                <>
                    {/* The policy verdict and account context stay the
                        co-signer's own; the ACTION intent now renders through
                        the shared summary so an agent request and a hand-signed
                        one describe themselves identically. */}
                    {coSignPreview.preview?.decodeOk && intent.decoded ? (
                        <ActionIntentSummary decoded={intent.decoded} />
                    ) : null}
                    <CoSignIntentSummary
                        loading={coSignPreview.loading}
                        error={coSignPreview.error}
                        preview={coSignPreview.preview}
                    />
                </>
            ) : null}

            {kind === 'signAction' ? (
                <>
                    {/* The indexer's own verdict for the dApp's action, on the
                        same panel the in-wallet confirm page renders. */}
                    <PreflightPanel
                        report={preflightState.report}
                        loading={preflightState.loading}
                        acknowledged={acknowledged}
                        onAcknowledge={acknowledge}
                    />
                    <BalanceChanges
                        result={previewResult}
                        loading={previewBalances.loading}
                        error={previewBalances.error}
                    />
                </>
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

/*
 * The action a co-sign request carries, in the shape `action.describe`
 * wants, or null while the preview is loading / could not be decoded.
 * `previewCoSignRequest` already ran the PSBT through the SDK's fail-closed
 * decoder host-side, so a `decodeOk` preview is exactly as canonical here as
 * a composed action string is on the in-wallet path.
 */
function coSignPreviewDecodedFrom(coSignPreview) {
    const preview = coSignPreview?.preview;
    if (!preview?.decodeOk || !preview.action) return null;
    return { action: preview.action, params: preview.params || {} };
}

function SignSummary({ kind, payload, decoded, intentLoading }) {
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
            // The full input/output enumeration renders in <PsbtIntentPanel>
            // below; the raw hex stays available in the developer-mode
            // RawPsbtViewer. Here we surface only the signing
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
            // Described by the SDK, host-side (see `intent` above).
            // While it is in flight, or if it could not be described, this
            // says so rather than rendering a locally-guessed sentence about
            // attacker-supplied params.
            if (!decoded) {
                return (
                    <div className={shared.summary}>
                        <p className={shared.summaryLabel}>{actionDisplayLabel(payload?.action) || 'Action'}</p>
                        <p className={shared.summaryValue} style={{ whiteSpace: 'normal' }}>
                            {intentLoading
                                ? 'Reading this action…'
                                : 'This action could not be described. Approve only if you know exactly what it does.'}
                        </p>
                    </div>
                );
            }
            return (
                <>
                    <div className={shared.summary}>
                        <p className={shared.summaryLabel}>{actionDisplayLabel(payload?.action) || 'Action'}</p>
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
                    <p className={shared.summaryLabel} style={{ marginTop: 8 }}>One-time code</p>
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
/**
 * Co-sign intent summary (§22 / P4). Shows which agent account is being asked
 * to co-sign, the action decoded from the PSBT (with amount + destinations),
 * and whether the request is within the account's stored policy. The wallet
 * always prompts: the policy is a safety net, the user is the final gate.
 */
function CoSignIntentSummary({ loading, error, preview }) {
    if (loading) {
        return (
            <div className={shared.summary}>
                <p className={shared.summaryLabel}>Co-sign request</p>
                <p className={shared.summaryValue} style={{ whiteSpace: 'normal' }}>Decoding request…</p>
            </div>
        );
    }
    if (error || !preview) {
        return (
            <ul className={styles.warnings} role="alert">
                <li>
                    {error
                        ? `This co-sign request could not be decoded (${error}). `
                        : 'This co-sign request could not be decoded. '}
                    Only approve it if you trust the source.
                </li>
            </ul>
        );
    }

    const acct = preview.account || {};
    const dests = Array.isArray(preview.destinations) ? preview.destinations : [];

    return (
        <div className={shared.summary}>
            <p className={shared.summaryLabel}>Agent account</p>
            <p className={shared.summaryValue} style={{ whiteSpace: 'normal' }}>
                {acct.name || 'Co-signer account'}
                {acct.aggregateAddress ? ` (${acct.aggregateAddress})` : ''}
            </p>

            {preview.decodeOk ? (
                <>
                    <p className={shared.summaryLabel}>Action</p>
                    <p className={shared.summaryValue} style={{ whiteSpace: 'normal' }}>
                        {actionDisplayLabel(preview.action) || preview.action}
                        {preview.amount !== undefined ? ` ${preview.amount}` : ''}
                        {preview.tick ? ` ${preview.tick}` : ''}
                    </p>
                    {dests.length > 0 ? (
                        <>
                            <p className={shared.summaryLabel}>To</p>
                            <p className={shared.summaryValue} style={{ whiteSpace: 'normal' }}>{dests.join(', ')}</p>
                        </>
                    ) : null}
                </>
            ) : (
                <ul className={styles.warnings} role="alert">
                    <li>The action could not be decoded from this transaction ({preview.decodeReason}).</li>
                </ul>
            )}

            {preview.decodeOk && !preview.policyOk ? (
                <ul className={styles.warnings} role="alert">
                    <li>This request is outside the account policy ({preview.policyReason}). The co-signer will refuse it even if you approve.</li>
                </ul>
            ) : null}
            {preview.decodeOk && preview.policyOk && preview.needsConfirmation ? (
                <p className={shared.summaryValue} style={{ whiteSpace: 'normal' }}>
                    Above the policy confirm-threshold: review carefully before approving.
                </p>
            ) : null}
        </div>
    );
}

// One-line intent for an action decoded OUT of a PSBT (§5.5). Mirrors
// PsbtSignForm's wording: on this variant the output set is what gets verified,
// so a decoded action is context and is not dressed up as more than that.
function psbtActionSummary(parsed) {
    const label = parsed?.action || 'Unknown action';
    const version = parsed?.version ?? null;
    return version != null
        ? `Carries an XChain ${label} action (v${version})`
        : `Carries an XChain ${label} action`;
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
