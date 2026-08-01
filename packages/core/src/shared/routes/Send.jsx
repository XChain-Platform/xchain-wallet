// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    Input,
    AddressCombobox,
    AddressField,
    ChainBadge,
    AddressText,
    FeeSelector,
 ChainPicker,  Icon, InfoTip, StatusMessage,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
    uri as uriLib,
} from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { explorerCoinCode } from '../../registry/coinTicker.js';
import { tickerColor } from '../components/BalanceList.jsx';
import { ContactsPickerScreen } from '../components/ContactsPickerScreen.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { buildRecentDestinations } from '../../flows/recentDestinations.js';
import { detectAddressCoin, isValidAddressForChain } from '../utils/addressValidation.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { findLookalike } from '../utils/lookalike.js';
import { checkPasteIntegrity } from '../utils/pasteIntegrity.js';
import { humanizeError } from '../utils/humanizeError.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useDeveloperMode } from '../hooks/useDeveloperMode.js';
import { useSettings } from '../hooks/useSettings.js';
import { useConfirmAction } from '../hooks/useConfirmAction.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { PanicFreezeNotice, SigningReadyNote } from '../safety/PanicFreezeNotice.jsx';
import {
    resolvePreflightPrivacy,
} from '../../schemas/settings.js';
import { checkRecipientNovelty } from '../../flows/recipientNovelty.js';
import { classifySignRisk } from '../../flows/signRiskClassifier.js';
import { MAX_SEND_LEGS, summarizeSendLegs, totalsByTick } from '../../flows/sendLegs.js';

// Exact decimal-string -> satoshi conversion for the send-risk gates (#2249).
// The old Math.floor(parseFloat(x) * 1e8) accumulated IEEE-754 rounding error
// and biased downward, so an amount right at testSendThresholdSats (or a
// classifySignRisk band edge) could gate one satoshi off. String/BigInt math
// is exact; the submitted transaction already uses the exact decimal string,
// so this only aligns the gates with what actually gets sent. Returns a
// non-negative Number of sats, or null when the input is not a plain decimal.
export function exactSatsFromDecimalString(raw) {
    const s = String(raw).trim();
    const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) return null;
    const frac = (m[2] || '').slice(0, 8).padEnd(8, '0');
    const sats = BigInt(m[1]) * 100000000n + BigInt(frac);
    // Gate thresholds live far below 2^53; clamp instead of silently losing
    // precision if someone types an absurd amount.
    return sats > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(sats);
}

// BigInt sibling of exactSatsFromDecimalString for amount *arithmetic*
// (Max sweep, small-test reduction), where the result feeds back into the
// amount field and eventually gets signed, so no clamp and no Number
// round-trip is acceptable. Also accepts a bare leading dot ('.5') the way
// parseFloat did, since this parses user-typed field values. Returns a
// non-negative BigInt of sats, or null when the input is not a plain decimal.
export function exactSatsBigIntFromDecimalString(raw) {
    const s = String(raw).trim();
    const m = /^(\d*)(?:\.(\d+))?$/.exec(s);
    if (!m || (!m[1] && !m[2])) return null;
    const frac = (m[2] || '').slice(0, 8).padEnd(8, '0');
    return BigInt(m[1] || '0') * 100000000n + BigInt(frac);
}

// Exact sats -> plain decimal string, never scientific notation. The old
// Number(x.toFixed(8)).toString() path rendered 1 sat as '1e-8', which the
// encoder treats as a malformed AMOUNT. Trailing zeros are stripped for a
// tidy display; negative inputs clamp to '0'.
export function decimalStringFromSats(sats) {
    const clamped = sats < 0n ? 0n : sats;
    const whole = (clamped / 100000000n).toString();
    const frac = (clamped % 100000000n).toString().padStart(8, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
}
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    fetchNativeSendFeeTiers,
    customFeeEstimate,
    settingsCustomToDisplayRate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { coinToFiat, fiatToCoin } from '../../flows/priceLookup.js';
import { useFiatRate, fiatRateForTick } from '../hooks/useFiatRate.js';
import { HwSignBlock } from '../components/HwSignBlock.jsx';
import { BalanceChanges } from '../components/BalanceChanges.jsx';
import { RawPsbtViewer } from '../components/RawPsbtViewer.jsx';
import { useToast } from '../components/ToastHost.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { useHaptic } from '../hooks/useHaptic.js';
import { useFormDraft } from '../hooks/useFormDraft.js';
import { useScreenShortcuts } from '../keyboard/useScreenShortcuts.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import {
    formatWithThousands,
    countNonCommaBefore,
    indexAfterNonCommaCount,
} from '../utils/amountFormat.js';
import { dustThresholdForCoin } from '../../sdk/nativeFeePreflight.js';
import styles from './Send.module.css';
import { externalIndexOf } from '../addressSelection.js';

// §30.5 user-initiated cancel detection. HW-device libraries surface a
// rejection as an Error whose message contains words like "cancelled",
// "rejected", or "denied" (Trezor: "Action cancelled by user"; Ledger:
// "Transaction was rejected"). Treat any of those as a deliberate user
// cancel rather than a Send failure so the UI returns to the composing
// form with a calm "Transaction cancelled." toast instead of a red error.
const USER_CANCEL_RE = /cancel|reject|denied/i;

const chainRegistry = registryLib.defaultRegistry();

// Descriptor.coin is the long-form coin name ('bitcoin' / 'litecoin' /
// 'dogecoin'); the user-facing native ticker is the short symbol the SDK
// emits as `b.native.tick` (BTC / LTC / DOGE). Uppercasing descriptor.coin
// directly compares against the wrong string ('BITCOIN' !== 'BTC') and
// breaks every "is this the native asset?" check downstream (most
// visibly the SelectedTokenHero, which falls through to the letter-badge
// + chain-overlay branch meant for tokens.
const NATIVE_TICKER_BY_COIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
function nativeTickerFor(descriptor) {
    if (!descriptor?.coin) return null;
    return NATIVE_TICKER_BY_COIN[descriptor.coin] || descriptor.coin.toUpperCase();
}

const COIN_DISPLAY = { bitcoin: 'Bitcoin', litecoin: 'Litecoin', dogecoin: 'Dogecoin' };

// Validate the destination against the chain the SEND will be broadcast on.
// A SEND pays an on-chain output on that chain, so an address for another coin,
// for the right coin on the wrong network, or simply mistyped, is unspendable:
// the tokens are gone. `isValidAddressForChain` decodes the base58check checksum
// (or bech32) against that coin+network's parameters, so it catches all three -
// unlike a leading-character guess, which passes any typo that preserves the
// first letter and cannot tell mainnet from testnet on the shared 'm'/'n'/'2'
// leaders. Returns an error string, or null when the address is good (or when
// there is not yet a chain to validate against).
function destinationAddressError(address, descriptor) {
    const a = (address || '').trim();
    if (!a || !descriptor?.coin || !descriptor?.networkKind) return null;
    if (isValidAddressForChain(a, descriptor.coin, descriptor.networkKind)) return null;

    const chainName = COIN_DISPLAY[descriptor.coin] || descriptor.coin;
    // Name the coin it *does* look like when that's unambiguous: a much more
    // useful error than "invalid" when someone pastes the wrong address.
    const detected = detectAddressCoin(a);
    if (detected && detected !== descriptor.coin) {
        return `This looks like a ${COIN_DISPLAY[detected] || detected} address, not a ${chainName} address.`;
    }
    const where = descriptor.networkKind === 'mainnet'
        ? chainName
        : `${chainName} ${descriptor.networkKind}`;
    return `This is not a valid ${where} address. Check it for typos.`;
}

/**
 * Send view (§29): authoring surface for the SEND action.
 *
 * Flow:
 *   form      -> review    -> submitting -> done | error
 *                 (back from review re-edits; error state re-opens form
 *                  pre-filled so the user doesn't retype everything)
 *
 * Review stage runs the user's draft through `decoder.decodeAction` so
 * the plain-English summary + warnings match SignApproval's sign-screen
 * (§21.1 / §30). A memo with `|` or `;` surfaces the same protocol-
 * reject warning there and here.
 *
 * The dev-SDK stub cannot encode / sign / broadcast; Send will surface
 * that error when the user hits Submit. Form + review paths still
 * exercise cleanly; good for UX review before real SDK lands.
 */

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {{ address?: string, amount?: string, tick?: string, chainId?: string, memo?: string, feePriority?: 'low' | 'normal' | 'fast' }} [props.prefill]
 *        §47 Cluster L FOLLOWUP 1: initial form values from a deep-link
 *        intent (parseXchainUri). Each field is applied once on mount;
 *        the user can override before submitting. Address comes from
 *        the URI path / `to=` param; chainId from the URI path or the
 *        BIP21 `chain=` param; tick from the URI path or `tick=`.
 * @param {(carry: { address: string, amount: string }) => void} [props.onChangeAsset]
 *        tapped from the asset hero; should navigate to the SendPicker.
 *        Receives the currently-entered To address and amount so the caller can
 *        carry them back into the prefill (changing the asset must not wipe the
 *        destination or amount). Omit to leave the hero non-interactive.
 */
export function Send({ walletId, onBack, prefill = null, onChangeAsset }) {
    const { messaging, shell } = useMessaging();
    // Unlocked software session signs without a password.
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const { developerMode } = useDeveloperMode();
    const { settings } = useSettings();
    const { showToast } = useToast();
    const haptic = useHaptic();

    //  §5.6 slice 1: the single-encode confirm modal. Flag-gated
    // (read with code defaults, never vault-stamped).  brought
    // hardware onto it; watcher sends stay on the legacy review->submit
    // stage machine below (they encode, they never sign).
    const confirmAction = useConfirmAction();

    // §34.2: Cmd/Ctrl+Enter submits the visible stage's form (compose ->
    // review, review -> sign). requestSubmit (not submit()) so the form's
    // onSubmit validation path runs exactly as if the button was clicked.
    useScreenShortcuts({
        keys: {
            'mod+enter': () => {
                const form = document.getElementById('send-form')
                    || document.getElementById('send-review-form');
                if (!form) return false;
                form.requestSubmit();
                return true;
            },
        },
    });

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (
        prefill?.chainId || null
    ));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );
    // Active (operating) address per chain; Send DEFAULTS its from-address to
    // this so a send spends from the chain's active address unless the user
    // says otherwise.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, { id: string, address: string }>} */ ({}),
    );
    //  source picker, matching the From field every other action form
    // carries. `pickedSourceChain` records the chain a manual pick was made on,
    // so the defaulting effect below re-defaults on a chain switch (where the
    // picked address does not exist) but never overwrites a deliberate choice.
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [pickedSourceChain, setPickedSourceChain] = useState(
        /** @type {string | null} */ (null),
    );
    const [toAddress, setToAddress] = useState(prefill?.address || '');
    const [tick, setTick] = useState(prefill?.tick || '');
    const [amount, setAmount] = useState(prefill?.amount || '');
    const [memo, setMemo] = useState(prefill?.memo || '');
    const [amountInputMode, setAmountInputMode] = useState(
        /** @type {'coin' | 'fiat'} */ ('coin'),
    );
    // PC-52: additional recipients. The fields above stay the FIRST recipient
    // (so every single-send affordance - contacts, paste checks, fiat entry,
    // Max, the gated-content rails - keeps working untouched), and these rows
    // are the extra legs of a SEND v1/v2. `perRecipientToken` reveals a tick
    // field per row, which is what moves the action from v1 to v2; without it
    // every leg carries the token chosen above.
    const [extraLegs, setExtraLegs] = useState(
        /** @type {Array<{ id: string, to: string, amount: string, tick: string }>} */ ([]),
    );
    const [perRecipientToken, setPerRecipientToken] = useState(false);
    const [fiatAmount, setFiatAmount] = useState('');
    const [password, setPassword] = useState('');
    // Live mirror of `password` so the confirm-modal's onApprove closure
    // (captured when the modal opened) reads what the user typed INTO the
    // modal afterward, not the value at open time.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    // Inline error on the To field, e.g. a wrong-chain destination address.
    const [toError, setToError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    // Raw backend/SDK/RPC error string kept for a collapsible "technical
    // details" disclosure so debuggability is preserved without leading
    // the review dialog with jargon ().
    const [submitErrorDetail, setSubmitErrorDetail] = useState(/** @type {string | null} */ (null));
    // Recognized cause from humanizeError; recovery affordances key off
    // this instead of re-parsing the displayed message text.
    const [submitErrorCause, setSubmitErrorCause] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // §37 / G125: form-draft persistence. Persists only the user-visible
    // composition fields; password / mnemonic / passphrase NEVER touch
    // localStorage. The hook is keyed by walletId so a from-seed restore
    // doesn't surface a stranger's draft.
    // Cluster P FOLLOWUP 6: honor the user's privacy.formDraftTtlMs
    // setting (Off / 1h / 24h / 7d). Default 24h matches the prior
    // hardcoded behavior. `0` (Off) disables save() + evicts any
    // existing draft on load.
    const formDraftTtlMs = Number.isFinite(settings?.privacy?.formDraftTtlMs)
        ? Number(settings.privacy.formDraftTtlMs)
        : undefined;
    const draft = useFormDraft({ view: 'send', walletId, ttlMs: formDraftTtlMs });
    const [draftPending, setDraftPending] = useState(() => draft.hasDraft());
    useEffect(() => {
        if (stage !== 'form' || !draftPending) return;
        draft.save({ chainId, toAddress, tick, amount, memo });
    }, [stage, draftPending, draft, chainId, toAddress, tick, amount, memo]);
    const restoreDraft = useCallback(() => {
        const v = draft.load();
        if (!v) { setDraftPending(false); return; }
        if (typeof v.chainId === 'string') setChainId(v.chainId);
        if (typeof v.toAddress === 'string') setToAddress(v.toAddress);
        if (typeof v.tick === 'string') setTick(v.tick);
        if (typeof v.amount === 'string') setAmount(v.amount);
        if (typeof v.memo === 'string') setMemo(v.memo);
        setDraftPending(true);
    }, [draft]);
    const dismissDraft = useCallback(() => {
        draft.clear();
        setDraftPending(false);
    }, [draft]);

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const firstChain = Object.keys(byChain)[0];
                if (!firstChain) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one.',
                    );
                    return;
                }
                // §47 Cluster L FOLLOWUP 1: preserve a prefilled chainId
                // if the route opened from a deep-link intent. Falls back
                // to the first available chain when no prefill exists.
                setChainId((prev) => prev || firstChain);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // §18.4 firmware-warning support. When the source address is HW we
    // need vendor / model / firmwareVersion to render the warning banner
    // inside HwSignBlock. The shared `useSignerInfo` hook (Cluster N
    // FOLLOWUP 2) consolidates the SignerRecord lookup and caches the
    // signer list across re-mounts.

    // §29.4 / §21.6 autocomplete source data. Contacts cover the whole
    // vault and load once; history is per-chain × per-address and
    // refetches when the chain changes.
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));
    useEffect(() => {
        let cancelled = false;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setContacts(Array.isArray(rows) ? rows : []); })
            .catch(() => { /* silent; autocomplete just shows fewer hits */ });
        return () => { cancelled = true; };
    }, [messaging]);

    // Contacts UX state: picker open/close, search query, and the
    // "save as contact" inline form (idle → naming → saving).
    const [contactsPickerOpen, setContactsPickerOpen] = useState(false);

    const [historyRows, setHistoryRows] = useState(/** @type {any[]} */ ([]));
    useEffect(() => {
        if (!chainId || !addressesByChain) return undefined;
        const ownAddrs = (addressesByChain[chainId] || []).map((a) => a.address);
        if (ownAddrs.length === 0) {
            setHistoryRows([]);
            return undefined;
        }
        let cancelled = false;
        Promise.all(
            ownAddrs.map((addr) =>
                messaging.getAddressHistory({ chainId, address: addr })
                    .then((rows) => Array.isArray(rows) ? rows : [])
                    .catch(() => []),
            ),
        ).then((results) => {
            if (cancelled) return;
            setHistoryRows(results.flat());
        });
        return () => { cancelled = true; };
    }, [chainId, addressesByChain, messaging]);

    const suggestions = useMemo(() => {
        const descriptor = chainId ? chainRegistry.get(chainId) : null;
        return buildRecentDestinations({
            contacts,
            chainCoin: descriptor?.coin,
            historyRows,
        });
    }, [contacts, chainId, historyRows]);

    // Contact rows that have an entry on the current chain: the
    // picker and resolved-name chip both filter against this set.
    const chainCoinFor = useCallback((cid) => {
        const d = cid ? chainRegistry.get(cid) : null;
        return d?.coin || null;
    }, []);

    const chainContacts = useMemo(() => {
        const coin = chainCoinFor(chainId);
        if (!coin) return [];
        const out = [];
        for (const c of contacts) {
            for (const e of c?.entries || []) {
                if (e?.chain === coin && e?.address) {
                    out.push({ contact: c, entry: e });
                }
            }
        }
        return out;
    }, [contacts, chainId, chainCoinFor]);

    // If the typed address exactly matches a contact entry on this chain,
    // show the matched-contact name pill next to the To label.
    const matchedContact = useMemo(() => {
        const trimmed = toAddress.trim();
        if (!trimmed) return null;
        return chainContacts.find(({ entry }) => entry.address === trimmed) || null;
    }, [toAddress, chainContacts]);

    const handlePickContact = useCallback((entry) => {
        setToAddress(entry.address);
        setToError(null);
        setContactsPickerOpen(false);
    }, []);


    // §29.5 smart paste: BIP21 URI pre-fills amount/token/memo;
    // pasting a WIF surfaces "import this private key instead?" rather
    // than letting the user paste a private key into the To field.
    // Also runs §21.5 paste-integrity: hashes the pasted text, then
    // re-reads navigator.clipboard.readText() and warns if the
    // clipboard rewrote itself between paste and re-read.
    const [pasteHint, setPasteHint] = useState(/** @type {string | null} */ (null));
    const [pasteWarning, setPasteWarning] = useState(/** @type {string | null} */ (null));
    const onAddressPaste = useCallback((e) => {
        const text = e?.clipboardData?.getData?.('text');
        if (typeof text !== 'string' || text.length === 0) return;
        const trimmed = text.trim();
        const detected = uriLib.detectQrContent(trimmed, { chainRegistry });
        if (detected.type === 'bip21') {
            e.preventDefault();
            setToAddress(detected.address);
            const parts = detected.parts;
            if (parts.amount) setAmount(parts.amount);
            const tickParam = parts.params?.tick;
            if (typeof tickParam === 'string' && tickParam.length > 0) {
                //  §3.6: pasted text is the same untrusted-URI class as
                // a deep link or a scanned QR, so tick/memo get the same
                // neutralization those paths apply. `address` stays raw; see
                // `hardenUriIntentText`'s comment for why.
                setTick(neutralizeControlText(tickParam).toUpperCase());
            }
            if (parts.message) setMemo(neutralizeControlText(parts.message));
            setPasteHint(`Filled from ${detected.scheme}: URI`);
        } else if (detected.type === 'xchain-uri') {
            e.preventDefault();
            // Route through the richer parser so the new coin-code form
            // (xchain:TBTC/send?to=…) yields intent.address rather than the
            // raw "TBTC/send" that the BIP21 fallback would surface.
            const intent = uriLib.hardenUriIntentText(uriLib.parseXchainUri(trimmed, { chainRegistry }));
            if (intent.address) setToAddress(intent.address);
            if (intent.tick) setTick(intent.tick.toUpperCase());
            if (intent.amount) setAmount(intent.amount);
            if (intent.memo) setMemo(intent.memo);
            if (intent.chainId && intent.chainId !== chainId) {
                setChainId(intent.chainId);
            }
            setPasteHint('Filled from xchain: URI');
        } else if (detected.type === 'wif') {
            e.preventDefault();
            setPasteHint(
                'That looks like a private key, not an address. Use Settings → Import private key to import it.',
            );
        } else {
            // raw address / unknown; let the default paste happen.
            setPasteHint(null);
        }
        setPasteWarning(null);
        // Defer the integrity check so the paste event finishes first.
        // navigator.clipboard.readText is async and permission-gated;
        // skipped + ok results are silent.
        Promise.resolve().then(() => checkPasteIntegrity({ pastedText: text }))
            .then((res) => { if (!res.ok) setPasteWarning(res.reason || 'Clipboard altered after paste; verify the address before sending.'); })
            .catch(() => { /* silent */ });
    }, [chainId]);

    // §21.4 test-send protection. Session-scoped acknowledgement set;
    // marking an address tested suppresses the gate for the rest of
    // the session. Persistence across reloads is intentionally out of
    // scope (avoids a wallet-schema migration just to track a UX
    // affordance); the user re-confirms after a reload, which is fine.
    const [testedThisSession, setTestedThisSession] = useState(
        /** @type {Set<string>} */ (() => new Set()),
    );
    const markTested = useCallback((addr) => {
        setTestedThisSession((prev) => {
            if (prev.has(addr)) return prev;
            const next = new Set(prev);
            next.add(addr);
            return next;
        });
    }, []);

    // §21.5 lookalike fuzzy-match. Compare the entered address against
    // the autocomplete candidate set (contacts + recent send history).
    // Surfaces a warning when the user is about to send to an address
    // that is one or two characters off from a known one.
    const lookalikeWarning = useMemo(() => {
        const trimmed = toAddress.trim();
        if (!trimmed) return null;
        const hit = findLookalike({ address: trimmed, candidates: suggestions });
        if (!hit) return null;
        const sourceLabel = hit.match.source === 'contact'
            ? `contact "${hit.match.label}"`
            : 'an address you have sent to before';
        const pct = Math.round(hit.score * 100);
        return `Looks ${pct}% similar to ${sourceLabel}: ${hit.match.address}. Double-check this is the address you mean.`;
    }, [toAddress, suggestions]);

    // §21.4 test-send gate. Active when:
    //   - threshold > 0 (Settings → Safety → Test-send warning)
    //   - the send is a native-coin send (tick matches descriptor.coin
    //     uppercased; the threshold is denominated in sats and only
    //     translates cleanly for native sends; tick/token threshold is
    //     a future fiat-aware affordance)
    //   - amountSats exceeds the threshold
    //   - recipient is novel (not in contacts on this chain, no past SEND
    //     to it from any of the wallet's addresses on this chain)
    //   - user hasn't already acknowledged this address in the session
    const testSendGate = useMemo(() => {
        const threshold = Number(settings?.grace?.testSendThresholdSats) || 0;
        if (threshold <= 0) return null;
        const dest = toAddress.trim();
        if (!dest) return null;
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const nativeTicker = nativeTickerFor(desc);
        if (!nativeTicker || tick.trim().toUpperCase() !== nativeTicker) return null;
        const amountSats = exactSatsFromDecimalString(amount);
        if (amountSats === null || amountSats <= 0) return null;
        if (amountSats <= threshold) return null;
        const novelty = checkRecipientNovelty({
            address: dest,
            chainCoin: desc.coin,
            contacts,
            historyRows,
        });
        if (!novelty.novel) return null;
        if (testedThisSession.has(dest)) return null;
        return {
            amountSats,
            threshold,
            ticker: nativeTicker,
        };
    }, [settings, toAddress, tick, amount, chainId, contacts, historyRows, testedThisSession]);

    // §29.2 Max + §29.3 fiat toggle.
    // Fiat rate for "≈ $X.XX" preview + the optional fiat-entry mode.
    // Oracle-primary with CoinGecko fallback (§45, ); the
    // fallback is gated on the privacy.priceDataEnabled setting.
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    const fiatRate = useFiatRate({
        chainCoin: chainId ? chainRegistry.get(chainId)?.coin : null,
        fiatCurrency,
        allowCoingeckoFallback: settings?.privacy?.priceDataEnabled !== false,
    });

    const isNativeSend = useMemo(() => {
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const nativeTicker = nativeTickerFor(desc);
        return Boolean(nativeTicker && tick.trim().toUpperCase() === nativeTicker);
    }, [chainId, tick]);

    // PC-52 derived state. `sendLegs` is the whole recipient list (first row +
    // extras) in the shape the flows take; `isMultiSend` is what switches the
    // payload from the flat to/tick/amount fields to `legs`.
    const isMultiSend = extraLegs.length > 0;
    const sendLegs = useMemo(() => [
        {
            to: toAddress.trim(),
            tick: tick.trim(),
            amount: String(amount).trim(),
            ...(isNativeSend || !memo.trim() ? {} : { memo: memo.trim() }),
        },
        ...extraLegs.map((leg) => ({
            to: leg.to.trim(),
            tick: (perRecipientToken && leg.tick.trim()) ? leg.tick.trim() : tick.trim(),
            amount: String(leg.amount).trim(),
            ...(isNativeSend || !memo.trim() ? {} : { memo: memo.trim() }),
        })),
    ], [toAddress, tick, amount, memo, isNativeSend, extraLegs, perRecipientToken]);
    // Per-token totals, so the form can show what the whole send costs rather
    // than only the first row's amount.
    const sendTotals = useMemo(() => totalsByTick(sendLegs), [sendLegs]);
    const addRecipient = useCallback(() => {
        setExtraLegs((prev) => (prev.length + 1 >= MAX_SEND_LEGS ? prev : [
            ...prev,
            // Date.now alone collides when two rows are added in the same tick.
            { id: `leg-${Date.now()}-${prev.length}`, to: '', amount: '', tick: '' },
        ]));
    }, []);
    const updateRecipient = useCallback((id, patch) => {
        setExtraLegs((prev) => prev.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)));
    }, []);
    const removeRecipient = useCallback((id) => {
        setExtraLegs((prev) => prev.filter((leg) => leg.id !== id));
    }, []);
    // A native tick pays real outputs instead of writing an action, so it has
    // no multi-recipient form (flows/sendLegs.js refuses it, and the refusal is
    // mirrored here so the user learns it at compose time rather than at sign
    // time). Typed rows are KEPT, not silently dropped: switching the token
    // back is the fix, and discarding a list of addresses the user just entered
    // would be the worse failure.
    const nativeMultiSendBlock = isMultiSend && isNativeSend
        ? `${tick.trim().toUpperCase()} can only be sent to one recipient at a time. `
          + 'It pays a real output rather than writing an XChain action, so each recipient '
          + 'needs their own transaction. Remove the extra recipients, or pick a token.'
        : null;

    //  dust floor on the RECIPIENT amount, refused here rather than at the node.
    //
    // An output below the chain's dust threshold is non-standard, so the transaction is
    // rejected at relay: it never enters a mempool and costs no miner fee, but the wallet
    // has already composed it, opened the confirm screen and SIGNED it, and all the user
    // was told afterwards was that "the network rejected this transaction" - which names
    // neither the amount nor the floor, so retrying the same amount is the obvious next
    // move. The floor is a per-chain protocol constant the wallet already knows (the
    // native-fee lane refuses a below-dust FEE output by the same reasoning, (b)),
    // so this is predictable before anything is built.
    //
    // NATIVE sends only. A native amount is paid as a real output of exactly that size; a
    // token amount is written into the action instead, and the encoder sizes the
    // destination output itself (its own `dustAmount`, M-6), so a 109-unit token send is
    // perfectly ordinary. `amount` here is the first leg; extra legs are token-only,
    // because nativeMultiSendBlock above already refuses a multi-recipient native send.
    const dustBlock = useMemo(() => {
        if (!isNativeSend) return null;
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const floor = dustThresholdForCoin(desc?.coin);
        if (!floor) return null;
        const sats = exactSatsFromDecimalString(amount);
        if (sats === null || sats <= 0 || sats >= floor) return null;
        const ticker = nativeTickerFor(desc) || tick.trim().toUpperCase();
        const minimum = decimalStringFromSats(BigInt(floor));
        return `That amount is too small to send. The smallest ${ticker} payment the network will `
            + `carry is ${minimum} ${ticker} (${formatWithThousands(String(floor))} sats), and anything `
            + 'under that is refused by every node, so it can never arrive. Enter at least '
            + `${minimum} ${ticker}.`;
    }, [isNativeSend, chainId, amount, tick]);

    // Retract the refusal the moment the amount stops being dust. `formError` is
    // otherwise only cleared by the next submit, so raising the amount to a legal one
    // left the old "too small to send" sentence sitting under a form that was now
    // fine. Matched by identity against what the guard itself pushed, so an unrelated
    // error occupying the slot is never cleared out from under the user.
    const dustErrorRef = useRef(/** @type {string | null} */ (null));
    useEffect(() => {
        if (dustBlock) return;
        // Read the ref BEFORE clearing it: React invokes a functional updater
        // during the next render, by which point the field would already be null
        // and every comparison against it would fail.
        const pushed = dustErrorRef.current;
        dustErrorRef.current = null;
        setFormError((prev) => (prev !== null && prev === pushed ? null : prev));
    }, [dustBlock]);

    // : `fiatRate` prices the CHAIN COIN. The amount field may be holding a
    // TOKEN amount, and pricing that at the coin's rate renders a confidently
    // formatted, wildly wrong number (50,000 XCHAIN shown as billions of dollars).
    // Everything that prices the AMOUNT uses this gated rate; the network-fee
    // preview below keeps using the raw `fiatRate`, because a fee is always paid
    // in the native coin regardless of which token is being sent.
    const amountFiatRate = useMemo(
        () => fiatRateForTick({
            rate: fiatRate,
            tick,
            nativeTicker: nativeTickerFor(chainId ? chainRegistry.get(chainId) : null),
        }),
        [fiatRate, tick, chainId],
    );

    // Switching from the coin to a token while typing in fiat would leave the
    // field in a mode it can no longer convert, so fall back to coin entry.
    useEffect(() => {
        if (!amountFiatRate && amountInputMode === 'fiat') {
            setAmountInputMode('coin');
            setFiatAmount('');
        }
    }, [amountFiatRate, amountInputMode]);

    const onCoinInputChange = useCallback((value) => {
        setAmount(value);
    }, []);

    const amountInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Amount-block input handler that branches on `amountInputMode`.
    // The canonical `amount` is always coin-scale (matches the payload
    // shape Send submits); when the user is typing in fiat, we keep
    // their raw text in `fiatAmount` for display fidelity and derive
    // the coin amount via fiatToCoin so the rest of the form (fee
    // estimate, simulator, Max guards) stays correct.
    //
    // Commas are formatting only; strip them before storing, then
    // restore the cursor by mapping its position from "non-comma chars
    // to the left" so typing across a thousands boundary doesn't fling
    // the caret around.
    const onAmountFieldChange = useCallback((rawValue, cursorPos) => {
        const stripped = String(rawValue).replace(/,/g, '');
        // Reject anything that isn't a valid partial decimal; keeps
        // the field from accepting "1.2.3" or random chars while still
        // allowing in-progress entries like "" / "." / "1.".
        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
        if (amountInputMode === 'fiat') {
            setFiatAmount(stripped);
            if (!amountFiatRate) {
                if (stripped === '') setAmount('');
            } else {
                const derivedCoin = fiatToCoin(stripped, amountFiatRate);
                setAmount(derivedCoin != null ? derivedCoin : '');
            }
        } else {
            setAmount(stripped);
        }
        if (typeof cursorPos === 'number' && amountInputRef.current) {
            const formattedNew = formatWithThousands(stripped);
            const nonCommaBefore = countNonCommaBefore(String(rawValue), cursorPos);
            const nextCursor = indexAfterNonCommaCount(formattedNew, nonCommaBefore);
            const el = amountInputRef.current;
            requestAnimationFrame(() => {
                if (el && document.activeElement === el) {
                    try { el.setSelectionRange(nextCursor, nextCursor); } catch { /* selection unavailable on some input types */ }
                }
            });
        }
    }, [amountInputMode, amountFiatRate]);

    const toggleAmountInputMode = useCallback(() => {
        if (!amountFiatRate) return;
        setAmountInputMode((prev) => {
            if (prev === 'coin') {
                const fv = amount ? coinToFiat(amount, amountFiatRate) : null;
                setFiatAmount(fv != null ? fv.toFixed(2) : '');
                return 'fiat';
            }
            // fiat -> coin: keep canonical amount, clear typed fiat
            setFiatAmount('');
            return 'coin';
        });
    }, [amount, amountFiatRate]);

    const onSendSmallTest = useCallback(() => {
        const amtSats = exactSatsBigIntFromDecimalString(amount);
        if (amtSats == null || amtSats <= 0n) return;
        // 1% of the original (floor division in sats). : the floor is the chain's
        // dust threshold, not one satoshi, because the gate only ever fires on a NATIVE
        // send and 1% of a modest amount lands under 546 sats routinely. A one-sat "test"
        // is a transaction no node relays, so the button that exists to build the user's
        // confidence would have handed them a failure instead. Exact BigInt math keeps
        // the result a plain decimal string ('0.00000001', never '1e-8').
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const floor = BigInt(dustThresholdForCoin(desc?.coin) || 1);
        const onePercent = amtSats / 100n;
        const lifted = onePercent > floor ? onePercent : floor;
        // Never propose a "small test" larger than what the user asked to send.
        const reduced = lifted < amtSats ? lifted : amtSats;
        const display = decimalStringFromSats(reduced);
        setAmount(display);
        setStage('form');
    }, [amount, chainId]);

    // Latest-tick ref so the chainId effect below can preserve a
    // non-empty tick without subscribing to every keystroke.
    useEffect(() => {
        if (!walletId || typeof messaging.getActiveAddresses !== 'function') return undefined;
        let cancelled = false;
        messaging.getActiveAddresses(walletId)
            .then((m) => { if (!cancelled) setActiveByChain(m || {}); })
            .catch(() => { if (!cancelled) setActiveByChain({}); });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const tickRef = useRef(tick);
    tickRef.current = tick;
    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        const all = addressesByChain[chainId] || [];
        // : a source the user picked on THIS chain wins over the default.
        // The tick default below still runs either way, so only the
        // from-address half is skipped.
        if (pickedSourceChain !== chainId) {
            // Prefer the chain's active (operating) address; fall back to the
            // newest HD external address when no active address is resolvable.
            const activeId = activeByChain[chainId]?.id;
            if (activeId && all.some((a) => a.id === activeId)) {
                setFromAddressId(activeId);
            } else {
                const addrs = all.filter(
                    (a) => a.source === 'hd' && externalIndexOf(a.derivationPath) !== null,
                );
                if (addrs.length > 0) {
                    const sorted = [...addrs].sort((a, b) => {
                        const ai = (externalIndexOf(a.derivationPath) ?? -1);
                        const bi = (externalIndexOf(b.derivationPath) ?? -1);
                        return bi - ai;
                    });
                    setFromAddressId(sorted[0].id);
                } else {
                    setFromAddressId(null);
                }
            }
        }
        // Default the tick to the native coin only when the field is
        // empty. Without this guard, SendPicker prefilling a non-native
        // token (e.g. PEPECREATURE on Bitcoin testnet4) gets clobbered
        // by 'TBTC' the moment this effect fires post-mount.
        const descriptor = chainRegistry.get(chainId);
        if (descriptor && !tickRef.current.trim()) {
            const nativeTicker = nativeTickerFor(descriptor);
            if (nativeTicker) setTick(nativeTicker);
        }
    }, [chainId, addressesByChain, activeByChain, pickedSourceChain]);

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        // PC-52: the decoder summarizes ONE leg, so a multi-recipient send is
        // summarized here instead of being decoded into a line that names the
        // first recipient and hides the rest. Every leg is listed in Details.
        if (isMultiSend) {
            return {
                summary: summarizeSendLegs(sendLegs),
                details: sendLegs.map((leg, i) => ({
                    label: `Recipient ${i + 1}`,
                    value: `${leg.amount} ${leg.tick.toUpperCase()} to ${leg.to}`,
                })),
                warnings: [],
            };
        }
        return decoderLib.decodeAction({
            action: 'SEND',
            params: {
                TICK: tick.trim(),
                AMOUNT: String(amount).trim(),
                DESTINATION: toAddress.trim(),
                MEMO: memo.trim() || undefined,
            },
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, tick, amount, toAddress, memo, chainId, isMultiSend, sendLegs]);

    // §21.2 balance-change preview. Fetched on entering review against
    // the source address; the result feeds `decoder.simulateAction` and
    // renders inside `<BalanceChanges>` between the headline and details.
    // Fetch failure is non-blocking; the section renders muted with a
    // "(preview unavailable)" line and the user can still sign.
    const [previewBalances, setPreviewBalances] = useState(
        /** @type {{ loading: boolean, error: string | null, sdkShape: any | null }} */
        ({ loading: false, error: null, sdkShape: null }),
    );
    useEffect(() => {
        // Fetch on review (for the simulator) AND on form (so Max + the
        // "Available: X" hint know what's spendable). Form-stage fetches
        // are non-blocking; failure leaves Max disabled, the hint hidden.
        if (stage !== 'review' && stage !== 'form') return undefined;
        if (!chainId || !fromAddress) return undefined;
        let cancelled = false;
        setPreviewBalances({ loading: true, error: null, sdkShape: null });
        messaging.getAddressBalances(chainId, fromAddress.address)
            .then((sdkShape) => {
                if (cancelled) return;
                setPreviewBalances({ loading: false, error: null, sdkShape });
            })
            .catch((err) => {
                if (cancelled) return;
                setPreviewBalances({
                    loading: false,
                    error: err?.message || 'balance fetch failed',
                    sdkShape: null,
                });
            });
        return () => { cancelled = true; };
    }, [stage, chainId, fromAddress, messaging]);

    // PC-26 gated-send readiness. A tick with active gated content can
    // only be sent as BATCH(SEND, MESSAGE-with-key); the host guard
    // enforces that at compose time, and this probe mirrors its key
    // resolution (secret-free) so the form can explain BEFORE submit:
    // ready = keys attach silently, partial = warn (recipient can't open
    // the missing packs), blocked = no keys held, submit disabled and a
    // recovery scan offered (software signers only; the scan decrypts
    // with the address keys, which HW/watch-only cannot do - §5).
    const [gatedInfo, setGatedInfo] = useState(
        /** @type {{ state: 'ungated' | 'ready' | 'partial' | 'blocked', groups: any[] } | null} */ (null),
    );
    const [gatedScanPassword, setGatedScanPassword] = useState('');
    const [gatedScanBusy, setGatedScanBusy] = useState(false);
    const [gatedScanError, setGatedScanError] = useState(/** @type {string | null} */ (null));
    const gatedProbeSeq = useRef(0);
    useEffect(() => {
        setGatedInfo(null);
        setGatedScanError(null);
        if (!walletId || !chainId || !tick.trim()) return undefined;
        if (typeof messaging.gatedSendReadiness !== 'function') return undefined; // older host build
        const seq = gatedProbeSeq.current + 1;
        gatedProbeSeq.current = seq;
        // Debounced: `tick` changes per keystroke when typed by hand.
        const timer = setTimeout(() => {
            messaging.gatedSendReadiness({
                walletId,
                chainId,
                tick: tick.trim(),
                sourceAddress: fromAddress?.address,
                // PC-29: destination + amount feed the unlock-threshold
                // lane host-side (inert until the GATE_MIN_AMOUNT flag
                // day), keeping this banner in agreement with compose.
                to: toAddress.trim() || undefined,
                amount: amount || undefined,
            })
                .then((resp) => {
                    if (gatedProbeSeq.current === seq && resp && resp.state !== 'ungated') setGatedInfo(resp);
                })
                .catch(() => {
                    // Detection failure degrades to no banner; the compose-time
                    // guard (and ultimately the indexer) still protects the send.
                });
        }, 400);
        return () => { clearTimeout(timer); };
    }, [walletId, chainId, tick, toAddress, amount, fromAddress?.address, messaging]);

    // PC-52 + PC-26: a gated tick's SEND is only valid inside
    // BATCH(SEND, MESSAGE) carrying an unlock key encrypted to the RECIPIENT,
    // so an N-recipient send needs N handoffs. Only the single-recipient path
    // composes that today, and the flows refuse the rest, so the form refuses
    // it here too instead of letting compose fail after the modal opens.
    // `gatedInfo` is non-null only for a tick with active gated content
    // (an 'ungated' probe result is never stored).
    const gatedMultiSendBlock = isMultiSend && gatedInfo
        ? `${tick.trim().toUpperCase()} has token-gated content, and each recipient needs their own `
          + 'unlock-key handoff. Send this token to one recipient at a time.'
        : null;

    async function handleGatedScan(event) {
        event.preventDefault();
        if (gatedScanBusy || gatedScanPassword.length === 0) return;
        setGatedScanBusy(true);
        setGatedScanError(null);
        try {
            const res = await messaging.gatedContentScan({
                walletId,
                password: gatedScanPassword,
                chainId,
                tick: tick.trim(),
            });
            setGatedScanPassword('');
            if (!res || res.recoveredKeyHashes?.length === 0) {
                setGatedScanError(
                    'No unlock keys found on any of this wallet\'s addresses. '
                    + 'Keys arrive with the token when it is sent to you directly; ask the sender to re-send it.',
                );
            }
            // Re-probe either way so the banner reflects the vault state.
            const resp = await messaging.gatedSendReadiness({
                walletId, chainId, tick: tick.trim(), sourceAddress: fromAddress?.address,
                to: toAddress.trim() || undefined, amount: amount || undefined,
            });
            setGatedInfo(resp && resp.state !== 'ungated' ? resp : null);
        } catch (err) {
            const bad = err?.name === 'WrongPasswordError' || err?.name === 'InvalidPasswordError';
            setGatedScanError(bad ? 'Incorrect password.' : (err?.message || 'Key recovery scan failed.'));
        } finally {
            setGatedScanBusy(false);
        }
    }

    // §44.2 user-selectable fee tiers. Selector backs both the §21.2
    // simulator's fee row + the §29.2 Max button. Default tier is
    // 'normal'; user picks via FeeSelector. Custom mode accepts a
    // sat/vB or DOGE/kB rate via the bound input.
    const [feePick, setFeePick] = useState(() => {
        // Prefill-encoded fee priority from a scanned receive-request URI
        // wins over saved settings on first render; user can still change
        // via the FeeSelector.
        const fp = prefill?.feePriority;
        if (fp && ['low', 'normal', 'fast'].includes(fp)) {
            return /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: fp });
        }
        return /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' });
    });
    const prefillFeeConsumedRef = useRef(Boolean(
        prefill?.feePriority && ['low', 'normal', 'fast'].includes(prefill.feePriority),
    ));

    // Step 5 of §44: initial mode + custom rate seeded from
    // settings.fees[chainId]. Persisted preference flows from the §35
    // Fees panel's Strategy picker; user can still flip per-tx via the
    // FeeSelector without touching the saved default. Re-seeds when
    // the active chain changes.
    useEffect(() => {
        if (!chainId || !settings?.fees) return;
        // Skip the very first run when a scanned URI carried a feePriority
        // hint; that pick already seeded feePick and should beat the
        // saved default on initial render.
        if (prefillFeeConsumedRef.current) {
            prefillFeeConsumedRef.current = false;
            return;
        }
        const chainFees = settings.fees[chainId];
        if (!chainFees || typeof chainFees.strategy !== 'string') return;
        const desc = chainRegistry.get(chainId);
        const tableUnit = desc?.coin === 'dogecoin' ? 'DOGE/kB' : 'sat/vB';
        if (chainFees.strategy === 'custom' && Number.isFinite(chainFees.customSatsPerKb)) {
            setFeePick({
                mode: 'custom',
                customRate: settingsCustomToDisplayRate(tableUnit, chainFees.customSatsPerKb),
            });
        } else if (['low', 'normal', 'fast'].includes(chainFees.strategy)) {
            setFeePick({ mode: chainFees.strategy });
        }
    }, [chainId, settings]);

    // §44.3 RBF toggle. Default reads from settings.fees[chainId]
    // .rbfByDefault when present; falls back to true (BIP125 RBF is the
    // §29 / §44 expectation for all native sends). The current value
    // flows into the send payload as `rbf: bool`; the encoder uses
    // it to set the input sequence numbers (RBF requires sequence <
    // 0xfffffffe per BIP125).
    const [rbfEnabled, setRbfEnabled] = useState(true);
    useEffect(() => {
        if (!chainId || !settings?.fees) return;
        const chainFees = settings.fees[chainId];
        if (chainFees && typeof chainFees.rbfByDefault === 'boolean') {
            setRbfEnabled(chainFees.rbfByDefault);
        }
    }, [chainId, settings]);

    // Step 4 of §44: async fetcher probes the shell's messaging
    // layer for an SDK-backed `estimateFee` method; falls back to the
    // synchronous placeholder when the method isn't registered. The
    // sync helper still backs the initial render so the form stays
    // responsive on first paint; the effect upgrades to live tiers
    // when the SDK responds.
    const [feeTiers, setFeeTiers] = useState(/** @type {any} */ (null));
    useEffect(() => {
        if (!chainId) {
            setFeeTiers(null);
            return undefined;
        }
        // Synchronous initial seed.
        setFeeTiers(estimateNativeSendFeeTiers({ chainId, chainRegistry }));
        let cancelled = false;
        fetchNativeSendFeeTiers({ messaging, chainId, chainRegistry })
            .then((tiers) => { if (!cancelled && tiers) setFeeTiers(tiers); })
            .catch(() => { /* keep the placeholder seed */ });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    const feeEstimate = useMemo(() => {
        if (!chainId) return null;
        if (feePick.mode === 'custom') {
            return customFeeEstimate({
                chainId,
                chainRegistry,
                rate: Number(feePick.customRate) || 0,
            });
        }
        // Prefer the live tier (SDK-sourced when available); fall back
        // to the synchronous placeholder if the async fetch hasn't
        // populated yet.
        const liveTier = feeTiers ? feeTiers[feePick.mode] : null;
        if (liveTier) return liveTier;
        return estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode });
    }, [chainId, feePick, feeTiers]);

    // The picked rate converted to the encoder's feePerKb unit (smallest-unit
    // per KB), so the tier/custom choice actually prices the broadcast tx (not
    // just the on-screen estimate). Null when there's no usable estimate (e.g.
    // an empty custom rate), which falls back to the encoder's own default.
    // Mirrors ComposeMessage / DispenserDetail.
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    // Native-unit balance available for the selected tick on the
    // source address, derived from the same SDK call the simulator
    // already runs. Drives Max + the "Available: X" hint. Lives below
    // the previewBalances + feeEstimate declarations because both are
    // referenced in the factory bodies; the original placement above
    // those `useState`/`useMemo` calls hit a TDZ during render.
    const sourceBalance = useMemo(() => {
        if (!previewBalances.sdkShape) return null;
        const tickUpper = tick.trim().toUpperCase();
        if (!tickUpper) return null;
        const native = previewBalances.sdkShape.native;
        if (native && String(native.tick || '').toUpperCase() === tickUpper) {
            return decoderLib.balancesFromSdk(previewBalances.sdkShape).find((b) => b.tick === tickUpper) || null;
        }
        return decoderLib.balancesFromSdk(previewBalances.sdkShape).find((b) => b.tick === tickUpper) || null;
    }, [previewBalances.sdkShape, tick]);

    // : the asset picker is wallet-scoped, the funding is address-scoped, and this
    // is where they disagree. A WARNING rather than a refusal, deliberately: the only
    // evidence is a balance read, and a lagging or failed one must never be able to block
    // a send the address can genuinely pay for. Both of those states are excluded here, so
    // this fires only when the balances came back clean and this address holds none of the
    // selected token.
    const sourceLacksTick = useMemo(() => {
        if (previewBalances.loading || previewBalances.error || !previewBalances.sdkShape) return null;
        const tickUpper = tick.trim().toUpperCase();
        if (!tickUpper || sourceBalance) return null;
        return `This address holds no ${tickUpper}. A send spends from one address, not from the `
            + 'whole wallet, so pick the address that holds it in the From field above.';
    }, [previewBalances, sourceBalance, tick]);

    const onMax = useCallback(() => {
        if (!sourceBalance || !sourceBalance.amount) return;
        // Exact string/BigInt math: this string is what gets signed, and a
        // parseFloat round-trip on a large (>~90M-sat DOGE) balance drifts
        // by whole sats, leaving dust behind or overshooting the balance.
        const balanceSats = exactSatsBigIntFromDecimalString(sourceBalance.amount);
        if (balanceSats == null || balanceSats <= 0n) return;
        let maxSats = balanceSats;
        if (isNativeSend && feeEstimate) {
            const feeSats = exactSatsBigIntFromDecimalString(feeEstimate.coinAmount);
            if (feeSats != null) maxSats = balanceSats > feeSats ? balanceSats - feeSats : 0n;
        }
        const display = decimalStringFromSats(maxSats);
        setAmount(display);
        if (amountInputMode === 'fiat' && amountFiatRate) {
            const fv = coinToFiat(display, amountFiatRate);
            setFiatAmount(fv != null ? fv.toFixed(2) : '');
        }
    }, [sourceBalance, isNativeSend, feeEstimate, amountInputMode, amountFiatRate]);

    // PC-52: the simulator models ONE leg. For a multi-recipient send of a
    // single token that is still exact (the source-side delta is the sum, and
    // the indexer consolidates by destination|tick), so the preview runs on the
    // total. Across several tokens it would model only one of them, which is
    // worse than no preview: that case says so instead (see the review stage).
    const multiTickPreviewGap = isMultiSend && sendTotals.length > 1;
    const previewResult = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        if (previewBalances.loading || previewBalances.error || !previewBalances.sdkShape) {
            return null;
        }
        if (multiTickPreviewGap) return null;
        const feeStr = feeEstimate?.coinAmount || '0';
        return decoderLib.simulateAction({
            action: 'SEND',
            params: {
                TICK: tick.trim(),
                AMOUNT: isMultiSend ? sendTotals[0].amount : String(amount).trim(),
                DESTINATION: toAddress.trim(),
                MEMO: memo.trim() || undefined,
            },
            balances: decoderLib.balancesFromSdk(previewBalances.sdkShape),
            // Fee from the static placeholder table (§44.2 cluster
            // wires the real selector). The simulator emits the fee
            // row with the value provided here; surfaces marked
            // "(placeholder)" in the BalanceChanges renderer when
            // confidence is low.
            feeEstimate: feeStr,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [
        stage, tick, amount, toAddress, memo, chainId, previewBalances, feeEstimate,
        isMultiSend, sendTotals, multiTickPreviewGap,
    ]);

    function handleReview(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!toAddress.trim()) {
            setFormError('Destination address is required.');
            return;
        }
        const addressError = destinationAddressError(toAddress, descriptor);
        if (addressError) {
            setToError(addressError);
            setFormError(addressError);
            return;
        }
        if (!tick.trim()) {
            setFormError('Token ticker is required.');
            return;
        }
        const amt = String(amount).trim();
        if (!amt || Number(amt) <= 0) {
            setFormError('Amount must be a positive number.');
            return;
        }
        // : refuse a below-dust amount BEFORE composing. Enter also submits this
        // form, so the inline warning alone would not be enough (same reasoning as the
        // test-send gate below).
        if (dustBlock) {
            dustErrorRef.current = dustBlock;
            setFormError(dustBlock);
            return;
        }
        if (/[|;]/.test(memo)) {
            setFormError('Memo cannot contain | or ; characters.');
            return;
        }
        // PC-52: the extra recipients get the same checks the first one gets.
        // A bad address here is the same unspendable-output mistake, and it
        // would otherwise only surface as a compose failure after the modal
        // opened.
        if (nativeMultiSendBlock) {
            setFormError(nativeMultiSendBlock);
            return;
        }
        for (let i = 0; i < extraLegs.length; i += 1) {
            const leg = extraLegs[i];
            const label = `Recipient ${i + 2}`;
            if (!leg.to.trim()) {
                setFormError(`${label}: address is required.`);
                return;
            }
            const legAddressError = destinationAddressError(leg.to, descriptor);
            if (legAddressError) {
                setFormError(`${label}: ${legAddressError}`);
                return;
            }
            if (perRecipientToken && !leg.tick.trim()) {
                setFormError(`${label}: token is required.`);
                return;
            }
            const legAmount = String(leg.amount).trim();
            if (!legAmount || Number(legAmount) <= 0) {
                setFormError(`${label}: amount must be a positive number.`);
                return;
            }
        }
        // PC-26: no unlock key held for a gated tick = the network would
        // reject the send anyway; stop it here with the recovery path
        // visible instead of surfacing a compose error later.
        if (gatedInfo?.state === 'blocked') {
            setFormError(
                `${tick.trim().toUpperCase()} has token-gated content and this wallet holds none of its unlock keys. `
                + 'Recover the keys below before sending.',
            );
            return;
        }
        if (gatedMultiSendBlock) {
            setFormError(gatedMultiSendBlock);
            return;
        }
        // §21.4 / : an un-acknowledged test-send warning stops the
        // send here, not just on the disabled button. The button is the
        // visible control, but a form submits on Enter too, and the whole
        // value of this gate is that it cannot be walked past by accident.
        if (testSendGate) {
            setFormError(
                'This is your first send to this address. Send a small test first, '
                + 'or choose "I\'ve verified, continue" above.',
            );
            return;
        }
        setFormError(null);
        //  slice 1: with the flag on, sends go straight to the
        // single-encode confirm modal instead of the legacy review stage.
        //  brought hardware in with them; watcher still branches.
        if (!isWatcherMode) {
            openConfirmModal();
            return;
        }
        setStage('review');
    }

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    // §20 / G040: watcher mode skips signing + broadcast and produces an
    // unsigned PSBT for transport to a Signer-mode wallet. Read with the
    // explicit default fallback so v2 records without the field behave
    // like 'full' (the broadcast path).
    const { isWatcherMode } = useWalletMode();
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });
    const [hwStatus, setHwStatus] = useState(/** @type {string} */ ('idle'));
    const onHwStatusChange = useCallback(({ status }) => {
        setHwStatus(status);
    }, []);

    // §18.5 / Cluster N FOLLOWUP 3: risk classifier drives the explicit
    // cross-check confirm checkbox on HW signs. Re-runs whenever the
    // risk inputs change (signer, amount, recipient, settings). HW path
    // only; software signers never render the cross-check block.
    const [hwExplicitConfirmed, setHwExplicitConfirmed] = useState(false);
    const signRisk = useMemo(() => {
        if (!isHwSource) return { requireExplicitConfirm: false, reason: null };
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const nativeTicker = nativeTickerFor(desc);
        const sats = exactSatsFromDecimalString(amount);
        const isNativeSend = !!nativeTicker
            && tick.trim().toUpperCase() === nativeTicker
            && sats !== null && sats > 0;
        const amountSats = isNativeSend ? sats : 0;
        let recipientNovel = false;
        // PC-52: ANY never-seen recipient makes the send novel, not just the
        // first row. The cross-check exists so a hardware user verifies an
        // unfamiliar address on the device, and a multi-recipient send has more
        // addresses to get wrong, not fewer.
        if (desc?.coin) {
            recipientNovel = sendLegs.some((leg) => leg.to && checkRecipientNovelty({
                address: leg.to,
                chainCoin: desc.coin,
                contacts,
                historyRows,
            }).novel === true);
        }
        return classifySignRisk({
            signerKind: fromAddress?.source,
            amountSats,
            recipientNovel,
            multisig: false, // Send.jsx is single-sig; multisig flow is separate.
            settings: {
                testSendThresholdSats: Number(settings?.grace?.testSendThresholdSats) || 0,
                alwaysRequireHwExplicitConfirm: settings?.privacy?.alwaysRequireHwExplicitConfirm === true,
            },
        });
    }, [isHwSource, fromAddress?.source, chainId, tick, amount, sendLegs, contacts, historyRows, settings]);
    // Reset the confirm state whenever the requirement flips on, so a
    // user can't carry a stale "yes" through a recipient/amount change.
    // Editing ANY recipient row counts as that change (PC-52).
    useEffect(() => {
        setHwExplicitConfirmed(false);
    }, [signRisk.requireExplicitConfirm, fromAddress?.address, sendLegs, amount]);

    //  slice 1: the single-encode confirm-modal path. The modal is
    // rendered only while the pipeline is live (preflighting..rechecking);
    // on a terminal phase this component's own state takes over (done
    // screen on success, form error on failure), so the modal cleanly
    // unmounts. Phases where the modal is shown:
    const CONFIRM_MODAL_PHASES = ['preflighting', 'ready', 'signing', 'rechecking'];
    const confirmModalOpen = CONFIRM_MODAL_PHASES.includes(confirmAction.phase);

    // Open the single-encode confirm modal for a software send. compose +
    // tamper-check + pre-flight all run HOST-side (composeForConfirm /
    // preflight over messaging); Approve signs the byte-identical prebuilt
    // PSBT via sendToken.prebuiltPsbt. Resolves with sendToken's result.
    const openConfirmModal = useCallback(async () => {
        if (!chainId || !fromAddress) return;
        const from = {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
        const sendBase = {
            walletId,
            chainId,
            from,
            to: toAddress.trim(),
            tick: tick.trim(),
            amount: String(amount).trim(),
            memo: isNativeSend ? undefined : (memo.trim() || undefined),
            rbf: rbfEnabled,
            ...(feePerKb != null ? { feePerKb } : {}),
            // PC-52: `legs` supersedes to/tick/amount host-side. Sent only for a
            // real multi-recipient send so a single send composes the identical
            // v0 bytes it always has.
            ...(isMultiSend ? { legs: sendLegs } : {}),
        };
        setSubmitError(null);
        setSubmitErrorDetail(null);
        setSubmitErrorCause(null);
        try {
            const res = await confirmAction.confirm({
                chainId,
                source: from.address,
                preflightOpts: {
                    mode: resolvePreflightPrivacy(settings) === 'local' ? 'local' : 'report',
                },
                // §4.7 two-window race: reserve this amount at Approve on the
                // host-shared ledger; a concurrent window's preflight nets it.
                // The ledger lives host-side (messaging), release on any terminal.
                reservationLedger: {
                    reserve: (e) => messaging.reserve(e),
                    release: (id) => messaging.releaseReservation({ id }),
                },
                // §4.7: reserve what this send actually spends of the primary
                // token, which for a multi-recipient send is the SUM of its
                // legs, not the first row's amount. Legs on OTHER ticks are not
                // reserved: the ledger descriptor carries one tick, so a
                // multi-tick send under-reserves the secondary ticks (recorded
                // as a PC-52 residual rather than silently mis-reserving).
                reserve: {
                    tick: tick.trim(),
                    amount: sendTotals.find((t) => t.tick === tick.trim().toUpperCase())?.amount
                        || String(amount).trim(),
                },
                compose: () => messaging.composeForConfirm(sendBase),
                preflight: (o) => messaging.preflight({ chainId, ...o }),
                // §4.6: the input-liveness half of the Approve-time re-check.
                // A send left on the confirm page past a competing spend used
                // to sign a PSBT whose coins were already gone and find out at
                // broadcast, in the permanent terminal §5.3.4 forbids
                // re-signing out of.
                checkInputs: (psbtHex) => messaging.checkInputLiveness({ chainId, psbtHex }),
                // : and the native-fee half, for the sends that carry a
                // protocol fee (a gated tick composes as BATCH, and a
                // multi-recipient send is priced per leg).
                requoteNativeFee: ({ actionString, source }) => messaging.requoteNativeFee({
                    chainId, actionString, source,
                }),
                //  §5.4: Send opts into confirm persistence. It is the
                // form the popup-close hazard costs the most (most-used, and a
                // hardware prompt closes the popup by taking focus), and its
                // Approve is a bare dispatch - everything it does afterwards is
                // this screen's own display state, so finishing it from Home
                // loses nothing but the draft clear below.
                session: {
                    put: (payload) => messaging.putConfirmSession(payload),
                    clear: (id) => messaging.clearConfirmSession({ id }),
                },
                resume: {
                    software: 'sendToken',
                    hardware: 'sendAssetHw',
                    base: sendBase,
                    label: `send ${String(amount).trim()} ${tick.trim().toUpperCase()}`,
                },
                resumeRequest: sendBase,
                // : the HW route runs the SAME send flow with a remote
                // signer, so it signs the prebuilt PSBT byte-identically.
                onApprove: (_creds, composed) => {
                    const prebuiltPsbt = {
                        psbtHex: composed.psbt,
                        encoding: composed.encoding,
                        actionString: composed.actionString,
                        version: composed.version,
                        // : see useActionConfirmFlow. A multi-recipient
                        // send is past one OP_RETURN, so it takes the chunk
                        // lane and its fee rides the reveal.
                        deferredFeeOutput: composed.deferredFeeOutput || null,
                        deferredOutputs: composed.deferredOutputs || [],
                    };
                    return isHwSource
                        ? messaging.sendAssetHw({
                            ...sendBase, signerId: fromAddress.signerId, prebuiltPsbt,
                        })
                        : messaging.sendToken({
                            ...sendBase, password: passwordValueRef.current, prebuiltPsbt,
                        });
                },
            });
            setResult(res);
            setPassword('');
            draft.clear();
            setDraftPending(false);
            setStage('done');
            haptic.success();
        } catch (err) {
            // User rejection is a calm no-op: stay on the form untouched.
            if (err && (err.reason === 'user-rejected' || err.name === 'UserRejectedError')) {
                return;
            }
            // Everything else (compose/tamper failure, bad password, broadcast
            // failure) surfaces in the form's existing error banner; the modal
            // has already unmounted (terminal phase leaves CONFIRM_MODAL_PHASES).
            const rawMsg = err?.message || '';
            console.error('Send (confirm) failed:', err); // eslint-disable-line no-console
            const h = humanizeError(err, 'send');
            setFormError(h.message);
            haptic.error();
        }
    }, [
        chainId, fromAddress, walletId, toAddress, tick, amount, memo, rbfEnabled,
        feePerKb, password, settings, messaging, confirmAction, draft, haptic,
        isHwSource, isMultiSend, sendLegs, sendTotals,
    ]);

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode) {
            if (!isHwSource && !signerReady && password.length === 0) return;
            if (isHwSource && hwStatus !== 'available') return;
            // Cluster N FOLLOWUP 3: block submit if the risk classifier
            // demands an explicit cross-check confirm and the user
            // hasn't checked the box.
            if (isHwSource && signRisk.requireExplicitConfirm && !hwExplicitConfirmed) return;
        }
        setStage('submitting');
        setSubmitError(null);
        setSubmitErrorDetail(null);
        setSubmitErrorCause(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                to: toAddress.trim(),
                tick: tick.trim(),
                amount: String(amount).trim(),
                memo: isNativeSend ? undefined : (memo.trim() || undefined),
                rbf: rbfEnabled,
                ...(feePerKb != null ? { feePerKb } : {}),
                // PC-52: multi-recipient legs, on the watcher and HW paths too
                // (buildSendPsbt and the HW send handler take the same shape).
                ...(isMultiSend ? { legs: sendLegs } : {}),
            };
            // §20 / G040: watcher mode encodes only. No password, no signer,
            // no broadcast. The result envelope carries `psbtHex` instead of
            // a `txid` and the done stage branches on that to render the
            // PSBT-export UI.
            // Software path: send password; background unlocks + signs.
            // HW path: bypass password; background routes the sign
            // request through the signer-bridge RPC to the renderer-
            // hosted Trezor/Ledger signer identified by `signerId`.
            let res;
            if (isWatcherMode) {
                res = await messaging.buildSendPsbtRequest(base);
            } else if (isHwSource) {
                res = await messaging.sendAssetHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.sendToken({ ...base, password });
            }
            setResult(res);
            setPassword('');
            draft.clear();
            setDraftPending(false);
            setStage('done');
            haptic.success();
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            const rawMsg = err?.message || '';
            const isUserCancel = !isBadPassword && USER_CANCEL_RE.test(rawMsg);
            if (isUserCancel) {
                // §30.5: user-initiated cancel returns to the composing
                // form with a dismissible "Transaction cancelled." toast.
                // Form values stay intact so the user can edit and retry.
                setSubmitError(null);
                setSubmitErrorDetail(null);
                setSubmitErrorCause(null);
                setPassword('');
                setStage('form');
                showToast({ message: 'Transaction cancelled.' });
                return;
            }
            if (isBadPassword) {
                setSubmitError('Incorrect password.');
                setSubmitErrorDetail(null);
                setSubmitErrorCause(null);
            } else {
                // #2505: lead with plain-language copy; keep the raw
                // backend/SDK/RPC message for logs + a collapsible detail.
                console.error('Send failed:', err); // eslint-disable-line no-console
                const h = humanizeError(err, 'send');
                setSubmitError(h.message);
                setSubmitErrorDetail(rawMsg && rawMsg !== h.message ? rawMsg : null);
                setSubmitErrorCause(h.cause);
            }
            setStage('review');
            haptic.error();
            if (!isHwSource) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to home"
            title={stage === 'review' || stage === 'submitting' ? 'Review & Send' : 'Send'}
            titleIcon={<Icon.SendIcon />}
        />
    );

    const wrap = (children, footer = null) => (
        <Screen variant={variant} header={header}>
            {children}
            {footer}
        </Screen>
    );

    // §21.4 test-send banner. : this used to be inlined in the
    // `stage === 'review'` branch only, and  then routed every
    // non-watcher send from the compose form straight into the confirm
    // modal - so the branch stopped rendering and the warning silently
    // stopped existing for the overwhelming majority of sends. It is a
    // shared const now and renders on the COMPOSE form, which is also
    // where it belongs: the whole point is to intervene before the user
    // commits, and it is the last screen every send path passes through.
    const testSendGateBanner = testSendGate ? (
        <div role="alert" className={styles.testSendGate}>
            <p className={styles.testSendTitle}>
                First send to this address. Test it first?
            </p>
            <p className={styles.testSendBody}>
                You're sending {decimalStringFromSats(BigInt(testSendGate.amountSats))} {testSendGate.ticker} to
                a new recipient. A small test send confirms the address
                works before the full amount goes out.
            </p>
            <div className={styles.testSendActions}>
                <Button
                    type="button"
                    variant="primary"
                    onClick={onSendSmallTest}
                >
                    Send a small test first
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    onClick={() => markTested(toAddress.trim())}
                >
                    I've verified, continue
                </Button>
            </div>
        </div>
    ) : null;

    if (loadError) {
        return wrap(<div role="alert" className={styles.error}>{loadError}</div>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading…</p>);
    }

    //  confirm page, rendered in place of the form (operator
    // direction 2026-07-22: the overlay modal didn't fit small/mobile
    // viewports). All other form state stays intact behind it.
    //
    // This renders through the SHARED <ActionConfirmScreen>, not a hand-rolled
    // <ConfirmActionModal>. Send piloted the pipeline before that adapter
    // existed, and the copy it kept had quietly fallen behind: the adapter is
    // where §5.2.5's exact-fee-from-the-composed-PSBT and §5.2.3's balance
    // deltas live, so the most-used form in the wallet was showing a rate
    // ESTIMATE and no deltas while ~24 slice-2 forms showed both.
    if (confirmModalOpen) {
        return (
            <ActionConfirmScreen
                confirmAction={confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                // Fallback only: the composed PSBT's exact fee wins (§5.2.5).
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${nativeTickerFor(descriptor) || ''}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // : hardware swaps the password field for the device
                // block, and Approve additionally waits on the §18.5
                // cross-check when the risk classifier demands one. Dropping
                // that gate here would have quietly removed a control the
                // legacy review stage enforced.
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hwRequireExplicitConfirm={signRisk.requireExplicitConfirm}
                hwRequireExplicitConfirmReason={signRisk.reason}
                onHwConfirmedChange={setHwExplicitConfirmed}
                hwExplicitConfirmed={hwExplicitConfirmed}
            />
        );
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const explorerBase = desc?.explorer?.defaultUrl || '';
        // : the explorer base is bare; append the coin path segment.
        const explorerCode = explorerCoinCode(desc);
        const explorerUrl = txid && explorerBase
            ? `${explorerBase.replace(/\/$/, '')}${explorerCode ? `/${explorerCode}` : ''}/tx/${txid}`
            : null;
        const sentAmount = amount && tick ? `${amount} ${tick}` : null;
        const recipient = toAddress
            ? `${toAddress.slice(0, 8)}…${toAddress.slice(-6)}`
            : null;
        const sendAnother = () => {
            setStage('form');
            setAmount('');
            setFiatAmount('');
            setToAddress('');
            setResult(null);
            // previewResult is a derived useMemo (no setter): clearing the
            // amount/destination above already recomputes it. The old
            // setPreviewResult(null) call referenced a non-existent setter and
            // threw a ReferenceError the moment "Send another" was tapped.
        };
        const copyTxid = () => {
            if (!txid) return;
            try { navigator.clipboard?.writeText(txid); } catch { /* best effort */ }
        };

        // §20 / G040: watcher mode result. The submit returned an unsigned
        // PSBT instead of a broadcast txid; render the export UI (paste +
        // animated QR) so the user can transport it to a Signer-mode wallet.
        if (result?.psbtHex && !txid) {
            return wrap(<WatcherResultPanel result={result} onSendAnother={sendAnother} onDone={onBack} />);
        }

        // §5.3.4 TRANSIENT broadcast failure: the transaction IS signed and
        // sitting in the rebroadcast queue, so this is emphatically not an
        // error - but it is not confirmed-pending either. Say exactly that,
        // and do not offer "Send another" (re-sending the same payment while
        // a signed copy is queued is the double-broadcast trap §5.3.4 forbids).
        if (result?.queued) {
            return wrap(
                <>
                    <div className={styles.successCard} role="status" aria-live="polite">
                        <div className={styles.successIcon} aria-hidden="true">⏳</div>
                        <h2 className={styles.successTitle}>Signed. Broadcast will retry.</h2>
                        <p className={styles.successHint}>
                            Your transaction is signed but couldn&apos;t reach the network just now.
                            It&apos;s queued and will be re-broadcast automatically. You can track it
                            from the queued-transactions banner; don&apos;t send this payment again.
                        </p>
                    </div>
                    <div className={styles.actions}>
                        <Button variant="primary" onClick={onBack}>Done</Button>
                    </div>
                </>,
            );
        }

        return wrap(
            <>
                <div className={styles.successCard} role="status" aria-live="polite">
                    <div className={styles.successIcon} aria-hidden="true">✓</div>
                    <h2 className={styles.successTitle}>Broadcast pending</h2>
                    <p className={styles.successHint}>
                        Your transaction is on its way. It will confirm in the next
                        few blocks; you can leave this screen at any time.
                    </p>
                    {sentAmount || recipient ? (
                        <dl className={styles.successSummary}>
                            {sentAmount ? (
                                <div className={styles.successRow}>
                                    <dt>Amount</dt>
                                    <dd>{sentAmount}</dd>
                                </div>
                            ) : null}
                            {recipient ? (
                                <div className={styles.successRow}>
                                    <dt>To</dt>
                                    <dd className={styles.successMono}>{recipient}</dd>
                                </div>
                            ) : null}
                            {desc ? (
                                <div className={styles.successRow}>
                                    <dt>Chain</dt>
                                    <dd>{desc.displayName}</dd>
                                </div>
                            ) : null}
                        </dl>
                    ) : null}
                    {txid ? (
                        <div className={styles.successTxidBlock}>
                            <p className={styles.successLabel}>Transaction ID</p>
                            <div className={styles.successTxidRow}>
                                <code className={styles.txid}>{txid}</code>
                                <button
                                    type="button"
                                    className={styles.successLink}
                                    onClick={copyTxid}
                                    aria-label="Copy transaction id"
                                >
                                    Copy
                                </button>
                            </div>
                            {explorerUrl ? (
                                <a
                                    className={styles.successLink}
                                    href={explorerUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    View on explorer ↗
                                </a>
                            ) : null}
                        </div>
                    ) : null}
                </div>
                <div className={styles.actions}>
                    <Button variant="secondary" onClick={sendAnother}>
                        Send another
                    </Button>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form id="send-review-form" onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>{decoded?.summary}</p>
                <BalanceChanges
                    result={previewResult}
                    loading={previewBalances.loading}
                    error={previewBalances.error}
                />
                {multiTickPreviewGap ? (
                    <StatusMessage variant="status">
                        This send moves more than one token, and the balance preview
                        covers a single token at a time. Every recipient and amount is
                        listed under Details below.
                    </StatusMessage>
                ) : null}
                <details className={styles.details}>
                    <summary className={styles.detailsToggle}>
                        Details ({2 + (decoded?.details?.length || 0)})
                    </summary>
                    <dl className={styles.detailsList}>
                        <dt className={styles.detailsLabel}>Chain</dt>
                        <dd className={styles.detailsValue}>
                            {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                        </dd>
                        <dt className={styles.detailsLabel}>From</dt>
                        <dd className={styles.detailsValue}>
                            <AddressText address={fromAddress.address} highlight />
                        </dd>
                        {(decoded?.details || []).map((d) => (
                            <DetailRow
                                key={d.label}
                                label={d.label}
                                value={
                                    d.label === 'Destination' && typeof d.value === 'string'
                                        ? <AddressText address={d.value} highlight />
                                        : d.value
                                }
                            />
                        ))}
                    </dl>
                </details>
                {decoded && decoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decoded.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                {testSendGateBanner}
                <RawPsbtViewer
                    developerMode={developerMode}
                    actionFields={isMultiSend ? {
                        action: 'SEND',
                        // Mirrors the LEGS shape the host sends to the SDK, so
                        // developer mode shows the action that is actually
                        // composed rather than a one-recipient stand-in.
                        LEGS: sendLegs.map((leg) => `${leg.amount} ${leg.tick.toUpperCase()} -> ${leg.to}`).join(' | '),
                        ...(memo.trim() ? { MEMO: memo.trim() } : {}),
                    } : {
                        action: 'SEND',
                        TICK: tick.trim(),
                        AMOUNT: String(amount).trim(),
                        DESTINATION: toAddress.trim(),
                        ...(memo.trim() ? { MEMO: memo.trim() } : {}),
                    }}
                />
                {isWatcherMode ? (
                    <>
                        <p className={styles.hint}>
                            Watcher mode: this wallet will build an unsigned transaction
                            instead of signing and broadcasting. Bring the result
                            to your Signer-mode wallet to sign.
                        </p>
                        {isHwSource ? (
                            <StatusMessage variant="status">
                                Source address is paired to {fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'} on
                                this wallet, but watcher mode does not sign here.
                                Pair the same {fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'} on your
                                Signer-mode wallet to sign the transaction this step produces.
                            </StatusMessage>
                        ) : null}
                    </>
                ) : isHwSource ? (
                    <HwSignBlock
                        signerKind={fromAddress.source}
                        signerName={fromAddress.signerLabel || (fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger')}
                        path={fromAddress.derivationPath || ''}
                        address={fromAddress.address}
                        chainId={chainId}
                        getStatus={(opts) => messaging.getSignerStatus({
                            signerId: fromAddress.signerId,
                            chainId: opts?.chainId ?? chainId,
                        })}
                        onStatusChange={onHwStatusChange}
                        signerInfo={hwSignerInfo}
                        requireExplicitConfirm={signRisk.requireExplicitConfirm}
                        requireExplicitConfirmReason={signRisk.reason}
                        onConfirmedChange={setHwExplicitConfirmed}
                    />
                ) : signerReady ? (
                    // : "Wallet unlocked. No password needed." is a claim
                    // about this wallet's ability to sign, and panic mode makes
                    // it false. SigningReadyNote keeps the note when signing is
                    // allowed, swaps in the freeze when the user armed it
                    // themselves, and renders nothing when it was duress-armed.
                    <SigningReadyNote>
                        <p
                            style={{
                                margin: 'var(--xc-space-2) 0 0',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--xc-space-1)',
                                fontSize: 'var(--xc-text-sm)',
                                color: 'var(--xc-text-muted)',
                            }}
                        >
                            <span aria-hidden="true">🔓</span> Wallet unlocked. No password needed.
                        </p>
                    </SigningReadyNote>
                ) : (
                    <Input
                        ref={passwordRef}
                        type="password"
                        label="Password"
                        hint="Required to sign."
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            if (submitError) { setSubmitError(null); setSubmitErrorDetail(null); setSubmitErrorCause(null); }
                        }}
                        autoComplete="current-password"
                        disabled={stage === 'submitting'}
                        error={submitError || undefined}
                    />
                )}
                {/*
                  * The password Input (the branch above, shown only when the
                  * wallet is LOCKED) carries submitError on its `error` prop.
                  * Every other path needs this banner -- including the unlocked
                  * software path, which previously had no error surface at all,
                  * so a failed send simply vanished .
                  */}
                {submitError && (isWatcherMode || isHwSource || signerReady) ? (
                    <StatusMessage
                        variant="error"
                        recovery={
                            submitErrorCause === 'insufficient_funds' && sourceBalance && parseFloat(sourceBalance.amount || '0') > 0
                                ? { label: 'Use Max', onAction: () => { setStage('form'); onMax(); } }
                                : undefined
                        }
                    >
                        {submitError}
                        {submitErrorDetail ? (
                            <details style={{ marginTop: 'var(--xc-space-1)' }}>
                                <summary style={{ cursor: 'pointer', fontSize: 'var(--xc-text-sm)', opacity: 0.85 }}>
                                    Technical details
                                </summary>
                                <span style={{ fontSize: 'var(--xc-text-sm)', wordBreak: 'break-word' }}>
                                    {submitErrorDetail}
                                </span>
                            </details>
                        ) : null}
                    </StatusMessage>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={
                            !!testSendGate
                            || (isWatcherMode
                                ? false
                                : isHwSource
                                    ? (hwStatus !== 'available'
                                        || (signRisk.requireExplicitConfirm && !hwExplicitConfirmed))
                                    : (!signerReady && password.length === 0))
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : descriptor?.displayName
                                    ? `Sign on ${descriptor.displayName}`
                                    : 'Sign'}
                    </Button>
                </div>
            </form>,
        );
    }

    //  source picker, the same OwnAddressPickerScreen every other action
    // form routes its From field to. Rendered in place of the form; all other
    // form state stays intact behind it.
    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From address"
                walletId={walletId}
                chainId={chainId}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setPickedSourceChain(chainId);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // Contacts picker: rendered in place of the form when the user taps the
    // contacts icon in the To field. Selecting a row fills the To field and
    // returns to the form with all other state intact.
    if (contactsPickerOpen) {
        return (
            <ContactsPickerScreen
                contacts={contacts}
                variant={variant}
                onPick={handlePickContact}
                onBack={() => setContactsPickerOpen(false)}
            />
        );
    }

    // stage === 'form'
    const draftBanner = draft.hasDraft() && !draftPending ? (
        <StatusMessage
            variant="status"
            recovery={{ label: 'Restore', onAction: restoreDraft }}
        >
            You have an unfinished Send draft.
            <button
                type="button"
                onClick={dismissDraft}
                aria-label="Discard saved draft"
                style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: 0,
                    marginInlineStart: 'var(--xc-space-2)',
                    fontSize: 'var(--xc-text-xs)',
                }}
            >
                Discard
            </button>
        </StatusMessage>
    ) : null;
    const hasTokenSelected = !!chainId && !!tick.trim();
    return wrap(
        <form id="send-form" onSubmit={handleReview} noValidate>
            {/*
              * : state the signing freeze at the TOP of the form, before
              * the user picks a destination and an amount. The refusal used to
              * arrive only on Approve & Sign, by which point a duress observer
              * has already watched the whole transaction get composed.
              * Duress-armed freezes render nothing here, by design.
              */}
            <PanicFreezeNotice surface="send" />
            {draftBanner}
            <SelectedTokenHero
                chainId={chainId}
                tick={tick}
                descriptor={descriptor}
                prefill={prefill}
                onChangeAsset={onChangeAsset ? () => onChangeAsset({ address: toAddress, amount }) : undefined}
            />
            {/*
              * : the funding address, shown and changeable.
              *
              * Send resolves its source to the chain's ACTIVE address and used to
              * neither render it nor offer to change it, while the other 26 action
              * forms all carry this field. That made the two halves of the screen
              * disagree silently: the asset picker is WALLET-scoped and offers every
              * token the wallet holds anywhere, but the funding is ADDRESS-scoped, so
              * a token held on a non-active address could be selected, priced and
              * composed, and the failure came back as the encoder's "no spendable
              * UTXOs found for the funding address" - a sentence about UTXOs, from
              * which the fix (switch address) is not discoverable.
              *
              * Rendering it also puts the balance line underneath in context: the
              * "available" figure has always been this address's balance, not the
              * wallet's.
              */}
            {fromAddress ? (
                <AddressField
                    label="From"
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel="Choose source address"
                    hint="Only what this address holds can be sent."
                />
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}
            <AddressCombobox
                size="lg"
                icon="contacts"
                label={matchedContact
                    ? <>To <span className={styles.toContactName}>{matchedContact.contact.name}</span></>
                    : 'To'}
                value={toAddress}
                onChange={(e) => {
                    setToAddress(e.target.value);
                    if (toError) setToError(null);
                    if (pasteHint) setPasteHint(null);
                    if (pasteWarning) setPasteWarning(null);
                }}
                onPaste={onAddressPaste}
                suggestions={suggestions}
                hint={pasteHint || undefined}
                onIconClick={() => setContactsPickerOpen(true)}
                placeholder="Enter or paste an address or name..."
                error={toError || undefined}
            />
            {pasteWarning ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>{pasteWarning}</p>
                </div>
            ) : null}
            {lookalikeWarning ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>{lookalikeWarning}</p>
                </div>
            ) : null}
            {onChangeAsset ? (
                <TokenField
                    label="Token"
                    value={hasTokenSelected ? { chainId, tick: tick.trim().toUpperCase() } : null}
                    onOpenPicker={() => onChangeAsset({ address: toAddress, amount })}
                />
            ) : (
                <Input
                    label="Token"
                    hint="Tick. Native coin by default."
                    value={tick}
                    onChange={(e) => setTick(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                />
            )}
            <AmountField
                size="lg"
                amount={amount}
                fiatAmount={fiatAmount}
                tick={tick}
                fiatRate={amountFiatRate}
                fiatCurrency={fiatCurrency}
                amountInputMode={amountInputMode}
                onAmountFieldChange={onAmountFieldChange}
                toggleAmountInputMode={toggleAmountInputMode}
                inputRef={amountInputRef}
                onMax={onMax}
                maxDisabled={!sourceBalance}
                balanceText={
                    previewBalances.loading
                        ? 'Loading…'
                        : previewBalances.error
                            ? `Balance unavailable (${previewBalances.error})`
                            : sourceBalance
                                ? `${formatWithThousands(sourceBalance.amount)} ${sourceBalance.tick} available`
                                : `0 ${(tick.trim().toUpperCase()) || ''} available`.replace(/\s+/g, ' ').trim()
                }
            />
            {/* PC-52: extra recipients. Each row is another leg of the SAME
                transaction (SEND v1, or v2 when the rows carry their own
                token), so the recipients share one network fee instead of
                paying one each. Native coin is excluded: it moves value in a
                real output, which has no multi-leg action form. */}
            {extraLegs.length > 0 ? (
                <div className={styles.recipientRows}>
                    {extraLegs.map((leg, i) => (
                        <div key={leg.id} className={styles.recipientRow}>
                            <div className={styles.recipientRowHead}>
                                <span className={styles.recipientRowLabel}>Recipient {i + 2}</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => removeRecipient(leg.id)}
                                    aria-label={`Remove recipient ${i + 2}`}
                                >
                                    Remove
                                </Button>
                            </div>
                            {/* The visible labels stay "To" / "Token" / "Amount"
                                to read like the fields above, but each carries
                                a row-qualified accessible name: without it a
                                screen reader announces three identical "To"
                                fields with no way to tell which recipient is
                                being edited. */}
                            <AddressCombobox
                                label="To"
                                aria-label={`Recipient ${i + 2} address`}
                                value={leg.to}
                                onChange={(e) => updateRecipient(leg.id, { to: e.target.value })}
                                suggestions={suggestions}
                                placeholder="Enter or paste an address or name..."
                                error={leg.to.trim() && destinationAddressError(leg.to, descriptor)
                                    ? destinationAddressError(leg.to, descriptor)
                                    : undefined}
                            />
                            {perRecipientToken ? (
                                <Input
                                    label="Token"
                                    aria-label={`Recipient ${i + 2} token`}
                                    hint="Tick. Leave as the token above to send the same one."
                                    value={leg.tick}
                                    onChange={(e) => updateRecipient(leg.id, { tick: e.target.value })}
                                    autoComplete="off"
                                    autoCapitalize="characters"
                                />
                            ) : null}
                            <Input
                                label="Amount"
                                aria-label={`Recipient ${i + 2} amount`}
                                inputMode="decimal"
                                value={leg.amount}
                                onChange={(e) => updateRecipient(leg.id, { amount: e.target.value })}
                                autoComplete="off"
                            />
                        </div>
                    ))}
                    <label className={styles.rbfRow}>
                        <span className={styles.rbfLabel}>
                            <span>Different token per recipient</span>
                            <span className={styles.rbfHint}>
                                Off: every recipient gets {tick.trim().toUpperCase() || 'the token above'}.
                            </span>
                        </span>
                        <input
                            type="checkbox"
                            role="switch"
                            aria-label="Different token per recipient"
                            checked={perRecipientToken}
                            onChange={(e) => setPerRecipientToken(e.target.checked)}
                        />
                    </label>
                    {sendTotals.length > 0 && !nativeMultiSendBlock ? (
                        <p className={styles.hint}>
                            Total: {sendTotals.map((t) => `${formatWithThousands(t.amount)} ${t.tick}`).join(' + ')}
                            {' '}across {sendLegs.length} recipients, in one transaction and one network fee.
                        </p>
                    ) : null}
                </div>
            ) : null}
            {sourceLacksTick ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>{sourceLacksTick}</p>
                </div>
            ) : null}
            {/* : say it while the amount field still has focus, not only on Send.
                Suppressed once Send has already pushed the same sentence into formError,
                so the user is not shown it twice. */}
            {dustBlock && formError !== dustBlock ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>{dustBlock}</p>
                </div>
            ) : null}
            {nativeMultiSendBlock ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>{nativeMultiSendBlock}</p>
                </div>
            ) : null}
            {gatedMultiSendBlock ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>{gatedMultiSendBlock}</p>
                </div>
            ) : null}
            {/* Hidden for a native send (no multi-leg form exists) and at the
                cap, where another row could not be composed anyway. */}
            {!isNativeSend && extraLegs.length + 1 < MAX_SEND_LEGS ? (
                <Button
                    type="button"
                    variant="secondary"
                    onClick={addRecipient}
                >
                    + Add recipient
                </Button>
            ) : null}
            {extraLegs.length + 1 >= MAX_SEND_LEGS ? (
                <p className={styles.hint}>
                    {MAX_SEND_LEGS} recipients is the most one send carries. Use an
                    airdrop to distribute to a longer list.
                </p>
            ) : null}
            {gatedInfo && gatedInfo.state === 'ready' ? (
                <StatusMessage variant="status">
                    This token has gated content. The unlock key will be securely attached
                    to this send so the recipient can open it. Gated tokens can only be sent
                    to addresses that have made at least one transaction.
                </StatusMessage>
            ) : null}
            {gatedInfo && gatedInfo.state === 'partial' ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        This token has {gatedInfo.groups.length} gated content packs and this wallet
                        holds keys for only {gatedInfo.groups.filter((g) => g.haveKey).length} of them.
                        The recipient will NOT be able to open the missing pack(s):{' '}
                        {gatedInfo.groups.filter((g) => !g.haveKey).map((g) => g.keyHash.slice(0, 12)).join(', ')}…
                        You can still send, or recover the missing keys first (unlock the content
                        once from the address that received it).
                    </p>
                </div>
            ) : null}
            {gatedInfo && gatedInfo.state === 'blocked' ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        This token has gated content, and this wallet holds none of its unlock
                        keys. Sending without the key attached would be rejected by the network,
                        and the recipient could never open the content.
                    </p>
                    {(isWatcherMode || isHwSource) ? (
                        <p className={styles.warning}>
                            Key recovery needs a software signer (the scan decrypts messages with
                            the address&apos;s private key, which this signer cannot do). If this
                            wallet published the content, the key is already stored and this
                            notice will not appear; otherwise recover the key from a software
                            wallet holding this address.
                        </p>
                    ) : (
                        <div style={{ marginTop: 'var(--xc-space-2)' }}>
                            <Input
                                type="password"
                                label="Wallet password (scan for keys)"
                                hint="Scans messages sent to your addresses for the unlock key and stores it in this wallet."
                                value={gatedScanPassword}
                                onChange={(e) => {
                                    setGatedScanPassword(e.target.value);
                                    if (gatedScanError) setGatedScanError(null);
                                }}
                                autoComplete="current-password"
                            />
                            {gatedScanError ? (
                                <p role="alert" className={styles.warning}>{gatedScanError}</p>
                            ) : null}
                            <Button
                                type="button"
                                variant="secondary"
                                loading={gatedScanBusy}
                                disabled={gatedScanBusy || gatedScanPassword.length === 0}
                                onClick={handleGatedScan}
                            >
                                Recover keys
                            </Button>
                        </div>
                    )}
                </div>
            ) : null}
            {feeTiers ? (
                <FeeSelector
                    label="Network fee"
                    coinTicker={nativeTickerFor(descriptor)}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feePick.mode === 'custom' ? feeEstimate : null}
                    formatFiat={(coinAmount) => {
                        if (!fiatRate || !coinAmount) return null;
                        const v = coinToFiat(String(coinAmount), fiatRate);
                        if (v == null || !Number.isFinite(v)) return null;
                        return `≈ ${v.toFixed(2)} ${fiatRate.fiatCurrency || ''}`.trim();
                    }}
                />
            ) : null}
            <details
                className={styles.details}
                style={{ marginTop: 'var(--xc-space-6)' }}
            >
                <summary className={styles.detailsToggle}>Advanced</summary>
                {/* : no memo on a native-coin send. It only ever existed
                    as a field of an XChain SEND action, and the chain rejects
                    that action outright for a native tick (there is no BTC
                    ledger), so the memo was never recorded or queryable - it
                    was an input that silently did nothing. A native send is now
                    a plain payment with no action at all, so there is nowhere
                    left to put one. Token sends keep it. */}
                {isNativeSend ? null : (
                    <Input
                        label="Memo"
                        value={memo}
                        onChange={(e) => setMemo(e.target.value)}
                        autoComplete="off"
                        error={/[|;]/.test(memo) ? 'Cannot contain | or ; characters.' : undefined}
                    />
                )}
                {/* §44.3 per-send RBF toggle. Default seeds from
                    settings.fees[chainId].rbfByDefault (see the effect
                    above); the live value flows into the send payload as
                    `rbf: rbfEnabled`. */}
                <label className={styles.rbfRow}>
                    <span className={styles.rbfLabel}>
                        <span>
                            Replace-by-fee
                            <InfoTip
                                aria="Replace-by-fee help"
                                label="Replace-by-fee (BIP125) lets you re-broadcast this transaction later at a higher fee, speeding up or cancelling it before it confirms."
                            />
                        </span>
                        <span className={styles.rbfHint}>
                            Keep this on to allow speeding up or cancelling the transaction before it confirms.
                        </span>
                    </span>
                    <input
                        type="checkbox"
                        role="switch"
                        aria-label="Replace-by-fee enabled"
                        checked={rbfEnabled}
                        onChange={(e) => setRbfEnabled(e.target.checked)}
                    />
                </label>
            </details>
            {testSendGateBanner}
            {formError ? (
                <StatusMessage
                    variant="error"
                    recovery={
                        /amount/i.test(formError) && sourceBalance && parseFloat(sourceBalance.amount || '0') > 0
                            ? { label: 'Use Max', onAction: onMax }
                            : undefined
                    }
                >
                    {formError}
                </StatusMessage>
            ) : null}
        </form>,
        <div className={`${styles.actionsBar} ${isFull ? styles.actionsBarFull : ''}`.trim()}>
            <Button
                type="submit"
                form="send-form"
                variant="primary"
                block
                disabled={!!testSendGate}
            >
                Send
            </Button>
        </div>,
    );
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}

// Hero badge for the asset being sent. Native = large chain icon.
// Token with imageUrl = square image + chain-icon overlay. Token without
// imageUrl = letter badge tinted by `tickerColor` + chain-icon overlay.
// The prefill's imageUrl only applies when the form's current
// (chainId, tick) still matches what the user picked; if they retype
// the tick to something else, fall back to the letter-badge style.
function SelectedTokenHero({ chainId, tick, descriptor, prefill, onChangeAsset }) {
    const tickTrim = (tick || '').trim();
    if (!chainId || !tickTrim) return null;
    const nativeTicker = nativeTickerFor(descriptor);
    const isNative = !!nativeTicker && tickTrim.toUpperCase() === nativeTicker;
    const chainIconUrl = branding.chainIconSmallUrl(chainId);
    const chainIconLarge = branding.chainIconLargeUrl(chainId);
    const prefillMatches = prefill
        && prefill.chainId === chainId
        && (prefill.tick || '').trim().toUpperCase() === tickTrim.toUpperCase();
    const imageUrl = prefillMatches && typeof prefill?.imageUrl === 'string' && prefill.imageUrl
        ? prefill.imageUrl
        : null;
    const heroName = prefillMatches && typeof prefill?.displayName === 'string' && prefill.displayName
        ? prefill.displayName
        : (isNative ? (descriptor?.displayName || tickTrim) : tickTrim);
    const interactive = typeof onChangeAsset === 'function';
    const IconTag = interactive ? 'button' : 'div';
    const iconProps = interactive
        ? {
            type: 'button',
            onClick: onChangeAsset,
            'aria-label': `Change asset (currently ${heroName})`,
            className: `${styles.heroIconWrap} ${styles.heroIconWrapInteractive}`,
        }
        : { className: styles.heroIconWrap, 'aria-hidden': 'true' };
    return (
        <div className={styles.heroWrap}>
            <IconTag {...iconProps}>
                {isNative && chainIconLarge ? (
                    <img
                        src={chainIconLarge}
                        alt=""
                        className={styles.heroIconImg}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                ) : imageUrl ? (
                    <img
                        src={imageUrl}
                        alt=""
                        className={styles.heroIconImg}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                ) : (
                    <span
                        className={styles.heroIconLetter}
                        style={{ background: tickerColor(tickTrim), color: '#FFFFFF' }}
                    >
                        {tickTrim.slice(0, 1).toUpperCase()}
                    </span>
                )}
                {!isNative && chainIconUrl ? (
                    <img
                        src={chainIconUrl}
                        alt=""
                        className={styles.heroChainOverlay}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                ) : null}
            </IconTag>
            {heroName ? (
                <div className={styles.heroName} title={heroName}>{heroName}</div>
            ) : null}
        </div>
    );
}

