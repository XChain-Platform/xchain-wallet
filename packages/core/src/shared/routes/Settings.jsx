// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, Icon, ListPage, PageHeader, Screen, SectionHeader } from '@xchain-wallet/core/ui';
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
import actionStyles from './ActionsMenu.module.css';
import settingsStyles from './Settings.module.css';

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
    const [siteCount, setSiteCount] = useState(/** @type {number | null} */ (null));
    const [walletManagementBusy, setWalletManagementBusy] = useState(false);

    const { settings } = useSettings();

    useEffect(() => {
        let alive = true;
        if (typeof messaging?.listConnectedSites !== 'function') return undefined;
        messaging.listConnectedSites()
            .then((list) => { if (alive) setSiteCount(Array.isArray(list) ? list.length : 0); })
            .catch(() => { if (alive) setSiteCount(0); });
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

    const walletLabel = activeWallet?.name || 'No wallet';
    const accountLabel = activeAccount?.name
        || (Number.isInteger(activeAccount?.index) ? `Account ${activeAccount.index + 1}` : 'Account 1');

    const sections = useMemo(() => /** @type {SectionDef[]} */ ([
        {
            id: 'this-wallet',
            title: 'This wallet',
            description: 'Manage its name, extended public keys, switching, and removal.',
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
            title: 'Accounts & addresses',
            description: 'Choose the active account and manage change addresses and signer pairing.',
            keywords: 'account address signer change addresses',
            kind: 'external-drill',
            visible: Boolean(onOpenAccountPicker && activeWallet),
            onOpen: onOpenAccountPicker,
            summary: accountLabel,
        },
        {
            id: 'appearance',
            title: 'Appearance',
            description: 'Choose the theme, accent color, and motion preference.',
            keywords: 'appearance theme system default color motion accent dark light reduced follow',
            kind: 'panel',
            Component: AppearanceSection,
        },
        {
            id: 'display',
            title: 'Display',
            description: 'Control balance thresholds, number formatting, and pinned or hidden tokens.',
            keywords: 'display balance threshold number format pinned hidden tokens reorder unhide bulk star',
            searchTerms: 'row affordances show pin hide button unpin list preferences saved chain filters reset',
            kind: 'internal-drill',
            Component: DisplaySection,
            summary: displaySummary(settings),
        },
        {
            id: 'keyboard',
            title: 'Keyboard',
            description: 'View and rebind shortcuts.',
            keywords: 'keyboard shortcuts rebind reset keys hotkeys bindings open command palette lock wallet settings new send go balances history receive dex contacts filter export pin hide focused token submit form',
            kind: 'internal-drill',
            Component: KeyboardSection,
            summary: keyboardSummary(settings),
        },
        {
            id: 'language-region',
            title: 'Language & region',
            description: 'Choose the interface language and fiat currency.',
            keywords: 'language region currency fiat locale custom iso code',
            kind: 'panel',
            Component: LanguageRegionSection,
        },
        {
            id: 'privacy',
            title: 'Privacy',
            description: 'Control network privacy, sensitive-data visibility, metadata requests, and restore behavior.',
            keywords: 'privacy tor routing change address rotation blur sensitive data labels survive restore haptic feedback native coin price data fetch token metadata hardware cross check confirm form draft retention',
            kind: 'internal-drill',
            Component: PrivacySection,
            summary: privacySummary(settings),
        },
        {
            id: 'safety',
            title: 'Safety',
            description: 'Set auto-lock, send safeguards, panic mode, biometric access, and backup reminders.',
            keywords: 'safety autolock auto lock timeout test send warning threshold cancel sends undo biometric unlock wallet password panic mode duress passphrase backup reminders',
            kind: 'internal-drill',
            Component: SafetySection,
            summary: safetySummary(settings),
        },
        {
            id: 'wallet-mode',
            title: 'Wallet mode',
            description: 'Choose whether this device signs, broadcasts, or prepares transactions for air-gapped signing.',
            keywords: 'wallet mode full watcher watch only signer air gapped psbt cold storage',
            kind: 'internal-drill',
            Component: WalletModeSection,
            summary: walletModeSummary(settings),
        },
        {
            id: 'backup',
            title: 'Backup',
            description: 'Export recovery data, verify a recovery phrase, and restore labels and contacts.',
            keywords: 'backup password wallet password export encrypted file reveal back up seed recovery phrase mnemonic test dry run restore publish labels on chain contacts',
            kind: 'internal-drill',
            Component: BackupSection,
            props: { activeWallet, reload },
            summary: 'Encrypted file export',
        },
        {
            id: 'fees',
            title: 'Fees',
            description: 'Choose the fee strategy and fee-bumping default for each chain.',
            keywords: 'fees fee strategy rate rbf replace by fee chain custom allow bump defaults',
            kind: 'internal-drill',
            Component: FeesSection,
            summary: feesSummary(settings),
        },
        {
            id: 'network',
            title: 'Network',
            // Optional-chained: settings is null until the async read lands,
            // and the section list renders during that window.
            description: settings?.developerMode
                ? 'Choose Mainnet, Testnet, or Regtest to control which chains the wallet queries and displays; changing the network reloads the page.'
                : 'Choose Mainnet or Testnet to control which chains the wallet queries and displays; changing the network reloads the page.',
            keywords: settings?.developerMode
                ? 'network active mainnet testnet regtest filter chain switch mode dev'
                : 'network active mainnet testnet filter chain switch mode',
            kind: 'panel',
            Component: NetworkSection,
            // The section needs the wallet so the switch can derive
            // that wallet's first address on each chain of the new network.
            props: { activeWallet },
        },
        {
            id: 'network-endpoints',
            title: 'Network & endpoints',
            description: 'Set explorer, encoder, and hub URLs for each chain.',
            keywords: 'network endpoints explorer encoder hub url chain registry reset default save',
            kind: 'internal-drill',
            Component: NetworkEndpointsSection,
            summary: endpointsSummary(settings),
        },
        {
            id: 'notifications',
            title: 'Notifications',
            description: 'Choose which wallet events trigger notifications, sounds, or price alerts.',
            keywords: 'notifications desktop permission transaction confirmations incoming receipts pending payments messages governance polls deadlines dispenser running low fills order price alerts sounds quiet hours do not disturb',
            kind: 'panel',
            Component: NotificationsSection,
            props: { walletId: activeWallet?.id },
        },
        {
            id: 'connected-sites',
            title: 'Connected sites',
            description: 'Review dApp connections and control each site\'s permissions.',
            keywords: 'connected sites website dapp connections permissions chains accounts sign messages actions origin disconnect block unblock blocked mutations throttle burst window',
            kind: 'internal-drill',
            Component: ConnectedSitesSection,
            summary: connectedSitesSummary(siteCount),
        },
        {
            id: 'contacts',
            title: 'Contacts',
            description: 'Export or import the address book.',
            keywords: 'contacts address book export import json file drop private encrypted',
            kind: 'panel',
            Component: ContactsSection,
        },
        {
            id: 'ads',
            title: 'Automatic donation system',
            description: 'Turn automatic donations on or off, set per-chain amounts and thresholds, and view lifetime totals.',
            keywords: 'donation ads automatic on off per chain transaction amount trigger threshold address lifetime totals',
            kind: 'internal-drill',
            Component: AdsSection,
            summary: adsSummary(settings),
        },
        {
            id: 'developer',
            title: 'Developer mode',
            description: 'Configure regtest networks, custom endpoints, local dApp controls, and diagnostics.',
            keywords: 'developer mode learn variant popover regtest networks faucet mint custom chains endpoints diagnostics logs console localhost dapps auto approve auto sign cache password miner url',
            kind: 'internal-drill',
            Component: DeveloperModeSection,
            props: { onNavigateToMint },
            summary: developerSummary(settings),
        },
        {
            id: 'about',
            title: 'About',
            description: 'View version, license, build verification, release signature, and diagnostic details.',
            keywords: 'about version update channel check new versions license notice repro reproducible build verify verification release signatures gpg fingerprint disclosure policy security diagnostics copy preview',
            kind: 'internal-drill',
            Component: AboutSection,
            summary: WALLET_VERSION,
        },
    ]), [walletLabel, accountLabel, onOpenWalletPicker, onOpenAccountPicker, activeWallet, settings, siteCount, onNavigateToMint, handleWalletRemoved, reload]);

    // List-view filter. Hoisted ABOVE the subpage early-return so that
    // both render paths call the same number of hooks; flipping
    // `subpageId` from null to a section id used to drop a useMemo
    // call from the second render, tripping React's
    // "Rendered fewer hooks than expected" guard.
    const filtered = useMemo(() => {
        const q = normalizeSearchText(query);
        if (!q) return sections;
        return sections.filter((s) => {
            if (s.visible === false) return false;
            const searchable = normalizeSearchText([
                s.title,
                s.description,
                s.keywords,
                s.searchTerms,
                s.summary,
            ].filter(Boolean).join(' '));
            return q.split(' ').every((term) => searchable.includes(term));
        });
    }, [sections, query]);

    // ─── Subpage view ─────────────────────────────────────────────

    if (subpageId) {
        const section = sections.find((s) => s.id === subpageId);
        if (section && section.kind === 'internal-drill' && section.Component) {
            const SectionComponent = section.Component;
            const subpageHeader = (
                <PageHeader
                    onBack={() => setSubpageId(null)}
                    backDisabled={section.id === 'this-wallet' && walletManagementBusy}
                    backLabel="Back to settings"
                    title={section.title}
                    trailing={section.id === 'backup' && onOpenBackupInTab ? (
                        <Button variant="ghost" size="sm" onClick={onOpenBackupInTab}>Open in tab</Button>
                    ) : null}
                />
            );
            return (
                <Screen variant={variant} header={subpageHeader}>
                    <ListPage className={settingsStyles.page} data-settings-layout="responsive">
                        <SectionComponent
                            key={section.id === 'this-wallet' ? activeWallet?.id || 'none' : section.id}
                            {...(section.props || {})}
                        />
                    </ListPage>
                </Screen>
            );
        }
        // Fallback for stale subpageId: return to list
        setSubpageId(null);
    }

    // ─── List view ────────────────────────────────────────────────

    const header = <PageHeader onBack={onBack} title="Settings" />;

    return (
        <Screen variant={variant} header={header}>
            <ListPage
                className={settingsStyles.page}
                data-settings-layout="responsive"
                toolbar={(
                    <input
                        type="search"
                        enterKeyHint="search"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search settings…"
                        aria-label="Search settings"
                        style={{
                            width: '100%',
                            padding: 'var(--xc-space-2) var(--xc-space-3)',
                            background: 'var(--xc-surface-raised)',
                            border: '1px solid var(--xc-border)',
                            borderRadius: 'var(--xc-radius-md)',
                            color: 'var(--xc-text)',
                            fontSize: 'var(--xc-text-md)',
                        }}
                    />
                )}
            >
                {filtered.length === 0 ? (
                    <EmptyState title="No matching settings" body={`No settings match "${query}".`} />
                ) : null}
                {filtered.map((section) => {
                    if (section.kind === 'external-drill') {
                        if (section.visible === false) return null;
                        return (
                            <DrillRow
                                key={section.id}
                                title={section.title}
                                summary={section.summary}
                                onClick={section.onOpen}
                            />
                        );
                    }
                    if (section.kind === 'internal-drill' && section.Component) {
                        return (
                            <DrillRow
                                key={section.id}
                                title={section.title}
                                summary={section.summary}
                                onClick={() => setSubpageId(section.id)}
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
                                <Component {...panelProps} />
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
            </ListPage>
        </Screen>
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

function DrillRow({ title, summary, onClick }) {
    return (
        <button
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)', marginBottom: 'var(--xc-space-3)' }}>
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
        <div style={{
            padding: 'var(--xc-space-3) var(--xc-space-4)',
            background: 'var(--xc-surface-raised)',
            border: '1px dashed var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
            color: 'var(--xc-text-muted)',
            fontSize: 'var(--xc-text-sm)',
            fontStyle: 'italic',
        }}>
            Coming soon
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
    return `${onCount} of ${offByDefault.length + onByDefault.length} on`;
}

function safetySummary(settings) {
    if (!settings) return '-';
    const mins = settings.autolockMinutes;
    if (mins === 0) return 'Auto-lock off';
    return `Auto-lock ${mins} min`;
}

function displaySummary(settings) {
    if (!settings) return '-';
    const pinned = Array.isArray(settings.pinnedTokens) ? settings.pinnedTokens.length : 0;
    const hidden = Array.isArray(settings.hiddenTokens) ? settings.hiddenTokens.length : 0;
    const parts = [];
    if (pinned > 0) parts.push(`${pinned} pinned`);
    if (hidden > 0) parts.push(`${hidden} hidden`);
    if (settings.privacy?.hideSmallBalances === true) {
        const threshold = settings.smallBalanceThreshold || SMALL_BALANCE_THRESHOLD_DEFAULT;
        parts.push(threshold === 'dust' ? 'Dust hidden' : `<${threshold} hidden`);
    }
    if ((settings.numberFormat || NUMBER_FORMAT_DEFAULT) !== NUMBER_FORMAT_DEFAULT) {
        parts.push(settings.numberFormat === 'trim' ? 'Trimmed numbers' : 'Plain numbers');
    }
    if (parts.length === 0) return 'No customization';
    return parts.join(' · ');
}

function keyboardSummary(settings) {
    if (!settings) return '-';
    const n = resolveBindings(settings.keyboard?.bindings).filter((shortcut) => shortcut.overridden).length;
    return n === 0 ? 'Defaults' : `${n} custom`;
}

function walletModeSummary(settings) {
    if (!settings) return '-';
    const mode = settings.walletMode || WALLET_MODE_DEFAULT;
    if (mode === 'full') return 'Normal';
    if (mode === 'watcher') return 'Watcher (watch-only)';
    if (mode === 'signer') return 'Signer (air-gapped)';
    return mode;
}

function feesSummary(settings) {
    if (!settings) return '-';
    const fees = settings.fees || {};
    const chainIds = Object.keys(fees);
    if (chainIds.length === 0) return 'No chains';
    const customCount = chainIds.filter((id) => fees[id]?.strategy === 'custom').length;
    if (customCount === 0) return 'All defaults';
    if (customCount === chainIds.length) return 'All custom';
    return `${customCount} of ${chainIds.length} custom`;
}

function endpointsSummary(settings) {
    if (!settings) return '-';
    const eps = settings.sdkEndpoints || {};
    const customCount = Object.values(eps).filter((e) => e?.custom).length;
    if (customCount === 0) return 'All defaults';
    return `${customCount} chain${customCount === 1 ? '' : 's'} custom`;
}

function adsSummary(settings) {
    if (!settings) return '-';
    if (!settings.ads?.enabled) return 'Off';
    const total = Object.values(settings.ads.perChain || {})
        .reduce((s, c) => s + (Number(c?.lifetimeDonatedSats) || 0), 0);
    if (total === 0) return 'On · 0 donated';
    return `On · ${total.toLocaleString()} sats donated`;
}

function developerSummary(settings) {
    if (!settings) return 'Off';
    return settings.developerMode ? 'On' : 'Off';
}

function connectedSitesSummary(siteCount) {
    if (siteCount === null) return '-';
    if (siteCount === 0) return 'None';
    return `${siteCount} site${siteCount === 1 ? '' : 's'}`;
}
