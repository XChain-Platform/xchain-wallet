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
import { AddressField, AddressText, Button, CopyButton, EmptyState, FormPage, Icon, Input, MultisigBadge, PageHeader, Screen, Select, StatusMessage } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    uri as uriLib,
} from '@xchain-wallet/core';
import { coinToFiatExact, fiatToCoin } from '../../flows/priceLookup.js';
import { useFiatRate } from '../hooks/useFiatRate.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useToast } from '../components/ToastHost.jsx';
import { copyText } from '../clipboard.js';
import { dataUrlToBlob } from '../dataUrl.js';
import { AmountField } from '../components/AmountField.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { AddAddressModal } from './AddAddressModal.jsx';
import {
    formatWithThousands,
    countNonCommaBefore,
    indexAfterNonCommaCount,
    roundDecimalString,
} from '../utils/amountFormat.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { addressTypeLabel } from '../utils/addressTypeLabel.js';
import { explorerPageUrl } from '../utils/explorerLinks.js';
import { Settings } from './Settings.jsx';
import {
    hasAvailableChain,
    NO_CHAINS_BODY,
    NO_CHAINS_TITLE,
} from '../utils/chainAvailability.js';
import styles from './Receive.module.css';

const chainRegistry = registryLib.defaultRegistry();
const NATIVE_COIN_DECIMALS = 8;
const QR_FALLBACK_PIXEL_SIZE = 512;

export function qrPixelSizeFor(cssWidth, devicePixelRatio) {
    const width = Number(cssWidth);
    if (!Number.isFinite(width) || width <= 0) return QR_FALLBACK_PIXEL_SIZE;
    const ratio = Number(devicePixelRatio);
    const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    return Math.ceil(width * safeRatio);
}

// descriptor.coin is the long coin name ('bitcoin' / 'litecoin' / 'dogecoin');
// the user-facing native ticker is the short symbol ('BTC' / 'LTC' / 'DOGE').
// Uppercasing descriptor.coin directly leaks 'BITCOIN' into hints and labels.
const NATIVE_TICKER_BY_COIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
function nativeTickerFor(descriptor) {
    if (!descriptor?.coin) return null;
    return NATIVE_TICKER_BY_COIN[descriptor.coin] || descriptor.coin.toUpperCase();
}

function newestAddressOfType(addresses, addressType) {
    let newest = null;
    let newestIndex = -1;
    for (const candidate of addresses || []) {
        if (candidate?.addressType !== addressType) continue;
        if (!['hd', 'trezor', 'ledger'].includes(candidate.source || 'hd')) continue;
        const parts = typeof candidate.derivationPath === 'string'
            ? candidate.derivationPath.split('/')
            : [];
        if (parts.length < 2 || parts[parts.length - 2] !== '0') continue;
        const index = Number(parts[parts.length - 1]);
        if (Number.isInteger(index) && index >= 0 && index > newestIndex) {
            newest = candidate;
            newestIndex = index;
        }
    }
    return newest;
}

/**
 * Receive view: pick a chain, show the newest persisted HD address as
 * a BIP21-encoded QR, copy-to-clipboard, and optionally derive a fresh
 * next-index address through the host's unlocked signer session.
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
    const { showToast } = useToast();
    const settingsState = useSettings();
    const { settings } = settingsState;
    // The Wallet Mode screen promises the receive screen is hidden in
    // signer mode. Refused here as well as in the nav, because the palette and
    // `xchain:` URI intents both reach this route without a nav click.
    const { isSignerMode } = useWalletMode();

    const [chainsByWallet, setChainsByWallet] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [activeChainId, setActiveChainId] = useState(
        /** @type {string | null} */ (prefill?.chainId || null),
    );
    const [address, setAddress] = useState(/** @type {any | null} */ (null));
    const [addressType, setAddressType] = useState('');
    // Receive-address picker: the QR icon on the Address field opens the
    // wallet's own address list for the active chain; picking one becomes
    // the address the QR / request encodes. A chain switch re-runs the
    // newest-address effect and resets the pick, which is the right
    // default for a new chain.
    const [addressPickerOpen, setAddressPickerOpen] = useState(false);
    const [labelDraft, setLabelDraft] = useState('');
    const [labelSaving, setLabelSaving] = useState(false);
    const [labelError, setLabelError] = useState(/** @type {string | null} */ (null));
    const [qrPixelSize, setQrPixelSize] = useState(QR_FALLBACK_PIXEL_SIZE);
    const qrSurfaceRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const [renderedQr, setRenderedQr] = useState(
        /** @type {{ uri: string, dataUrl: string } | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [generating, setGenerating] = useState(false);
    const [generateError, setGenerateError] = useState(/** @type {string | null} */ (null));

    // "the account holds no address anywhere" is a state, not an
    // error. It used to render as a red alert string and nothing else, so
    // Receive - the very screen Home tells you to use to generate one -
    // dead-ended. It now carries the cure: a CTA onto Add addresses,
    // whose coin list reaches past the (empty) occupied set.
    // Unreachable while seeding works; this is the fallback surface for
    // when it doesn't.
    const [noAddresses, setNoAddresses] = useState(false);
    const [addAddressOpen, setAddAddressOpen] = useState(false);
    const [networkSettingsOpen, setNetworkSettingsOpen] = useState(false);
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
        setChainsByWallet(null);
        setActiveChainId(prefill?.chainId || null);
        setAddress(null);
        setAddressType('');
        setRenderedQr(null);
        setLoadError(null);
        setGenerateError(null);
        setNoAddresses(false);
        setMultisigs([]);
        setMultisigQrs({});
        setAddressPickerOpen(false);
        setAddAddressOpen(false);
    }, [walletId, accountId, prefill?.chainId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [byChain, chainSettings] = await Promise.all([
                    messaging.getAddressesByChain(walletId, accountId),
                    typeof messaging.getSettings === 'function'
                        ? Promise.resolve(messaging.getSettings()).catch(() => null)
                        : Promise.resolve(null),
                ]);
                if (cancelled) return;
                setChainsByWallet(byChain);
                if (Object.keys(byChain || {}).length > 0) {
                    // `byChain` is in address-creation order, so opening on
                    // its first key opened Receive on the wallet's OLDEST
                    // chain forever whenever ReceivePicker sent no prefill.
                    // Prefer the last-used chain instead, behind a chainId
                    // set by ReceivePicker's prefill (or a chain the user
                    // already picked here), and ahead of the first-key
                    // fallback, exactly as Send does.
                    setActiveChainId((prev) => pickDefaultChainId(byChain, {
                        explicitChainId: prev,
                        settings: chainSettings,
                    }));
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
        setAddress(null);
        setAddressType('');
        setLoadError(null);
        (async () => {
            try {
                const newest = await messaging.getNewestAddress(
                    walletId,
                    activeChainId,
                    accountId,
                );
                if (!cancelled) {
                    setAddress(newest);
                    const nextDescriptor = chainRegistry.get(activeChainId);
                    setAddressType(newest?.addressType || nextDescriptor?.defaultAddressType || '');
                }
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

    useEffect(() => {
        setLabelDraft(address?.label || '');
        setLabelError(null);
    }, [address?.id, address?.label]);

    useEffect(() => {
        const surface = qrSurfaceRef.current;
        if (!surface) return undefined;

        const measure = (observedWidth) => {
            const fallbackWidth = surface.getBoundingClientRect?.().width || 0;
            const width = Number(observedWidth) > 0 ? Number(observedWidth) : fallbackWidth;
            const nextSize = qrPixelSizeFor(width, window.devicePixelRatio);
            setQrPixelSize((current) => (current === nextSize ? current : nextSize));
        };
        measure();

        const onWindowResize = () => measure();
        window.addEventListener('resize', onWindowResize);
        let observer;
        if (typeof ResizeObserver === 'function') {
            observer = new ResizeObserver((entries) => {
                measure(entries[0]?.contentRect?.width);
            });
            observer.observe(surface);
        }
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', onWindowResize);
        };
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
        setMultisigs([]);
        setMultisigQrs({});
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
                    margin: 4,
                    width: qrPixelSize,
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
    }, [multisigs, activeChainId, qrPixelSize]);

    // Unified QR effect lives below; see the `qrUri` memo. Driven by
    // address + active chain + the optional amount/tick customization.

    const descriptor = activeChainId ? chainRegistry.get(activeChainId) : null;
    const addressExplorerUrl = explorerPageUrl({
        chainId: activeChainId,
        kind: 'address',
        value: address?.address,
        settings,
    });

    // Inline payment-request fields, visible by default so customizing
    // the QR is a single-glance affair. As the amount changes, the QR
    // re-renders. Token tick seeds from a non-native ReceivePicker prefill
    // so the QR encodes the requested token without manual entry.
    const [reqAmount, setReqAmount] = useState('');
    const [amountError, setAmountError] = useState(/** @type {string | null} */ (null));
    const [reqTick] = useState(() => {
        if (!prefill?.tick || !prefill?.chainId) return '';
        const desc = chainRegistry.get(prefill.chainId);
        const nativeTicker = nativeTickerFor(desc);
        if (nativeTicker && prefill.tick.toUpperCase() === nativeTicker) return '';
        return prefill.tick.toUpperCase();
    });
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
    // Oracle-primary with CoinGecko fallback (§45); the
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
        const validDecimal = /^\d+(?:\.\d*)?$/.test(stripped);
        const fraction = stripped.includes('.') ? stripped.split('.')[1] : '';
        const exceedsCoinPrecision = amountInputMode === 'coin'
            && fraction.length > NATIVE_COIN_DECIMALS;
        if (stripped !== '' && (!validDecimal || exceedsCoinPrecision)) {
            setAmountError(exceedsCoinPrecision
                ? `Amount can have at most ${NATIVE_COIN_DECIMALS} decimal places.`
                : 'Enter the amount as a plain decimal number.');
            return;
        }
        setAmountError(null);
        if (amountInputMode === 'fiat') {
            setFiatAmount(stripped);
            if (!fiatRate) {
                if (stripped === '') setReqAmount('');
            } else {
                const derivedCoin = fiatToCoin(stripped, fiatRate, NATIVE_COIN_DECIMALS);
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
        setAmountError(null);
        setAmountInputMode((prev) => {
            if (prev === 'coin') {
                const value = reqAmount ? coinToFiatExact(reqAmount, fiatRate) : null;
                setFiatAmount(value != null ? roundDecimalString(value, 2) : '');
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

    const nativeTicker = nativeTickerFor(descriptor);

    // The QR and text-copy paths share one BIP21-style payment request. The
    // optional chain extension distinguishes testnet from regtest, whose
    // address formats and URI schemes are otherwise identical.
    const qrUri = useMemo(() => {
        if (!address || !descriptor || !activeChainId) return null;
        const amount = reqAmount.trim();
        const tick = reqTick.trim().toUpperCase();
        const hasRequestDetails = !!(amount || tick);
        return uriLib.encodeBip21Uri({
            scheme: descriptor.uriScheme,
            address: address.address,
            amount,
            label: hasRequestDetails ? (address.label || undefined) : undefined,
            params: hasRequestDetails ? {
                chain: activeChainId,
                ...(tick ? { tick } : {}),
            } : {},
        });
    }, [address, descriptor, activeChainId, reqAmount, reqTick]);

    useEffect(() => {
        if (!qrUri) {
            setRenderedQr(null);
            return undefined;
        }
        let cancelled = false;
        QRCode.toDataURL(qrUri, {
            errorCorrectionLevel: 'M',
            margin: 4,
            width: qrPixelSize,
            color: { dark: '#0F172A', light: '#FFFFFF' },
        })
            .then((dataUrl) => {
                if (!cancelled) setRenderedQr({ uri: qrUri, dataUrl });
            })
            .catch(() => { if (!cancelled) setRenderedQr(null); });
        return () => { cancelled = true; };
    }, [qrUri, qrPixelSize]);

    const qrDataUrl = renderedQr?.uri === qrUri ? renderedQr.dataUrl : null;

    const changeAddressType = useCallback((nextType) => {
        setAddressType(nextType);
        setGenerateError(null);
        setAddress(newestAddressOfType(chainsByWallet?.[activeChainId] || [], nextType));
    }, [chainsByWallet, activeChainId]);

    const generateNewAddress = useCallback(async () => {
        if (!activeChainId || !addressType || generating) return;
        if (typeof messaging.generateReceiveAddress !== 'function') {
            setGenerateError('This app cannot generate a new receive address.');
            return;
        }
        setGenerating(true);
        setGenerateError(null);
        try {
            const generated = await messaging.generateReceiveAddress({
                walletId,
                accountId,
                chainId: activeChainId,
                addressType,
            });
            setAddress(generated);
            setAddressType(generated?.addressType || addressType);
            setChainsByWallet((current) => {
                const chainAddresses = current?.[activeChainId] || [];
                const withoutDuplicate = chainAddresses.filter((item) => item.id !== generated?.id);
                return {
                    ...(current || {}),
                    [activeChainId]: [...withoutDuplicate, generated],
                };
            });
        } catch (err) {
            setGenerateError(err?.message || 'Could not generate a new receive address.');
        } finally {
            setGenerating(false);
        }
    }, [activeChainId, addressType, generating, messaging, walletId, accountId]);

    const saveAddressLabel = useCallback(async () => {
        if (!address?.id || labelSaving) return;
        if (typeof messaging.setAddressLabel !== 'function') {
            setLabelError('This app cannot save address labels.');
            return;
        }
        const next = labelDraft.trim();
        setLabelSaving(true);
        setLabelError(null);
        try {
            await messaging.setAddressLabel(address.id, next);
            setAddress((current) => (
                current?.id === address.id ? { ...current, label: next } : current
            ));
            setChainsByWallet((current) => Object.fromEntries(
                Object.entries(current || {}).map(([chainId, records]) => [
                    chainId,
                    Array.isArray(records)
                        ? records.map((record) => record?.id === address.id
                            ? { ...record, label: next }
                            : record)
                        : records,
                ]),
            ));
        } catch {
            setLabelError('Could not save that label. Try again.');
        } finally {
            setLabelSaving(false);
        }
    }, [address?.id, labelDraft, labelSaving, messaging]);

    // QR image actions. Copy writes the rendered PNG when the clipboard can
    // accept images. Share always offers the payment request, and attaches
    // the PNG only when the platform reports file-share support.
    //
    // Decode the PNG in-process because each shell's CSP limits connect-src
    // to wallet hosts and therefore refuses `fetch(dataUrl)`.
    const canCopyImages = useMemo(() => (
        typeof navigator !== 'undefined'
        && typeof navigator.clipboard?.write === 'function'
        && typeof ClipboardItem === 'function'
    ), []);

    const qrFileName = useMemo(() => {
        const addrPart = address?.address ? address.address.slice(0, 8) : 'address';
        const chainPart = descriptor?.id || activeChainId || 'qr';
        return `xchain-${chainPart}-${addrPart}.png`;
    }, [address?.address, descriptor?.id, activeChainId]);

    const copyQrImage = useCallback(async () => {
        if (!qrDataUrl) return;
        // A WebView without the async image clipboard (older Android
        // WebViews, Firefox before 127) cannot take a PNG at all. Copying
        // the payment link is the useful thing the button can still do
        // there, and the toast says which one happened.
        if (!canCopyImages) {
            const { ok } = await copyText(qrUri || address?.address || '');
            showToast({
                message: ok
                    ? 'This app cannot copy images, so the payment link was copied instead.'
                    : 'Copy failed: clipboard unavailable',
                variant: ok ? 'default' : 'error',
            });
            return;
        }
        try {
            const blob = dataUrlToBlob(qrDataUrl);
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
            showToast({ message: 'QR code copied to clipboard.' });
        } catch (err) {
            // The browser's own wording ("Document is not focused") goes to
            // the log; the toast stays in plain words.
            console.error('Receive QR copy failed:', err); // eslint-disable-line no-console
            showToast({ message: 'Copy failed: clipboard unavailable', variant: 'error' });
        }
    }, [qrDataUrl, qrUri, address?.address, canCopyImages, showToast]);

    const shareQrImage = useCallback(async () => {
        if (!qrDataUrl || !qrUri) return;
        const asset = reqTick.trim().toUpperCase() || nativeTicker || descriptor?.displayName || 'funds';
        const amount = reqAmount.trim();
        const shareData = {
            title: `Receive ${asset} with XChain`,
            text: amount
                ? `Send ${amount} ${asset} to this XChain wallet.`
                : `Send ${asset} to this XChain wallet.`,
            url: qrUri,
        };
        const nav = typeof navigator === 'undefined' ? null : navigator;
        if (typeof nav?.share === 'function') {
            try {
                let data = shareData;
                if (typeof nav.canShare === 'function') {
                    try {
                        const blob = dataUrlToBlob(qrDataUrl);
                        const withFile = {
                            ...shareData,
                            files: [new File([blob], qrFileName, { type: blob.type })],
                        };
                        if (nav.canShare(withFile)) data = withFile;
                    } catch { /* text and URL remain shareable without the QR image */ }
                }
                await nav.share(data);
                return;
            } catch (err) {
                if (err?.name === 'AbortError') return;
                console.error('Receive QR share failed:', err); // eslint-disable-line no-console
            }
        }

        const { ok } = await copyText(qrUri);
        showToast(ok
            ? { message: 'Share unavailable. Payment request copied to clipboard.' }
            : { message: 'Share failed: clipboard unavailable', variant: 'error' });
    }, [qrDataUrl, qrUri, reqTick, nativeTicker, descriptor?.displayName, reqAmount, qrFileName, showToast]);

    // Single-tap request copy uses the exact payload rendered in the QR so a
    // pasted request cannot disagree with the amount or network a payer scans.
    const copyAddress = useCallback(async () => {
        if (!qrUri) return;
        const { ok } = await copyText(qrUri);
        showToast({
            message: ok ? 'Payment request copied to clipboard.' : 'Copy failed: clipboard unavailable',
            variant: ok ? 'default' : 'error',
        });
    }, [qrUri, showToast]);
    const onAddressKeyDown = useCallback((event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            copyAddress();
        }
    }, [copyAddress]);

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to home"
            title="Receive"
            titleIcon={<Icon.ReceiveIcon />}
        />
    );
    // §20: signer mode hides the receive surface, as its own hint
    // says. Named the way back, since the mode is a setting the user chose.
    if (isSignerMode) {
        return (
            <Screen variant={variant} header={header}>
                <StatusMessage variant="status">
                    This wallet is in signer mode, so its receive screen is hidden.
                    It signs transactions passed in from a watcher wallet, and holds
                    no address you are meant to fund. Switch the mode under Settings,
                    Wallet Mode to receive on this device.
                </StatusMessage>
            </Screen>
        );
    }
    if (networkSettingsOpen) {
        return (
            <Settings
                onBack={() => setNetworkSettingsOpen(false)}
                activeWallet={{ id: walletId }}
                initialSubpageId="network"
            />
        );
    }
    if (!hasAvailableChain(settingsState, chainRegistry)) {
        return (
            <Screen variant={variant} header={header}>
                <EmptyState
                    title={NO_CHAINS_TITLE}
                    body={NO_CHAINS_BODY}
                    actionLabel="Open Network settings"
                    onAction={() => setNetworkSettingsOpen(true)}
                    actionIcon={<Icon.GearIcon />}
                />
            </Screen>
        );
    }
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
                    setAddressType(a?.addressType || addressType);
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
                <StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>
            ) : null}

            {noAddresses ? (
                <EmptyState
                    title="No addresses yet"
                    body="Generate an address to start receiving."
                    actionLabel="Generate an address"
                    onAction={() => setAddAddressOpen(true)}
                    actionIcon={<Icon.PlusIcon />}
                />
            ) : null}

            {descriptor?.addressTypes?.length > 1 ? (
                <Select
                    label="Address type"
                    value={addressType}
                    onChange={(event) => changeAddressType(event.target.value)}
                    disabled={generating || !addressType}
                >
                    {descriptor.addressTypes.map((type) => (
                        <option key={type} value={type}>{addressTypeLabel(type)}</option>
                    ))}
                </Select>
            ) : null}

            {descriptor && addressType ? (
                <div className={styles.generateAddressAction}>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={generateNewAddress}
                        loading={generating}
                        disabled={generating}
                        icon={<Icon.PlusIcon />}
                    >
                        Generate new address
                    </Button>
                </div>
            ) : null}

            {generateError ? (
                <StatusMessage variant="error" className={styles.error}>{generateError}</StatusMessage>
            ) : null}

            {!address && descriptor && addressType && !generating && !generateError ? (
                <StatusMessage variant="status">
                    No {addressTypeLabel(addressType)} address exists yet. Generate one to receive with this type.
                </StatusMessage>
            ) : null}

            {address ? (
                <div className={styles.qrBox}>
                    <div ref={qrSurfaceRef} className={styles.qrSurface}>
                        {qrDataUrl ? (
                            <img
                                src={qrDataUrl}
                                alt={`QR code for ${address.address}`}
                                width={qrPixelSize}
                                height={qrPixelSize}
                                className={styles.qr}
                            />
                        ) : (
                            <div className={styles.qrPlaceholder} aria-hidden="true">
                                Rendering QR…
                            </div>
                        )}
                    </div>
                </div>
            ) : null}

            {address ? (
                <AddressField
                    label={address.label || 'Address'}
                    aria-label="Copy payment request for receive address"
                    icon="addresses"
                    value={address.address}
                    readOnly
                    onChange={() => {}}
                    onClick={copyAddress}
                    onKeyDown={onAddressKeyDown}
                    title="Tap to copy payment request"
                    hint="Tap the address to copy its payment request."
                    style={{ cursor: 'text', userSelect: 'text' }}
                    wrapReadOnlyAddress
                    onIconClick={() => setAddressPickerOpen(true)}
                    iconLabel="Choose receive address"
                />
            ) : null}

            {address?.id ? (
                <div className={styles.labelEditor}>
                    <Input
                        label="Address label"
                        value={labelDraft}
                        onChange={(event) => setLabelDraft(event.target.value)}
                        placeholder="Add a label"
                        autoComplete="off"
                        error={labelError || undefined}
                    />
                    <Button
                        type="button"
                        variant="secondary"
                        loading={labelSaving}
                        disabled={labelSaving || labelDraft.trim() === (address.label || '')}
                        onClick={saveAddressLabel}
                    >
                        Save label
                    </Button>
                </div>
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
                    {amountError ? (
                        <StatusMessage variant="error" className={styles.error}>{amountError}</StatusMessage>
                    ) : null}
                    <div className={styles.qrActions}>
                        <Button
                            variant="secondary"
                            onClick={copyQrImage}
                            disabled={!qrDataUrl}
                            icon={<Icon.CopyIcon />}
                        >
                            {canCopyImages ? 'Copy QR code' : 'Copy payment request'}
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={shareQrImage}
                            disabled={!qrDataUrl}
                            icon={<Icon.UploadIcon />}
                        >
                            Share QR
                        </Button>
                        {addressExplorerUrl ? (
                            <a
                                href={addressExplorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                View address on explorer <span aria-hidden="true">↗</span>
                            </a>
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
                                <CopyButton value={address.address} label="Copy receive address" />
                            </div>
                            {hwVerify.status === 'confirmed' ? (
                                <p className={styles.hint} role="status">
                                    ✅ Confirmed on your {hwDeviceLabel}. Safe to share.
                                </p>
                            ) : hwVerify.status === 'mismatch' ? (
                                <StatusMessage variant="error" className={styles.error}>
                                    Your {hwDeviceLabel} showed a different address. Do not deposit here.
                                    Disconnect and re-pair the device.
                                </StatusMessage>
                            ) : hwVerify.status === 'error' ? (
                                <StatusMessage variant="error" className={styles.error}>{hwVerify.message}</StatusMessage>
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
                                width={qrPixelSize}
                                height={qrPixelSize}
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
                        <CopyButton value={multisig.address} label="Copy multisig receive address" />
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
            <FormPage label="Receive request" onSubmit={(event) => event.preventDefault()}>
                {body}
            </FormPage>
        </Screen>
    );
}
