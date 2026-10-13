// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hideNativeSplash } from '../../../packages/web/src/platform/nativeShellReady.jsx';

const boot = vi.hoisted(() => ({
    render: vi.fn(),
    createRoot: vi.fn(),
    syncRegistry: vi.fn(),
    defaultRegistry: vi.fn(),
    checkFloor: vi.fn(),
    floorFailureMessage: vi.fn(),
    floorStaleMessage: vi.fn(),
    nativeShellIsBroken: vi.fn(),
    installKeyboardViewport: vi.fn(),
    installShellErrorCapture: vi.fn(),
}));

vi.mock('react-dom/client', () => ({ createRoot: boot.createRoot }));
vi.mock('../../../packages/core/src/registry/index.js', () => ({
    defaultRegistry: boot.defaultRegistry,
}));
vi.mock('../../../packages/core/src/registry/remote.js', () => ({
    syncChainRegistryFromHub: boot.syncRegistry,
}));
vi.mock('../../../packages/web/src/App.jsx', () => ({ App: () => null }));
vi.mock('../../../packages/web/src/platform/webviewFloor.js', () => ({
    checkWebViewFloor: boot.checkFloor,
    floorFailureMessage: boot.floorFailureMessage,
    floorStaleMessage: boot.floorStaleMessage,
}));
vi.mock('../../../packages/web/src/storage/nativeVault.js', () => ({
    BROKEN_SHELL_MESSAGE: 'Native vault unavailable.',
    nativeShellIsBroken: boot.nativeShellIsBroken,
}));
vi.mock('../../../packages/web/src/platform/keyboardViewport.js', () => ({
    installKeyboardViewport: boot.installKeyboardViewport,
}));
vi.mock('../../../packages/web/src/errorCapture.js', () => ({
    installShellErrorCapture: boot.installShellErrorCapture,
}));

async function runBoot() {
    return import('../../../packages/web/src/main.jsx');
}

beforeEach(() => {
    vi.resetModules();
    for (const mock of Object.values(boot)) mock.mockReset();
    boot.createRoot.mockReturnValue({ render: boot.render });
    boot.defaultRegistry.mockReturnValue({ kind: 'registry' });
    boot.syncRegistry.mockResolvedValue({ ok: true });
    boot.checkFloor.mockReturnValue({ usable: true, stale: false, missing: [], chromium: 130 });
    boot.floorFailureMessage.mockReturnValue('Missing browser capabilities.');
    boot.floorStaleMessage.mockReturnValue('Browser engine is stale.');
    boot.nativeShellIsBroken.mockReturnValue(false);
    document.body.innerHTML = '<div id="xchain-web-root"></div>';
    delete globalThis.__xchainBootFloor;
    Object.defineProperty(navigator, 'registerProtocolHandler', {
        configurable: true,
        value: vi.fn(),
    });
    globalThis.Capacitor = {
        Plugins: { SplashScreen: { hide: vi.fn(() => Promise.resolve()) } },
    };
});

describe('web application boot', () => {
    it('installs shell helpers, registers URI handlers, syncs the registry, and mounts React', async () => {
        await runBoot();
        const container = document.getElementById('xchain-web-root');

        expect(boot.installShellErrorCapture).toHaveBeenCalledTimes(1);
        expect(boot.installKeyboardViewport).toHaveBeenCalledTimes(1);
        expect(boot.syncRegistry).toHaveBeenCalledWith({ registry: { kind: 'registry' } });
        expect(navigator.registerProtocolHandler).toHaveBeenNthCalledWith(
            1,
            'web+xchain',
            `${location.origin}/?uri=%s`,
        );
        expect(navigator.registerProtocolHandler).toHaveBeenNthCalledWith(
            2,
            'xchain',
            `${location.origin}/?uri=%s`,
        );
        expect(boot.createRoot).toHaveBeenCalledWith(container);
        expect(boot.render).toHaveBeenCalledTimes(1);
        const shell = boot.render.mock.calls[0][0];
        expect(shell.props.children[1].type.name).toBe('NativeShellReady');
    });

    it('renders a plain blocking panel when required browser capabilities are missing', async () => {
        boot.checkFloor.mockReturnValue({ usable: false, stale: false, missing: ['indexedDB'] });
        await runBoot();

        const alert = document.querySelector('[role="alert"]');
        expect(alert.querySelector('h1').textContent).toBe('This device cannot run XChain Wallet safely');
        expect(alert.querySelector('p').textContent).toBe('Missing browser capabilities.');
        expect(boot.createRoot).not.toHaveBeenCalled();
        expect(globalThis.Capacitor.Plugins.SplashScreen.hide).toHaveBeenCalledTimes(1);
    });

    it('blocks a native shell whose vault plugin is unavailable', async () => {
        boot.nativeShellIsBroken.mockReturnValue(true);
        await runBoot();

        const alert = document.querySelector('[role="alert"]');
        expect(alert.querySelector('h1').textContent).toBe('XChain Wallet cannot open on this device');
        expect(alert.querySelector('p').textContent).toBe('Native vault unavailable.');
        expect(boot.createRoot).not.toHaveBeenCalled();
        expect(globalThis.Capacitor.Plugins.SplashScreen.hide).toHaveBeenCalledTimes(1);
    });

    it('preserves the pre-bundle refusal panel without mounting React', async () => {
        const root = document.getElementById('xchain-web-root');
        root.textContent = 'pre-bundle refusal';
        globalThis.__xchainBootFloor = { blocked: true };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await runBoot();

        expect(root.textContent).toBe('pre-bundle refusal');
        expect(boot.nativeShellIsBroken).not.toHaveBeenCalled();
        expect(boot.createRoot).not.toHaveBeenCalled();
        expect(globalThis.Capacitor.Plugins.SplashScreen.hide).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            'web: boot floor refused this engine before the bundle loaded',
        );
    });

    it('warns for a stale but usable engine and still mounts', async () => {
        boot.checkFloor.mockReturnValue({ usable: true, stale: true, missing: [], chromium: 90 });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await runBoot();

        expect(boot.floorStaleMessage).toHaveBeenCalledWith(
            expect.objectContaining({ stale: true, chromium: 90 }),
        );
        expect(warn).toHaveBeenCalledWith('[web] Browser engine is stale.');
        expect(boot.render).toHaveBeenCalledTimes(1);
    });

    it('fails clearly when the HTML mount point is absent', async () => {
        document.body.innerHTML = '';
        await expect(runBoot()).rejects.toThrow('web: #xchain-web-root missing');
        expect(boot.createRoot).not.toHaveBeenCalled();
    });

    it('releases the native splash through the mocked Capacitor plugin', () => {
        hideNativeSplash();
        expect(globalThis.Capacitor.Plugins.SplashScreen.hide).toHaveBeenCalledTimes(1);

        globalThis.Capacitor.Plugins.SplashScreen.hide.mockImplementation(() => {
            throw new Error('native bridge unavailable');
        });
        expect(() => hideNativeSplash()).not.toThrow();
    });

    it('pins edge-to-edge insets before the first WebView layout', () => {
        const config = JSON.parse(readFileSync(
            resolve('packages/mobile/capacitor.config.json'),
            'utf8',
        ));
        expect(config.plugins.SystemBars).toMatchObject({
            insetsHandling: 'css',
            initialViewportFitValueHint: 'cover',
        });
    });
});
