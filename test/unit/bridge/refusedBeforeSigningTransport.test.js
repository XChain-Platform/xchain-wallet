// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The confirm screen frees its held inputs only for an error that says nothing
// was signed. That flag has to survive the host to renderer envelope in every
// shell, and has to stay out of what a web page is shown.

import { describe, expect, it, vi } from 'vitest';
import { hydrateEnvelopeError, serializeError } from '../../../packages/extension/src/background/MessageHost.js';
import { attachChromeRuntime } from '../../../packages/extension/src/background/ChromeRuntimeAdapter.js';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const TRUSTED = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/popup.html` };
const WEB = { id: EXT_ID, origin: 'https://app.example', url: 'https://app.example/', tab: { id: 41 } };

function runtimeBus() {
    let listener;
    return {
        id: EXT_ID,
        onMessage: { addListener: vi.fn((next) => { listener = next; }), removeListener: vi.fn() },
        emit(message, sender) {
            return new Promise((resolve) => {
                if (!listener(message, sender, resolve)) resolve(undefined);
            });
        },
    };
}

describe('the pre-signing refusal flag on the wire', () => {
    it('survives serializeError and hydrateEnvelopeError', () => {
        const err = Object.assign(new Error('Wallet is frozen'), { name: 'PanicModeActiveError', refusedBeforeSigning: true });
        const { error } = serializeError(err);
        expect(error).toEqual({ name: 'PanicModeActiveError', message: 'Wallet is frozen', refusedBeforeSigning: true });
        const rebuilt = hydrateEnvelopeError(error);
        expect(rebuilt.refusedBeforeSigning).toBe(true);
        expect(rebuilt.name).toBe('PanicModeActiveError');
    });

    it('is absent from an ordinary error and from a rebuilt one', () => {
        const { error } = serializeError(new Error('plain'));
        expect(error).toEqual({ name: 'Error', message: 'plain' });
        expect('refusedBeforeSigning' in hydrateEnvelopeError(error)).toBe(false);
    });

    it('does not cross for a value other than true', () => {
        const err = Object.assign(new Error('x'), { refusedBeforeSigning: 'yes' });
        expect('refusedBeforeSigning' in serializeError(err).error).toBe(false);
        expect('refusedBeforeSigning' in hydrateEnvelopeError({ message: 'x', refusedBeforeSigning: 1 })).toBe(false);
    });
});

describe('the pre-signing refusal flag at the extension adapter', () => {
    const failing = { handle: async () => serializeError(Object.assign(new Error('refused'), { code: 'USER_REJECTED', refusedBeforeSigning: true })) };

    it('reaches the extension UI', async () => {
        const runtime = runtimeBus();
        attachChromeRuntime(failing, runtime);
        const response = await runtime.emit({ type: 'action.send', request: {} }, TRUSTED);
        expect(response.error.refusedBeforeSigning).toBe(true);
    });

    it('is stripped from what a web page receives', async () => {
        const runtime = runtimeBus();
        attachChromeRuntime(failing, runtime);
        const response = await runtime.emit({ type: 'bridge.getAccounts', request: { origin: WEB.origin } }, WEB);
        expect(response.ok).toBe(false);
        expect('refusedBeforeSigning' in response.error).toBe(false);
        expect(response.error.name).toBe('Error');
    });
});
