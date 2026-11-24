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
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { Button, EmptyState, Icon, ListPage, ListRow, Notice, PageHeader, PageNoticeHostContext, Screen, SectionHeader } from '@xchain-wallet/core/ui';
// The standard list card for the grouped landing.
import groupListStyles from './CoSignerAccountList.module.css';
import { useBackHandler } from '../../ui/backStack.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { shellCapabilities } from '../shellCapabilities.js';
import { resolveBindings } from '../keyboard/shortcuts.js';
import { WALLET_VERSION } from '../../buildInfo.js';
import * as branding from '../../branding/branding.js';
import { useDocumentTitleSection } from '../hooks/useDocumentTitle.js';
import { AboutSection } from '../components/settings/AboutSection.jsx';
import { AdsSection } from '../components/settings/AdsSection.jsx';
import { adsSettingsOf, isAdsOn } from '../../flows/ads.js';
import { formatFiatAmount } from '../utils/fiatAmountFormat.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { AppearanceSection, REDUCED_MOTION_OPTIONS } from '../components/settings/AppearanceSection.jsx';
import {
    ClearNetworkFiltersPage,
    CurrencyPage,
    HideSmallBalancesPage,
    LanguagePage,
    NUMBER_FORMAT_PICKER_PAGE_ID,
    NumberFormatPage,
    NumberFormatPickerPage,
    ResetDisplayPage,
    ThemePage,
    currencyRowSummary,
    languageRowSummary,
    numberFormatSummary,
    smallBalancesSummary,
    themeRowSummary,
} from '../components/settings/AppearancePages.jsx';
import { BackupSection } from '../components/settings/BackupSection.jsx';
import { ConnectedSitesSection } from '../components/settings/ConnectedSitesSection.jsx';
import { ContactsExportPage, ContactsSection } from '../components/settings/ContactsSection.jsx';
import { DeveloperLogsPage, DeveloperModeSection } from '../components/settings/DeveloperModeSection.jsx';
import { FAUCET_PAGE_ID, FaucetPage, TEST_NETWORKS_PAGE_ID, TestNetworksPage, testNetworkSectionFor } from '../components/settings/TestNetworksPages.jsx';
import { DisplaySection } from '../components/settings/DisplaySection.jsx';
import { TokenListsSection, ADD_WATCHED_TOKEN_PAGE_ID } from '../components/settings/TokenListsSection.jsx';
import { PriceAlertsSection } from '../components/settings/PriceAlertsSection.jsx';
import { AddWatchedTokenSection } from '../components/settings/AddWatchedTokenSection.jsx';
import { KeyboardSection } from '../components/settings/KeyboardSection.jsx';
import { FeesSection, feesNetworkSectionFor } from '../components/settings/FeesSection.jsx';
import { LanguageRegionSection } from '../components/settings/LanguageRegionSection.jsx';
import { WantReachabilityNotice } from '../components/hideReachabilityNotice.js';
import { NetworkEndpointsSection, endpointsNetworkSectionFor } from '../components/settings/NetworkEndpointsSection.jsx';
import { NetworkSection } from '../components/settings/NetworkSection.jsx';
import { activeNetworkLabel, normalizeActiveNetwork } from '../utils/activeNetworkSwitch.js';
import { titleCase } from '../utils/titleCase.js';
import { readBalanceCache } from '../utils/balanceCache.js';
import '../../i18n/locales/en/importWallet.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/settings.js';
import '../../i18n/locales/en/watch.js';
import '../../i18n/locales/en/pwaInstall.js';

import { NotificationsSection, soundPickerSectionFor } from '../components/settings/NotificationsSection.jsx';
import { WatchSection } from '../components/settings/WatchSection.jsx';
import * as WatchAlertsRowsModule from '../components/settings/WatchAlertsRows.jsx';
import * as WatchStatusRowsModule from '../components/settings/WatchStatusRows.jsx';
import { PrivacySection } from '../components/settings/PrivacySection.jsx';
import { ResetPrivacyPage } from '../components/settings/ResetPrivacyPage.jsx';
import { SettingsInlineRow, SettingsLoadError } from '../components/settings/SettingsInlineRow.jsx';
import {
    BiometricInlineRow,
    ContactsImportInlineRow,
    NetworkEnvironmentPage,
    NotificationEventInlineRow,
    NotificationsPermissionInlineRow,
    notificationPermissionAvailable,
} from './SettingsInlineRows.jsx';
import {
    BIOMETRIC_ENABLE_PAGE_ID,
    BiometricEnablePage,
    PanicModePage,
    TestSendThresholdInlineRow,
    panicRowSummary,
} from '../components/settings/SecurityPages.jsx';
import { NOTIFICATION_FLAGS } from '../components/settings/NotificationsSection.jsx';
import { autoSignOptions } from '../components/settings/DeveloperModeSection.jsx';
import { AUTO_SIGN_LOCALHOST_OPTIONS } from '../../schemas/settings.js';
import { AUTOLOCK_OPTIONS, autolockOptionLabel } from '../components/settings/SafetySection.jsx';
import { isNativeShell } from '../nativeShell.js';
import { useWatchAvailable } from '../hooks/useWatchAvailable.js';
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
    resolveSmallBalanceFiat,
    resolveUndoSendSeconds,
} from '../../schemas/settings.js';
// Sync read for the Duress passphrase row's current value.
import { isDuressConfigured } from '../../flows/duressPassphrase.js';
import { isHardwareWallet } from '../../flows/hardwareWallet.js';
import { handOverAfterActiveWalletRemoved } from '../utils/activeWalletRemoval.js';
import { writeLastView } from '../utils/lastViewMemory.js';
import actionStyles from './ActionsMenu.module.css';
import settingsStyles from './Settings.module.css';
import { getLocale, t } from '../../i18n/index.js';
import cardStyles from '../../ui/Card.module.css';

const row = (title, terms = '', target = title) => ({ title, terms, target });
// Sizes the icon in each settings group row; CSS, not user-facing copy.
const GROUP_ICON_CSS = '[data-settings-group-icon] svg { width: 24px; height: 24px; }';

const WatchAlertsRows = WatchAlertsRowsModule.WatchAlertsRows;
const WatchStatusRows = WatchStatusRowsModule.WatchStatusRows;

function WatchSettingsPage() {
    return (
        <>
            <WatchSection />
            {WatchAlertsRows ? <WatchAlertsRows /> : null}
            {WatchStatusRows ? <WatchStatusRows /> : null}
        </>
    );
}

// Each time Settings opens it takes a fresh list scroll key, so the shell has
// no saved offset for it and the list starts at its first row. Closing a
// section keeps the key, so the list comes back where the user left it.
let settingsVisits = 0;

export const SETTINGS_SEARCH_ROWS = Object.freeze({
    'this-wallet': [
        row('Wallet', 'switch rename name vault'),
        row('Account', 'switch choose active'),
        row('Upgrade recovery phrase', 'migrate legacy seed mnemonic'),
        row('Extended public keys', 'xpub export public keys view balances'),
        row('Change wallet password', 'password security'),
        row('Remove wallet', 'delete destroy'),
    ],
    // The Security page's Wallet password row.
    'wallet-password': [row('Change wallet password', 'password unlock security')],
    appearance: [row('Theme', 'dark light system'), row('Reduce motion', 'reduced animation accessibility')],
    display: [
        row('Hide small balances', 'dust threshold'),
        row('Small-balance threshold', 'dust balance minimum'),
        row('Balance number format', 'decimal digits grouping'),
        row('Show pin button on rows', 'star favorite affordance'),
        row('Show hide button on rows', 'conceal affordance'),
        row('Watched tokens', 'watch token ticker'),
        row('Pinned tokens', 'pin star favorite reorder'),
        row('Hidden tokens', 'hide unhide concealed'),
        row('Clear remembered network filters', 'saved network filters list preferences reset'),
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
        row('New-recipient test send', 'test send warning threshold new address amount currency'),
        row('Lookalike address warnings', 'similar address scam'),
        row('Hold signed sends before broadcast', 'undo cancel delay transaction'),
        row('Hold duration in seconds (0 disables)', 'undo send delay timeout'),
        row('Biometric unlock', 'fingerprint face id touch id'),
        row('Panic mode', 'freeze signing emergency'),
        row('Duress passphrase', 'decoy emergency password'),
    ],
    backup: [
        row('Export encrypted backup', 'backup file password'),
        row('Back up recovery phrase', 'seed mnemonic words reveal'),
        row('Test backup (dry-run restore)', 'verify seed recovery phrase'),
        row('Publish labels on-chain', 'backup metadata contacts blockchain'),
        row('Restore contacts', 'check network chain backed up labels address book'),
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
        row('Requests per site', 'sign throttle burst maximum requests'),
        row('Window', 'sign throttle duration seconds rate limit'),
        row('Blocked sites', 'dapp website origin denylist'),
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
        row('Automatic Donations', 'ads donations automatic donation system enable disable none off'),
        row('Per transaction', 'donation amount each transaction none off custom'),
        row('Send at', 'donation queue total threshold custom'),
        row('Donate to', 'donation recipient protocol community explorer'),
        row('Queued', 'queued donation total'),
        row('Donated so far', 'donation total history donated'),
    ],
    developer: [
        row('Advanced action', 'raw fields action authoring'),
        row('Action queue', 'parallel compose cross chain actions'),
        row('Developer Mode', 'development advanced regtest'),
        row('Learn Mode', 'education explain'),
        row('Show variant popover', 'layout preview'),
        row('Auto-approve localhost dApps', 'local dapp connect permission'),
        row('Localhost auto-sign', 'cache password local dapp signing timeout'),
        row('Logs and diagnostics console', 'debug log console'),
        row('Test networks', 'regtest local custom network development activate add'),
        row('Regtest faucet', 'mint test coins miner history'),
        row('Miner URL', 'faucet endpoint'),
        row('Amount', 'faucet mint test coins'),
        row('Add Custom Network', 'custom network fork descriptor endpoints'),
        row('Descriptor JSON', 'add network paste custom'),
    ],
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

// A search target of this form names a row on a row-list group page by id.
const ROW_TARGET = 'row:';

// Pages a deep link, a restored desktop session or a palette entry may still
// name, and the page that took each one's place. A one-field page that became
// an inline row also lands on its group page, scrolled to the row; those come
// from the row lists (every row with a `control`).
const RETIRED_PAGES = Object.freeze({
    privacy: { page: 'g-privacy' },
    'g-sites': { page: 'connected-sites' },
    'g-donations': { page: 'ads' },
    // The whole-section pages whose settings now sit on group rows.
    safety: { page: 'g-security' },
    appearance: { page: 'g-appearance' },
    display: { page: 'g-appearance' },
    'language-region': { page: 'g-appearance' },
    contacts: { page: 'g-backup', row: 'backup-contacts-export' },
    // The palette's Developer entry: the switch is on Advanced, the rest here.
    developer: { page: 'advanced-developer-options' },
    // Send, Receive and History open the one-field Network page to switch.
    network: { page: 'network-active' },
    // Rows that were renamed or merged.
    'backup-contacts': { page: 'g-backup', row: 'backup-contacts-export' },
    'display-rows': { page: 'g-appearance', row: 'display-pin' },
    'display-watched': { page: 'display-tokens' },
    // Regtest networks and Custom networks became one Test Networks page
    // (operator picks 2026-11-14).
    'developer-regtest': { page: TEST_NETWORKS_PAGE_ID },
    'developer-custom-chains': { page: TEST_NETWORKS_PAGE_ID },
});

/**
 * The row whose page holds each cataloged setting, by catalog section: one
 * row id for a whole section, or a row id per setting title ('*' for the
 * rest). A setting with no row stays on its group page.
 */
export const SEARCH_ROW_PAGES = Object.freeze({
    'wallet-password': 'security-password',
    appearance: { Theme: 'appearance-theme', 'Reduce motion': 'appearance-motion' },
    'language-region': { Language: 'appearance-language', 'Fiat currency': 'appearance-currency' },
    display: {
        'Hide small balances': 'display-balances',
        'Small-balance threshold': 'display-balances',
        'Balance number format': 'display-number-format',
        'Show pin button on rows': 'display-pin',
        'Show hide button on rows': 'display-hide',
        'Watched tokens': 'display-tokens',
        'Pinned tokens': 'display-tokens',
        'Hidden tokens': 'display-tokens',
        'Clear remembered network filters': 'display-lists',
        'Reset display settings': 'display-reset',
    },
    keyboard: 'keyboard',
    privacy: {
        'Tor routing': 'privacy-tor',
        'Change-address rotation': 'privacy-change-address',
        'Blur sensitive data on blur': 'privacy-blur',
        'Labels survive restore': 'privacy-labels',
        'Haptic feedback': 'privacy-haptics',
        'Native coin price data': 'privacy-price-data',
        'Fetch token metadata': 'privacy-metadata',
        'Always require hardware cross-check confirm': 'privacy-hardware',
        'Clipboard auto-clear': 'privacy-clipboard',
        'Form draft retention': 'privacy-form-drafts',
    },
    safety: {
        'Auto-lock timeout': 'security-autolock',
        'New-recipient test send': 'security-test-send',
        'Lookalike address warnings': 'security-lookalike',
        'Hold signed sends before broadcast': 'security-hold',
        'Hold duration in seconds (0 disables)': 'security-hold',
        'Biometric unlock': 'security-biometric',
        'Panic mode': 'security-panic',
        'Duress passphrase': 'security-duress',
    },
    backup: {
        'Export encrypted backup': 'backup-export',
        'Back up recovery phrase': 'backup-phrase',
        'Test backup (dry-run restore)': 'backup-test',
        'Publish labels on-chain': 'backup-publish',
        'Restore contacts': 'backup-restore',
    },
    contacts: { Import: 'backup-contacts-import', '*': 'backup-contacts-export' },
    // Connected sites is a row on Privacy and Sites, Donations a row on
    // Network and Fees; each row opens the section's own page.
    'connected-sites': 'connected-sites',
    ads: 'ads',
    fees: 'fees',
    network: 'network-active',
    'network-endpoints': 'network-endpoints',
    developer: {
        'Advanced action': 'advanced-action',
        'Action queue': 'advanced-queue',
        'Developer Mode': 'advanced-developer',
        'Learn Mode': 'appearance-learn',
        '*': 'advanced-developer-options',
    },
    notifications: {
        'Desktop notifications': 'notifications-permission',
        'Transaction confirmations': 'notifications-txConfirmations',
        'Incoming receipts': 'notifications-incomingReceipts',
        'Incoming pending payments': 'notifications-incomingPending',
        'Incoming messages': 'notifications-messages',
        'Governance polls': 'notifications-governancePolls',
        Deadlines: 'notifications-deadlines',
        'Dispenser running low': 'notifications-dispenserEscrow',
        'Dispenser fills': 'notifications-dispenserFills',
        'Order fills': 'notifications-orderFills',
        'Price alerts': 'notifications-price-alerts',
        'Quiet hours': 'notifications-quiet',
        'Notification sounds': 'notifications-sounds',
    },
    // About is the first Settings section (g-about), not a row on a group
    // page, so its hits open that page directly with no row to highlight.
});

/** The row id whose page holds a cataloged setting, or null. */
function searchRowPage(sectionId, title) {
    const entry = SEARCH_ROW_PAGES[sectionId];
    if (!entry) return null;
    if (typeof entry === 'string') return entry;
    return entry[title] || entry['*'] || null;
}

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
 * @param {(token: { chainId: string, tick: string, kind?: string }) => void} [props.onOpenToken]   opens a token's own page from the Tokens list
 * @param {() => void} [props.onNavigateToAdvanced]
 * @param {() => void} [props.onNavigateToActionQueue]
 * @param {() => void} [props.onOpenBackupInTab]
 * @param {() => void} [props.onPairAnotherPhone]   Advanced's "Use another phone as a signer" row: opens the two-phone pairing page
 * @param {{ standalone?: boolean, install?: () => void | Promise<void>, iosBrowser?: 'safari'|'chrome'|null }} [props.pwaInstall]
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
    onOpenToken,
    onNavigateToAdvanced,
    onNavigateToActionQueue,
    onOpenBackupInTab,
    onPairAnotherPhone,
    pwaInstall,
    reload = reloadPage,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [query, setQuery] = useState('');
    const [subpageId, setSubpageId] = useState(/** @type {string | null} */ (initialSubpageId || null));
    // The pages a subpage was opened from, nearest last, so each Back returns
    // one level (License > About > Advanced).
    const [parentStack, setParentStack] = useState(/** @type {string[]} */ ([]));
    const subpageIdRef = useRef(subpageId);
    subpageIdRef.current = subpageId;
    const [searchTarget, setSearchTarget] = useState(/** @type {string | null} */ (null));
    const [listScrollKey] = useState(() => `list-${(settingsVisits += 1)}`);
    const [siteCount, setSiteCount] = useState(/** @type {number | null} */ (null));
    const [blockedCount, setBlockedCount] = useState(/** @type {number | null} */ (null));
    const [siteSearchTerms, setSiteSearchTerms] = useState('');
    const [walletManagementBusy, setWalletManagementBusy] = useState(false);
    const [tokenPickerScreen, setTokenPickerScreen] = useState(null);
    const sectionOpenerRefs = useRef(new Map());
    const pendingFocusRestore = useRef(/** @type {string | null} */ (null));

    const { settings } = useSettings();
    const watchAvailable = useWatchAvailable();
    const balancesFetchedAt = readBalanceCache(
        activeWallet?.id,
        activeAccount?.id,
        normalizeActiveNetwork(settings?.activeNetwork),
    )?.fetchedAt ?? null;

    const closeSubpage = useCallback(() => {
        pendingFocusRestore.current = subpageId;
        setSubpageId(parentStack.length ? parentStack[parentStack.length - 1] : null);
        setParentStack(parentStack.slice(0, -1));
        setSearchTarget(null);
    }, [subpageId, parentStack]);

    // Opens a page from the one on screen. Back returns to the page that opened it.
    const openChildPage = useCallback((childId) => {
        const from = subpageIdRef.current;
        setParentStack((stack) => (from ? [...stack, from] : stack));
        setSearchTarget(null);
        setSubpageId(childId);
    }, []);
    const openLogsPage = useCallback(() => openChildPage('developer-logs'), [openChildPage]);
    // Back to an earlier page in one step (Add Custom Network > Add Network >
    // Test Networks after an add), dropping the pages between; an id not on
    // the way back closes one level.
    const parentStackRef = useRef(parentStack);
    parentStackRef.current = parentStack;
    const returnToPage = useCallback((pageId) => {
        const stack = parentStackRef.current;
        const at = stack.lastIndexOf(pageId);
        if (at === -1) {
            const from = subpageIdRef.current;
            pendingFocusRestore.current = from;
            setSubpageId(stack.length ? stack[stack.length - 1] : null);
            setParentStack(stack.slice(0, -1));
            setSearchTarget(null);
            return;
        }
        setParentStack(stack.slice(0, at));
        setSearchTarget(null);
        setSubpageId(pageId);
    }, []);

    // A Settings drilldown is nested UI, so Escape and the system Back action
    // close it before the surrounding route.
    useBackHandler(subpageId ? closeSubpage : undefined, false, 'screen');

    // A closed page hands focus back to the row that opened it: the landing's
    // group row, or the row on the group page Back returned to.
    useEffect(() => {
        if (!pendingFocusRestore.current) return;
        const openerId = pendingFocusRestore.current;
        pendingFocusRestore.current = null;
        const opener = subpageId
            ? [...document.querySelectorAll('main [data-settings-row-id]')]
                .find((node) => node.getAttribute('data-settings-row-id') === openerId)
                ?.querySelector('button')
            : sectionOpenerRefs.current.get(openerId);
        // The Screen restores the list offset; focusing must not scroll it.
        opener?.focus({ preventScroll: true });
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

    // One blocklist read for the Connected sites row's "none blocked" part;
    // a shell without a blocklist leaves that part out.
    useEffect(() => {
        let alive = true;
        if (typeof messaging?.listBlockedOrigins !== 'function') return undefined;
        Promise.resolve(messaging.listBlockedOrigins())
            .then((list) => { if (alive) setBlockedCount(Array.isArray(list) ? list.length : 0); })
            .catch(() => {});
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
            keywords: 'wallet name xpub extended public key export switch rename remove delete destroy migrate bip39 upgrade recovery phrase encrypted seed backup',
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
            // A network row opens that network's own page; Back returns here.
            props: { onOpen: openChildPage },
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
            props: { onOpen: openChildPage },
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
                // A sound field opens its Choose Sound page.
                onOpenPage: openChildPage,
            },
        },
        {
            id: 'watch',
            title: t('watch.title'),
            keywords: 'watch wearable alerts status sync',
            kind: 'internal-drill',
            Component: WatchSettingsPage,
            visible: watchAvailable,
        },
        {
            id: 'connected-sites',
            title: t('settings.connectedSites.connectedSites'),
            description: t('settings.page.reviewDappConnectionsAndControl'),
            keywords: 'connected sites website dapp connections permissions chains accounts sign messages actions origin disconnect block unblock blocked mutations throttle burst window',
            searchTerms: siteSearchTerms,
            kind: 'internal-drill',
            Component: ConnectedSitesSection,
            // The page draws its own header (filter, plus, drill-in titles).
            ownsScreen: true,
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
            title: t('settings.page.automaticDonations'),
            description: t('settings.page.turnAutomaticDonationsOnOr'),
            keywords: 'donation donations ads automatic off none per transaction amount send at queued recipient protocol community explorer donated totals',
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
                onOpenLogs: openLogsPage,
            },
            summary: developerSummary(settings),
        },
        {
            id: 'about',
            title: t('settings.about.pageTitle'),
            description: t('settings.page.viewVersionLicenseBuildVerification'),
            keywords: 'about version balances updated refresh sync time update channel check new versions license notice repro reproducible build verify verification release signatures gpg fingerprint disclosure policy security diagnostics copy preview',
            kind: 'internal-drill',
            Component: AboutSection,
            props: { balancesFetchedAt },
            summary: WALLET_VERSION,
        },
    ]), [openChildPage, openLogsPage, walletLabel, onOpenWalletPicker, onOpenAccountPicker, onActiveNetworkChange, activeWallet, activeAccount, settings, balancesFetchedAt, siteCount, siteSearchTerms, onNavigateToMint, onNavigateToAdvanced, onNavigateToActionQueue, handleWalletRemoved, reload, variant, watchAvailable, getLocale()]);

    // The Settings groups under two headings (2026-11-13), each a page
    // built from one or more sections: Connected Sites joined Privacy, and
    // Donations joined Network and Fees.
    const settingsGroups = useMemo(() => {
        const byId = new Map(sections.filter((x) => x.visible !== false && x.Component).map((x) => [x.id, x]));
        // Wallet password is the password part of the This wallet section.
        const thisWalletProps = sections.find((x) => x.id === 'this-wallet')?.props || {};
        byId.set('wallet-password', { id: 'wallet-password', title: 'Wallet password', Component: ThisWalletSection, props: { ...thisWalletProps, only: 'password' } });
        const g = (id, title, icon, summary, parts) => ({ id, title, icon, summary, parts: parts.map((pid) => byId.get(pid)).filter(Boolean) });
        return [
            // About leads the page (operator ruling 2026-11-14): one row, the
            // product logo and the version, opening the About page.
            { label: 'About', items: [
                g('g-about', t('settings.about.pageTitle'), XChainLogoIcon, WALLET_VERSION, ['about']),
            ] },
            { label: 'Account', items: [
                // Wallets is a page of its own (WalletsSettingsPage) with no
                // sections; wallet mode belongs to each wallet (§20), shown
                // on Wallet Details, not here.
                g('g-wallets', 'Wallets', Icon.WalletIcon, 'My Wallets, My Accounts, My Addresses', []),
                g('g-security', 'Security', Icon.LockIcon, 'Wallet password, auto-lock, biometrics, send checks', ['wallet-password', 'safety']),
                g('g-backup', 'Backup and Recovery', Icon.SaveIcon, 'Encrypted backup, test restore, reminders, contacts', ['backup', 'contacts']),
                g('g-privacy', 'Privacy and Sites', Icon.EyeOffIcon, 'Tor, connected sites, clipboard, data', ['privacy', 'connected-sites']),
            ] },
            { label: 'Preferences', items: [
                g('g-appearance', 'Appearance', Icon.PaletteIcon, 'Theme, language, currency, balances', ['appearance', 'display', 'language-region']),
                g('g-notifications', 'Notifications', Icon.BellIcon, 'Events, sounds, quiet hours, price alerts', ['notifications']),
                g('g-watch', t('watch.title'), Icon.ClockIcon, 'Settings, alerts, and connection status', ['watch']),
                g('g-network', 'Network and Fees', Icon.BroadcastIcon, 'Network, fee strategy, donations', ['network', 'network-endpoints', 'fees', 'ads']),
                g('g-advanced', 'Advanced', Icon.GearIcon, 'Developer mode and tools', ['developer', 'keyboard']),
            ] },
        ].map((grp) => ({ ...grp, items: grp.items.filter((it) => it.parts.length || it.id === 'g-wallets') }));
    }, [sections]);
    // Every group page with more than one setting is a labelled list of rows
    // (G08); each row opens a page holding just that setting's controls.
    const rowGroups = useMemo(() => {
        const thisWalletProps = sections.find((x) => x.id === 'this-wallet')?.props || {};
        const visibleSections = new Map(sections.filter((x) => x.visible !== false && x.Component).map((x) => [x.id, x]));
        return settingsRowGroups({
            // Lands straight on the change-password form (no Change button first).
            password: { ...thisWalletProps, only: 'password', direct: true },
            backup: { activeWallet, reload, onExportInTab: onOpenBackupInTab },
            sections: visibleSections,
            onNavigateToAdvanced,
            onNavigateToActionQueue,
            onPairAnotherPhone,
            sitesSummary: sitesRowSummary(siteCount, blockedCount),
            shell,
            holdAvailable: typeof messaging?.sendHoldCancel === 'function',
            onOpen: openChildPage,
            onClosePage: closeSubpage,
            onReturnTo: returnToPage,
            onOpenToken,
            pwaInstall,
            // Hide Small Balances previews this wallet and account's balances.
            balancesScope: { walletId: activeWallet?.id || null, accountId: activeAccount?.id || null },
        });
    }, [sections, activeWallet, activeAccount, reload, onOpenBackupInTab, onNavigateToAdvanced, onNavigateToActionQueue, onPairAnotherPhone, siteCount, blockedCount, shell, messaging, openChildPage, closeSubpage, returnToPage, onOpenToken, pwaInstall]);
    // Every row anywhere on a group page, including the rows of a page a row
    // opens (Developer options).
    const allRows = useMemo(() => {
        const out = [];
        const walk = (groups) => {
            for (const r of groups.flatMap((grp) => grp.rows)) {
                out.push(r);
                if (Array.isArray(r.props?.groups)) walk(r.props.groups);
            }
        };
        for (const groups of Object.values(rowGroups)) walk(groups);
        return out;
    }, [rowGroups]);
    // A row that reuses a whole section keeps that section's id, so the
    // section entry already opens it; only the rows with their own page join.
    const rowSections = useMemo(() => {
        const sectionIds = new Set(sections.map((x) => x.id));
        return allRows
            .filter((r) => r.Component && !sectionIds.has(r.id))
            .map((r) => ({
                id: r.id,
                title: r.title,
                kind: 'internal-drill',
                Component: r.Component,
                props: r.props,
                ownsScreen: r.ownsScreen,
            }));
    }, [allRows, sections]);
    const groupSections = useMemo(() => settingsGroups.flatMap((grp) => grp.items).map((it) => (rowGroups[it.id] ? {
        id: it.id,
        title: it.title,
        kind: 'internal-drill',
        Component: SettingsRowGroupsPage,
        props: {
            label: it.title,
            groups: rowGroups[it.id],
            onOpen: openChildPage,
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
            onOpenAddresses,
        },
    } : {
        id: it.id,
        title: it.title,
        kind: 'internal-drill',
        Component: GroupedSettingsPage,
        props: { parts: it.parts },
    })), [settingsGroups, rowGroups, openChildPage, walletLabel, activeWallet, activeAccount, onOpenWalletPicker, onOpenAccountPicker, onOpenAddresses]);
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
        const logsSection = {
            id: 'developer-logs',
            title: t('settings.developer.logsAndDiagnosticsConsole'),
            kind: 'internal-drill',
            Component: DeveloperLogsPage,
            // Its title bar carries the console's filter (G04).
            ownsScreen: true,
        };
        // Opened by the plus on the Tokens page; Back returns there.
        const addWatchedTokenSection = {
            id: ADD_WATCHED_TOKEN_PAGE_ID,
            title: t('settings.display.addWatchedToken'),
            kind: 'internal-drill',
            Component: AddWatchedTokenSection,
        };
        // Opened by turning the Biometric unlock switch on (operator ruling
        // 2026-11-14); it returns to Security on success, failure or Back.
        const biometricEnableSection = {
            id: BIOMETRIC_ENABLE_PAGE_ID,
            title: t('settings.safety.enableBiometric'),
            kind: 'internal-drill',
            Component: BiometricEnablePage,
            props: { onDone: () => returnToPage('g-security') },
        };
        // Opened by Number Format's Display format field; a pick returns there.
        const numberFormatPickerSection = {
            id: NUMBER_FORMAT_PICKER_PAGE_ID,
            title: t('settings.appearancePages.formatTitle'),
            kind: 'internal-drill',
            Component: NumberFormatPickerPage,
            props: { onDone: () => returnToPage('display-number-format') },
        };
        return [...sections.filter((x) => x.id !== 'this-wallet'), ...groupSections, ...rowSections, removeSection, xpubSection, logsSection, addWatchedTokenSection, biometricEnableSection, numberFormatPickerSection];
    }, [sections, groupSections, rowSections, returnToPage]);
    // The Test Networks pages opened from inside Test Networks (Add Network,
    // Add Custom Network, a network's page, its edit form, the faucet for one
    // network) resolve from their id, which carries the network id.
    const testNetworkPageProps = useMemo(() => ({
        ...(sections.find((x) => x.id === 'developer')?.props || {}),
        onOpen: openChildPage,
        onClosePage: closeSubpage,
        onReturnTo: returnToPage,
    }), [sections, openChildPage, closeSubpage, returnToPage]);
    const findSection = (id) => allSections.find((s) => s.id === id && s.visible !== false)
        || feesNetworkSectionFor(id)
        || soundPickerSectionFor(id, {
            onOpen: openChildPage,
            onReturnTo: returnToPage,
            onPickerScreenChange: setTokenPickerScreen,
            variant,
        })
        || endpointsNetworkSectionFor(id)
        || testNetworkSectionFor(id, testNetworkPageProps);
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
        // A group page that is a list of rows (G08) holds each setting on a
        // row's own page, so a hit names the group that lists that row and
        // highlights the row; the row is found by id, not by its text.
        const itemsById = new Map(settingsGroups.flatMap((grp) => grp.items).map((it) => [it.id, it]));
        const rowHome = new Map();
        for (const [groupId, groups] of Object.entries(rowGroups)) {
            for (const r of groups.flatMap((g) => g.rows)) rowHome.set(r.id, { groupId, row: r });
        }
        const rowsTargeted = new Set();
        const pushHit = (it, item) => {
            const rowId = searchRowPage(item.partId, item.title);
            const home = rowId ? rowHome.get(rowId) : null;
            const owner = home ? itemsById.get(home.groupId) : null;
            const target = owner || it;
            const key = `${target.id}:${item.title}`;
            if (seen.has(key)) return;
            seen.add(key);
            if (owner) rowsTargeted.add(rowId);
            rowsHit.push({ ...target, key, match: { title: item.title, target: owner ? `${ROW_TARGET}${rowId}` : item.target }, sub: target.title });
        };
        for (const grp of settingsGroups) {
            for (const it of grp.items) {
                if (matches(`${it.title} ${it.summary}`)) groupsHit.push({ ...it, key: it.id, match: { title: it.title, target: null }, sub: grp.label });
                for (const part of it.parts) {
                    for (const item of (SETTINGS_SEARCH_ROWS[part.id] || [])) {
                        if (searchItemMatches(item, terms)) pushHit(it, { ...item, partId: part.id });
                    }
                }
            }
        }
        // Every row is findable by its own title too, where no cataloged
        // setting already leads to it.
        for (const [rowId, { groupId, row: r }] of rowHome) {
            const owner = itemsById.get(groupId);
            if (!owner || rowsTargeted.has(rowId) || !searchItemMatches({ title: r.title, terms: '' }, terms)) continue;
            const key = `${groupId}:${r.title}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rowsHit.push({ ...owner, key, match: { title: r.title, target: `${ROW_TARGET}${rowId}` }, sub: owner.title });
        }
        return [...groupsHit, ...rowsHit];
    }, [query, settingsGroups, rowGroups]);


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

    // A retired page id opens the page that replaced it; an inline row's old
    // page opens its group page with the row scrolled into view and marked.
    const retired = subpageId ? retiredPageTarget(subpageId, rowGroups) : null;
    if (retired) {
        setSubpageId(retired.page);
        if (retired.row) setSearchTarget(`${ROW_TARGET}${retired.row}`);
    }

    const shownSubpage = findSection(subpageId);
    useDocumentTitleSection(shownSubpage?.kind === 'internal-drill' && shownSubpage.Component ? titleCase(shownSubpage.title) : null);

    if (subpageId) {
        const section = findSection(subpageId);
        // A page whose header carries its own list filter, plus and drill-in
        // titles (G95) draws its own screen; Settings hands it Back.
        if (section && section.kind === 'internal-drill' && section.ownsScreen && section.Component) {
            const SectionComponent = section.Component;
            return (
                <SectionComponent
                    key={section.id}
                    nested
                    onBack={closeSubpage}
                    backLabel={t('shell.settings.back')}
                    variant={variant}
                    searchTarget={searchTarget}
                    {...(section.props || {})}
                />
            );
        }
        if (section && section.kind === 'internal-drill' && section.Component) {
            const SectionComponent = section.Component;
            const subpageHeader = (
                <PageHeader
                    nested
                    onBack={closeSubpage}
                    backDisabled={(section.id === 'this-wallet' || section.id === 'wallet-remove') && walletManagementBusy}
                    backLabel={t('shell.settings.back')}
                    title={titleCase(section.title)}
                    trailing={section.trailing || ((section.id === 'backup' || section.id === 'backup-export') && onOpenBackupInTab ? (
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={<Icon.ExternalLinkIcon />}
                            onClick={onOpenBackupInTab}
                            aria-label={t('importWallet.openInTab')}
                            title={t('importWallet.openInTab')}
                        />
                    ) : null)}
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
                            <SettingsPageTemplate
                                view="subpage"
                                sectionId={section.id}
                                flat={FLAT_GROUP_PAGES.has(section.id) || section.flat === true}
                                formFrame={FORM_FRAME_PAGES.has(section.id) || section.formFrame === true}
                            >
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
        // Fallback for stale subpageId: return to list (a retired id is
        // already on its way to the page that replaced it).
        if (!retired) setSubpageId(null);
    }

    // ─── List view ────────────────────────────────────────────────

    // The standard filter on the title line (G04, G95): its panel holds the
    // settings search, and the page body starts with the list.
    const header = (
        <PageHeader
            onBack={onBack}
            title={t('home.settings')}
            trailing={(
                <ListFilterMenu
                    query={query}
                    onQueryChange={setQuery}
                    label={t('settings.page.filterSettings')}
                    searchPlaceholder={t('settings.page.searchSettings')}
                    searchLabel={t('settings.page.searchSettings2')}
                />
            )}
        />
    );

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
                                            onClick={() => { setParentStack([]); setSearchTarget(null); setSubpageId(it.id); }}
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
                                        onClick={() => { setParentStack([]); setSearchTarget(it.match.target || null); setSubpageId(it.id); }}
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

/**
 * @param {object} props
 * @param {boolean} [props.flat]       no card around the page at any width (lists that draw their own cards)
 * @param {boolean} [props.formFrame]  a form page (G126): no card around the whole form at phone and
 *   popup widths, one card from 600px (Settings.module.css .formFrame, U03's breakpoint)
 */
function SettingsPageTemplate({ view, children, sectionId, notices, flat = false, formFrame = false, ...props }) {
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
                    className={formFrame && !flat ? `${settingsStyles.settingsSurface} ${settingsStyles.formFrame}` : settingsStyles.settingsSurface}
                    data-settings-section={sectionId || undefined}
                    data-settings-frame={flat ? 'flat' : formFrame ? 'form' : 'card'}
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
            if (target.startsWith(ROW_TARGET)) {
                // A row on a row-list page, found by its id. A drill-in row's
                // label is its button; an inline row's is its title, since its
                // buttons are the help tip and the control.
                const item = [...scope.querySelectorAll('[data-settings-row-id]')]
                    .find((node) => node.getAttribute('data-settings-row-id') === target.slice(ROW_TARGET.length));
                const label = item?.querySelector('[data-settings-row-title]') || item?.querySelector('button');
                if (!item || !label) return false;
                highlighted = item;
                matchedLabel = label;
                highlighted.setAttribute('data-settings-search-highlight', 'true');
                matchedLabel.setAttribute('data-settings-search-match', 'true');
                highlighted.scrollIntoView?.({ block: 'center' });
                return true;
            }
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
        const threshold = formatFiatAmount(resolveSmallBalanceFiat(settings), settings.fiatCurrency || 'USD');
        parts.push(t('settings.page.belowHidden', { threshold }));
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

// The Network row's value: the wallet-wide environment now in use.
function networkSummary(settings) {
    if (!settings) return '-';
    return activeNetworkLabel(settings.activeNetwork);
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

// The Automatic donations row's line: "$0.05 per transaction", or Off.
function adsSummary(settings) {
    if (!settings) return '-';
    const ads = adsSettingsOf(settings);
    if (!isAdsOn(settings)) return t('settings.privacy.off');
    return t('settings.page.adsPerTransaction', { amount: formatFiatAmount(ads.perTransaction, ads.currency) });
}

function developerSummary(settings) {
    if (!settings) return t('settings.privacy.off');
    return settings.developerMode ? t('settings.page.on') : t('settings.privacy.off');
}

/** The Connected sites row's line: "None connected, none blocked". */
function sitesRowSummary(siteCount, blockedCount) {
    if (siteCount === null) return '-';
    const sites = siteCount === 0 ? 'None connected' : `${formatWithThousands(String(siteCount))} connected`;
    if (blockedCount === null) return sites;
    return `${sites}, ${blockedCount === 0 ? 'none' : formatWithThousands(String(blockedCount))} blocked`;
}

/**
 * Where a retired Settings page id now opens, or null for a live page.
 *
 * @param {string} id
 * @param {Record<string, Array<{ rows: Array<{ id: string, control?: unknown }> }>>} rowGroups
 * @returns {{ page: string, row?: string } | null}
 */
function retiredPageTarget(id, rowGroups) {
    if (RETIRED_PAGES[id]) return RETIRED_PAGES[id];
    for (const [groupId, groups] of Object.entries(rowGroups)) {
        if (groups.some((grp) => grp.rows.some((r) => r.id === id && r.control))) return { page: groupId, row: id };
    }
    return null;
}

function connectedSitesSummary(siteCount) {
    if (siteCount === null) return '-';
    if (siteCount === 0) return t('send.advanced.none');
    return t('settings.page.siteCount', { count: siteCount });
}

// The About row's icon: the XChain Wallet mark, sized like the other row icons.
function XChainLogoIcon() {
    return (
        <img
            src={branding.faviconUrl()}
            alt=""
            data-testid="settings-about-logo"
            style={{ width: 24, height: 24, objectFit: 'contain' }}
        />
    );
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
function WalletsSettingsPage({ walletLabel, walletId, onOpenAddresses, accountLabel, onOpenWalletPicker, onOpenAccountPicker }) {
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
    // One address read for the whole wallet (no account), for the My Addresses
    // count: My Addresses opened from here lists every account's addresses.
    const [addressCount, setAddressCount] = useState(/** @type {number | null} */ (null));
    useEffect(() => {
        let cancelled = false;
        if (!walletId || typeof messaging?.getAddressesByChain !== 'function') return undefined;
        // One read: addresses grouped by chain; the count is their total.
        Promise.resolve(messaging.getAddressesByChain(walletId)).then((byChain) => {
            if (cancelled) return;
            const lists = Array.isArray(byChain) ? [byChain] : Object.values(byChain || {});
            setAddressCount(lists.reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0));
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [messaging, walletId]);
    const rows = [
        { id: 'wallets', title: 'My Wallets', summary: walletCount === null ? walletLabel : `${walletCount} ${walletCount === 1 ? 'wallet' : 'wallets'} · ${walletLabel} active`, icon: Icon.WalletIcon, onClick: onOpenWalletPicker },
        { id: 'account', title: 'My Accounts', summary: accountCount === null ? (accountLabel || 'None') : `${accountCount} ${accountCount === 1 ? 'account' : 'accounts'}${accountLabel ? ` · ${accountLabel} active` : ''}`, icon: Icon.UserIcon, onClick: onOpenAccountPicker },
        { id: 'addresses', title: 'My Addresses', summary: addressCount === null ? '' : `${addressCount} ${addressCount === 1 ? 'address' : 'addresses'}`, icon: Icon.ReceiveIcon, onClick: onOpenAddresses },
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
const FLAT_GROUP_PAGES = new Set(['g-wallets', 'g-security', 'g-backup', 'g-privacy', 'g-appearance', 'g-notifications', 'g-network', 'g-advanced', 'advanced-developer-options',
    // The Appearance pages whose rows sit in their own card.
    'appearance-theme', 'appearance-language', 'appearance-currency', NUMBER_FORMAT_PICKER_PAGE_ID,
    // The per-network lists draw their own labelled card (G117), never a card in a card.
    'fees', 'network-endpoints',
    // The Network page draws the landing's list card itself (operator walk 2026-11-15).
    'network-active',
    // Test networks draws its network list and Tools in their own cards (G07).
    TEST_NETWORKS_PAGE_ID,
]);

// Form pages (G126, operator 2026-11-15): no card around the whole form at
// phone and popup widths, one card at iPad and desktop widths. The Backup and
// Recovery form pages are plain Form Standard pages on a phone (the notice,
// the fields and the button), and so is Automatic Donations. From 600px the
// one card sits at the standard form column width, centred (G126 revision
// 2026-11-15): Quiet Hours, Notification Sounds and Panic mode joined then.
const FORM_FRAME_PAGES = new Set([
    'backup-export', 'backup-phrase', 'backup-test', 'backup-publish', 'backup-restore', 'backup-contacts-export',
    'ads',
    'notifications-quiet', 'notifications-sounds',
    'security-panic', 'security-password', 'security-duress', BIOMETRIC_ENABLE_PAGE_ID,
    ADD_WATCHED_TOKEN_PAGE_ID,
    'display-balances', 'display-number-format', 'display-lists', 'display-reset',
    'privacy-reset',
    'wallet-remove', 'wallet-xpub',
    'about',
]);

// A device-state read that cannot run in this shell shows no value.
const safeRead = (read) => { try { return read(); } catch { return null; } };

/**
 * The labelled row groups of every Settings group page that holds more than
 * one setting (G08). Each row names the section component and `only` part its
 * page renders, and a summary read from settings when the list renders. A row
 * with `navigate` opens a page outside Settings instead of a Settings page.
 */
function settingsRowGroups({ password, backup, sections = new Map(), onNavigateToAdvanced, onNavigateToActionQueue, onPairAnotherPhone, pwaInstall, sitesSummary = '-', shell = 'web', holdAvailable = false, onOpen = () => {}, onClosePage = () => {}, onReturnTo = () => {}, onOpenToken, balancesScope = null }) {
    const row = (id, title, icon, Component, props, summary) => ({ id, title, icon, Component, props, summary });
    const navRow = (id, title, icon, navigate, summary) => ({ id, title, icon, navigate, summary: () => summary });
    const sectionProps = (id) => sections.get(id)?.props || {};
    return {
        'g-appearance': appearanceRowGroups({ onOpen, onOpenToken, onClosePage, balancesScope }),
        // Network and Fees (2026-11-13): one card, no one-row headings;
        // Network changes on its row (its confirm stays), the rest open pages.
        'g-network': [
            { label: '', rows: [
                // A chevron row opening the Network page (Mainnet, Testnet,
                // Regtest as the shared network rows); a pick keeps its
                // confirm and comes back here (operator ruling 2026-11-14).
                ...(sections.has('network') ? [row('network-active', 'Network', Icon.BroadcastIcon, NetworkEnvironmentPage, { ...sectionProps('network'), onDone: onClosePage }, networkSummary)] : []),
                // With Developer mode on, as before.
                ...(sections.has('network-endpoints') ? [row('network-endpoints', 'Network endpoints', Icon.LinkIcon, NetworkEndpointsSection, sectionProps('network-endpoints'), endpointsSummary)] : []),
                row('fees', 'Fee strategy', Icon.ClockIcon, FeesSection, {}, feesSummary),
                // The Donations group folded in here; the row reuses the ads
                // section id, so it opens that section's page.
                ...(sections.has('ads') ? [row('ads', 'Automatic Donations', Icon.HandshakeIcon, AdsSection, {}, adsSummary)] : []),
            ] },
        ],
        'g-notifications': notificationRowGroups({ row, notificationProps: sectionProps('notifications'), onOpen }),
        // Advanced (2026-11-13): Developer mode is a switch on its row; with
        // it on, Developer options opens the rest. One Developer heading.
        // The two-phone pairing moved here from the welcome screen (operator
        // ruling 2026-11-15); its page adds the shared phrase as a new wallet.
        'g-advanced': [
            ...(typeof onPairAnotherPhone === 'function' ? [{ label: 'Signing', rows: [
                navRow('advanced-pair-phone', 'Use another phone as a signer', Icon.SignIcon, onPairAnotherPhone, 'Keep the keys on a second, offline phone'),
            ] }] : []),
            { label: 'Developer', rows: [
                ...(sections.has('developer') ? [{
                    id: 'advanced-developer',
                    title: 'Developer mode',
                    icon: Icon.GearIcon,
                    line: 'Regtest, endpoints, preview tools',
                    help: t('settings.developer.unlocksTestNetworksEndpointOverrides'),
                    control: {
                        kind: 'switch',
                        checked: (st) => st.developerMode === true,
                        // Regtest needs Developer mode, so turning it off on
                        // Regtest moves the wallet to Mainnet and reloads.
                        write: async (next, update, st) => {
                            if (next || normalizeActiveNetwork(st.activeNetwork) !== 'regtest') {
                                await update({ developerMode: next });
                                return;
                            }
                            await update({ developerMode: false, activeNetwork: 'mainnet' });
                            sectionProps('developer').reload?.();
                        },
                    },
                }, {
                    id: 'advanced-developer-options',
                    title: 'Developer options',
                    icon: Icon.ContractIcon,
                    Component: SettingsRowGroupsPage,
                    props: { label: 'Developer options', groups: developerOptionGroups({ row, developerProps: sectionProps('developer'), onOpen, onClosePage, onReturnTo }), onOpen },
                    summary: () => 'Test networks, faucet, logs',
                    // Dimmed, no chevron and not clickable until Developer mode is on (2026-11-14).
                    disabledWhen: (st) => st?.developerMode !== true,
                }] : []),
                ...(typeof onNavigateToAdvanced === 'function' ? [navRow('advanced-action', t('settings.developer.advancedAction'), Icon.DocumentIcon, onNavigateToAdvanced, 'Any action from raw fields')] : []),
                ...(typeof onNavigateToActionQueue === 'function' ? [navRow('advanced-queue', t('settings.developer.actionQueue'), Icon.ListIcon, onNavigateToActionQueue, 'Compose actions across networks')] : []),
            ] },
            { label: 'App', rows: [
                ...(pwaInstall && pwaInstall.standalone !== true ? [(
                    typeof pwaInstall.install === 'function'
                        ? navRow(
                            'app-install',
                            t('pwaInstall.addToHomeScreen'),
                            Icon.DownloadIcon,
                            pwaInstall.install,
                            t('pwaInstall.addToHomeScreenSummary'),
                        )
                        : row(
                            'app-install',
                            t('pwaInstall.addToHomeScreen'),
                            Icon.DownloadIcon,
                            AddToHomeScreenInstructions,
                            { browser: pwaInstall.iosBrowser },
                            () => t('pwaInstall.manualStepsSummary'),
                        )
                )] : []),
                ...(sections.has('keyboard') ? [row('keyboard', 'Keyboard shortcuts', Icon.GridIcon, KeyboardSection, {}, keyboardSummary)] : []),
            ] },
        ].filter((grp) => grp.rows.length > 0),
        'g-security': securityRowGroups({ password, row, shell, holdAvailable, onOpen, onReturnTo }),
        'g-backup': backupRowGroups({ backup, row }),
        'g-privacy': privacyRowGroups({ sections, sitesSummary, onClosePage }),
    };
}

function AddToHomeScreenInstructions({ browser }) {
    let stepsKey = 'pwaInstall.otherBrowserSteps';
    if (browser === 'chrome') stepsKey = 'pwaInstall.iosChromeSteps';
    if (browser === 'safari') stepsKey = 'pwaInstall.iosSafariSteps';
    return (
        <Notice tone="info" title={t('pwaInstall.iosTitle')}>
            {t(stepsKey)}
        </Notice>
    );
}

// The nine wallet-event switches, each with its short line and icon; the
// help tip is the flag's own hint, or the text here where it has none.
const EVENT_ROWS = [
    ['txConfirmations', Icon.SendIcon, 'First confirmation of a sent transaction.'],
    ['incomingReceipts', Icon.DownloadIcon, 'Received by watched addresses.'],
    ['incomingPending', Icon.ClockIcon, 'Seen before confirmation.'],
    ['messages', Icon.MessageIcon, 'New messages to this wallet.', 'Notify when a message arrives for one of this wallet\'s addresses.'],
    ['governancePolls', Icon.ListIcon, 'Held-token polls; binding ones flagged.'],
    ['deadlines', Icon.BellIcon, 'Before trades, dispensers or polls close.'],
    ['dispenserEscrow', Icon.CoinsIcon, 'Escrow near empty.', 'Notify when one of your dispensers is close to running out of escrow.'],
    ['dispenserFills', Icon.TokenIcon, 'Someone bought from a dispenser.', 'Notify when someone buys from one of your dispensers.'],
    ['orderFills', Icon.LineChartIcon, 'An order matched.', 'Notify when one of your open orders is matched on the exchange.'],
    // The price-alert master (G08): it stays on this page; the Price Alerts
    // page below it never depends on it.
    ['priceAlerts', Icon.BellIcon, 'A coin or token reaches a price you set.'],
];

/**
 * Notifications (2026-11-13): the permission and the nine event switches on
 * the page, greyed until notifications are allowed; Quiet hours, Sounds and
 * Price alerts each open a page of their own.
 */
function notificationRowGroups({ row, notificationProps, onOpen = () => {} }) {
    const flagLabel = (key) => NOTIFICATION_FLAGS.find((f) => f.key === key)?.label || key;
    return [
        ...(notificationPermissionAvailable() ? [{ label: '', rows: [{
            id: 'notifications-permission',
            title: 'Desktop notifications',
            icon: Icon.BellIcon,
            line: 'Needed before any alert below',
            help: 'The browser or system asks once whether XChain Wallet may show notifications; the alerts below need it.',
            control: { kind: 'custom', Component: NotificationsPermissionInlineRow },
        }] }] : []),
        { label: 'Events', rows: EVENT_ROWS.map(([key, icon, line, help]) => ({
            id: `notifications-${key}`,
            title: flagLabel(key),
            icon,
            line,
            help: NOTIFICATION_FLAGS.find((f) => f.key === key)?.hint || help,
            flagKey: key,
            control: { kind: 'custom', Component: NotificationEventInlineRow },
        })) },
        { label: 'Schedule, sound and prices', rows: [
            row('notifications-quiet', 'Quiet hours', Icon.ClockIcon, NotificationsSection, { ...notificationProps, only: 'quiet' }, (st) => {
                const qh = st?.quietHours;
                return qh?.enabled ? `${qh.start} to ${qh.end}` : 'Off';
            }),
            row('notifications-sounds', 'Notification sounds', Icon.PlayIcon, NotificationsSection, { ...notificationProps, only: 'sounds', onOpenPage: onOpen }, (st) => (st?.sounds?.enabled === true ? 'On' : 'Off')),
            // The alert list is its own page (list, alert, add and edit pages
            // under it); the on/off master is the Price alerts switch above.
            {
                id: 'notifications-price-alerts',
                title: 'Your price alerts',
                icon: Icon.LineChartIcon,
                Component: PriceAlertsSection,
                ownsScreen: true,
                props: { walletId: notificationProps?.walletId },
                summary: () => t('settings.priceAlerts.rowLine'),
            },
        ] },
    ];
}

/**
 * Developer options, opened from Advanced while Developer mode is on: the
 * switches and the one choice change on their rows; regtest networks, the
 * faucet, custom networks and the log console open pages.
 */
function developerOptionGroups({ row, developerProps, onOpen, onClosePage, onReturnTo }) {
    // Test Networks and its pages open more pages and return in one step.
    const pageProps = { ...developerProps, onOpen, onClosePage, onReturnTo };
    return [{ label: '', rows: [
        switchRow('developer-variant', 'Show variant popover', Icon.EyeIcon, 'showVariantBadge', {
            line: 'Preview each wallet layout',
            help: t('settings.developer.inTheWebAppDisplay'),
        }),
        // Regtest networks and Custom networks are one page (operator picks
        // 2026-11-14): the networks this wallet uses, and Add Network.
        row(TEST_NETWORKS_PAGE_ID, 'Test networks', Icon.BroadcastIcon, TestNetworksPage, pageProps, () => 'Active regtest and custom networks'),
        // The faucet draws its own header, whose filter searches its History.
        { ...row(FAUCET_PAGE_ID, 'Regtest faucet', Icon.CoinsIcon, FaucetPage, pageProps, () => 'Get test coins, history'), ownsScreen: true },
        switchRow('developer-localhost', 'Auto-approve localhost dApps', Icon.CheckIcon, 'autoApproveLocalhost', {
            line: 'Local apps connect without asking',
            help: t('settings.developer.letLocalDevelopmentAppsConnect'),
        }),
        {
            id: 'developer-auto-sign',
            title: t('settings.developer.cachePasswordForLocalhostAuto'),
            icon: Icon.ClockIcon,
            line: t('settings.developer.autoSignLine'),
            help: t('settings.developer.inDeveloperModeKeepAn'),
            control: {
                kind: 'select',
                value: (st) => String(AUTO_SIGN_LOCALHOST_OPTIONS.includes(st.autoSignLocalhostMs) ? st.autoSignLocalhostMs : AUTO_SIGN_LOCALHOST_OPTIONS[0]),
                options: () => autoSignOptions(),
                patch: (value) => ({ autoSignLocalhostMs: Number(value) }),
            },
        },
        {
            id: 'developer-logs',
            title: t('settings.developer.logsAndDiagnosticsConsole'),
            icon: Icon.DocumentIcon,
            summary: () => 'Recent console output',
        },
    ] }];
}

/** An inline switch row on a group page; `field` is a top-level key or a [block, key] pair such as ['privacy', 'hapticsEnabled']. */
function switchRow(id, title, icon, field, { line, help, defaultOn = false, saveError } = {}) {
    const [scope, key] = Array.isArray(field) ? field : [null, field];
    const read = (st) => (scope ? st?.[scope]?.[key] : st?.[key]);
    return {
        id,
        title,
        icon,
        line,
        help,
        saveError,
        control: {
            kind: 'switch',
            checked: (st) => (defaultOn ? read(st) !== false : read(st) === true),
            patch: (next) => (scope ? { [scope]: { [key]: next } } : { [key]: next }),
        },
    };
}

// Hold sends before broadcast: its switch and seconds as one choice
// (2026-11-13 CALL); Off keeps the stored seconds for the next time it is on.
// Short labels (operator ruling 2026-11-14) keep the row's dropdown narrow;
// the schema caps the hold at 30 seconds.
const HOLD_PRESETS = [5, 10, 20, 30];

function holdValue(st) {
    return st?.grace?.undoSendEnabled === true ? String(resolveUndoSendSeconds(st)) : 'off';
}

function holdOptions(st) {
    const seconds = (n) => `${n} s`;
    const options = [{ value: 'off', label: 'Off' }, ...HOLD_PRESETS.map((n) => ({ value: String(n), label: seconds(n) }))];
    const current = holdValue(st);
    if (current !== 'off' && !HOLD_PRESETS.includes(Number(current))) options.push({ value: current, label: seconds(Number(current)) });
    return options;
}

function autolockOptions(st, shell) {
    const options = AUTOLOCK_OPTIONS.map((o) => ({ value: String(o.value), label: autolockOptionLabel(o, shell) }));
    const minutes = st?.autolockMinutes;
    if (Number.isFinite(minutes) && !AUTOLOCK_OPTIONS.some((o) => o.value === minutes)) {
        options.push({ value: String(minutes), label: t('settings.safety.minutesCustom', { autolockMinutes: minutes }) });
    }
    return options;
}

/**
 * Security (2026-11-13, operator rulings 2026-11-14): Auto-lock, test send
 * and Hold sends are dropdowns; Biometric unlock, Lookalike warnings and
 * Hardware cross-check are switches. Turning Biometric unlock on opens the
 * Enable Biometric Unlock page; Panic mode, Wallet password and Duress
 * passphrase are chevron rows that open their own pages.
 */
function securityRowGroups({ password, row, shell, holdAvailable, onOpen = () => {}, onReturnTo = () => {} }) {
    return [
        { label: 'Unlocking', rows: [
            row('security-password', 'Wallet password', Icon.KeyIcon, ThisWalletSection, password, () => 'Current, new and confirm'),
            {
                id: 'security-autolock',
                title: 'Auto-lock',
                icon: Icon.ClockIcon,
                line: 'Lock after no activity for',
                help: t('settings.help.safety.autoLock'),
                control: {
                    kind: 'select',
                    value: (st) => String(st.autolockMinutes),
                    options: (st) => autolockOptions(st, shell),
                    patch: (value) => ({ autolockMinutes: Number(value) }),
                },
            },
            {
                id: 'security-biometric',
                title: 'Biometric unlock',
                icon: Icon.UnlockIcon,
                line: 'Unlock without typing your password',
                help: 'Turning it on asks for your wallet password once, then the device unlocks the wallet with its own check. Turning it off removes the stored credential from this device.',
                // Turning the switch on opens Enable Biometric Unlock.
                onEnrol: () => onOpen(BIOMETRIC_ENABLE_PAGE_ID),
                control: { kind: 'custom', Component: BiometricInlineRow },
            },
        ] },
        { label: 'Sending', rows: [
            {
                id: 'security-test-send',
                title: 'New-recipient test send',
                icon: Icon.SendIcon,
                line: t('settings.security.testSendLine'),
                help: t('settings.help.safety.testSend'),
                // In the display currency: Off, four amounts and Custom.
                control: { kind: 'custom', Component: TestSendThresholdInlineRow },
            },
            switchRow('security-lookalike', 'Lookalike address warnings', Icon.EyeIcon, ['grace', 'lookalikeWarnings'], {
                line: t('settings.security.lookalikeLine'),
                help: t('settings.security.lookalikeHelp'),
                defaultOn: true,
            }),
            {
                id: 'security-hold',
                title: 'Hold sends before broadcast',
                icon: Icon.PauseIcon,
                line: 'Time to cancel a signed send',
                // Until the host can hold a send, the choice is saved but not applied, and the tip says so.
                help: holdAvailable ? t('settings.help.undoSend') : `${t('settings.help.undoSend')} ${t('settings.undoSend.hintUnavailable')}`,
                control: {
                    kind: 'select',
                    value: holdValue,
                    options: holdOptions,
                    patch: (value) => (value === 'off'
                        ? { grace: { undoSendEnabled: false } }
                        : { grace: { undoSendEnabled: true, undoSendSeconds: Number(value) } }),
                },
            },
            // A signing check, moved here from Privacy and Sites (2026-11-13).
            switchRow('privacy-hardware', 'Hardware cross-check', Icon.UsbIcon, ['privacy', 'alwaysRequireHwExplicitConfirm'], {
                line: 'Confirm path and address every sign',
                help: t('settings.privacy.requireTheIVeVerified'),
                saveError: t('settings.privacy.couldNotSaveThisPrivacy'),
            }),
        ] },
        { label: 'Emergency', rows: [
            // A chevron row opening the Panic Mode page (confirm, or the
            // status and Deactivate while a freeze runs).
            row('security-panic', 'Panic mode', Icon.ZapIcon, PanicModePage, { onDone: () => onReturnTo('g-security') }, panicRowSummary),
            row('security-duress', 'Duress passphrase', Icon.LockIcon, SafetySection, { only: 'duress' }, () => {
                const set = safeRead(isDuressConfigured);
                return set === null ? '-' : (set ? 'Set' : 'Not set');
            }),
        ] },
    ];
}

/**
 * Backup and Recovery (2026-11-13): Import contacts
 * opens the file picker and Export contacts opens its own page (2026-11-14,
 * chevron rows, no button inside a row), and Labels survive restore joins from
 * Privacy and Sites; the five forms still open pages.
 *
 * A hardware wallet keeps its keys on the device: it has no backup file,
 * recovery phrase or test restore, and no seed key to publish or find
 * on-chain labels under, so those rows never show for it (their pages
 * would be blank or refused).
 */
function backupRowGroups({ backup, row }) {
    const seedless = isHardwareWallet(backup?.activeWallet);
    return [
        { label: 'Wallet backup', rows: seedless ? [] : [
            // Each action page lands straight on its form, its one step
            // before the result (no intro row with a second button).
            row('backup-export', 'Encrypted backup file', Icon.SaveIcon, BackupSection, { ...backup, only: 'export', direct: true }, () => 'Password-protected file'),
            row('backup-phrase', 'Recovery phrase', Icon.KeyIcon, BackupSection, { ...backup, only: 'phrase', direct: true }, () => 'Show the words with your password'),
            row('backup-test', 'Test backup', Icon.VerifyIcon, BackupSection, { ...backup, only: 'test', direct: true }, () => 'Check a phrase against this wallet'),
        ] },
        { label: 'Labels and contacts', rows: [
            // Moved here from Privacy and Sites, beside Publish labels (2026-11-13).
            switchRow('privacy-labels', 'Labels survive restore', Icon.BookIcon, ['privacy', 'labelsSurviveRestore'], {
                line: 'Back up label edits on-chain',
                help: t('settings.privacy.inTheBrowserExtensionBatch'),
                saveError: t('settings.privacy.couldNotSaveThisPrivacy'),
            }),
            ...(seedless ? [] : [
                row('backup-publish', 'Publish labels on-chain', Icon.UploadIcon, BackupSection, { ...backup, only: 'publish', direct: true }, () => 'Encrypted, readable only by this wallet'),
                // A short title for the header (G01, operator walk 2026-11-15);
                // the page's top notice carries the full explanation.
                row('backup-restore', 'Restore contacts', Icon.DownloadIcon, BackupSection, { ...backup, only: 'restore', direct: true }, () => 'Find labels and contacts saved on-chain'),
            ]),
            // A chevron row that opens the Export contacts page (JSON or CSV).
            row('backup-contacts-export', 'Export contacts', Icon.UsersIcon, ContactsExportPage, {}, () => 'As JSON or CSV'),
            // A chevron row that opens the file picker on this page.
            {
                id: 'backup-contacts-import',
                title: 'Import contacts',
                icon: Icon.UsersIcon,
                line: 'JSON or CSV file, up to 2 MB',
                control: { kind: 'custom', Component: ContactsImportInlineRow },
            },
        ] },
    ].filter((grp) => grp.rows.length > 0);
}

// The Reduce motion choices, each with its icon (G96 dropdown rule).
const REDUCED_MOTION_ICONS = { auto: Icon.GearIcon, always: Icon.PauseIcon, never: Icon.PlayIcon };

/**
 * Appearance (operator rulings 2026-11-14): Theme, Language, Fiat currency,
 * Hide small balances and Number format are chevron rows showing their value
 * and opening their own page; Clear remembered network filters and Reset
 * display settings open a confirm page. Reduce motion is the row's dropdown,
 * and the switches change on their rows. Haptic feedback joins from Privacy
 * and Sites and Learn mode from Advanced.
 */
function appearanceRowGroups({ onOpen = () => {}, onOpenToken, onClosePage = () => {}, balancesScope = null } = {}) {
    return [
        { label: 'Look', rows: [
            {
                id: 'appearance-theme',
                title: 'Theme',
                icon: Icon.PaletteIcon,
                Component: ThemePage,
                summary: themeRowSummary,
            },
            {
                id: 'appearance-motion',
                title: 'Reduce motion',
                icon: Icon.PauseIcon,
                line: 'Turns off sliding and fading animations',
                help: t('settings.help.appearance.reducedMotion'),
                saveError: 'Could not save appearance settings. Try again.',
                control: {
                    kind: 'select',
                    value: (st) => st.reducedMotion || 'auto',
                    options: () => REDUCED_MOTION_OPTIONS.map((o) => {
                        const MotionIcon = REDUCED_MOTION_ICONS[o.value] || Icon.GearIcon;
                        return { value: o.value, label: o.label, icon: <MotionIcon /> };
                    }),
                    patch: (value) => ({ reducedMotion: value }),
                },
            },
            switchRow('privacy-haptics', 'Haptic feedback', Icon.ZapIcon, ['privacy', 'hapticsEnabled'], {
                line: 'Vibrate on taps and alerts',
                help: t('settings.privacy.allowVibrationForTapSuccess'),
                defaultOn: true,
                saveError: t('settings.privacy.couldNotSaveThisPrivacy'),
            }),
            switchRow('appearance-learn', 'Learn mode', Icon.InfoIcon, 'learnMode', {
                line: 'Plain-language notes on confirm screens',
                help: t('settings.developer.addsPlainLanguageExplanationsTo'),
            }),
        ] },
        { label: 'Language and region', rows: [
            // A pick on the Language or Fiat Currency page returns here. Both
            // draw their own screen so the search sits behind the title-bar
            // filter button (G04, G95); Fiat Currency is FiatCurrencyPicker.
            {
                id: 'appearance-language',
                title: 'Language',
                icon: Icon.MessageIcon,
                Component: LanguagePage,
                ownsScreen: true,
                props: { onDone: onClosePage },
                summary: languageRowSummary,
            },
            {
                id: 'appearance-currency',
                title: 'Fiat currency',
                icon: Icon.DollarIcon,
                Component: CurrencyPage,
                ownsScreen: true,
                props: { onDone: onClosePage },
                summary: currencyRowSummary,
            },
        ] },
        { label: 'Balances', rows: [
            {
                id: 'display-balances',
                title: 'Hide small balances',
                icon: Icon.CoinsIcon,
                Component: HideSmallBalancesPage,
                props: { walletId: balancesScope?.walletId || null, accountId: balancesScope?.accountId || null },
                summary: smallBalancesSummary,
            },
            switchRow('display-unknown', 'Hide unknown tokens', Icon.EyeOffIcon, 'hideUnknownTokens', {
                line: 'No name or image, never touched',
                help: t('settings.display.collapseUnpricedTokensWithoutA'),
            }),
            {
                id: 'display-number-format',
                title: 'Number format',
                icon: Icon.GridIcon,
                Component: NumberFormatPage,
                // Its Display format field opens the Display Format picker page.
                props: { onOpenPage: onOpen },
                summary: numberFormatSummary,
            },
        ] },
        { label: 'Tokens and lists', rows: [
            // The star and the hide button show on Home's coin, token and
            // collectible rows (BalanceList, CollectiblesView); pickers list
            // pinned tokens first and fold hidden ones, but carry no buttons.
            switchRow('display-pin', 'Pin button on rows', Icon.EyeIcon, 'showPinAffordance', {
                line: 'Shows a star on token rows to pin a token to the top of Home',
                help: 'The star shows on the coin, token and collectible rows on Home. A pinned token stays at the top of Home and of the token pickers, and never folds into small balances.',
            }),
            switchRow('display-hide', 'Hide button on rows', Icon.EyeOffIcon, 'showHideAffordance', {
                line: 'Shows a hide button on token rows; hidden tokens move to the Hidden list in Tokens and fold to the end of Home and pickers',
                help: 'The button shows on the coin, token and collectible rows on Home. A hidden token is listed under Hidden on the Tokens page below, where you can unhide it. On Home and in the token pickers it moves into the closed "Show hidden tokens" group at the end of the list.',
            }),
            {
                id: 'display-tokens',
                title: 'Tokens',
                icon: Icon.TokenListIcon,
                Component: TokenListsSection,
                // The page draws its own header (filter and plus) and opens
                // the token pages and Add Watched Token itself.
                ownsScreen: true,
                props: { onOpenToken, onOpenPage: onOpen },
                summary: () => 'Watched, pinned and hidden',
            },
            // Each opens a confirm page that says what changes, with one button
            // (G104: no modal); its Done returns here.
            {
                id: 'display-lists',
                title: 'Clear remembered network filters',
                icon: Icon.FilterIcon,
                Component: ClearNetworkFiltersPage,
                props: { onDone: onClosePage },
                summary: () => 'Each list forgets the network you last picked and shows all networks again',
            },
            {
                id: 'display-reset',
                title: 'Reset display settings',
                icon: Icon.RefreshIcon,
                Component: ResetDisplayPage,
                props: { onDone: onClosePage },
                summary: () => 'Puts theme, language, currency, number format and the options on this page back to their defaults',
            },
        ] },
    ];
}

// Clipboard auto-clear presets (2026-11-13 CALL), in seconds, replacing the
// free number; a stored value off the list stays listed as its own choice.
const CLIPBOARD_PRESETS = [
    { value: 0, label: 'Off' },
    { value: 30, label: '30 seconds' },
    { value: 60, label: '1 minute' },
    { value: 120, label: '2 minutes' },
    { value: 300, label: '5 minutes' },
    { value: 600, label: '10 minutes' },
];

function clipboardSeconds(st) {
    const stored = st?.privacy?.clipboardAutoClearSeconds;
    return Number.isInteger(stored) ? stored : CLIPBOARD_AUTO_CLEAR_DEFAULT;
}

function clipboardOptions(st) {
    const seconds = clipboardSeconds(st);
    const options = CLIPBOARD_PRESETS.map((o) => ({ value: String(o.value), label: o.label }));
    if (!CLIPBOARD_PRESETS.some((o) => o.value === seconds)) {
        options.push({ value: String(seconds), label: `${seconds} ${seconds === 1 ? 'second' : 'seconds'}` });
    }
    return options;
}

const FORM_DRAFT_PRESETS = [
    { value: FORM_DRAFT_TTL_OFF, label: 'Off' },
    { value: FORM_DRAFT_TTL_1H, label: '1 hour' },
    { value: FORM_DRAFT_TTL_24H, label: '24 hours' },
    { value: FORM_DRAFT_TTL_7D, label: '7 days' },
];

function formDraftMs(st) {
    const stored = st?.privacy?.formDraftTtlMs;
    return Number.isFinite(stored) ? Number(stored) : FORM_DRAFT_TTL_DEFAULT;
}

function formDraftOptions(st) {
    const ms = formDraftMs(st);
    const options = FORM_DRAFT_PRESETS.map((o) => ({ value: String(o.value), label: o.label }));
    if (!FORM_DRAFT_PRESETS.some((o) => o.value === ms)) {
        const hours = Math.round(ms / 3_600_000);
        options.push({ value: String(ms), label: `${hours} ${hours === 1 ? 'hour' : 'hours'}` });
    }
    return options;
}

/**
 * Privacy and Sites (2026-11-13): every privacy setting is one switch or one
 * short choice, so each changes on the row; only Connected sites, with its
 * lists and per-site permissions, opens a page. The keys, defaults and writes
 * are PrivacySection's.
 */
function privacyRowGroups({ sections, sitesSummary, onClosePage = () => {} }) {
    const sw = (id, title, icon, field, { line, help, defaultOn = false, disabled }) => ({
        id,
        title,
        icon,
        line,
        help,
        saveError: t('settings.privacy.couldNotSaveThisPrivacy'),
        control: {
            kind: 'switch',
            checked: (st) => (defaultOn ? st.privacy?.[field] !== false : st.privacy?.[field] === true),
            patch: (next) => ({ privacy: { [field]: next } }),
            disabled,
        },
    });
    const torLive = shellCapabilities().socksProxy;
    const tor = torLive
        ? sw('privacy-tor', 'Tor routing', Icon.BroadcastIcon, 'torRouting', {
            line: 'Send wallet traffic through Tor',
            help: t('settings.privacy.desktopOnlySendWalletTraffic'),
        })
        // A shell that cannot proxy shows the switch off and disabled: its
        // stored desktop preference cannot affect traffic here.
        : {
            ...sw('privacy-tor', 'Tor routing', Icon.BroadcastIcon, 'torRouting', {
                line: isNativeShell() ? t('settings.privacy.notAvailableInNativeApp') : 'Desktop app only, not available here',
                help: t('settings.help.privacy.tor'),
            }),
            control: { kind: 'switch', checked: () => false, patch: () => ({}), disabled: () => true },
        };
    return [
        { label: 'Network and sites', rows: [
            tor,
            sw('privacy-price-data', 'Coin price data', Icon.LineChartIcon, 'priceDataEnabled', {
                line: 'Prices and charts from CoinGecko',
                help: t('settings.privacy.allowCoingeckoRequestsForNative'),
                defaultOn: true,
            }),
            sw('privacy-metadata', 'Token metadata', Icon.TokenIcon, 'metadataFetchEnabled', {
                line: 'Token details from issuer sites',
                help: t('settings.privacy.fetchTokenInformationStandardTis'),
                defaultOn: true,
            }),
            // Lists and per-site permissions: the one row here with a page.
            // It reuses the connected-sites section id, so it opens that page.
            ...(sections.has('connected-sites') ? [{
                id: 'connected-sites',
                title: 'Connected sites',
                icon: Icon.LinkIcon,
                Component: ConnectedSitesSection,
                props: {},
                summary: () => sitesSummary,
            }] : []),
        ] },
        // Labels survive restore moved to Backup and Recovery and Hardware
        // cross-check to Security (2026-11-13), which left Change-address
        // rotation alone under its heading, so it joins the device card.
        { label: 'Addresses and device', rows: [
            sw('privacy-change-address', 'Change-address rotation', Icon.AddressIcon, 'changeAddressRotation', {
                line: 'A new change address on each send',
                help: t('settings.privacy.importedKeyAndWatchOnly'),
            }),
            sw('privacy-blur', 'Blur when the window loses focus', Icon.EyeOffIcon, 'blurOnBlur', {
                line: 'Hide the wallet while you are away',
                help: t('settings.privacy.blurTheEntireWalletDisplay'),
            }),
            {
                id: 'privacy-clipboard',
                title: 'Clipboard auto-clear',
                icon: Icon.PasteIcon,
                line: 'Clear copied values after',
                help: t('settings.help.privacy.clipboardAutoClear'),
                saveError: t('settings.privacy.couldNotSaveThisPrivacy'),
                control: {
                    kind: 'select',
                    value: (st) => String(clipboardSeconds(st)),
                    options: clipboardOptions,
                    patch: (value) => ({ privacy: { clipboardAutoClearSeconds: Number(value) } }),
                },
            },
            {
                id: 'privacy-form-drafts',
                title: 'Form drafts',
                icon: Icon.DocumentIcon,
                line: 'Keep half-filled forms for',
                help: t('settings.help.privacy.formDraftRetention'),
                saveError: t('settings.privacy.couldNotSaveThisPrivacy'),
                control: {
                    kind: 'select',
                    value: (st) => String(formDraftMs(st)),
                    options: formDraftOptions,
                    patch: (value) => ({ privacy: { formDraftTtlMs: Number(value) } }),
                },
            },
            // Haptic feedback moved to Appearance (2026-11-13).
            {
                id: 'privacy-reset',
                title: 'Reset privacy settings',
                icon: Icon.RefreshIcon,
                // A confirm page of its own with the chevron, as display-reset
                // is (G104): no inline button, no reset without a confirm.
                Component: ResetPrivacyPage,
                props: { onDone: onClosePage },
                summary: () => 'Restore every privacy default',
            },
        ] },
    ];
}

/**
 * A group page as labelled lists of rows, styled like the Settings
 * landing. A row with a `control` changes its setting in place
 * (SettingsInlineRow); any other row opens its own page. Summaries are read
 * on each render so a value changed on a row's page shows when Back returns
 * here.
 */
function SettingsRowGroupsPage({ label, groups, onOpen }) {
    const { settings, update, error } = useSettings();
    // A failed load says so instead of leaving greyed controls.
    if (error) return <SettingsLoadError error={error} />;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)' }} aria-label={label}>
            <style>{GROUP_ICON_CSS}</style>
            {groups.map((grp, index) => (
                <div key={grp.label || `card-${index}`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-1)', border: 0, borderTop: 0, boxShadow: 'none', padding: 0, margin: 0 }}>
                    {/* A page of one card shows no heading over it (2026-11-13); its list takes the page name. */}
                    {grp.label ? (
                        <div style={{ fontSize: 'var(--xc-text-xs)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--xc-text-muted)', margin: 'var(--xc-space-2) var(--xc-space-1) 0' }}>{grp.label}</div>
                    ) : null}
                    {/* A card holding an inline control lets a dropdown open past the card edge. */}
                    {/* Safari needs an explicit list role because this class removes list styling. */}
                    <ul className={groupListStyles.list} role="list" aria-label={grp.label || label} style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', background: 'var(--xc-surface)', overflow: grp.rows.some((r) => r.control) ? 'visible' : 'hidden' }}>
                        {grp.rows.map((r) => {
                            const RowIcon = r.icon;
                            const leading = <span className={groupListStyles.rowIcon} aria-hidden="true" data-settings-group-icon="" style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}><RowIcon /></span>;
                            if (r.control) {
                                return (
                                    <li key={r.id} data-settings-row-id={r.id}>
                                        <SettingsInlineRow row={r} leading={leading} settings={settings} update={update} />
                                    </li>
                                );
                            }
                            return (
                                // The id lets a search hit highlight this row.
                                <li key={r.id} data-settings-row-id={r.id}>
                                    <ListRow
                                        type="button"
                                        onClick={() => (r.navigate ? r.navigate() : onOpen(r.id))}
                                        leading={leading}
                                        title={r.title}
                                        subtitle={r.summary(settings)}
                                        // A row that needs another setting first stays listed,
                                        // dimmed, with no chevron and no badge.
                                        disabled={Boolean(r.disabledWhen?.(settings))}
                                        chevron={!r.disabledWhen?.(settings)}
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
