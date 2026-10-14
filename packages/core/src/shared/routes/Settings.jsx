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
import { Button, EmptyState, Icon, Input, ListPage, PageHeader, Screen, SectionHeader } from '@xchain-wallet/core/ui';
import { useBackHandler } from '../../ui/backStack.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { shellCapabilities } from '../shellCapabilities.js';
import { resolveBindings } from '../keyboard/shortcuts.js';
import { WALLET_VERSION } from '../../buildInfo.js';
import { AboutSection } from '../components/settings/AboutSection.jsx';
import { AdsSection } from '../components/settings/AdsSection.jsx';
import { AppearanceSection } from '../components/settings/AppearanceSection.jsx';
import { BackupSection } from '../components/settings/BackupSection.jsx';
import { ConnectedSitesSection } from '../components/settings/ConnectedSitesSection.jsx';
import { ContactsSection } from '../components/settings/ContactsSection.jsx';
import { DeveloperModeSection } from '../components/settings/DeveloperModeSection.jsx';
import { DisplaySection } from '../components/settings/DisplaySection.jsx';
import { KeyboardSection } from '../components/settings/KeyboardSection.jsx';
import { FeesSection } from '../components/settings/FeesSection.jsx';
import { LanguageRegionSection } from '../components/settings/LanguageRegionSection.jsx';
import { NetworkEndpointsSection } from '../components/settings/NetworkEndpointsSection.jsx';
import { NetworkSection } from '../components/settings/NetworkSection.jsx';
import { normalizeActiveNetwork } from '../utils/activeNetworkSwitch.js';

// Names the network the wallet is actually on, so the Network row never claims
// Mainnet while a test network is active.
function activeNetworkLabel(value) {
    const id = normalizeActiveNetwork(value);
    return id.charAt(0).toUpperCase() + id.slice(1);
}
import { NotificationsSection } from '../components/settings/NotificationsSection.jsx';
import { PrivacySection } from '../components/settings/PrivacySection.jsx';
import { SafetySection } from '../components/settings/SafetySection.jsx';
import { ThisWalletSection } from '../components/settings/ThisWalletSection.jsx';
import { WalletModeSection } from '../components/settings/WalletModeSection.jsx';
import {
    NUMBER_FORMAT_DEFAULT,
    SMALL_BALANCE_THRESHOLD_DEFAULT,
    WALLET_MODE_DEFAULT,
} from '../../schemas/settings.js';
import {
    clearActiveWallet,
    writeActiveWallet,
} from '../utils/activeWalletMemory.js';
import { wipeWalletStorage } from '../utils/wipeWalletStorage.js';
import { writeLastView } from '../utils/lastViewMemory.js';
import actionStyles from './ActionsMenu.module.css';
import settingsStyles from './Settings.module.css';
import { getLocale, t } from '../../i18n/index.js';
import cardStyles from '../../ui/Card.module.css';

const row = (title, terms = '', target = title) => ({ title, terms, target });

// Each time Settings opens it takes a fresh list scroll key, so the shell has
// no saved offset for it and the list starts at its first row. Closing a
// section keeps the key, so the list comes back where the user left it.
let settingsVisits = 0;

export const SETTINGS_SEARCH_ROWS = Object.freeze({
    'accounts-addresses': [row('Accounts & addresses', 'account address signer change pairing')],
    'this-wallet': [
        row('Wallet', 'switch rename name vault'),
        row('Upgrade recovery phrase', 'migrate legacy seed mnemonic'),
        row('Extended public keys', 'xpub export watch only'),
        row('Change wallet password', 'password security'),
        row('Remove wallet', 'delete destroy'),
    ],
    appearance: [row('Theme', 'dark light system'), row('Reduced motion', 'animation accessibility')],
    display: [
        row('Hide small balances', 'dust threshold'),
        row('Small-balance threshold', 'dust balance minimum'),
        row('Balance number format', 'decimal digits grouping'),
        row('Show pin button on rows', 'star favorite affordance'),
        row('Show hide button on rows', 'conceal affordance'),
        row('Watched tokens', 'watch token ticker'),
        row('Pinned tokens', 'pin star favorite reorder'),
        row('Hidden tokens', 'hide unhide concealed'),
        row('Saved chain filters', 'list preferences reset'),
        row('Reset display settings', 'defaults clear'),
    ],
    keyboard: [
        ...resolveBindings({}).map((shortcut) => row(shortcut.label, `${shortcut.group} shortcut hotkey keys`)),
        row('Reset all shortcuts', 'restore defaults bindings'),
    ],
    'language-region': [row('Language', 'locale translation'), row('Fiat currency', 'money usd eur local currency')],
    privacy: [
        row('Tor routing', 'proxy onion network privacy'),
        row('Change-address rotation', 'change address privacy'),
        row('Blur sensitive data on blur', 'hide conceal window focus'),
        row('Labels survive restore', 'backup recovery metadata'),
        row('Haptic feedback', 'vibration touch'),
        row('Native coin price data', 'prices market third party'),
        row('Fetch token metadata', 'token information third party'),
        row('Always require hardware cross-check confirm', 'hardware wallet verify address path'),
        row('Clipboard auto-clear', 'copy clear timeout seconds'),
        row('Form draft retention', 'saved forms persistence timeout'),
    ],
    safety: [
        row('Auto-lock timeout', 'lock idle minutes'),
        row('New-recipient test-send warning (sats)', 'test send threshold new address'),
        row('Lookalike address warnings', 'similar address scam'),
        row('Hold signed sends before broadcast', 'undo cancel delay transaction'),
        row('Hold duration in seconds (0 disables)', 'undo send delay timeout'),
        row('Biometric unlock', 'fingerprint face id touch id'),
        row('Panic mode', 'freeze signing emergency'),
        row('Duress passphrase', 'decoy emergency password'),
        row('Backup reminders', 'recovery reminder'),
    ],
    'wallet-mode': [
        row('Normal', 'full sign broadcast'),
        row('Watcher (watch-only)', 'unsigned psbt cold storage'),
        row('Signer (air-gapped)', 'offline psbt cold storage'),
    ],
    backup: [
        row('Export encrypted backup', 'backup file password'),
        row('Back up recovery phrase', 'seed mnemonic words reveal'),
        row('Test backup (dry-run restore)', 'verify seed recovery phrase'),
        row('Publish labels on-chain', 'backup metadata contacts blockchain'),
        row('Check chain for backed-up contacts', 'restore labels address book'),
    ],
    fees: [
        row('Fee strategy', 'fee fees network fee rate priority'),
        row('Custom fee rate', 'fee fees network fee sats per byte', 'Fee strategy'),
        row('Allow fee bump (Replace-by-Fee)', 'fee fees rbf speed up transaction'),
    ],
    network: [row('Active network', 'mainnet testnet regtest switch chain')],
    'network-endpoints': [
        row('Chain registry refresh', 'networks update registry'),
        row('Explorer URL', 'endpoint block explorer'),
        row('Encoder URL', 'endpoint transaction encoder'),
        row('Hub URL', 'endpoint node api'),
    ],
    notifications: [
        row('Desktop notifications', 'browser os permission alerts'),
        row('Transaction confirmations', 'confirmed sent transaction alert'),
        row('Incoming receipts', 'received payment alert'),
        row('Incoming pending payments', 'mempool unconfirmed payment alert'),
        row('Incoming messages', 'message alert'),
        row('Governance polls', 'vote proposal alert'),
        row('Deadlines', 'expiry expiration alert'),
        row('Dispenser running low', 'escrow stock alert'),
        row('Dispenser fills', 'sale purchase alert'),
        row('Order fills', 'dex trade matched alert'),
        row('Price alerts', 'market price target'),
        row('Quiet hours', 'do not disturb dnd schedule'),
        row('Notification sounds', 'audio noise alert'),
    ],
    'connected-sites': [
        row('Sign-request throttle', 'dapp request rate limit abuse'),
        row('Burst', 'sign throttle maximum requests'),
        row('Window (seconds)', 'sign throttle duration rate limit'),
        row('Blocked sites', 'dapp website origin denylist'),
        row('Site block history', 'blocked unblocked audit log'),
        row('Chains', 'dapp permission networks'),
        row('Accounts', 'dapp permission addresses'),
        row('Sign messages', 'dapp permission signature'),
        row('Sign actions', 'dapp permission transaction'),
    ],
    contacts: [
        row('Contacts in this wallet', 'address book count'),
        row('Export', 'contacts address book json csv download'),
        row('Import', 'contacts address book json csv upload'),
    ],
    ads: [
        row('Automatic Donation System', 'ads donations enable disable'),
        row('Set aside per outgoing transaction (sats)', 'per transaction donation amount network fee'),
        row('Send donation when pending reaches (sats)', 'trigger threshold accumulated donation'),
        row('Pending donation', 'accumulated donation'),
        row('Lifetime donations', 'donation total history'),
    ],
    developer: [
        row('Developer Mode', 'development advanced regtest'),
        row('Learn Mode', 'education explain'),
        row('Show variant popover', 'layout preview'),
        row('Auto-approve localhost dApps', 'local dapp connect permission'),
        row('Cache password for localhost auto-sign', 'local dapp signing timeout'),
        row('Logs and diagnostics console', 'debug log console'),
        row('Regtest networks', 'local network development'),
        row('Regtest faucet', 'mint test coins miner'),
        row('Miner URL', 'faucet endpoint'),
        row('Amount', 'faucet mint test coins'),
        row('Custom chains', 'add network descriptor'),
        row('Custom chain descriptor JSON', 'add network paste'),
    ],
    updates: [row('Check for updates', 'new version upgrade latest release')],
    about: [
        row('Version', 'app release'),
        row('Build identifier', 'build commit revision'),
        row('Platform', 'shell operating system'),
        row('Update channel', 'release channel'),
        row('Check for new versions', 'updates upgrade latest release'),
        row('License', 'agpl legal'),
        row('Notice', 'legal attribution'),
        row('Reproducible build', 'verify build'),
        row('Verify a release', 'signature verification'),
        row('Release signatures', 'gpg fingerprint'),
        row('Disclosure policy', 'security vulnerability'),
        row('Diagnostics', 'debug report copy'),
        row('Feedback', 'contact report issue'),
    ],
});

/**
 * Settings page (§35).
 *
 * Top-level layout uses three section kinds:
 *   - `external-drill`   single row showing a key fact; click navigates
 *                        outside Settings (Wallet / Account pickers).
 *   - `internal-drill`   single row with summary state on the right;
 *                        click renders the section's Component inside a
 *                        Settings sub-page (back returns to the list).
 *   - `panel`            short, dense bodies the user wants to see at a
 *                        glance: rendered inline with the section
 *                        heading and description above the body.
 *
 * The drilldown / inline split is per the §35 UX pass: pages get long
 * fast when every section renders inline, and the user can't scan
 * "what's set" without entering each panel. Drill rows surface the
 * current state on the row itself.
 *
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {{ id: string, name: string } | null} [props.activeWallet]
 * @param {{ id: string, name: string, index: number } | null} [props.activeAccount]
 * @param {() => void} [props.onOpenWalletPicker]
 * @param {() => void} [props.onOpenAccountPicker]
 * @param {string} [props.initialSubpageId]   §24 Cluster Y FOLLOWUP 2: open this drilldown panel on mount (e.g. 'connected-sites' from a deep nav row)
 * @param {(sel: { chainId: string, tick: string }) => void} [props.onNavigateToMint]   Developer Mode's regtest faucet "Mint test XCHAIN" button
 * @param {() => void} [props.onOpenBackupInTab]
 * @param {() => void} [props.reload]
 */
export function Settings({
    onBack,
    activeWallet,
    activeAccount,
    onOpenWalletPicker,
    onOpenAccountPicker,
    initialSubpageId = null,
    onNavigateToMint,
    onOpenBackupInTab,
    reload = reloadPage,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [query, setQuery] = useState('');
    const [subpageId, setSubpageId] = useState(/** @type {string | null} */ (initialSubpageId || null));
    const [searchTarget, setSearchTarget] = useState(/** @type {string | null} */ (null));
    const [listScrollKey] = useState(() => `list-${(settingsVisits += 1)}`);
    const [siteCount, setSiteCount] = useState(/** @type {number | null} */ (null));
    const [siteSearchTerms, setSiteSearchTerms] = useState('');
    const [walletManagementBusy, setWalletManagementBusy] = useState(false);
    const sectionOpenerRefs = useRef(new Map());
    const pendingFocusRestore = useRef(/** @type {string | null} */ (null));

    const { settings } = useSettings();

    const closeSubpage = useCallback(() => {
        pendingFocusRestore.current = subpageId;
        setSubpageId(null);
        setSearchTarget(null);
    }, [subpageId]);

    // A Settings drilldown is nested UI, so Escape and the system Back action
    // close it before the surrounding route.
    useBackHandler(subpageId ? closeSubpage : undefined);

    useEffect(() => {
        if (subpageId || !pendingFocusRestore.current) return;
        const openerId = pendingFocusRestore.current;
        pendingFocusRestore.current = null;
        // The Screen restores the list offset; focusing must not scroll it.
        sectionOpenerRefs.current.get(openerId)?.focus({ preventScroll: true });
    }, [subpageId]);

    useEffect(() => {
        let alive = true;
        if (typeof messaging?.listConnectedSites !== 'function') return undefined;
        messaging.listConnectedSites()
            .then((list) => {
                if (!alive) return;
                const sites = Array.isArray(list) ? list : [];
                setSiteCount(sites.length);
                setSiteSearchTerms(sites.flatMap((site) => [site?.appName, site?.origin]).filter(Boolean).join(' '));
            })
            .catch(() => {
                if (alive) {
                    setSiteCount(0);
                    setSiteSearchTerms('');
                }
            });
        return () => { alive = false; };
    }, [messaging]);

    const handleWalletRemoved = useCallback(async (removedWalletId) => {
        clearActiveWallet();
        try {
            // Require a fresh list before selecting a replacement wallet.
            if (typeof messaging?.listWallets !== 'function') {
                throw new Error('Could not refresh the wallet list.');
            }
            const listed = await messaging.listWallets();
            const wallets = Array.isArray(listed) ? listed : listed?.wallets;
            // Reject unknown response shapes so an empty-looking result cannot wipe a real vault.
            if (!Array.isArray(wallets)) {
                throw new Error('Could not refresh the wallet list.');
            }

            const nextWallet = wallets.find((wallet) => wallet?.id && wallet.id !== removedWalletId);
            if (nextWallet) {
                writeActiveWallet(nextWallet.id);
            } else {
                await wipeWalletStorage();
            }
        } finally {
            // Reload even when fallback selection fails so no live screen keeps the removed wallet selected.
            reload();
        }
    }, [messaging, reload]);

    const walletLabel = activeWallet?.name || t('shell.settingsButton.noWallet');
    const accountLabel = activeAccount?.name
        || (Number.isInteger(activeAccount?.index) ? t('accountPicker.defaultName', { number: activeAccount.index + 1 }) : t('accountPicker.defaultName', { number: 1 }));

    const sections = useMemo(() => /** @type {SectionDef[]} */ ([
        {
            id: 'this-wallet',
            title: t('settings.page.thisWallet'),
            description: t('settings.page.manageItsNameExtendedPublic'),
            keywords: 'wallet name xpub extended public key watch only export switch rename remove delete destroy migrate bip39 upgrade recovery phrase encrypted seed backup',
            kind: 'internal-drill',
            Component: ThisWalletSection,
            props: {
                activeWallet, onOpenWalletPicker, activeAccount,
                onWalletRemoved: handleWalletRemoved,
                onBusyChange: setWalletManagementBusy,
            },
            summary: walletLabel,
        },
        {
            id: 'accounts-addresses',
            title: t('settings.page.accountsAddresses'),
            description: t('settings.page.chooseTheActiveAccountAnd'),
            keywords: 'account address signer change addresses',
            kind: 'external-drill',
            visible: Boolean(onOpenAccountPicker && activeWallet),
            onOpen: onOpenAccountPicker,
            summary: accountLabel,
        },
        {
            id: 'appearance',
            title: t('settings.page.appearance'),
            description: t('settings.page.chooseTheThemeAndMotion'),
            keywords: 'appearance theme system default motion dark light reduced follow',
            kind: 'panel',
            Component: AppearanceSection,
        },
        {
            id: 'display',
            title: t('settings.page.display'),
            description: t('settings.page.controlBalanceThresholdsNumberFormatting'),
            keywords: 'display balance threshold number format pinned hidden tokens reorder unhide bulk star',
            searchTerms: 'row affordances show pin hide button unpin list preferences saved chain filters reset',
            kind: 'internal-drill',
            Component: DisplaySection,
            summary: displaySummary(settings),
        },
        {
            id: 'keyboard',
            title: t('settings.page.keyboard'),
            description: t('settings.page.viewAndRebindShortcuts'),
            keywords: 'keyboard shortcuts rebind reset keys hotkeys bindings open command palette lock wallet settings new send go balances history receive dex contacts filter export pin hide focused token submit form',
            kind: 'internal-drill',
            Component: KeyboardSection,
            summary: keyboardSummary(settings),
            visible: variant !== 'small',
        },
        {
            id: 'language-region',
            title: t('settings.page.languageRegion'),
            description: t('settings.page.chooseTheInterfaceLanguageAnd'),
            keywords: 'language region currency fiat locale custom iso code',
            kind: 'panel',
            Component: LanguageRegionSection,
        },
        {
            id: 'privacy',
            title: t('settings.page.privacy'),
            description: t('settings.page.controlNetworkPrivacySensitiveData'),
            keywords: 'privacy tor routing change address rotation blur sensitive data labels survive restore haptic feedback native coin price data fetch token metadata hardware cross check confirm form draft retention',
            kind: 'internal-drill',
            Component: PrivacySection,
            summary: privacySummary(settings),
        },
        {
            id: 'safety',
            title: t('settings.page.safety'),
            description: t('settings.page.setAutoLockSendSafeguards'),
            keywords: 'safety autolock auto lock timeout test send warning threshold cancel sends undo biometric unlock wallet password panic mode duress passphrase backup reminders',
            kind: 'internal-drill',
            Component: SafetySection,
            summary: safetySummary(settings),
        },
        {
            id: 'wallet-mode',
            title: t('settings.page.walletMode'),
            description: t('settings.page.chooseWhetherThisDeviceSigns'),
            keywords: 'wallet mode full watcher watch only signer air gapped psbt cold storage',
            kind: 'internal-drill',
            Component: WalletModeSection,
            summary: walletModeSummary(settings),
        },
        {
            id: 'backup',
            title: t('settings.page.backup'),
            description: t('settings.page.exportRecoveryDataVerifyA'),
            keywords: 'backup password wallet password export encrypted file reveal back up seed recovery phrase mnemonic test dry run restore publish labels on chain contacts',
            kind: 'internal-drill',
            Component: BackupSection,
            props: { activeWallet, reload },
            summary: t('settings.page.encryptedFileExport'),
        },
        {
            id: 'fees',
            title: t('settings.page.fees'),
            description: t('settings.page.chooseTheFeeStrategyAnd'),
            keywords: 'fees fee strategy rate rbf replace by fee chain custom allow bump defaults',
            kind: 'internal-drill',
            Component: FeesSection,
            summary: feesSummary(settings),
        },
        {
            id: 'network',
            title: t('settings.network.label'),
            // Optional-chained: settings is null until the async read lands,
            // and the section list renders during that window.
            description: settings?.developerMode === true
                ? t('settings.page.networkChooseAll')
                : settings?.developerMode === false
                    ? (normalizeActiveNetwork(settings.activeNetwork) === 'mainnet'
                        ? t('settings.page.networkMainnetActive')
                        : t('settings.page.networkActiveLocked', { network: activeNetworkLabel(settings.activeNetwork) }))
                    : t('settings.page.networkChooseTwo'),
            keywords: settings?.developerMode === true
                ? 'network active mainnet testnet regtest filter chain switch mode dev'
                : settings?.developerMode === false
                    ? 'network active mainnet developer mode'
                    : 'network active mainnet testnet filter chain switch mode',
            kind: 'panel',
            Component: NetworkSection,
            // The section needs the wallet so the switch can derive
            // that wallet's first address on each chain of the new network.
            props: {
                activeWallet,
                reload: () => {
                    // Resume on Home because the saved route belongs to the
                    // previous network's data.
                    writeLastView(activeWallet?.id, 'home');
                    reload();
                },
            },
        },
        {
            id: 'network-endpoints',
            title: t('settings.page.networkEndpoints'),
            description: t('settings.page.setExplorerEncoderAndHub'),
            keywords: 'network endpoints explorer encoder hub url chain registry reset default save',
            kind: 'internal-drill',
            Component: NetworkEndpointsSection,
            visible: settings?.developerMode !== false,
            summary: endpointsSummary(settings),
        },
        {
            id: 'notifications',
            title: t('alerts.notificationsTitle'),
            description: t('settings.page.chooseWhichWalletEventsTrigger'),
            keywords: 'notifications desktop permission transaction confirmations incoming receipts pending payments messages governance polls deadlines dispenser running low fills order price alerts sounds quiet hours do not disturb',
            kind: 'panel',
            Component: NotificationsSection,
            props: { walletId: activeWallet?.id },
        },
        {
            id: 'connected-sites',
            title: t('settings.connectedSites.connectedSites'),
            description: t('settings.page.reviewDappConnectionsAndControl'),
            keywords: 'connected sites website dapp connections permissions chains accounts sign messages actions origin disconnect block unblock blocked mutations throttle burst window',
            searchTerms: siteSearchTerms,
            kind: 'internal-drill',
            Component: ConnectedSitesSection,
            summary: connectedSitesSummary(siteCount),
        },
        {
            id: 'contacts',
            title: t('components.contactsPickerScreen.contacts'),
            description: t('settings.page.exportOrImportTheAddress'),
            keywords: 'contacts address book export import json file drop private encrypted',
            kind: 'panel',
            Component: ContactsSection,
        },
        {
            id: 'ads',
            title: t('settings.page.automaticDonationSystem'),
            description: t('settings.page.turnAutomaticDonationsOnOr'),
            keywords: 'donation ads automatic on off per chain transaction amount trigger threshold address lifetime totals',
            kind: 'internal-drill',
            Component: AdsSection,
            summary: adsSummary(settings),
        },
        {
            id: 'developer',
            title: t('settings.page.developerMode'),
            description: t('settings.page.configureRegtestNetworksCustomEndpoints'),
            keywords: 'developer mode learn variant popover regtest networks faucet mint custom chains endpoints diagnostics logs console localhost dapps auto approve auto sign cache password miner url',
            kind: 'internal-drill',
            Component: DeveloperModeSection,
            props: { activeWallet, activeAccount, onNavigateToMint, reload },
            summary: developerSummary(settings),
        },
        ...(desktopUpdaterBridge() ? [{
            id: 'updates',
            title: t('settings.page.updates'),
            description: t('settings.page.checkForANewVersion'),
            keywords: 'updates update check for updates new version upgrade latest release',
            kind: 'panel',
            Component: UpdateCheckPanel,
        }] : []),
        {
            id: 'about',
            title: t('routes.addressList.about'),
            description: t('settings.page.viewVersionLicenseBuildVerification'),
            keywords: 'about version update channel check new versions license notice repro reproducible build verify verification release signatures gpg fingerprint disclosure policy security diagnostics copy preview',
            kind: 'internal-drill',
            Component: AboutSection,
            summary: WALLET_VERSION,
        },
    ]), [walletLabel, accountLabel, onOpenWalletPicker, onOpenAccountPicker, activeWallet, activeAccount, settings, siteCount, siteSearchTerms, onNavigateToMint, handleWalletRemoved, reload, variant, getLocale()]);

    // List-view filter. Hoisted ABOVE the subpage early-return so that
    // both render paths call the same number of hooks; flipping
    // `subpageId` from null to a section id used to drop a useMemo
    // call from the second render, tripping React's
    // "Rendered fewer hooks than expected" guard.
    const filtered = useMemo(() => {
        const visibleSections = sections.filter((section) => section.visible !== false);
        const q = normalizeSearchText(query);
        if (!q) return visibleSections;
        return visibleSections.filter((s) => {
            const searchable = normalizeSearchText([
                s.title,
                s.description,
                s.keywords,
                s.searchTerms,
                s.summary,
            ].filter(Boolean).join(' '));
            const terms = q.split(' ');
            const sectionWords = searchable.split(' ');
            return terms.every((term) => sectionWords.some((word) => searchWordMatches(word, term)))
                || SETTINGS_SEARCH_ROWS[s.id]?.some((item) => searchItemMatches(item, terms));
        });
    }, [sections, query]);

    // ─── Subpage view ─────────────────────────────────────────────

    if (subpageId) {
        const section = sections.find((s) => s.id === subpageId && s.visible !== false);
        if (section && section.kind === 'internal-drill' && section.Component) {
            const SectionComponent = section.Component;
            const subpageHeader = (
                <PageHeader
                    nested
                    onBack={closeSubpage}
                    backDisabled={section.id === 'this-wallet' && walletManagementBusy}
                    backLabel={t('shell.settings.back')}
                    title={section.title}
                    trailing={section.id === 'backup' && onOpenBackupInTab ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            icon={<Icon.ExternalLinkIcon />}
                            onClick={onOpenBackupInTab}
                            aria-label={t('importWallet.openInTab')}
                            title={t('importWallet.openInTab')}
                        />
                    ) : null}
                />
            );
            return (
                <Screen
                    variant={variant}
                    header={subpageHeader}
                    scrollKey={section.id}
                    restoreScroll={false}
                >
                    <SettingsPageTemplate view="subpage">
                        <SettingsSearchHighlight target={searchTarget}>
                            <SectionComponent
                                key={section.id === 'this-wallet' ? activeWallet?.id || 'none' : section.id}
                                {...(section.props || {})}
                            />
                        </SettingsSearchHighlight>
                    </SettingsPageTemplate>
                </Screen>
            );
        }
        // Fallback for stale subpageId: return to list
        setSubpageId(null);
    }

    // ─── List view ────────────────────────────────────────────────

    const header = <PageHeader onBack={onBack} title={t('home.settings')} />;

    return (
        // A route-wide key restored the last visit's offset and reopened
        // Settings part way down (clamped to whatever height had rendered by
        // then, so not even where the user left it). See settingsVisits.
        <Screen variant={variant} header={header} scrollKey={listScrollKey}>
            <SettingsPageTemplate
                view="list"
                toolbar={(
                    <div className={settingsStyles.searchField}>
                        <Input
                            type="search"
                            enterKeyHint="search"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t('settings.page.searchSettings')}
                            aria-label={t('settings.page.searchSettings2')}
                        />
                    </div>
                )}
            >
                {filtered.length === 0 ? (
                    <EmptyState title={t('settings.page.noMatchingSettings')} body={t('settings.page.noSettingsMatch', { query })} />
                ) : null}
                {filtered.map((section) => {
                    const matchedRow = findMatchingSearchRow(section.id, query);
                    if (section.kind === 'external-drill') {
                        if (section.visible === false) return null;
                        return (
                            <DrillRow
                                key={section.id}
                                title={section.title}
                                summary={matchedRow?.title || section.summary}
                                onClick={section.onOpen}
                            />
                        );
                    }
                    if (section.kind === 'internal-drill' && section.Component) {
                        return (
                            <DrillRow
                                key={section.id}
                                title={section.title}
                                summary={matchedRow?.title || section.summary}
                                onClick={() => {
                                    setSearchTarget(matchedRow?.target || query.trim() || null);
                                    setSubpageId(section.id);
                                }}
                                buttonRef={(node) => {
                                    if (node) sectionOpenerRefs.current.set(section.id, node);
                                    else sectionOpenerRefs.current.delete(section.id);
                                }}
                            />
                        );
                    }
                    if (section.kind === 'panel' && section.Component) {
                        const Component = section.Component;
                        const panelProps = section.props || {};
                        return (
                            <PanelBlock
                                key={section.id}
                                title={section.title}
                                description={section.description}
                            >
                                <SettingsSearchHighlight target={matchedRow?.target || null}>
                                    <Component {...panelProps} />
                                </SettingsSearchHighlight>
                            </PanelBlock>
                        );
                    }
                    return (
                        <PanelBlock
                            key={section.id}
                            title={section.title}
                            description={section.description}
                        >
                            <ComingSoon />
                        </PanelBlock>
                    );
                })}
            </SettingsPageTemplate>
        </Screen>
    );
}

function SettingsPageTemplate({ view, children, ...props }) {
    return (
        <ListPage
            className={settingsStyles.page}
            data-settings-layout="responsive"
            data-settings-page-template={view}
            {...props}
        >
            {children}
        </ListPage>
    );
}

function reloadPage() {
    if (typeof globalThis.location?.reload === 'function') {
        globalThis.location.reload();
    }
}

function normalizeSearchText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function searchItemMatches(item, terms) {
    const words = normalizeSearchText(`${item.title} ${item.terms}`).split(' ');
    return terms.every((term) => words.some((word) => searchWordMatches(word, term)));
}

function searchWordMatches(word, term) {
    return word === term || word === `${term}s` || `${word}s` === term;
}

export function findMatchingSearchRow(sectionId, query) {
    const terms = normalizeSearchText(query).split(' ').filter(Boolean);
    if (terms.length === 0) return null;
    const rows = SETTINGS_SEARCH_ROWS[sectionId] || [];
    const normalizedQuery = terms.join(' ');
    return rows.find((item) => normalizeSearchText(item.title) === normalizedQuery)
        || rows.find((item) => searchItemMatches(item, terms))
        || null;
}

function SettingsSearchHighlight({ target, children }) {
    const scopeRef = useRef(null);

    useEffect(() => {
        const scope = scopeRef.current;
        if (!scope || !target) return undefined;
        let highlighted = null;
        let matchedLabel = null;
        const markMatch = () => {
            const needle = normalizeSearchText(target);
            const candidates = scope.querySelectorAll('label, legend, h2, h3, h4, span, button');
            const match = [...candidates].find((element) => {
                const text = normalizeSearchText(element.textContent);
                return text === needle || text.startsWith(`${needle} `);
            });
            if (!match) return false;
            let container = match;
            for (let node = match.parentElement; node && node !== scope; node = node.parentElement) {
                const style = globalThis.getComputedStyle?.(node);
                if (node.matches('section, form') || (style && style.borderTopStyle !== 'none')) {
                    container = node;
                    break;
                }
            }
            highlighted = container;
            matchedLabel = match;
            highlighted.setAttribute('data-settings-search-highlight', 'true');
            matchedLabel.setAttribute('data-settings-search-match', 'true');
            highlighted.scrollIntoView?.({ block: 'center' });
            return true;
        };
        const clear = () => {
            highlighted?.removeAttribute('data-settings-search-highlight');
            matchedLabel?.removeAttribute('data-settings-search-match');
        };
        if (markMatch()) return clear;
        const observer = new MutationObserver(() => {
            if (markMatch()) observer.disconnect();
        });
        observer.observe(scope, { childList: true, subtree: true });
        return () => {
            observer.disconnect();
            clear();
        };
    }, [target]);

    return <div ref={scopeRef} className={settingsStyles.searchHighlightScope}>{children}</div>;
}

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   description: string,
 *   keywords: string,
 *   searchTerms?: string,
 *   kind: 'external-drill' | 'internal-drill' | 'panel' | 'stub',
 *   visible?: boolean,
 *   summary?: string,
 *   onOpen?: () => void,
 *   Component?: (props?: any) => any,
 *   props?: Record<string, unknown>,
 * }} SectionDef
 */

function DrillRow({ title, summary, onClick, buttonRef }) {
    return (
        // Keep the native button because the complete drill row is the list action target.
        <button
            ref={buttonRef}
            type="button"
            className={`${actionStyles.entry} ${settingsStyles.drillRow}`}
            style={{
                width: '100%',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--xc-space-3)',
            }}
            onClick={onClick}
        >
            <span className={`${actionStyles.entryLabel} ${settingsStyles.drillLabel}`}>{title}</span>
            <span className={settingsStyles.drillSummary} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--xc-space-2)',
                minWidth: 0,
                flex: 1,
                justifyContent: 'flex-end',
            }}>
                {summary ? (
                    <span style={{
                        color: 'var(--xc-text-muted)',
                        fontSize: 'var(--xc-text-sm)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textAlign: 'right',
                    }}>
                        {summary}
                    </span>
                ) : null}
                <span aria-hidden="true" style={{ color: 'var(--xc-text-muted)', display: 'inline-flex', flexShrink: 0 }}>
                    <Icon.ForwardIcon />
                </span>
            </span>
        </button>
    );
}

/**
 * The desktop shell's updater bridge, or null in every other shell.
 * @returns {{ onEvent: (cb: (e: any) => void) => (() => void), install: (action?: string) => Promise<any> } | null}
 */
function desktopUpdaterBridge() {
    const bridge = typeof window === 'undefined' ? null : window.xchainWalletUpdater;
    return bridge && typeof bridge.install === 'function' && typeof bridge.onEvent === 'function'
        ? bridge
        : null;
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Check for updates. Runs the same visible check as the app menu item (main's
 * 'check' action) and shows its outcome. Every sentence is a constant; the
 * only feed-derived value shown is a version that parses as plain semver.
 */
function UpdateCheckPanel() {
    // 'idle' | 'checking' | 'current' | 'available' | 'error'
    const [state, setState] = useState('idle');
    const [version, setVersion] = useState(/** @type {string | null} */ (null));
    const pending = useRef(false);

    useEffect(() => {
        const bridge = desktopUpdaterBridge();
        if (!bridge) return undefined;
        const unsubscribe = bridge.onEvent((event) => {
            if (!pending.current) return;
            const type = event?.type;
            if (type === 'not-available' && event?.userInitiated) {
                pending.current = false;
                setState('current');
            } else if (type === 'available') {
                const next = String(event?.info?.version ?? '');
                pending.current = false;
                setVersion(SEMVER.test(next) ? next : null);
                setState('available');
            } else if (type === 'error' && event?.userInitiated) {
                pending.current = false;
                setState('error');
            }
        });
        return () => { unsubscribe?.(); };
    }, []);

    const check = useCallback(() => {
        const bridge = desktopUpdaterBridge();
        if (!bridge || pending.current) return;
        pending.current = true;
        setState('checking');
        Promise.resolve(bridge.install('check'))
            .then((result) => {
                // Events normally settle the state first; a refusal never emits one.
                if (result && result.ok === false && pending.current) {
                    pending.current = false;
                    setState('error');
                }
            })
            .catch(() => {
                pending.current = false;
                setState('error');
            });
    }, []);

    const message = {
        checking: 'Checking for updates…',
        current: 'You are up to date.',
        available: version ? `Version ${version} is available.` : 'A new version is available.',
        error: 'Could not check for updates. Try again later.',
    }[state];

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--xc-space-3)' }}>
            <Button variant="ghost" size="sm" onClick={check} disabled={state === 'checking'}>
                {t('settings.page.checkForUpdates')}
            </Button>
            <span role="status" aria-live="polite" style={{ fontSize: 'var(--xc-text-sm)', color: 'var(--xc-text-muted)' }}>
                {message || ''}
            </span>
        </div>
    );
}

function PanelBlock({ title, description, children }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-settings-row-gap)' }}>
            <SectionHeader
                className={settingsStyles.sectionHeader}
                title={title}
                description={description}
            />
            {children}
        </div>
    );
}

function ComingSoon() {
    return (
        <div className={cardStyles.card} style={{
            color: 'var(--xc-text-muted)',
            fontSize: 'var(--xc-text-sm)',
            fontStyle: 'italic',
        }}>
            {t('settings.page.comingSoon')}
        </div>
    );
}

// ─── Summary helpers ──────────────────────────────────────────────

function privacySummary(settings) {
    if (!settings) return '-';
    const p = settings.privacy || {};
    // Mirrors the switches PrivacySection renders. Tor routing is counted
    // only where the shell can proxy; elsewhere its switch is inert.
    // Switches that default on read as on until stored false.
    const offByDefault = ['changeAddressRotation', 'blurOnBlur', 'labelsSurviveRestore', 'alwaysRequireHwExplicitConfirm'];
    const onByDefault = ['hapticsEnabled', 'priceDataEnabled', 'metadataFetchEnabled'];
    if (shellCapabilities().socksProxy) offByDefault.unshift('torRouting');
    const onCount = offByDefault.filter((k) => p[k] === true).length
        + onByDefault.filter((k) => p[k] !== false).length;
    return t('settings.page.privacyOn', { on: onCount, total: offByDefault.length + onByDefault.length });
}

function safetySummary(settings) {
    if (!settings) return '-';
    const mins = settings.autolockMinutes;
    if (mins === 0) return t('settings.page.autoLockOff');
    return t('settings.page.autoLockMinutes', { minutes: mins });
}

function displaySummary(settings) {
    if (!settings) return '-';
    const pinned = Array.isArray(settings.pinnedTokens) ? settings.pinnedTokens.length : 0;
    const hidden = Array.isArray(settings.hiddenTokens) ? settings.hiddenTokens.length : 0;
    const parts = [];
    if (pinned > 0) parts.push(t('settings.page.pinnedCount', { count: pinned }));
    if (hidden > 0) parts.push(t('settings.page.hiddenCount', { count: hidden }));
    if (settings.privacy?.hideSmallBalances === true) {
        const threshold = settings.smallBalanceThreshold || SMALL_BALANCE_THRESHOLD_DEFAULT;
        parts.push(threshold === 'dust' ? t('settings.page.dustHidden') : t('settings.page.belowHidden', { threshold }));
    }
    if ((settings.numberFormat || NUMBER_FORMAT_DEFAULT) !== NUMBER_FORMAT_DEFAULT) {
        parts.push(settings.numberFormat === 'trim' ? t('settings.page.trimmedNumbers') : t('settings.page.plainNumbers'));
    }
    if (parts.length === 0) return t('settings.page.noCustomization');
    return parts.join(' · ');
}

function keyboardSummary(settings) {
    if (!settings) return '-';
    const n = resolveBindings(settings.keyboard?.bindings).filter((shortcut) => shortcut.overridden).length;
    return n === 0 ? t('settings.display.defaults') : t('settings.page.customShortcuts', { count: n });
}

function walletModeSummary(settings) {
    if (!settings) return '-';
    const mode = settings.walletMode || WALLET_MODE_DEFAULT;
    if (mode === 'full') return t('ui.feeSelector.normal');
    if (mode === 'watcher') return t('settings.page.modeWatcher');
    if (mode === 'signer') return t('settings.page.modeSigner');
    return mode;
}

function feesSummary(settings) {
    if (!settings) return '-';
    const fees = settings.fees || {};
    const chainIds = Object.keys(fees);
    if (chainIds.length === 0) return t('settings.page.noChains');
    const customCount = chainIds.filter((id) => fees[id]?.strategy === 'custom').length;
    if (customCount === 0) return t('settings.page.allDefaults');
    if (customCount === chainIds.length) return t('settings.page.allCustom');
    return t('settings.page.feesCustom', { custom: customCount, total: chainIds.length });
}

function endpointsSummary(settings) {
    if (!settings) return '-';
    const eps = settings.sdkEndpoints || {};
    const customCount = Object.values(eps).filter((e) => e?.custom).length;
    if (customCount === 0) return t('settings.page.allDefaults');
    return t('settings.page.customChains', { count: customCount });
}

function adsSummary(settings) {
    if (!settings) return '-';
    if (!settings.ads?.enabled) return t('settings.privacy.off');
    const total = Object.values(settings.ads.perChain || {})
        .reduce((s, c) => s + (Number(c?.lifetimeDonatedSats) || 0), 0);
    if (total === 0) return t('settings.page.donatedZero');
    return t('settings.page.donatedOn', { sats: total });
}

function developerSummary(settings) {
    if (!settings) return t('settings.privacy.off');
    return settings.developerMode ? t('settings.page.on') : t('settings.privacy.off');
}

function connectedSitesSummary(siteCount) {
    if (siteCount === null) return '-';
    if (siteCount === 0) return t('send.advanced.none');
    return t('settings.page.siteCount', { count: siteCount });
}
