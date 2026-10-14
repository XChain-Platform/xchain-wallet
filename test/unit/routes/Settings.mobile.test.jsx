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
const onboardingCss = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Onboarding.module.css'),
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

const INLINE_SECTIONS = [
    'Appearance',
    'Language & region',
    'Network',
    'Notifications',
    'Contacts',
];

const DRILLDOWN_SECTIONS = [
    ['this-wallet', 'This wallet', () => screen.getByRole('button', { name: 'Remove…' })],
    ['display', 'Display', () => screen.getByRole('button', { name: 'Reset to defaults' })],
    ['privacy', 'Privacy', () => screen.getByRole('spinbutton', { name: 'Clipboard auto-clear seconds' })],
    ['safety', 'Safety', () => screen.getByRole('button', { name: 'Activate' })],
    ['wallet-mode', 'Wallet mode', () => screen.getByRole('radio', { name: /Normal/ })],
    ['backup', 'Backup', () => screen.getByRole('button', { name: 'Export…' })],
    ['fees', 'Fees', () => screen.getByRole('combobox', { name: 'Bitcoin fee strategy' })],
    ['network-endpoints', 'Network & endpoints', () => screen.getAllByRole('textbox', { name: 'Explorer URL' })[0]],
    ['connected-sites', 'Connected sites', () => screen.findByRole('button', { name: 'Disconnect' })],
    ['ads', 'Automatic donation system', () => screen.getByRole('switch', { name: 'Turn on Automatic Donation System' })],
    ['developer', 'Developer mode', () => screen.getByRole('switch', { name: 'Turn on developer mode' })],
    ['about', 'About', () => screen.getByRole('button', { name: 'Copy diagnostics' })],
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

        await screen.findByText('Primary Wallet');
        for (const section of INLINE_SECTIONS) {
            expect(screen.getByRole('heading', { name: section })).toBeVisible();
        }
        expect(screen.getByRole('button', { name: /Accounts & addresses/ })).toBeVisible();
        expect(screen.getByRole('button', { name: /Automatic donation system/ })).toBeVisible();
        expect(screen.queryByRole('button', { name: /^Keyboard/ })).toBeNull();
        expectNoFixedWidthOverflow(container);
    });

    it('keeps placeholder prose and onboarding choices readable without forced word breaks', () => {
        settings = seedSettingsForChains(settings, defaultRegistry(), ['bitcoin-mainnet']);
        const { container } = renderSettings('ads');
        // The visible placeholder is short; the full explanation stays in its accessible description.
        const placeholder = screen.getByText('Not available yet.');
        expect(placeholder).toHaveAttribute('aria-description', expect.stringMatching(/A donation address for Bitcoin arrives/));

        expect(placeholder.style.fontFamily).toBe('inherit');
        expect(placeholder.style.wordBreak).toBe('normal');
        expect(placeholder.style.overflowWrap).toBe('break-word');
        expect(container).toContainElement(placeholder);
        // The word-count choice is the kit RadioGroup; its option copy wraps instead of overflowing.
        expect(radioGroupCss).toMatch(/\.option\s*\{[^}]*minmax\(0, 1fr\)/s);
        expect(radioGroupCss).toMatch(/\.label\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
        expect(createWalletCss).toMatch(/\.wordCountRow\s*\{[^}]*min-width:\s*0;/s);
        expect(onboardingCss).toMatch(/\.licenseParagraph\s*\{[^}]*text-align:\s*start;[^}]*hyphens:\s*none;/s);
    });

    it('clears the previous route before reloading into a different network', async () => {
        const messaging = buildMessaging();
        const reload = vi.fn();
        messaging.setActiveNetwork = vi.fn().mockResolvedValue({ settings: { activeNetwork: 'testnet' } });
        writeLastView('wallet-1', 'contacts');
        renderSettings(null, { messaging, reload });

        fireEvent.change(screen.getByRole('combobox', { name: 'Active network' }), {
            target: { value: 'testnet' },
        });
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

    it('keeps destructive actions rendered in narrow sections', async () => {
        renderSettings('this-wallet');
        expect(screen.getByRole('button', { name: 'Remove…' })).toBeVisible();
        cleanup();

        renderSettings('safety');
        expect(screen.getByRole('button', { name: 'Activate' })).toBeVisible();
        cleanup();

        renderSettings('connected-sites');
        expect(await screen.findByRole('button', { name: 'Disconnect' })).toBeVisible();
        expect(screen.getAllByRole('button', { name: 'Block' })[0]).toBeVisible();
        cleanup();

        renderSettings('developer');
        expect(await screen.findByRole('button', { name: 'Remove custom chain fork-regtest' })).toBeVisible();
    });

    it('keeps equal contact actions together in a wrapping row at 360px', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
        const messaging = buildMessaging();
        messaging.listContacts.mockResolvedValue([{ id: 'contact-1' }]);
        renderSettings(null, { messaging });

        await screen.findByText('1 contact stored');
        const copy = screen.getByText('Export and import', { selector: 'span' }).parentElement;
        const row = copy.parentElement;
        const buttons = [
            screen.getByRole('button', { name: 'Export…' }),
            screen.getByRole('button', { name: 'Export CSV…' }),
            screen.getByRole('button', { name: 'Import…' }),
        ];
        const actions = buttons[0].parentElement;

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
