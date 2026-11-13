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
import { Button, EmptyState, Icon, Input, ListPage, ListRow, PageHeader, PageNoticeHostContext, Screen, SectionHeader, StatusMessage } from '@xchain-wallet/core/ui';
// The standard list card for the grouped landing.
import groupListStyles from './CoSignerAccountList.module.css';
import { useBackHandler } from '../../ui/backStack.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { shellCapabilities } from '../shellCapabilities.js';
import { resolveBindings } from '../keyboard/shortcuts.js';
import { WALLET_VERSION } from '../../buildInfo.js';
import { useDocumentTitleSection } from '../hooks/useDocumentTitle.js';
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
import { WantReachabilityNotice } from '../components/hideReachabilityNotice.js';
import { NetworkEndpointsSection } from '../components/settings/NetworkEndpointsSection.jsx';
import { NetworkSection } from '../components/settings/NetworkSection.jsx';
import { normalizeActiveNetwork } from '../utils/activeNetworkSwitch.js';
import { titleCase } from '../utils/titleCase.js';
import { readBalanceCache } from '../utils/balanceCache.js';
import '../../i18n/locales/en/desktopUpdate.js';
import '../../i18n/locales/en/importWallet.js';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/settings.js';

import { NotificationsSection } from '../components/settings/NotificationsSection.jsx';
import { PrivacySection } from '../components/settings/PrivacySection.jsx';
import { SafetySection } from '../components/settings/SafetySection.jsx';
import { ThisWalletSection } from '../components/settings/ThisWalletSection.jsx';
import {
    CLIPBOARD_AUTO_CLEAR_DEFAULT,
    FORM_DRAFT_TTL_1H,
    FORM_DRAFT_TTL_24H,
    FORM_DRAFT_TTL_7D,
    FORM_DRAFT_TTL_DEFAULT,
    FORM_DRAFT_TTL_OFF,
    NUMBER_FORMAT_DEFAULT,
    SMALL_BALANCE_THRESHOLD_DEFAULT,
    resolveUndoSendSeconds,
} from '../../schemas/settings.js';
// Sync reads for the Security rows' current values.
import { isBiometricRegistered } from '../../flows/biometricUnlock.js';
import { getPanicModeState, getPanicRemainingMs } from '../../flows/panicMode.js';
import { isDuressConfigured } from '../../flows/duressPassphrase.js';
import { handOverAfterActiveWalletRemoved } from '../utils/activeWalletRemoval.js';
import { writeLastView } from '../utils/lastViewMemory.js';
import actionStyles from './ActionsMenu.module.css';
import settingsStyles from './Settings.module.css';
import { getLocale, t } from '../../i18n/index.js';
import cardStyles from '../../ui/Card.module.css';

const row = (title, terms = '', target = title) => ({ title, terms, target });
// Sizes the icon in each settings group row; CSS, not user-facing copy.
const GROUP_ICON_CSS = '[data-settings-group-icon] svg { width: 24px; height: 24px; }';

// Each time Settings opens it takes a fresh list scroll key, so the shell has
// no saved offset for it and the list starts at its first row. Closing a
// section keeps the key, so the list comes back where the user left it.
let settingsVisits = 0;

export const SETTINGS_SEARCH_ROWS = Object.freeze({
    'this-wallet': [
        row('Wallet', 'switch rename name vault'),
        row('Account', 'switch choose active'),
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
        row('Saved network filters', 'list preferences reset'),
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
    backup: [
        row('Export encrypted backup', 'backup file password'),
        row('Back up recovery phrase', 'seed mnemonic words reveal'),
        row('Test backup (dry-run restore)', 'verify seed recovery phrase'),
        row('Publish labels on-chain', 'backup metadata contacts blockchain'),
        row('Check network for backed-up contacts', 'restore labels address book'),
    ],
    fees: [
        row('Fee strategy', 'fee fees network fee rate priority'),
        row('Custom fee rate', 'fee fees network fee sats per byte', 'Fee strategy'),
        row('Allow fee bump (Replace-by-Fee)', 'fee fees rbf speed up transaction'),
    ],
    network: [row('Active network', 'mainnet testnet regtest switch network')],
    'network-endpoints': [
        row('Network registry refresh', 'networks update registry'),
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
        row('Networks', 'dapp permission networks'),
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
        row('Advanced action', 'raw fields action authoring'),
        row('Action queue', 'parallel compose cross chain actions'),
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
        row('Custom networks', 'add network descriptor'),
        row('Custom network descriptor JSON', 'add network paste'),
    ],
    updates: [row('Check for updates', 'new version upgrade latest release')],
    about: [
        row('Version', 'app release'),
        row('Balances updated', 'balance refresh sync time'),
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
 *                        outside Settings.
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
 * @param {(network: 'mainnet'|'testnet'|'regtest') => Promise<void>} [props.onActiveNetworkChange]
 * @param {string} [props.initialSubpageId]   §24 Cluster Y FOLLOWUP 2: open this drilldown panel on mount (e.g. 'connected-sites' from a deep nav row)
 * @param {(sel: { chainId: string, tick: string }) => void} [props.onNavigateToMint]   Developer Mode's regtest faucet "Mint test XCHAIN" button
 * @param {() => void} [props.onNavigateToAdvanced]
 * @param {() => void} [props.onNavigateToActionQueue]
 * @param {() => void} [props.onOpenBackupInTab]
 * @param {() => void} [props.reload]
 */
export function Settings({
    // Opens the address list from the Wallets page.
    onOpenAddresses,
    onBack,
    activeWallet,
    activeAccount,
    onOpenWalletPicker,
    onOpenAccountPicker,
    onActiveNetworkChange,
    initialSubpageId = null,
    onNavigateToMint,
    onNavigateToAdvanced,
    onNavigateToActionQueue,
    onOpenBackupInTab,
    reload = reloadPage,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [query, setQuery] = useState('');
    const [subpageId, setSubpageId] = useState(/** @type {string | null} */ (initialSubpageId || null));
    // The group page a subpage was opened from, so Back returns to it.
    const [parentSubpageId, setParentSubpageId] = useState(/** @type {string | null} */ (null));
    const [searchTarget, setSearchTarget] = useState(/** @type {string | null} */ (null));
    const [listScrollKey] = useState(() => `list-${(settingsVisits += 1)}`);
    const [siteCount, setSiteCount] = useState(/** @type {number | null} */ (null));
    const [siteSearchTerms, setSiteSearchTerms] = useState('');
    const [walletManagementBusy, setWalletManagementBusy] = useState(false);
    const [tokenPickerScreen, setTokenPickerScreen] = useState(null);
    const desktopUpdate = useDesktopUpdateCheck();
    const sectionOpenerRefs = useRef(new Map());
    const pendingFocusRestore = useRef(/** @type {string | null} */ (null));

    const { settings } = useSettings();
    const balancesFetchedAt = readBalanceCache(
        activeWallet?.id,
        activeAccount?.id,
        normalizeActiveNetwork(settings?.activeNetwork),
    )?.fetchedAt ?? null;

    const closeSubpage = useCallback(() => {
        pendingFocusRestore.current = subpageId;
        setSubpageId(parentSubpageId);
        setParentSubpageId(null);
        setSearchTarget(null);
    }, [subpageId, parentSubpageId]);

    // A Settings drilldown is nested UI, so Escape and the system Back action
    // close it before the surrounding route.
    useBackHandler(subpageId ? closeSubpage : undefined, false, 'screen');

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

    const handleWalletRemoved = useCallback(
        (removedWalletId) => handOverAfterActiveWalletRemoved({ messaging, removedWalletId, reload }),
        [messaging, reload],
    );

    const walletLabel = activeWallet?.name || t('shell.settingsButton.noWallet');

    // Same rule as activeNetworkOptions, so the Network row describes the
    // choices its select actually offers.
    const regtestListed = settings?.developerMode === true
        || normalizeActiveNetwork(settings?.activeNetwork) === 'regtest';

    const sections = useMemo(() => /** @type {SectionDef[]} */ ([
        {
            id: 'this-wallet',
            title: t('settings.page.thisWallet'),
            description: t('settings.page.manageItsNameExtendedPublic'),
            keywords: 'wallet name xpub extended public key watch only export switch rename remove delete destroy migrate bip39 upgrade recovery phrase encrypted seed backup',
            kind: 'internal-drill',
            Component: ThisWalletSection,
            props: {
                activeWallet, onOpenWalletPicker, activeAccount, onOpenAccountPicker,
                onWalletRemoved: handleWalletRemoved,
                onBusyChange: setWalletManagementBusy,
            },
            summary: walletLabel,
        },
        {
            id: 'appearance',
            title: t('settings.page.appearance'),
            keywords: 'appearance theme system default motion dark light reduced follow',
            kind: 'panel',
            Component: AppearanceSection,
        },
        {
            id: 'display',
            title: t('settings.page.display'),
            description: t('settings.page.controlBalanceThresholdsNumberFormatting'),
            keywords: 'display balance threshold number format pinned hidden tokens reorder unhide bulk star',
            searchTerms: 'row affordances show pin hide button unpin list preferences saved network filters reset',
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
            id: 'backup',
            title: t('settings.page.backup'),
            description: t('settings.page.exportRecoveryDataVerifyA'),
            keywords: 'backup password wallet password export encrypted file reveal back up seed recovery phrase mnemonic test dry run restore publish labels on chain contacts',
            kind: 'internal-drill',
            Component: BackupSection,
            props: { activeWallet, reload, onExportInTab: onOpenBackupInTab },
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
            // Mainnet and Testnet are always offered; Regtest only with
            // Developer Mode on or while it is the persisted network.
            description: regtestListed
                ? t('settings.page.networkChooseAll')
                : t('settings.page.networkChooseTwo'),
            keywords: regtestListed
                ? 'network active mainnet testnet regtest filter network switch mode dev'
                : 'network active mainnet testnet filter network switch mode',
            kind: 'panel',
            Component: NetworkSection,
            // The section needs the wallet so the switch can derive
            // that wallet's first address on each chain of the new network.
            props: {
                activeWallet,
                onActiveNetworkChange,
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
            props: {
                walletId: activeWallet?.id,
                onTokenPickerScreenChange: setTokenPickerScreen,
            },
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
            keywords: 'developer mode learn variant popover advanced action queue parallel compose raw fields regtest networks faucet mint custom chains endpoints diagnostics logs console localhost dapps auto approve auto sign cache password miner url',
            kind: 'internal-drill',
            Component: DeveloperModeSection,
            props: {
                activeWallet,
                activeAccount,
                onNavigateToMint,
                onNavigateToAdvanced,
                onNavigateToActionQueue,
                reload,
            },
            summary: developerSummary(settings),
        },
        ...(desktopUpdaterBridge() ? [{
            id: 'updates',
            title: t('settings.page.updates'),
            keywords: 'updates update check for updates new version upgrade latest release',
            kind: 'panel',
            Component: UpdateCheckPanel,
            props: { updateCheck: desktopUpdate },
        }] : []),
        {
            id: 'about',
            title: t('routes.addressList.about'),
            description: t('settings.page.viewVersionLicenseBuildVerification'),
            keywords: 'about version balances updated refresh sync time update channel check new versions license notice repro reproducible build verify verification release signatures gpg fingerprint disclosure policy security diagnostics copy preview',
            kind: 'internal-drill',
            Component: AboutSection,
            props: { balancesFetchedAt },
            summary: WALLET_VERSION,
        },
    ]), [walletLabel, onOpenWalletPicker, onOpenAccountPicker, onActiveNetworkChange, activeWallet, activeAccount, settings, balancesFetchedAt, siteCount, siteSearchTerms, onNavigateToMint, onNavigateToAdvanced, onNavigateToActionQueue, handleWalletRemoved, reload, variant, desktopUpdate.state, desktopUpdate.message, getLocale()]);

    // The ten Settings groups, each a page built from one or more sections.
    const settingsGroups = useMemo(() => {
        const byId = new Map(sections.filter((x) => x.visible !== false && x.Component).map((x) => [x.id, x]));
        // Wallet password is the password part of the This wallet section.
        const thisWalletProps = sections.find((x) => x.id === 'this-wallet')?.props || {};
        byId.set('wallet-password', { id: 'wallet-password', title: 'Wallet password', Component: ThisWalletSection, props: { ...thisWalletProps, only: 'password' } });
        const g = (id, title, icon, summary, parts) => ({ id, title, icon, summary, parts: parts.map((pid) => byId.get(pid)).filter(Boolean) });
        return [
            { label: 'Account', items: [
                // Wallets is a page of its own (WalletsSettingsPage) with no
                // sections; wallet mode belongs to each wallet (§20), shown
                // on Wallet Details, not here.
                g('g-wallets', 'Wallets', Icon.WalletIcon, 'My Wallets, My Accounts, My Addresses', []),
                g('g-security', 'Security', Icon.LockIcon, 'Wallet password, auto-lock, biometrics, send checks', ['wallet-password', 'safety']),
                g('g-backup', 'Backup and Recovery', Icon.SaveIcon, 'Encrypted backup, test restore, reminders, contacts', ['backup', 'contacts']),
                g('g-privacy', 'Privacy', Icon.EyeOffIcon, 'Tor, change addresses, clipboard, data', ['privacy']),
            ] },
            { label: 'Preferences', items: [
                g('g-appearance', 'Appearance', Icon.PaletteIcon, 'Theme, language, currency, balances', ['appearance', 'display', 'language-region']),
                g('g-notifications', 'Notifications', Icon.BellIcon, 'Payments, orders, deadlines, quiet hours', ['notifications']),
                g('g-network', 'Network and Fees', Icon.BroadcastIcon, 'Network, endpoints, fee strategy', ['network', 'network-endpoints', 'fees']),
            ] },
            { label: 'More', items: [
                g('g-sites', 'Connected Sites', Icon.LinkIcon, 'dApp permissions, blocked sites', ['connected-sites']),
                g('g-donations', 'Donations', Icon.HandshakeIcon, 'Automatic Donation System', ['ads']),
                g('g-advanced', 'Advanced', Icon.GearIcon, 'Developer mode, shortcuts, logs, about', ['developer', 'keyboard', 'updates', 'about']),
            ] },
        ].map((grp) => ({ ...grp, items: grp.items.filter((it) => it.parts.length || it.id === 'g-wallets') }));
    }, [sections]);
    // Security, Backup and Recovery and Privacy are labelled lists of rows;
    // each row opens a page holding just that setting's controls.
    const rowGroups = useMemo(() => {
        const thisWalletProps = sections.find((x) => x.id === 'this-wallet')?.props || {};
        return settingsRowGroups({
            password: { ...thisWalletProps, only: 'password' },
            backup: { activeWallet, reload, onExportInTab: onOpenBackupInTab },
        });
    }, [sections, activeWallet, reload, onOpenBackupInTab]);
    const rowSections = useMemo(() => Object.entries(rowGroups).flatMap(([, groups]) => groups.flatMap((grp) => grp.rows)).map((r) => ({
        id: r.id,
        title: r.title,
        kind: 'internal-drill',
        Component: r.Component,
        props: r.props,
    })), [rowGroups]);
    const groupSections = useMemo(() => settingsGroups.flatMap((grp) => grp.items).map((it) => (rowGroups[it.id] ? {
        id: it.id,
        title: it.title,
        kind: 'internal-drill',
        Component: SettingsRowGroupsPage,
        props: {
            label: it.title,
            groups: rowGroups[it.id],
            onOpen: (rowId) => { setSearchTarget(null); setParentSubpageId(it.id); setSubpageId(rowId); },
        },
    } : it.id === 'g-wallets' ? {
        id: it.id,
        title: it.title,
        kind: 'internal-drill',
        Component: WalletsSettingsPage,
        props: {
            walletLabel,
            walletId: activeWallet?.id || '',
            accountLabel: activeAccount?.name || '',
            onOpenWalletPicker,
            onOpenAccountPicker,
            accountId: activeAccount?.id || '',
            onOpenAddresses,
        },
    } : {
        id: it.id,
        title: it.title,
        kind: 'internal-drill',
        Component: GroupedSettingsPage,
        props: { parts: it.parts },
    })), [settingsGroups, rowGroups, walletLabel, activeWallet, activeAccount, onOpenWalletPicker, onOpenAccountPicker, onOpenAddresses]);
    // The This wallet section is not listed on its own; its options live on Security, Account Details and Wallet Details.
    // Wallet Details' Remove wallet opens its removal part here, where the
    // active-wallet handover after a removal (handleWalletRemoved) lives.
    // Account Details' Extended public keys opens the export part for the
    // active account the same way.
    const allSections = useMemo(() => {
        const thisWalletProps = sections.find((x) => x.id === 'this-wallet')?.props || {};
        const removeSection = {
            id: 'wallet-remove',
            title: 'Remove wallet',
            kind: 'internal-drill',
            Component: ThisWalletSection,
            props: { ...thisWalletProps, only: 'remove' },
        };
        const xpubSection = {
            id: 'wallet-xpub',
            title: 'Extended public keys',
            kind: 'internal-drill',
            Component: ThisWalletSection,
            props: { ...thisWalletProps, only: 'xpub' },
        };
        return [...sections.filter((x) => x.id !== 'this-wallet'), ...groupSections, ...rowSections, removeSection, xpubSection];
    }, [sections, groupSections, rowSections]);
    // Search results work like the menu search: each matching setting is a
    // row; a group whose own name or summary matches comes first.
    const groupResults = useMemo(() => {
        const q = normalizeSearchText(query);
        if (!q) return [];
        const terms = q.split(' ');
        const matches = (text) => {
            const words = normalizeSearchText(text).split(' ');
            return terms.every((term) => words.some((w) => searchWordMatches(w, term)));
        };
        const groupsHit = [];
        const rowsHit = [];
        const seen = new Set();
        for (const grp of settingsGroups) {
            for (const it of grp.items) {
                if (matches(`${it.title} ${it.summary}`)) groupsHit.push({ ...it, key: it.id, match: { title: it.title, target: null }, sub: grp.label });
                for (const part of it.parts) {
                    for (const item of (SETTINGS_SEARCH_ROWS[part.id] || [])) {
                        if (!searchItemMatches(item, terms)) continue;
                        const key = `${it.id}:${item.title}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        rowsHit.push({ ...it, key, match: item, sub: it.title });
                    }
                }
            }
        }
        return [...groupsHit, ...rowsHit];
    }, [query, settingsGroups]);


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

    const shownSubpage = allSections.find((s) => s.id === subpageId && s.visible !== false);
    useDocumentTitleSection(shownSubpage?.kind === 'internal-drill' && shownSubpage.Component ? titleCase(shownSubpage.title) : null);

    if (subpageId) {
        const section = allSections.find((s) => s.id === subpageId && s.visible !== false);
        if (section && section.kind === 'internal-drill' && section.Component) {
            const SectionComponent = section.Component;
            const subpageHeader = (
                <PageHeader
                    nested
                    onBack={closeSubpage}
                    backDisabled={(section.id === 'this-wallet' || section.id === 'wallet-remove') && walletManagementBusy}
                    backLabel={t('shell.settings.back')}
                    title={titleCase(section.title)}
                    trailing={(section.id === 'backup' || section.id === 'backup-export') && onOpenBackupInTab ? (
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
                <>
                    {tokenPickerScreen}
                    <div
                        hidden={Boolean(tokenPickerScreen)}
                        style={tokenPickerScreen ? undefined : { display: 'contents' }}
                    >
                        <Screen
                            variant={variant}
                            header={subpageHeader}
                            scrollKey={section.id}
                            restoreScroll={false}
                        >
                            <WantReachabilityNotice active={section.id === 'network-endpoints'} />
                            <SettingsPageTemplate view="subpage" sectionId={section.id} flat={FLAT_GROUP_PAGES.has(section.id)}>
                                <SettingsSearchHighlight target={searchTarget}>
                                    <SectionComponent
                                        key={section.id === 'this-wallet' || section.id === 'wallet-remove' ? `${section.id}:${activeWallet?.id || 'none'}` : section.id}
                                        {...(section.props || {})}
                                    />
                                </SettingsSearchHighlight>
                            </SettingsPageTemplate>
                        </Screen>
                    </div>
                </>
            );
        }
        // Fallback for stale subpageId: return to list
        setSubpageId(null);
    }

    // ─── List view ────────────────────────────────────────────────

    const header = <PageHeader onBack={onBack} title={t('home.settings')} />;

    return (
        <>
            {tokenPickerScreen}
            <div
                hidden={Boolean(tokenPickerScreen)}
                style={tokenPickerScreen ? undefined : { display: 'contents' }}
            >
                {/* A route-wide key restored the last visit's offset and reopened
                    Settings part way down (clamped to whatever height had rendered by
                    then, so not even where the user left it). See settingsVisits. */}
                <Screen variant={variant} header={header} scrollKey={listScrollKey}>
                    <SettingsPageTemplate
                view="list"
                flat
                notices={desktopUpdate.message ? (
                    <StatusMessage variant={desktopUpdate.variant}>{desktopUpdate.message}</StatusMessage>
                ) : null}
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
                <div className={settingsStyles.settingsList} style={{ border: 0, background: 'transparent', boxShadow: 'none', padding: 0, borderRadius: 0, overflow: 'visible', display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)' }}>
                {query.trim() && groupResults.length === 0 ? (
                    <EmptyState title={t('settings.page.noMatchingSettings')} body={t('settings.page.noSettingsMatch', { query })} />
                ) : null}
                {/* With no search typed, the grouped landing shows. */}
                <style>{GROUP_ICON_CSS}</style>
                {query.trim() ? null : settingsGroups.map((grp) => (
                    <div key={grp.label} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-1)', border: 0, borderTop: 0, boxShadow: 'none', padding: 0, margin: 0 }}>
                        <div style={{ fontSize: 'var(--xc-text-xs)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--xc-text-muted)', margin: 'var(--xc-space-2) var(--xc-space-1) 0' }}>{grp.label}</div>
                        {/* Safari needs an explicit list role because this class removes list styling. */}
                        <ul className={groupListStyles.list} role="list" aria-label={grp.label} style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', background: 'var(--xc-surface)', overflow: 'hidden' }}>
                            {grp.items.map((it) => {
                                const GroupIcon = it.icon;
                                return (
                                    <li
                                        key={it.id}
                                        // The row's button is the opener focus returns to
                                        // when its page closes (Escape or Back).
                                        ref={(node) => {
                                            const opener = node?.querySelector('button');
                                            if (opener) sectionOpenerRefs.current.set(it.id, opener);
                                            else sectionOpenerRefs.current.delete(it.id);
                                        }}
                                    >
                                        <ListRow
                                            type="button"
                                            onClick={() => { setSearchTarget(null); setSubpageId(it.id); }}
                                            leading={<span className={groupListStyles.rowIcon} aria-hidden="true" data-settings-group-icon="" style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}><GroupIcon /></span>}
                                            title={it.title}
                                            subtitle={it.summary}
                                            chevron
                                        />
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
                {query.trim() && groupResults.length ? (
                    /* Safari needs an explicit list role because this class removes list styling. */
                    <ul className={groupListStyles.list} role="list" aria-label={t('settings.page.searchResults')} style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', background: 'var(--xc-surface)', overflow: 'hidden' }}>
                        {groupResults.map((it) => {
                            const GroupIcon = it.icon;
                            return (
                                <li key={it.key}>
                                    <ListRow
                                        type="button"
                                        onClick={() => { setSearchTarget(it.match.target || null); setSubpageId(it.id); }}
                                        leading={<span className={groupListStyles.rowIcon} aria-hidden="true" data-settings-group-icon="" style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}><GroupIcon /></span>}
                                        title={it.match.title}
                                        subtitle={it.sub}
                                        chevron
                                    />
                                </li>
                            );
                        })}
                    </ul>
                ) : null}
                {true ? null : filtered.map((section) => {
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
                </div>
                    </SettingsPageTemplate>
                </Screen>
            </div>
        </>
    );
}

function SettingsPageTemplate({ view, children, sectionId, notices, flat = false, ...props }) {
    const [noticeHost, setNoticeHost] = useState(null);
    return (
        <ListPage
            className={settingsStyles.page}
            data-settings-layout="responsive"
            data-settings-page-template={view}
            {...props}
            notices={(
                <>
                    {notices}
                    {/* Notices raised by the forms inside the section card land
                        here, above the card, after the page's own notices. */}
                    <div ref={setNoticeHost} style={{ display: 'contents' }} data-page-notice-host="" />
                </>
            )}
        >
            <PageNoticeHostContext.Provider value={noticeHost}>
                <div
                    className={settingsStyles.settingsSurface}
                    data-settings-section={sectionId || undefined}
                    // The grouped landing draws its own cards.
                    style={flat ? { border: 0, background: 'transparent', boxShadow: 'none', padding: 0, borderRadius: 0 } : undefined}
                >
                    {children}
                </div>
            </PageNoticeHostContext.Provider>
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
    // A typed term matches the start of a word, as the menu search does.
    return word.startsWith(term) || `${word}s` === term;
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

/** How each update-check result reads as a page message. */
const UPDATE_CHECK_VARIANT = { checking: 'status', current: 'success', available: 'info', error: 'error' };

/**
 * Check for updates. Runs the same visible check as the app menu item (main's
 * 'check' action) and shows its outcome. Every sentence is a constant; the
 * only feed-derived value shown is a version that parses as plain semver.
 */
function useDesktopUpdateCheck() {
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
        checking: t('desktopUpdate.checking'),
        current: t('desktopUpdate.current'),
        available: version ? t('desktopUpdate.availableVersion', { version }) : t('desktopUpdate.available'),
        error: t('desktopUpdate.checkError'),
    }[state];

    return {
        state,
        message,
        variant: UPDATE_CHECK_VARIANT[state] || 'status',
        check,
    };
}

function UpdateCheckPanel({ updateCheck }) {
    // The result shows beside the button that asked, on the Advanced page
    // where it lives, as well as on the Settings list.
    return (
        <>
            <Button
                variant="ghost"
                size="sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={updateCheck.check}
                disabled={updateCheck.state === 'checking'}
            >
                {t('settings.page.checkForUpdates')}
            </Button>
            {updateCheck.message ? (
                <StatusMessage variant={updateCheck.variant}>{updateCheck.message}</StatusMessage>
            ) : null}
        </>
    );
}

function PanelBlock({ title, description, children }) {
    return (
        <div
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-settings-row-gap)' }}
        >
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

/**
 * One Settings group page; a group built from several sections shows each
 * under its own heading, in order.
 */
function GroupedSettingsPage({ parts }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-4)' }}>
            {parts.map((part) => {
                const PartComponent = part.Component;
                return (
                    <div key={part.id} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)' }}>
                        {parts.length > 1 ? <SectionHeader title={part.title} /> : null}
                        <PartComponent {...(part.props || {})} />
                    </div>
                );
            })}
        </div>
    );
}

/**
 * Settings > Wallets as a list of rows, like the Settings landing.
 * The wallet count comes from one wallet-list read.
 */
function WalletsSettingsPage({ walletLabel, walletId, accountId, onOpenAddresses, accountLabel, onOpenWalletPicker, onOpenAccountPicker }) {
    const { messaging } = useMessaging();
    const [walletCount, setWalletCount] = useState(/** @type {number | null} */ (null));
    useEffect(() => {
        let cancelled = false;
        if (typeof messaging?.listWallets !== 'function') return undefined;
        Promise.resolve(messaging.listWallets()).then((list) => { if (!cancelled) setWalletCount(Array.isArray(list) ? list.length : 0); }).catch(() => {});
        return () => { cancelled = true; };
    }, [messaging]);
    // One account-list read for the active wallet, for the My Accounts count.
    const [accountCount, setAccountCount] = useState(/** @type {number | null} */ (null));
    useEffect(() => {
        let cancelled = false;
        if (!walletId || typeof messaging?.listAccounts !== 'function') return undefined;
        Promise.resolve(messaging.listAccounts(walletId)).then((list) => { if (!cancelled) setAccountCount(Array.isArray(list) ? list.length : 0); }).catch(() => {});
        return () => { cancelled = true; };
    }, [messaging, walletId]);
    // One address read for the active account, for the My Addresses count.
    const [addressCount, setAddressCount] = useState(/** @type {number | null} */ (null));
    useEffect(() => {
        let cancelled = false;
        if (!walletId || typeof messaging?.getAddressesByChain !== 'function') return undefined;
        // One read: addresses grouped by chain; the count is their total.
        Promise.resolve(messaging.getAddressesByChain(walletId, accountId || undefined)).then((byChain) => {
            if (cancelled) return;
            const lists = Array.isArray(byChain) ? [byChain] : Object.values(byChain || {});
            setAddressCount(lists.reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0));
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [messaging, walletId, accountId]);
    const rows = [
        { id: 'wallets', title: 'My Wallets', summary: walletCount === null ? walletLabel : `${walletCount} ${walletCount === 1 ? 'wallet' : 'wallets'} · ${walletLabel} active`, icon: Icon.WalletIcon, onClick: onOpenWalletPicker },
        { id: 'account', title: 'My Accounts', summary: accountCount === null ? (accountLabel || 'None') : `${accountCount} ${accountCount === 1 ? 'account' : 'accounts'}${accountLabel ? ` · ${accountLabel} active` : ''}`, icon: Icon.UserIcon, onClick: onOpenAccountPicker },
        { id: 'addresses', title: 'My Addresses', summary: addressCount === null ? (accountLabel ? `In ${accountLabel}` : '') : `${addressCount} ${addressCount === 1 ? 'address' : 'addresses'}${accountLabel ? ` in ${accountLabel}` : ''}`, icon: Icon.ReceiveIcon, onClick: onOpenAddresses },
        // Wallet mode is not a Settings switch; it belongs to each wallet.
    ].filter((r) => typeof r.onClick === 'function');
    return (
        <>
            <style>{GROUP_ICON_CSS}</style>
            {/* Safari needs an explicit list role because this class removes list styling. */}
            <ul className={groupListStyles.list} role="list" aria-label={t('settings.page.walletsList')} style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', background: 'var(--xc-surface)', overflow: 'hidden' }}>
                {rows.map((r) => {
                    const RowIcon = r.icon;
                    return (
                        <li key={r.id}>
                            <ListRow
                                type="button"
                                onClick={r.onClick}
                                leading={<span className={groupListStyles.rowIcon} aria-hidden="true" data-settings-group-icon="" style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}><RowIcon /></span>}
                                title={r.title}
                                subtitle={r.summary}
                                chevron
                            />
                        </li>
                    );
                })}
            </ul>
        </>
    );
}

// Group pages that are lists draw their own cards, so no outer card.
const FLAT_GROUP_PAGES = new Set(['g-wallets', 'g-security', 'g-backup', 'g-privacy']);

const onOff = (on) => (on ? 'On' : 'Off');
const groupDigits = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// A device-state read that cannot run in this shell shows no value.
const safeRead = (read) => { try { return read(); } catch { return null; } };

function autolockLabel(minutes) {
    if (minutes === 0) return 'Never';
    if (!Number.isFinite(minutes)) return '-';
    if (minutes % 60 === 0) return `After ${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`;
    return `After ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

function formDraftLabel(ms) {
    const value = Number.isFinite(ms) ? Number(ms) : FORM_DRAFT_TTL_DEFAULT;
    if (value === FORM_DRAFT_TTL_OFF) return 'Off';
    if (value === FORM_DRAFT_TTL_1H) return 'Kept 1 hour';
    if (value === FORM_DRAFT_TTL_24H) return 'Kept 24 hours';
    if (value === FORM_DRAFT_TTL_7D) return 'Kept 7 days';
    return 'Custom';
}

/**
 * The labelled row groups of the Security, Backup and Recovery and
 * Privacy pages. Each row names the section component and `only` part its
 * page renders, and a summary read from settings when the list renders.
 */
function settingsRowGroups({ password, backup }) {
    const row = (id, title, icon, Component, props, summary) => ({ id, title, icon, Component, props, summary });
    const safety = (only) => ({ only });
    return {
        'g-security': [
            { label: 'Unlocking', rows: [
                row('security-password', 'Wallet password', Icon.KeyIcon, ThisWalletSection, password, () => 'Change the password that unlocks this wallet'),
                row('security-autolock', 'Auto-lock', Icon.ClockIcon, SafetySection, safety('autolock'), (st) => (st ? autolockLabel(st.autolockMinutes) : '-')),
                row('security-biometric', 'Biometric unlock', Icon.UnlockIcon, SafetySection, safety('biometric'), () => {
                    const on = safeRead(isBiometricRegistered);
                    return on === null ? '-' : onOff(on);
                }),
            ] },
            { label: 'Sending', rows: [
                row('security-test-send', 'New-recipient test send', Icon.SendIcon, SafetySection, safety('testSend'), (st) => {
                    if (!st) return '-';
                    const raw = String(st.grace?.testSendThresholdSats ?? '').replace(/^0+(?=\d)/, '');
                    if (!/^\d+$/.test(raw)) return '-';
                    return raw === '0' ? 'Off' : `Suggested above ${groupDigits(raw)} sats`;
                }),
                row('security-lookalike', 'Lookalike address warnings', Icon.EyeIcon, SafetySection, safety('lookalike'), () => 'Always on'),
                row('security-hold', 'Hold sends before broadcast', Icon.PauseIcon, SafetySection, safety('undoSend'), (st) => {
                    if (!st) return '-';
                    return st.grace?.undoSendEnabled === true ? `On, ${resolveUndoSendSeconds(st)} seconds` : 'Off';
                }),
            ] },
            { label: 'Emergency', rows: [
                row('security-panic', 'Panic mode', Icon.ZapIcon, SafetySection, safety('panic'), () => {
                    const remaining = safeRead(() => getPanicRemainingMs(getPanicModeState()));
                    if (remaining === null) return '-';
                    return remaining > 0 ? 'Active, signing is frozen' : 'Off';
                }),
                row('security-duress', 'Duress passphrase', Icon.LockIcon, SafetySection, safety('duress'), () => {
                    const set = safeRead(isDuressConfigured);
                    return set === null ? '-' : (set ? 'Set' : 'Not set');
                }),
            ] },
        ],
        'g-backup': [
            { label: 'Wallet backup', rows: [
                row('backup-export', 'Encrypted backup file', Icon.SaveIcon, BackupSection, { ...backup, only: 'export' }, () => 'Save the wallet to a password-protected file'),
                row('backup-phrase', 'Recovery phrase', Icon.KeyIcon, BackupSection, { ...backup, only: 'phrase' }, () => 'Show the words with your wallet password'),
                row('backup-test', 'Test backup', Icon.VerifyIcon, BackupSection, { ...backup, only: 'test' }, () => 'Check a recovery phrase against this wallet'),
                row('backup-reminders', 'Backup reminders', Icon.BellIcon, SafetySection, safety('reminders'), () => 'Automatic'),
            ] },
            { label: 'Labels and contacts', rows: [
                row('backup-publish', 'Publish labels on-chain', Icon.UploadIcon, BackupSection, { ...backup, only: 'publish' }, () => 'Encrypted, readable only by this wallet'),
                row('backup-restore', 'Check network for backed-up contacts', Icon.DownloadIcon, BackupSection, { ...backup, only: 'restore' }, () => 'Find labels and contacts saved on-chain'),
                // The address book's file export and import (the Contacts section).
                row('backup-contacts', 'Export or import contacts', Icon.UsersIcon, ContactsSection, {}, () => 'Save or load the address book as a file'),
            ] },
        ],
        'g-privacy': [
            { label: 'Network', rows: [
                row('privacy-tor', 'Tor routing', Icon.BroadcastIcon, PrivacySection, { only: 'tor' }, (st) => {
                    if (!shellCapabilities().socksProxy) return 'Not available here';
                    return st ? onOff(st.privacy?.torRouting === true) : '-';
                }),
                row('privacy-price-data', 'Coin price data', Icon.LineChartIcon, PrivacySection, { only: 'priceData' }, (st) => (st ? onOff(st.privacy?.priceDataEnabled !== false) : '-')),
                row('privacy-metadata', 'Token metadata', Icon.TokenIcon, PrivacySection, { only: 'metadata' }, (st) => (st ? onOff(st.privacy?.metadataFetchEnabled !== false) : '-')),
            ] },
            { label: 'Addresses and labels', rows: [
                row('privacy-change-address', 'Change-address rotation', Icon.AddressIcon, PrivacySection, { only: 'changeAddress' }, (st) => (st ? onOff(st.privacy?.changeAddressRotation === true) : '-')),
                row('privacy-labels', 'Labels survive restore', Icon.BookIcon, PrivacySection, { only: 'labels' }, (st) => (st ? onOff(st.privacy?.labelsSurviveRestore === true) : '-')),
                row('privacy-hardware', 'Hardware cross-check', Icon.UsbIcon, PrivacySection, { only: 'hardware' }, (st) => (st ? (st.privacy?.alwaysRequireHwExplicitConfirm === true ? 'Always required' : 'Off') : '-')),
            ] },
            { label: 'On this device', rows: [
                row('privacy-blur', 'Blur when the window loses focus', Icon.EyeOffIcon, PrivacySection, { only: 'blur' }, (st) => (st ? onOff(st.privacy?.blurOnBlur === true) : '-')),
                row('privacy-clipboard', 'Clipboard auto-clear', Icon.PasteIcon, PrivacySection, { only: 'clipboard' }, (st) => {
                    if (!st) return '-';
                    const stored = st.privacy?.clipboardAutoClearSeconds;
                    const seconds = Number.isInteger(stored) ? stored : CLIPBOARD_AUTO_CLEAR_DEFAULT;
                    return seconds <= 0 ? 'Off' : `After ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
                }),
                row('privacy-form-drafts', 'Form drafts', Icon.DocumentIcon, PrivacySection, { only: 'formDraft' }, (st) => (st ? formDraftLabel(st.privacy?.formDraftTtlMs) : '-')),
                row('privacy-haptics', 'Haptic feedback', Icon.ZapIcon, PrivacySection, { only: 'haptics' }, (st) => (st ? onOff(st.privacy?.hapticsEnabled !== false) : '-')),
            ] },
            { label: 'Defaults', rows: [
                row('privacy-reset', 'Reset privacy settings', Icon.RefreshIcon, PrivacySection, { only: 'reset' }, () => 'Restore every privacy control to its default'),
            ] },
        ],
    };
}

/**
 * A group page as labelled lists of rows, styled like the Settings
 * landing. Summaries are read on each render so a value changed on a row's
 * page shows when Back returns here.
 */
function SettingsRowGroupsPage({ label, groups, onOpen }) {
    const { settings } = useSettings();
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)' }} aria-label={label}>
            <style>{GROUP_ICON_CSS}</style>
            {groups.map((grp) => (
                <div key={grp.label} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-1)', border: 0, borderTop: 0, boxShadow: 'none', padding: 0, margin: 0 }}>
                    <div style={{ fontSize: 'var(--xc-text-xs)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--xc-text-muted)', margin: 'var(--xc-space-2) var(--xc-space-1) 0' }}>{grp.label}</div>
                    {/* Safari needs an explicit list role because this class removes list styling. */}
                    <ul className={groupListStyles.list} role="list" aria-label={grp.label} style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', background: 'var(--xc-surface)', overflow: 'hidden' }}>
                        {grp.rows.map((r) => {
                            const RowIcon = r.icon;
                            return (
                                <li key={r.id}>
                                    <ListRow
                                        type="button"
                                        onClick={() => onOpen(r.id)}
                                        leading={<span className={groupListStyles.rowIcon} aria-hidden="true" data-settings-group-icon="" style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}><RowIcon /></span>}
                                        title={r.title}
                                        subtitle={r.summary(settings)}
                                        chevron
                                    />
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
}
