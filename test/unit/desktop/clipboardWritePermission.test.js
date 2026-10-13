// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Receive's Copy QR writes an image through navigator.clipboard.write,
// which Electron routes to the permission REQUEST handler as
// `clipboard-sanitized-write`. The app's page gets it, a remote frame does
// not, and clipboard reads and every prompting permission stay refused.

import { describe, expect, it } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attachHidPermissions, createHidFrameGuard } from '../../../packages/desktop/main/permissions.js';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..', '..', '..', 'packages', 'desktop', 'renderer', 'dist');
const appIndex = pathToFileURL(join(appRoot, 'index.html')).href;

function requestHandler() {
    const handlers = {};
    attachHidPermissions({
        setPermissionRequestHandler: (fn) => { handlers.request = fn; },
        setDevicePermissionHandler: (fn) => { handlers.device = fn; },
        setPermissionCheckHandler: (fn) => { handlers.check = fn; },
        on: () => {},
    }, { appRoot, guard: createHidFrameGuard() });
    return (permission, requestingUrl) => {
        let verdict = 'not-called';
        handlers.request({ getURL: () => appIndex }, permission, (ok) => { verdict = ok; }, { requestingUrl });
        return verdict;
    };
}

describe('desktop permission request handler', () => {
    it('lets the app page write an image to the clipboard', () => {
        expect(requestHandler()('clipboard-sanitized-write', appIndex)).toBe(true);
    });

    it('refuses the clipboard write to a remote frame', () => {
        expect(requestHandler()('clipboard-sanitized-write', 'https://evil.example/frame')).toBe(false);
    });

    it('keeps clipboard reads and prompting permissions refused', () => {
        const ask = requestHandler();
        for (const permission of ['clipboard-read', 'media', 'notifications', 'geolocation']) {
            expect([permission, ask(permission, appIndex)]).toEqual([permission, false]);
        }
    });
});
