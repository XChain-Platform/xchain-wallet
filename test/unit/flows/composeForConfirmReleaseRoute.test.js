import { describe, it, expect, vi } from 'vitest';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';
import { MessageHost, RELEASE_ENCODER_INPUTS_TYPE } from '../../../packages/extension/src/background/MessageHost.js';

function makeHarness() {
    let reserved = false;
    const encoder = {
        createTx: vi.fn(async () => {
            if (reserved) throw new Error('inputs are reserved');
            reserved = true;
            return { psbt: 'PSBTHEX', encoding: 'OP_RETURN', reservation: { id: 'input-1' } };
        }),
        releaseInputs: vi.fn(async (id) => {
            if (id !== 'input-1') throw new Error('unknown reservation');
            reserved = false;
        }),
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
    return { host, encoder, isReserved: () => reserved };
}

async function compose(host) {
    const res = await host.handle({ type: 'action.composeForConfirm', request: {} });
    expect(res.ok).toBe(true);
    // The wire is a structured clone: a function member would throw or vanish.
    return structuredClone(res.result);
}

describe('release across the host boundary', () => {
    it('replaces the release function with a token that survives the wire', async () => {
        const { host } = makeHarness();
        const wire = await compose(host);
        expect(wire).not.toHaveProperty('releaseEncoderInputs');
        expect(typeof wire.releaseEncoderInputsToken).toBe('string');
    });

    it('releases the reserved inputs when the token is sent back', async () => {
        const { host, encoder, isReserved } = makeHarness();
        const wire = await compose(host);
        expect(isReserved()).toBe(true);
        const res = await host.handle({
            type: RELEASE_ENCODER_INPUTS_TYPE,
            request: { token: wire.releaseEncoderInputsToken },
        });
        expect(res).toEqual({ ok: true, result: { released: true } });
        expect(encoder.releaseInputs).toHaveBeenCalledWith('input-1');
        expect(isReserved()).toBe(false);
    });

    it('releases once, then reports nothing left to release', async () => {
        const { host, encoder } = makeHarness();
        const wire = await compose(host);
        const msg = { type: RELEASE_ENCODER_INPUTS_TYPE, request: { token: wire.releaseEncoderInputsToken } };
        await host.handle(msg);
        const again = await host.handle(msg);
        expect(again).toEqual({ ok: true, result: { released: false } });
        expect(encoder.releaseInputs).toHaveBeenCalledTimes(1);
    });

    it('keeps the token usable after a failed release', async () => {
        const { host, encoder } = makeHarness();
        const wire = await compose(host);
        encoder.releaseInputs.mockRejectedValueOnce(new Error('node down'));
        const msg = { type: RELEASE_ENCODER_INPUTS_TYPE, request: { token: wire.releaseEncoderInputsToken } };
        const first = await host.handle(msg);
        expect(first.ok).toBe(false);
        expect(first.error.message).toBe('node down');
        expect(await host.handle(msg)).toEqual({ ok: true, result: { released: true } });
    });

    it('refuses a missing token and ignores an unknown one', async () => {
        const { host, encoder } = makeHarness();
        const missing = await host.handle({ type: RELEASE_ENCODER_INPUTS_TYPE, request: {} });
        expect(missing.ok).toBe(false);
        const unknown = await host.handle({ type: RELEASE_ENCODER_INPUTS_TYPE, request: { token: 'nope' } });
        expect(unknown).toEqual({ ok: true, result: { released: false } });
        expect(encoder.releaseInputs).not.toHaveBeenCalled();
    });
});
