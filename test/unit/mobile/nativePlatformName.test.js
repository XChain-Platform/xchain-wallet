// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// About and the diagnostic dump name the OS of a Capacitor build. The shell
// there is "web", so without this the Android app reported its platform as web.

import { describe, it, expect } from 'vitest';
import { nativePlatformName } from '../../../packages/core/src/shared/nativeShell.js';

const shellOf = (platform, native = true) => ({
    Capacitor: { isNativePlatform: () => native, getPlatform: () => platform },
});

describe('nativePlatformName', () => {
    it('names android and ios native shells', () => {
        expect(nativePlatformName(shellOf('android'))).toBe('android');
        expect(nativePlatformName(shellOf('ios'))).toBe('ios');
    });

    it('is null in a browser, with a bare Capacitor global, or for an unknown platform', () => {
        expect(nativePlatformName({})).toBeNull();
        expect(nativePlatformName(shellOf('web', false))).toBeNull();
        expect(nativePlatformName({ Capacitor: {} })).toBeNull();
        expect(nativePlatformName(shellOf('electron'))).toBeNull();
    });
});
