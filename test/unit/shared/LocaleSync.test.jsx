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
});
