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
    i18n,
    registry as registryLib,
    decoder as decoderLib,
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
import { describeUnreadableReason } from '@xchain-wallet/core/shared/components/psbtDecodeReasons.js';
import { describePolicyReason } from '@xchain-wallet/core/shared/components/coSignPolicyReasons.js';
import { isDeveloperMessage, userFacingMessage } from '@xchain-wallet/core/shared/utils/userFacingMessage.js';
import { canApproveWithReport, toggleAcknowledged } from '@xchain-wallet/core/shared/hooks/useConfirmAction.js';
import { resolveDisplayTickers } from '@xchain-wallet/core/shared/utils/resolveDisplayTickers.js';
import { actionDisplayLabel, psbtActionSummary } from '@xchain-wallet/core/shared/utils/actionDisplayLabel.js';
import { neutralizeControlText } from '@xchain-wallet/core/shared/utils/textHardening.js';
import { OriginIdentity } from '@xchain-wallet/core/shared/components/OriginIdentity.jsx';
import {
    listWallets,
    resolveApproval,
    getAddressBalances,
    getAddressesByChain,
    getSettings,
    parsePsbt,
    requoteNativeFee,
    parseCoSign,
    preflight,
    describeAction as describeActionOnHost,
    getTokenInfo,
} from '../messaging.js';
import shared from '../approval.module.css';
import styles from './SignApproval.module.css';

const chainRegistry = registryLib.defaultRegistry();
const { t } = i18n;

// Cache of `^id` -> resolved ticker name, keyed by chain. A ticker id is
// immutable, so entries never expire. Resolves a single compaction reference
// for display; returns null (caller keeps the `^id`) on any failure.
const tickNameCache = new Map();
async function resolveTickName(chainId, ref) {
    const key = chainId + '|' + ref;
    if (tickNameCache.has(key)) return tickNameCache.get(key);
    try {
        const info = await getTokenInfo({ chainId, tick: ref });
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
 * Shared approval screen for the password-gated sign kinds
 * (`signMessage` / `signPsbt` / `signAction` / `coSign` / `signIn`). The inner
 * summary block renders per-kind; everything else (origin badge,
 * password input, always-allow toggle, footer buttons) is shared.
 *
 * Result envelope matches SignApprovalResult:
 *   `{ approved: true, walletId, password, savePermanent? }`, and for
 *   signIn also the picked `address` and its `chainId`.
 *
 * The password is the whole secret this screen collects. It never asked for a
 * BIP39 passphrase, and a passphrase wallet now carries its own encrypted 25th
 * word on the record, so there is nothing further to gather here.
 *
 * Wrong-password detection happens server-side; the bridge handler
 * passes the password to the signer flow, and if decryption fails the
 * caller dApp sees a structured error. We surface that back to the
 * user here without closing the window so they can retry.
 *
 * @param {object} props
 * @param {string} props.id
 * @param {'signMessage' | 'signPsbt' | 'signAction' | 'coSign' | 'signIn'} props.kind
 * @param {any} props.payload  The bridge-level request
 * @param {() => void} props.onReject
 */
export function SignApproval({ id, kind, payload, onReject }) {
    const origin = neutralizeControlText(payload?.origin || '', { maxLength: 2048 });
    const chainId = payload?.chainId || null;
    const descriptor = chainId ? chainRegistry.get(chainId) : null;

    const [walletId, setWalletId] = useState(/** @type {string | null} */ (null));
    const [password, setPassword] = useState('');
    const [savePermanent, setSavePermanent] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);
    const [signInChoice, setSignInChoice] = useState(0);
    const [walletMode, setWalletMode] = useState(/** @type {string | null} */ (null));
    const [settings, setSettings] = useState(/** @type {any | null} */ (null));
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Sign-in signs as one address the user picks here, from the list the
    // background built out of this site's grant; nothing else can be chosen.
    const signInAddresses = kind === 'signIn' && Array.isArray(payload?.payload?.addresses)
        ? payload.payload.addresses.filter(
            (c) => typeof c?.address === 'string' && c.address && typeof c?.chainId === 'string',
        )
        : [];
    const signInPick = signInAddresses[signInChoice] ?? null;

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
                // This realm's registry learns user-added chains from the
                // settings record (§9.7 Developer Mode); the boot-time read
                // in main.jsx fails while the vault is locked, and a sign
                // prompt always runs unlocked, so this read is the one that
                // lands. Idempotent under the registry has() guard.
                try { registryLib.hydrateCustomChainsFromSettings(chainRegistry, s); } catch { /* bundled descriptors keep serving */ }
                if (cancelled) return;
                setSettings(s || null);
                setDeveloperMode(Boolean(s?.developerMode));
                setWalletMode(s?.walletMode || 'full');
            })
            .catch(() => { /* keep developerMode false on failure */
                if (!cancelled) setWalletMode('full');
            });
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
        /** @type {{ loading: boolean, error: string | null, decomposed: any | null, ownAddresses: Set<string>, action: any | null, actionDecodeReason: string | null, feeMode: string | null }} */
        ({ loading: false, error: null, decomposed: null, ownAddresses: new Set(), action: null, actionDecodeReason: null, feeMode: null }),
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
                feeMode: null,
            });
            return undefined;
        }
        let cancelled = false;
        setPsbtIntent({
            loading: true, error: null, decomposed: null, ownAddresses: new Set(),
            action: null, actionDecodeReason: null, feeMode: null,
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
                const sender = res?.decomposed?.inputs?.[0]?.address || null;
                let feeMode = null;
                if (res?.action?.actionString) {
                    try {
                        const quote = await requoteNativeFee({
                            chainId,
                            actionString: res.action.actionString,
                            ...(sender ? { source: sender } : {}),
                        });
                        feeMode = nativeFeeModeFromOutputs(res?.decomposed?.outputs, quote);
                    } catch { /* a fee quote failure leaves the dry-run on its default lane */ }
                }
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
                    feeMode,
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
                    feeMode: null,
                });
            }
        }
        loadIntent();
        return () => { cancelled = true; };
    }, [kind, chainId, psbtHexForSign, walletId]);

    const psbtSourceAddress = useMemo(() => {
        if (kind !== 'signPsbt' || !Array.isArray(psbtIntent.decomposed?.inputs)) return null;
        return psbtIntent.decomposed.inputs[0]?.address || null;
    }, [kind, psbtIntent]);
    const preflightActionString = kind === 'signAction'
        ? (payload?.payload?.actionString || payload?.actionString || null)
        : kind === 'signPsbt'
            ? psbtIntent.action?.actionString || null
            : null;
    const preflightSourceAddress = kind === 'signPsbt'
        ? psbtSourceAddress
        : previewBalances.fromAddress;

    // Run pre-flight for either a dApp action request or the readable action
    // decoded from a dApp PSBT. The latter now matches the in-wallet PSBT path.
    //
    // ONE report per approval request (§4.8): the window is created per request
    // and this runs once for it. The report stays in this window; the dApp only
    // ever learns approve or reject.
    const [preflightState, setPreflightState] = useState(
        /** @type {{ loading: boolean, report: any | null, actionString: string | null }} */
        ({ loading: false, report: null, actionString: null }),
    );
    const [acknowledged, setAcknowledged] = useState(() => new Set());
    // Shared with the hook: an add-only copy here made the "Sign anyway"
    // checkbox a one-way latch on the dApp approval surface too.
    const acknowledge = (code) => setAcknowledged((prev) => toggleAcknowledged(prev, code));
    useEffect(() => {
        if (!chainId || typeof preflightActionString !== 'string' || !preflightActionString) {
            return undefined;
        }
        let cancelled = false;
        setPreflightState({ loading: true, report: null, actionString: preflightActionString });
        preflight({
            chainId,
            actionString: preflightActionString,
            ...(preflightSourceAddress ? { source: preflightSourceAddress } : {}),
            ...(kind === 'signPsbt' && psbtIntent.feeMode
                ? { feeMode: psbtIntent.feeMode } : {}),
            mode: 'report',
        })
            .then((report) => {
                if (!cancelled) {
                    setPreflightState({
                        loading: false,
                        report: kind === 'signPsbt' && !preflightSourceAddress
                            ? advisoryPreflightReport(report)
                            : report || null,
                        actionString: preflightActionString,
                    });
                }
            })
            .catch(() => {
                // Best-effort (§4.2): a dead explorer must not block approval.
                // A null report reads as "no findings" and Approve stays live.
                if (!cancelled) {
                    setPreflightState({
                        loading: false,
                        report: null,
                        actionString: preflightActionString,
                    });
                }
            });
        return () => { cancelled = true; };
    }, [kind, chainId, preflightActionString, preflightSourceAddress, psbtIntent.feeMode]);

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
    const appName = neutralizeControlText(
        payload?.appName || payload?.payload?.appName || '',
        { maxLength: 80 },
    );

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
    const preflightBlocked = !!preflightActionString
        && (preflightState.actionString !== preflightActionString
            || preflightState.loading
            || !canApproveWithReport(preflightState.report, acknowledged));

    // Hold sign-in until an offered address is selected
    const signInBlocked = kind === 'signIn' && !signInPick;

    const watcherMode = walletMode === 'watcher';
    const watcherCopy = ['signPsbt', 'signAction', 'coSign'].includes(kind)
        ? 'Watcher mode never signs or asks for a password. Reject this request and move its unsigned transaction to a Signer wallet.'
        : 'Watcher mode never signs or asks for a password. Reject this request or switch to Normal mode to sign on this device.';
    const approvalBlocked = psbtApprovalBlocked || coSignApprovalBlocked
        || !!psbtRefusal || preflightBlocked || signInBlocked;
    const modeApprovalBlocked = walletMode === null || watcherMode;

    async function handleApprove(event) {
        event.preventDefault();
        if (busy || password.length === 0 || !walletId || approvalBlocked) return;
        if (modeApprovalBlocked) return;
        setBusy(true);
        setError(null);
        try {
            await resolveApproval(id, {
                approved: true,
                walletId,
                password,
                ...(signInPick ? { address: signInPick.address, chainId: signInPick.chainId } : {}),
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
                </div>
            }
            footer={
                <div className={shared.footer}>
                    <Button
                        variant="danger"
                        block
                        icon={<Icon.ThumbsDownIcon />}
                        onClick={onReject}
                        disabled={busy}
                    >
                        {t('extension.approval.reject')}
                    </Button>
                    {!watcherMode ? (
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
                    ) : null}
                </div>
            }
        >
            {descriptor ? (
                <div className={styles.chainLine}>
                    <ChainBadge descriptor={descriptor} size="sm" />
                </div>
            ) : null}

            {origin ? (
                <section className={styles.source} aria-label={t('extension.sign.source')}>
                    <OriginIdentity
                        origin={payload?.origin || ''}
                        label={t('extension.approval.requestingSite')}
                        headingClassName={styles.sourceLabel}
                        originClassName={styles.sourceOrigin}
                        embedded
                        as="div"
                    >
                        {appName ? (
                            <p className={styles.sourceApp}>{t('extension.sign.declaredName', { name: appName })}</p>
                        ) : null}
                    </OriginIdentity>
                </section>
            ) : null}

            <SignSummary
                kind={kind}
                payload={resolvedPayload}
                decoded={intent.decoded}
                intentLoading={intent.loading}
                // #40: the address this window will spend from. Already
                // resolved above for the balance preview and the pre-flight
                // call; it was never shown to the user deciding whether to
                // approve.
                sourceAddress={preflightSourceAddress}
            />

            {kind === 'signIn' ? (
                <fieldset className={shared.summary} aria-label={t('extension.sign.signInAs')}>
                    <legend className={shared.summaryLabel}>{t('extension.sign.signInAs')}</legend>
                    {signInAddresses.length === 0 ? (
                        <p className={shared.error} role="alert">
                            {t('extension.sign.noSignInAddress')}
                        </p>
                    ) : signInAddresses.map((c, i) => {
                        const d = chainRegistry.get(c.chainId);
                        return (
                            <label className={shared.toggleRow} key={`${c.chainId}:${c.address}`}>
                                <input
                                    type="radio"
                                    name="sign-in-address"
                                    checked={i === signInChoice}
                                    onChange={() => setSignInChoice(i)}
                                    disabled={busy}
                                />
                                {d ? <ChainBadge descriptor={d} size="sm" /> : null}
                                <span>{neutralizeControlText(c.address, { maxLength: 120 })}</span>
                            </label>
                        );
                    })}
                </fieldset>
            ) : null}

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

            {preflightActionString ? (
                <PreflightPanel
                    report={preflightState.report}
                    loading={preflightState.loading
                        || preflightState.actionString !== preflightActionString}
                    acknowledged={acknowledged}
                    onAcknowledge={acknowledge}
                />
            ) : null}

            {kind === 'signAction' ? (
                <>
                    <BalanceChanges
                        result={previewResult}
                        loading={previewBalances.loading}
                        error={previewBalances.error}
                        chainCoin={descriptor?.coin}
                        fiatCurrency={settings?.fiatCurrency || 'USD'}
                        allowCoingeckoFallback={settings?.privacy?.priceDataEnabled !== false}
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

            {watcherMode ? (
                <p className={styles.refusal} role="status">
                    {watcherCopy}
                </p>
            ) : walletMode === null ? (
                <p role="status">{t('extension.sign.checkingWalletMode')}</p>
            ) : (
                <form
                    id="sign-approval-form"
                    onSubmit={handleApprove}
                    noValidate
                    className={styles.form}
                >
                    <Input
                        ref={inputRef}
                        type="password"
                        label={t('common.password')}
                        hint={t('extension.sign.passwordHint')}
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
                            <span>{t('extension.sign.alwaysAllow')}</span>
                        </label>
                    ) : null}
                </form>
            )}
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

function nativeFeeModeFromOutputs(outputs, quote) {
    const destination = quote?.feeDestination;
    if (!destination || !Array.isArray(outputs)) return null;
    return outputs.some((output) => output?.address === destination) ? 'native' : null;
}

function advisoryPreflightReport(report) {
    if (!report || !Array.isArray(report.findings)) return report || null;
    return {
        ...report,
        findings: report.findings.map((finding) => {
            if (finding?.severity !== 'error') return finding;
            const data = finding.data && typeof finding.data === 'object'
                ? { ...finding.data }
                : undefined;
            if (data) {
                delete data.status;
                delete data.error;
            }
            return { ...finding, overridable: true, ...(data ? { data } : {}) };
        }),
    };
}

function SignSummary({ kind, payload, decoded, intentLoading, sourceAddress = null }) {
    const inner = payload?.payload || {};
    switch (kind) {
        case 'signMessage':
            return (
                <div className={shared.summary}>
                    <p className={shared.summaryLabel}>{t('extension.sign.message')}</p>
                    <HardenedSignedText value={inner.message} warningNoun={t('extension.sign.warningNoun.message')} />
                    {inner.address ? (
                        <>
                            <p className={shared.summaryLabel} style={{ marginTop: 8 }}>{t('extension.sign.signer')}</p>
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
                    <p className={shared.summaryLabel}>{t('extension.sign.signingPaths')}</p>
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
                        <p className={shared.summaryLabel}>{actionDisplayLabel(payload?.action) || t('extension.sign.action')}</p>
                        <p className={shared.summaryValue} style={{ whiteSpace: 'normal' }}>
                            {intentLoading
                                ? t('extension.sign.action.reading')
                                : t('extension.sign.action.unavailable')}
                        </p>
                    </div>
                );
            }
            return (
                <>
                    <div className={shared.summary}>
                        <p className={shared.summaryLabel}>{actionDisplayLabel(payload?.action) || t('extension.sign.action')}</p>
                        <p
                            className={shared.summaryValue}
                            style={{ whiteSpace: 'normal', fontFamily: 'var(--xc-font-sans)', fontSize: 13, lineHeight: 1.4 }}
                        >
                            {decoded.summary}
                        </p>
                        {/* #40: "From", not "Signer" as the signMessage case
                            above says, because this one spends. A dApp picks
                            the account, the user did not, so the window that
                            asks for approval has to name it. */}
                        {sourceAddress ? (
                            <>
                                <p className={shared.summaryLabel} style={{ marginTop: 8 }}>{t('extension.sign.from')}</p>
                                <pre className={shared.summaryValue} data-testid="sign-approval-source">{sourceAddress}</pre>
                            </>
                        ) : null}
                        {decoded.details.length > 0 ? (
                            <details className={styles.details}>
                                <summary className={styles.detailsToggle}>
                                    {t('extension.sign.details', { count: decoded.details.length })}
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
                    <p className={shared.summaryLabel}>{t('extension.sign.signInTo')}</p>
                    <HardenedSignedText
                        value={inner.appId || payload?.origin || ''}
                        warningNoun={t('extension.sign.warningNoun.signIn')}
                    />
                    <p className={shared.summaryLabel} style={{ marginTop: 8 }}>{t('extension.sign.oneTimeCode')}</p>
                    <HardenedSignedText value={inner.nonce} warningNoun={t('extension.sign.warningNoun.signIn')} />
                </div>
            );
        default:
            return null;
    }
}

function HardenedSignedText({ value, warningNoun }) {
    const original = String(value ?? '');
    const display = neutralizeControlText(original);
    return (
        <>
            <pre className={shared.summaryValue}>{display}</pre>
            {display !== original ? (
                <p className={styles.textWarning}>
                    {t('extension.sign.controlCharacters', { noun: warningNoun })}
                </p>
            ) : null}
        </>
    );
}

/**
 * §21.2 / §48: decoded signPsbt intent. Renders the transaction's real
 * destinations and amounts so the user can cross-check what they're
 * signing against the dApp's stated intent, instead of trusting an opaque
 * hex string. Outputs paying the user's own addresses are labelled as
 * change; everything else is money leaving the wallet.
 */
const COSIGN_UNREADABLE = 'This co-sign request could not be read.';

/**
 * The alert's first sentence when the co-sign preview failed. Copy written for
 * a user passes through after the lead sentence; developer text never does.
 *
 * @param {string|null} error
 * @returns {string}
 */
function coSignErrorSentence(error) {
    if (!error) return COSIGN_UNREADABLE;
    const text = userFacingMessage(error, COSIGN_UNREADABLE);
    return text === COSIGN_UNREADABLE ? text : `${COSIGN_UNREADABLE} ${text}`;
}

/**
 * The alert sentence for an action the wallet could not decode. Names the
 * cause in plain words when the decoder's code has one; never the raw code.
 *
 * @param {string|null} decodeReason
 * @returns {string}
 */
function coSignUndecodedSentence(decodeReason) {
    const why = describeUnreadableReason(decodeReason);
    return why
        ? `The action in this co-sign request could not be read because ${why}.`
        : 'The action in this co-sign request could not be read.';
}

/**
 * The alert sentence for a request the account policy refuses. Names the rule
 * in plain words when the policy code has one; never the raw code.
 *
 * @param {string|null} policyReason
 * @returns {string}
 */
function coSignPolicySentence(policyReason) {
    const why = describePolicyReason(policyReason);
    return why
        ? `This request is outside the account policy because ${why}.`
        : 'This request is outside the account policy.';
}

/**
 * Collapsed disclosure holding a raw code or message for support, kept outside
 * the alert so a signer reads only plain words.
 *
 * @param {{ testId: string, text: string }} props
 */
function CoSignTechnicalDetails({ testId, text }) {
    return (
        <details className={styles.details} data-testid={testId}>
            <summary className={styles.detailsToggle}>{t('extension.sign.technicalDetails')}</summary>
            <code style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</code>
        </details>
    );
}

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
                <p className={shared.summaryLabel}>{t('extension.sign.coSignRequest')}</p>
                <p className={shared.summaryValue} style={{ whiteSpace: 'normal' }}>{t('extension.sign.decodingRequest')}</p>
            </div>
        );
    }
    if (error || !preview) {
        return (
            <>
                <ul className={styles.warnings} role="alert">
                    <li>
                        {coSignErrorSentence(error)}
                        {' '}{t('extension.sign.trustSource')}
                    </li>
                </ul>
                {error && isDeveloperMessage(error) ? (
                    <CoSignTechnicalDetails testId="cosign-error-details" text={error} />
                ) : null}
            </>
        );
    }

    const acct = preview.account || {};
    const dests = Array.isArray(preview.destinations) ? preview.destinations : [];

    return (
        <div className={shared.summary}>
            <p className={shared.summaryLabel}>{t('extension.sign.agentAccount')}</p>
            <p className={shared.summaryValue} style={{ whiteSpace: 'normal' }}>
                {acct.name || t('extension.sign.coSignerAccount')}
                {acct.aggregateAddress ? ` (${acct.aggregateAddress})` : ''}
            </p>

            {preview.decodeOk ? (
                <>
                    <p className={shared.summaryLabel}>{t('extension.sign.action')}</p>
                    <p className={shared.summaryValue} style={{ whiteSpace: 'normal' }}>
                        {actionDisplayLabel(preview.action) || preview.action}
                        {preview.amount !== undefined ? ` ${preview.amount}` : ''}
                        {preview.tick ? ` ${preview.tick}` : ''}
                    </p>
                    {dests.length > 0 ? (
                        <>
                            <p className={shared.summaryLabel}>{t('extension.sign.to')}</p>
                            <p className={shared.summaryValue} style={{ whiteSpace: 'normal' }}>{dests.join(', ')}</p>
                        </>
                    ) : null}
                </>
            ) : (
                <>
                    <ul className={styles.warnings} role="alert">
                        <li>{coSignUndecodedSentence(preview.decodeReason)}</li>
                    </ul>
                    {preview.decodeReason ? (
                        <CoSignTechnicalDetails testId="cosign-decode-details" text={String(preview.decodeReason)} />
                    ) : null}
                </>
            )}

            {preview.decodeOk && !preview.policyOk ? (
                <>
                    <ul className={styles.warnings} role="alert">
                        <li>
                            {coSignPolicySentence(preview.policyReason)}
                            {' '}{t('extension.sign.policyRefusal')}
                        </li>
                    </ul>
                    {preview.policyReason ? (
                        <CoSignTechnicalDetails testId="cosign-policy-details" text={String(preview.policyReason)} />
                    ) : null}
                </>
            ) : null}
            {preview.decodeOk && preview.policyOk && preview.needsConfirmation ? (
                <p className={shared.summaryValue} style={{ whiteSpace: 'normal' }}>
                    {t('extension.sign.confirmThreshold')}
                </p>
            ) : null}
        </div>
    );
}
