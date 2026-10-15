// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createRoot: vi.fn(),
    render: vi.fn(),
    installErrorCapture: vi.fn(),
    installWipeHook: vi.fn(),
    initPanicModePersistence: vi.fn(),
    defaultRegistry: vi.fn(),
    syncRegistry: vi.fn(),
}));

vi.mock('react-dom/client', () => ({ createRoot: mocks.createRoot }));
vi.mock('@xchain-wallet/core', () => ({
    flows: {},
    registry: {
        defaultRegistry: mocks.defaultRegistry,
        syncChainRegistryFromHub: mocks.syncRegistry,
    },
}));
vi.mock('@xchain-wallet/core/ui/tokens.css', () => ({}));
vi.mock('../../../packages/extension/src/popup/App.jsx', () => ({ App: () => null }));
vi.mock('../../../packages/extension/src/popup/errorCapture.js', () => ({
    installShellErrorCapture: mocks.installErrorCapture,
}));
vi.mock('../../../packages/extension/src/storage/wipeHook.js', () => ({
    installExtensionWipeHook: mocks.installWipeHook,
}));
vi.mock('../../../packages/extension/src/background/panicModeStorage.js', () => ({
    initPanicModePersistence: mocks.initPanicModePersistence,
}));

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="xchain-popup-root"></div>';
    vi.stubGlobal('chrome', {});
    mocks.createRoot.mockReturnValue({ render: mocks.render });
    mocks.defaultRegistry.mockReturnValue({ id: 'registry' });
    mocks.initPanicModePersistence.mockResolvedValue(undefined);
});

describe('popup entrypoint registry fallback', () => {
    it('reports a rejected registry result without blocking the popup mount', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        mocks.syncRegistry.mockResolvedValue({ ok: false, reason: 'signature refused' });

        await import('../../../packages/extension/src/popup/main.jsx');
        await vi.waitFor(() => expect(info).toHaveBeenCalledWith(
            '[xchain] popup chain-registry sync skipped:',
            'signature refused',
        ));
        expect(mocks.render).toHaveBeenCalledOnce();

        info.mockRestore();
    });

    it('swallows an asynchronous registry transport failure and still mounts', async () => {
        mocks.syncRegistry.mockRejectedValue(new Error('registry disconnected'));

        await expect(import('../../../packages/extension/src/popup/main.jsx')).resolves.toBeDefined();
        await Promise.resolve();
        expect(mocks.render).toHaveBeenCalledOnce();
    });
});
