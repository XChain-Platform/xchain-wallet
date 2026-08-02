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

//  S5 /  §5: the verified install is the ONLY install.
//
// `updater.js` has claimed since it was written that `downloadAndInstall()`
// is the only path to an install, "because there is no second path at all".
// There was one. `electron-updater`'s `autoInstallOnAppQuit` defaults to
// TRUE, and `BaseUpdater.executeDownload` registers the quit handler as
// soon as the DOWNLOAD finishes - which is inside `downloadUpdate()`,
// before the signed manifest has even been fetched. A user who quits the
// app while that verification is in flight gets the update installed with
// nothing having proved it, and on the Linux deb lane that install is
// `dpkg -i` under pkexec, as root.
//
// Deleting the rejected download narrowed that, but the dangerous window is
// the one where no verdict exists yet, so there is nothing to delete.
//
// These tests hold the two flags that make the claim true, and hold the
// ORDER of the gate: verification first, install second, never the reverse.

import { describe, it, expect, vi } from 'vitest';

import { attachUpdater } from '../../../packages/desktop/main/updater.js';

/** A stand-in for the electron-updater module, recording what is set on it. */
function fakeModule() {
    const calls = [];
    const autoUpdater = {
        autoDownload: true,             // upstream defaults
        autoInstallOnAppQuit: true,     // upstream defaults
        isUpdaterActive: () => true,
        on: () => {},
        checkForUpdates: async () => { calls.push('checkForUpdates'); },
        downloadUpdate: async () => { calls.push('downloadUpdate'); return ['/tmp/update.deb']; },
        quitAndInstall: () => { calls.push('quitAndInstall'); },
    };
    return { mod: { autoUpdater }, autoUpdater, calls };
}

const attach = (mod, extra = {}) => attachUpdater({
    loader: async () => mod,
    onEvent: () => {},
    feedBaseUrl: 'https://feed.invalid/wallet/',
    ...extra,
});

describe('the install gate', () => {
    it('disables auto-download and auto-install-on-quit at attach time', async () => {
        const { mod, autoUpdater } = fakeModule();
        await attach(mod);

        expect(autoUpdater.autoDownload).toBe(false);
        // The one that was missing. It must be false BEFORE any download
        // can complete, because completing a download is what registers
        // the quit handler.
        expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
    });

    it('pins allowDowngrade off, which the rollback doctrine assumes', async () => {
        const { mod, autoUpdater } = fakeModule();
        autoUpdater.allowDowngrade = true;   // as the `channel` setter leaves it
        await attach(mod);

        expect(autoUpdater.allowDowngrade).toBe(false);
    });

    it('does not assign autoUpdater.channel anywhere in the main process', async () => {
        // The `channel` setter's side effect is `allowDowngrade = true`
        // (electron-updater 6.8.3, AppUpdater.js). §7.6 plans a beta
        // channel, and the obvious implementation is this assignment - at
        // which point every restored rollback yml becomes installable as a
        // downgrade on a fleet whose incident plan says that cannot happen.
        // If this test ever needs to change, re-pin allowDowngrade AFTER
        // the assignment and say so here.
        const mainDir = new URL('../../../packages/desktop/main/', import.meta.url);
        const { readdirSync, readFileSync } = await import('node:fs');
        for (const file of readdirSync(mainDir).filter((f) => f.endsWith('.js'))) {
            // Comments stripped first: the file this guards explains the
            // trap by quoting the assignment, and a scan that cannot tell
            // an explanation from the thing itself is a scan nobody can
            // write documentation around.
            const code = readFileSync(new URL(file, mainDir), 'utf8')
                .split('\n')
                .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
                .join('\n');
            expect(code, `${file} assigns .channel on the updater`)
                .not.toMatch(/(?:autoUpdater|updater)\s*\.\s*channel\s*=/);
        }
    });

    it('sets them before anything can be downloaded', async () => {
        const { mod, autoUpdater } = fakeModule();
        let flagsWhenDownloadRan = null;
        autoUpdater.downloadUpdate = async () => {
            flagsWhenDownloadRan = {
                autoDownload: autoUpdater.autoDownload,
                autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
            };
            return ['/tmp/update.deb'];
        };

        const updater = await attach(mod);
        await updater.downloadAndInstall();

        expect(flagsWhenDownloadRan).toEqual({
            autoDownload: false, autoInstallOnAppQuit: false,
        });
    });

    it('never installs when verification could not run', async () => {
        const { mod, calls } = fakeModule();
        const updater = await attach(mod, {
            // No signed manifest reachable: fail closed.
            fetchImpl: async () => ({ ok: false, status: 404 }),
        });

        const result = await updater.downloadAndInstall();

        expect(result.ok).toBe(false);
        expect(calls).toContain('downloadUpdate');
        expect(calls).not.toContain('quitAndInstall');
    });

    it('reports the rejection rather than swallowing it', async () => {
        const { mod } = fakeModule();
        const events = [];
        const updater = await attachUpdater({
            loader: async () => mod,
            onEvent: (e) => events.push(e.type),
            feedBaseUrl: 'https://feed.invalid/wallet/',
            fetchImpl: async () => ({ ok: false, status: 404 }),
        });

        await updater.downloadAndInstall();

        expect(events).toContain('rejected');
    });

    it('short-circuits store builds before the module is even loaded', async () => {
        const loader = vi.fn();
        const saved = process.mas;
        Object.defineProperty(process, 'mas', { value: true, configurable: true });
        try {
            const updater = await attachUpdater({ loader, onEvent: () => {} });
            expect(updater.isActive).toBe(false);
            expect(loader).not.toHaveBeenCalled();
        } finally {
            if (saved === undefined) delete process.mas;
            else Object.defineProperty(process, 'mas', { value: saved, configurable: true });
        }
    });
});
