// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const boot = vi.hoisted(() => ({
    applyRemoteDescriptors: vi.fn(),
    createRoot: vi.fn(),
    installErrorCapture: vi.fn(),
    installFiatRateSource: vi.fn(),
    setShellCapabilities: vi.fn(),
}));

vi.mock('react-dom/client', () => ({ createRoot: boot.createRoot }));
vi.mock('@xchain-wallet/core', () => ({
    flows: {},
    registry: {
        defaultRegistry: () => ({ applyRemoteDescriptors: boot.applyRemoteDescriptors }),
    },
}));
vi.mock('@xchain-wallet/core/shared/shellCapabilities.js', () => ({
    setShellCapabilities: boot.setShellCapabilities,
}));
vi.mock('../../../packages/desktop/renderer/errorCapture.js', () => ({
    installShellErrorCapture: boot.installErrorCapture,
}));
vi.mock('../../../packages/desktop/renderer/fiatRateSource.js', () => ({
    installDesktopFiatRateSource: boot.installFiatRateSource,
}));
vi.mock('../../../packages/desktop/renderer/App.jsx', () => ({ App: () => null }));
// The freeze bridge talks to main over IPC; these tests are about the
// registry and render fallbacks, so it resolves at once.
vi.mock('../../../packages/desktop/renderer/panicModeBridge.js', () => ({
    installDesktopPanicModeBridge: vi.fn(async () => {}),
}));
vi.mock('../../../packages/desktop/renderer/DesktopUpdateBanner.jsx', () => ({
    DesktopUpdateBanner: () => null,
}));

async function importMain() {
    return import('../../../packages/desktop/renderer/main.jsx');
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="xchain-desktop-root"></div>';
    boot.createRoot.mockReturnValue({ render: vi.fn() });
    delete window.xchainWalletRegistry;
});

describe('desktop renderer boot fallbacks', () => {
    it('boots with bundled descriptors when registry lookup throws synchronously', async () => {
        window.xchainWalletRegistry = {
            getRemoteDescriptors: vi.fn(() => { throw new Error('preload unavailable'); }),
        };

        await expect(importMain()).resolves.toBeTruthy();
        expect(boot.installErrorCapture).toHaveBeenCalledOnce();
        expect(boot.installFiatRateSource).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(boot.createRoot).toHaveBeenCalledOnce());
        expect(boot.applyRemoteDescriptors).not.toHaveBeenCalled();
    });

    it('boots when asynchronous registry synchronization rejects', async () => {
        window.xchainWalletRegistry = {
            getRemoteDescriptors: vi.fn().mockRejectedValue(new Error('verification unavailable')),
        };

        await expect(importMain()).resolves.toBeTruthy();
        await Promise.resolve();
        await vi.waitFor(() => expect(boot.createRoot).toHaveBeenCalledOnce());
        expect(boot.applyRemoteDescriptors).not.toHaveBeenCalled();
    });

    it('keeps bundled descriptors after an explicit registry refusal', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        window.xchainWalletRegistry = {
            getRemoteDescriptors: vi.fn().mockResolvedValue({ ok: false, reason: 'signature refused' }),
        };

        await importMain();
        await vi.waitFor(() => expect(info).toHaveBeenCalledWith(
            'desktop: chain-registry sync skipped:',
            'signature refused',
        ));
        expect(boot.applyRemoteDescriptors).not.toHaveBeenCalled();
        info.mockRestore();
    });

    it('fails clearly when the renderer mount point is missing', async () => {
        document.body.innerHTML = '';

        await expect(importMain()).rejects.toThrow('#xchain-desktop-root missing');
        expect(boot.installErrorCapture).toHaveBeenCalledOnce();
        expect(boot.installFiatRateSource).toHaveBeenCalledOnce();
        expect(boot.setShellCapabilities).not.toHaveBeenCalled();
        expect(boot.createRoot).not.toHaveBeenCalled();
    });
});
