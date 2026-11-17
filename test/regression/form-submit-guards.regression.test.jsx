// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: form submission admission.
//
//   [P0] 2026-10-13: Repeated block-origin submits can dispatch the same
//        destructive write more than once while the first write is pending.
//
//   [P1] 2026-10-13: Repeated sign-throttle submits can persist the same
//        settings patch more than once while the first update is pending.
//        The throttle now applies per choice, so the guard is that a second
//        choice never writes the older value of the first one back.

import React from 'react';
import { selectOption } from '../helpers/selectOption.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultSettings } from '../../packages/core/src/schemas/settings.js';

const mocks = vi.hoisted(() => ({
    messaging: undefined,
    settings: undefined,
    update: vi.fn(),
}));

vi.mock('../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: mocks.settings,
        loading: false,
        error: null,
        update: mocks.update,
    }),
}));

vi.mock('../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: mocks.messaging }),
}));

vi.mock('../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: vi.fn() }),
}));

import { ConnectedSitesSection } from '../../packages/core/src/shared/components/settings/ConnectedSitesSection.jsx';

function deferred() {
    let resolve;
    const promise = new Promise((settle) => { resolve = settle; });
    return { promise, resolve };
}

beforeEach(() => {
    mocks.settings = createDefaultSettings();
    mocks.update = vi.fn().mockResolvedValue(mocks.settings);
    mocks.messaging = {
        listConnectedSites: vi.fn().mockResolvedValue([]),
        listBlockedOrigins: vi.fn().mockResolvedValue([]),
        blockOrigin: vi.fn().mockResolvedValue(undefined),
        unblockOrigin: vi.fn().mockResolvedValue(undefined),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('regression/form-submit-guards', () => {
    it('[REGRESSION P0] admits one manual block while its write is pending', async () => {
        const pending = deferred();
        mocks.messaging.blockOrigin.mockReturnValue(pending.promise);
        render(<ConnectedSitesSection />);

        // The Block Site form opens from the header plus.
        fireEvent.click(await screen.findByRole('button', { name: 'Block a site' }));
        const input = await screen.findByPlaceholderText('https://example.com or *.example.com');
        fireEvent.change(input, { target: { value: 'https://blocked.example' } });
        const form = input.closest('form');

        fireEvent.submit(form);
        fireEvent.click(await screen.findByRole('button', { name: 'Block site' }));
        await waitFor(() => expect(mocks.messaging.blockOrigin).toHaveBeenCalledTimes(1));
        fireEvent.submit(form);

        expect(mocks.messaging.blockOrigin).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Block Site' })).toBeDisabled();

        pending.resolve();
        await waitFor(() => expect(mocks.messaging.listBlockedOrigins).toHaveBeenCalledTimes(2));
    });

    it('[REGRESSION P1] a second throttle choice made while the first save is pending keeps the first', async () => {
        const pending = deferred();
        mocks.update.mockReturnValue(pending.promise);
        render(<ConnectedSitesSection />);

        // The throttle lives on the Options view and applies at once.
        fireEvent.click(await screen.findByRole('radio', { name: 'Options' }));
        selectOption(await screen.findByTestId('throttle-select-burst'), '10');
        selectOption(screen.getByTestId('throttle-select-windowMs'), '300000');

        expect(mocks.update).toHaveBeenNthCalledWith(1, { signThrottle: { burst: 10, windowMs: 60000 } });
        expect(mocks.update).toHaveBeenNthCalledWith(2, { signThrottle: { burst: 10, windowMs: 300000 } });

        pending.resolve(mocks.settings);
        await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    });
});
