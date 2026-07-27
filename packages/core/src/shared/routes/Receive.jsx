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
import QRCode from 'qrcode';
import {
    Screen,
    PageHeader,
    ChainBadge,
    AddressText,
    AddressField,
    Button,
    CopyButton,
    MultisigBadge,
    FeeSelector,
    Icon,
} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    uri as uriLib,
    branding as brandingLib,
} from '@xchain-wallet/core';
import {
    estimateNativeSendFeeTiers,
    fetchNativeSendFeeTiers,
} from '../../flows/feeEstimate.js';
import { coinToFiat, fiatToCoin } from '../../flows/priceLookup.js';
import { useFiatRate } from '../hooks/useFiatRate.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { tickerColor } from '../components/BalanceList.jsx';
import { useToast } from '../components/ToastHost.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { AddAddressModal } from './AddAddressModal.jsx';
import {
    formatWithThousands,
    countNonCommaBefore,
    indexAfterNonCommaCount,
} from '../utils/amountFormat.js';
import styles from './Receive.module.css';

const chainRegistry = registryLib.defaultRegistry();

// descriptor.coin is the long coin name ('bitcoin' / 'litecoin' / 'dogecoin');
// the user-facing native ticker is the short symbol ('BTC' / 'LTC' / 'DOGE').
// Uppercasing descriptor.coin directly leaks 'BITCOIN' into hints and labels.
const NATIVE_TICKER_BY_COIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
function nativeTickerFor(descriptor) {
    if (!descriptor?.coin) return null;
    return NATIVE_TICKER_BY_COIN[descriptor.coin] || descriptor.coin.toUpperCase();
}

/**
 * Receive view: pick a chain, show the newest persisted HD address as
 * a BIP21-encoded QR, copy-to-clipboard, and optionally derive a fresh
 * next-index address (prompts password, because seed decryption runs
 * Argon2id on each derivation per §26).
 *
 * Chain picker options are filtered to the chains this wallet has at
 * least one address on; a later piece may add "add a chain" when the
 * wallet is ready to grow into a new registry entry.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]   active BIP44 account; when set, scopes addresses + new-receive derivation to that account
 * @param {{ chainId?: string, tick?: string, kind?: string, displayName?: string, imageUrl?: string | null }} [props.prefill]
 *        Selection from ReceivePicker. `chainId` becomes the active
 *        chain; `tick` pre-fills the Token field unless it matches the
 *        chain's native ticker (no point encoding `?tick=BTC` on a
 *        BTC-native QR).
 * @param {() => void} [props.onBack]
 * @param {() => void} [props.onChangeAsset]   tapped from the asset card; should navigate to the picker. Falls back to `onBack` when omitted.
 */
export function Receive({ walletId, accountId, prefill = null, onBack, onChangeAsset }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const { showToast } = useToast();
    const { settings } = useSettings();

    const [chainsByWallet, setChainsByWallet] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [activeChainId, setActiveChainId] = useState(
        /** @type {string | null} */ (prefill?.chainId || null),
    );
    const [address, setAddress] = useState(/** @type {any | null} */ (null));
    // Receive-address picker: the QR icon on the Address field opens the
    // wallet's own address list for the active chain; picking one becomes
    // the address the QR / request encodes. A chain switch re-runs the
    // newest-address effect and resets the pick, which is the right
    // default for a new chain.
    const [addressPickerOpen, setAddressPickerOpen] = useState(false);
    const [qrDataUrl, setQrDataUrl] = useState(/** @type {string | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    // : "the account holds no address anywhere" is a state, not an
    // error. It used to render as a red alert string and nothing else, so
    // Receive - the very screen Home tells you to use to generate one -
    // dead-ended. It now carries the cure: a CTA onto Add addresses,
    // whose coin list reaches past the (empty) occupied set .
    // Unreachable while seeding works; this is the fallback surface for
    // when it doesn't.
    const [noAddresses, setNoAddresses] = useState(false);
    const [addAddressOpen, setAddAddressOpen] = useState(false);
    // Bumped after a generate so the chain list + newest address reload.
    const [reloadKey, setReloadKey] = useState(0);

    // §17.6 hardware receive-address confirmation. HW addresses are
    // host-mediated, so a compromised computer could swap the deposit
    // address the wallet shows. The user confirms it on the device's
    // trusted screen before depositing. status: idle | checking |
    // confirmed | mismatch | error.
    const [hwVerify, setHwVerify] = useState(
        /** @type {{ status: string, message: string }} */ ({ status: 'idle', message: '' }),
    );

    // §22 + §42.9 multisig receive integration. When the wallet has a
    // persisted MultisigConfig (Step 17) and the active chain is a
    // valid network for that config, we fetch and surface the
    // multisig output address alongside the regular single-key QR.
    // §56.3 pre-launch Step 4: multiple multisig configs per wallet.
    // Receive renders one section per config; the QR map keys QR data
    // URLs by config id so each section shows its own QR alongside
    // the badge + cosigner names.
    const [multisigs, setMultisigs] = useState(
        /** @type {Array<{ multisigConfigId: string, address: string, schemeLabel: string, threshold: number, cosignerCount: number, cosignerNames: string[], scheme: string }>} */ ([]),
    );
    const [multisigQrs, setMultisigQrs] = useState(/** @type {Record<string, string>} */ ({}));

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const byChain = await messaging.getAddressesByChain(walletId, accountId);
                if (cancelled) return;
                setChainsByWallet(byChain);
                const firstChain = Object.keys(byChain || {})[0];
                if (firstChain) {
                    // Preserve a chainId set by ReceivePicker prefill so
                    // the user lands on the chain they actually picked.
                    setActiveChainId((prev) => prev || firstChain);
                    setNoAddresses(false);
                } else {
                    setNoAddresses(true);
                }
            } catch (err) {
                if (!cancelled) {
                    setLoadError(err?.message || 'Failed to load addresses.');
                }
            }
        })();
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging, reloadKey]);

    useEffect(() => {
        if (!activeChainId) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const newest = await messaging.getNewestAddress(
                    walletId,
                    activeChainId,
                    accountId,
                );
                if (!cancelled) setAddress(newest);
            } catch (err) {
                if (!cancelled) {
                    setLoadError(err?.message || 'Failed to load address.');
                }
            }
        })();
        return () => { cancelled = true; };
        // reloadKey: a generate lands a new newest-index address on the
        // chain already selected, which the chain-list effect alone would
        // not pick up.
    }, [walletId, accountId, activeChainId, messaging, reloadKey]);

    // §17.6: is the shown address backed by a hardware signer? Only those
    // need (and support) on-device confirmation. Reset the verify state
    // whenever the shown address changes.
    const isHwAddress = !!address && (address.source === 'trezor' || address.source === 'ledger');
    const hwDeviceLabel = address?.source === 'ledger'
        ? 'Ledger'
        : address?.source === 'trezor' ? 'Trezor' : 'device';
    useEffect(() => {
        setHwVerify({ status: 'idle', message: '' });
    }, [address?.id]);

    const verifyOnDevice = useCallback(async () => {
        if (!address || !activeChainId) return;
        if (typeof messaging.verifyReceiveAddress !== 'function') {
            setHwVerify({ status: 'error', message: 'This app cannot verify on device.' });
            return;
        }
        setHwVerify({ status: 'checking', message: '' });
        try {
            const res = await messaging.verifyReceiveAddress({
                walletId,
                chainId: activeChainId,
                addressId: address.id,
                signerId: address.signerId,
            });
            if (res?.confirmed) {
                setHwVerify({ status: 'confirmed', message: '' });
            } else {
                setHwVerify({ status: 'mismatch', message: '' });
            }
        } catch (err) {
            if (err?.name === 'HardwareAddressMismatchError') {
                setHwVerify({ status: 'mismatch', message: '' });
            } else {
                setHwVerify({ status: 'error', message: err?.message || 'Verification failed.' });
            }
        }
    }, [address, activeChainId, walletId, messaging]);

    // Derive the multisig output address whenever chain changes, if
    // this wallet has a MultisigConfig. Failures are non-fatal; we
    // simply don't render the multisig panel (e.g. wallet has no
    // multisig config, or the active chain doesn't match the config's
    // network kind). The single-key flow continues to work either way.
    useEffect(() => {
        if (!activeChainId) {
            setMultisigs([]);
            setMultisigQrs({});
            return undefined;
        }
        let cancelled = false;
        if (typeof messaging.listMultisigReceiveAddresses === 'function') {
            messaging.listMultisigReceiveAddresses({ walletId, chainId: activeChainId })
                .then((list) => {
                    if (cancelled) return;
                    setMultisigs(Array.isArray(list) ? list : []);
                })
                .catch(() => { if (!cancelled) setMultisigs([]); });
        } else if (typeof messaging.getMultisigReceiveAddress === 'function') {
            // Backward compat: shells pinned before pre-launch Step 4
            // ship only the singular helper.
            messaging.getMultisigReceiveAddress({ walletId, chainId: activeChainId })
                .then((rec) => {
                    if (cancelled) return;
                    setMultisigs(rec ? [rec] : []);
                })
                .catch(() => { if (!cancelled) setMultisigs([]); });
        }
        return () => { cancelled = true; };
    }, [walletId, activeChainId, messaging]);

    useEffect(() => {
        if (!multisigs || multisigs.length === 0) {
            setMultisigQrs({});
            return undefined;
        }
        const descriptor = chainRegistry.get(activeChainId ?? '');
        let cancelled = false;
        Promise.all(multisigs.map(async (m) => {
            const uri = descriptor
                ? uriLib.encodeBip21Uri({ scheme: descriptor.uriScheme, address: m.address })
                : m.address;
            try {
                const dataUrl = await QRCode.toDataURL(uri, {
                    errorCorrectionLevel: 'M',
                    margin: 2,
                    width: 512,
                    color: { dark: '#0F172A', light: '#FFFFFF' },
                });
                return [m.multisigConfigId, dataUrl];
            } catch {
                return [m.multisigConfigId, null];
            }
        })).then((entries) => {
            if (cancelled) return;
            const next = {};
            for (const [id, url] of entries) if (url) next[id] = url;
            setMultisigQrs(next);
        });
        return () => { cancelled = true; };
    }, [multisigs, activeChainId]);

    // Unified QR effect lives below; see the `qrUri` memo. Driven by
    // address + active chain + the optional amount/tick customization.

    const descriptor = activeChainId ? chainRegistry.get(activeChainId) : null;

    // Inline payment-request fields, visible by default so customizing
    // the QR is a single-glance affair. As the amount changes, the QR
    // re-renders. Token tick seeds from a non-native ReceivePicker prefill
    // so the QR encodes the requested token without manual entry.
    const [reqAmount, setReqAmount] = useState('');
    const [reqTick, setReqTick] = useState(() => {
        if (!prefill?.tick || !prefill?.chainId) return '';
        const desc = chainRegistry.get(prefill.chainId);
        const nativeTicker = nativeTickerFor(desc);
        if (nativeTicker && prefill.tick.toUpperCase() === nativeTicker) return '';
        return prefill.tick.toUpperCase();
    });
    const [feePick, setFeePick] = useState(/** @type {{ mode: 'low' | 'normal' | 'fast' }} */ ({ mode: 'normal' }));
    const [feeTiers, setFeeTiers] = useState(/** @type {any} */ (null));

    // Fiat-aware amount entry, mirrors Send. Canonical `reqAmount` stays
    // coin-scale (it's what the QR/URI encodes); when the user toggles
    // to fiat mode we edit `fiatAmount` and derive the coin value via
    // priceLookup. Fiat support is only meaningful for the chain's
    // native asset; we hide the toggle for non-native token requests.
    const [amountInputMode, setAmountInputMode] = useState(/** @type {'coin' | 'fiat'} */ ('coin'));
    const [fiatAmount, setFiatAmount] = useState('');
    const amountInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const fiatCurrency = settings?.fiatCurrency || 'USD';
    const isNativeRequest = useMemo(() => {
        const t = reqTick.trim().toUpperCase();
        if (!t) return true;
        const native = nativeTickerFor(activeChainId ? chainRegistry.get(activeChainId) : null);
        return native ? t === native : false;
    }, [reqTick, activeChainId]);
    // Oracle-primary with CoinGecko fallback (§45, ); the
    // fallback is gated on the privacy.priceDataEnabled setting.
    const fiatRate = useFiatRate({
        chainCoin: isNativeRequest && activeChainId
            ? chainRegistry.get(activeChainId)?.coin
            : null,
        fiatCurrency,
        allowCoingeckoFallback: settings?.privacy?.priceDataEnabled !== false,
    });

    const onAmountFieldChange = useCallback((rawValue, cursorPos) => {
        const stripped = String(rawValue).replace(/,/g, '');
        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
        if (amountInputMode === 'fiat') {
            setFiatAmount(stripped);
            if (!fiatRate) {
                if (stripped === '') setReqAmount('');
            } else {
                const derivedCoin = fiatToCoin(stripped, fiatRate);
                setReqAmount(derivedCoin != null ? derivedCoin : '');
            }
        } else {
            setReqAmount(stripped);
        }
        if (typeof cursorPos === 'number' && amountInputRef.current) {
            const formattedNew = formatWithThousands(stripped);
            const nonCommaBefore = countNonCommaBefore(String(rawValue), cursorPos);
            const nextCursor = indexAfterNonCommaCount(formattedNew, nonCommaBefore);
            const el = amountInputRef.current;
            requestAnimationFrame(() => {
                if (el && document.activeElement === el) {
                    try { el.setSelectionRange(nextCursor, nextCursor); } catch { /* selection unavailable */ }
                }
            });
        }
    }, [amountInputMode, fiatRate]);

    const toggleAmountInputMode = useCallback(() => {
        if (!fiatRate) return;
        setAmountInputMode((prev) => {
            if (prev === 'coin') {
                const fv = reqAmount ? coinToFiat(reqAmount, fiatRate) : null;
                setFiatAmount(fv != null ? fv.toFixed(2) : '');
                return 'fiat';
            }
            setFiatAmount('');
            return 'coin';
        });
    }, [reqAmount, fiatRate]);

    // If the request switches to a non-native token mid-edit, fiat
    // mode loses its rate; fall back to coin entry so the input
    // doesn't show an empty fiat label with no toggle.
    useEffect(() => {
        if (!fiatRate && amountInputMode === 'fiat') {
            setAmountInputMode('coin');
            setFiatAmount('');
        }
    }, [fiatRate, amountInputMode]);

    useEffect(() => {
        if (!activeChainId) {
            setFeeTiers(null);
            return undefined;
        }
        setFeeTiers(estimateNativeSendFeeTiers({ chainId: activeChainId, chainRegistry }));
        let cancelled = false;
        fetchNativeSendFeeTiers({ messaging, chainId: activeChainId, chainRegistry })
            .then((tiers) => { if (!cancelled && tiers) setFeeTiers(tiers); })
            .catch(() => { /* keep the placeholder seed */ });
        return () => { cancelled = true; };
    }, [activeChainId, messaging]);

    const nativeTicker = nativeTickerFor(descriptor);

    // QR content. When the user has set an amount (or has a token tick),
    // encode an `xchain:CODE/send?to=…&amount=…&tick=…` URI; the receiver
    // (another XChain wallet) lands on Send with chain + token + amount
    // pre-filled. When nothing is customized, fall back to a bare BIP21 URI
    // (`bitcoin:`/`litecoin:`/`dogecoin:`) so external wallets that only
    // understand BIP21 can still pay the bare address.
    const qrUri = useMemo(() => {
        if (!address || !descriptor || !activeChainId) return null;
        const amount = reqAmount.trim();
        const tick = reqTick.trim().toUpperCase();
        const feePriority = feePick?.mode || 'normal';
        try {
            return uriLib.buildXchainUri(
                {
                    chainId: activeChainId,
                    action: 'send',
                    address: address.address,
                    amount: amount || undefined,
                    tick: tick || undefined,
                    feePriority,
                },
                { chainRegistry },
            );
        } catch {
            // Chain isn't mapped to a coin code yet; fall through to BIP21
            // (BIP21 has no feePriority slot; receiver's preference is dropped).
            return uriLib.encodeBip21Uri({
                scheme: descriptor.uriScheme,
                address: address.address,
            });
        }
    }, [address, descriptor, activeChainId, reqAmount, reqTick, feePick]);

    useEffect(() => {
        if (!qrUri) {
            setQrDataUrl(null);
            return undefined;
        }
        let cancelled = false;
        QRCode.toDataURL(qrUri, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 512,
            color: { dark: '#0F172A', light: '#FFFFFF' },
        })
            .then((dataUrl) => { if (!cancelled) setQrDataUrl(dataUrl); })
            .catch(() => { if (!cancelled) setQrDataUrl(null); });
        return () => { cancelled = true; };
    }, [qrUri]);

    // QR image actions. The Copy button writes the rendered PNG to the
    // clipboard as an image (not as text) so the user can paste it into
    // chat / email like any other image. Share does the same write and
    // then opens the platform share sheet. We feature-detect file-share
    // support and hide the Share button on browsers that can't take a
    // File via navigator.share (older Chromium on desktop, mainly).
    const canShareFiles = useMemo(() => {
        if (typeof navigator === 'undefined') return false;
        if (typeof navigator.share !== 'function') return false;
        if (typeof navigator.canShare !== 'function') return false;
        try {
            const probe = new File([new Uint8Array([0])], 'probe.png', { type: 'image/png' });
            return navigator.canShare({ files: [probe] });
        } catch {
            return false;
        }
    }, []);

    const qrFileName = useMemo(() => {
        const addrPart = address?.address ? address.address.slice(0, 8) : 'address';
        const chainPart = descriptor?.id || activeChainId || 'qr';
        return `xchain-${chainPart}-${addrPart}.png`;
    }, [address?.address, descriptor?.id, activeChainId]);

    const copyQrImage = useCallback(async () => {
        if (!qrDataUrl) return;
        try {
            const blob = await (await fetch(qrDataUrl)).blob();
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
            showToast({ message: 'QR code copied to clipboard.' });
        } catch (err) {
            showToast({ message: `Copy failed: ${err?.message || 'clipboard unavailable'}` });
        }
    }, [qrDataUrl, showToast]);

    const shareQrImage = useCallback(async () => {
        if (!qrDataUrl) return;
        let blob;
        try {
            blob = await (await fetch(qrDataUrl)).blob();
        } catch (err) {
            showToast({ message: `Share failed: ${err?.message || 'could not read QR image'}` });
            return;
        }
        // Mirror the Copy action first so the user always ends up with
        // the image on the clipboard, regardless of which share target
        // they pick. Clipboard failures are non-fatal; proceed to share.
        try {
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        } catch { /* keep going */ }
        try {
            const file = new File([blob], qrFileName, { type: blob.type });
            await navigator.share({
                files: [file],
                title: 'XChain receive QR',
                text: address?.address || '',
            });
        } catch (err) {
            if (err?.name === 'AbortError') return; // user dismissed sheet
            showToast({ message: `Share failed: ${err?.message || 'share unavailable'}` });
        }
    }, [qrDataUrl, address?.address, qrFileName, showToast]);

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to home"
            title="Receive"
            titleIcon={<Icon.ReceiveIcon />}
        />
    );
    if (addressPickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Receive address"
                walletId={walletId}
                accountId={accountId}
                chainId={activeChainId}
                onPick={(a) => {
                    setAddress(a);
                    setAddressPickerOpen(false);
                }}
                onBack={() => setAddressPickerOpen(false)}
            />
        );
    }
    if (addAddressOpen) {
        return (
            <AddAddressModal
                walletId={walletId}
                accountId={accountId}
                chainIds={Object.keys(chainsByWallet || {})}
                onClose={() => setAddAddressOpen(false)}
                onGenerated={() => setReloadKey((k) => k + 1)}
            />
        );
    }

    const body = (
        <>
            {loadError ? (
                <div role="alert" className={styles.error}>{loadError}</div>
            ) : null}

            {noAddresses ? (
                <div className={styles.emptyState}>
                    <p className={styles.hint}>
                        No addresses yet on any chain. Generate one to start receiving.
                    </p>
                    <Button
                        variant="primary"
                        size="md"
                        onClick={() => setAddAddressOpen(true)}
                        icon={<Icon.PlusIcon />}
                    >
                        Generate an address
                    </Button>
                </div>
            ) : null}

            {address && qrDataUrl ? (
                <div className={styles.qrBox}>
                    <img
                        src={qrDataUrl}
                        alt={`QR code for ${address.address}`}
                        width={512}
                        height={512}
                        className={styles.qr}
                    />
                </div>
            ) : address ? (
                <div className={styles.qrBox} aria-hidden="true">
                    <div className={styles.qrPlaceholder}>Rendering QR…</div>
                </div>
            ) : null}

            {address ? (
                <AddressField
                    label="Address"
                    icon="addresses"
                    value={address.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setAddressPickerOpen(true)}
                    iconLabel="Choose receive address"
                />
            ) : null}

            {descriptor ? (() => {
                const prefillTickUpper = prefill?.tick ? prefill.tick.toUpperCase() : '';
                const isTokenSelection = !!prefillTickUpper
                    && nativeTicker
                    && prefillTickUpper !== nativeTicker;
                // Standard token field: shows the selected token (or the
                // chain's native coin) and reopens the picker to change it.
                return (
                    <TokenField
                        label="Token"
                        value={{
                            chainId: descriptor.id,
                            tick: isTokenSelection ? prefillTickUpper : (nativeTicker || ''),
                        }}
                        onOpenPicker={onChangeAsset || onBack}
                    />
                );
            })() : null}

            {address ? (
                <>
                    <AmountField
                        amount={reqAmount}
                        fiatAmount={fiatAmount}
                        tick={reqTick.trim() || nativeTicker || ''}
                        fiatRate={fiatRate}
                        fiatCurrency={fiatCurrency}
                        amountInputMode={amountInputMode}
                        onAmountFieldChange={onAmountFieldChange}
                        toggleAmountInputMode={toggleAmountInputMode}
                        inputRef={amountInputRef}
                    />
                    <FeeSelector
                        label="Network fee"
                        coinTicker={nativeTickerFor(descriptor)}
                        tiers={feeTiers}
                        value={feePick}
                        onChange={setFeePick}
                        allowCustom={false}
                        disabled={!feeTiers}
                    />
                    <div className={styles.qrActions}>
                        <Button
                            variant="secondary"
                            onClick={copyQrImage}
                            disabled={!qrDataUrl}
                            icon={<Icon.CopyIcon />}
                        >
                            Copy QR
                        </Button>
                        {canShareFiles ? (
                            <Button
                                variant="secondary"
                                onClick={shareQrImage}
                                disabled={!qrDataUrl}
                                icon={<Icon.UploadIcon />}
                            >
                                Share QR
                            </Button>
                        ) : null}
                    </div>

                    {isHwAddress ? (
                        <section
                            role="group"
                            aria-label="Confirm this address on your hardware wallet"
                            className={styles.hwVerify}
                        >
                            <div className={styles.addressBox}>
                                <AddressText address={address.address} truncate={false} size="sm" />
                                <CopyButton value={address.address} />
                            </div>
                            {hwVerify.status === 'confirmed' ? (
                                <p className={styles.hint} role="status">
                                    ✅ Confirmed on your {hwDeviceLabel}. Safe to share.
                                </p>
                            ) : hwVerify.status === 'mismatch' ? (
                                <div role="alert" className={styles.error}>
                                    Your {hwDeviceLabel} showed a different address. Do not deposit here.
                                    Disconnect and re-pair the device.
                                </div>
                            ) : hwVerify.status === 'error' ? (
                                <div role="alert" className={styles.error}>{hwVerify.message}</div>
                            ) : (
                                <p className={styles.hint}>
                                    Verify this address on your {hwDeviceLabel} before depositing, so a
                                    compromised computer cannot swap it.
                                </p>
                            )}
                            <Button
                                variant="secondary"
                                onClick={verifyOnDevice}
                                disabled={hwVerify.status === 'checking'}
                            >
                                {hwVerify.status === 'checking'
                                    ? `Check your ${hwDeviceLabel}…`
                                    : `Verify on your ${hwDeviceLabel}`}
                            </Button>
                        </section>
                    ) : null}
                </>
            ) : null}

            {multisigs.map((multisig) => (
                <section
                    key={multisig.multisigConfigId}
                    role="group"
                    aria-label="Multisig receive address"
                    style={{
                        marginTop: 'var(--xc-space-3)',
                        padding: 'var(--xc-space-3)',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-md)',
                        background: 'var(--xc-bg-muted)',
                    }}
                >
                    <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)', marginBottom: 'var(--xc-space-2)' }}>
                        <MultisigBadge
                            threshold={multisig.threshold}
                            cosignerCount={multisig.cosignerCount}
                            scheme={multisig.scheme}
                        />
                        <strong>{multisig.schemeLabel}</strong>
                    </header>
                    {multisigQrs[multisig.multisigConfigId] ? (
                        <div className={styles.qrBox}>
                            <img
                                src={multisigQrs[multisig.multisigConfigId]}
                                alt={`Multisig QR code for ${multisig.address}`}
                                width={512}
                                height={512}
                                className={styles.qr}
                            />
                        </div>
                    ) : (
                        <div className={styles.qrBox} aria-hidden="true">
                            <div className={styles.qrPlaceholder}>Rendering multisig QR…</div>
                        </div>
                    )}
                    <div className={styles.addressBox}>
                        <AddressText address={multisig.address} truncate={false} size="sm" />
                        <CopyButton value={multisig.address} />
                    </div>
                    {multisig.cosignerNames?.length > 0 ? (
                        <p className={styles.hint} style={{ marginTop: 'var(--xc-space-2)' }}>
                            Cosigners: {multisig.cosignerNames.join(' · ')}
                        </p>
                    ) : null}
                </section>
            ))}

        </>
    );

    return (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{body}</div> : body}
        </Screen>
    );
}
