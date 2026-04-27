import { useMemo, useState } from 'react';
import { Screen, Icon } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { AboutSection } from '../components/settings/AboutSection.jsx';
import { AdsSection } from '../components/settings/AdsSection.jsx';
import { AppearanceSection } from '../components/settings/AppearanceSection.jsx';
import { BackupSection } from '../components/settings/BackupSection.jsx';
import { ConnectedSitesSection } from '../components/settings/ConnectedSitesSection.jsx';
import { ContactsSection } from '../components/settings/ContactsSection.jsx';
import { DeveloperModeSection } from '../components/settings/DeveloperModeSection.jsx';
import { LanguageRegionSection } from '../components/settings/LanguageRegionSection.jsx';
import { PrivacySection } from '../components/settings/PrivacySection.jsx';
import { FeesSection } from '../components/settings/FeesSection.jsx';
import { NetworkEndpointsSection } from '../components/settings/NetworkEndpointsSection.jsx';
import { NotificationsSection } from '../components/settings/NotificationsSection.jsx';
import { SafetySection } from '../components/settings/SafetySection.jsx';
import { ThisWalletSection } from '../components/settings/ThisWalletSection.jsx';
import styles from './ActionsMenu.module.css';
import pickerStyles from './WalletPicker.module.css';

/**
 * Settings page — §35. Long sectioned layout with a search input at the
 * top and one section per spec §35.1 group, in spec order.
 *
 * Sections fall into three states:
 *
 *   1. Built — drills into an existing picker / form (This Wallet,
 *      Accounts & Addresses).
 *   2. Stub — section heading is rendered, body shows a muted
 *      "Coming soon" hint. These will be filled in across the
 *      Settings build's later steps; the scaffold lives here so the
 *      user can see the intended shape.
 *   3. Search — input is non-functional in this scaffold; will be
 *      wired in a later step (§35.2).
 *
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {{ id: string, name: string } | null} [props.activeWallet]
 * @param {{ id: string, name: string, index: number } | null} [props.activeAccount]
 * @param {() => void} [props.onOpenWalletPicker]
 * @param {() => void} [props.onOpenAccountPicker]
 */
export function Settings({
    onBack,
    activeWallet,
    activeAccount,
    onOpenWalletPicker,
    onOpenAccountPicker,
}) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [query, setQuery] = useState('');

    const walletLabel = activeWallet?.name || 'No wallet';
    const accountLabel = activeAccount?.name
        || (Number.isInteger(activeAccount?.index) ? `Account ${activeAccount.index + 1}` : 'Account 1');

    const header = (
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
            <span className={pickerStyles.title}>Settings</span>
            <span />
        </div>
    );

    const sections = useMemo(() => /** @type {SectionDef[]} */ ([
        {
            id: 'this-wallet',
            title: 'This Wallet',
            description: 'Wallet name, remove wallet, migrate to BIP39.',
            keywords: 'wallet name remove rename migrate bip39 delete destroy',
            kind: 'panel',
            Component: ThisWalletSection,
            props: { activeWallet, onOpenWalletPicker },
        },
        {
            id: 'accounts-addresses',
            title: 'Accounts & Addresses',
            description: 'Active account, change addresses, signer pairing.',
            keywords: 'account address signer change addresses',
            kind: 'drill',
            visible: Boolean(onOpenAccountPicker && activeWallet),
            label: accountLabel,
            onOpen: onOpenAccountPicker,
        },
        {
            id: 'appearance',
            title: 'Appearance',
            description: 'Theme, accent color, reduced motion.',
            keywords: 'appearance theme color motion accent dark light',
            kind: 'panel',
            Component: AppearanceSection,
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
            description: 'Tor, change-address rotation, hide small balances.',
            keywords: 'privacy tor rotation hide balances labels',
            kind: 'panel',
            Component: PrivacySection,
        },
        {
            id: 'safety',
            title: 'Safety',
            description: 'Auto-lock, undo-send, panic mode, backup reminders.',
            keywords: 'safety autolock auto lock undo panic backup',
            kind: 'panel',
            Component: SafetySection,
        },
        {
            id: 'backup',
            title: 'Backup',
            description: 'Seed phrase, dry-run restore, encrypted backup file.',
            keywords: 'backup seed phrase restore encrypted file labels',
            kind: 'panel',
            Component: BackupSection,
            props: { activeWallet },
        },
        {
            id: 'fees',
            title: 'Fees',
            description: 'Per-chain fee strategy, RBF defaults.',
            keywords: 'fees fee strategy rbf chain',
            kind: 'panel',
            Component: FeesSection,
        },
        {
            id: 'network-endpoints',
            title: 'Network & Endpoints',
            description: 'Per-chain explorer, encoder, and hub URLs.',
            keywords: 'network endpoints explorer encoder hub url chain registry',
            kind: 'panel',
            Component: NetworkEndpointsSection,
        },
        {
            id: 'notifications',
            title: 'Notifications',
            description: 'Confirmations, receipts, dispenser fills, order fills, price alerts.',
            keywords: 'notifications confirmations receipts dispenser order price alert',
            kind: 'panel',
            Component: NotificationsSection,
        },
        {
            id: 'connected-sites',
            title: 'Connected Sites',
            description: 'dApp connections and per-site permissions.',
            keywords: 'connected sites dapp permissions origin',
            kind: 'panel',
            Component: ConnectedSitesSection,
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
            kind: 'panel',
            Component: AdsSection,
        },
        {
            id: 'keyboard',
            title: 'Keyboard Shortcuts',
            description: 'Rebind global shortcuts.',
            keywords: 'keyboard shortcuts rebind hotkey',
            kind: 'stub',
        },
        {
            id: 'developer',
            title: 'Developer Mode',
            description: 'Custom endpoints, regtest networks, raw PSBT inspector.',
            keywords: 'developer mode regtest custom endpoints psbt raw',
            kind: 'panel',
            Component: DeveloperModeSection,
        },
        {
            id: 'about',
            title: 'About',
            description: 'Version, license, reproducible build verification, release signatures.',
            keywords: 'about version license repro reproducible signatures release security',
            kind: 'panel',
            Component: AboutSection,
        },
    ]), [walletLabel, accountLabel, onOpenWalletPicker, onOpenAccountPicker, activeWallet, activeAccount]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return sections;
        return sections.filter((s) =>
            s.title.toLowerCase().includes(q)
            || s.description.toLowerCase().includes(q)
            || s.keywords.toLowerCase().includes(q),
        );
    }, [sections, query]);

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
                    if (section.kind === 'drill') {
                        if (!section.visible) return null;
                        return (
                            <SettingsSection
                                key={section.id}
                                title={section.title}
                                description={section.description}
                            >
                                <button
                                    type="button"
                                    className={styles.entry}
                                    style={{ width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                                    onClick={section.onOpen}
                                >
                                    <span className={styles.entryLabel}>{section.label}</span>
                                    <span aria-hidden="true" style={{ color: 'var(--xc-text-muted)', display: 'inline-flex' }}><Icon.ForwardIcon /></span>
                                </button>
                            </SettingsSection>
                        );
                    }
                    if (section.kind === 'panel' && section.Component) {
                        const Component = section.Component;
                        const panelProps = section.props || {};
                        return (
                            <SettingsSection
                                key={section.id}
                                title={section.title}
                                description={section.description}
                            >
                                <Component {...panelProps} />
                            </SettingsSection>
                        );
                    }
                    return (
                        <SettingsSection
                            key={section.id}
                            title={section.title}
                            description={section.description}
                        >
                            <ComingSoon />
                        </SettingsSection>
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
 *   kind: 'drill' | 'stub' | 'panel',
 *   visible?: boolean,
 *   label?: string,
 *   onOpen?: () => void,
 *   Component?: (props?: any) => any,
 *   props?: Record<string, unknown>,
 * }} SectionDef
 */

function SettingsSection({ title, description, children }) {
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
