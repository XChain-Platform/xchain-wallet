// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createRoot: vi.fn(),
    render: vi.fn(),
    getSettings: vi.fn(),
    hydrateCustomChains: vi.fn(),
    initPanicModePersistence: vi.fn(),
    installWipeHook: vi.fn(),
    defaultRegistry: vi.fn(),
    syncRegistry: vi.fn(),
    flows: { marker: 'flows' },
}));

vi.mock('react-dom/client', () => ({ createRoot: mocks.createRoot }));
vi.mock('@xchain-wallet/core', () => ({
    flows: mocks.flows,
    registry: {
        defaultRegistry: mocks.defaultRegistry,
        hydrateCustomChainsFromSettings: mocks.hydrateCustomChains,
        syncChainRegistryFromHub: mocks.syncRegistry,
    },
}));
vi.mock('@xchain-wallet/core/ui/tokens.css', () => ({}));
vi.mock('../../../packages/extension/src/approval/Router.jsx', () => ({
    Router: () => null,
}));
vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    getSettings: mocks.getSettings,
}));
vi.mock('../../../packages/extension/src/background/panicModeStorage.js', () => ({
    initPanicModePersistence: mocks.initPanicModePersistence,
}));
vi.mock('../../../packages/extension/src/storage/wipeHook.js', () => ({
    installExtensionWipeHook: mocks.installWipeHook,
}));

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="xchain-approval-root"></div>';
    vi.stubGlobal('chrome', {
        runtime: { sendMessage: vi.fn() },
        storage: { local: {}, onChanged: { addListener: vi.fn() } },
    });
    mocks.createRoot.mockReturnValue({ render: mocks.render });
    mocks.defaultRegistry.mockReturnValue({ id: 'registry' });
    mocks.syncRegistry.mockResolvedValue({ ok: true });
    mocks.getSettings.mockResolvedValue({ customChains: [{ id: 'custom' }] });
    mocks.initPanicModePersistence.mockResolvedValue(undefined);
});

describe('approval entrypoint', () => {
    it('installs shell services, hydrates registries, and mounts the router', async () => {
        await import('../../../packages/extension/src/approval/main.jsx');
        await vi.waitFor(() => expect(mocks.hydrateCustomChains).toHaveBeenCalledOnce());

        const registry = { id: 'registry' };
        expect(mocks.installWipeHook).toHaveBeenCalledOnce();
        expect(mocks.initPanicModePersistence).toHaveBeenCalledWith(mocks.flows);
        expect(mocks.syncRegistry).toHaveBeenCalledWith({ registry });
        expect(mocks.hydrateCustomChains).toHaveBeenCalledWith(
            registry,
            { customChains: [{ id: 'custom' }] },
        );
        expect(mocks.createRoot)
            .toHaveBeenCalledWith(document.getElementById('xchain-approval-root'));
        expect(mocks.render).toHaveBeenCalledOnce();
    });

    it('still mounts when optional registry and settings reads throw synchronously', async () => {
        mocks.syncRegistry.mockImplementation(() => { throw new Error('registry unavailable'); });
        mocks.getSettings.mockImplementation(() => { throw new Error('settings unavailable'); });

        await expect(import('../../../packages/extension/src/approval/main.jsx'))
            .resolves.toBeDefined();

        expect(mocks.render).toHaveBeenCalledOnce();
        expect(mocks.hydrateCustomChains).not.toHaveBeenCalled();
    });

    it('fails clearly when approval.html does not provide its root element', async () => {
        document.body.innerHTML = '';

        await expect(import('../../../packages/extension/src/approval/main.jsx'))
            .rejects.toThrow('approval: #xchain-approval-root missing; check approval.html');
        expect(mocks.createRoot).not.toHaveBeenCalled();
    });
});
