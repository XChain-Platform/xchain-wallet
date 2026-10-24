// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Endpoint overrides reach the SDK as-is, so the editor refuses a URL that
// is oversized or carries credentials.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

const updateSpy = vi.fn();

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: { developerMode: true, sdkEndpoints: {} },
        loading: false,
        error: null,
        update: updateSpy,
    }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: null }),
}));

const { NetworkEndpointsSection } = await import(
    '../../../packages/core/src/shared/components/settings/NetworkEndpointsSection.jsx'
);

function saveExplorer(value) {
    render(<NetworkEndpointsSection />);
    const block = screen.getByRole('region', { name: 'Bitcoin' });
    fireEvent.change(within(block).getByRole('textbox', { name: 'Explorer URL' }), { target: { value } });
    fireEvent.click(within(block).getByRole('button', { name: 'Save' }));
    return block;
}

beforeEach(() => updateSpy.mockReset());
afterEach(() => cleanup());

describe('endpoint URL bounds', () => {
    it('refuses a URL longer than 2048 characters', () => {
        const block = saveExplorer(`https://example.com/${'a'.repeat(4096)}`);
        expect(updateSpy).not.toHaveBeenCalled();
        expect(within(block).getByRole('alert')).toHaveTextContent('longer than 2048 characters');
    });

    it('refuses a URL carrying a user name and password', () => {
        const block = saveExplorer('https://user:secret@example.com/x');
        expect(updateSpy).not.toHaveBeenCalled();
        expect(within(block).getByRole('alert')).toHaveTextContent('Remove the user name and password');
    });

    it('still saves an https URL with an IDN host and a loopback http URL', () => {
        saveExplorer('https://例え.jp');
        expect(updateSpy).toHaveBeenCalledTimes(1);
    });
});
