// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../packages/extension/src/popup/App.jsx';

function installChrome() {
    vi.stubGlobal('chrome', {
        extension: { getViews: vi.fn(() => []) },
        runtime: {
            lastError: undefined,
            sendMessage: vi.fn((message, callback) => {
                if (message.type === 'session.status') {
                    callback({ ok: true, result: { state: 'no-wallet' } });
                    return;
                }
                callback({ ok: false, error: { name: 'Error', message: 'not available' } });
            }),
        },
        storage: {
            onChanged: {
                addListener: vi.fn(),
                removeListener: vi.fn(),
            },
            local: { get: (_key, callback) => callback({}) },
            session: { get: (_key, callback) => callback({}) },
        },
    });
}

beforeEach(() => {
    localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedVersion', '2');
    window.history.replaceState(
        null,
        '',
        '/popup.html?handoff=import&variant=freewallet',
    );
    installChrome();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    window.history.replaceState(null, '', '/popup.html');
    vi.unstubAllGlobals();
});

describe('popup App handoff routing', () => {
    it('opens the FreeWallet importer from a fresh-install handoff', async () => {
        render(<App />);

        expect(await screen.findByRole('heading', { name: 'Import from FreeWallet' }))
            .toBeInTheDocument();
        expect(screen.getByLabelText('Wallet name')).toHaveValue('FreeWallet');
    });
});
