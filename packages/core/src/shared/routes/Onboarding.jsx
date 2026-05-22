import { useEffect, useRef, useState } from 'react';
import { Screen, Button, Icon } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { LICENSE_NAME, LICENSE_FILE, LICENSE_VERSION } from '../../buildInfo.js';
import { crypto as cryptoLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './Onboarding.module.css';
import pickerStyles from './WalletPicker.module.css';

const LICENSE_STORAGE_KEY = 'xc:licenseAcceptedAt';
const LICENSE_VERSION_KEY = 'xc:licenseAcceptedVersion';

const LICENSE_SUMMARY = [
    { text: `By using ${branding.PRODUCT_NAME} you agree to the ${LICENSE_NAME}.` },
    {
        text: 'The wallet is provided as-is — there are no warranties of any kind, and no remedy if you lose your seed phrase, passphrase, or hardware wallet. Cryptocurrency is irreversible. Anything you send is gone the moment a miner includes it in a block.',
        critical: true,
    },
    {
        text: 'Your seed phrase never leaves this device. It is not uploaded, not transmitted, and not stored on any server. The team behind this software has no copy of it and no way to retrieve it. Backing it up is entirely your responsibility — write it down, store it somewhere safe, and never share it. If you lose this device AND your written copy, the keys are gone forever. Customer support cannot recover them. Nobody can.',
        critical: true,
    },
    { text: 'You are solely responsible for your private keys, your transactions, and any tax or legal consequences thereof. The wallet does not withhold or report taxes. You are the bank.' },
    { text: 'You are also responsible for verifying the authenticity of every download. Releases are signed; check the signatures. Phishing copies of this app exist. We do not link to or endorse them.' },
    { text: 'Software and tokens visible in this wallet may be subject to local laws on financial instruments, securities, money transmission, anti-money-laundering, or sanctions. You agree not to use the wallet in a jurisdiction where doing so is unlawful, or to facilitate any unlawful activity through it.' },
    { text: 'Some features (hardware wallet integration, the dApp bridge, etc.) interact with third-party software you control. Vulnerabilities or bugs in those tools are not the wallet\'s responsibility. The wallet does its best to fail closed when it detects a problem.' },
    { text: `Full license text: ${LICENSE_FILE} in the source repository. Read it. Disagreement means you should not continue.` },
];

function readAcceptedAt() {
    try {
        return globalThis.localStorage?.getItem(LICENSE_STORAGE_KEY) || null;
    } catch {
        return null;
    }
}

function readAcceptedVersion() {
    try {
        return globalThis.localStorage?.getItem(LICENSE_VERSION_KEY) || null;
    } catch {
        return null;
    }
}

function markAccepted() {
    try {
        globalThis.localStorage?.setItem(LICENSE_STORAGE_KEY, new Date().toISOString());
        globalThis.localStorage?.setItem(LICENSE_VERSION_KEY, LICENSE_VERSION);
    } catch { /* best-effort */ }
}

/**
 * Welcome screen — the entry point for users with no wallet yet.
 * Dispatches to `CreateWallet`, `ImportWallet`, or (§40.13) the
 * FreeWallet-branded `ImportWallet` variant via the parent App's
 * onboarding sub-route state.
 *
 * §25.2 / G058 — also exposes a "Try in demo mode" button that creates a
 * throwaway BIP39 wallet with a random password (cached in session) and
 * routes the user straight into the unlocked Home view via `onDemoEntered`.
 *
 * @param {object} props
 * @param {() => void} [props.onCreate]
 * @param {() => void} [props.onImport]
 * @param {() => void} [props.onImportFromFreeWallet]
 * @param {() => void} [props.onDemoEntered]          fires after the demo wallet persists; caller refreshes App state into the unlocked tree
 * @param {() => void} [props.onBack]                 rendered as a Cancel button when present (used by the unlocked-state "Add Wallet" entry point)
 */
export function Onboarding({ onCreate, onImport, onImportFromFreeWallet, onDemoEntered, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const [demoBusy, setDemoBusy] = useState(false);
    const [demoError, setDemoError] = useState(/** @type {string | null} */ (null));
    // §25.1 / G061 — license-acceptance gate. Persisted to localStorage so
    // a returning user (e.g. after wiping a demo wallet) doesn't have to
    // re-accept. Cluster J FOLLOWUP 4: a `LICENSE_VERSION` constant tracks
    // the binding terms; if the stored version doesn't match the current
    // version, the gate fires regardless of `onBack` so re-acceptance
    // can't be bypassed via the unlocked-vault Add-Wallet shortcut.
    const [licenseAcceptedAt, setLicenseAcceptedAt] = useState(() => readAcceptedAt());
    const [licenseAcceptedVersion, setLicenseAcceptedVersion] = useState(() => readAcceptedVersion());
    const [scrolledToEnd, setScrolledToEnd] = useState(false);
    const [licenseAck, setLicenseAck] = useState(false);
    const licenseScrollRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const licenseSatisfied = !!licenseAcceptedAt && licenseAcceptedVersion === LICENSE_VERSION;

    useEffect(() => {
        // If the panel is already short enough that the user can see
        // everything without scrolling, treat as scrolled.
        const el = licenseScrollRef.current;
        if (!el) return;
        if (el.scrollHeight <= el.clientHeight + 4) setScrolledToEnd(true);
    }, [licenseSatisfied]);

    function handleLicenseScroll(event) {
        const el = event.currentTarget;
        if (!el) return;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) {
            setScrolledToEnd(true);
        }
    }

    function handleAcceptLicense() {
        markAccepted();
        setLicenseAcceptedAt(new Date().toISOString());
        setLicenseAcceptedVersion(LICENSE_VERSION);
    }

    async function handleEnterDemo() {
        if (demoBusy) return;
        if (typeof messaging?.importMnemonic !== 'function') {
            setDemoError('Demo mode is not available in this shell.');
            return;
        }
        setDemoBusy(true);
        setDemoError(null);
        try {
            // 32-byte hex auto-password kept in the session cache; the
            // user never sees it. Mnemonic generated locally per the
            // standard CreateWallet path.
            const passwordBytes = new Uint8Array(32);
            globalThis.crypto.getRandomValues(passwordBytes);
            const password = Array.from(passwordBytes, (b) =>
                b.toString(16).padStart(2, '0'),
            ).join('');
            passwordBytes.fill(0);
            const mnemonic = cryptoLib.generateBip39Mnemonic(128);
            // Cluster J FOLLOWUP 7 — demo wallets register chains on
            // mainnet, testnet, AND regtest so the user can flip the
            // activeNetwork setting and see populated views on each.
            // No real fetches happen: Home / History both short-circuit
            // through synthesizeDemoBalances / synthesizeDemoHistory
            // when isDemoWallet returns true. If a future fetch path
            // forgets the demo guard it could leak the demo wallet's
            // addresses to real endpoints — keep the guards.
            // `activeNetwork: 'regtest'` keeps the initial landing
            // experience the same as before; the user toggles in
            // Settings to see mainnet / testnet.
            const r = await messaging.importMnemonic({
                password,
                mnemonic,
                name: 'Demo Wallet',
                activeChainIds: [
                    'bitcoin-regtest', 'litecoin-regtest', 'dogecoin-regtest',
                    'bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet',
                    'bitcoin-testnet', 'litecoin-testnet', 'dogecoin-testnet',
                ],
                activeNetwork: 'regtest',
            });
            let walletId = r?.wallet?.id || r?.walletId || r?.id;
            if (!walletId && typeof messaging.listWallets === 'function') {
                try {
                    const list = await messaging.listWallets();
                    const arr = Array.isArray(list) ? list : list?.wallets;
                    if (Array.isArray(arr) && arr.length > 0) {
                        walletId = arr[arr.length - 1]?.id || null;
                    }
                } catch { /* best-effort */ }
            }
            if (walletId) flowsLib.markDemoWallet(walletId);
            if (typeof onDemoEntered === 'function') onDemoEntered();
        } catch (err) {
            setDemoError(err?.message || 'Could not start demo mode.');
        } finally {
            setDemoBusy(false);
        }
    }

    const header = onBack ? (
        <div className={pickerStyles.header}>
            <button
                type="button"
                onClick={onBack}
                className={pickerStyles.iconBtn}
                aria-label="Back"
                title="Back"
            >
                <Icon.BackIcon />
            </button>
            <span />
            <span />
        </div>
    ) : null;

    // First-launch + version-bump gate. The Add-Wallet shortcut (when
    // `onBack` is supplied) skips the gate ONLY when the user has
    // accepted the *current* LICENSE_VERSION; a version bump forces
    // re-acceptance through every entry path.
    if (!licenseSatisfied) {
        return (
            <Screen variant={variant} header={null}>
                <div className={styles.licenseGate}>
                    <div className={styles.licenseHero}>
                        <img
                            src={branding.logoUrl()}
                            alt={branding.PRODUCT_NAME}
                            className={isFull ? styles.logoFull : styles.logoPopup}
                        />
                    </div>
                    <div
                        ref={licenseScrollRef}
                        className={styles.licenseScroll}
                        onScroll={handleLicenseScroll}
                        tabIndex={0}
                        aria-label="License terms"
                    >
                        {LICENSE_SUMMARY.map((p, i) => (
                            <p
                                key={i}
                                className={p.critical ? styles.licenseParagraphCritical : styles.licenseParagraph}
                            >
                                {p.text}
                            </p>
                        ))}
                    </div>
                    <label className={styles.licenseAck}>
                        <input
                            type="checkbox"
                            checked={licenseAck}
                            disabled={!scrolledToEnd}
                            onChange={(e) => setLicenseAck(e.target.checked)}
                        />
                        <span>
                            {scrolledToEnd
                                ? 'I have read and agree to these terms.'
                                : 'Scroll to the end of the terms to enable.'}
                        </span>
                    </label>
                    <div className={isFull ? styles.actionsFull : styles.actionsPopup}>
                        <Button
                            variant="primary"
                            block
                            onClick={handleAcceptLicense}
                            disabled={!licenseAck || !scrolledToEnd}
                            icon={<Icon.CheckIcon />}
                        >
                            Accept and continue
                        </Button>
                    </div>
                </div>
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.heroFull : styles.heroPopup}>
                <img
                    src={branding.logoUrl()}
                    alt={branding.PRODUCT_NAME}
                    className={isFull ? styles.logoFull : styles.logoPopup}
                />
                <h1 className={isFull ? styles.nameFull : styles.namePopup}>
                    {branding.PRODUCT_NAME}
                </h1>
                <p className={isFull ? styles.taglineFull : styles.taglinePopup}>
                    {branding.TAGLINE}
                </p>
            </div>
            <div className={isFull ? styles.actionsFull : styles.actionsPopup}>
                <Button
                    variant="primary"
                    block
                    onClick={onCreate}
                    disabled={!onCreate}
                    icon={<Icon.PlusIcon />}
                >
                    Create new wallet
                </Button>
                <Button
                    variant="secondary"
                    block
                    onClick={onImport}
                    disabled={!onImport}
                    icon={<Icon.KeyIcon />}
                >
                    Import wallet
                </Button>
                <Button
                    variant="ghost"
                    block
                    onClick={onImportFromFreeWallet}
                    disabled={!onImportFromFreeWallet}
                    icon={<Icon.MigrateIcon />}
                >
                    From FreeWallet
                </Button>
                {onDemoEntered ? (
                    <Button
                        variant="ghost"
                        block
                        onClick={handleEnterDemo}
                        loading={demoBusy}
                        disabled={demoBusy}
                    >
                        {demoBusy ? 'Setting up demo…' : 'Try in demo mode'}
                    </Button>
                ) : null}
                {demoError ? (
                    <p role="alert" className={styles.demoError}>{demoError}</p>
                ) : null}
            </div>
        </Screen>
    );
}
