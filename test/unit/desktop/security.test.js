/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    TREZOR_CONNECT_BRIDGE_WINDOW_NAME,
    isAppUrl,
    isHttpUrl,
    isLocalFileUrl,
    isRemoteFrameUrl,
    isTrezorConnectBridgeWindowOpen,
    isTrustedSenderEvent,
    senderFrameUrl,
    shouldBlockNavigation,
} from '../../../packages/desktop/main/security.js';

const appRoot = join(process.cwd(), 'renderer root');
const appIndex = pathToFileURL(join(appRoot, 'index.html')).href;

describe('desktop renderer URL trust', () => {
    it('accepts only files inside the renderer directory', () => {
        expect(isAppUrl(`${appIndex}?xc-init-route=value#screen`, appRoot)).toBe(true);
        expect(isAppUrl(pathToFileURL(join(appRoot, 'assets', 'app.js')).href, appRoot)).toBe(true);
        expect(isAppUrl(pathToFileURL(join(`${appRoot}-evil`, 'index.html')).href, appRoot)).toBe(false);
        expect(isAppUrl(pathToFileURL(join(appRoot, '..', 'secrets.html')).href, appRoot)).toBe(false);
        expect(isAppUrl('file://server/share/index.html', appRoot)).toBe(false);
        expect(isAppUrl('https://example.com/index.html', appRoot)).toBe(false);
        expect(isAppUrl('not a URL', appRoot)).toBe(false);
    });

    it('fails closed when the renderer root is absent or is the target itself', () => {
        expect(isAppUrl(appIndex, '')).toBe(false);
        expect(isAppUrl(pathToFileURL(appRoot).href, appRoot)).toBe(false);
        expect(shouldBlockNavigation(appIndex, '')).toBe(true);
    });

    it('separates scheme helpers from the app-directory trust check', () => {
        expect(isLocalFileUrl('FILE:///tmp/index.html')).toBe(true);
        expect(isLocalFileUrl('https://example.com')).toBe(false);
        expect(isHttpUrl('HTTPS://example.com')).toBe(true);
        expect(isHttpUrl('file:///tmp/index.html')).toBe(false);
        expect(shouldBlockNavigation(appIndex, appRoot)).toBe(false);
        expect(shouldBlockNavigation('https://example.com', appRoot)).toBe(true);
    });

    it('rejects explicit remote schemes while tolerating an unknown pre-load URL', () => {
        expect(isRemoteFrameUrl(appIndex, appRoot)).toBe(false);
        expect(isRemoteFrameUrl('', appRoot)).toBe(false);
        expect(isRemoteFrameUrl('/bare/path', appRoot)).toBe(false);
        expect(isRemoteFrameUrl('data:text/html,remote', appRoot)).toBe(true);
        expect(isRemoteFrameUrl(pathToFileURL('/tmp/other.html').href, appRoot)).toBe(true);
        expect(() => isRemoteFrameUrl(appIndex, '')).toThrow(/appRoot/);
    });
});

describe('desktop IPC sender trust', () => {
    it('prefers senderFrame URL and falls back to webContents', () => {
        const getURL = vi.fn(() => appIndex);

        expect(senderFrameUrl({
            senderFrame: { url: 'https://frame.example' },
            sender: { getURL },
        })).toBe('https://frame.example');
        expect(getURL).not.toHaveBeenCalled();
        expect(senderFrameUrl({ sender: { getURL } })).toBe(appIndex);
        expect(senderFrameUrl({})).toBe('');
    });

    it('trusts the app renderer and rejects a remote child frame', () => {
        expect(isTrustedSenderEvent({ senderFrame: { url: appIndex } }, appRoot)).toBe(true);
        expect(isTrustedSenderEvent({ senderFrame: { url: 'https://frame.example' } }, appRoot)).toBe(false);
        expect(isTrustedSenderEvent({}, appRoot)).toBe(true);
    });
});

describe('Trezor bridge window exception', () => {
    it('requires both the exact marker and a trusted app opener', () => {
        expect(isTrezorConnectBridgeWindowOpen(
            TREZOR_CONNECT_BRIDGE_WINDOW_NAME,
            appIndex,
            appRoot,
        )).toBe(true);
        expect(isTrezorConnectBridgeWindowOpen('other-window', appIndex, appRoot)).toBe(false);
        expect(isTrezorConnectBridgeWindowOpen(
            TREZOR_CONNECT_BRIDGE_WINDOW_NAME,
            'data:text/html,bridge',
            appRoot,
        )).toBe(false);
    });
});
