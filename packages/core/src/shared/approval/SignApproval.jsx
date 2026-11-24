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
import {
    Screen,
    Button,
    ChoiceControl,
    FormPage,
    Input,
    ChainBadge,
    Icon,
    IconSelect,
    Notice,
} from '@xchain-wallet/core/ui';
import { useBackHandler } from '@xchain-wallet/core/ui/backStack.js';
import {
    decoder as decoderLib,
    i18n,
    registry as registryLib,
} from '@xchain-wallet/core';
import '@xchain-wallet/core/i18n/locales/en/extension.js';
import '@xchain-wallet/core/i18n/locales/en/components.js';
import '@xchain-wallet/core/i18n/locales/en/send.js';
import '@xchain-wallet/core/i18n/locales/en/signerSelect.js';
import { PanicSignStatus, usePanicFreeze } from '@xchain-wallet/core/shared/safety/PanicFreezeNotice.jsx';
import { PANIC_SURFACE_REJECT_ONLY } from '@xchain-wallet/core/shared/safety/panicNotice.js';
import { amountLabel, barePsbtSendPresentation } from '@xchain-wallet/core/shared/components/PsbtIntentPanel.jsx';
import {
    ConfirmButtons,
    ConfirmStandard,
} from '@xchain-wallet/core/shared/components/ConfirmStandard.jsx';
import { TickerIcon } from '@xchain-wallet/core/shared/components/TickerIcon.jsx';
import { OriginIdentity } from '@xchain-wallet/core/shared/components/OriginIdentity.jsx';
import '@xchain-wallet/core/i18n/locales/en/confirmStandard.js';
import { psbtRefusalReason } from '@xchain-wallet/core/shared/components/PsbtConfirmScreen.jsx';
import { describeUnreadableReason, isUnreadableActionReason } from '@xchain-wallet/core/shared/components/psbtDecodeReasons.js';
import { describePolicyReason } from '@xchain-wallet/core/shared/components/coSignPolicyReasons.js';
import { userFacingMessage } from '@xchain-wallet/core/shared/utils/userFacingMessage.js';
import {
    isAnotherDeviceLogin,
    linkAnswerOrigin,
    linkAppName,
} from '../../site_request/linkIdentity.js';
import { canApproveWithReport, toggleAcknowledged } from '@xchain-wallet/core/shared/hooks/useConfirmAction.js';
import { useFeeFiat } from '@xchain-wallet/core/shared/hooks/useFeeFiat.js';
import { resolveDisplayTickers } from '@xchain-wallet/core/shared/utils/resolveDisplayTickers.js';
import { neutralizeControlText, revealHiddenText } from '@xchain-wallet/core/shared/utils/textHardening.js';
import { formatWithThousands, groupDecodedAmounts } from '@xchain-wallet/core/shared/utils/amountFormat.js';
import {
    confirmHeadline,
    confirmStatus,
    confirmWarning,
    decodedFacts,
} from '@xchain-wallet/core/shared/utils/confirmStandardModel.js';
import { resolveFeeUnit, settingsCustomToDisplayRate } from '@xchain-wallet/core/flows/feeEstimate.js';
import { exactNetworkFeeSats } from '@xchain-wallet/core/flows/psbtNetworkFee.js';
import { actionWarningIds, withoutCoveredWarnings } from '@xchain-wallet/core/flows/actionWarnings.js';
import { WATCH_ONLY_SIGNING_MESSAGE } from '@xchain-wallet/core/shared/addressSelection.js';
import { ApprovalHeader } from './ApprovalHeader.jsx';
import { formatNativeBaseUnits, tickerForDescriptor } from '../../registry/coinTicker.js';
import { walletModeOf } from '../../schemas/wallet.js';
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
} from './index.js';
import { signingPathLines } from './signingPathLines.js';
import shared from './approval.module.css';
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
    signMessage: 'Sign Message',
    signPsbt: 'Sign Transaction',
    signAction: 'Sign Action',
    coSign: 'Co-sign Transaction',
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
    const linkRequest = payload?.linkRequest;
    const linkMode = linkRequest !== null
        && typeof linkRequest === 'object'
        && !Array.isArray(linkRequest);
    const answerOrigin = linkMode ? linkAnswerOrigin(linkRequest) : null;
    const origin = neutralizeControlText(
        linkMode ? answerOrigin || '' : payload?.origin || '',
        { maxLength: 2048 },
    );
    const chainId = payload?.chainId || null;
    const descriptor = chainId ? chainRegistry.get(chainId) : null;

    const [walletId, setWalletId] = useState(/** @type {string | null} */ (null));
    const [signingWith, setSigningWith] = useState('');
    // True once listWallets has answered either way. The PSBT decode waits on
    // it so the panel is built once, with the wallet's own addresses, instead
    // of rendering, dropping back to "Decoding" when walletId lands, and
    // rendering again with different change labels and totals.
    const [walletsSettled, setWalletsSettled] = useState(false);
    const [password, setPassword] = useState('');
    const [savePermanent, setSavePermanent] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);
    // A tap on Approve that could not go ahead (G130): its reason, shown at
    // the top of the window while that reason still holds.
    const [blockedTap, setBlockedTap] = useState(/** @type {string | null} */ (null));
    const [expired, setExpired] = useState(false);
    useBackHandler(onReject, busy);
    const [signInChoice, setSignInChoice] = useState(0);
    const [walletMode, setWalletMode] = useState(/** @type {string | null} */ (null));
    const [watchOnlyBlocked, setWatchOnlyBlocked] = useState(false);
    const [signInAllowedAddresses, setSignInAllowedAddresses] = useState(
        /** @type {Set<string> | null} */ (null),
    );
    const [settings, setSettings] = useState(/** @type {any | null} */ (null));
    const panicNotice = usePanicFreeze(PANIC_SURFACE_REJECT_ONLY, t('extension.approval.reject'));
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const requestedFee = approvalFeeRequest(payload, descriptor);
    const nativeTicker = tickerForDescriptor(descriptor);
    const { formatNativeFee } = useFeeFiat({
        chainId,
        chainCoin: requestedFee?.coinAmount ? descriptor?.coin : null,
        nativeTicker,
        settings,
    });
    const approvalFeeText = requestedFee
        ? formatApprovalFee(requestedFee, nativeTicker, formatNativeFee)
        : null;

    const walletSigningTargets = useMemo(() => {
        if (!chainId) return [];
        if (kind === 'signMessage') {
            const address = payload?.payload?.address;
            return typeof address === 'string' && address ? [{ address }] : [];
        }
        if (kind === 'signAction') {
            const address = payload?.payload?.from?.address || payload?.from?.address;
            return typeof address === 'string' && address ? [{ address }] : [];
        }
        if (kind === 'signPsbt' && Array.isArray(payload?.payload?.signingPaths)) {
            return payload.payload.signingPaths.flatMap((entry) => {
                if (typeof entry?.address === 'string' && entry.address) {
                    return [{ address: entry.address }];
                }
                if (typeof entry?.derivationPath === 'string' && entry.derivationPath) {
                    return [{ derivationPath: entry.derivationPath }];
                }
                return [];
            });
        }
        return [];
    }, [chainId, kind, payload]);

    // Sign-in signs as one address the user picks here, from the list the
    // background built out of this site's grant; nothing else can be chosen.
    const signInAddresses = kind === 'signIn'
        && signInAllowedAddresses
        && Array.isArray(payload?.payload?.addresses)
        ? payload.payload.addresses.filter((candidate) => (
            typeof candidate?.address === 'string'
            && candidate.address
            && typeof candidate?.chainId === 'string'
            && signInAllowedAddresses.has(`${candidate.chainId}:${candidate.address}`)
        ))
        : [];
    const signInPick = signInAddresses[signInChoice] ?? null;

    useEffect(() => {
        let cancelled = false;
        setWalletId(null);
        setSigningWith('');
        setWalletMode(null);
        setWatchOnlyBlocked(false);
        setSignInAllowedAddresses(null);
        setWalletsSettled(false);
        // The wallet this request resolves to; its own mode (§20) decides
        // whether this prompt may sign. Until it is known the approval stays
        // blocked; with no wallet resolved it reads as full mode.
        let picked = null;
        const pick = (wallet) => {
            picked = wallet;
            setWalletId(wallet.id);
            setSigningWith(String(wallet.name || wallet.label || 'Wallet'));
        };
        async function loadSigningWallet() {
            try {
                const list = await listWallets();
                if (cancelled) return;
                const wallets = Array.isArray(list)
                    ? list.filter((wallet) => typeof wallet?.id === 'string' && wallet.id)
                    : [];
                if (wallets.length === 0) {
                    setError('No signing wallet is available.');
                    return;
                }

                if (walletSigningTargets.length === 0 && kind !== 'signIn') {
                    pick(wallets[0]);
                    return;
                }

                const candidates = await Promise.all(wallets.map(async (wallet) => {
                    try {
                        const byChain = await getAddressesByChain(wallet.id);
                        const addresses = kind === 'signIn'
                            ? Object.entries(byChain || {}).flatMap(([addressChainId, rows]) => (
                                (Array.isArray(rows) ? rows : [])
                                    .map((address) => ({ ...address, chainId: addressChainId }))
                            ))
                            : byChain?.[chainId] || [];
                        return { wallet, addresses };
                    } catch {
                        return { wallet, addresses: [] };
                    }
                }));
                if (cancelled) return;
                const offeredSignInAddresses = new Set(
                    (Array.isArray(payload?.payload?.addresses) ? payload.payload.addresses : [])
                        .filter((candidate) => candidate?.chainId && candidate?.address)
                        .map((candidate) => `${candidate.chainId}:${candidate.address}`)
                        .filter(Boolean),
                );
                const targetMatches = ({ addresses }, requireSigningKey) => (
                    (kind === 'signIn'
                        ? addresses.some((address) => offeredSignInAddresses
                            .has(`${address?.chainId}:${address?.address}`)
                            && (!requireSigningKey || address?.source !== 'watch-only'))
                        : walletSigningTargets.every((target) => addresses.some((address) => (
                        (target.address
                            ? address?.address === target.address
                            : address?.derivationPath === target.derivationPath)
                        && (!requireSigningKey || address?.source !== 'watch-only')
                    ))))
                );
                if (kind === 'signIn'
                    && !candidates.some((candidate) => targetMatches(candidate, false))) {
                    pick(wallets[0]);
                    setSignInAllowedAddresses(offeredSignInAddresses);
                    return;
                }
                const match = candidates.find((candidate) => targetMatches(candidate, true));
                if (!match) {
                    const watchOnlyMatch = candidates.find((candidate) => targetMatches(candidate, false));
                    if (watchOnlyMatch) {
                        // The request belongs to this wallet even though it
                        // holds no signing key here; its own mode still applies.
                        picked = watchOnlyMatch.wallet;
                        setWatchOnlyBlocked(true);
                        setError(WATCH_ONLY_SIGNING_MESSAGE);
                    } else {
                        setError('The requested signing account is not available in this wallet.');
                    }
                    return;
                }
                pick(match.wallet);
                if (kind === 'signIn') {
                    setSignInAllowedAddresses(new Set(
                        match.addresses
                            .filter((address) => address?.source !== 'watch-only'
                                && offeredSignInAddresses
                                    .has(`${address?.chainId}:${address?.address}`))
                            .map((address) => `${address.chainId}:${address.address}`),
                    ));
                }
            } catch (err) {
                if (cancelled) return;
                // Show the error but still let the user reject cleanly.
                setError(userFacingMessage(err, 'Failed to load wallets.'));
            } finally {
                // Every answer, a match, no match or a failure, settles the
                // list so the PSBT decode runs exactly once.
                if (!cancelled) {
                    setWalletMode(picked ? walletModeOf(picked) : 'full');
                    setWalletsSettled(true);
                }
            }
        }
        void loadSigningWallet();
        return () => { cancelled = true; };
    }, [chainId, kind, payload, walletSigningTargets]);

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
            })
            .catch(() => { /* keep developerMode false on failure */ });
        return () => { cancelled = true; };
    }, []);

    // §21.2 balance preview: only meaningful for the
    // `signAction` kind (signMessage / signPsbt / signIn don't move
    // value). Source address: prefer `payload.payload.from.address`
    // when the dApp passes it; otherwise fall back to the wallet's
    // first address on the requested chain. Fetch failures degrade
    // gracefully; the shared warning slot states that the preview is
    // unavailable and the user can still approve.
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
                    error: userFacingMessage(err, 'Could not check your balance.'),
                    sdkShape: null,
                    fromAddress: address,
                });
            }
        }
        loadPreview();
        return () => { cancelled = true; };
    }, [kind, chainId, walletId, payload]);

    // Resolve any `^id` ticker references in a signAction's params back to
    // readable names for display, so the sentence and facts show "JDOG" rather
    // than "^1234" when a dApp built the action with
    // the SDK's ticker compaction. Best-effort: starts from the raw payload and
    // swaps in names as they resolve; unresolvable refs keep their `^id` form,
    // and resolution never blocks the approval.
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

    // G127 replaces the before-and-after balance card with the standard facts
    // card. Keep the safety preview by showing the projected post-action balance
    // for every affected asset, while fees stay in the Total block.
    const projectedBalanceFacts = useMemo(() => {
        if (kind !== 'signAction' || previewBalances.loading
            || previewBalances.error || !previewBalances.sdkShape) return [];
        const result = decoderLib.simulateAction({
            action: resolvedPayload?.action,
            params: resolvedPayload?.payload || {},
            balances: decoderLib.balancesFromSdk(previewBalances.sdkShape),
            feeEstimate: '0',
            chainId,
            chainRegistry,
        });
        return (result?.deltas || [])
            .filter((delta) => !delta.isFee && delta.tick && delta.after !== '')
            .map((delta, index) => ({
                key: `balance-after-${String(delta.tick).toLowerCase()}-${index}`,
                label: `Balance after (${String(delta.tick).toUpperCase()})`,
                value: delta.afterUnknown || delta.beforeUnknown
                    ? 'Unknown'
                    : `${formatWithThousands(String(delta.after))} ${String(delta.tick).toUpperCase()}`,
            }));
    }, [kind, resolvedPayload, previewBalances, chainId]);

    // §21.2 / §48 signPsbt intent cross-check. Decode via the same psbt.parse
    // host route the in-wallet sign form uses. The decomposed outputs support
    // bare-payment presentation and security checks; a carried XChain action
    // is described through the same host decoder used by composed confirms.
    const psbtHexForSign = kind === 'signPsbt' ? payload?.payload?.psbtHex : null;
    const psbtPayloadMissing = kind === 'signPsbt'
        && (typeof psbtHexForSign !== 'string' || psbtHexForSign.trim().length === 0);
    const [psbtIntent, setPsbtIntent] = useState(
        /** @type {{ loading: boolean, error: string | null, decomposed: any | null, ownAddresses: Set<string>, action: any | null, actionDecodeReason: string | null, feeMode: string | null, feeDestination: string | null }} */
        // Starts loading for a PSBT so the first paint says "Decoding", not the
        // undecodable alert the panel shows for a settled null decode.
        ({ loading: kind === 'signPsbt', error: null, decomposed: null, ownAddresses: new Set(), action: null, actionDecodeReason: null, feeMode: null, feeDestination: null }),
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
                feeDestination: null,
            });
            return undefined;
        }
        let cancelled = false;
        setPsbtIntent({
            loading: true, error: null, decomposed: null, ownAddresses: new Set(),
            action: null, actionDecodeReason: null, feeMode: null, feeDestination: null,
        });
        // Decode once, after the wallet list is known, so change filtering and
        // the own-inputs refusal use the same address snapshot as the decode.
        if (!walletsSettled) return undefined;
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
                let feeDestination = null;
                if (res?.action?.actionString) {
                    try {
                        const quote = await requoteNativeFee({
                            chainId,
                            actionString: res.action.actionString,
                            ...(sender ? { source: sender } : {}),
                        });
                        feeMode = nativeFeeModeFromOutputs(res?.decomposed?.outputs, quote);
                        feeDestination = quote?.feeDestination || null;
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
                    feeDestination,
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
                    feeDestination: null,
                });
            }
        }
        loadIntent();
        return () => { cancelled = true; };
    }, [kind, chainId, psbtHexForSign, walletId, walletsSettled]);

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
    // Runs for signAction and for actions decoded from signPsbt or coSign. The
    // PSBT branch uses the parsed bytes returned by psbt.parse, never a dApp's
    // claim about what those bytes contain.
    const coSignDecoded = coSignPreviewDecodedFrom(coSignPreview);
    const describeAction_ = kind === 'signAction'
        ? { action: resolvedPayload?.action, params: resolvedPayload?.payload }
        : kind === 'signPsbt' && psbtIntent.action
            ? {
                action: psbtIntent.action.action,
                version: psbtIntent.action.version,
                params: psbtIntent.action.params,
                ownAddresses: [...psbtIntent.ownAddresses],
            }
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
            ...(Array.isArray(req.ownAddresses) && { ownAddresses: req.ownAddresses }),
        })
            .then((decoded) => { if (!cancelled) setIntent({ loading: false, decoded: decoded || null }); })
            .catch(() => { if (!cancelled) setIntent({ loading: false, decoded: null }); });
        return () => { cancelled = true; };
    }, [chainId, intentKey]);


    const title = kind === 'signIn'
        ? t('extension.sign.loginTitle')
        : KIND_TITLE[kind] ?? 'Approve Request';
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
    const approveLabel = t('extension.connect.approve');

    // §21.3 dApp Source block: Origin + App name (when the dApp
    // attached one). Only renders when an origin is present; in
    // practice every dApp request carries one, but user-initiated
    // sign flows that re-use this screen wouldn't.
    const appName = linkMode
        ? linkAppName(linkRequest) || ''
        : neutralizeControlText(
            payload?.appName || payload?.payload?.appName || '',
            { maxLength: 80 },
        );
    const formattedIntent = intent.decoded ? groupDecodedAmounts(intent.decoded) : null;
    const barePaymentExpected = kind === 'signPsbt'
        && !psbtIntent.loading
        && !!psbtIntent.decomposed
        && !psbtIntent.action
        && !isUnreadableActionReason(psbtIntent.actionDecodeReason);
    const barePayment = useMemo(() => (
        barePaymentExpected
            ? barePsbtSendPresentation({
                decomposed: psbtIntent.decomposed,
                ownAddresses: psbtIntent.ownAddresses,
                chainDescriptor: descriptor,
            })
            : null
    ), [barePaymentExpected, psbtIntent.decomposed, psbtIntent.ownAddresses, descriptor]);
    const psbtFeeSats = kind === 'signPsbt'
        ? exactNetworkFeeSats(psbtIntent.decomposed)
        : null;
    const psbtFeeAmount = psbtFeeSats === null || !descriptor
        ? null
        : formatNativeBaseUnits(psbtFeeSats, descriptor);
    const psbtFeeText = psbtFeeSats === null
        ? null
        : amountLabel(psbtFeeSats, descriptor);
    const psbtDescriptionFailed = kind === 'signPsbt'
        && !!psbtIntent.action
        && !intent.loading
        && !formattedIntent;
    const psbtSigningPaths = Array.isArray(resolvedPayload?.payload?.signingPaths)
        ? resolvedPayload.payload.signingPaths
        : [];
    const psbtSighashFailure = kind === 'signPsbt' && psbtIntent.decomposed
        ? psbtSigningPaths.map((path) => {
            const input = psbtIntent.decomposed.inputs?.[path?.inputIndex];
            if (!input) return `Signing input ${Number(path?.inputIndex) + 1} is not in this transaction.`;
            const requested = path?.sighashType;
            const carried = input.sighashType;
            if (requested !== undefined && carried !== undefined && carried !== null
                && Number(requested) !== Number(carried)) {
                return `Input ${Number(path.inputIndex) + 1} asks for conflicting signature flags.`;
            }
            const type = requested ?? carried;
            if (type === undefined || type === null) return null;
            const allowed = input.scriptType === 'p2tr' ? 0 : 1;
            return Number(type) === allowed ? null
                : `Input ${Number(path.inputIndex) + 1} asks for a signature that leaves part of the transaction open to change after you sign.`;
        }).find(Boolean) || null
        : null;
    const explainedOutputAddresses = new Set((formattedIntent?.details || []).flatMap((detail) => {
        const value = String(detail?.value || '');
        return (psbtIntent.decomposed?.outputs || [])
            .map((output) => output?.address)
            .filter((address) => address && value.includes(address));
    }));
    const unexplainedOutput = kind === 'signPsbt' && psbtIntent.action && formattedIntent
        ? (psbtIntent.decomposed?.outputs || []).find((output) => (
            output?.address
            && !psbtIntent.ownAddresses.has(output.address)
            && output.address !== psbtIntent.feeDestination
            && !explainedOutputAddresses.has(output.address)
            && output.scriptType !== 'p2sh'
            && output.scriptType !== 'p2wsh'
        )) || null
        : null;
    const psbtPresentationFailed = kind === 'signPsbt'
        && !psbtIntent.loading
        && (
            isUnreadableActionReason(psbtIntent.actionDecodeReason)
            || psbtDescriptionFailed
            || (barePaymentExpected && !barePayment)
            || (!!psbtIntent.decomposed && psbtFeeSats === null)
            || !!psbtSighashFailure
            || !!unexplainedOutput
        );
    const unreadableWhy = describeUnreadableReason(psbtIntent.actionDecodeReason);
    const psbtFailureText = psbtPayloadMissing
        ? t('extension.sign.psbtMissing')
        : psbtIntent.error
            ? userFacingMessage(psbtIntent.error, 'This transaction could not be read.')
            : isUnreadableActionReason(psbtIntent.actionDecodeReason)
                ? `The XChain action inside this transaction could not be read${unreadableWhy ? ` because ${unreadableWhy}` : ''}.`
                : psbtDescriptionFailed
                    ? 'The action inside this transaction could not be explained safely.'
                    : barePaymentExpected && !barePayment
                        ? 'This coin payment contains an output the wallet cannot explain safely.'
                        : kind === 'signPsbt' && psbtIntent.decomposed && psbtFeeSats === null
                            ? 'The wallet could not verify this transaction\'s network fee.'
                            : psbtSighashFailure
                                || (unexplainedOutput
                                    ? 'This transaction pays an address the decoded action does not explain.'
                                    : null);

    // For a PSBT sign, block approval when the request has no usable payload
    // or whenever the independent decode failed (or produced nothing). The
    // summary already warns visually, but that is presentational only: without
    // this gate the user can still approve a transaction whose effects could
    // not be verified. Mirrors PsbtSignForm, which already refuses to sign on
    // `!decomposed`.
    const psbtDecodeFailed =
        psbtPayloadMissing ||
        (kind === 'signPsbt' &&
            !!psbtHexForSign &&
            !psbtIntent.loading &&
            (psbtIntent.error !== null || psbtIntent.decomposed === null)) ||
        psbtPresentationFailed;

    // Also hold approval while the independent decode is still in flight:
    // the intent summary (destinations / amounts / fee) has not rendered
    // yet, so approving now would be approving effects the user could not
    // see. Once decode settles this drops to false and either the summary
    // or `psbtDecodeFailed` governs.
    const psbtDecodePending =
        kind === 'signPsbt' && !!psbtHexForSign && psbtIntent.loading;

    const psbtApprovalBlocked = psbtDecodeFailed || psbtDecodePending
        || (kind === 'signPsbt' && intent.loading);

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

    // §5.5 refusal, layered on top of the presentation gates: a PSBT that
    // spends our inputs but carries action bytes the decoder cannot explain
    // must not become an ordinary payment merely because decomposition worked.
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
        ? 'Another phone signs for this wallet, so it never signs or asks for a password. Reject this request and take its unsigned transaction to the phone that signs.'
        : 'Another phone signs for this wallet, so it never signs or asks for a password. Reject this request, or use a wallet that signs on this device.';
    // A freeze the user armed is stated first and the window asks for no
    // password, since the worker refuses the signature whatever is typed. A
    // duress-armed freeze leaves the window looking as it always does
    // (panicNotice.js): the worker still refuses, and an observer sees no cue.
    const panicFrozen = Boolean(panicNotice?.disclose);
    const signingUnavailable = watcherMode || watchOnlyBlocked || panicFrozen;
    const modeApprovalBlocked = walletMode === null || signingUnavailable;

    // Why Approve cannot go ahead yet, or null. Approve never looks disabled
    // (G130): the tap says why at the top of the window (G129) and sends
    // nothing; a missing password also marks the password field.
    function approveBlockReason() {
        if (linkMode && !answerOrigin) return { key: 'linkTargets', text: t('extension.approval.invalidLinkTargets') };
        if (psbtRefusal) return { key: 'refusal', text: String(psbtRefusal) };
        if (psbtFailureText) return { key: 'refusal', text: psbtFailureText };
        if (preflightBlocked) {
            if (preflightState.actionString !== preflightActionString || preflightState.loading) return { key: 'checking', text: t('confirmStandard.blocked.checking') };
            const errors = (preflightState.report?.findings || []).filter((f) => f?.severity === 'error');
            return confirmationStatus?.overrides?.length > 0 && confirmationStatus.overrides.length === errors.length ? { key: 'signAnyway', text: t('confirmStandard.blocked.signAnyway') } : { key: 'fails', text: t('confirmStandard.blocked.fails') };
        }
        if (psbtApprovalBlocked || coSignApprovalBlocked) {
            return (psbtDecodePending || coSignPreview.loading)
                ? { key: 'checking', text: t('confirmStandard.blocked.checking') }
                : { key: 'refusal', text: t('confirmStandard.blocked.fails') };
        }
        if (signInBlocked) return { key: 'signIn', text: t('confirmStandard.blocked.signInAddress') };
        if (!walletId) return { key: 'wallet', text: t('confirmStandard.blocked.wallet') };
        if (password.length === 0) return { key: 'credentials', text: t('confirmStandard.blocked.password') };
        return null;
    }

    async function handleApprove() {
        if (expired) return;
        if (busy) return;
        // A wallet whose mode is still loading answers nothing yet; a mode
        // that cannot sign shows Reject alone.
        if (modeApprovalBlocked) return;
        const blocked = approveBlockReason();
        if (blocked) {
            setBlockedTap(blocked.key);
            if (blocked.key === 'credentials') {
                setError(t('confirmStandard.blocked.passwordField'));
                inputRef.current?.focus?.({ preventScroll: true });
            }
            const scroller = document.querySelector('main');
            if (scroller) scroller.scrollTop = 0;
            return;
        }
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
            if (err?.name === 'ApprovalInterruptedError') {
                setExpired(true);
                setWalletId(null);
                setPassword('');
                setError(err.message);
            } else {
                setError(
                    err?.name === 'InvalidPasswordError'
                        ? 'Incorrect password.'
                        : userFacingMessage(err, 'Approval failed.'),
                );
            }
            setBusy(false);
            if (err?.name !== 'ApprovalInterruptedError') {
                inputRef.current?.focus();
                inputRef.current?.select();
            }
        }
    }

    const confirmationDecoded = kind === 'signPsbt'
        ? (formattedIntent || barePayment?.decoded || null)
        : formattedIntent;
    const confirmationSummary = kind === 'signPsbt' ? barePayment?.summary || null : null;
    const confirmationVariant = kind === 'signMessage'
        ? 'message'
        : kind === 'signPsbt' && !confirmationDecoded ? 'psbt' : 'action';
    const confirmationAction = kind === 'coSign'
        ? coSignPreview.preview?.action
        : kind === 'signPsbt'
            ? psbtIntent.action?.action || barePayment?.actionName || ''
            : resolvedPayload?.action;
    const confirmationSource = kind === 'signMessage'
        ? resolvedPayload?.payload?.address || null
        : kind === 'signIn'
            ? signInPick?.address || null
            : kind === 'coSign'
                ? coSignPreview.preview?.account?.aggregateAddress || null
                : preflightSourceAddress;
    const baseHead = kind === 'signIn'
        ? { icon: 'sign', sentence: t('extension.sign.signInTo'), address: confirmationSource }
        : confirmHeadline({
            variant: confirmationVariant,
            actionName: confirmationAction,
            decoded: confirmationDecoded,
            summary: confirmationSummary,
            sourceAddress: confirmationSource,
            chainName: descriptor?.displayName || '',
        });
    const requestingSite = siteNameFromOrigin(origin);
    let confirmationHead = {
        ...baseHead,
        sentence: kind === 'signPsbt'
            ? baseHead.sentence
            : sentenceForSite(baseHead.sentence, requestingSite),
    };
    if (kind === 'signIn' && requestingSite) {
        confirmationHead = {
            ...confirmationHead,
            sentence: `${t('extension.sign.signInTo')} ${requestingSite}`,
        };
    }
    // The network fee the site asks for, as its own row in the facts card
    // (no Total block, G127 revised 2026-11-16): the amount and its fiat value,
    // or the site's rate when the amount is not known.
    const psbtFeeFiat = psbtFeeAmount === null ? ''
        : String(formatNativeFee(psbtFeeAmount) || '').replace(/^~/, '');
    const exactPsbtFeeText = psbtFeeText
        ? `${psbtFeeText}${psbtFeeFiat ? ` (${psbtFeeFiat})` : ''}`
        : null;
    const shownFeeText = kind === 'signPsbt' ? exactPsbtFeeText : approvalFeeText;
    const feeFactRows = shownFeeText ? [{
        key: 'fee-network',
        label: t('send.networkFee'),
        value: shownFeeText,
        testId: 'confirm-fee-network',
    }] : [];
    const signedText = kind === 'signMessage'
        ? String(resolvedPayload?.payload?.message ?? '')
        : '';
    const displayedSignedText = revealHiddenText(signedText, { keepLayout: true });
    const signInAppId = kind === 'signIn'
        ? String(resolvedPayload?.payload?.appId || resolvedPayload?.origin || '')
        : '';
    const displayedSignInAppId = neutralizeControlText(signInAppId);
    const signInNonce = kind === 'signIn' ? String(resolvedPayload?.payload?.nonce ?? '') : '';
    const displayedSignInNonce = neutralizeControlText(signInNonce);
    const decodedConfirmationFacts = confirmationDecoded
        ? decodedFacts({
            decoded: confirmationDecoded,
            sentence: confirmationHead.sentence,
            name: confirmationHead.name,
            address: confirmationHead.address,
            kind: confirmationHead.kind,
            summary: confirmationSummary,
        })
        : [];
    // Message signing has one fixed information box: who signs, its network,
    // then the full address. Structured sign-in fields stay inside the signed
    // message itself rather than becoming a second parsed summary.
    const messageSigningFacts = kind === 'signMessage' ? [
        ...(signingWith ? [{
            key: 'signing-with',
            label: t('components.confirmActionModal.signingWith'),
            value: signingWith,
            testId: 'confirm-signing-wallet',
        }] : []),
        ...(descriptor?.displayName ? [{
            key: 'network',
            label: 'Network',
            value: descriptor.displayName,
            testId: 'confirm-network',
        }] : []),
        ...(confirmationSource ? [{
            key: 'address',
            label: 'Address',
            value: confirmationSource,
            address: true,
            testId: 'confirm-address',
        }] : []),
    ] : null;
    // For other kinds ConfirmStandard adds the Network row from the chain name,
    // after these rows and before the fee row.
    const generalConfirmationFacts = [
        ...decodedConfirmationFacts,
        ...projectedBalanceFacts,
        ...(signingWith ? [{
            key: 'signing-with',
            label: t('components.confirmActionModal.signingWith'),
            value: signingWith,
            testId: 'confirm-signing-wallet',
        }] : []),
        ...(appName && !linkMode ? [{
            key: 'app-name',
            label: t('extension.sign.declaredName', { name: '' }).replace(/[:\s]+$/, '') || 'App',
            value: appName,
        }] : []),
        ...(kind === 'signPsbt' && Array.isArray(resolvedPayload?.payload?.signingPaths)
            && resolvedPayload.payload.signingPaths.length > 0 ? [{
                key: 'signing-paths',
                label: t('extension.sign.signingPaths'),
                value: signingPathLines(resolvedPayload.payload.signingPaths).join(', '),
            }] : []),
        ...(kind === 'signIn' && resolvedPayload?.payload?.nonce ? [{
            key: 'nonce',
            label: t('extension.sign.oneTimeCode'),
            value: neutralizeControlText(resolvedPayload.payload.nonce),
        }] : []),
        ...(kind === 'signIn' && displayedSignInAppId ? [{
            key: 'app-id',
            label: t('extension.sign.signInTo'),
            value: displayedSignInAppId,
        }] : []),
        ...(kind === 'coSign' && coSignPreview.preview?.account ? [{
            key: 'agent-account',
            label: t('extension.sign.agentAccount'),
            value: coSignPreview.preview.account.name || t('extension.sign.coSignerAccount'),
        }] : []),
        ...(kind === 'coSign' && coSignPreview.preview?.needsConfirmation ? [{
            key: 'confirmation-threshold',
            label: 'Confirmation',
            value: t('extension.sign.confirmThreshold'),
        }] : []),
        ...feeFactRows,
    ];
    const confirmationFacts = messageSigningFacts || generalConfirmationFacts;
    const extraWarnings = [
        ...(signedText && displayedSignedText !== signedText
            ? [t('extension.sign.controlCharacters', { noun: t('extension.sign.warningNoun.message') })]
            : []),
        ...(kind === 'signIn' && (displayedSignInAppId !== signInAppId || displayedSignInNonce !== signInNonce)
            ? [t('extension.sign.controlCharacters', { noun: t('extension.sign.warningNoun.signIn') })]
            : []),
        ...(psbtRefusal ? [psbtRefusal] : []),
        ...(kind === 'coSign' ? coSignWarningLines(coSignPreview) : []),
        ...(watchOnlyBlocked ? [WATCH_ONLY_SIGNING_MESSAGE] : []),
        ...(watcherMode ? [watcherCopy] : []),
        ...(kind === 'signAction' && previewBalances.error
            ? ['Balance preview unavailable.'] : []),
    ];
    const preflightChecking = Boolean(preflightActionString)
        && (preflightState.loading || preflightState.actionString !== preflightActionString);
    const confirmationChecking = preflightChecking || intent.loading || coSignPreview.loading;
    // The status notice, first in the window: the network check's verdict on
    // a request that has one to check, the checking line while it runs.
    const confirmationStatus = psbtFailureText && !psbtIntent.loading ? {
        tone: 'danger',
        title: 'Not checked',
        points: [{ key: 'psbt-refusal', text: psbtFailureText }],
        overrides: [],
        role: 'alert',
        state: 'fail',
    } : confirmStatus({
            report: preflightState.report,
            applies: Boolean(preflightActionString) || confirmationChecking,
            loading: confirmationChecking,
            acknowledged,
            approveGated: true,
        });
    // The short warning after the details.
    const psbtWarningIds = kind === 'signPsbt' && psbtIntent.action
        ? actionWarningIds(psbtIntent.action)
        : null;
    const confirmationWarning = confirmWarning({
        actionWarningIds: psbtWarningIds,
        decodedWarnings: psbtWarningIds
            ? withoutCoveredWarnings(confirmationDecoded?.warnings, psbtWarningIds)
            : Array.isArray(confirmationDecoded?.warnings) ? confirmationDecoded.warnings : [],
        extraWarnings,
    });
    const currentBlock = blockedTap ? approveBlockReason() : null;
    const anotherDeviceLogin = linkMode && Boolean(origin) && isAnotherDeviceLogin(linkRequest);
    const shownApprovalBlock = currentBlock && currentBlock.key === blockedTap ? currentBlock : null;
    const shownBlock = shownApprovalBlock || anotherDeviceLogin;
    const signInAsLabel = linkMode
        ? t('extension.sign.signInAs')
        : t('extension.sign.providerSignInAs');
    const noSignInAddress = linkMode
        ? t('extension.sign.noSignInAddress')
        : t('extension.sign.providerNoSignInAddress');
    const passwordBlock = !signingUnavailable && walletMode !== null ? (
        <form
            id="sign-approval-form"
            className={styles.credentials}
            aria-label={title}
            onSubmit={(event) => event.preventDefault()}
        >
            <Input
                ref={inputRef}
                type="password"
                label={t('common.password')}
                help={t('extension.sign.passwordHint')}
                value={password}
                onChange={(event) => {
                    setPassword(event.target.value);
                    if (error) setError(null);
                }}
                autoComplete="current-password"
                disabled={busy}
                error={error || undefined}
            />
            {showSavePermanent ? (
                <ChoiceControl
                    className={`${shared.toggleRow} ${styles.permission}`}
                    checked={savePermanent}
                    onChange={(event) => setSavePermanent(event.target.checked)}
                    disabled={busy}
                >
                    <span>{t('extension.sign.alwaysAllow')}</span>
                </ChoiceControl>
            ) : null}
        </form>
    ) : null;

    return (
        <Screen
            variant="small"
            header={<ApprovalHeader title={title} />}
            footer={
                <div className={`${styles.footer} ${shared.formFooter}`}>
                    {passwordBlock}
                    {signingUnavailable ? (
                        <Button
                            variant="danger"
                            block
                            icon={<Icon.ThumbsDownIcon />}
                            onClick={onReject}
                            disabled={busy}
                        >
                            {t('extension.approval.reject')}
                        </Button>
                    ) : (
                        <ConfirmButtons
                            onReject={onReject}
                            onApprove={handleApprove}
                            rejectDisabled={busy}
                            approveLoading={busy}
                            approveLabel={approveLabel}
                        />
                    )}
                </div>
            }
        >
            <FormPage as="div" label={title}>
                {linkMode && origin ? (
                    <OriginIdentity
                        origin={origin}
                        label={t('extension.approval.linkAnswer', { origin })}
                        testId="link-answer-origin"
                    >
                        {appName ? <p>{t('extension.sign.declaredName', { name: appName })}</p> : null}
                    </OriginIdentity>
                ) : kind === 'signPsbt' ? (
                    <OriginIdentity
                        origin={origin}
                        label={t('extension.approval.requestingSite')}
                        testId="confirm-request-origin"
                    />
                ) : null}
                <ConfirmStandard
                    label={title}
                    facts={confirmationFacts}
                    top={panicFrozen || shownBlock ? (
                        <>
                            {panicFrozen ? (
                                <PanicSignStatus notice={panicNotice} testId="approval-panic-freeze" role="alert" />
                            ) : null}
                            {anotherDeviceLogin ? (
                                <Notice tone="warning" role="note" testId="another-device-login" flush>
                                    {t('extension.sign.anotherDevice', { origin })}
                                </Notice>
                            ) : null}
                            {shownApprovalBlock ? (
                                <Notice tone="danger" role="alert" testId="confirm-blocked" data-reason={shownApprovalBlock.key} flush>
                                    {shownApprovalBlock.text}
                                </Notice>
                            ) : null}
                        </>
                    ) : null}
                    status={confirmationStatus}
                    warning={confirmationWarning}
                    acknowledged={acknowledged}
                    onAcknowledge={acknowledge}
                    mark={(kind === 'signAction' || kind === 'signPsbt') && baseHead.heroTick && descriptor ? (
                        <TickerIcon chainId={descriptor.id} tick={baseHead.heroTick} context="hero" />
                    ) : null}
                    icon={confirmationHead.icon}
                    name={confirmationHead.name}
                    actionCode={confirmationHead.actionCode}
                    sentence={confirmationHead.sentence}
                    address={kind === 'signMessage' ? null : confirmationHead.address}
                    addressIsSource={Boolean(confirmationSource)
                        && confirmationHead.address === confirmationSource}
                    addressLabel={confirmationHead.address === confirmationSource
                        ? (kind === 'signMessage' ? t('signerSelect.title') : t('send.fields.from'))
                        : ''}
                    chainName={kind === 'signMessage' ? '' : descriptor?.displayName || ''}
                    afterAddress={kind === 'signMessage' && !linkMode ? (
                        <OriginIdentity
                            origin={origin}
                            label={t('extension.approval.requestingSite')}
                            testId="confirm-request-origin"
                        />
                    ) : null}
                    preserveFactOrder={kind === 'signMessage'}
                    messageText={kind === 'signMessage' ? displayedSignedText : undefined}
                >
                    {kind === 'signIn' ? (
                        <div className={styles.signInChoice}>
                        {signInAddresses.length === 0 ? (
                            <>
                                <p className={shared.error} role="alert">
                                    {noSignInAddress}
                                </p>
                            </>
                        ) : (
                            // The themed dropdown with an icon per option, never
                            // radios (G119): the chain badge is the icon, the
                            // address the label (kept left to right in an RTL
                            // layout; `text` names it) and the chain name its
                            // second line. Values are the list index as text.
                            <IconSelect
                                label={signInAsLabel}
                                help={t('extension.sign.signInAsHint')}
                                value={String(signInChoice)}
                                onChange={(next) => setSignInChoice(Number(next))}
                                disabled={busy}
                                options={signInAddresses.map((c, i) => {
                                    const d = chainRegistry.get(c.chainId);
                                    const address = neutralizeControlText(c.address, { maxLength: 120 });
                                    return {
                                        value: String(i),
                                        label: <span dir="ltr">{address}</span>,
                                        text: address,
                                        sub: d ? d.displayName : undefined,
                                        icon: d ? <ChainBadge descriptor={d} size="sm" /> : <Icon.WalletIcon />,
                                    };
                                })}
                            />
                        )}
                        </div>
                    ) : null}
                </ConfirmStandard>
            </FormPage>
        </Screen>
    );
}

function siteNameFromOrigin(origin) {
    const value = String(origin || '').trim();
    if (!value) return '';
    try {
        return neutralizeControlText(new URL(value).host, { maxLength: 120 });
    } catch {
        return neutralizeControlText(value, { maxLength: 120 });
    }
}

function sentenceForSite(sentence, site) {
    const sentenceText = String(sentence || '').trim();
    if (!site) return sentenceText;
    const base = sentenceText.replace(/[.]+$/, '');
    if (/\bto$/i.test(base)) return `${base} the address below for ${site}`;
    return `${base} for ${site}`;
}

function coSignWarningLines(coSignPreview) {
    if (coSignPreview.loading) return [];
    if (coSignPreview.error || !coSignPreview.preview) {
        return [`${coSignErrorSentence(coSignPreview.error)} ${t('extension.sign.trustSource')}`];
    }
    const preview = coSignPreview.preview;
    // A spending-window clock anomaly makes the policy's window counts suspect.
    const clock = Array.isArray(preview.clockWarnings) && preview.clockWarnings.length > 0
        ? [t('extension.sign.clockWarning')]
        : [];
    if (!preview.decodeOk) return [coSignUndecodedSentence(preview.decodeReason), ...clock];
    if (!preview.policyOk) {
        return [`${coSignPolicySentence(preview.policyReason)} ${t('extension.sign.policyRefusal')}`, ...clock];
    }
    return clock;
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

function firstApprovalField(payload, names) {
    const inner = payload?.payload;
    const sources = [inner, inner?.requested, payload];
    for (const source of sources) {
        if (!source || typeof source !== 'object') continue;
        for (const name of names) {
            if (Object.hasOwn(source, name)
                && source[name] !== null
                && source[name] !== '') {
                return { name, value: source[name] };
            }
        }
    }
    return null;
}

function approvalFeeRequest(payload, descriptor) {
    const fee = firstApprovalField(payload, ['fee', 'networkFeeSats']);
    const rate = firstApprovalField(payload, ['feeRate', 'feePerKb']);
    const actionNeedsFeeSummary = ['SEND', 'SWEEP'].includes(
        String(payload?.action || '').toUpperCase(),
    );
    if (!fee && !rate && !actionNeedsFeeSummary) return null;

    const coinAmount = fee ? formatNativeBaseUnits(fee.value, descriptor) : null;
    let rateText = null;
    if (rate && (typeof rate.value === 'number' || typeof rate.value === 'string')) {
        const unit = resolveFeeUnit(descriptor);
        const raw = String(rate.value).trim();
        if (rate.name === 'feePerKb') {
            const feePerKb = Number(raw);
            if (Number.isFinite(feePerKb) && feePerKb >= 0) {
                rateText = `${settingsCustomToDisplayRate(unit, feePerKb)} ${unit}`;
            }
        } else if (/^[+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) {
            rateText = `${raw} ${unit}`;
        } else if (raw) {
            rateText = neutralizeControlText(raw, { maxLength: 80 });
        }
    }

    return { coinAmount, rateText };
}

function formatApprovalFee(requestedFee, nativeTicker, formatNativeFee) {
    if (requestedFee.coinAmount !== null && nativeTicker) {
        // The fee row reads like the in-wallet confirm's: "0.000015 BTC ($1.50)".
        const fiat = String(formatNativeFee(requestedFee.coinAmount) || '').replace(/^~/, '');
        return `${formatWithThousands(requestedFee.coinAmount) || requestedFee.coinAmount} ${nativeTicker}${fiat ? ` (${fiat})` : ''}`;
    }
    return t('extension.sign.feeSetBySite', {
        rate: requestedFee.rateText ? ` (${requestedFee.rateText})` : '',
    });
}

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
