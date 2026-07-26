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
    Textarea,
    IconSelect,
    FeeSelector,
    ChainBadge,
    AddressText,
 Icon, AddressField,} from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { chainIconSmallUrl } from '../../branding/branding.js';
import { isValidAddressAnyNetwork, detectAddressCoin } from '../utils/addressValidation.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ContactsPickerScreen } from '../components/ContactsPickerScreen.jsx';
import { buildDeliveryNetworkOptions } from '../utils/deliveryNetworks.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { coinToFiat } from '../../flows/priceLookup.js';
import { useFiatRate } from '../hooks/useFiatRate.js';
import { useSettings } from '../hooks/useSettings.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// User-facing native ticker for a chain, used to label the network-fee
// estimate on the review screen.
const NATIVE_TICKER_BY_CHAIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };


/**
 * §41.7.3 Compose encrypted message.
 *
 * Flow:
 *   1. User picks a source (chain + address, defaults to the first
 *      HD address on the first available chain, or pre-selected when
 *      opened from the Inbox / a Contact).
 *   2. Recipient address input. On blur / debounce, the wallet looks
 *      up the recipient's on-chain pubkey via
 *      `messaging.getRecipientPubkey`. Three states:
 *        - Found → ECIES encryption available, default path.
 *        - Not found → banner explains why + offers the unencrypted
 *          (v3 plaintext) fallback per the spec's wording.
 *        - Still checking → show a lightweight spinner.
 *   3. Message body.
 *   4. SignCredentials gate. HW signers route through the same gate.
 *   5. On submit, the background flow re-does the pubkey lookup (so
 *      a stale UI state can't bypass a just-indexed pubkey) and
 *      encrypts in-process.
 *
 * Decoder output on broadcast: "Send encrypted message to
 * <recipient> on <chain>."
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.chainId]           pre-selected source chain (from Inbox)
 * @param {string} [props.fromAddressId]     pre-selected source address
 * @param {string} [props.toAddress]         pre-filled recipient (from Inbox / Contact)
 * @param {string} [props.initialMessage]    pre-filled body (a thread reply)
 * @param {'ecies' | 'ecdh' | 'plaintext'} [props.fixedEncryption]  lock the
 *   encryption to the conversation's method (thread replies must not switch
 *   mid-conversation); the field still shows the level, just disabled
 * @param {() => void} props.onBack
 * @param {(result: { txid?: string | null }) => void} [props.onSent]  called
 *   instead of showing the in-page "Message sent" screen when the send
 *   succeeds; the host navigates (e.g. back to the thread) and surfaces its
 *   own confirmation.
 */
export function ComposeMessage({
    walletId,
    chainId: initialChainId,
    fromAddressId: initialFromAddressId,
    toAddress: initialToAddress,
    initialMessage,
    fixedEncryption,
    onBack,
    onSent,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const signerReady = useSignerReady(walletId);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (initialFromAddressId || null),
    );
    const [toAddress, setToAddress] = useState(initialToAddress || '');
    const [message, setMessage] = useState(initialMessage || '');
    const [password, setPassword] = useState('');
    // Network-fee tier picker (Low / Normal / Fast / Custom), mirroring Send.
    // Custom mode reveals a rate input. Defaults to Normal.
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    // Address-book picker: contacts load once (silently; the picker just shows
    // fewer rows on failure), the icon in the Address field opens the picker.
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));
    const [contactsPickerOpen, setContactsPickerOpen] = useState(false);
    const [pubkeyState, setPubkeyState] = useState(
        /** @type {'idle' | 'checking' | 'found' | 'missing'} */ ('idle'),
    );
    const [sendUnencrypted, setSendUnencrypted] = useState(fixedEncryption === 'plaintext');
    // Encryption choice when the recipient's pubkey is known: 'ecies' (default,
    // only the recipient can read) or 'ecdh' (a shared session key both parties
    // derive, so the sender can read their own sent messages too). ECDH needs
    // our private key to derive the secret, so it's unavailable on hardware.
    const [encryptionChoice, setEncryptionChoice] = useState(
        /** @type {'ecies' | 'ecdh'} */ (fixedEncryption === 'ecdh' ? 'ecdh' : 'ecies'),
    );
    // Tracks a sent ECDH key-exchange request (handshake) so the missing-pubkey
    // branch can confirm it without leaving the compose screen.
    const [handshakeBusy, setHandshakeBusy] = useState(false);
    const [handshakeSent, setHandshakeSent] = useState(false);
    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [hwStatus, setHwStatus] = useState('idle');
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                if (!byChain || Object.keys(byChain).length === 0) {
                    setLoadError('No addresses yet. Use Receive to generate one before sending.');
                    return;
                }
                // Messaging defaults to Dogecoin: a MESSAGE pays a native miner
                // fee, and DOGE is by far the cheapest supported chain, so it
                // keeps sending effectively free. Honor an explicit chain passed
                // from the inbox (e.g. a reply, which must stay on the
                // conversation's chain); otherwise prefer a Dogecoin address the
                // wallet holds, falling back to the first chain if it has none.
                const chainKeys = Object.keys(byChain);
                const dogeChain = chainKeys.find(
                    (cid) => chainRegistry.get(cid)?.coin === 'dogecoin',
                );
                const preferredChain = initialChainId && byChain[initialChainId]
                    ? initialChainId
                    : (dogeChain || chainKeys[0]);
                setChainId((cur) => cur || preferredChain);
                if (!fromAddressId) {
                    const hdAddr = (byChain[preferredChain] || []).find(
                        (a) => a.source === 'hd' || a.source === 'imported-wif',
                    );
                    if (hdAddr) setFromAddressId(hdAddr.id);
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, initialChainId, fromAddressId]);

    useEffect(() => {
        if (typeof messaging.listContacts !== 'function') return undefined;
        let cancelled = false;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setContacts(Array.isArray(rows) ? rows : []); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [messaging]);

    // The recipient's own chain (the message's COIN / where their key is looked
    // up), derived from the address rather than the delivery network: a message
    // can be addressed to a Bitcoin address yet broadcast over Dogecoin. When
    // the coin can't be told from the address (shared testnet/regtest leaders),
    // fall back to the delivery network. `chainId` stays the broadcast/fee chain.
    const destChainId = useMemo(() => {
        if (!chainId) return chainId;
        const network = chainRegistry.get(chainId)?.networkKind;
        const coin = detectAddressCoin(toAddress);
        if (!coin || !network) return chainId;
        return chainRegistry.chainIdFor(coin, network) || chainId;
    }, [toAddress, chainId]);

    useEffect(() => {
        if (!destChainId || !toAddress.trim()) {
            setPubkeyState('idle');
            if (!fixedEncryption) setSendUnencrypted(false);
            return undefined;
        }
        let cancelled = false;
        setPubkeyState('checking');
        const addr = toAddress.trim();
        const handle = setTimeout(() => {
            messaging.getRecipientPubkey({ chainId: destChainId, address: addr })
                .then((pubkey) => {
                    if (cancelled) return;
                    setPubkeyState(pubkey ? 'found' : 'missing');
                    if (pubkey && !fixedEncryption) setSendUnencrypted(false);
                })
                .catch(() => {
                    if (!cancelled) setPubkeyState('missing');
                });
        }, 400);
        return () => { cancelled = true; clearTimeout(handle); };
    }, [destChainId, toAddress, messaging, fixedEncryption]);

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId || !chainId) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, fromAddressId, chainId]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const hw = isHwSource(fromAddress);
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: hw ? fromAddress?.signerId : null,
    });

    // The "Delivery network" options: one per chain the account holds, labeled
    // "Coin (characteristic)" with the coin logo so the user sees the trade-off
    // (Dogecoin fastest + cheapest, Bitcoin slowest + strongest) at a glance.
    // The selected chain (`chainId`) is the network the message is delivered
    // on: it sets COIN, resolves the recipient's pubkey, funds the tx, and
    // pays the fee. Defaults to Dogecoin (see the address-load effect) since
    // it's the cheapest to deliver on.
    const networkOptions = useMemo(() => buildDeliveryNetworkOptions({
        addressesByChain,
        chainRegistry,
        chainIconSmallUrl,
        renderIcon: (url) => <img src={url} alt="" />,
    }), [addressesByChain]);

    // Encryption dropdown rows: a lock for the encrypted methods, an open lock
    // for plain text, each with a one-line "who can read it" note.
    const encryptionOptions = useMemo(() => {
        const opts = [
            { value: 'ecies', label: 'Standard (ECIES)', sub: 'Only the recipient can read it', icon: <Icon.LockIcon /> },
        ];
        if (!hw) {
            opts.push({ value: 'ecdh', label: 'Shared key (ECDH)', sub: 'You and the recipient can read it', icon: <Icon.LockIcon /> });
        }
        opts.push({ value: 'plaintext', label: 'Plain text', sub: 'Anyone can read it', icon: <Icon.UnlockIcon /> });
        return opts;
    }, [hw]);

    // Auto-pick the funding address (first HD/imported address) on the selected
    // delivery network, so the form needs no separate "from address" field.
    useEffect(() => {
        if (!addressesByChain || !chainId) return;
        const addrs = addressesByChain[chainId] || [];
        if (fromAddressId && addrs.some((a) => a.id === fromAddressId)) return;
        const hd = addrs.find((a) => a.source === 'hd' || a.source === 'imported-wif');
        setFromAddressId(hd ? hd.id : null);
    }, [chainId, addressesByChain, fromAddressId]);

    // Network-fee tiers for the selected delivery network, plus the live
    // estimate for the current pick (a tier, or the custom rate). Drives the
    // FeeSelector and the review screen's fee line.
    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId, chainRegistry }),
        [chainId],
    );
    const customEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [chainId, feePick],
    );
    const selectedFeeEstimate = feePick.mode === 'custom'
        ? customEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode }));

    // The picked rate converted to the encoder's feePerKb unit (smallest-unit
    // per KB), so the tier/custom choice actually prices the transaction. Null
    // when there is no usable estimate (e.g. an empty custom rate), which
    // falls back to the encoder's own default pricing.
    const feePerKb = (selectedFeeEstimate && selectedFeeEstimate.unit
        && Number.isFinite(selectedFeeEstimate.rateValue) && selectedFeeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(selectedFeeEstimate.unit, selectedFeeEstimate.rateValue)
        : null;

    // Fiat value of a fee amount, paid on the delivery network. Passed to the
    // FeeSelector so each tier's readout shows its cost in a colored bubble next
    // to the time estimate. Tiny sub-cent fees collapse to "< $0.01".
    // Oracle-primary with CoinGecko fallback (§45, ); the
    // fallback is gated on the privacy.priceDataEnabled setting.
    const { settings } = useSettings();
    const fiatRate = useFiatRate({
        chainCoin: chainRegistry.get(chainId)?.coin,
        fiatCurrency: 'USD',
        allowCoingeckoFallback: settings?.privacy?.priceDataEnabled !== false,
    });
    const fiatForFee = useMemo(() => (coinAmount) => {
        const v = coinToFiat(coinAmount, fiatRate);
        if (v == null || !Number.isFinite(v) || v <= 0) return null;
        return v < 0.01 ? '< $0.01' : `$${v.toFixed(2)}`;
    }, [fiatRate]);

    // Catch random text before review. A message can be delivered on any chain
    // regardless of the recipient's chain, so the address is validated only as a
    // real address (any supported network), NOT against the delivery network.
    // Only flags once the user has typed something.
    const addressInvalid = useMemo(
        () => Boolean(toAddress.trim()) && !isValidAddressAnyNetwork(toAddress),
        [toAddress],
    );
    const addressError = addressInvalid ? 'Enter a valid address' : undefined;

    // The selected encryption, as a single dropdown value. 'plaintext' maps to
    // the unencrypted (v3) send; 'ecies'/'ecdh' are the encrypted methods.
    const encryptionValue = sendUnencrypted ? 'plaintext' : encryptionChoice;
    function onEncryptionChange(value) {
        if (value === 'plaintext') { setSendUnencrypted(true); return; }
        setSendUnencrypted(false);
        setEncryptionChoice(value);
    }

    //  §5.6 slice 3: sends compose ONE PSBT host-side and confirm it on
    // the shared confirm page. Two carve-outs stay on the legacy review stage:
    // the demo wallet (its send is faked, there is nothing to compose), and a
    // LOCKED wallet sending ECDH - that method needs our own private key to
    // derive the shared secret at COMPOSE time, and on this path the password
    // isn't collected until the confirm page. ECIES and plaintext compose fine
    // while locked. : hardware is NOT a carve-out here - ECDH is not even
    // offered to a HW source (the dropdown omits it), so every method a device
    // can send composes without a private key.
    const isDemo = flowsLib.isDemoWallet(walletId);
    const needsKeyToCompose = !sendUnencrypted && encryptionChoice === 'ecdh' && !hw;
    const actionConfirm = useActionConfirmFlow({ messaging, walletId, slice: 'bespokeFlows' });
    const singleEncode = !isDemo
        && (!needsKeyToCompose || signerReady);
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'messageAction',
        hardware: 'messageActionHw',
    });

    // Encrypt + compose + tamper-check + pre-flight all run HOST-side; Approve
    // signs the byte-identical prebuilt PSBT over the SAME ciphertext (passed
    // back as `prebuiltParams`, since re-encrypting would change the bytes).
    async function openConfirmScreen() {
        const from = {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
        // chainId = the recipient's chain (sets COIN, resolves their key);
        // broadcastChainId = the delivery network that funds + pays the fee.
        const base = {
            walletId,
            chainId: destChainId,
            broadcastChainId: chainId,
            from,
            destination: toAddress.trim(),
            message,
            method: sendUnencrypted ? null : (encryptionChoice === 'ecdh' && !hw ? 2 : 1),
            ...(feePerKb != null ? { feePerKb } : {}),
        };
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                // Pre-flight and the signing lane both belong to the DELIVERY
                // network: that is the chain the transaction lands on.
                chainId,
                from,
                compose: () => messaging.composeMessageForConfirm(base),
                onApprove: (prebuiltPsbt, composed) => submitConfirmed({
                    ...base,
                    prebuiltParams: composed.messageParams,
                    prebuiltPsbt,
                }),
            });
            setPassword('');
            if (onSent) { onSent(res); return; }
            setResult(res);
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            if (err?.name === 'PubkeyNotFoundError') {
                setPubkeyState('missing');
                setSubmitError("The recipient's encryption key is no longer available. Refresh and try again.");
                return;
            }
            setSubmitError(err?.message || 'Send failed.');
        }
    }

    // Form submit: run the same guards that gate a real send, then move to the
    // review stage. No signing or broadcast happens here; the message is only
    // sent once the user confirms on the review screen via handleSubmit.
    function handleReview(event) {
        event.preventDefault();
        if (stage !== 'form') return;
        if (!fromAddress || !chainId || !toAddress.trim() || !message.trim()) return;
        if (addressInvalid) return;
        // Plain text needs no recipient key, so it never waits on (or is blocked
        // by) the pubkey lookup; encrypted sends require a resolved key.
        if (!sendUnencrypted && (pubkeyState === 'missing' || pubkeyState === 'checking')) return;
        setSubmitError(null);
        // On the confirm-page path the password is collected IN the modal, so
        // the credential guards below (which the legacy review stage relies on)
        // must not gate getting there.
        if (singleEncode) { openConfirmScreen(); return; }
        if (!hw && !signerReady && password.length === 0) return;
        if (hw && hwStatus !== 'available') return;
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!fromAddress || !chainId || !toAddress.trim() || !message.trim()) return;
        if (addressInvalid) return;
        if (!sendUnencrypted && pubkeyState === 'missing') return;
        if (!hw && !signerReady && password.length === 0) return;
        if (hw && hwStatus !== 'available') return;

        setStage('submitting');
        setSubmitError(null);

        // Demo wallet: the counterparties are fabricated addresses with no
        // real keys or UTXOs, so a real encrypt/sign/broadcast can only fail
        // (e.g. the pubkey-derivation guard). Pretend the send succeeded.
        if (flowsLib.isDemoWallet(walletId)) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            if (onSent) { onSent({ txid: null }); return; }
            setResult({ txid: null });
            setStage('done');
            return;
        }
        try {
            const base = {
                walletId,
                // chainId = the recipient's chain (sets COIN, resolves their
                // key); broadcastChainId = the delivery network that funds + pays
                // the fee. They differ when messaging e.g. a BTC address via DOGE.
                chainId: destChainId,
                broadcastChainId: chainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                destination: toAddress.trim(),
                message: message,
                method: sendUnencrypted
                    ? null
                    : (encryptionChoice === 'ecdh' && !hw ? 2 : 1),
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            const r = hw
                ? await messaging.messageActionHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.messageAction({ ...base, password });
            if (onSent) { onSent(r); return; }
            setResult(r);
            setStage('done');
        } catch (err) {
            const name = err?.name;
            if (name === 'InvalidPasswordError') {
                setSubmitError('Incorrect password.');
            } else if (name === 'PubkeyNotFoundError') {
                setSubmitError("The recipient's encryption key is no longer available. Refresh and try again.");
                setPubkeyState('missing');
            } else {
                setSubmitError(err?.message || 'Send failed.');
            }
            setStage('review');
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    // Publish our pubkey to the recipient (MESSAGE format-0 handshake) so they
    // can derive the ECDH shared secret and message us, even before our address
    // has spent. Used when the recipient's key is unknown: it requests a session
    // rather than sending an (impossible to encrypt) message.
    async function handleRequestSession() {
        if (handshakeBusy || !fromAddress || !chainId || !toAddress.trim()) return;
        if (!hw && !signerReady && password.length === 0) {
            setSubmitError('Enter your password to send the key request.');
            return;
        }
        if (hw && hwStatus !== 'available') return;
        setHandshakeBusy(true);
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
                destination: toAddress.trim(),
                version: 0,
            };
            await (hw
                ? messaging.sendHandshakeHw({ ...base, signerId: fromAddress.signerId })
                : messaging.sendHandshake({ ...base, password }));
            setHandshakeSent(true);
        } catch (err) {
            setSubmitError(err?.message || 'Could not send the key request.');
        } finally {
            setHandshakeBusy(false);
        }
    }

        const header = (
        <PageHeader
            onBack={stage === 'review' ? () => setStage('form') : onBack}
            title={stage === 'review' || stage === 'submitting' ? 'Review message' : 'New message'}
            titleIcon={<Icon.MessageIcon />}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{loadError}</div>
                <div className={styles.actions}>
                </div>
            </>,
        );
    }

    if (!addressesByChain) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    if (stage === 'done') {
        return wrap(
            <>
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Message sent</p>
                {result?.txid ? (
                    <p style={{ margin: '0 0 0.5rem' }}>
                        Transaction: <code>{result.txid}</code>
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        // Fee reflects the picked tier/custom rate on the delivery network.
        const fee = selectedFeeEstimate;
        const ticker = descriptor?.coin
            ? (NATIVE_TICKER_BY_CHAIN[descriptor.coin] || descriptor.coin.toUpperCase())
            : '';
        const feeText = fee
            ? `${fee.coinAmount} ${ticker}`.trim() + (fee.rate ? ` (${fee.rate})` : '')
            : 'Estimate unavailable';
        // Plain text is whatever the user selected, not only the pubkey-missing
        // fallback: they can deliberately send plaintext even to a known key.
        const unencrypted = sendUnencrypted;
        const encryptionLabel = unencrypted
            ? 'Plain text'
            : (encryptionChoice === 'ecdh' && !hw ? 'ECDH' : 'ECIES');
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    Send an {unencrypted ? 'unencrypted' : 'encrypted'} message to this recipient.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <DetailRow
                        label="To"
                        value={<AddressText address={toAddress.trim()} />}
                    />
                    <DetailRow label="Encryption" value={encryptionLabel} />
                    <DetailRow label="Network fee" value={feeText} />
                    <DetailRow
                        label="Message"
                        value={(
                            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {message}
                            </span>
                        )}
                    />
                </dl>

                <SignCredentials
                    fromAddress={fromAddress}
                    chainId={chainId}
                    unlocked={signerReady}
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
                {hw && submitError ? (
                    <p role="alert" style={{ margin: '0.25rem 0 0', color: '#ef5350', fontSize: '0.75rem' }}>
                        {submitError}
                    </p>
                ) : null}

                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        block
                        loading={stage === 'submitting'}
                        disabled={hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        {hw
                            ? `Sign on ${fromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : 'Confirm send'}
                    </Button>
                </div>
            </form>,
        );
    }

    //  confirm page, rendered in place of the form; form state stays
    // intact behind it, so Reject returns the user to their draft. The intent
    // is decoded from the params the HOST actually composed (the encrypted
    // body), never from form state - §1: confirm what will broadcast.
    if (actionConfirm.open) {
        const fee = selectedFeeEstimate;
        const ticker = descriptor?.coin
            ? (NATIVE_TICKER_BY_CHAIN[descriptor.coin] || descriptor.coin.toUpperCase())
            : '';
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeText={fee?.coinAmount
                    ? `Network fee: ${fee.coinAmount} ${ticker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // : hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    // Address-book picker: rendered in place of the form when the user taps
    // the contacts icon in the Address field. Selecting a row fills the field
    // and returns to the form with all other state intact.
    if (contactsPickerOpen) {
        return (
            <ContactsPickerScreen
                contacts={contacts}
                variant={variant}
                onPick={(entry) => {
                    setToAddress(entry.address);
                    setContactsPickerOpen(false);
                }}
                onBack={() => setContactsPickerOpen(false)}
            />
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            {/* 1. Address (recipient), with an address-book shortcut */}
            <AddressField
                label="Address"
                icon="contacts"
                value={toAddress}
                onChange={(e) => setToAddress(e.target.value)}
                onIconClick={() => setContactsPickerOpen(true)}
                placeholder="Recipient address"
                error={addressError}
            />

            {/* 2. Message */}
            <Textarea
                label="Message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={isFull ? 6 : 4}
                placeholder="Write your message…"
                style={{ minHeight: isFull ? '6rem' : '4rem' }}
            />

            {/* 3. Encryption. Locked (still visible) for thread replies: a
                conversation keeps the method it started with. */}
            <IconSelect
                label="Encryption"
                value={encryptionValue}
                onChange={onEncryptionChange}
                options={encryptionOptions}
                disabled={Boolean(fixedEncryption)}
            />
            {pubkeyState === 'checking' && encryptionValue !== 'plaintext' ? (
                <p className={styles.hint} style={{ marginTop: '0.25rem' }}>
                    Looking up recipient's public key…
                </p>
            ) : null}
            {pubkeyState === 'found' && encryptionValue !== 'plaintext' ? (
                <p className={styles.hint} style={{ marginTop: '0.25rem' }}>
                    ✓ Recipient public key found.
                </p>
            ) : null}
            {pubkeyState === 'missing' && encryptionValue !== 'plaintext' ? (
                <div
                    role="alert"
                    style={{
                        border: '1px solid #f59e0b',
                        borderRadius: '4px',
                        padding: '0.5rem',
                        marginTop: '0.25rem',
                        fontSize: '0.85rem',
                    }}
                >
                    <p style={{ margin: '0 0 0.5rem' }}>
                        We don't know the recipient's public key yet, so we can't encrypt. They need to
                        send a transaction first, or pick "Plain text" above.
                    </p>
                    {handshakeSent ? (
                        <p style={{ margin: 0 }} role="status">
                            ✓ Key request sent. Once they respond or send any transaction, you can
                            message them encrypted.
                        </p>
                    ) : (
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            loading={handshakeBusy}
                            onClick={handleRequestSession}
                        >
                            Request encrypted session (publish your key)
                        </Button>
                    )}
                </div>
            ) : null}

            {/* 4. Delivery network */}
            <IconSelect
                label="Delivery network"
                value={chainId || ''}
                onChange={(v) => { setChainId(v); setFromAddressId(null); }}
                options={networkOptions}
            />

            {/* 5. Network fee (Low / Normal / Fast / Custom slider) */}
            {feeTiers ? (
                <FeeSelector
                    label="Network fee"
                    coinTicker={descriptor?.coin ? (NATIVE_TICKER_BY_CHAIN[descriptor.coin] || descriptor.coin.toUpperCase()) : ''}
                    formatFiat={fiatForFee}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feePick.mode === 'custom' ? customEstimate : null}
                />
            ) : null}

            <div className={styles.actions} style={{ marginTop: '0.75rem' }}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    icon={<Icon.SendIcon />}
                    loading={actionConfirm.composing}
                    disabled={!fromAddress
                        || !toAddress.trim()
                        || addressInvalid
                        || !message.trim()
                        || actionConfirm.composing
                        || (!sendUnencrypted && (pubkeyState === 'missing' || pubkeyState === 'checking'))}
                >
                    Send message
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
