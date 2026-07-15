// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings → Keyboard rebinding UI (§34.1): capture flow, conflict refusal,
// persistence via messaging.updateSettings, and reset.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor, act } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { KeyboardSection } from '../../../packages/core/src/shared/components/settings/KeyboardSection.jsx';

afterEach(() => cleanup());

function makeMessaging(initialBindings = {}) {
    let settings = { keyboard: { bindings: { ...initialBindings } } };
    return {
        getSettings: vi.fn(() => Promise.resolve(settings)),
        updateSettings: vi.fn((patch) => {
            settings = { ...settings, ...patch };
            return Promise.resolve(settings);
        }),
        _get: () => settings,
    };
}

async function setup(initialBindings) {
    const messaging = makeMessaging(initialBindings);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <KeyboardSection />
        </MessagingProvider>,
    );
    await waitFor(() => expect(screen.getByText('Lock wallet')).toBeTruthy());
    return messaging;
}

// The capture listener is on window with capture=true.
const press = (init) => act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
});

describe('KeyboardSection', () => {
    it('lists rebindable rows with Rebind buttons and fixed context rows without', () => {
        return setup().then(() => {
            expect(screen.getByText('Export history')).toBeTruthy();
            const rebinds = screen.getAllByRole('button', { name: 'Rebind' });
            // General (5, incl. palette) + Go to (6) are rebindable; the six
            // context shortcuts are not.
            expect(rebinds).toHaveLength(11);
        });
    });

    it('captures a new combo and persists it', async () => {
        const messaging = await setup();
        const lockRow = screen.getByText('Lock wallet').closest('div');
        fireEvent.click(lockRow.querySelector('button'));
        press({ key: 'j', ctrlKey: true });
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            keyboard: { bindings: { lock: 'mod+j' } },
        }));
    });

    it('refuses a conflicting binding', async () => {
        const messaging = await setup();
        const lockRow = screen.getByText('Lock wallet').closest('div');
        fireEvent.click(lockRow.querySelector('button'));
        press({ key: 'n', ctrlKey: true }); // taken by New send
        await waitFor(() => expect(screen.getByText(/already used by/)).toBeTruthy());
        expect(messaging.updateSettings).not.toHaveBeenCalled();
    });

    it('resets an override back to the default', async () => {
        const messaging = await setup({ lock: 'mod+j' });
        const lockRow = await waitFor(() => screen.getByText('Lock wallet').closest('div'));
        const reset = screen.getByRole('button', { name: 'Reset' });
        fireEvent.click(reset);
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            keyboard: { bindings: {} },
        }));
        expect(lockRow).toBeTruthy();
    });
});
