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
import { AddressField, AddressText, Button, CopyButton, EmptyState, FormNotice, FormPage, Icon, Input, MultisigBadge, PageHeader, Screen, Select, StatusMessage } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    uri as uriLib,
} from '@xchain-wallet/core';
import { coinToFiatExact, fiatToCoin } from '../../flows/priceLookup.js';
import { useFiatRate } from '../hooks/useFiatRate.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { isDemoWallet } from '../../flows/demoMode.js';
import { useToast } from '../components/ToastHost.jsx';
import { copyText } from '../clipboard.js';
import { shareContent, ShareOutcome, toWebShareData } from '../share.js';
import { dataUrlToBlob } from '../dataUrl.js';
import { AmountField } from '../components/AmountField.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
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
import { unsupportedAddressTypeMessage } from '../utils/userFacingMessage.js';
import { loadSupportedAddressTypes, offeredAddressType } from '../utils/supportedAddressTypes.js';
import { useSupportedAddressTypes } from '../hooks/useSupportedAddressTypes.js';
import { Settings } from './Settings.jsx';
import {
    hasAvailableChain,
    NO_CHAINS_BODY,
    NO_CHAINS_TITLE,
} from '../utils/chainAvailability.js';
import styles from './Receive.module.css';
import qrStyles from '../../ui/QrDisplay.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/multisig.js';
import '../../i18n/locales/en/receive.js';
import '../../i18n/locales/en/verifySignature.js';

const chainRegistry = registryLib.defaultRegistry();
const NATIVE_COIN_DECIMALS = 8;
const TOKEN_AMOUNT_MAX_DECIMALS = 18;
const QR_FALLBACK_PIXEL_SIZE = 512;
// The label a request carries is bounded by the limit the parser applies to a
// scanned link, so a long label never becomes a code this wallet's own Send
// screen refuses.
const REQUEST_LABEL_MAX = uriLib.URI_PARAMETER_LIMITS.label;

/** A leading decimal mark is a zero whole part (".5" is 0.5), never a dropped key that leaves the "5" to read as five coins. */
export function withLeadingZero(typed) {
    return typed.startsWith('.') ? `0${typed}` : typed;
}

/**
 * The address label as it travels in a payment request: control characters
 * replaced and the text cut, on a whole character, to the URI label limit.
 */
export function requestLabelFor(label) {
    const clean = String(label || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
    let out = '';
    for (const character of clean) {
        if (out.length + character.length > REQUEST_LABEL_MAX) break;
        out += character;
    }
    return out.trim();
}

export function qrPixelSizeFor(cssWidth, devicePixelRatio) {
    const width = Number(cssWidth);
    if (!Number.isFinite(width) || width <= 0) return QR_FALLBACK_PIXEL_SIZE;
    const ratio = Number(devicePixelRatio);
    const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    return Math.ceil(width * safeRatio);
}

// Below this the code gets too small to scan reliably, so a window that
// cannot fit a code this big beside the address and Copy row scrolls instead.
export const QR_FIT_MIN_SIZE = 128;

/**
 * The largest QR side, in CSS px, that keeps the code, the address field and
 * the Copy row inside the route scroller's visible height without scrolling.
 * `contentTop` is the QR's top in the scroller's content (independent of the
 * scroll position) and `belowQr` the distance from the QR's bottom to the
 * Copy row's bottom, which does not depend on the QR's size. Returns null when
 * there is nothing to fit (no measurable scroller) or when the fitted code
 * would fall below QR_FIT_MIN_SIZE; the width cap then applies alone.
 */
export function qrFitSize({ viewportHeight, paddingBottom = 0, contentTop, belowQr }) {
    const values = [viewportHeight, paddingBottom, contentTop, belowQr].map(Number);
    if (values.some((value) => !Number.isFinite(value))) return null;
    const [height, padding, top, below] = values;
    if (height <= 0) return null;
    const fit = Math.floor(height - padding - top - below);
    return fit >= QR_FIT_MIN_SIZE ? fit : null;
}

/** The nearest ancestor that scrolls vertically, or null for the document. */
function verticalScroller(element) {
    for (let node = element?.parentElement; node && node !== document.body; node = node.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
    }
    return null;
}

// descriptor.coin is the long coin name ('bitcoin' / 'litecoin' / 'dogecoin');
// the user-facing native ticker is the short symbol ('BTC' / 'LTC' / 'DOGE').
// Uppercasing descriptor.coin directly leaks 'BITCOIN' into hints and labels.
const NATIVE_TICKER_BY_COIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
function nativeTickerFor(descriptor) {
    if (!descriptor?.coin) return null;
    return NATIVE_TICKER_BY_COIN[descriptor.coin] || descriptor.coin.toUpperCase();
}

function requestTickFor(prefill) {
    if (!prefill?.tick || !prefill?.chainId) return '';
    const descriptor = chainRegistry.get(prefill.chainId);
    const nativeTicker = nativeTickerFor(descriptor);
    if (nativeTicker && prefill.tick.toUpperCase() === nativeTicker) return '';
    return prefill.tick.toUpperCase();
}

function newestAddressOfType(addresses, addressType) {
    let newest = null;
    let newestIndex = -1;
    for (const candidate of addresses || []) {
        if (candidate?.addressType !== addressType) continue;
        if (!['hd', 'trezor', 'ledger', 'watch-only'].includes(candidate.source || 'hd')) continue;
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

function addressUsageKey(chainId, address) {
    return `${chainId}:${String(address || '').toLowerCase()}`;
}

function historyRows(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.rows)) return response.rows;
    return [];
}

function preferredAddressOfType(addresses, addressType, chainId, usageByKey) {
    const unused = (addresses || []).filter((candidate) => (
        usageByKey[addressUsageKey(chainId, candidate?.address)] === false
    ));
    return newestAddressOfType(unused, addressType)
        || newestAddressOfType(addresses, addressType);
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
 * @param {{ chainId?: string, tick?: string, kind?: string, displayName?: string, divisibility?: number | null, imageUrl?: string | null }} [props.prefill]
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
    const [loadedAddress, setAddress] = useState(/** @type {any | null} */ (null));
    const [addressContextKey, setAddressContextKey] = useState('');
    const [addressType, setAddressType] = useState('');
    // Receive-address picker: the QR icon on the Address field opens the
    // wallet's own address list for the active chain; picking one becomes
    // the address the QR / request encodes. A chain switch re-runs the
    // newest-address effect and resets the pick, which is the right
    // default for a new chain.
    const [addressPickerOpen, setAddressPickerOpen] = useState(false);
    const [addressUsageByKey, setAddressUsageByKey] = useState(
        /** @type {Record<string, boolean>} */ ({}),
    );
    const chainsByWalletRef = useRef(/** @type {Record<string, any[]> | null} */ (null));
    chainsByWalletRef.current = chainsByWallet;
    const addressUsageRef = useRef(/** @type {Record<string, boolean>} */ ({}));
    const addressTypeRef = useRef('');
    const addressManuallySelectedRef = useRef(false);
    const [labelDraft, setLabelDraft] = useState(
        /** @type {{ addressId: string | null, value: string }} */ ({ addressId: null, value: '' }),
    );
    const [labelSave, setLabelSave] = useState(
        /** @type {{ request: number, addressId: string } | null} */ (null),
    );
    const [labelError, setLabelError] = useState(/** @type {string | null} */ (null));
    const [qrPixelSize, setQrPixelSize] = useState(QR_FALLBACK_PIXEL_SIZE);
    const qrSurfaceRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const qrActionsRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const [qrFit, setQrFit] = useState(/** @type {number | null} */ (null));
    const [renderedQr, setRenderedQr] = useState(
        /** @type {{ uri: string, dataUrl: string } | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [generating, setGenerating] = useState(false);
    const [generateError, setGenerateError] = useState(/** @type {string | null} */ (null));
    const generateRequestRef = useRef(0);
    const generateBusyRef = useRef(false);
    const labelRequestRef = useRef(0);
    const verifyRequestRef = useRef(0);

    const requestedChainId = prefill?.chainId || activeChainId;
    const receiveContextKey = JSON.stringify([walletId, accountId || '', activeChainId || '', requestedChainId || '']);
    const receiveContextRef = useRef(receiveContextKey);
    receiveContextRef.current = receiveContextKey;
    const address = addressContextKey === receiveContextKey ? loadedAddress : null;
    const currentAddressIdRef = useRef(address?.id || null);
    currentAddressIdRef.current = address?.id || null;
    const labelDraftValue = labelDraft.addressId === address?.id
        ? labelDraft.value
        : address?.label || '';
    const labelSaving = labelSave?.addressId === address?.id;

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
        setAddressContextKey('');
        setAddressType('');
        addressTypeRef.current = '';
        setRenderedQr(null);
        setLoadError(null);
        setGenerateError(null);
        setNoAddresses(false);
        setMultisigs([]);
        setMultisigQrs({});
        setAddressPickerOpen(false);
        setAddressUsageByKey({});
        addressUsageRef.current = {};
        addressManuallySelectedRef.current = false;
        setAddAddressOpen(false);
    }, [walletId, accountId, prefill?.chainId]);

    useEffect(() => {
        generateRequestRef.current += 1;
        generateBusyRef.current = false;
        labelRequestRef.current += 1;
        verifyRequestRef.current += 1;
        setGenerating(false);
        setLabelSave(null);
    }, [receiveContextKey]);

    useEffect(() => () => {
        generateRequestRef.current += 1;
        labelRequestRef.current += 1;
        verifyRequestRef.current += 1;
    }, []);

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
            } catch {
                if (!cancelled) {
                    setLoadError("Couldn't load addresses. Check your connection and try again.");
                }
            }
        })();
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging, reloadKey]);

    useEffect(() => {
        if (!activeChainId) return undefined;
        let cancelled = false;
        setAddress(null);
        setAddressContextKey('');
        setAddressType('');
        addressTypeRef.current = '';
        setLoadError(null);
        setAddressUsageByKey({});
        addressUsageRef.current = {};
        addressManuallySelectedRef.current = false;
        (async () => {
            try {
                const newest = await messaging.getNewestAddress(
                    walletId,
                    activeChainId,
                    accountId,
                );
                const nextDescriptor = chainRegistry.get(activeChainId);
                const offered = await loadSupportedAddressTypes(messaging, nextDescriptor);
                // A newest address of a type the SDK cannot generate (stored by an
                // older build or imported) keeps its record; the screen opens on the
                // chain default instead, on that type's own address when one exists.
                const nextType = offeredAddressType(
                    newest?.addressType,
                    offered,
                    nextDescriptor?.defaultAddressType,
                );
                const typeSwapped = Boolean(newest?.addressType) && nextType !== newest.addressType;
                const swappedAddresses = typeSwapped
                    ? ((await messaging.getAddressesByChain(walletId, accountId))?.[activeChainId] || [])
                    : null;
                if (!cancelled) {
                    setAddressContextKey(receiveContextKey);
                    addressTypeRef.current = nextType;
                    const chainAddresses = swappedAddresses || chainsByWalletRef.current?.[activeChainId] || [];
                    const includesNewest = newest && chainAddresses.some((candidate) => (
                        candidate?.id === newest.id
                    ));
                    const preferred = (includesNewest || typeSwapped)
                        ? preferredAddressOfType(
                            chainAddresses,
                            nextType,
                            activeChainId,
                            addressUsageRef.current,
                        )
                        : null;
                    setAddress(preferred || (typeSwapped ? null : newest));
                    setAddressType(nextType);
                }
            } catch {
                if (!cancelled) {
                    setLoadError('Could not load the receive address. Check your connection and try again.');
                }
            }
        })();
        return () => { cancelled = true; };
        // reloadKey: a generate lands a new newest-index address on the
        // chain already selected, which the chain-list effect alone would
        // not pick up.
    }, [walletId, accountId, activeChainId, messaging, reloadKey, receiveContextKey]);

    useEffect(() => {
        if (!activeChainId || !chainsByWallet || typeof messaging.getAddressHistory !== 'function') {
            return undefined;
        }
        // A demo wallet's addresses stay off every explorer. The demo lands
        // on mainnet, so this lookup would otherwise send its throwaway
        // addresses to a public mainnet explorer the moment Receive opens.
        if (isDemoWallet(walletId)) return undefined;
        const candidates = chainsByWallet[activeChainId] || [];
        const contextKey = receiveContextKey;
        let cancelled = false;
        Promise.allSettled(candidates.map(async (candidate) => {
            const response = await messaging.getAddressHistory({
                chainId: activeChainId,
                address: candidate.address,
            });
            return [
                addressUsageKey(activeChainId, candidate.address),
                historyRows(response).length > 0,
            ];
        })).then((results) => {
            if (cancelled || receiveContextRef.current !== contextKey) return;
            const next = {};
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    const [key, used] = result.value;
                    next[key] = used;
                }
            }
            addressUsageRef.current = next;
            setAddressUsageByKey(next);
            if (!addressManuallySelectedRef.current) {
                // Only swap to a better pick; a list with no address of the
                // shown type keeps the address the newest-address load chose.
                const preferred = preferredAddressOfType(
                    candidates,
                    addressTypeRef.current,
                    activeChainId,
                    next,
                );
                if (preferred) setAddress(preferred);
            }
        });
        return () => { cancelled = true; };
    }, [walletId, activeChainId, chainsByWallet, messaging, receiveContextKey]);

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
        setLabelDraft({ addressId: address?.id || null, value: address?.label || '' });
        setLabelError(null);
    }, [address?.id, address?.label]);

    useEffect(() => {
        const surface = qrSurfaceRef.current;
        if (!surface) return undefined;

        const scroller = verticalScroller(surface);

        // Size the code from the height the route scroller shows as well as
        // from its width, so a short window (the 360x600 extension popup)
        // keeps the code, the address and the Copy row on screen together.
        // Every term is independent of the code's own size, so applying the
        // result never changes the next measurement.
        const fitToHeight = () => {
            const copyRow = qrActionsRef.current?.firstElementChild;
            const surfaceRect = surface.getBoundingClientRect?.();
            const copyRect = copyRow?.getBoundingClientRect?.();
            if (!surfaceRect || !copyRect) return null;
            if (!scroller) {
                return qrFitSize({
                    viewportHeight: window.innerHeight,
                    contentTop: surfaceRect.top + window.scrollY,
                    belowQr: copyRect.bottom - surfaceRect.bottom,
                });
            }
            const scrollerRect = scroller.getBoundingClientRect();
            return qrFitSize({
                viewportHeight: scroller.clientHeight,
                paddingBottom: parseFloat(getComputedStyle(scroller).paddingBottom) || 0,
                contentTop: surfaceRect.top - scrollerRect.top - scroller.clientTop + scroller.scrollTop,
                belowQr: copyRect.bottom - surfaceRect.bottom,
            });
        };

        const measure = (observedWidth) => {
            const fallbackWidth = surface.getBoundingClientRect?.().width || 0;
            const width = Number(observedWidth) > 0 ? Number(observedWidth) : fallbackWidth;
            const nextSize = qrPixelSizeFor(width, window.devicePixelRatio);
            setQrPixelSize((current) => (current === nextSize ? current : nextSize));
            const nextFit = fitToHeight();
            setQrFit((current) => (current === nextFit ? current : nextFit));
        };
        measure();

        const onWindowResize = () => measure();
        window.addEventListener('resize', onWindowResize);
        let observer;
        if (typeof ResizeObserver === 'function') {
            observer = new ResizeObserver((entries) => {
                const own = entries.find((entry) => entry.target === surface);
                measure(own?.contentRect?.width);
            });
            observer.observe(surface);
            if (scroller) observer.observe(scroller);
        }
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', onWindowResize);
        };
    }, [address?.id, activeChainId, loadError, generateError]);

    // The error sits first in the page content, but New address and the device
    // check are lower down: bring the error into view so a failed tap is not
    // silent on a phone.
    const hwVerifyFailed = hwVerify.status === 'mismatch' || hwVerify.status === 'error';
    useEffect(() => {
        if (!generateError && !hwVerifyFailed) return;
        const id = generateError ? 'receive-generate-error' : 'receive-hw-verify-error';
        document.getElementById(id)?.scrollIntoView?.({ block: 'nearest' });
    }, [generateError, hwVerifyFailed]);

    const verifyOnDevice = useCallback(async () => {
        if (!address || !activeChainId) return;
        if (typeof messaging.verifyReceiveAddress !== 'function') {
            setHwVerify({ status: 'error', message: 'This app cannot verify the address on your hardware wallet.' });
            return;
        }
        const request = ++verifyRequestRef.current;
        const contextKey = receiveContextKey;
        const addressId = address.id;
        const isCurrentRequest = () => (
            verifyRequestRef.current === request
            && receiveContextRef.current === contextKey
            && currentAddressIdRef.current === addressId
        );
        setHwVerify({ status: 'checking', message: '' });
        try {
            const res = await messaging.verifyReceiveAddress({
                walletId,
                chainId: activeChainId,
                addressId: address.id,
                signerId: address.signerId,
            });
            if (!isCurrentRequest()) return;
            if (res?.confirmed) {
                setHwVerify({ status: 'confirmed', message: '' });
            } else {
                setHwVerify({ status: 'mismatch', message: '' });
            }
        } catch (err) {
            if (!isCurrentRequest()) return;
            if (err?.name === 'HardwareAddressMismatchError') {
                setHwVerify({ status: 'mismatch', message: '' });
            } else {
                setHwVerify({
                    status: 'error',
                    message: 'Could not verify the address on your hardware wallet. Reconnect it and try again.',
                });
            }
        }
    }, [address, activeChainId, walletId, messaging, receiveContextKey]);

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
        Promise.all(multisigs.filter((m) => m.address).map(async (m) => {
            try {
                const uri = descriptor
                    ? uriLib.encodeBip21Uri({ scheme: descriptor.uriScheme, address: m.address })
                    : m.address;
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
    const offeredTypes = useSupportedAddressTypes(descriptor);
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
    const reqTick = requestTickFor(prefill);

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
    const requestTokenInfo = useTokenInfo({
        chainId: activeChainId,
        tick: reqTick,
        skip: isNativeRequest || !reqTick,
    });
    // The live explorer omits divisibility, so TokenInfo carries null. Number(null)
    // is 0, which would cap a divisible token at whole units and erase a valid
    // amount; an unknown divisibility keeps the coin-precision fallback instead.
    const divisibilityRaw = prefill?.divisibility ?? requestTokenInfo?.divisibility;
    const selectedDivisibility = divisibilityRaw == null || divisibilityRaw === ''
        ? Number.NaN
        : Number(divisibilityRaw);
    const requestDivisibility = isNativeRequest
        ? NATIVE_COIN_DECIMALS
        : Number.isInteger(selectedDivisibility) && selectedDivisibility >= 0
            ? Math.min(selectedDivisibility, TOKEN_AMOUNT_MAX_DECIMALS)
            : NATIVE_COIN_DECIMALS;

    useEffect(() => {
        if (!reqAmount.includes('.')) return;
        const fraction = reqAmount.split('.')[1] || '';
        if (fraction.length <= requestDivisibility) return;
        setReqAmount('');
        setAmountError(`Amount can have at most ${requestDivisibility} decimal places.`);
    }, [reqAmount, requestDivisibility]);
    // Oracle-primary with CoinGecko fallback (§45); the
    // fallback is gated on the privacy.priceDataEnabled setting.
    const fiatRate = useFiatRate({
        chainCoin: isNativeRequest && activeChainId
            ? chainRegistry.get(activeChainId)?.coin
            : null,
        fiatCurrency,
        allowCoingeckoFallback: settings?.privacy?.priceDataEnabled !== false,
        enabled: chainRegistry.get(activeChainId || '')?.networkKind === 'mainnet',
    });

    const onAmountFieldChange = useCallback((rawValue, cursorPos) => {
        const typedValue = String(rawValue).replace(/,/g, '');
        const stripped = withLeadingZero(typedValue);
        const validDecimal = /^\d+(?:\.\d*)?$/.test(stripped);
        const fraction = stripped.includes('.') ? stripped.split('.')[1] : '';
        const exceedsCoinPrecision = amountInputMode === 'coin'
            && fraction.length > requestDivisibility;
        if (stripped !== '' && (!validDecimal || exceedsCoinPrecision)) {
            setAmountError(exceedsCoinPrecision
                ? `Amount can have at most ${requestDivisibility} decimal places.`
                : 'Enter the amount using numbers and a decimal point only.');
            return;
        }
        setAmountError(null);
        if (amountInputMode === 'fiat') {
            setFiatAmount(stripped);
            if (!fiatRate) {
                if (stripped === '') setReqAmount('');
            } else {
                const derivedCoin = fiatToCoin(stripped, fiatRate, requestDivisibility);
                setReqAmount(derivedCoin != null ? derivedCoin : '');
            }
        } else {
            setReqAmount(stripped);
        }
        if (typeof cursorPos === 'number' && amountInputRef.current) {
            const formattedNew = formatWithThousands(stripped);
            const addedZero = stripped.length - typedValue.length;
            const nonCommaBefore = countNonCommaBefore(String(rawValue), cursorPos) + addedZero;
            const nextCursor = indexAfterNonCommaCount(formattedNew, nonCommaBefore);
            const el = amountInputRef.current;
            requestAnimationFrame(() => {
                if (el && document.activeElement === el) {
                    try { el.setSelectionRange(nextCursor, nextCursor); } catch { /* selection unavailable */ }
                }
            });
        }
    }, [amountInputMode, fiatRate, requestDivisibility]);

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
        return uriLib.encodeBip21Uri({
            scheme: descriptor.uriScheme,
            address: address.address,
            amount,
            label: requestLabelFor(address.label) || undefined,
            params: {
                chain: activeChainId,
                ...(tick ? { tick } : {}),
            },
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
        addressManuallySelectedRef.current = false;
        addressTypeRef.current = nextType;
        setAddressType(nextType);
        setGenerateError(null);
        setAddress(preferredAddressOfType(
            chainsByWallet?.[activeChainId] || [],
            nextType,
            activeChainId,
            addressUsageRef.current,
        ));
        setAddressContextKey(receiveContextKey);
    }, [chainsByWallet, activeChainId, receiveContextKey]);

    const generateNewAddress = useCallback(async () => {
        if (!activeChainId || !addressType || generateBusyRef.current) return;
        if (typeof messaging.generateReceiveAddress !== 'function') {
            setGenerateError('This app cannot create a new receive address.');
            return;
        }
        const request = ++generateRequestRef.current;
        const contextKey = receiveContextKey;
        const chainId = activeChainId;
        const requestedAddressType = addressType;
        generateBusyRef.current = true;
        setGenerating(true);
        setGenerateError(null);
        try {
            const generated = await messaging.generateReceiveAddress({
                walletId,
                accountId,
                chainId,
                addressType: requestedAddressType,
            });
            if (generateRequestRef.current !== request || receiveContextRef.current !== contextKey) return;
            addressManuallySelectedRef.current = true;
            addressTypeRef.current = generated?.addressType || addressType;
            setAddress(generated);
            setAddressContextKey(contextKey);
            setAddressType(generated?.addressType || requestedAddressType);
            setChainsByWallet((current) => {
                const chainAddresses = current?.[chainId] || [];
                const withoutDuplicate = chainAddresses.filter((item) => item.id !== generated?.id);
                return {
                    ...(current || {}),
                    [chainId]: [...withoutDuplicate, generated],
                };
            });
        } catch (err) {
            if (generateRequestRef.current !== request || receiveContextRef.current !== contextKey) return;
            setGenerateError(
                unsupportedAddressTypeMessage(err)
                || 'Could not create a new receive address. Check your connection and try again.',
            );
        } finally {
            if (generateRequestRef.current === request) {
                generateBusyRef.current = false;
                setGenerating(false);
            }
        }
    }, [activeChainId, addressType, messaging, walletId, accountId, receiveContextKey]);

    const saveAddressLabel = useCallback(async () => {
        if (!address?.id || labelSaving || labelDraftValue.trim() === (address.label || '')) return;
        if (typeof messaging.setAddressLabel !== 'function') {
            setLabelError('This app cannot save a label for this address.');
            return;
        }
        const addressId = address.id;
        const contextKey = receiveContextKey;
        const next = labelDraftValue.trim();
        const request = ++labelRequestRef.current;
        setLabelSave({ request, addressId });
        setLabelError(null);
        try {
            const result = await messaging.setAddressLabel(addressId, next);
            if (labelRequestRef.current !== request || receiveContextRef.current !== contextKey) return;
            const savedLabel = typeof result?.label === 'string'
                ? result.label
                : (next || 'Address');
            setAddress((current) => (
                current?.id === addressId ? { ...current, label: savedLabel } : current
            ));
            setChainsByWallet((current) => Object.fromEntries(
                Object.entries(current || {}).map(([chainId, records]) => [
                    chainId,
                    Array.isArray(records)
                        ? records.map((record) => record?.id === addressId
                            ? { ...record, label: savedLabel }
                            : record)
                        : records,
                ]),
            ));
        } catch {
            if (
                labelRequestRef.current === request
                && receiveContextRef.current === contextKey
                && currentAddressIdRef.current === addressId
            ) {
                setLabelError('Could not save the address label. Try again.');
            }
        } finally {
            if (labelRequestRef.current === request) setLabelSave(null);
        }
    }, [address?.id, labelDraftValue, labelSaving, messaging, receiveContextKey]);

    const onLabelKeyDown = useCallback((event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            saveAddressLabel();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            setLabelDraft({ addressId: address?.id || null, value: address?.label || '' });
            setLabelError(null);
        }
    }, [address?.id, address?.label, saveAddressLabel]);

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
                    ? 'This app cannot copy images, so it copied the payment link instead.'
                    : 'Could not copy the payment link. Clipboard access is unavailable.',
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
            const { ok } = await copyText(qrUri || address?.address || '');
            showToast(ok
                ? { message: 'Could not copy the QR code, so the payment link was copied instead.' }
                : { message: 'Could not copy the QR code. Clipboard access is unavailable.', variant: 'error' });
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
        let data = shareData;
        if (typeof nav?.canShare === 'function') {
            try {
                const blob = dataUrlToBlob(qrDataUrl);
                const withFile = {
                    ...shareData,
                    files: [new File([blob], qrFileName, { type: blob.type })],
                };
                if (nav.canShare(toWebShareData(withFile))) data = withFile;
            } catch { /* text and URL remain shareable without the QR image */ }
        }

        const outcome = await shareContent(data, { fallbackText: qrUri });
        if (outcome === ShareOutcome.SHARED || outcome === ShareOutcome.CANCELED) return;
        showToast(outcome === ShareOutcome.COPIED
            ? { message: 'Sharing is unavailable, so the payment link was copied to the clipboard.' }
            : { message: 'Could not share or copy the payment link.', variant: 'error' });
    }, [qrDataUrl, qrUri, reqTick, nativeTicker, descriptor?.displayName, reqAmount, qrFileName, showToast]);

    // Single-tap address copy uses the exact value shown without URI parameters
    // or display formatting. The adjacent Copy payment link control owns the QR
    // payload.
    const copyAddress = useCallback(async () => {
        if (!address?.address) return;
        const { ok } = await copyText(address.address);
        showToast({
            message: ok ? 'Address copied to clipboard.' : 'Could not copy the address. Clipboard access is unavailable.',
            variant: ok ? 'default' : 'error',
        });
    }, [address?.address, showToast]);
    const onAddressKeyDown = useCallback((event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            copyAddress();
        }
    }, [copyAddress]);

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel={t('common.backToHome')}
            title={t('home.receive')}
            titleIcon={<Icon.ReceiveIcon />}
        />
    );
    // §20: signer mode hides the receive surface, as its own hint
    // says. Named the way back, since the mode is a setting the user chose.
    if (isSignerMode) {
        return (
            <Screen variant={variant} header={header}>
                <StatusMessage variant="status">
                    {t('receive.thisWalletIsInSigner')}
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
                    actionLabel={t('common.openNetworkSettings')}
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
                title={t('receive.chooseAReceiveAddress')}
                walletId={walletId}
                accountId={accountId}
                chainId={activeChainId}
                onPick={(a) => {
                    addressManuallySelectedRef.current = true;
                    addressTypeRef.current = a?.addressType || addressType;
                    setAddress(a);
                    setAddressContextKey(receiveContextKey);
                    setAddressType(a?.addressType || addressType);
                    setAddressPickerOpen(false);
                }}
                addressUsageByKey={addressUsageByKey}
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

    const generateAddressButton = descriptor && addressType ? (
        <Button
            size="md"
            type="button"
            variant="secondary"
            onClick={generateNewAddress}
            loading={generating}
            disabled={generating}
            icon={<Icon.PlusIcon />}
            aria-label={t('receive.generateNewAddress')}
        >
            {t('receive.newAddress')}
        </Button>
    ) : null;

    const qrActionsContent = address ? (
        <div ref={qrActionsRef} className={`${qrStyles.actions} ${styles.qrActions}`}>
            <Button
                size="md"
                variant="secondary"
                onClick={copyQrImage}
                disabled={!qrDataUrl}
                icon={<Icon.CopyIcon />}
                aria-label={canCopyImages ? t('receive.copyQrCode') : t('receive.copyPaymentLink')}
            >
                {t('receive.copyQr')}
            </Button>
            <Button
                size="md"
                variant="secondary"
                onClick={shareQrImage}
                disabled={!qrDataUrl}
                icon={<Icon.UploadIcon />}
                aria-label={t('receive.shareQrPaymentLink')}
            >
                {t('receive.shareQr')}
            </Button>
            {addressExplorerUrl ? (
                <a
                    className={styles.explorerLink}
                    href={addressExplorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('receive.viewAddressInBlockExplorer')}
                >
                    {t('receive.explorer')} <span aria-hidden="true">↗</span>
                </a>
            ) : null}
            {generateAddressButton}
        </div>
    ) : null;

    // One page-level error at a time, drawn as the first item of the page content
    // (above the card when wide): the load failure, then a failed New address,
    // then a hardware-wallet verification failure. The amount error stays under
    // its field.
    const hwVerifyNotice = isHwAddress && address
        ? (hwVerify.status === 'mismatch'
            ? `${t('receive.your')} ${hwDeviceLabel} ${t('receive.showedADifferentAddressDo')}`
            : hwVerify.status === 'error' ? hwVerify.message : null)
        : null;
    const pageNotice = loadError
        ? <StatusMessage variant="error">{loadError}</StatusMessage>
        : generateError
            ? <StatusMessage variant="error" id="receive-generate-error">{generateError}</StatusMessage>
            : hwVerifyNotice
                ? <StatusMessage variant="error" id="receive-hw-verify-error">{hwVerifyNotice}</StatusMessage>
                : null;

    const body = (
        <>
            {noAddresses ? (
                <EmptyState
                    title={t('history.empty.noAddressesTitle')}
                    body={t('receive.generateAnAddressToStart')}
                    actionLabel={t('receive.generateAnAddress')}
                    onAction={() => setAddAddressOpen(true)}
                    actionIcon={<Icon.PlusIcon />}
                />
            ) : null}

            {offeredTypes.length > 1 ? (
                <Select
                    size="md"
                    label={t('receive.addressType')}
                    value={addressType}
                    onChange={(event) => changeAddressType(event.target.value)}
                    disabled={generating || !addressType}
                >
                    {offeredTypes.map((type) => (
                        <option key={type} value={type}>{addressTypeLabel(type)}</option>
                    ))}
                </Select>
            ) : null}

            {!address && descriptor && addressType && !generating && !generateError ? (
                <FormNotice variant="status">
                    {`${t('receive.thereIsNo')} ${addressTypeLabel(addressType)} ${t('receive.addressYetCreateOneTo')}`}
                </FormNotice>
            ) : null}

            {address ? (
                <div className={`${qrStyles.stack} ${styles.receiveQrDisplay}`}>
                    <div className={`${qrStyles.frame} ${styles.qrBox}`}>
                        <div
                            ref={qrSurfaceRef}
                            className={styles.qrSurface}
                            style={qrFit ? { '--xc-qr-fit-size': `${qrFit}px` } : undefined}
                        >
                            {qrDataUrl ? (
                                <img
                                    src={qrDataUrl}
                                    alt={t('receive.qrCodeFor', { address: address.address })}
                                    width={qrPixelSize}
                                    height={qrPixelSize}
                                    className={styles.qr}
                                />
                            ) : (
                                <div className={styles.qrPlaceholder} aria-hidden="true">
                                    {t('receive.renderingQr')}
                                </div>
                            )}
                        </div>
                    </div>
                    <AddressField
                        size="md"
                        // The visible label is the accessible name; the hint says a tap
                        // copies the address. A name about a payment link went stale when
                        // the tap stopped copying one.
                        label={address.label || t('verifySignature.address')}
                        icon="addresses"
                        value={address.address}
                        readOnly
                        onChange={() => {}}
                        onClick={copyAddress}
                        onKeyDown={onAddressKeyDown}
                        title={t('receive.tapToCopyAddress')}
                        hint={t('receive.tapTheAddressToCopy')}
                        style={{ cursor: 'text', userSelect: 'text' }}
                        wrapReadOnlyAddress
                        onIconClick={() => setAddressPickerOpen(true)}
                        iconLabel={t('receive.chooseReceiveAddress')}
                        data-testid="receive-address"
                    />
                    {qrActionsContent}
                </div>
            ) : null}

            {!address && generateAddressButton ? (
                <div className={styles.generateAddressAction}>{generateAddressButton}</div>
            ) : null}

            {address?.id ? (
                <div className={styles.labelEditor}>
                    <Input
                        size="md"
                        label={t('receive.addressLabel')}
                        value={labelDraftValue}
                        onChange={(event) => setLabelDraft({
                            addressId: address.id,
                            value: event.target.value,
                        })}
                        onKeyDown={onLabelKeyDown}
                        placeholder={t('receive.addALabel')}
                        maxLength={REQUEST_LABEL_MAX}
                        autoComplete="off"
                        error={labelError || undefined}
                    />
                    <Button
                        size="md"
                        type="button"
                        variant="secondary"
                        loading={labelSaving}
                        disabled={labelSaving || labelDraftValue.trim() === (address.label || '')}
                        onClick={saveAddressLabel}
                    >
                        {t('receive.saveLabel')}
                    </Button>
                </div>
            ) : null}

            {descriptor ? (() => {
                const prefillTickUpper = prefill?.tick ? prefill.tick.toUpperCase() : '';
                const isTokenSelection = !!prefillTickUpper
                    && nativeTicker
                    && prefillTickUpper !== nativeTicker;
                const selectedTick = isTokenSelection ? prefillTickUpper : (nativeTicker || '');
                return (
                    <button
                        type="button"
                        className={styles.assetCard}
                        onClick={onChangeAsset || onBack}
                        // Icon-only control: the accessible name carries the chain the icon overlay shows.
                        aria-label={t('receive.changeAssetCurrentlyOn', { selectedTick, displayName: descriptor.displayName })}
                    >
                        <TickerIcon chainId={descriptor.id} tick={selectedTick} size={48} />
                    </button>
                );
            })() : null}

            {address ? (
                <>
                    <div className={styles.amountEditor}>
                        <AmountField
                            size="md"
                            amount={reqAmount}
                            fiatAmount={fiatAmount}
                            tick={reqTick.trim() || nativeTicker || ''}
                            fiatRate={fiatRate}
                            fiatCurrency={fiatCurrency}
                            amountInputMode={amountInputMode}
                            divisibility={requestDivisibility}
                            onAmountFieldChange={onAmountFieldChange}
                            toggleAmountInputMode={toggleAmountInputMode}
                            inputRef={amountInputRef}
                            error={amountError || undefined}
                        />
                    </div>
                    {isHwAddress ? (
                        <section
                            role="group"
                            aria-label={t('receive.verifyThisReceiveAddressOn')}
                            className={styles.hwVerify}
                        >
                            <div className={styles.addressBox}>
                                <AddressText address={address.address} truncate={false} size="sm" />
                                <CopyButton value={address.address} label={t('receive.copyReceiveAddress')} />
                            </div>
                            {hwVerify.status === 'confirmed' ? (
                                <p className={styles.hint} role="status">
                                    {t('receive.addressVerifiedOnYour')} {hwDeviceLabel}{t('receive.itIsSafeToShare')}
                                </p>
                            ) : (
                                <p className={styles.hint}>
                                    {t('receive.verifyThisAddressOnYour')} {hwDeviceLabel} {t('receive.beforeSharingItThisProtects')}
                                </p>
                            )}
                            <Button
                                variant="secondary"
                                onClick={verifyOnDevice}
                                disabled={hwVerify.status === 'checking'}
                            >
                                {hwVerify.status === 'checking'
                                    ? t('receive.checkYour', { hwDeviceLabel })
                                    : t('receive.verifyOnYour', { hwDeviceLabel })}
                            </Button>
                        </section>
                    ) : null}
                </>
            ) : null}

            {multisigs.map((multisig) => (multisig.overCeiling ? (
                <FormNotice key={multisig.multisigConfigId} variant="warning" role="alert">
                    {t('multisig.overCeilingNotice')}
                </FormNotice>
            ) : (
                <section
                    key={multisig.multisigConfigId}
                    role="group"
                    aria-label={t('receive.multisigReceiveAddress')}
                    className={styles.multisigCard}
                >
                    <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)', marginBottom: 'var(--xc-space-2)' }}>
                        <MultisigBadge
                            threshold={multisig.threshold}
                            cosignerCount={multisig.cosignerCount}
                            scheme={multisig.scheme}
                        />
                        <strong>{multisig.schemeLabel}</strong>
                    </header>
                    <div className={`${qrStyles.stack} ${styles.receiveQrDisplay}`}>
                        {multisigQrs[multisig.multisigConfigId] ? (
                            <div className={`${qrStyles.frame} ${styles.qrBox}`}>
                                <img
                                    src={multisigQrs[multisig.multisigConfigId]}
                                    alt={t('receive.multisigQrCodeFor', { address: multisig.address })}
                                    width={qrPixelSize}
                                    height={qrPixelSize}
                                    className={styles.qr}
                                />
                            </div>
                        ) : (
                            <div className={`${qrStyles.frame} ${styles.qrBox}`} aria-hidden="true">
                                <div className={styles.qrPlaceholder}>{t('receive.renderingMultisigQr')}</div>
                            </div>
                        )}
                        <div className={styles.addressBox}>
                            <AddressText address={multisig.address} truncate={false} size="sm" />
                            <CopyButton value={multisig.address} label={t('receive.copyMultisignatureReceiveAddress')} />
                        </div>
                    </div>
                    {multisig.cosignerNames?.length > 0 ? (
                        <p className={styles.hint} style={{ marginTop: 'var(--xc-space-2)' }}>
                            {t('receive.peopleWhoCanSignCosigners')} {multisig.cosignerNames.join(' · ')}
                        </p>
                    ) : null}
                </section>
            )))}

        </>
    );

    return (
        <Screen variant={variant} header={header}>
            <FormPage
                label={t('receive.receivePayment')}
                status={pageNotice}
                onSubmit={(event) => event.preventDefault()}
                // The form has no submit button, so Enter in the amount, its last
                // field, commits the request explicitly; other fields never submit.
                onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.target !== amountInputRef.current) return;
                    event.preventDefault();
                    event.currentTarget.requestSubmit();
                }}
            >
                {body}
            </FormPage>
        </Screen>
    );
}
