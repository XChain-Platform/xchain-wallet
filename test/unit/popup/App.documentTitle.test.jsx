// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The side panel is a full-layout surface and titles its window with the screen
// it shows, through the same hook as the web shell.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../packages/extension/src/popup/App.jsx';

function installChrome(sessionReply) {
    const tabs = {
        query: vi.fn((_query, callback) => callback([{ id: 8 }])),
        sendMessage: vi.fn((_tabId, _message, callback) => callback({ available: true })),
        onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    };
    vi.stubGlobal('chrome', {
        runtime: {
            lastError: undefined,
            sendMessage: vi.fn((message, callback) => {
                if (message.type === 'session.status') callback(sessionReply);
                else callback({ ok: false, error: { name: 'Error', message: 'not available' } });
            }),
        },
        tabs,
        storage: {
            onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
            local: { get: (_key, callback) => callback({}) },
            session: { get: (_key, callback) => callback({}) },
        },
    });
}

beforeEach(() => {
    localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedVersion', '2');
    document.title = 'XChain Wallet';
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
});

describe('extension window title', () => {
    it('titles the side panel with the onboarding screen it shows', async () => {
        window.history.replaceState(null, '', '/sidepanel.html');
        installChrome({ ok: true, result: { state: 'no-wallet' } });
        render(<App />);
        await screen.findByRole('button', { name: 'Create new wallet' });
        expect(document.title).toBe('XChain Wallet - Welcome');
    });

    it('titles the side panel on the unlock screen', async () => {
        window.history.replaceState(null, '', '/sidepanel.html');
        installChrome({ ok: true, result: { state: 'locked' } });
        render(<App />);
        await screen.findByRole('button', { name: 'Unlock Wallet' });
        expect(document.title).toBe('XChain Wallet - Unlock');
    });
});
