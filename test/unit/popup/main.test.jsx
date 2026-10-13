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
    flows: { marker: 'flows' },
}));

vi.mock('react-dom/client', () => ({ createRoot: mocks.createRoot }));
vi.mock('@xchain-wallet/core', () => ({
    flows: mocks.flows,
    registry: {
        defaultRegistry: mocks.defaultRegistry,
        syncChainRegistryFromHub: mocks.syncRegistry,
    },
}));
vi.mock('@xchain-wallet/core/ui/tokens.css', () => ({}));
vi.mock('../../../packages/extension/src/popup/App.jsx', () => ({
    App: () => null,
}));
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
    document.documentElement.classList.remove('xchain-toolbar-popup');
    document.body.innerHTML = '<div id="xchain-popup-root"></div>';
    vi.stubGlobal('chrome', {
        runtime: { sendMessage: vi.fn() },
        storage: { local: {}, onChanged: { addListener: vi.fn() } },
    });
    mocks.createRoot.mockReturnValue({ render: mocks.render });
    mocks.defaultRegistry.mockReturnValue({ id: 'registry' });
    mocks.syncRegistry.mockResolvedValue({ ok: true });
    mocks.initPanicModePersistence.mockResolvedValue(undefined);
});

describe('popup entrypoint', () => {
    it('marks only the toolbar popup for the compact document width', async () => {
        chrome.extension = { getViews: vi.fn(() => [window]) };

        await import('../../../packages/extension/src/popup/main.jsx');

        expect(document.documentElement).toHaveClass('xchain-toolbar-popup');
    });

    it('leaves popup.html opened in a tab at the full document width', async () => {
        chrome.extension = { getViews: vi.fn(() => []) };

        await import('../../../packages/extension/src/popup/main.jsx');

        expect(document.documentElement).not.toHaveClass('xchain-toolbar-popup');
    });

    it('installs shell services, starts registry sync, and mounts the app', async () => {
        await import('../../../packages/extension/src/popup/main.jsx');

        const container = document.getElementById('xchain-popup-root');
        expect(mocks.installErrorCapture).toHaveBeenCalledOnce();
        expect(mocks.installWipeHook).toHaveBeenCalledOnce();
        expect(mocks.initPanicModePersistence).toHaveBeenCalledWith(mocks.flows);
        expect(mocks.syncRegistry).toHaveBeenCalledWith({ registry: { id: 'registry' } });
        expect(mocks.createRoot).toHaveBeenCalledWith(container);
        expect(mocks.render).toHaveBeenCalledOnce();
    });

    it('keeps mounting when optional registry sync throws synchronously', async () => {
        mocks.syncRegistry.mockImplementation(() => {
            throw new Error('registry unavailable');
        });

        await expect(import('../../../packages/extension/src/popup/main.jsx')).resolves.toBeDefined();
        expect(mocks.render).toHaveBeenCalledOnce();
    });

    it('fails clearly when popup.html does not provide its root element', async () => {
        document.body.innerHTML = '';

        await expect(import('../../../packages/extension/src/popup/main.jsx'))
            .rejects.toThrow('popup: #xchain-popup-root missing; check popup.html');
        expect(mocks.createRoot).not.toHaveBeenCalled();
    });
});
