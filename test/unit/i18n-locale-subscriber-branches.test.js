// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    getLocale,
    onLocaleChange,
    registerLocale,
    setLocale,
} from '../../packages/core/src/i18n/index.js';

afterEach(async () => {
    await setLocale('en');
});

describe('i18n locale subscriber branches', () => {
    it('isolates subscriber errors and honors unsubscribe functions', async () => {
        registerLocale('unit-subscriber-first', {});
        registerLocale('unit-subscriber-second', {});
        const failing = vi.fn(() => {
            throw new Error('subscriber failure');
        });
        const observer = vi.fn();
        const unsubscribeFailing = onLocaleChange(failing);
        const unsubscribeObserver = onLocaleChange(observer);

        await expect(setLocale('unit-subscriber-first')).resolves.toBe('unit-subscriber-first');

        expect(getLocale()).toBe('unit-subscriber-first');
        expect(failing).toHaveBeenCalledWith('unit-subscriber-first');
        expect(observer).toHaveBeenCalledWith('unit-subscriber-first');

        unsubscribeFailing();
        unsubscribeObserver();
        await setLocale('unit-subscriber-second');

        expect(failing).toHaveBeenCalledTimes(1);
        expect(observer).toHaveBeenCalledTimes(1);
    });
});
