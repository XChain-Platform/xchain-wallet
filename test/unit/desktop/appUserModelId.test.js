/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The running app must claim the AppUserModelID the NSIS installer stamps on
// its shortcuts (WinShell::SetLnkAUMI with APP_ID, the config's appId), or
// the taskbar cannot pair the window with the pinned shortcut and its icon.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
    WINDOWS_APP_USER_MODEL_ID,
    applyAppUserModelId,
} from '../../../packages/desktop/main/appUserModelId.js';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..', 'packages', 'desktop');
const config = createRequire(import.meta.url)(join(desktop, 'electron-builder.config.cjs'));

describe('Windows AppUserModelID', () => {
    it('is the appId the installer stamps on the shortcuts', () => {
        expect(WINDOWS_APP_USER_MODEL_ID).toBe(config.appId);
        expect(WINDOWS_APP_USER_MODEL_ID).toBe('io.xchain.wallet.desktop');
    });

    it('is claimed on a Windows desktop install', () => {
        const app = { setAppUserModelId: vi.fn() };
        expect(applyAppUserModelId(app, { platform: 'win32', windowsStore: false })).toBe(true);
        expect(app.setAppUserModelId).toHaveBeenCalledWith('io.xchain.wallet.desktop');
    });

    it('is left to the package identity in the Microsoft Store build', () => {
        const app = { setAppUserModelId: vi.fn() };
        expect(applyAppUserModelId(app, { platform: 'win32', windowsStore: true })).toBe(false);
        expect(app.setAppUserModelId).not.toHaveBeenCalled();
    });

    it('is not touched off Windows', () => {
        for (const platform of ['darwin', 'linux']) {
            const app = { setAppUserModelId: vi.fn() };
            expect(applyAppUserModelId(app, { platform, windowsStore: false })).toBe(false);
            expect(app.setAppUserModelId).not.toHaveBeenCalled();
        }
    });

    it('tolerates an app object without the method', () => {
        expect(applyAppUserModelId({}, { platform: 'win32', windowsStore: false })).toBe(false);
        expect(applyAppUserModelId(null, { platform: 'win32', windowsStore: false })).toBe(false);
    });

    it('is called from main before app ready', () => {
        const main = readFileSync(join(desktop, 'main', 'index.js'), 'utf8');
        const call = main.indexOf('\napplyAppUserModelId(app);');
        const ready = main.search(/app\.whenReady\(\)/);
        expect(call).toBeGreaterThan(0);
        expect(ready).toBeGreaterThan(call);
    });
});
