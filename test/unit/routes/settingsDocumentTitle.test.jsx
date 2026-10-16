// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Each Settings sub-screen titles the window with the heading it shows.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { useDocumentTitle } from '../../../packages/core/src/shared/hooks/useDocumentTitle.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const SETTINGS = createDefaultSettings();

function messaging() {
    const base = {
        getSettings: vi.fn().mockResolvedValue(SETTINGS),
        updateSettings: vi.fn().mockResolvedValue(SETTINGS),
        listConnectedSites: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(() => new Promise(() => {}));
            target[property] = stub;
            return stub;
        },
    });
}

function Shell({ initialSubpageId }) {
    useDocumentTitle({ statusState: 'unlocked', onboardingStep: 'welcome', unlockedView: 'settings' });
    return (
        <MessagingContext.Provider value={{ shell: 'web', messaging: messaging() }}>
            <Settings
                onBack={() => {}}
                initialSubpageId={initialSubpageId}
                activeWallet={{ id: 'wallet-1', name: 'Primary Wallet' }}
                activeAccount={{ id: 'account-1', name: 'Daily', index: 0 }}
                onOpenWalletPicker={() => {}}
                onOpenAccountPicker={() => {}}
            />
        </MessagingContext.Provider>
    );
}

afterEach(() => {
    cleanup();
    document.title = '';
});

describe('Settings window title', () => {
    it('reads Settings on the section list', () => {
        render(<Shell />);
        expect(document.title).toBe('XChain Wallet - Settings');
    });

    it.each([
        ['display', 'Display'],
        ['keyboard', 'Keyboard'],
        ['backup', 'Backup'],
        ['fees', 'Fees'],
        ['network-endpoints', 'Network & endpoints'],
        ['about', 'About'],
    ])('titles the %s sub-screen with the heading it shows', (id, heading) => {
        render(<Shell initialSubpageId={id} />);
        expect(screen.getByRole('heading', { name: heading, level: 1 })).toBeTruthy();
        expect(document.title).toBe(`XChain Wallet - ${heading}`);
    });

    it('goes back to Settings when the sub-screen closes', () => {
        render(<Shell initialSubpageId="display" />);
        expect(document.title).toBe('XChain Wallet - Display');
        fireEvent.click(screen.getByRole('button', { name: /back/i }));
        expect(document.title).toBe('XChain Wallet - Settings');
    });
});
