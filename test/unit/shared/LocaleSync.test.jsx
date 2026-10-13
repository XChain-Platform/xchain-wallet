// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import {
    getLocale,
    registerLocale,
    setLocale,
    t,
} from '../../../packages/core/src/i18n/index.js';

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
        expect(t('session.unlock')).toBe('Unlock');

        firstApp.unmount();
        await setLocale('en');

        render(<LocaleSync />);
        await waitFor(() => expect(getLocale()).toBe('restart-test'));
        expect(t('common.back')).toBe('Retour');
        expect(t('session.unlock')).toBe('Unlock');
    });
});
