// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';

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
    ['keyboard', 'Keyboard', () => screen.getByRole('button', { name: 'Reset all shortcuts' })],
    ['privacy', 'Privacy', () => screen.getByRole('spinbutton', { name: 'Clipboard auto-clear seconds' })],
    ['safety', 'Safety', () => screen.getByRole('button', { name: 'Activate' })],
    ['wallet-mode', 'Wallet mode', () => screen.getByRole('radio', { name: /Normal/ })],
    ['backup', 'Backup', () => screen.getByRole('button', { name: 'Export…' })],
    ['fees', 'Fees', () => screen.getByRole('combobox', { name: 'Bitcoin fee strategy' })],
    ['network-endpoints', 'Network & endpoints', () => screen.getAllByRole('textbox', { name: 'Explorer URL' })[0]],
    ['connected-sites', 'Connected sites', () => screen.findByRole('button', { name: 'Disconnect' })],
    ['ads', 'Automatic donation system', () => screen.getByRole('switch', { name: 'Automatic Donation System' })],
    ['developer', 'Developer mode', () => screen.getByRole('switch', { name: 'Developer Mode' })],
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

function renderSettings(initialSubpageId = null) {
    const messaging = buildMessaging();
    return render(
        <MessagingContext.Provider value={{ shell: 'popup', messaging }}>
            <Settings
                onBack={() => {}}
                activeWallet={{ id: 'wallet-1', name: 'Primary Wallet' }}
                activeAccount={{ id: 'account-1', name: 'Daily', index: 0 }}
                onOpenWalletPicker={() => {}}
                onOpenAccountPicker={() => {}}
                initialSubpageId={initialSubpageId}
                reload={() => {}}
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
        expectNoFixedWidthOverflow(container);
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

    it('stacks wide controls and clamps actions at the narrow breakpoint', () => {
        const narrow = mediaBlock(settingsCss, '(max-width: 480px)');

        expect(narrow).toMatch(/:is\([\s\S]*select,[\s\S]*textarea,[\s\S]*input:not/);
        expect(narrow).toMatch(/flex:\s*1 1 100% !important;[\s\S]*width:\s*100% !important;/);
        expect(narrow).toMatch(/\.page button\s*\{[\s\S]*max-width:\s*100%;/);
        expect(narrow).toMatch(/\.drillLabel\s*\{[\s\S]*flex:\s*1 1 100%;/);
        expect(narrow).toMatch(/\.drillSummary\s*\{[\s\S]*justify-content:\s*flex-start !important;/);
    });
});
