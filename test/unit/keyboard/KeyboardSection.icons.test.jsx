// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { KeyboardSection } from '../../../packages/core/src/shared/components/settings/KeyboardSection.jsx';

afterEach(() => cleanup());

describe('KeyboardSection button icons', () => {
    it('puts an icon on every Rebind button, Reset all, and the capture Cancel', async () => {
        const messaging = {
            getSettings: vi.fn(() => Promise.resolve({ keyboard: { bindings: {} } })),
            updateSettings: vi.fn((patch) => Promise.resolve(patch)),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <KeyboardSection />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByText('Lock wallet')).toBeTruthy());
        const rebinds = screen.getAllByRole('button', { name: 'Rebind' });
        expect(rebinds.length).toBeGreaterThan(0);
        for (const button of rebinds) expect(button.querySelector('svg')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Reset all shortcuts' }).querySelector('svg')).not.toBeNull();
        fireEvent.click(rebinds[0]);
        expect(screen.getByRole('button', { name: 'Cancel' }).querySelector('svg')).not.toBeNull();
    });
});
