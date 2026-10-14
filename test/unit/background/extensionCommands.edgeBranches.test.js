// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    EXTENSION_COMMANDS,
    attachExtensionCommandListener,
} from '../../../packages/extension/src/background/extensionCommands.js';

function commandBus({ removable = true } = {}) {
    let listener;
    const onCommand = {
        addListener: vi.fn((next) => { listener = next; }),
    };
    if (removable) onCommand.removeListener = vi.fn();
    return {
        api: { onCommand },
        emit(command) { listener(command, { windowId: 3 }); },
    };
}

describe('extension command error branches', () => {
    it('returns a safe no-op when the commands API is unavailable', () => {
        const detach = attachExtensionCommandListener({
            commandsApi: {},
            openWallet: vi.fn(),
            lockWallet: vi.fn(),
        });
        expect(detach()).toBeUndefined();
    });

    it('logs a synchronous command failure without throwing from the listener', () => {
        const bus = commandBus();
        const failure = new Error('window creation refused');
        const logger = { error: vi.fn() };
        attachExtensionCommandListener({
            commandsApi: bus.api,
            openWallet: () => { throw failure; },
            lockWallet: vi.fn(),
            logger,
        });

        expect(() => bus.emit(EXTENSION_COMMANDS.OPEN_WALLET)).not.toThrow();
        expect(logger.error).toHaveBeenCalledWith(
            '[xchain] extension command open-wallet failed:',
            failure,
        );
    });

    it('logs an asynchronous command failure', async () => {
        const bus = commandBus({ removable: false });
        const failure = new Error('lock refused');
        const logger = { error: vi.fn() };
        const detach = attachExtensionCommandListener({
            commandsApi: bus.api,
            openWallet: vi.fn(),
            lockWallet: vi.fn(async () => { throw failure; }),
            logger,
        });

        bus.emit(EXTENSION_COMMANDS.LOCK_WALLET);
        await vi.waitFor(() => expect(logger.error).toHaveBeenCalledWith(
            '[xchain] extension command lock-wallet failed:',
            failure,
        ));
        expect(() => detach()).not.toThrow();
    });
});
