// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A connected site chooses its own name and origin, so the Connected sites
// list renders both as hostile text: bidi overrides never reorder the name,
// a name is capped, and the origin wraps inside its card.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let messaging;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: createDefaultSettings(), loading: false, error: null, update: vi.fn() }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));
vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: vi.fn() }),
}));

const { ConnectedSitesSection } = await import(
    '../../../packages/core/src/shared/components/settings/ConnectedSitesSection.jsx'
);

const site = (id, origin, appName) => ({
    schemaVersion: 1,
    id,
    origin,
    appName,
    appIcon: '',
    connectedAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: '2026-10-01T00:00:00.000Z',
    permissions: { chains: [], accounts: [], canSignMessage: false, canSignAction: {} },
    sessionHistory: [],
});

beforeEach(() => {
    const longHost = `https://${'a'.repeat(240)}.com`;
    messaging = {
        listConnectedSites: vi.fn(async () => [
            site('1', 'https://example.com', '‮evil‬ name'),
            site('2', longHost, 'N'.repeat(5000)),
        ]),
        listBlockedOrigins: vi.fn(async () => []),
        listBlocklistAuditLog: vi.fn(async () => []),
        blockOrigin: vi.fn(),
        unblockOrigin: vi.fn(),
    };
});

afterEach(() => cleanup());

describe('Connected sites list text', () => {
    it('replaces bidi overrides in a site name with a visible placeholder', async () => {
        render(<ConnectedSitesSection />);
        const heading = await screen.findByRole('heading', { name: /name$/ });
        expect(heading.textContent).not.toMatch(/[‪-‮]/);
        expect(heading.textContent).toContain('␦');
    });

    it('caps a site name and wraps a long origin', async () => {
        render(<ConnectedSitesSection />);
        const heading = await screen.findByRole('heading', { name: /^N+…$/ });
        expect(heading.textContent.length).toBeLessThanOrEqual(120);
        const origin = await screen.findByText(`https://${'a'.repeat(240)}.com`);
        expect(origin.style.overflowWrap).toBe('anywhere');
        expect(origin.getAttribute('dir')).toBe('ltr');
    });
});
