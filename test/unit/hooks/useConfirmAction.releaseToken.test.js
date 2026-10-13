// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

// The hook against the envelope a real shell hands it: composed through
// MessageHost and cloned across the wire, so the release arrives as a token
// rather than a function, and the hook must send that token back.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';
import { useConfirmAction } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';
import { MessageHost, RELEASE_ENCODER_INPUTS_TYPE } from '../../../packages/extension/src/background/MessageHost.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function settle(promise) {
    return promise.then((value) => ({ value }), (error) => ({ error }));
}

function makeHost() {
    let reserved = false;
    const encoder = {
        createTx: vi.fn(async () => {
            if (reserved) throw new Error('inputs are reserved');
            reserved = true;
            return { psbt: 'PSBTHEX', encoding: 'OP_RETURN', reservation: { id: 'input-1' } };
        }),
        releaseInputs: vi.fn(async () => { reserved = false; }),
    };
    const sdk = {
        encoder,
        actions: { createAction: () => ({ actionString: 'SEND|0|JDOG|1|addr', action: 'SEND', version: 0 }) },
        wallet: { decomposePsbt: () => ({ outputs: [{ address: 'source', value: 100 }] }) },
        decoder: {
            decodeActionStringFromPsbt: () => ({ ok: true, actionString: 'SEND|0|JDOG|1|addr' }),
            parse: () => ({ ok: false }),
        },
    };
    const deps = {
        vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
        sdkRegistry: { get: () => sdk },
        chainRegistry: { get: () => ({ coin: 'BTC', networkKind: 'regtest' }) },
    };
    const host = new MessageHost(deps);
    host.register('action.composeForConfirm', () => composeActionForConfirm({
        ...deps,
        chainId: 'btc',
        actionData: { action: 'SEND', params: { TICK: 'JDOG', AMOUNT: '1', DESTINATION: 'addr' } },
        encoderOpts: { pubkey: 'pub' },
        source: 'source',
    }));
    // What a shell's messaging.composeForConfirm resolves with: the host's result, cloned by the wire.
    const composeOverWire = async () => {
        const res = await host.handle({ type: 'action.composeForConfirm', request: {} });
        if (!res.ok) throw Object.assign(new Error(res.error.message), res.error);
        return structuredClone(res.result);
    };
    // What a shell's messaging.releaseEncoderInputs does with the token.
    const sendRelease = vi.fn(async (token) => {
        const res = await host.handle({ type: RELEASE_ENCODER_INPUTS_TYPE, request: { token } });
        if (!res.ok) throw Object.assign(new Error(res.error.message), res.error);
        return res.result;
    });
    return { encoder, composeOverWire, sendRelease, isReserved: () => reserved };
}

async function openConfirm(result, { compose, sendRelease, onApprove = async () => ({ txid: 'tx1' }) }) {
    // Composed before the hook runs, as the existing release tests do.
    const wire = await compose();
    let confirmation;
    await act(async () => {
        confirmation = settle(result.current.confirm({
            compose: async () => wire,
            onApprove,
            chainId: 'btc',
            releaseEncoderInputs: sendRelease,
        }));
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    return { confirmation };
}

describe('useConfirmAction releases a wire-shaped compose through its token', () => {
    it('the envelope the hook receives carries a token, not a function', async () => {
        const { composeOverWire } = makeHost();
        const wire = await composeOverWire();
        expect(wire).not.toHaveProperty('releaseEncoderInputs');
        expect(typeof wire.releaseEncoderInputsToken).toBe('string');
    });

    it('Reject sends the token once and the encoder frees the inputs', async () => {
        const h = makeHost();
        const hook = renderHook(() => useConfirmAction());
        const { confirmation } = await openConfirm(hook.result, { compose: h.composeOverWire, sendRelease: h.sendRelease });
        expect(h.isReserved()).toBe(true);

        await act(async () => {
            await hook.result.current.reject();
        });
        expect((await confirmation).error).toMatchObject({ reason: 'user-rejected' });
        hook.unmount();

        expect(h.sendRelease).toHaveBeenCalledOnce();
        expect(h.encoder.releaseInputs).toHaveBeenCalledWith('input-1');
        expect(h.isReserved()).toBe(false);
        // The next compose from the same source can fund again.
        await expect(h.composeOverWire()).resolves.toHaveProperty('releaseEncoderInputsToken');
    });

    it('unmounting an open confirmation sends the token', async () => {
        const h = makeHost();
        const hook = renderHook(() => useConfirmAction());
        await openConfirm(hook.result, { compose: h.composeOverWire, sendRelease: h.sendRelease });

        hook.unmount();

        await waitFor(() => expect(h.sendRelease).toHaveBeenCalledOnce());
        await waitFor(() => expect(h.isReserved()).toBe(false));
    });

    it('a compose that lands after Reject is released, not left held', async () => {
        const h = makeHost();
        let land;
        const gate = new Promise((resolve) => { land = resolve; });
        const compose = async () => { await gate; return h.composeOverWire(); };
        const hook = renderHook(() => useConfirmAction());
        let confirmation;
        await act(async () => {
            confirmation = settle(hook.result.current.confirm({
                compose, onApprove: async () => ({}), chainId: 'btc', releaseEncoderInputs: h.sendRelease,
            }));
        });
        await act(async () => {
            await hook.result.current.reject();
        });
        await act(async () => {
            land();
            await confirmation;
        });

        expect((await confirmation).error).toMatchObject({ reason: 'user-rejected' });
        await waitFor(() => expect(h.sendRelease).toHaveBeenCalledOnce());
        await waitFor(() => expect(h.isReserved()).toBe(false));
        hook.unmount();
    });

    it('never sends the token once Approve has begun', async () => {
        const h = makeHost();
        const hook = renderHook(() => useConfirmAction());
        const { confirmation } = await openConfirm(hook.result, { compose: h.composeOverWire, sendRelease: h.sendRelease });

        await act(async () => {
            await hook.result.current.approve({});
            await confirmation;
        });
        hook.unmount();

        expect(h.sendRelease).not.toHaveBeenCalled();
        expect(h.isReserved()).toBe(true);
    });

    it('a failed send keeps the confirmation open, and Reject again resends', async () => {
        const h = makeHost();
        const real = h.sendRelease.getMockImplementation();
        h.sendRelease.mockImplementationOnce(async () => { throw new Error('host unreachable'); });
        const hook = renderHook(() => useConfirmAction());
        const { confirmation } = await openConfirm(hook.result, { compose: h.composeOverWire, sendRelease: h.sendRelease });

        await act(async () => {
            await hook.result.current.reject();
        });
        expect(hook.result.current.phase).toBe('ready');
        expect(hook.result.current.error?.message).toMatch(/release.*try reject again/i);
        expect(h.isReserved()).toBe(true);

        h.sendRelease.mockImplementation(real);
        await act(async () => {
            await hook.result.current.reject();
        });
        expect(h.sendRelease).toHaveBeenCalledTimes(2);
        expect((await confirmation).error).toMatchObject({ reason: 'user-rejected' });
        expect(h.isReserved()).toBe(false);
        hook.unmount();
    });

    it('every confirm call site that checks a host-composed PSBT also wires the release sender', () => {
        const shared = join(process.cwd(), 'packages', 'core', 'src', 'shared');
        const sources = readdirSync(shared, { recursive: true })
            .filter((rel) => /\.(js|jsx)$/.test(rel))
            .map((rel) => ({ rel, src: readFileSync(join(shared, rel), 'utf8') }));
        const count = (src, re) => (src.match(re) || []).length;
        const LIVENESS = /checkInputs: \(psbtHex\) => messaging\.checkInputLiveness\(/g;
        const RELEASE = /releaseEncoderInputs: \(token\) => messaging\.releaseEncoderInputs\(\{ token \}\)/g;
        const sites = sources.filter(({ src }) => count(src, LIVENESS) > 0);
        expect(sites.length).toBeGreaterThanOrEqual(10);
        const unwired = sites
            .filter(({ src }) => count(src, RELEASE) !== count(src, LIVENESS))
            .map(({ rel }) => rel);
        expect(unwired).toEqual([]);
    });

    it('with no sender wired, Reject still settles and the gap is logged', async () => {
        const h = makeHost();
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const hook = renderHook(() => useConfirmAction());
        const { confirmation } = await openConfirm(hook.result, { compose: h.composeOverWire, sendRelease: undefined });

        await act(async () => {
            await hook.result.current.reject();
        });
        hook.unmount();

        expect((await confirmation).error).toMatchObject({ reason: 'user-rejected' });
        expect(logged.mock.calls.filter(([msg]) => /no releaseEncoderInputs sender/.test(String(msg)))).toHaveLength(1);
    });
});
