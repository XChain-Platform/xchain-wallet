// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
    getLocale,
    registerLocale,
    setLocale,
    t,
} from '../../../packages/core/src/i18n/index.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

let settings;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings }),
}));

const { LocaleSync } = await import('../../../packages/core/src/shared/LocaleSync.jsx');

beforeEach(async () => {
    localStorage.clear();
    await setLocale('en');
    registerLocale('restart-test', { 'common.back': 'Retour' });
    settings = { language: 'restart-test' };
});

afterEach(async () => {
    cleanup();
    await setLocale('en');
});

describe('LocaleSync', () => {
    it('restores the persisted language after the app remounts', async () => {
        const firstApp = render(<LocaleSync />);
        await waitFor(() => expect(getLocale()).toBe('restart-test'));
        expect(t('common.back')).toBe('Retour');
        expect(t('common.cancel')).toBe('Cancel');

        firstApp.unmount();
        await setLocale('en');

        render(<LocaleSync />);
        await waitFor(() => expect(getLocale()).toBe('restart-test'));
        expect(t('common.back')).toBe('Retour');
        expect(t('common.cancel')).toBe('Cancel');
    });

    it('re-renders translated shell content without resetting screen state', async () => {
        registerLocale('live-test', { 'common.back': 'Retour en direct' });
        settings = { language: 'en' };

        function LiveScreen() {
            const [count, setCount] = useState(0);
            return (
                <button type="button" onClick={() => setCount((value) => value + 1)}>
                    {t('common.back')} {count}
                </button>
            );
        }

        render(
            <MessagingProvider shell="web" messaging={{}}>
                <LiveScreen />
            </MessagingProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Back 0' }));

        await act(() => setLocale('live-test'));

        expect(screen.getByRole('button', { name: 'Retour en direct 1' })).toBeTruthy();
        expect(document.documentElement.lang).toBe('live-test');
        expect(document.documentElement.dir).toBe('ltr');
    });

    it('keeps the chosen language on the lock screen, where settings are unreadable', async () => {
        const unlocked = render(<LocaleSync />);
        await waitFor(() => expect(getLocale()).toBe('restart-test'));
        unlocked.unmount();

        // A reload: nothing is active and the vault is locked, so settings are null.
        await setLocale('en');
        settings = null;
        render(<LocaleSync />);

        await waitFor(() => expect(getLocale()).toBe('restart-test'));
        expect(document.documentElement.lang).toBe('restart-test');
    });

    it('applies the cached direction of a right-to-left language while locked', async () => {
        registerLocale('ar', { 'common.back': 'رجوع' });
        settings = { language: 'ar' };
        const unlocked = render(<LocaleSync />);
        await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
        unlocked.unmount();

        await setLocale('en');
        expect(document.documentElement.dir).toBe('ltr');
        settings = null;
        render(<LocaleSync />);

        await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    });

    it('drops the cached language when the settings no longer carry one', async () => {
        const unlocked = render(<LocaleSync />);
        await waitFor(() => expect(localStorage.getItem('xc:language')).toBe('restart-test'));
        unlocked.unmount();

        settings = {};
        const cleared = render(<LocaleSync />);
        await waitFor(() => expect(localStorage.getItem('xc:language')).toBeNull());
        cleared.unmount();

        await setLocale('en');
        settings = null;
        render(<LocaleSync />);
        await act(async () => {});
        expect(getLocale()).toBe('en');
    });
});
