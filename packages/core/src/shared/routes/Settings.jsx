// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import { Screen, PageHeader, Icon } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
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
import { WALLET_MODE_DEFAULT } from '../../schemas/settings.js';
import styles from './ActionsMenu.module.css';

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
 */
export function Settings({
    onBack,
    activeWallet,
    activeAccount,
    onOpenWalletPicker,
    onOpenAccountPicker,
    initialSubpageId = null,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [query, setQuery] = useState('');
    const [subpageId, setSubpageId] = useState(/** @type {string | null} */ (initialSubpageId || null));
    const [siteCount, setSiteCount] = useState(/** @type {number | null} */ (null));

    const { settings } = useSettings();

    useEffect(() => {
        let alive = true;
        if (typeof messaging?.listConnectedSites !== 'function') return undefined;
        messaging.listConnectedSites()
            .then((list) => { if (alive) setSiteCount(Array.isArray(list) ? list.length : 0); })
            .catch(() => { if (alive) setSiteCount(0); });
        return () => { alive = false; };
    }, [messaging]);

    const walletLabel = activeWallet?.name || 'No wallet';
    const accountLabel = activeAccount?.name
        || (Number.isInteger(activeAccount?.index) ? `Account ${activeAccount.index + 1}` : 'Account 1');

    const sections = useMemo(() => /** @type {SectionDef[]} */ ([
        {
            id: 'this-wallet',
            title: 'This Wallet',
            description: 'Wallet name, switch / rename, remove wallet.',
            keywords: 'wallet name remove rename migrate bip39 delete destroy',
            kind: 'internal-drill',
            Component: ThisWalletSection,
            props: { activeWallet, onOpenWalletPicker },
            summary: walletLabel,
        },
        {
            id: 'accounts-addresses',
            title: 'Accounts & Addresses',
            description: 'Active account, change addresses, signer pairing.',
            keywords: 'account address signer change addresses',
            kind: 'external-drill',
            visible: Boolean(onOpenAccountPicker && activeWallet),
            onOpen: onOpenAccountPicker,
            summary: accountLabel,
        },
        {
            id: 'appearance',
            title: 'Appearance',
            description: 'Theme, accent color, reduced motion.',
            keywords: 'appearance theme color motion accent dark light reduced',
            kind: 'panel',
            Component: AppearanceSection,
        },
        {
            id: 'display',
            title: 'Display',
            description: 'Pinned and hidden tokens: reorder pinned, bulk-unhide hidden.',
            keywords: 'display pinned hidden tokens reorder unhide bulk star',
            kind: 'internal-drill',
            Component: DisplaySection,
            summary: displaySummary(settings),
        },
        {
            id: 'keyboard',
            title: 'Keyboard',
            description: 'Keyboard shortcuts: view and rebind.',
            keywords: 'keyboard shortcuts rebind keys hotkeys bindings palette',
            kind: 'internal-drill',
            Component: KeyboardSection,
            summary: keyboardSummary(settings),
        },
        {
            id: 'language-region',
            title: 'Language & Region',
            description: 'Language, currency.',
            keywords: 'language region currency fiat locale',
            kind: 'panel',
            Component: LanguageRegionSection,
        },
        {
            id: 'privacy',
            title: 'Privacy',
            description: 'Tor, change-address rotation, hide small balances, blur on blur, labels survive restore.',
            keywords: 'privacy tor rotation hide balances labels blur',
            kind: 'internal-drill',
            Component: PrivacySection,
            summary: privacySummary(settings),
        },
        {
            id: 'safety',
            title: 'Safety',
            description: 'Auto-lock, undo-send, test-send threshold, panic mode, backup reminders.',
            keywords: 'safety autolock auto lock undo panic backup reminders',
            kind: 'internal-drill',
            Component: SafetySection,
            summary: safetySummary(settings),
        },
        {
            id: 'wallet-mode',
            title: 'Wallet Mode',
            description: 'Full / Watcher (watch-only) / Signer (air-gapped). Pairs of watcher + signer wallets enable transaction-via-QR signing.',
            keywords: 'wallet mode full watcher watch only signer air gapped psbt cold storage',
            kind: 'internal-drill',
            Component: WalletModeSection,
            summary: walletModeSummary(settings),
        },
        {
            id: 'backup',
            title: 'Backup',
            description: 'Seed phrase, dry-run restore, encrypted backup file.',
            keywords: 'backup seed phrase restore encrypted file labels export',
            kind: 'internal-drill',
            Component: BackupSection,
            props: { activeWallet },
            summary: 'Encrypted file export',
        },
        {
            id: 'fees',
            title: 'Fees',
            description: 'Per-chain fee strategy, RBF defaults.',
            keywords: 'fees fee strategy rbf chain custom',
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
                ? 'Choose Mainnet, Testnet, or Regtest. Filters every visible chain and stops queries to the inactive networks. The page reloads on change.'
                : 'Choose Mainnet or Testnet. Filters every visible chain and stops queries to the inactive networks. The page reloads on change.',
            keywords: settings?.developerMode
                ? 'network mainnet testnet regtest active filter chain switch mode dev'
                : 'network mainnet testnet active filter chain switch mode',
            kind: 'panel',
            Component: NetworkSection,
        },
        {
            id: 'network-endpoints',
            title: 'Network & Endpoints',
            description: 'Per-chain explorer, encoder, and hub URLs.',
            keywords: 'network endpoints explorer encoder hub url chain registry',
            kind: 'internal-drill',
            Component: NetworkEndpointsSection,
            summary: endpointsSummary(settings),
        },
        {
            id: 'notifications',
            title: 'Notifications',
            description: 'Confirmations, receipts, dispenser fills, order fills, price alerts.',
            keywords: 'notifications confirmations receipts dispenser order price alert',
            kind: 'panel',
            Component: NotificationsSection,
            props: { walletId: activeWallet?.id },
        },
        {
            id: 'connected-sites',
            title: 'Connected Sites',
            description: 'dApp connections and per-site permissions.',
            keywords: 'connected sites dapp permissions origin disconnect',
            kind: 'internal-drill',
            Component: ConnectedSitesSection,
            summary: connectedSitesSummary(siteCount),
        },
        {
            id: 'contacts',
            title: 'Contacts',
            description: 'Export and import the address book.',
            keywords: 'contacts address book export import',
            kind: 'panel',
            Component: ContactsSection,
        },
        {
            id: 'ads',
            title: 'Automatic Donation System',
            description: 'Toggle ADS, per-chain amounts and thresholds, lifetime stats.',
            keywords: 'donation ads automatic per chain amount threshold lifetime',
            kind: 'internal-drill',
            Component: AdsSection,
            summary: adsSummary(settings),
        },
        {
            id: 'developer',
            title: 'Developer Mode',
            description: 'Custom endpoints, regtest networks, raw PSBT inspector.',
            keywords: 'developer mode regtest custom endpoints psbt raw learn',
            kind: 'internal-drill',
            Component: DeveloperModeSection,
            summary: developerSummary(settings),
        },
        {
            id: 'about',
            title: 'About',
            description: 'Version, license, reproducible build verification, release signatures.',
            keywords: 'about version license repro reproducible signatures release security',
            kind: 'internal-drill',
            Component: AboutSection,
            summary: WALLET_VERSION,
        },
    ]), [walletLabel, accountLabel, onOpenWalletPicker, onOpenAccountPicker, activeWallet, settings, siteCount]);

    // List-view filter. Hoisted ABOVE the subpage early-return so that
    // both render paths call the same number of hooks; flipping
    // `subpageId` from null to a section id used to drop a useMemo
    // call from the second render, tripping React's
    // "Rendered fewer hooks than expected" guard.
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return sections;
        return sections.filter((s) =>
            s.title.toLowerCase().includes(q)
            || s.description.toLowerCase().includes(q)
            || s.keywords.toLowerCase().includes(q),
        );
    }, [sections, query]);

    // ─── Subpage view ─────────────────────────────────────────────

    if (subpageId) {
        const section = sections.find((s) => s.id === subpageId);
        if (section && section.kind === 'internal-drill' && section.Component) {
            const SectionComponent = section.Component;
            const subpageHeader = (
                <PageHeader
                    onBack={() => setSubpageId(null)}
                    backLabel="Back to settings"
                    title={section.title}
                />
            );
            return (
                <Screen variant={variant} header={subpageHeader}>
                    <div className={styles.listPopup}>
                        <SectionComponent {...(section.props || {})} />
                    </div>
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
            <div className={styles.listPopup}>
                <input
                    type="search"
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
                        marginBottom: 'var(--xc-space-3)',
                    }}
                />
                {filtered.length === 0 ? (
                    <div style={{
                        padding: 'var(--xc-space-4)',
                        textAlign: 'center',
                        color: 'var(--xc-text-muted)',
                        fontSize: 'var(--xc-text-sm)',
                    }}>
                        No settings match "{query}".
                    </div>
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
            </div>
        </Screen>
    );
}

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   description: string,
 *   keywords: string,
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
            className={styles.entry}
            style={{
                width: '100%',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--xc-space-3)',
            }}
            onClick={onClick}
        >
            <span className={styles.entryLabel} style={{ flexShrink: 0 }}>{title}</span>
            <span style={{
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
        <div style={{ marginBottom: 'var(--xc-space-3)' }}>
            <div style={{
                fontSize: 'var(--xc-text-xs)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--xc-text-muted)',
                marginBottom: 'var(--xc-space-1)',
            }}>{title}</div>
            {description ? (
                <div style={{
                    fontSize: 'var(--xc-text-xs)',
                    color: 'var(--xc-text-muted)',
                    marginBottom: 'var(--xc-space-2)',
                    lineHeight: 1.4,
                }}>{description}</div>
            ) : null}
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
    const flags = ['torRouting', 'changeAddressRotation', 'hideSmallBalances', 'blurOnBlur', 'labelsSurviveRestore'];
    const onCount = flags.filter((k) => Boolean(p[k])).length;
    return `${onCount} of ${flags.length} on`;
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
    if (pinned === 0 && hidden === 0) return 'No customization';
    const parts = [];
    if (pinned > 0) parts.push(`${pinned} pinned`);
    if (hidden > 0) parts.push(`${hidden} hidden`);
    return parts.join(' · ');
}

function keyboardSummary(settings) {
    if (!settings) return '-';
    const n = Object.keys(settings.keyboard?.bindings || {}).length;
    return n === 0 ? 'Defaults' : `${n} custom`;
}

function walletModeSummary(settings) {
    if (!settings) return '-';
    const mode = settings.walletMode || WALLET_MODE_DEFAULT;
    if (mode === 'full') return 'Full';
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
