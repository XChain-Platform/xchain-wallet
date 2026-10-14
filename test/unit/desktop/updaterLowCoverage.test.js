/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import {
    classifyInstallFailure,
    readPackageType,
    selectUpdater,
} from '../../../packages/desktop/main/updater.js';

describe('updater selection branches', () => {
    it('reads a trimmed package type and returns null for absent metadata', () => {
        const readFile = vi.fn(() => '  deb\n');
        expect(readPackageType({ resourcesPath: '/resources', readFile })).toBe('deb');
        expect(readFile).toHaveBeenCalledWith('/resources/package-type', 'utf8');
        expect(readPackageType({ resourcesPath: '', readFile })).toBeNull();
        expect(readPackageType({ resourcesPath: '/resources', readFile: () => '  ' })).toBeNull();
        expect(readPackageType({
            resourcesPath: '/resources',
            readFile: () => { throw new Error('missing'); },
        })).toBeNull();
    });

    it('uses the available default updater shapes off Linux', () => {
        const direct = {};
        const nested = {};
        const fallback = {};
        expect(selectUpdater({ autoUpdater: direct }, { platform: 'darwin' }).updater).toBe(direct);
        expect(selectUpdater({ default: { autoUpdater: nested } }, { platform: 'win32' }).updater).toBe(nested);
        expect(selectUpdater({ default: fallback }, { platform: 'freebsd' }).updater).toBe(fallback);
        expect(selectUpdater(null, { platform: 'darwin' }).updater).toBeUndefined();
    });

    it('leaves non-AppImage Linux builds on the default updater', () => {
        const autoUpdater = {};
        expect(selectUpdater({ autoUpdater }, {
            platform: 'linux',
            env: {},
            readFile: () => { throw new Error('must not read'); },
        })).toEqual({ updater: autoUpdater, mislabelledAs: null });
    });

    it('disables snap-managed updates only when both snap variables exist', () => {
        const autoUpdater = {};
        expect(selectUpdater({ autoUpdater }, {
            platform: 'linux', env: { SNAP: '/snap/xchain', SNAP_NAME: 'xchain' },
        })).toEqual({ updater: null, mislabelledAs: null, snapManaged: true });
        expect(selectUpdater({ autoUpdater }, {
            platform: 'linux', env: { SNAP: '/snap/xchain' },
        }).updater).toBe(autoUpdater);
    });

    it('fails closed for a mislabelled AppImage without an AppImage updater', () => {
        expect(selectUpdater({ autoUpdater: { kind: 'deb' } }, {
            platform: 'linux',
            env: { APPIMAGE: '/tmp/wallet.AppImage' },
            resourcesPath: '/resources',
            readFile: () => 'deb',
        })).toEqual({ updater: null, mislabelledAs: 'deb' });
    });

    it('constructs the direct or default AppImage updater for a mislabelled build', () => {
        class DirectUpdater {}
        class NestedUpdater {}
        const options = {
            platform: 'linux',
            env: { APPIMAGE: '/tmp/wallet.AppImage' },
            resourcesPath: '/resources',
            readFile: () => 'deb',
        };

        expect(selectUpdater({ AppImageUpdater: DirectUpdater }, options).updater)
            .toBeInstanceOf(DirectUpdater);
        expect(selectUpdater({ default: { AppImageUpdater: NestedUpdater } }, options).updater)
            .toBeInstanceOf(NestedUpdater);
    });

    it('keeps an AppImage with no package-type metadata on the default updater', () => {
        const autoUpdater = {};
        expect(selectUpdater({ autoUpdater }, {
            platform: 'linux',
            env: { APPIMAGE: '/tmp/wallet.AppImage' },
            resourcesPath: '/resources',
            readFile: () => '',
        })).toEqual({ updater: autoUpdater, mislabelledAs: null });
    });
});

describe('install failure classification branches', () => {
    it.each([
        [{ code: 'EROFS' }, 'read-only'],
        [{ message: 'Read only file system' }, 'read-only'],
        [{ message: 'read-only volume' }, 'read-only'],
        [{ code: 'EACCES' }, 'permission'],
        [{ code: 'EPERM' }, 'permission'],
        [new Error('disk full'), 'unknown'],
        [null, 'unknown'],
    ])('classifies %j as %s', (error, expected) => {
        expect(classifyInstallFailure(error)).toBe(expected);
    });
});
