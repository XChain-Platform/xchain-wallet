// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { seedSettingsForChains } from '../../../packages/core/src/flows/seedSettings.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { ContactsSection } from '../../../packages/core/src/shared/components/settings/ContactsSection.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { readLastView, writeLastView } from '../../../packages/core/src/shared/utils/lastViewMemory.js';

let settings;
let update;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));

const { Settings } = await import('../../../packages/core/src/shared/routes/Settings.jsx');

const VIEWPORT_WIDTH = 320;
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const settingsCss = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Settings.module.css'),
    'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');
const createWalletCss = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/CreateWallet.module.css'),
    'utf8',
);
const radioGroupCss = readFileSync(
    join(process.cwd(), 'packages/core/src/ui/RadioGroup.module.css'),
    'utf8',
);
// The license lines are the shared warning lines (WarningCard).
const warningCardCss = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/components/WarningCard.module.css'),
    'utf8',
);

const CONNECTED_SITE = {
    id: 'site-1',
    origin: 'https://wallet.example',
    appName: 'Example wallet app',
    connectedAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: '2026-10-12T00:00:00.000Z',
    permissions: {
        chains: ['bitcoin-mainnet'],
        accounts: ['account-1'],
        canSignMessage: false,
        canSignAction: {},
    },
};

const CUSTOM_CHAIN = {
    id: 'fork-regtest',
    displayName: 'Fork Regtest',
    networkKind: 'regtest',
};

const LANDING_GROUPS = [
    'Wallets',
    'Security',
    'Backup and Recovery',
    'Privacy and Sites',
    'Appearance',
    'Notifications',
    'Network and Fees',
    'Advanced',
];

// Appearance and Network and Fees are lists of rows (G08); their inline
// controls sit on the one-setting pages those rows open.
const INLINE_GROUP_PAGES = [
    ['g-appearance', ['Theme', 'Language', 'Hide small balances']],
    ['g-network', ['Network', 'Fee strategy']],
    ['g-notifications', ['Notifications']],
    // Privacy and Sites changes each setting on its row (2026-11-13).
    ['g-privacy', ['Tor routing', 'Clipboard auto-clear', 'Connected sites', 'Reset privacy settings']],
    // Theme, Language and Fiat Currency are pages of their own (2026-11-14).
    ['appearance-theme', ['Theme']],
    ['appearance-language', ['Language']],
    ['appearance-currency', ['Fiat Currency']],
    ['display-number-format', ['Number Format', 'Sample']],
    ['network-active', ['Network']],
];

const DRILLDOWN_SECTIONS = [
    // The This wallet page is no longer listed; its password part is the Security page's first row.
    ['security-password', 'Wallet Password', () => screen.getByRole('button', { name: /Change/ })],
    // Display's lists are the Tokens page; its switches sit on Appearance rows.
    ['display-tokens', 'Tokens', () => screen.findByRole('button', { name: 'Add watched token' })],
    // The old Privacy page opens Privacy and Sites, where clipboard is a dropdown.
    ['privacy', 'Privacy and Sites', () => screen.getByRole('combobox', { name: 'Clipboard auto-clear' })],
    // The old Safety page opens Security; Panic mode is a chevron row to its own page.
    ['safety', 'Security', () => screen.findByRole('button', { name: /^Panic mode/ })],
    ['backup', 'Backup', () => screen.getByRole('button', { name: 'Export…' })],
    // Fees and Network endpoints list one row per network (G117); the
    // network pages below hold the controls.
    ['fees', 'Fees', () => screen.getByRole('button', { name: /^Bitcoin/ })],
    ['network-endpoints', 'Network & Endpoints', () => screen.getAllByRole('button', { name: /^Bitcoin/ })[0]],
    ['connected-sites', 'Connected Sites', () => screen.findByRole('list', { name: 'Allowed sites' })],
    ['ads', 'Automatic Donations', () => screen.getByRole('combobox', { name: 'Per transaction' })],
    // The old Developer page opens Advanced > Developer options.
    ['developer', 'Developer Options', () => screen.findByRole('switch', { name: 'Show variant popover' })],
    ['about', 'About', () => screen.getByRole('button', { name: /^Copy diagnostics/ })],
];

function pending() {
    return new Promise(() => {});
}

function buildMessaging() {
    const messaging = {
        listConnectedSites: vi.fn().mockResolvedValue([CONNECTED_SITE]),
        listBlockedOrigins: vi.fn().mockResolvedValue([]),
        listBlocklistAuditLog: vi.fn().mockResolvedValue([]),
        listContacts: vi.fn().mockResolvedValue([]),
        listCustomChains: vi.fn().mockResolvedValue({ descriptors: [CUSTOM_CHAIN] }),
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'Primary Wallet' }]),
        getChainRegistryStatus: vi.fn(pending),
        refreshChainRegistry: vi.fn(pending),
        blockOrigin: vi.fn(pending),
        unblockOrigin: vi.fn(pending),
        deleteConnectedSite: vi.fn(pending),
        clearBlocklistAuditLog: vi.fn(pending),
        addCustomChain: vi.fn(pending),
        removeCustomChain: vi.fn(pending),
    };
    return new Proxy(messaging, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(pending);
            target[property] = stub;
            return stub;
        },
    });
}

function renderSettings(initialSubpageId = null, {
    messaging = buildMessaging(),
    reload = () => {},
} = {}) {
    return render(
        <MessagingContext.Provider value={{ shell: 'popup', messaging }}>
            <Settings
                onBack={() => {}}
                activeWallet={{ id: 'wallet-1', name: 'Primary Wallet' }}
                activeAccount={{ id: 'account-1', name: 'Daily', index: 0 }}
                onOpenWalletPicker={() => {}}
                onOpenAccountPicker={() => {}}
                initialSubpageId={initialSubpageId}
                reload={reload}
            />
        </MessagingContext.Provider>,
    );
}

function mediaBlock(text, query) {
    const start = text.indexOf(`@media ${query}`);
    if (start < 0) return '';
    const open = text.indexOf('{', start);
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
        if (text[index] === '{') depth += 1;
        if (text[index] === '}') depth -= 1;
        if (depth === 0) return text.slice(open + 1, index);
    }
    return '';
}

function fixedPixels(value) {
    const match = /^(\d+(?:\.\d+)?)(px|rem)?$/.exec(value.trim());
    if (!match) return null;
    return Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
}

function expectNoFixedWidthOverflow(container) {
    const offenders = [];
    for (const element of container.querySelectorAll('*')) {
        for (const property of ['width', 'minWidth']) {
            const pixels = fixedPixels(element.style[property] || '');
            if (pixels !== null && pixels > VIEWPORT_WIDTH) {
                offenders.push(`${element.tagName.toLowerCase()}.${property}=${element.style[property]}`);
            }
        }
        const widthAttribute = fixedPixels(element.getAttribute('width') || '');
        if (widthAttribute !== null && widthAttribute > VIEWPORT_WIDTH) {
            offenders.push(`${element.tagName.toLowerCase()}.width=${element.getAttribute('width')}`);
        }
    }
    expect(offenders).toEqual([]);
}

beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT_WIDTH });
    settings = {
        ...createDefaultSettings(),
        developerMode: true,
        fees: {
            'bitcoin-mainnet': {
                strategy: 'custom',
                customSatsPerKb: 6000,
                rbfByDefault: true,
            },
        },
        keyboard: { bindings: { 'open-settings': 'mod+o' } },
        sounds: { enabled: true, perKind: {} },
        quietHours: { enabled: true, start: '22:00', end: '08:00' },
    };
    update = vi.fn(async () => settings);
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
});

describe('Settings at a 320px viewport', () => {
    it('renders every inline and external section without a fixed-width overflow', async () => {
        const { container } = renderSettings();

        // The landing is three labelled lists of group rows; each group page
        // holds the inline sections (Appearance, Language & region, Network,
        // Notifications) that used to sit on the landing itself.
        for (const group of LANDING_GROUPS) {
            expect(await screen.findByRole('button', { name: new RegExp(`^${group}`) })).toBeVisible();
        }
        expect(screen.queryByRole('button', { name: /^Keyboard/ })).toBeNull();
        expectNoFixedWidthOverflow(container);
        for (const [groupId, headings] of INLINE_GROUP_PAGES) {
            cleanup();
            const page = renderSettings(groupId);
            for (const heading of headings) {
                expect(screen.getAllByText(heading).length).toBeGreaterThan(0);
            }
            expectNoFixedWidthOverflow(page.container);
        }
    });

    it('keeps the donation page and onboarding choices readable without forced word breaks', () => {
        settings = seedSettingsForChains(settings, defaultRegistry(), ['bitcoin-mainnet']);
        const { container } = renderSettings('ads');
        // One wallet-wide setting: the header's rule and the three inline
        // choices fit a 320px phone, with no per-network address fields.
        expect(screen.getByTestId('ads-hero')).toHaveTextContent('$0.05 per transaction');
        expect(screen.getByRole('combobox', { name: 'Donate to' })).toHaveTextContent('Protocol');
        expect(screen.queryByDisplayValue('1Donate1GERVKPW6GFQcnGeTa8dgL6Abyp')).toBeNull();
        expectNoFixedWidthOverflow(container);
        // Radio option copy (wallet mode) wraps instead of overflowing; the
        // word-count choice is now the shared IconSelect (G44), with no
        // route-local radio box left in CreateWallet.
        expect(radioGroupCss).toMatch(/\.option\s*\{[^}]*minmax\(0, 1fr\)/s);
        expect(radioGroupCss).toMatch(/\.label\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
        expect(createWalletCss).not.toMatch(/\.wordCountRow/);
        expect(warningCardCss).toMatch(/\.paragraph\s*\{[^}]*text-align:\s*start;[^}]*hyphens:\s*none;/s);
    });

    it('clears the previous route before reloading into a different network', async () => {
        const messaging = buildMessaging();
        const reload = vi.fn();
        messaging.setActiveNetwork = vi.fn().mockResolvedValue({ settings: { activeNetwork: 'testnet' } });
        writeLastView('wallet-1', 'contacts');
        renderSettings('network-active', { messaging, reload });

        fireEvent.click(await screen.findByRole('button', { name: 'Select Testnet' }));
        fireEvent.click(screen.getByRole('button', { name: 'Switch network' }));

        await waitFor(() => expect(reload).toHaveBeenCalledOnce());
        expect(readLastView('wallet-1')).toBeNull();
    });

    it.each(DRILLDOWN_SECTIONS)(
        'renders the %s section without a fixed-width overflow',
        async (sectionId, title, findSectionContent) => {
            const { container } = renderSettings(sectionId);

            expect(screen.getByRole('heading', { name: title })).toBeVisible();
            expect(await findSectionContent()).toBeVisible();
            expectNoFixedWidthOverflow(container);
        },
    );

    it('opens a network page from the Fees list, keeps its controls in 320px, and Back returns to the list', async () => {
        const { container } = renderSettings('fees');
        const row = document.querySelector('[data-network-row="bitcoin-mainnet"] button');
        expect(row).toHaveTextContent('Custom rate');
        expect(screen.queryByRole('combobox', { name: 'Bitcoin fee strategy' })).toBeNull();

        fireEvent.click(row);

        expect(screen.getByRole('heading', { name: 'Bitcoin' })).toBeVisible();
        expect(screen.getByRole('combobox', { name: 'Bitcoin fee strategy' })).toBeVisible();
        expect(screen.getByRole('textbox', { name: 'Bitcoin custom fee rate' })).toBeVisible();
        expectNoFixedWidthOverflow(container);

        fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));

        expect(screen.getByRole('heading', { name: 'Fees' })).toBeVisible();
        expect(document.querySelector('[data-network-row="bitcoin-mainnet"]')).not.toBeNull();
        expect(screen.queryByRole('combobox', { name: 'Bitcoin fee strategy' })).toBeNull();
    });

    it('opens a network page from the Network endpoints list, keeps its controls in 320px, and Back returns', async () => {
        const { container } = renderSettings('network-endpoints');
        const row = document.querySelector('[data-network-row="bitcoin-mainnet"] button');
        expect(row).toHaveTextContent('Default endpoint');
        expect(screen.queryAllByRole('textbox', { name: 'Explorer URL' })).toHaveLength(0);

        fireEvent.click(row);

        expect(screen.getByRole('textbox', { name: 'Explorer URL' })).toBeVisible();
        expect(screen.getByRole('textbox', { name: 'Hub URL' })).toBeVisible();
        expectNoFixedWidthOverflow(container);

        fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));

        expect(screen.getByRole('heading', { name: 'Network & Endpoints' })).toBeVisible();
        expect(screen.queryAllByRole('textbox', { name: 'Explorer URL' })).toHaveLength(0);
    });

    it('keeps destructive actions rendered in narrow sections', async () => {
        // Removing a wallet moved to Wallet Details; Settings no longer carries it.
        renderSettings('security-password');
        expect(screen.queryByRole('button', { name: 'Remove…' })).toBeNull();
        cleanup();

        // Panic mode's red Confirm sits on its own page, opened from its row.
        renderSettings('security-panic');
        expect(screen.getByRole('button', { name: 'Confirm 24-Hour Freeze' })).toBeVisible();
        cleanup();

        // A site's Disconnect and Block Site sit on its detail, opened from its row.
        renderSettings('connected-sites');
        fireEvent.click((await screen.findByText('Example wallet app')).closest('button'));
        expect(await screen.findByRole('button', { name: 'Disconnect' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Block Site' })).toBeVisible();
        cleanup();

        // Custom networks joined Test Networks (operator picks 2026-11-14): the
        // old page id lands there, the network's row and Add Network visible;
        // Remove sits on the network's own page.
        renderSettings('developer-custom-chains');
        expect(await screen.findByRole('button', { name: /^Fork Regtest/ })).toBeVisible();
        expect(screen.getByRole('button', { name: /^Add Network/ })).toBeVisible();
    });

    it('keeps equal contact actions together in a wrapping row at 360px', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
        const messaging = buildMessaging();
        messaging.listContacts.mockResolvedValue([{ id: 'contact-1' }]);
        // No Settings group lists the Contacts section any more, so the section
        // is drawn directly to keep its narrow-width layout covered.
        render(
            <MessagingContext.Provider value={{ shell: 'popup', messaging }}>
                <ContactsSection />
            </MessagingContext.Provider>,
        );

        await screen.findByText('1 contact stored');
        const copy = screen.getByText('Export and import', { selector: 'span' }).parentElement;
        const row = copy.parentElement;
        // Import is the standard file field under the export actions.
        const buttons = [
            screen.getByRole('button', { name: 'Export…' }),
            screen.getByRole('button', { name: 'Export CSV…' }),
        ];
        const actions = buttons[0].parentElement;
        const importField = screen.getByLabelText(/^Import contacts \(JSON or CSV/).closest('[data-file-field]');
        expect(importField.parentElement.parentElement).toBe(row);
        expect(importField.parentElement.style.flex).toBe('1 1 100%');

        expect(window.innerWidth).toBe(360);
        expect(row.style.flexWrap).toBe('wrap');
        expect(copy.style.flex).toBe('1 1 280px');
        expect(copy.style.minWidth).toBe('min(100%, 280px)');
        expect(row.firstElementChild).toBe(copy);
        expect(actions.style.flexWrap).toBe('wrap');
        for (const button of buttons) {
            expect(button.parentElement).toBe(actions);
            expect(button.style.flex).toBe('1 0 9.5rem');
        }
    });

    it('stacks wide controls and clamps actions at the narrow breakpoint', () => {
        const narrow = mediaBlock(settingsCss, '(max-width: 480px)');

        expect(narrow).toMatch(/:is\([\s\S]*select,[\s\S]*textarea,[\s\S]*input:not/);
        expect(narrow).toMatch(/flex:\s*1 1 100% !important;[\s\S]*width:\s*100% !important;/);
        expect(narrow).toMatch(/\.page button\s*\{[\s\S]*max-width:\s*100%;/);
        expect(narrow).toMatch(/\.drillLabel\s*\{[\s\S]*flex:\s*1 1 100%;/);
        expect(narrow).toMatch(/\.drillSummary\s*\{[\s\S]*justify-content:\s*flex-start !important;/);
    });
});
