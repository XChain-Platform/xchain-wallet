// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A connected site's icon is page-controlled display data. The content
// script draws it to PNG inside the page, but the background must not trust
// that: bridge.connect re-checks `siteIcon` and passes only a small PNG data
// URL to the approval prompt and the stored record. Anything else (SVG, a
// URL the wallet would have to fetch, markup, an oversized image) becomes
// null, and one site's connect can never write another site's record.

import { describe, it, expect } from 'vitest';
import { MessageHost } from '../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../packages/extension/src/bridge/handlers.js';
import { pngDataUrl, pngBytes } from '../helpers/siteIconFixtures.js';

// The approval grants one known chain: a decision with no valid chain is refused.
const CHAIN = 'bitcoin-mainnet';
const chainRegistry = { get: (id) => (id === CHAIN ? { id: CHAIN } : null), supportedChains: () => [] };

function fakeVault(initial = []) {
    const sites = new Map(initial.map((s) => [s.id, s]));
    return {
        _sites: sites,
        settings: { get: async () => ({ developerMode: false, autoApproveLocalhost: false, fees: {} }) },
        accounts: { list: async () => [{ id: 'acct-1', name: 'Account 1' }] },
        connectedSites: {
            findBy: async (field, value) => [...sites.values()].filter((s) => s[field] === value),
            put: async (s) => { sites.set(s.id, s); return s; },
            update: async (id, decide) => {
                const next = decide(sites.get(id) ?? null);
                if (next == null) return false;
                sites.set(next.id, next);
                return true;
            },
            delete: async (id) => { sites.delete(id); },
        },
    };
}

function approvalsSpy() {
    const calls = [];
    return {
        calls,
        connect: async (req) => {
            calls.push(req);
            return { approved: true, chains: [CHAIN], accounts: ['acct-1'], canSignMessage: false, canSignAction: {} };
        },
    };
}

async function connect(vault, approvals, request) {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host, { approvals });
    return host.handle({ type: 'bridge.connect', request });
}

const hostile = [
    ['an SVG data URL', 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+'],
    ['an SVG text data URL', 'data:image/svg+xml,<svg onload=alert(1)>'],
    ['a remote URL the wallet would fetch', 'https://tracker.example/pixel.png'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['markup', '<img src=x onerror=alert(1)>'],
    ['a JPEG data URL', `data:image/jpeg;base64,${pngBytes().toString('base64')}`],
    ['a PNG prefix over a non-PNG payload', `data:image/png;base64,${Buffer.from('<html><script>alert(1)</script></html>').toString('base64')}`],
    ['a PNG over 32 KB', pngDataUrl(64, 64, 40 * 1024)],
    ['a PNG over 128 px', pngDataUrl(512, 512)],
    ['a non-string', { toString: () => pngDataUrl() }],
];

describe('bridge.connect validates the captured site icon', () => {
    for (const [label, siteIcon] of hostile) {
        it(`drops ${label}`, async () => {
            const vault = fakeVault();
            const approvals = approvalsSpy();
            const result = await connect(vault, approvals, {
                origin: 'https://dapp.example', appName: 'dApp', siteIcon,
            });
            expect(result.ok).toBe(true);
            expect(approvals.calls[0].icon).toBeNull();
            const [site] = [...vault._sites.values()];
            expect(site.icon).toBeNull();
            expect(site.iconCapturedAt).toBeNull();
        });
    }

    it('stores a valid PNG on approval and shows it in the prompt', async () => {
        const vault = fakeVault();
        const approvals = approvalsSpy();
        const icon = pngDataUrl(128, 128, 4000);
        await connect(vault, approvals, { origin: 'https://dapp.example', appName: 'dApp', siteIcon: icon });
        expect(approvals.calls[0].icon).toBe(icon);
        const [site] = [...vault._sites.values()];
        expect(site.icon).toBe(icon);
        expect(Number.isFinite(Date.parse(site.iconCapturedAt))).toBe(true);
    });

    it('never copies the raw declared appIcon into the stored icon', async () => {
        const vault = fakeVault();
        const approvals = approvalsSpy();
        await connect(vault, approvals, {
            origin: 'https://dapp.example', appName: 'dApp', appIcon: pngDataUrl(),
        });
        expect(approvals.calls[0].icon).toBeNull();
        expect([...vault._sites.values()][0].icon).toBeNull();
    });

    it("one site's connect leaves another site's record untouched", async () => {
        const victimIcon = pngDataUrl(64, 64, 100);
        const victim = {
            schemaVersion: 1,
            id: 'victim',
            origin: 'https://bank-dapp.example',
            appName: 'Bank dApp',
            appIcon: '',
            icon: victimIcon,
            iconCapturedAt: '2026-01-01T00:00:00.000Z',
            connectedAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-01-01T00:00:00.000Z',
            permissions: { chains: [], accounts: ['acct-1'], canSignMessage: false, canSignAction: {} },
            sessionHistory: [],
        };
        const vault = fakeVault([victim]);
        const approvals = approvalsSpy();
        // The attacker names the victim's app and sends its own icon; the
        // record is keyed by the sender-bound origin, so it gets a record of
        // its own and the victim's icon is unchanged.
        await connect(vault, approvals, {
            origin: 'https://evil.example', appName: 'Bank dApp', siteIcon: pngDataUrl(32, 32, 100),
        });
        expect(vault._sites.get('victim')).toEqual(victim);
        const attacker = [...vault._sites.values()].find((s) => s.origin === 'https://evil.example');
        expect(attacker.icon).toBe(pngDataUrl(32, 32, 100));
    });
});
