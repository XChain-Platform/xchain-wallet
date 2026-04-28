import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
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
import { buildRecentDestinations } from '../../flows/recentDestinations.js';
import { findLookalike } from '../utils/lookalike.js';
import { checkPasteIntegrity } from '../utils/pasteIntegrity.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDeveloperMode } from '../hooks/useDeveloperMode.js';
import { useSettings } from '../hooks/useSettings.js';
import { checkRecipientNovelty } from '../../flows/recipientNovelty.js';
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
import { useHaptic } from '../hooks/useHaptic.js';
import { useFormDraft } from '../hooks/useFormDraft.js';
import styles from './Send.module.css';

// §30.5 user-initiated cancel detection. HW-device libraries surface a
// rejection as an Error whose message contains words like "cancelled",
// "rejected", or "denied" (Trezor: "Action cancelled by user"; Ledger:
// "Transaction was rejected"). Treat any of those as a deliberate user
// cancel rather than a Send failure so the UI returns to the composing
// form with a calm "Transaction cancelled." toast instead of a red error.
const USER_CANCEL_RE = /cancel|reject|denied/i;

const chainRegistry = registryLib.defaultRegistry();

/**
 * Send view — §29 authoring surface for the SEND action.
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
 * exercise cleanly — good for UX review before real SDK lands.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function Send({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
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

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );
    const [toAddress, setToAddress] = useState('');
    const [asset, setAsset] = useState('');
    const [amount, setAmount] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // §37 / G125 — form-draft persistence. Persists only the user-visible
    // composition fields; password / mnemonic / passphrase NEVER touch
    // localStorage. The hook is keyed by walletId so a from-seed restore
    // doesn't surface a stranger's draft.
    const draft = useFormDraft({ view: 'send', walletId });
    const [draftPending, setDraftPending] = useState(() => draft.hasDraft());
    useEffect(() => {
        if (stage !== 'form' || !draftPending) return;
        draft.save({ chainId, toAddress, asset, amount, memo });
    }, [stage, draftPending, draft, chainId, toAddress, asset, amount, memo]);
    const restoreDraft = useCallback(() => {
        const v = draft.load();
        if (!v) { setDraftPending(false); return; }
        if (typeof v.chainId === 'string') setChainId(v.chainId);
        if (typeof v.toAddress === 'string') setToAddress(v.toAddress);
        if (typeof v.asset === 'string') setAsset(v.asset);
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
                setChainId(firstChain);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // §18.4 firmware-warning support. When the source address is HW we
    // need vendor / model / firmwareVersion to render the warning banner
    // inside HwSignBlock. We look up the matching SignerRecord lazily —
    // listSigners is small (a few records per wallet), runs once per
    // walletId change, and is graceful if it fails.
    const [signersByWallet, setSignersByWallet] = useState(/** @type {any[]} */ ([]));
    useEffect(() => {
        let cancelled = false;
        messaging.listSigners(walletId)
            .then((rows) => { if (!cancelled) setSignersByWallet(Array.isArray(rows) ? rows : []); })
            .catch(() => { /* silent — banner just doesn't render */ });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // §29.4 / §21.6 autocomplete source data. Contacts cover the whole
    // vault and load once; history is per-chain × per-address and
    // refetches when the chain changes.
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));
    useEffect(() => {
        let cancelled = false;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setContacts(Array.isArray(rows) ? rows : []); })
            .catch(() => { /* silent — autocomplete just shows fewer hits */ });
        return () => { cancelled = true; };
    }, [messaging]);

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

    // §29.5 smart paste — BIP21 URI pre-fills amount/token/memo;
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
                setAsset(tickParam.toUpperCase());
            }
            if (parts.message) setMemo(parts.message);
            setPasteHint(`Filled from ${detected.scheme}: URI`);
        } else if (detected.type === 'xchain-uri') {
            e.preventDefault();
            setToAddress(detected.parts.address);
            const tickParam = detected.parts.params?.tick;
            if (typeof tickParam === 'string' && tickParam.length > 0) {
                setAsset(tickParam.toUpperCase());
            }
            if (detected.parts.amount) setAmount(detected.parts.amount);
            if (detected.parts.message) setMemo(detected.parts.message);
            setPasteHint('Filled from xchain: URI');
        } else if (detected.type === 'wif') {
            e.preventDefault();
            setPasteHint(
                'That looks like a private key, not an address. Use Settings → Import private key to import it.',
            );
        } else {
            // raw address / unknown — let the default paste happen.
            setPasteHint(null);
        }
        setPasteWarning(null);
        // Defer the integrity check so the paste event finishes first.
        // navigator.clipboard.readText is async and permission-gated;
        // skipped + ok results are silent.
        Promise.resolve().then(() => checkPasteIntegrity({ pastedText: text }))
            .then((res) => { if (!res.ok) setPasteWarning(res.reason || 'Clipboard altered after paste — verify the address before sending.'); })
            .catch(() => { /* silent */ });
    }, []);

    // §21.4 test-send protection. Session-scoped acknowledgement set —
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
    //   - the send is a native-coin send (asset matches descriptor.coin
    //     uppercased — the threshold is denominated in sats and only
    //     translates cleanly for native sends; asset/token threshold is
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
        const nativeTicker = desc?.coin?.toUpperCase();
        if (!nativeTicker || asset.trim().toUpperCase() !== nativeTicker) return null;
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
    }, [settings, toAddress, asset, amount, chainId, contacts, historyRows, testedThisSession]);

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

    // Amount-entry mode toggle. 'native' = user types coin units;
    // 'fiat' = user types fiat (when a rate is available). The form's
    // canonical `amount` state always holds the native-unit value.
    const [amountMode, setAmountMode] = useState(/** @type {'native' | 'fiat'} */ ('native'));
    const [fiatInput, setFiatInput] = useState('');

    const isNativeSend = useMemo(() => {
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const nativeTicker = desc?.coin?.toUpperCase();
        return Boolean(nativeTicker && asset.trim().toUpperCase() === nativeTicker);
    }, [chainId, asset]);

    // Native-unit balance available for the selected asset on the
    // source address, derived from the same SDK call the simulator
    // already runs. Drives Max + the "Available: X" hint.
    const sourceBalance = useMemo(() => {
        if (!previewBalances.sdkShape) return null;
        const tickUpper = asset.trim().toUpperCase();
        if (!tickUpper) return null;
        const native = previewBalances.sdkShape.native;
        if (native && String(native.asset || '').toUpperCase() === tickUpper) {
            return decoderLib.balancesFromSdk(previewBalances.sdkShape).find((b) => b.tick === tickUpper) || null;
        }
        return decoderLib.balancesFromSdk(previewBalances.sdkShape).find((b) => b.tick === tickUpper) || null;
    }, [previewBalances.sdkShape, asset]);

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
        if (amountMode === 'fiat' && fiatRate) {
            const fiat = coinToFiat(display, fiatRate);
            setFiatInput(fiat != null ? fiat.toFixed(2) : '');
        }
    }, [sourceBalance, isNativeSend, feeEstimate, amountMode, fiatRate]);

    const onToggleAmountMode = useCallback(() => {
        if (!fiatRate) return;
        setAmountMode((prev) => {
            if (prev === 'native') {
                const fiat = coinToFiat(amount, fiatRate);
                setFiatInput(fiat != null ? fiat.toFixed(2) : '');
                return 'fiat';
            }
            return 'native';
        });
    }, [amount, fiatRate]);

    const onFiatInputChange = useCallback((value) => {
        setFiatInput(value);
        if (!fiatRate) return;
        const coin = fiatToCoin(value, fiatRate);
        if (coin != null) setAmount(coin);
    }, [fiatRate]);

    const fiatPreview = useMemo(() => {
        if (!fiatRate) return null;
        if (!isNativeSend) return null;
        const f = coinToFiat(amount, fiatRate);
        if (f == null) return null;
        return `≈ $${f.toFixed(2)} (placeholder rate)`;
    }, [amount, fiatRate, isNativeSend]);

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

    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        const addrs = (addressesByChain[chainId] || []).filter(
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
        const descriptor = chainRegistry.get(chainId);
        if (descriptor) setAsset(descriptor.coin.toUpperCase());
    }, [chainId, addressesByChain]);

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
                TICK: asset.trim(),
                AMOUNT: String(amount).trim(),
                DESTINATION: toAddress.trim(),
                MEMO: memo.trim() || undefined,
            },
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, asset, amount, toAddress, memo, chainId]);

    // §21.2 balance-change preview. Fetched on entering review against
    // the source address; the result feeds `decoder.simulateAction` and
    // renders inside `<BalanceChanges>` between the headline and details.
    // Fetch failure is non-blocking — the section renders muted with a
    // "(preview unavailable)" line and the user can still sign.
    const [previewBalances, setPreviewBalances] = useState(
        /** @type {{ loading: boolean, error: string | null, sdkShape: any | null }} */
        ({ loading: false, error: null, sdkShape: null }),
    );
    useEffect(() => {
        // Fetch on review (for the simulator) AND on form (so Max + the
        // "Available: X" hint know what's spendable). Form-stage fetches
        // are non-blocking — failure leaves Max disabled, the hint hidden.
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
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */
        ({ mode: 'normal' }),
    );

    // Step 5 of §44 — initial mode + custom rate seeded from
    // settings.fees[chainId]. Persisted preference flows from the §35
    // Fees panel's Strategy picker; user can still flip per-tx via the
    // FeeSelector without touching the saved default. Re-seeds when
    // the active chain changes.
    useEffect(() => {
        if (!chainId || !settings?.fees) return;
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

    // Step 4 of §44 — async fetcher probes the shell's messaging
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

    const previewResult = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        if (previewBalances.loading || previewBalances.error || !previewBalances.sdkShape) {
            return null;
        }
        const feeStr = feeEstimate?.coinAmount || '0';
        return decoderLib.simulateAction({
            action: 'SEND',
            params: {
                TICK: asset.trim(),
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
    }, [stage, asset, amount, toAddress, memo, chainId, previewBalances, feeEstimate]);

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
        if (!asset.trim()) {
            setFormError('Asset ticker is required.');
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
    const hwSignerInfo = useMemo(() => {
        if (!isHwSource || !fromAddress?.signerId) return null;
        const rec = signersByWallet.find((s) => s?.id === fromAddress.signerId);
        if (!rec) return null;
        return {
            vendor: rec.vendor,
            model: rec.model,
            firmwareVersion: rec.firmwareVersion ?? null,
        };
    }, [isHwSource, fromAddress, signersByWallet]);
    const [hwStatus, setHwStatus] = useState(/** @type {string} */ ('idle'));
    const onHwStatusChange = useCallback(({ status }) => {
        setHwStatus(status);
    }, []);

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isHwSource && password.length === 0) return;
        if (isHwSource && hwStatus !== 'available') return;
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
                asset: asset.trim(),
                amount: String(amount).trim(),
                memo: memo.trim() || undefined,
                rbf: rbfEnabled,
            };
            // Software path: send password; background unlocks + signs.
            // HW path: bypass password; background routes the sign
            // request through the signer-bridge RPC to the renderer-
            // hosted Trezor/Ledger signer identified by `signerId`.
            const res = isHwSource
                ? await messaging.sendAssetHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.sendAsset({ ...base, password });
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
                // §30.5 — user-initiated cancel returns to the composing
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
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back to home"
            >
                <Icon.BackIcon />
            </button>
            <span className={styles.title}>
                {stage === 'review' || stage === 'submitting' ? 'Review & Send' : 'Send'}
            </span>
            <span className={styles.spacer} />
        </div>
    );

    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
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
        const sentAmount = amount && asset ? `${amount} ${asset}` : null;
        const recipient = toAddress
            ? `${toAddress.slice(0, 8)}…${toAddress.slice(-6)}`
            : null;
        const sendAnother = () => {
            setStage('form');
            setAmount('');
            setToAddress('');
            setResult(null);
            setPreviewResult(null);
        };
        const copyTxid = () => {
            if (!txid) return;
            try { navigator.clipboard?.writeText(txid); } catch { /* best effort */ }
        };
        return wrap(
            <>
                <div className={styles.successCard} role="status" aria-live="polite">
                    <div className={styles.successIcon} aria-hidden="true">✓</div>
                    <h2 className={styles.successTitle}>Broadcast — pending</h2>
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
                            First send to this address — test it first?
                        </p>
                        <p className={styles.testSendBody}>
                            You're sending {testSendGate.amountSats.toLocaleString()} sats
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
                                I've verified — continue
                            </Button>
                        </div>
                    </div>
                ) : null}
                <RawPsbtViewer
                    developerMode={developerMode}
                    actionFields={{
                        action: 'SEND',
                        TICK: asset.trim(),
                        AMOUNT: String(amount).trim(),
                        DESTINATION: toAddress.trim(),
                        ...(memo.trim() ? { MEMO: memo.trim() } : {}),
                    }}
                />
                {isHwSource ? (
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
                    />
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
                {isHwSource && submitError ? (
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
                            || (isHwSource
                                ? hwStatus !== 'available'
                                : password.length === 0)
                        }
                    >
                        {isHwSource
                            ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : descriptor?.displayName
                                ? `Sign on ${descriptor.displayName}`
                                : 'Sign'}
                    </Button>
                </div>
            </form>,
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
    return wrap(
        <form onSubmit={handleReview} noValidate>
            {draftBanner}
            {chainsWithAddresses.length > 1 ? (
                <ChainPicker label="Chain" value={chainId} onChange={setChainId} chainIds={chainsWithAddresses} chainRegistry={chainRegistry} />
            ) : descriptor ? (
                <div className={styles.chainLine}>
                    <ChainBadge descriptor={descriptor} size="sm" />
                </div>
            ) : null}

            {fromAddress ? (
                <div className={styles.fromLine}>
                    <span className={styles.fromLabel}>From</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : null}

            <AddressCombobox
                label="To"
                value={toAddress}
                onChange={(e) => {
                    setToAddress(e.target.value);
                    if (pasteHint) setPasteHint(null);
                    if (pasteWarning) setPasteWarning(null);
                }}
                onPaste={onAddressPaste}
                suggestions={suggestions}
                placeholder={descriptor ? `${descriptor.displayName} address` : 'address'}
                hint={pasteHint || undefined}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
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
            <Input
                label="Asset"
                hint="Ticker. Native coin by default."
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
            />
            <div className={styles.amountRow}>
                <div className={styles.amountField}>
                    {amountMode === 'native' ? (
                        <Input
                            label={`Amount${asset.trim() ? ` (${asset.trim()})` : ''}`}
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            hint={fiatPreview || undefined}
                            autoComplete="off"
                        />
                    ) : (
                        <Input
                            label={`Amount (${fiatRate?.fiatCurrency || 'USD'})`}
                            inputMode="decimal"
                            value={fiatInput}
                            onChange={(e) => onFiatInputChange(e.target.value)}
                            hint={
                                amount
                                    ? `≈ ${amount} ${asset.trim() || ''} (placeholder rate)`
                                    : undefined
                            }
                            autoComplete="off"
                        />
                    )}
                </div>
                <div className={styles.amountActions}>
                    <button
                        type="button"
                        className={styles.amountButton}
                        onClick={onMax}
                        disabled={!sourceBalance}
                        aria-label="Set max amount"
                    >
                        Max
                    </button>
                    <button
                        type="button"
                        className={styles.amountButton}
                        onClick={onToggleAmountMode}
                        disabled={!fiatRate}
                        aria-label={
                            amountMode === 'native'
                                ? 'Enter amount in fiat'
                                : 'Enter amount in coin units'
                        }
                    >
                        {amountMode === 'native'
                            ? (fiatRate?.fiatCurrency || 'USD')
                            : (asset.trim() || 'coin')}
                    </button>
                </div>
            </div>
            {sourceBalance ? (
                <p className={styles.balanceHint}>
                    Available: {sourceBalance.amount} {sourceBalance.tick}
                    {feeEstimate && isNativeSend
                        ? ` (fee ≈ ${feeEstimate.coinAmount} ${sourceBalance.tick}, placeholder)`
                        : ''}
                </p>
            ) : null}
            <Input
                label="Memo"
                hint="Optional. Cannot contain | or ; characters."
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
            />
            {feeTiers ? (
                <FeeSelector
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    placeholderBadge={feeEstimate?.source === 'static-placeholder'}
                />
            ) : null}
            {feeTiers ? (
                <label className={styles.rbfRow}>
                    <input
                        type="checkbox"
                        role="switch"
                        checked={rbfEnabled}
                        onChange={(e) => setRbfEnabled(e.target.checked)}
                        aria-label="Replace-by-fee enabled"
                    />
                    <span className={styles.rbfLabel}>
                        Replace-by-fee
                        <InfoTip
                            aria="Replace-by-fee help"
                            label="Marks the transaction as replaceable (BIP125). While it sits in the mempool you can broadcast a new version with a higher fee to speed it up — or send a self-transfer at a higher fee to cancel it."
                        />
                        <span className={styles.rbfHint}>
                            Allows speeding up or cancelling this transaction while it's in the mempool.
                        </span>
                    </span>
                </label>
            ) : null}
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
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || !toAddress || !amount}
                >
                    Review
                </Button>
            </div>
        </form>,
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
