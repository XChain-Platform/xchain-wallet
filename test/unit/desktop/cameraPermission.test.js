// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    attachHidPermissions,
    createHidFrameGuard,
    isAppCameraRequest,
} from '../../../packages/desktop/main/permissions.js';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..', '..', '..', 'packages', 'desktop', 'renderer', 'dist');
const appIndex = pathToFileURL(join(appRoot, 'index.html')).href;

function permissionHandlers() {
    const handlers = {};
    attachHidPermissions({
        setPermissionRequestHandler: (fn) => { handlers.request = fn; },
        setDevicePermissionHandler: (fn) => { handlers.device = fn; },
        setPermissionCheckHandler: (fn) => { handlers.check = fn; },
        on: vi.fn(),
    }, { appRoot, guard: createHidFrameGuard() });
    return handlers;
}

describe('desktop QR camera permission', () => {
    it('allows only a top-level video request from the app renderer', () => {
        const contents = { getURL: () => appIndex };
        expect(isAppCameraRequest(contents, {
            isMainFrame: true,
            mediaTypes: ['video'],
            requestingUrl: appIndex,
        }, appRoot)).toBe(true);
        expect(isAppCameraRequest(contents, {
            isMainFrame: true,
            mediaTypes: ['audio', 'video'],
            requestingUrl: appIndex,
        }, appRoot)).toBe(false);
        expect(isAppCameraRequest(contents, {
            isMainFrame: false,
            mediaTypes: ['video'],
            requestingUrl: appIndex,
        }, appRoot)).toBe(false);
        expect(isAppCameraRequest(contents, {
            isMainFrame: true,
            mediaTypes: ['video'],
            requestingUrl: 'https://remote.example/scan',
        }, appRoot)).toBe(false);
    });

    it('grants the app camera request and refuses audio or remote requests', () => {
        const handlers = permissionHandlers();
        const contents = { getURL: () => appIndex };
        const request = (details) => {
            const callback = vi.fn();
            handlers.request(contents, 'media', callback, details);
            return callback;
        };

        expect(request({
            isMainFrame: true,
            mediaTypes: ['video'],
            requestingUrl: appIndex,
        })).toHaveBeenCalledWith(true);
        expect(request({
            isMainFrame: true,
            mediaTypes: ['audio'],
            requestingUrl: appIndex,
        })).toHaveBeenCalledWith(false);
        expect(request({
            isMainFrame: true,
            mediaTypes: ['video'],
            requestingUrl: 'https://remote.example/scan',
        })).toHaveBeenCalledWith(false);
    });

    it('refuses a stored media grant to a remote origin', () => {
        const handlers = permissionHandlers();
        expect(handlers.check({}, 'media', 'file://', { securityOrigin: 'file://' })).toBe(true);
        expect(handlers.check({}, 'media', 'https://remote.example', {
            securityOrigin: 'https://remote.example',
        })).toBe(false);
    });
});
