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
import { tickerColor } from '../components/BalanceList.jsx';
import { NetworkFilterDropdown } from '../components/NetworkFilterDropdown.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { buildRecentDestinations } from '../../flows/recentDestinations.js';
import { detectAddressCoin, isValidAddressForChain } from '../utils/addressValidation.js';
import { findLookalike } from '../utils/lookalike.js';
import { checkPasteIntegrity } from '../utils/pasteIntegrity.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useDeveloperMode } from '../hooks/useDeveloperMode.js';
import { useSettings } from '../hooks/useSettings.js';
import { checkRecipientNovelty } from '../../flows/recipientNovelty.js';
import { classifySignRisk } from '../../flows/signRiskClassifier.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    fetchNativeSendFeeTiers,
    customFeeEstimate,
    settingsCustomToDisplayRate,
} from '../../flows/feeEstimate.js';
import { getFiatRate, coinToFiat, fiatToCoin } from '../../flows/priceLookup.js';
import { HwSignBlock } from '../components/HwSignBlock.jsx';
import { BalanceChanges } from '../components/BalanceChanges.jsx';
import { RawPsbtViewer } from '../components/RawPsbtViewer.jsx';
import { useToast } from '../components/ToastHost.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { useHaptic } from '../hooks/useHaptic.js';
import { useFormDraft } from '../hooks/useFormDraft.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import {
    formatWithThousands,
    countNonCommaBefore,
    indexAfterNonCommaCount,
} from '../utils/amountFormat.js';
import styles from './Send.module.css';

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
    // Active (operating) address per chain; Send defaults its from-address to
    // this so a send always spends from the chain's active address.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, { id: string, address: string }>} */ ({}),
    );
    const [toAddress, setToAddress] = useState(prefill?.address || '');
    const [tick, setTick] = useState(prefill?.tick || '');
    const [amount, setAmount] = useState(prefill?.amount || '');
    const [memo, setMemo] = useState(prefill?.memo || '');
    const [amountInputMode, setAmountInputMode] = useState(
        /** @type {'coin' | 'fiat'} */ ('coin'),
    );
    const [fiatAmount, setFiatAmount] = useState('');
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    // Inline error on the To field, e.g. a wrong-chain destination address.
    const [toError, setToError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
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
    // Address-book picker filters: free-text search + network ('all' | coin).
    const [pickerQuery, setPickerQuery] = useState('');
    const [pickerNetwork, setPickerNetwork] = useState('all');

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

    // All saved addresses across every contact, flattened and filtered by the
    // picker's network dropdown + search box. Unlike chainContacts (current
    // chain only), this spans all networks so the user can search/filter freely.
    const pickerRows = useMemo(() => {
        const q = pickerQuery.trim().toLowerCase();
        const out = [];
        for (const c of contacts) {
            for (const e of c?.entries || []) {
                if (!e?.address) continue;
                if (pickerNetwork !== 'all' && e.chain !== pickerNetwork) continue;
                if (q) {
                    const hay = `${c?.name || ''} ${e.address} ${e.label || ''}`.toLowerCase();
                    if (!hay.includes(q)) continue;
                }
                out.push({ contact: c, entry: e });
            }
        }
        return out;
    }, [contacts, pickerQuery, pickerNetwork]);


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
                setTick(tickParam.toUpperCase());
            }
            if (parts.message) setMemo(parts.message);
            setPasteHint(`Filled from ${detected.scheme}: URI`);
        } else if (detected.type === 'xchain-uri') {
            e.preventDefault();
            // Route through the richer parser so the new coin-code form
            // (xchain:TBTC/send?to=…) yields intent.address rather than the
            // raw "TBTC/send" that the BIP21 fallback would surface.
            const intent = uriLib.parseXchainUri(trimmed, { chainRegistry });
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
        const amt = parseFloat(String(amount).trim());
        if (!Number.isFinite(amt) || amt <= 0) return null;
        const amountSats = Math.floor(amt * 1e8);
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
    // Marked as static placeholder until §45 wires the real oracle.
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    const fiatRate = useMemo(() => {
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const coin = desc?.coin;
        if (!coin) return null;
        return getFiatRate({ chainCoin: coin, fiatCurrency });
    }, [chainId, fiatCurrency]);

    const isNativeSend = useMemo(() => {
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const nativeTicker = nativeTickerFor(desc);
        return Boolean(nativeTicker && tick.trim().toUpperCase() === nativeTicker);
    }, [chainId, tick]);

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
            if (!fiatRate) {
                if (stripped === '') setAmount('');
            } else {
                const derivedCoin = fiatToCoin(stripped, fiatRate);
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
    }, [amountInputMode, fiatRate]);

    const toggleAmountInputMode = useCallback(() => {
        if (!fiatRate) return;
        setAmountInputMode((prev) => {
            if (prev === 'coin') {
                const fv = amount ? coinToFiat(amount, fiatRate) : null;
                setFiatAmount(fv != null ? fv.toFixed(2) : '');
                return 'fiat';
            }
            // fiat -> coin: keep canonical amount, clear typed fiat
            setFiatAmount('');
            return 'coin';
        });
    }, [amount, fiatRate]);

    const onSendSmallTest = useCallback(() => {
        const amt = parseFloat(String(amount).trim());
        if (!Number.isFinite(amt) || amt <= 0) return;
        // 1% of the original, with a floor of one sat-equivalent so
        // tiny sends don't round to zero.
        const reduced = Math.max(amt * 0.01, 1e-8);
        // Round to 8 decimals (BTC/LTC/DOGE precision) and strip
        // trailing zeros for a tidy display.
        const display = Number(reduced.toFixed(8)).toString();
        setAmount(display);
        setStage('form');
    }, [amount]);

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
        // Prefer the chain's active (operating) address; fall back to the
        // newest HD external address when no active address is resolvable.
        const activeId = activeByChain[chainId]?.id;
        if (activeId && all.some((a) => a.id === activeId)) {
            setFromAddressId(activeId);
        } else {
            const addrs = all.filter(
                (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
            );
            if (addrs.length > 0) {
                const sorted = [...addrs].sort((a, b) => {
                    const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                    const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                    return bi - ai;
                });
                setFromAddressId(sorted[0].id);
            } else {
                setFromAddressId(null);
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
    }, [chainId, addressesByChain, activeByChain]);

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
    }, [stage, tick, amount, toAddress, memo, chainId]);

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

    const onMax = useCallback(() => {
        if (!sourceBalance || !sourceBalance.amount) return;
        const balanceNum = parseFloat(sourceBalance.amount);
        if (!Number.isFinite(balanceNum) || balanceNum <= 0) return;
        let maxAmount = balanceNum;
        if (isNativeSend && feeEstimate) {
            const feeNum = parseFloat(feeEstimate.coinAmount);
            if (Number.isFinite(feeNum)) maxAmount = Math.max(0, balanceNum - feeNum);
        }
        const display = Number(maxAmount.toFixed(8)).toString();
        setAmount(display);
        if (amountInputMode === 'fiat' && fiatRate) {
            const fv = coinToFiat(display, fiatRate);
            setFiatAmount(fv != null ? fv.toFixed(2) : '');
        }
    }, [sourceBalance, isNativeSend, feeEstimate, amountInputMode, fiatRate]);

    const previewResult = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        if (previewBalances.loading || previewBalances.error || !previewBalances.sdkShape) {
            return null;
        }
        const feeStr = feeEstimate?.coinAmount || '0';
        return decoderLib.simulateAction({
            action: 'SEND',
            params: {
                TICK: tick.trim(),
                AMOUNT: String(amount).trim(),
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
    }, [stage, tick, amount, toAddress, memo, chainId, previewBalances, feeEstimate]);

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
        if (/[|;]/.test(memo)) {
            setFormError('Memo cannot contain | or ; characters.');
            return;
        }
        setFormError(null);
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
        const amt = parseFloat(String(amount).trim());
        const isNativeSend = !!nativeTicker
            && tick.trim().toUpperCase() === nativeTicker
            && Number.isFinite(amt) && amt > 0;
        const amountSats = isNativeSend ? Math.floor(amt * 1e8) : 0;
        let recipientNovel = false;
        if (toAddress.trim() && desc?.coin) {
            const novelty = checkRecipientNovelty({
                address: toAddress.trim(),
                chainCoin: desc.coin,
                contacts,
                historyRows,
            });
            recipientNovel = novelty.novel === true;
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
    }, [isHwSource, fromAddress?.source, chainId, tick, amount, toAddress, contacts, historyRows, settings]);
    // Reset the confirm state whenever the requirement flips on, so a
    // user can't carry a stale "yes" through a recipient/amount change.
    useEffect(() => {
        setHwExplicitConfirmed(false);
    }, [signRisk.requireExplicitConfirm, fromAddress?.address, toAddress, amount]);

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
                memo: memo.trim() || undefined,
                rbf: rbfEnabled,
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
                setPassword('');
                setStage('form');
                showToast({ message: 'Transaction cancelled.' });
                return;
            }
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : rawMsg || 'Send failed.',
            );
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
            <div className={`${styles.card} ${isFull ? styles.cardFull : styles.cardSmall}`}>
                {children}
            </div>
            {footer}
        </Screen>
    );

    if (loadError) {
        return wrap(<div role="alert" className={styles.error}>{loadError}</div>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading…</p>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const explorerBase = desc?.explorer?.defaultUrl || '';
        const explorerUrl = txid && explorerBase
            ? `${explorerBase.replace(/\/$/, '')}/tx/${txid}`
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
            setPreviewResult(null);
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
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>{decoded?.summary}</p>
                <BalanceChanges
                    result={previewResult}
                    loading={previewBalances.loading}
                    error={previewBalances.error}
                />
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
                {testSendGate ? (
                    <div role="alert" className={styles.testSendGate}>
                        <p className={styles.testSendTitle}>
                            First send to this address. Test it first?
                        </p>
                        <p className={styles.testSendBody}>
                            You're sending {(testSendGate.amountSats / 1e8).toFixed(8)} {nativeTickerFor(descriptor)}
                            to a new recipient. A small test send confirms the address
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
                ) : null}
                <RawPsbtViewer
                    developerMode={developerMode}
                    actionFields={{
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
                ) : (
                    <Input
                        ref={passwordRef}
                        type="password"
                        label="Password"
                        hint="Required to sign."
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            if (submitError) setSubmitError(null);
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
                            /insufficient|not enough/i.test(submitError) && sourceBalance && parseFloat(sourceBalance.amount || '0') > 0
                                ? { label: 'Use Max', onAction: () => { setStage('form'); onMax(); } }
                                : undefined
                        }
                    >
                        {submitError}
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

    // Contacts picker: rendered in place of the form when the user taps the
    // contacts icon in the To field. Shows saved contact addresses across all
    // networks with a 50/50 search + network-filter toolbar. Selecting a row
    // fills the To field and returns to the form with all other state intact.
    if (contactsPickerOpen) {
        const pickerHeader = (
            <PageHeader
                onBack={() => setContactsPickerOpen(false)}
                title="Contacts"
                titleIcon={<Icon.UsersIcon />}
            />
        );
        const hasAnyAddress = contacts.some((c) => (c?.entries || []).some((e) => e?.address));
        // Truly-empty path: no saved addresses at all. Render a single calm
        // card so the page doesn't show a card-inside-a-card.
        if (!hasAnyAddress) {
            return (
                <Screen variant={variant} header={pickerHeader}>
                    <div
                        className={isFull ? styles.cardFull : styles.cardSmall}
                        style={{
                            padding: 'var(--xc-space-6)',
                            background: 'var(--xc-surface)',
                            border: '1px solid var(--xc-border)',
                            borderRadius: 'var(--xc-radius-lg)',
                            textAlign: 'center',
                            fontSize: 'var(--xc-text-md)',
                            fontWeight: 600,
                            color: 'var(--xc-text)',
                        }}
                    >
                        You have no contacts yet
                    </div>
                </Screen>
            );
        }
        return (
            <Screen variant={variant} header={pickerHeader}>
                <div className={styles.abToolbar}>
                    <input
                        type="text"
                        className={styles.abSearch}
                        placeholder="Search"
                        value={pickerQuery}
                        onChange={(e) => setPickerQuery(e.target.value)}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        aria-label="Search contacts"
                    />
                    <NetworkFilterDropdown value={pickerNetwork} onChange={setPickerNetwork} />
                </div>
                {pickerRows.length === 0 ? (
                    <div className={styles.abEmpty}>No addresses match your filters.</div>
                ) : (
                    <ul className={styles.abList}>
                        {pickerRows.map(({ contact, entry }) => (
                            <li key={`${contact.id}:${entry.address}`}>
                                <button
                                    type="button"
                                    className={styles.abRow}
                                    onClick={() => handlePickContact(entry)}
                                >
                                    <span className={styles.abName}>{contact.name}</span>
                                    <span className={styles.abAddr} title={entry.address}>{entry.address}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </Screen>
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
            {draftBanner}
            <SelectedTokenHero
                chainId={chainId}
                tick={tick}
                descriptor={descriptor}
                prefill={prefill}
                onChangeAsset={onChangeAsset ? () => onChangeAsset({ address: toAddress, amount }) : undefined}
            />
            <div className={`${styles.toFieldWrap} ${styles.bigField}`}>
                <AddressCombobox
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
                    placeholder="Enter or paste an address or name..."
                    hint={pasteHint || undefined}
                    error={toError || undefined}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    style={{
                        fontSize: 'var(--xc-text-lg)',
                        paddingTop: 'var(--xc-space-3)',
                        paddingBottom: 'var(--xc-space-3)',
                        paddingLeft: 'var(--xc-space-4)',
                        paddingRight: '52px',
                        minHeight: '48px',
                    }}
                />
                <button
                    type="button"
                    className={styles.inlineContactsButton}
                    onClick={() => { setPickerQuery(''); setPickerNetwork('all'); setContactsPickerOpen(true); }}
                    aria-label="Open contacts"
                    title="Contacts"
                >
                    <Icon.UsersIcon />
                </button>
            </div>
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
            {!hasTokenSelected ? (
                <Input
                    label="Token"
                    hint="Tick. Native coin by default."
                    value={tick}
                    onChange={(e) => setTick(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                />
            ) : null}
            <AmountField
                amount={amount}
                fiatAmount={fiatAmount}
                tick={tick}
                fiatRate={fiatRate}
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
                <Input
                    label="Memo"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    autoComplete="off"
                    error={/[|;]/.test(memo) ? 'Cannot contain | or ; characters.' : undefined}
                />
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

