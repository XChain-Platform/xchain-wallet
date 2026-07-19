// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import { Screen, Button, Icon } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { LICENSE_NAME, LICENSE_FILE, LICENSE_VERSION } from '../../buildInfo.js';
import { crypto as cryptoLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { OnboardingCarousel } from './OnboardingCarousel.jsx';
import styles from './Onboarding.module.css';
import pickerStyles from './WalletPicker.module.css';

const LICENSE_STORAGE_KEY = 'xc:licenseAcceptedAt';
const LICENSE_VERSION_KEY = 'xc:licenseAcceptedVersion';
// §25.2 / Cluster J FOLLOWUP 3: once the first-time explainer carousel is
// finished or skipped we record the timestamp so a returning user never
// sees it again. Unlike the license key this is a soft, one-shot UX aid,
// not a legal gate: it is never version-bumped.
const EXPLAINER_SEEN_KEY = 'xc:onboardingExplainerSeenAt';

// First-time explainer frames (§25.2). Deliberately short: four plain-
// language screens covering the mental model a crypto newcomer needs
// before the create/import fork. Copy avoids jargon ("gas", "network")
// per the wallet's single product voice (§21.7).
const EXPLAINER_FRAMES = [
    {
        id: 'self-custody',
        icon: <Icon.LockIcon />,
        title: 'You hold the keys',
        body: 'This wallet is self-custodial. Your coins and tokens live on the blockchain, and only your keys can move them. No company, including us, can freeze or access your funds.',
    },
    {
        id: 'recovery-phrase',
        icon: <Icon.KeyIcon />,
        title: 'Your recovery phrase is everything',
        body: 'When you create a wallet you get a secret list of words. Anyone with those words controls your funds, and if you lose them, nobody can restore access. Write them down and keep them offline.',
    },
    {
        id: 'transactions',
        icon: <Icon.SendIcon />,
        title: 'Sending is final',
        body: 'A blockchain transaction cannot be reversed once it is confirmed. Always double-check the address and the amount before you sign. There is no undo and no support line to call.',
    },
    {
        id: 'multi-chain',
        icon: <Icon.TokenIcon />,
        title: 'One wallet, several chains',
        body: 'Bitcoin, Litecoin, and Dogecoin each have their own addresses here. The wallet keeps them separate on purpose so you always know which chain you are acting on.',
    },
];

function readExplainerSeen() {
    try {
        return globalThis.localStorage?.getItem(EXPLAINER_SEEN_KEY) || null;
    } catch {
        return null;
    }
}

function markExplainerSeen() {
    try {
        globalThis.localStorage?.setItem(EXPLAINER_SEEN_KEY, new Date().toISOString());
    } catch { /* best-effort: the explainer just shows again next launch */ }
}

const LICENSE_SUMMARY = [
    { text: `By using ${branding.PRODUCT_NAME} you agree to the ${LICENSE_NAME}.` },
    {
        text: 'The wallet is provided as-is, with no warranties of any kind and no remedy if you lose your seed phrase, passphrase, or hardware wallet. Cryptocurrency is irreversible. Anything you send is gone the moment a miner includes it in a block.',
        critical: true,
    },
    {
        text: 'Your seed phrase never leaves this device. It is not uploaded, not transmitted, and not stored on any server. The team behind this software has no copy of it and no way to retrieve it. Backing it up is entirely your responsibility: write it down, store it somewhere safe, and never share it. If you lose this device AND your written copy, the keys are gone forever. Customer support cannot recover them. Nobody can.',
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
 * Welcome screen: entry point for users with no wallet yet.
 * Dispatches to `CreateWallet`, `ImportWallet`, or (§40.13) the
 * FreeWallet-branded `ImportWallet` variant via the parent App's
 * onboarding sub-route state.
 *
 * §25.2 / G058: also exposes a "Try in demo mode" button that creates a
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
    // §25.1 / G061: license-acceptance gate. Persisted to localStorage so
    // a returning user (e.g. after wiping a demo wallet) doesn't have to
    // re-accept. Cluster J FOLLOWUP 4: a `LICENSE_VERSION` constant tracks
    // the binding terms; if the stored version doesn't match the current
    // version, the gate fires regardless of `onBack` so re-acceptance
    // can't be bypassed via the unlocked-vault Add-Wallet shortcut.
    const [licenseAcceptedAt, setLicenseAcceptedAt] = useState(() => readAcceptedAt());
    const [licenseAcceptedVersion, setLicenseAcceptedVersion] = useState(() => readAcceptedVersion());
    const [scrolledToEnd, setScrolledToEnd] = useState(false);
    const [licenseAck, setLicenseAck] = useState(false);
    // §25.2 / FOLLOWUP 3: the first-time explainer carousel shows once,
    // only on the fresh-install path (never the unlocked-vault Add-Wallet
    // lane, where `onBack` is supplied and the user is plainly a returner).
    const [explainerSeenAt, setExplainerSeenAt] = useState(() => readExplainerSeen());
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

    // Fired whether the user finishes ("Get started") or skips the
    // explainer; either way it is dismissed for good on this device.
    function handleExplainerDone() {
        markExplainerSeen();
        setExplainerSeenAt(new Date().toISOString());
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
            // Cluster J FOLLOWUP 7: demo wallets register chains on
            // mainnet, testnet, AND regtest so the user can flip the
            // activeNetwork setting and see populated views on each.
            // No real fetches happen: Home / History both short-circuit
            // through synthesizeDemoBalances / synthesizeDemoHistory
            // when isDemoWallet returns true. If a future fetch path
            // forgets the demo guard it could leak the demo wallet's
            // addresses to real endpoints; keep the guards.
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
            // Persist the auto-password so a reload can silently re-unlock
            // this throwaway demo wallet instead of stranding the user on
            // the password screen with a key they never typed.
            if (walletId) flowsLib.markDemoWallet(walletId, { password });
            // Seed a few demo contacts (random names, 1-3 chains each) into the
            // address book so the Contacts screen, Send picker, and message
            // inbox show realistic contact data. Best-effort: a failure here
            // must not block entering the demo. The demo-exit wipe clears the
            // whole vault, so these don't outlive the throwaway wallet.
            if (typeof messaging.saveContact === 'function') {
                try {
                    for (const input of flowsLib.synthesizeDemoContacts()) {
                        await messaging.saveContact({ input });
                    }
                } catch { /* non-fatal: the demo works without seeded contacts */ }
            }
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

    // §25.2 / FOLLOWUP 3: first-time explainer carousel. Only on the
    // fresh-install path (no `onBack`), only until it has been seen once.
    // A returning user reaching Onboarding via the unlocked-vault
    // Add-Wallet shortcut has clearly used the wallet before and skips it.
    const showExplainer = !onBack && !explainerSeenAt;
    if (showExplainer) {
        return (
            <Screen variant={variant} header={null}>
                <OnboardingCarousel
                    frames={EXPLAINER_FRAMES}
                    variant={variant}
                    onDone={handleExplainerDone}
                />
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
