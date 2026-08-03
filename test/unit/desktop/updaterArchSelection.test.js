/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  DD4: does electron-updater pick the RIGHT architecture's artifact?
//
// This is the half of DD4 that needs no hardware. The spec asks for an
// arm64 device to smoke "the updater picks the arm64 artifact from the yml,
// not x64", and notes multi-arch selection within one Windows yml has known
// upstream quirks. Those quirks are decidable from the algorithm, and if
// selection is broken it is broken on every machine, so finding it here is
// strictly better than finding it on a device we do not yet own.
//
// The algorithm, from electron-updater 6.8.9 `out/providers/Provider.js`:
//
//     files.find(f => f.url.includes(process.arch)) ?? files.shift()
//
// A substring match of "x64" / "arm64" against the FILENAME, falling back to
// whichever file is listed FIRST. The Windows, macOS and AppImage updaters
// all route through it.
//
// The trap: electron-builder omits the arch from x64 filenames by default,
// so an x64 machine matches nothing and takes the fallback. It lands on the
// right file only because x64 is built, and therefore listed, first. Reverse
// the order and every x64 user is offered the arm64 build, with nothing in
// the build or the feed looking wrong.
//
// These tests drive the REAL findFile, not a reimplementation, so they keep
// telling the truth across electron-updater upgrades.

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-extraneous-dependencies
const { findFile } = require('electron-updater/out/providers/Provider.js');

const realArch = process.arch;
afterEach(() => {
    Object.defineProperty(process, 'arch', { value: realArch, configurable: true });
});

const asArch = (arch) => {
    Object.defineProperty(process, 'arch', { value: arch, configurable: true });
};

/** Shape findFile expects: url is a URL-ish with a pathname. */
const files = (...names) => names.map((name) => ({
    url: { pathname: `/${name}` },
    info: { url: name },
}));

// What electron-builder emitted BEFORE this fix: no arch on the x64 name.
const LEGACY_WIN = ['XChain Wallet Setup 0.333.1.exe', 'XChain Wallet Setup 0.333.1-arm64.exe'];
// What it emits now that artifactName carries ${arch}.
const FIXED_WIN = ['XChain Wallet Setup 0.333.1-x64.exe', 'XChain Wallet Setup 0.333.1-arm64.exe'];

describe('the legacy naming, to document why it had to change', () => {
    it('arm64 was always fine: it matched by name', () => {
        asArch('arm64');
        expect(findFile(files(...LEGACY_WIN), 'exe').info.url)
            .toBe('XChain Wallet Setup 0.333.1-arm64.exe');
    });

    it('x64 was right ONLY because x64 happened to be listed first', () => {
        asArch('x64');
        expect(findFile(files(...LEGACY_WIN), 'exe').info.url)
            .toBe('XChain Wallet Setup 0.333.1.exe');
    });

    // The actual defect. Same files, order reversed, and an x64 machine is
    // handed the arm64 installer.
    it('REVERSE the order and x64 silently gets the arm64 installer', () => {
        asArch('x64');
        expect(findFile(files(...[...LEGACY_WIN].reverse()), 'exe').info.url)
            .toBe('XChain Wallet Setup 0.333.1-arm64.exe');
    });
});

describe('arch-tagged naming makes selection order-independent', () => {
    for (const order of [FIXED_WIN, [...FIXED_WIN].reverse()]) {
        const label = order[0].includes('-x64') ? 'x64 listed first' : 'arm64 listed first';

        it(`picks the x64 installer with ${label}`, () => {
            asArch('x64');
            expect(findFile(files(...order), 'exe').info.url)
                .toBe('XChain Wallet Setup 0.333.1-x64.exe');
        });

        it(`picks the arm64 installer with ${label}`, () => {
            asArch('arm64');
            expect(findFile(files(...order), 'exe').info.url)
                .toBe('XChain Wallet Setup 0.333.1-arm64.exe');
        });
    }
});

describe('macOS routes through the same selector, so it has the same fix', () => {
    const MAC = ['XChain Wallet-0.333.1-x64-mac.zip', 'XChain Wallet-0.333.1-arm64-mac.zip'];

    // MacUpdater calls findFile(files, "zip", ["pkg", "dmg"]), so the dmgs
    // in the same yml must not be candidates.
    const withDmgs = [...MAC, 'XChain Wallet-0.333.1-x64.dmg', 'XChain Wallet-0.333.1-arm64.dmg'];

    for (const [arch, expected] of [['x64', MAC[0]], ['arm64', MAC[1]]]) {
        it(`${arch} picks its own zip and never a dmg, in either order`, () => {
            asArch(arch);
            expect(findFile(files(...withDmgs), 'zip', ['pkg', 'dmg']).info.url).toBe(expected);
            expect(findFile(files(...[...withDmgs].reverse()), 'zip', ['pkg', 'dmg']).info.url)
                .toBe(expected);
        });
    }
});

describe('the substring match is not accidentally ambiguous', () => {
    it('"arm64" does not contain "x64", so an arm64 name cannot satisfy an x64 machine', () => {
        expect('arm64'.includes('x64')).toBe(false);
    });

    it('a single-arch feed still resolves (linux ships one yml per arch)', () => {
        asArch('arm64');
        const only = files('XChain Wallet-0.333.1-arm64.AppImage');
        expect(findFile(only, 'AppImage', ['rpm', 'deb', 'pacman']).info.url)
            .toBe('XChain Wallet-0.333.1-arm64.AppImage');
    });
});
