// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The panic notice copy lives in the `panic.*` dictionary keys, so a
// translated locale replaces every sentence the freeze shows.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    PANIC_ARMED_SELF,
    activatePanicMode,
    clearPanicModeState,
} from '../../../packages/core/src/flows/panicMode.js';
import { registerLocale, setLocale } from '../../../packages/core/src/i18n/index.js';
import { en } from '../../../packages/core/src/i18n/locales/en/index.js';
import {
    panicFreezeNotice,
    panicRefusalMessage,
} from '../../../packages/core/src/shared/safety/panicNotice.js';

const T0 = 1_800_000_000_000;

beforeEach(() => clearPanicModeState());
afterEach(async () => {
    clearPanicModeState();
    await setLocale('en');
});

describe('panic notice copy', () => {
    it('keeps every sentence under a panic.* key in the English dictionary', () => {
        const keys = Object.keys(en).filter((k) => k.startsWith('panic.'));
        expect(keys.sort()).toEqual([
            'panic.frozen.title',
            'panic.home.detail',
            'panic.refusal',
            'panic.rejectOnly.detail',
            'panic.rejectOnly.detailBack',
            'panic.send.detail',
            'panic.send.title',
            'panic.sign.detail',
        ]);
    });

    it('renders every surface and the refusal sentence from the active locale', async () => {
        const marked = {};
        for (const key of Object.keys(en)) {
            if (key.startsWith('panic.')) marked[key] = `[xx] ${en[key]}`;
        }
        registerLocale('xx', { ...en, ...marked });
        await setLocale('xx');
        const state = activatePanicMode({ nowMs: T0, armedBy: PANIC_ARMED_SELF });
        for (const surface of ['home', 'send', 'sign', 'reject-only']) {
            const notice = panicFreezeNotice({ state, nowMs: T0, surface });
            expect(notice.title, surface).toMatch(/^\[xx\] /);
            expect(notice.detail, surface).toMatch(/^\[xx\] /);
        }
        const err = Object.assign(new Error('frozen'), { name: 'PanicModeActiveError' });
        expect(panicRefusalMessage(err, { state, nowMs: T0 })).toMatch(/^\[xx\] /);
    });
});
