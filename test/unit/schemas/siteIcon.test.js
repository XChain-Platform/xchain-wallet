// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// ConnectedSite.icon: the stored form of a connected site's own icon, its
// validator, and the read-time migration that gives records written before
// site icons existed `icon: null, iconCapturedAt: null`.

import { describe, it, expect } from 'vitest';
import {
    SITE_ICON_MAX_BYTES,
    isSiteIconDataUrl,
    sanitizeSiteIcon,
    siteInitials,
    withSiteIconFields,
} from '../../../packages/core/src/schemas/siteIcon.js';
import {
    createConnectedSite,
    validateConnectedSite,
} from '../../../packages/core/src/schemas/connectedSite.js';
import { migrateConnectedSite } from '../../../packages/core/src/schemas/migrations.js';
import { pngBytes, pngDataUrl } from '../../helpers/siteIconFixtures.js';

const PERMISSIONS = { chains: [], accounts: ['acct-1'], canSignMessage: false, canSignAction: {} };

function legacyRecord(extra = {}) {
    return {
        schemaVersion: 1,
        id: 'site-1',
        origin: 'https://dapp.example',
        appName: 'Example dApp',
        appIcon: 'https://dapp.example/logo.png',
        connectedAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: '2026-01-02T00:00:00.000Z',
        permissions: PERMISSIONS,
        sessionHistory: [],
        ...extra,
    };
}

describe('isSiteIconDataUrl', () => {
    it('accepts a small square PNG data URL', () => {
        expect(isSiteIconDataUrl(pngDataUrl(128, 128))).toBe(true);
        expect(isSiteIconDataUrl(pngDataUrl(32, 32))).toBe(true);
    });

    it('refuses every other type, SVG included', () => {
        const png = pngBytes(64, 64).toString('base64');
        expect(isSiteIconDataUrl(`data:image/svg+xml;base64,${png}`)).toBe(false);
        expect(isSiteIconDataUrl('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(false);
        expect(isSiteIconDataUrl(`data:image/jpeg;base64,${png}`)).toBe(false);
        expect(isSiteIconDataUrl(`data:text/html;base64,${png}`)).toBe(false);
        expect(isSiteIconDataUrl(`DATA:IMAGE/PNG;BASE64,${png}`)).toBe(false);
        expect(isSiteIconDataUrl('https://dapp.example/icon.png')).toBe(false);
        expect(isSiteIconDataUrl('javascript:alert(1)')).toBe(false);
        expect(isSiteIconDataUrl(null)).toBe(false);
        expect(isSiteIconDataUrl(42)).toBe(false);
    });

    it('refuses a payload that is not a PNG or not base64', () => {
        const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]).toString('base64');
        expect(isSiteIconDataUrl(`data:image/png;base64,${gif}`)).toBe(false);
        expect(isSiteIconDataUrl('data:image/png;base64,<img src=x onerror=alert(1)>')).toBe(false);
        expect(isSiteIconDataUrl('data:image/png;base64,')).toBe(false);
        expect(isSiteIconDataUrl(`${pngDataUrl()}"><script>`)).toBe(false);
    });

    it('refuses a PNG over the byte cap or over 128 px on either edge', () => {
        expect(isSiteIconDataUrl(pngDataUrl(64, 64, SITE_ICON_MAX_BYTES))).toBe(true);
        expect(isSiteIconDataUrl(pngDataUrl(64, 64, SITE_ICON_MAX_BYTES + 3))).toBe(false);
        expect(isSiteIconDataUrl(pngDataUrl(129, 128))).toBe(false);
        expect(isSiteIconDataUrl(pngDataUrl(128, 4096))).toBe(false);
        expect(isSiteIconDataUrl(pngDataUrl(0, 64))).toBe(false);
    });

    it('sanitizeSiteIcon keeps a valid icon and nulls everything else', () => {
        const ok = pngDataUrl();
        expect(sanitizeSiteIcon(ok)).toBe(ok);
        expect(sanitizeSiteIcon('https://x.example/i.png')).toBeNull();
        expect(sanitizeSiteIcon(undefined)).toBeNull();
    });
});

describe('ConnectedSite icon fields', () => {
    it('createConnectedSite stores a valid icon with its capture time', () => {
        const icon = pngDataUrl();
        const site = createConnectedSite({
            origin: 'https://dapp.example', appName: 'dApp', icon, permissions: PERMISSIONS,
        });
        expect(site.icon).toBe(icon);
        expect(site.iconCapturedAt).toBe(site.connectedAt);
        expect(validateConnectedSite(site).ok).toBe(true);
    });

    it('createConnectedSite stores null for a missing or invalid icon', () => {
        for (const icon of [undefined, 'https://dapp.example/i.png', 'data:image/svg+xml,<svg/>']) {
            const site = createConnectedSite({
                origin: 'https://dapp.example', appName: 'dApp', icon, permissions: PERMISSIONS,
            });
            expect(site.icon).toBeNull();
            expect(site.iconCapturedAt).toBeNull();
            expect(validateConnectedSite(site).ok).toBe(true);
        }
    });

    it('migrates a record written before site icons to icon null', () => {
        const old = legacyRecord();
        expect(validateConnectedSite(old).ok).toBe(true);
        const migrated = migrateConnectedSite(old);
        expect(migrated.icon).toBeNull();
        expect(migrated.iconCapturedAt).toBeNull();
        expect(migrated.schemaVersion).toBe(1);
        // The legacy raw appIcon string is kept but never promoted to icon.
        expect(migrated.appIcon).toBe('https://dapp.example/logo.png');
        expect(validateConnectedSite(migrated).ok).toBe(true);
    });

    it('migration drops a tampered icon instead of failing the record', () => {
        const migrated = migrateConnectedSite(legacyRecord({
            icon: 'data:image/svg+xml,<svg onload=alert(1)/>',
            iconCapturedAt: '2026-01-01T00:00:00.000Z',
        }));
        expect(migrated.icon).toBeNull();
        expect(migrated.iconCapturedAt).toBeNull();
    });

    it('migration keeps a valid icon and returns an unchanged record as-is', () => {
        const record = legacyRecord({ icon: pngDataUrl(), iconCapturedAt: '2026-01-03T00:00:00.000Z' });
        expect(migrateConnectedSite(record)).toBe(record);
        expect(withSiteIconFields(record)).toBe(record);
    });

    it('validateConnectedSite refuses a stored icon that fails the caps', () => {
        const result = validateConnectedSite(legacyRecord({ icon: 'https://dapp.example/i.png' }));
        expect(result.ok).toBe(false);
        expect(validateConnectedSite(legacyRecord({ icon: pngDataUrl(), iconCapturedAt: 'yesterday' })).ok).toBe(false);
    });
});

describe('siteInitials', () => {
    it('uses two words of the declared name, then the host label', () => {
        expect(siteInitials('Example dApp', 'https://dapp.example')).toBe('ED');
        expect(siteInitials('Uniswap', 'https://app.uniswap.org')).toBe('UN');
        expect(siteInitials('', 'https://app.uniswap.org')).toBe('UN');
        // The handler defaults appName to the origin; that names nothing.
        expect(siteInitials('https://app.uniswap.org', 'https://app.uniswap.org')).toBe('UN');
        expect(siteInitials('', 'not a url')).toBe('?');
    });
});
