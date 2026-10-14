// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    MessageHost,
    RELEASE_ENCODER_INPUTS_TYPE,
    hydrateEnvelopeError,
    serializeError,
} from '../../../packages/extension/src/background/MessageHost.js';

const deps = () => ({ vault: {}, chainRegistry: {}, sdkRegistry: {} });

afterEach(() => vi.unstubAllGlobals());

describe('MessageHost edge branches', () => {
    it.each([
        [{}, 'deps.vault is required'],
        [{ vault: {} }, 'deps.chainRegistry is required'],
        [{ vault: {}, chainRegistry: {} }, 'deps.sdkRegistry is required'],
    ])('rejects incomplete dependencies', (value, message) => {
        expect(() => new MessageHost(value)).toThrow(message);
    });

    it('rejects invalid and duplicate registrations', () => {
        const host = new MessageHost(deps());
        expect(() => host.register('', vi.fn())).toThrow('type must be a non-empty string');
        expect(() => host.register('wallet.list', null)).toThrow('handler must be a function');
        host.register('wallet.list', vi.fn());
        expect(() => host.register('wallet.list', vi.fn())).toThrow('already registered');
    });

    it.each([
        [null, 'message must be an object'],
        [{}, 'message.type must be a non-empty string'],
        [{ type: '' }, 'message.type must be a non-empty string'],
    ])('serializes an invalid message', async (message, reason) => {
        const response = await new MessageHost(deps()).handle(message);
        expect(response).toMatchObject({
            ok: false,
            error: { name: 'InvalidMessageError' },
        });
        expect(response.error.message).toContain(reason);
    });

    it('serializes missing handlers and synchronous handler throws', async () => {
        const host = new MessageHost(deps());
        await expect(host.handle({ type: 'missing' })).resolves.toMatchObject({
            ok: false,
            error: { name: 'UnknownMessageTypeError' },
        });
        host.register('throws', () => { throw new RangeError('bad range'); });
        await expect(host.handle({ type: 'throws' })).resolves.toEqual({
            ok: false,
            error: { name: 'RangeError', message: 'bad range' },
        });
    });

    it('evicts the oldest release token when the pending-release cap is exceeded', async () => {
        let nextId = 0;
        vi.stubGlobal('crypto', { randomUUID: () => `release-${nextId++}` });
        const releases = Array.from({ length: 65 }, () => vi.fn(async () => {}));
        const host = new MessageHost(deps());
        let call = 0;
        host.register('compose', () => ({ releaseEncoderInputs: releases[call++] }));

        const tokens = [];
        for (let index = 0; index < releases.length; index += 1) {
            const response = await host.handle({ type: 'compose' });
            tokens.push(response.result.releaseEncoderInputsToken);
        }

        await expect(host.handle({
            type: RELEASE_ENCODER_INPUTS_TYPE,
            request: { token: tokens[0] },
        })).resolves.toEqual({ ok: true, result: { released: false } });
        await expect(host.handle({
            type: RELEASE_ENCODER_INPUTS_TYPE,
            request: { token: tokens.at(-1) },
        })).resolves.toEqual({ ok: true, result: { released: true } });
        expect(releases[0]).not.toHaveBeenCalled();
        expect(releases.at(-1)).toHaveBeenCalledOnce();
    });

    it('keeps only supported finite structured error fields', () => {
        const error = Object.assign(new Error('slow down'), {
            code: 'THROTTLED',
            retryAfterMs: 500,
            burst: Number.POSITIVE_INFINITY,
            windowMs: Number.NaN,
        });
        expect(serializeError(error)).toEqual({
            ok: false,
            error: {
                name: 'Error',
                message: 'slow down',
                code: 'THROTTLED',
                retryAfterMs: 500,
            },
        });
        expect(serializeError(null)).toEqual({
            ok: false,
            error: { name: 'Error', message: 'null' },
        });
    });

    it('hydrates fallback text and ignores invalid structured fields', () => {
        const error = hydrateEnvelopeError({
            name: '',
            message: '',
            code: '',
            retryAfterMs: Number.POSITIVE_INFINITY,
            burst: 4,
        }, 'fallback failure');
        expect(error).toMatchObject({ name: 'Error', message: 'fallback failure', burst: 4 });
        expect(error).not.toHaveProperty('code');
        expect(error).not.toHaveProperty('retryAfterMs');
    });
});
