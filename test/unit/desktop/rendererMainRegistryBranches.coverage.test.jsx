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

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="xchain-desktop-root"></div>';
    boot.createRoot.mockReturnValue({ render: vi.fn() });
});

describe('desktop renderer registry response branches', () => {
    it('keeps bundled descriptors when the registry returns no result', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        window.xchainWalletRegistry = {
            getRemoteDescriptors: vi.fn().mockResolvedValue(null),
        };

        await import('../../../packages/desktop/renderer/main.jsx');
        await Promise.resolve();

        expect(boot.applyRemoteDescriptors).not.toHaveBeenCalled();
        expect(info).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(boot.createRoot).toHaveBeenCalledOnce());
        info.mockRestore();
        delete window.xchainWalletRegistry;
    });
});
