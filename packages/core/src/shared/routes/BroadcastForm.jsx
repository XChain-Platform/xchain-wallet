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
import { AddressField, AddressText, Button, ChainBadge, CopyButton, FeeSelector, FormPage, Icon, Input, NetworkField, PageHeader, Screen, StatusMessage, Textarea } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { LockedTokenContext } from '../components/LockedTokenContext.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { preferredSourceId } from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';
import { MAX_MEMO_LENGTH, memoLengthError, utf8ByteLength } from '../utils/memoLimit.js';
import { parseRawTx } from '../../signers/verifySignedTx.js';
import { formatNativeBaseUnits, tickerForDescriptor } from '../../registry/coinTicker.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { useSettings } from '../hooks/useSettings.js';
import { explorerPageUrl } from '../utils/explorerLinks.js';
import { useLongOperationStatus } from '../hooks/useLongOperationStatus.js';

const chainRegistry = registryLib.defaultRegistry();

// Separator between the parts the form packs into one MEMO slot (the optional
// UTC timestamp and the message body).: this used to be ' | ', and '|'
// is the protocol's own field delimiter - the SDK refuses a MEMO containing
// one, so ticking the wallet's own timestamp box made the action unsendable
// with an error naming a field the UI never shows. The separator is cosmetic;
// the delimiter is not.
const MEMO_PART_SEPARATOR = ' - ';

// '|' separates fields and ';' separates actions on the wire, so neither can
// appear in text the user typed. The form says so in its own words rather than
// letting the compose call fail with the protocol's field names.
const RESERVED_DELIMITERS = /[|;]/;

// BROADCAST MESSAGE uses the same 250-byte ceiling as MEMO, but the
// indexer validates it under its own field-specific setting.
const MAX_BROADCAST_MESSAGE_LENGTH = 250;
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const HEX_ONLY = /^[0-9a-fA-F]+$/;

function normalizeRawTransaction(raw) {
    const compact = String(raw || '').replace(/\s+/g, '');
    if (!compact) throw new Error('Paste a signed transaction first.');
    if (!HEX_ONLY.test(compact)) throw new Error('Transaction data must contain hexadecimal characters only.');
    if (compact.length % 2 !== 0) throw new Error('Transaction data must contain complete bytes (two hexadecimal characters per byte).');
    try {
        return { txHex: compact.toLowerCase(), decoded: parseRawTx(compact) };
    } catch {
        throw new Error('This is not a complete signed transaction. Check the pasted data and try again.');
    }
}

function scriptType(script) {
    if (/^76a914[0-9a-f]{40}88ac$/.test(script)) return 'P2PKH';
    if (/^a914[0-9a-f]{40}87$/.test(script)) return 'P2SH';
    if (/^0014[0-9a-f]{40}$/.test(script)) return 'SegWit';
    if (/^0020[0-9a-f]{64}$/.test(script)) return 'SegWit';
    if (/^5120[0-9a-f]{64}$/.test(script)) return 'Taproot';
    if (script.startsWith('6a')) return 'data';
    return 'unknown script';
}

function rawTransactionMismatch(decoded, descriptor) {
    if (!decoded || !descriptor) return null;
    const types = new Set((descriptor.addressTypes || []).map(String));
    const hasTaproot = decoded.outputs.some((output) => scriptType(output.scriptPubKeyHex) === 'Taproot');
    if (hasTaproot && !types.has('p2tr')) {
        return `This transaction contains a Taproot output, which ${descriptor.displayName} does not support here. Pick the network that created the transaction.`;
    }
    const hasSegwit = decoded.outputs.some((output) => scriptType(output.scriptPubKeyHex) === 'SegWit');
    if (hasSegwit && !types.has('p2wpkh')) {
        return `This transaction contains a SegWit output, which ${descriptor.displayName} does not support here. Pick the network that created the transaction.`;
    }
    return null;
}

function formatCoinAmount(valueSat, descriptor) {
    return `${formatNativeBaseUnits(valueSat, descriptor)} ${tickerForDescriptor(descriptor)}`;
}

function rawBroadcastFailure(err) {
    const raw = err && typeof err === 'object'
        ? String(/** @type {any} */ (err).message || '')
        : String(err || '');
    const lower = raw.toLowerCase();
    if (/missingorspent|missing or spent/.test(lower)) {
        return 'The node rejected this transaction because an input is missing or already spent.';
    }
    if (/mempool-conflict|mempool conflict/.test(lower)) {
        return 'The node rejected this transaction because it conflicts with another transaction in the mempool.';
    }
    if (/already known|already in (?:the )?mempool|txn-already/.test(lower)) {
        return 'The node says this transaction is already in its mempool.';
    }
    if (/mandatory-script-verify|script verify|script verification/.test(lower)) {
        return 'The node rejected this transaction because a signature or spending condition is invalid.';
    }
    if (/min relay fee|mempool min fee|insufficient fee|fee.*too low/.test(lower)) {
        return 'The node rejected this transaction because its network fee is too low.';
    }
    return readFailureMessage(err, 'broadcast this transaction');
}

function BroadcastKindPicker({ value, onChange }) {
    return (
        <fieldset className={styles.pickerLabel}>
            <legend>What do you want to broadcast?</legend>
            <label className={styles.radioOption}>
                <input
                    type="radio"
                    name="broadcast-kind"
                    checked={value === 'message'}
                    onChange={() => onChange('message')}
                />
                Publish on-chain data
            </label>
            <label className={styles.radioOption}>
                <input
                    type="radio"
                    name="broadcast-kind"
                    checked={value === 'transaction'}
                    onChange={() => onChange('transaction')}
                />
                Signed transaction
            </label>
        </fieldset>
    );
}

function RawTransactionBroadcast({
    walletId, chainId, setChainId, messaging, onKindChange, onBusyChange, onDone,
}) {
    const { settings } = useSettings();
    const [raw, setRaw] = useState('');
    const [preview, setPreview] = useState(/** @type {{ txHex: string, decoded: any } | null} */ (null));
    const [state, setState] = useState(/** @type {'form' | 'preview' | 'submitting' | 'done'} */ ('form'));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const ticker = tickerForDescriptor(descriptor);
    const mismatch = rawTransactionMismatch(preview?.decoded, descriptor);
    const chainIds = chainRegistry.supportedChains().map((chain) => chain.id);
    const broadcastTime = useLongOperationStatus(state === 'submitting', { timeoutMs: 30_000 });

    function review(event) {
        event.preventDefault();
        if (!chainId) {
            setError('Pick the network that will receive this transaction.');
            return;
        }
        try {
            setPreview(normalizeRawTransaction(raw));
            setError(null);
            setState('preview');
        } catch (err) {
            setPreview(null);
            setError(err instanceof Error ? err.message : 'This transaction could not be read.');
        }
    }

    async function broadcast(event) {
        event.preventDefault();
        if (!preview || !chainId || mismatch || state === 'submitting') return;
        setState('submitting');
        onBusyChange(true);
        setError(null);
        try {
            const response = await messaging.broadcastSignedTxRequest({
                walletId,
                chainId,
                txHex: preview.txHex,
            });
            setResult(response);
            setState('done');
        } catch (err) {
            setError(rawBroadcastFailure(err));
            setState('preview');
        } finally {
            onBusyChange(false);
        }
    }

    if (state === 'done') {
        const txid = result?.txid || result?.broadcast?.txid || '';
        // A relay that queued the transaction instead of broadcasting it is
        // not a broadcast; say so before any success copy can render.
        if (result?.queued) {
            return <QueuedResultPanel onDone={() => setState('form')} what="broadcast" unsaved={result?.unsaved} />;
        }
        const explorerBase = descriptor?.explorer?.defaultUrl;
        const explorerUrl = txid && explorerBase ? explorerPageUrl({
            chainId,
            kind: 'transaction',
            value: txid,
            settings,
        }) : null;
        return (
            <div>
                <div role="status" aria-live="polite" aria-atomic="true">
                    <h2 className={styles.successTitle}>{txid ? 'Broadcast pending' : 'Transaction queued'}</h2>
                    {txid ? (
                        <p className={styles.hint}>
                            The transaction was broadcast but is not confirmed yet.
                            Confirmation time depends on the selected network and fee.
                        </p>
                    ) : null}
                </div>
                {txid ? (
                    <>
                        <p><ChainBadge descriptor={descriptor} /></p>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                        <CopyButton value={txid} label="Copy transaction ID" />
                        {explorerUrl ? (
                            <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
                                View on explorer <span aria-hidden="true">↗</span>
                            </a>
                        ) : null}
                    </>
                ) : (
                    <p>The signed transaction is saved in the broadcast queue. Send it from there when the network is available.</p>
                )}
                <div className={styles.actions}>
                    <Button type="button" onClick={() => {
                        setRaw('');
                        setPreview(null);
                        setResult(null);
                        setState('form');
                    }}>
                        Broadcast another
                    </Button>
                    <Button type="button" variant="primary" onClick={onDone}>Done</Button>
                </div>
            </div>
        );
    }

    if (state === 'preview' || state === 'submitting') {
        return (
            <FormPage
                label="Review signed transaction"
                onSubmit={broadcast}
                status={error || mismatch ? (
                    <StatusMessage variant="error" className={styles.error}>{error || mismatch}</StatusMessage>
                ) : null}
                actions={(
                    <>
                        <Button
                            type="button"
                            onClick={() => setState('form')}
                            disabled={state === 'submitting'}
                        >
                            Back
                        </Button>
                        <Button type="submit" variant="primary" loading={state === 'submitting'} disabled={!!mismatch}>
                            Broadcast transaction
                        </Button>
                    </>
                )}
            >
                <ChainBadge descriptor={descriptor} size="sm" />
                <p>
                    This signed transaction spends {preview.decoded.inputs.length} input{preview.decoded.inputs.length === 1 ? '' : 's'}
                    {' '}and creates {preview.decoded.outputs.length} output{preview.decoded.outputs.length === 1 ? '' : 's'}.
                </p>
                <dl className={styles.detailsList}>
                    {preview.decoded.outputs.map((output, index) => (
                        <DetailRow
                            key={`${output.scriptPubKeyHex}-${index}`}
                            label={`Output ${index + 1}`}
                            value={`${formatCoinAmount(output.valueSat, descriptor)} to ${scriptType(output.scriptPubKeyHex)} script ${output.scriptPubKeyHex}`}
                        />
                    ))}
                    <DetailRow
                        label="Network fee"
                        value="Cannot be calculated from raw transaction data because it does not include the amounts of the spent inputs."
                    />
                </dl>
                <p className={styles.hint}>
                    Raw transaction data does not identify mainnet, testnet, or regtest. Confirm that the selected network is the one that created it.
                </p>
                {broadcastTime.showElapsed ? (
                    <p role="status" className={styles.hint} data-testid="raw-broadcast-elapsed">
                        Waiting for the relay for {broadcastTime.elapsedSeconds} seconds.
                    </p>
                ) : null}
                {broadcastTime.timedOut ? (
                    <StatusMessage variant="error" className={styles.error}>
                        The relay has not responded. Check History or a block explorer before trying again. Closing this screen does not cancel a transaction the relay already received.
                    </StatusMessage>
                ) : null}
            </FormPage>
        );
    }

    return (
        <FormPage
            label="Broadcast signed transaction"
            onSubmit={review}
            status={error ? <StatusMessage variant="error" className={styles.error}>{error}</StatusMessage> : null}
            actions={<Button type="submit" variant="primary">Preview transaction</Button>}
        >
            <BroadcastKindPicker value="transaction" onChange={onKindChange} />
            <NetworkField value={chainId} onChange={setChainId} chainIds={chainIds} chainRegistry={chainRegistry} />
            <Textarea
                label="Signed transaction hex"
                hint="Spaces and line breaks are ignored. Only complete hexadecimal bytes are accepted."
                value={raw}
                onChange={(event) => {
                    setRaw(event.target.value);
                    if (error) setError(null);
                }}
                rows={8}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
            />
        </FormPage>
    );
}

/**
 * BROADCAST form (§40.6).
 *
 * Publishes an arbitrary text string, oracle value, or feed reference
 * on-chain, tied to the source address. Three UX lanes map onto the
 * four protocol format versions (BROADCAST.md):
 *
 *   - plain broadcast (v0): message only, no memo, no fee.
 *   - oracle (v1): feed name + value (+ optional fee, optional memo).
 *   - feed URL (v2): feed name (a URL) (+ optional fee, optional memo).
 *
 * v3 (feed results) is a resolve path from a prior feed's detail page
 * and not surfaced as a standalone authoring lane here.
 *
 * Field mapping: MESSAGE is the protocol's one-string payload; the
 * form presents "Feed name" and "Text" as separate inputs for clarity
 * (§40.6) and composes them:
 *
 *   - feedName non-empty → MESSAGE = feedName; text (if any) → MEMO.
 *   - feedName empty     → MESSAGE = text (validator still requires
 *                          at least one of them).
 *
 * Timestamp (auto) prepends the current UTC ISO time to MEMO so the
 * sign-screen sees what will land on-chain. Users can turn it off for
 * plain broadcasts where the tx's block time is enough context.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {() => void} [props.onDone]
 */
export function BroadcastForm({ walletId, onBack, onDone, initialChainId, initialTick, initialFromAddress }) {
    const { messaging, shell } = useMessaging();
    const { settings } = useSettings();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    // getActiveAddresses()[chainId], loaded in the same batch as the
    // address list so the source default resolves once, not fallback-then-swap.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, any> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || null));
    const lockedToken = !!(initialChainId && initialTick);
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    const [feedName, setFeedName] = useState(initialTick ? initialTick.toUpperCase() : '');
    const [text, setText] = useState('');
    const [value, setValue] = useState('');
    const [feedFee, setFeedFee] = useState('');
    const [includeTimestamp, setIncludeTimestamp] = useState(false);
    const [broadcastKind, setBroadcastKind] = useState('message');
    const [rawBroadcastBusy, setRawBroadcastBusy] = useState(false);
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // The active map and the settings read are best-effort: a host without
    // `getActiveAddresses` / `getSettings`, or one whose call fails, still
    // yields a usable form (newest-HD source, first-chain default).
    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
            typeof messaging.getSettings === 'function'
                ? Promise.resolve(messaging.getSettings()).catch(() => null)
                : Promise.resolve(null),
        ])
            .then(([byChain, active, settings]) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                setActiveByChain(active || {});
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before broadcasting.',
                    );
                    return;
                }
                // `byChain` is in address-creation order, so opening on its
                // first key broadcast from the wallet's OLDEST chain forever.
                // Open on the last-used chain instead, behind a caller-seeded
                // one (a token context) and ahead of the first-key fallback,
                // exactly as Send and Swap do.
                if (!lockedToken) {
                    setChainId((prev) => pickDefaultChainId(byChain, {
                        explicitChainId: prev,
                        settings,
                    }));
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Same default as Send and every other spend-from-balance form: the
    // chain's active address, else the newest HD external. A dispenser-
    // delegated address is never the default; it vends rather than funds.
    useEffect(() => {
        if (!chainId || !addressesByChain || !activeByChain) return;
        const all = addressesByChain[chainId] || [];
        if (initialFromAddress) {
            const match = all.find((a) => a.address === initialFromAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        const funding = all.filter((a) => a.role !== 'dispenser');
        setFromAddressId(preferredSourceId(funding, activeByChain[chainId]));
    }, [chainId, addressesByChain, activeByChain, initialFromAddress]);

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
    const coinTicker = tickerForDescriptor(descriptor);

    // PC-51: native-coin protocol fee (BROADCAST is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);

    // Network fee: Low / Normal / Fast / Custom via FeeSelector; feePerKb
    // prices the broadcast (mirrors DispenserForm / SwapForm).
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId, chainRegistry }),
        [chainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [chainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    const actionParams = useMemo(() => {
        const feed = feedName.trim();
        const body = text.trim();
        const val = String(value).trim();
        const fee = String(feedFee).trim();

        const message = feed || body;
        const memoParts = [];
        if (includeTimestamp) memoParts.push(new Date().toISOString());
        if (feed && body) memoParts.push(body);
        const memo = memoParts.join(MEMO_PART_SEPARATOR);

        // The version has to follow the fields that are actually
        // populated. Only v1/v2/v3 carry a MEMO slot (v0 is
        // VERSION|MESSAGE|VALUE), so selecting on VALUE and FEE alone dropped a
        // typed body on the floor - encoded, paid for, and reported as sent,
        // with the confirm screen showing no trace of it either. FEE is
        // optional on the wire (the indexer treats a null FEE as no usage fee),
        // so a MEMO-carrying version is always reachable without inventing a
        // fee: v1 when there is a value to publish, v2 otherwise. This is the
        // same answer the SDK's own FormatSelector.select() reaches from these
        // fields; the version stays explicit here so the confirm screen and the
        // encoder read the identical wire shape.
        let version = '0';
        if (val && (fee || memo)) version = '1';
        else if (fee || memo) version = '2';

        /** @type {Record<string, string>} */
        const p = { VERSION: version, MESSAGE: message };
        if (val) p.VALUE = val;
        if (fee) p.FEE = fee;
        if (memo) p.MEMO = memo;
        return p;
    }, [feedName, text, value, feedFee, includeTimestamp]);

    const messageBytes = utf8ByteLength(actionParams.MESSAGE);
    const memoBytes = utf8ByteLength(actionParams.MEMO);
    const messageLengthError = messageBytes > MAX_BROADCAST_MESSAGE_LENGTH
        ? `Message is ${messageBytes} bytes; the network accepts at most ${MAX_BROADCAST_MESSAGE_LENGTH} bytes.`
        : null;
    const broadcastMemoLengthError = memoLengthError(actionParams.MEMO || '');
    const broadcastLengthError = messageLengthError || broadcastMemoLengthError;

    // (§5.6 slice 2): software broadcasts go through the
    // single-encode confirm page; hardware + watcher keep the legacy
    // review stage. Declared before the `isHwSource`/`isWatcherMode`
    // consts below only for readability: `singleEncode` is computed
    // after them.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });

    const decoded = useMemo(() => {
        // residual (§5.6 slice 5): the confirm page renders the intent
        // the HOST described from the composed action string
        // (`composed.decoded`), so this local describer serves the LEGACY
        // review stage only - the watcher, demo and locked-ECDH path. It used
        // to also recompute while the confirm page was open, which was work
        // nothing read and, worse, read like the confirm surface still
        // depended on form state.
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'BROADCAST',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, actionConfirm.open, actionParams, chainId]);

    function handleReview(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!feedName.trim() && !text.trim()) {
            setFormError('Enter a feed name or a message.');
            return;
        }
        if (value.trim() && !DECIMAL_NUMBER.test(value.trim())) {
            setFormError('Value must be a number.');
            return;
        }
        if (feedFee.trim()) {
            const fee = feedFee.trim();
            if (!DECIMAL_NUMBER.test(fee) || fee.startsWith('-')) {
                setFormError('Feed fee must be a non-negative number.');
                return;
            }
        }
        // Refuse text the indexer would reject before the form asks the host to compose it.
        if (broadcastLengthError) {
            setFormError(broadcastLengthError);
            return;
        }
        // sibling case: a user-typed delimiter. The wallet no longer
        // inserts one itself, but a pipe or semicolon in either text field is
        // still unsendable, and the compose call reports that in protocol
        // field names nobody outside this file recognises.
        if (RESERVED_DELIMITERS.test(feedName) || RESERVED_DELIMITERS.test(text)) {
            setFormError('Remove any | or ; characters: the network reserves them as separators and will reject the broadcast.');
            return;
        }
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    // §18.4 / Cluster N FOLLOWUP 2: surface firmware advisories when
    // the source is HW. Hook handles the SignerRecord lookup + cache.
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5: watcher-mode encode-only branch.
    const { isWatcherMode } = useWalletMode();

    // pilot: hardware signers now go through the confirm page too. They
    // were excluded, which meant the users most likely to care about
    // verification got the LEGACY rebuild-on-Approve path with no output-set
    // tamper check - and the modal's own hardware note tells them this screen is
    // where action intent gets verified, since the device can only show native
    // outputs. Watcher mode still branches (it encodes, it never signs).
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT via broadcastAction.prebuiltPsbt.
    async function openConfirmScreen() {
        const from = {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'BROADCAST', params: actionParams },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => (isHwSource
                    // The HW route runs the SAME broadcastAction flow with a
                    // remote signer, so it signs the prebuilt PSBT byte-
                    // identically just like the software lane.
                    ? messaging.broadcastActionHw({
                        walletId,
                        chainId,
                        from,
                        params: actionParams,
                        signerId: fromAddress.signerId,
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                        prebuiltPsbt,
                    })
                    : messaging.broadcastAction({
                        walletId,
                        chainId,
                        from,
                        params: actionParams,
                        password: passwordValueRef.current,
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                        prebuiltPsbt,
                    })),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Broadcast failed.',
            }));
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
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
                params: actionParams,
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'BROADCAST', params: actionParams },
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (isHwSource) {
                res = await messaging.broadcastActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.broadcastAction({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker: coinTicker,
                        mandatory: nativeFee.mandatory,
                        fallback: err?.message || 'Broadcast failed.',
                    }),
            );
            setStage('review');
            if (!isWatcherMode && !isHwSource) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    function handleBuildAnother() {
        setResult(null);
        setSubmitError(null);
        setStage('form');
    }
        const header = (
        <PageHeader
            onBack={onBack}
            backDisabled={stage === 'submitting' || rawBroadcastBusy}
            title={stage === 'review' || stage === 'submitting'
                    ? 'Review broadcast'
                    : (broadcastKind === 'transaction' ? 'Broadcast transaction' : 'Broadcast')}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
    );

    if (!lockedToken && broadcastKind === 'transaction') {
        return wrap(
            <RawTransactionBroadcast
                walletId={walletId}
                chainId={chainId}
                setChainId={setChainId}
                messaging={messaging}
                onKindChange={setBroadcastKind}
                onBusyChange={setRawBroadcastBusy}
                onDone={onDone || onBack}
            />,
        );
    }
    if (loadError) {
        return wrap(
            <>
                {!lockedToken ? (
                    <BroadcastKindPicker value={broadcastKind} onChange={setBroadcastKind} />
                ) : null}
                <StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>
            </>,
        );
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading…</p>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <WatcherResultPanel
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={onDone || onBack}
                />,
            );
        }
        // Signed, but the broadcast leg never landed. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch it renders as a completed broadcast.
        if (result?.queued) {
            return wrap(
                <QueuedResultPanel onDone={onDone || onBack} what="broadcast" unsaved={result?.unsaved} />,
            );
        }
        const explorerUrl = txid ? explorerPageUrl({
            chainId,
            kind: 'transaction',
            value: txid,
            settings,
        }) : null;
        return wrap(
            <>
                <div role="status" aria-live="polite" aria-atomic="true">
                    <h2 className={styles.successTitle}>Broadcast pending</h2>
                    <p className={styles.hint}>
                        Your action was broadcast but is not confirmed yet.
                        Confirmation time depends on the selected network and fee.
                    </p>
                </div>
                {txid ? (
                    <>
                        <p><ChainBadge descriptor={descriptor} /></p>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                        <CopyButton value={txid} label="Copy transaction ID" />
                        {explorerUrl ? (
                            <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
                                View on explorer <span aria-hidden="true">↗</span>
                            </a>
                        ) : null}
                    </>
                ) : (
                    <p className={styles.hint}>The broadcast completed without a transaction ID.</p>
                )}
                <div className={styles.actions}>
                    <Button type="button" onClick={handleBuildAnother}>Broadcast another</Button>
                    <Button type="button" variant="primary" onClick={onDone || onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <FormPage
                label="Review broadcast"
                onSubmit={handleSubmit}
                status={(isWatcherMode || isHwSource) && submitError ? (
                    <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={
                            isWatcherMode
                                ? false
                                : isHwSource
                                    ? hwStatus !== 'available'
                                    : (!signerReady && password.length === 0)
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : (descriptor ? `Sign on ${descriptor.displayName}` : 'Sign')}
                    </Button>
                )}
            >
                <p className={styles.summary}>{decoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    {(decoded?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                    <DetailRow
                        label="Network fee"
                        value={feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    />
                </dl>
                {decoded && decoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decoded.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this wallet will build an unsigned transaction.
                        Sign it on your Signer-mode wallet, then bring the
                        signed transaction to a Full-mode wallet to broadcast.
                    </p>
                ) : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => {
                            setPassword(v);
                            if (submitError) setSubmitError(null);
                        }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        submitError={submitError}
                        disabled={stage === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                        signerInfo={hwSignerInfo}
                    />
                )}
            </FormPage>,
        );
    }

    // confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // Hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From address"
                walletId={walletId}
                chainId={chainId}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    return wrap(
        <FormPage
            label="Broadcast"
            onSubmit={handleReview}
            status={formError ? (
                <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage>
            ) : null}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                    loading={actionConfirm.composing}
                    disabled={!fromAddress
                        || (!feedName.trim() && !text.trim())
                        || !!broadcastLengthError
                        || actionConfirm.composing}
                >
                    {singleEncode ? 'Broadcast' : 'Preview'}
                </Button>
            )}
        >
            {!lockedToken ? (
                <BroadcastKindPicker value={broadcastKind} onChange={setBroadcastKind} />
            ) : null}
            {lockedToken && chainId ? (
                <LockedTokenContext chainId={chainId} tick={initialTick.toUpperCase()} />
            ) : (
                <>
                    <NetworkField value={chainId} onChange={setChainId} chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} />
                </>
            )}

            {fromAddress ? (
                <AddressField
                    label="From"
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel="Choose source address"
                />
            ) : (
                <StatusMessage variant="error" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </StatusMessage>
            )}

            <Input
                label="Feed name (optional)"
                hint={`${utf8ByteLength(feedName.trim())} / ${MAX_BROADCAST_MESSAGE_LENGTH} bytes. Stable label for an oracle or feed.`}
                error={feedName.trim() ? messageLengthError || undefined : undefined}
                value={feedName}
                onChange={(e) => setFeedName(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
            />
            <Input
                label="Message (optional)"
                hint={feedName.trim()
                    ? `${memoBytes} / ${MAX_MEMO_LENGTH} on-chain memo bytes.`
                    : `${messageBytes} / ${MAX_BROADCAST_MESSAGE_LENGTH} bytes.`}
                error={(feedName.trim() ? broadcastMemoLengthError : messageLengthError) || undefined}
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoComplete="off"
            />
            <Input
                label="Value (optional)"
                hint="Numeric value published by this oracle."
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="off"
            />
            <Input
                label="Feed fee (%) (optional)"
                hint="Usage fee charged to dispensers that use this oracle. Leave blank for none."
                inputMode="decimal"
                value={feedFee}
                onChange={(e) => setFeedFee(e.target.value)}
                autoComplete="off"
            />
            <label className={styles.pickerLabel}>
                <input
                    type="checkbox"
                    checked={includeTimestamp}
                    onChange={(e) => setIncludeTimestamp(e.target.checked)}
                />
                {' '}Prepend UTC timestamp to memo
            </label>

            {feeTiers ? (
                <FeeSelector
                    label="Network fee"
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                />
            ) : null}
            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} />
        </FormPage>,
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
