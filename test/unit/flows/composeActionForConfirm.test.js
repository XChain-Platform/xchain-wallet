// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// composeActionForConfirm (§5.3): the HOST half of the single-encode
// pipeline. Wraps composeForConfirm and runs the tamper check host-side
// (decomposePsbt + decodeActionFromPsbt live here), returning a serializable,
// already-verified ComposedAction. A tamper throws.

import { describe, it, expect, vi } from 'vitest';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';
import { TamperDetectedError } from '../../../packages/core/src/flows/confirmChecks.js';

// Harness: an SDK with encoder/actions (for compose) plus wallet.decomposePsbt
// and decoder.decodeActionStringFromPsbt (the raw self-sign byte-match uses the
// policy-free extractor, not the co-signer's decodeActionFromPsbt). `outputs`
// and `decoded` control what the tamper check sees.
function makeHarness({ outputs, decoded, inputs } = {}) {
    const sdk = {
        encoder: { createTx: vi.fn(async () => ({ psbt: 'PSBTHEX', encoding: 'OP_RETURN' })) },
        actions: { createAction: vi.fn(() => ({ actionString: 'SEND|0|JDOG|1|addr', action: 'SEND', version: 0 })) },
        wallet: {
            decomposePsbt: vi.fn(() => ({
                ...(inputs ? { inputs } : {}),
                outputs: outputs || [
                    { address: null, scriptPubKeyHex: '6a20deadbeef', scriptType: 'unknown', value: 0 }, // OP_RETURN carrier
                    { address: 'chg', scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 100 },        // change to own
                ],
            })),
        },
        decoder: {
            decodeActionStringFromPsbt: vi.fn(() => decoded || { ok: true, actionString: 'SEND|0|JDOG|1|addr' }),
            // The intent is described by the SDK, so the double is the
            // SDK's describer. Deliberately NOT a copy of the real wording -
            // a stub that imitates product copy invites assertions that pass on
            // the stub's phrasing; this one only echoes what it was handed, so
            // the tests below can only be about provenance.
            describe: vi.fn((parsed) => ({
                summary: `described:${JSON.stringify(parsed.params)}`,
                details: [],
                warnings: [],
            })),
        },
    };
    const sdkRegistry = { get: () => sdk };
    const chainRegistry = { get: () => ({ coin: 'BTC', networkKind: 'regtest', adsDonationAddress: 'XXXX' }) };
    const vault = { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } };
    return { sdk, sdkRegistry, chainRegistry, vault };
}

const ARGS = (h) => ({
    vault: h.vault, chainRegistry: h.chainRegistry, sdkRegistry: h.sdkRegistry,
    chainId: 'btc',
    actionData: { action: 'SEND', params: { TICK: 'JDOG', AMOUNT: '1', DESTINATION: 'addr' } },
    encoderOpts: { pubkey: 'pub' },
    source: 'chg',
    ownAddresses: ['chg'],
});

describe('composeActionForConfirm', () => {

    it('returns a serializable, tamper-verified ComposedAction on a clean build', async () => {
        const h = makeHarness();
        const composed = await composeActionForConfirm(ARGS(h));
        expect(composed.tamperVerified).toBe(true);
        expect(composed.psbt).toBe('PSBTHEX');
        expect(composed.actionString).toBe('SEND|0|JDOG|1|addr');
        // No encoderOpts leaks over the wire (dropped from the envelope).
        expect(composed.encoderOpts).toBeUndefined();
        expect(h.sdk.wallet.decomposePsbt).toHaveBeenCalled();
        expect(h.sdk.decoder.decodeActionStringFromPsbt).toHaveBeenCalled();
        // The chain travels with the envelope so display code can resolve
        // chain-scoped formatting without every call site threading it.
        expect(composed.chainId).toBe('btc');
    });

    // §5.2.5: the confirm surface must show the fee these bytes actually pay,
    // not the caller's rate estimate.
    it('reports the EXACT network fee of the built PSBT', async () => {
        const h = makeHarness({ inputs: [{ value: 5000 }, { value: 1000 }] });
        const composed = await composeActionForConfirm(ARGS(h));
        // 6000 in - (0 carrier + 100 change) out = 5900.
        expect(composed.networkFeeSats).toBe(5900);
    });

    // §5.2.3: deltas are computed host-side from the PARSED COMPOSED action, so
    // every confirm surface gets them without wiring its own simulator (they
    // all passed simulation={null}, leaving the section dead everywhere).
    it('projects balance deltas from the parsed composed action', async () => {
        const h = makeHarness({ inputs: [{ value: 5000 }, { value: 1000 }] });
        // The canonical source is the composed action string, not the caller's
        // form params: parse() is what feeds the simulator.
        h.sdk.decoder.parse = vi.fn(() => ({
            ok: true,
            action: 'SEND',
            params: { TICK: 'JDOG', AMOUNT: '1', DESTINATION: 'dest' },
        }));
        h.sdk.getBalances = vi.fn(async () => ([{ tick: 'JDOG', quantity: '10', divisibility: 8 }]));
        h.sdk.getAddress = vi.fn(async () => ({ balance: '100000000' }));
        h.chainRegistry.descriptorFor = () => ({ coin: 'bitcoin', networkKind: 'regtest' });

        const composed = await composeActionForConfirm(ARGS(h));
        expect(h.sdk.decoder.parse).toHaveBeenCalledWith('SEND|0|JDOG|1|addr');
        expect(composed.simulation).toBeTruthy();
    });

    // §1.1 / §5.2.2. The decisive case: the caller's params and the composed
    // action string DISAGREE. That is the mirror-drift hazard - a form
    // that hand-builds wire params can produce a self-consistent PSBT for the
    // wrong action, and the previous surface would have described the form's
    // version of events while signing the encoder's. The intent must state
    // what was composed.
    it('describes the COMPOSED action, not the caller form params', async () => {
        const h = makeHarness({ inputs: [{ value: 5000 }] });
        h.sdk.decoder.parse = vi.fn(() => ({
            ok: true,
            action: 'SEND',
            // What the encoder actually built: a different tick and amount
            // from the ARGS() form params below.
            params: { TICK: 'REALTICK', AMOUNT: '42', DESTINATION: 'realdest' },
        }));
        const composed = await composeActionForConfirm(ARGS(h));
        expect(composed.decoded.summary).toContain('42');
        expect(composed.decoded.summary).toContain('REALTICK');
        expect(composed.decoded.summary).toContain('realdest');
        // And emphatically NOT the form's claim.
        expect(composed.decoded.summary).not.toContain('JDOG');
    });

    // The describer itself is the SDK's (§3.2), not the wallet's own
    // copy. Two implementations of "what does this action say" is two things to
    // drift, and the wallet copy had already fallen behind: it described 13
    // actions to the SDK's 30, so ORDER, SWAP, STAKE, VOTE, DEPLOY and the rest
    // reached the SIGNING screen on the generic "no plain-English summary"
    // fallback.
    it('describes via sdk.decoder.describe, handed the parsed composed action', async () => {
        const h = makeHarness({ inputs: [{ value: 5000 }] });
        const parsed = { ok: true, action: 'SEND', params: { TICK: 'REALTICK', AMOUNT: '42', DESTINATION: 'realdest' } };
        h.sdk.decoder.parse = vi.fn(() => parsed);
        await composeActionForConfirm(ARGS(h));
        expect(h.sdk.decoder.describe).toHaveBeenCalledOnce();
        const [handed, ctx] = h.sdk.decoder.describe.mock.calls[0];
        expect(handed).toBe(parsed);
        // §3.2 extended ctx: own addresses so a destination the user already
        // controls is marked as such on the screen where it matters.
        expect(ctx.ownAddresses).toContain('chg');
        expect(ctx.chainId).toBe('btc');
    });

    it('leaves the intent null when the composed action cannot be described', async () => {
        // Null, so the caller's own `decoded` still renders: a confirm page
        // with no intent line is worse than one described from the params that
        // built the bytes.
        const h = makeHarness({ inputs: [{ value: 5000 }] });
        h.sdk.decoder.parse = vi.fn(() => ({ ok: false, code: 'UNKNOWN_ACTION' }));
        const composed = await composeActionForConfirm(ARGS(h));
        expect(composed.decoded).toBe(null);
        expect(composed.tamperVerified).toBe(true);
    });

    it('leaves the simulation null when it cannot be computed', async () => {
        // A delta the wallet cannot compute must be ABSENT, never a zero that
        // reads as "nothing changes". The harness has no balances source.
        const h = makeHarness({ inputs: [{ value: 5000 }] });
        h.sdk.decoder.parse = vi.fn(() => ({ ok: true, action: 'SEND', params: {} }));
        h.sdk.getBalances = vi.fn(async () => { throw new Error('explorer down'); });
        h.sdk.getAddress = vi.fn(async () => { throw new Error('explorer down'); });
        h.chainRegistry.descriptorFor = () => ({ coin: 'bitcoin', networkKind: 'regtest' });
        const composed = await composeActionForConfirm(ARGS(h));
        expect(composed.simulation).toBe(null);
        // The rest of the envelope still stands: a dead explorer must not
        // block composing or signing.
        expect(composed.tamperVerified).toBe(true);
    });

    //`networkFeeSats` is inputs-minus-outputs, so a protocol fee paid
    // as an OUTPUT is excluded from it by construction - and the confirm screen
    // was projecting that number as the whole cost. The quote that sized the
    // output is already on the envelope, so the projection can use it.
    it('projects the native-coin protocol fee on top of the exact miner fee', async () => {
        const h = makeHarness({
            inputs: [{ value: 500000 }],
            outputs: [
                { address: null, scriptPubKeyHex: '6a20deadbeef', scriptType: 'unknown', value: 0 },
                { address: 'feedest', scriptPubKeyHex: '0014fe', scriptType: 'p2wpkh', value: 2000 },
                { address: 'chg', scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 497000 },
            ],
        });
        h.sdk.quoteNativeFee = vi.fn(async () => ({
            supported: true, valid: true, requiredFeeSats: 2000, feeDestination: 'feedest',
        }));
        h.sdk.decoder.parse = vi.fn(() => ({
            ok: true,
            action: 'ISSUE',
            params: { VERSION: '0', TICK: 'S19FEE', MAX_SUPPLY: '1000', MINT_SUPPLY: '1000' },
        }));
        h.sdk.getBalances = vi.fn(async () => ({ data: [] }));
        h.sdk.getAddress = vi.fn(async () => ({ balances: { confirmed: '3' } }));
        h.chainRegistry.descriptorFor = () => ({ coin: 'bitcoin', networkKind: 'regtest' });

        const composed = await composeActionForConfirm({
            ...ARGS(h),
            encoderOpts: { pubkey: 'pub', payFeeInNativeCoin: true },
        });

        // The miner fee stays what the bytes pay: 500000 in, 499000 out.
        expect(composed.networkFeeSats).toBe(1000);
        expect(composed.protocolFeeSats).toBe(2000);
        const protocolRow = composed.simulation.deltas.find((d) => d.isProtocolFee);
        expect(protocolRow.feeAmount).toBe('0.00002');
        // 3 BTC less the 1000-sat miner fee less the 2000-sat protocol fee.
        const coinRow = composed.simulation.deltas.find((d) => d.isCoin && d.before !== '');
        expect(coinRow.after).toBe('2.99997');

        // D-119: WHICH LANE has to cross the boundary too. This envelope is a
        // whitelist, and a field the popup cannot see may as well not exist -
        // the confirm screen used it to ask the network dry run the right
        // question, and without it a payer with no XCHAIN was told a correct
        // action would fail. The unit test on the hook passed throughout,
        // because it stubs the compose; only the live drive and this
        // assertion see the gap.
        expect(composed.payFeeInNativeCoin,
            'the composed envelope does not say it pays the protocol fee in coin')
            .toBe(true);
    });

    it('reports no protocol fee when the action pays it in XCHAIN', async () => {
        // Nothing was quoted on that lane, and a fee the wallet has not been
        // told is a fee it must not invent.
        const h = makeHarness({ inputs: [{ value: 5000 }] });
        h.sdk.decoder.parse = vi.fn(() => ({ ok: true, action: 'SEND', params: { TICK: 'JDOG', AMOUNT: '1', DESTINATION: 'dest' } }));
        h.sdk.getBalances = vi.fn(async () => ([]));
        h.sdk.getAddress = vi.fn(async () => ({ balance: '300000000' }));
        h.chainRegistry.descriptorFor = () => ({ coin: 'bitcoin', networkKind: 'regtest' });
        const composed = await composeActionForConfirm(ARGS(h));
        expect(composed.protocolFeeSats).toBe(null);
        expect(composed.simulation.deltas.some((d) => d.isProtocolFee)).toBe(false);
    });

    //The confirm screen's XCHAIN-lane fee line used to have exactly
    // one source, the Tier-1 dry-run report - which is best-effort and drops
    // out on a busy venue, taking the fee statement with it and leaving that
    // screen behind. So the envelope carries the wallet's own quote too.
    describe('the XCHAIN-lane protocol fee on the envelope', () => {
        const quoting = (quote) => {
            const h = makeHarness({ inputs: [{ value: 5000 }] });
            h.sdk.quoteNativeFee = vi.fn(async () => quote);
            return h;
        };

        it('carries the quoted XCHAIN fee as the decimal string the wire sent', async () => {
            const h = quoting({ supported: true, valid: true, xchainFee: '1.00000000' });
            const composed = await composeActionForConfirm(ARGS(h));
            expect(composed.xchainFee).toBe('1.00000000');
            // Asked about the action being composed, from the source paying it.
            expect(h.sdk.quoteNativeFee).toHaveBeenCalledWith(
                ARGS(h).actionData, expect.objectContaining({ source: 'chg' }),
            );
        });

        it('does not quote at all in native-coin mode', async () => {
            // That lane already has a quote it sized a real output from, and a
            // second XCHAIN figure beside a coin debit reads as a second charge.
            const h = quoting({ supported: true, valid: true, xchainFee: '1.00000000' });
            const composed = await composeActionForConfirm({
                ...ARGS(h), encoderOpts: { pubkey: 'pub', payFeeInNativeCoin: true },
            });
            expect(composed.xchainFee).toBe(null);
            // Exactly ONE quote on this lane - the one applyNativeFeePreflight
            // sizes the FEE_DESTINATION output from. A second call here would
            // mean the display path was quoting on top of the spending path.
            expect(h.sdk.quoteNativeFee).toHaveBeenCalledTimes(1);
        });

        it('stays null on a zero fee, a refused quote, or no quote endpoint', async () => {
            // Zero is the failure in the other direction: an action that
            // charges nothing must not be told it charges something.
            expect((await composeActionForConfirm(ARGS(
                quoting({ supported: true, valid: true, xchainFee: '0.00000000' }),
            ))).xchainFee).toBe(null);
            expect((await composeActionForConfirm(ARGS(
                quoting({ supported: true, valid: false, xchainFee: '1.00000000' }),
            ))).xchainFee).toBe(null);
            expect((await composeActionForConfirm(ARGS(
                quoting({ supported: false }),
            ))).xchainFee).toBe(null);
            // An SDK too old to quote, and a venue that throws: a line the
            // wallet cannot draw must never be a compose that fails.
            const old = makeHarness({ inputs: [{ value: 5000 }] });
            expect((await composeActionForConfirm(ARGS(old))).xchainFee).toBe(null);
            const dead = quoting(null);
            dead.sdk.quoteNativeFee = vi.fn(async () => { throw new Error('explorer down'); });
            expect((await composeActionForConfirm(ARGS(dead))).xchainFee).toBe(null);
        });

        it('still prices a static (unvalidated) quote, where valid is null', async () => {
            // DEPLOY/EXECUTE are priced from the gas schedule without a dry
            // run. `valid: null` is the third answer, not a refusal, and those
            // two are the actions most in need of a stated fee.
            const h = quoting({ supported: true, valid: null, staticQuote: true, xchainFee: '0.50000000' });
            expect((await composeActionForConfirm(ARGS(h))).xchainFee).toBe('0.50000000');
        });

        it('does not quote a bare native payment', async () => {
            // No XChain action, so no protocol fee to state - and this
            // is the wallet's commonest operation, so it pays no round trip.
            // A bare payment carries no OP_RETURN, so the harness's outputs are
            // the payment and the change; the default carrier output would fail
            // the tamper check here for an unrelated reason.
            const h = makeHarness({
                inputs: [{ value: 200000000 }],
                outputs: [
                    { address: 'addr', scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 100000000 },
                    { address: 'chg', scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 99999000 },
                ],
            });
            h.sdk.quoteNativeFee = vi.fn(async () => ({ supported: true, valid: true, xchainFee: '1.00000000' }));
            const composed = await composeActionForConfirm({
                ...ARGS(h),
                actionData: { action: 'SEND', params: { TICK: 'BTC', AMOUNT: '1', DESTINATION: 'addr' } },
            });
            expect(composed.xchainFee).toBe(null);
            expect(h.sdk.quoteNativeFee).not.toHaveBeenCalled();
        });
    });

    it('reports a null fee when the PSBT omits an input value', async () => {
        // Without every input value the difference is an underestimate, and a
        // too-small fee shown on a signing screen is worse than "unavailable".
        const h = makeHarness({ inputs: [{ value: 5000 }, { value: null }] });
        const composed = await composeActionForConfirm(ARGS(h));
        expect(composed.networkFeeSats).toBe(null);
    });

    it('throws a tamper error when the PSBT carries an output the user did not approve', async () => {
        const h = makeHarness({
            outputs: [
                { address: null, scriptPubKeyHex: '6a20deadbeef', scriptType: 'unknown', value: 0 },
                { address: 'ATTACKER', scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 999 },
            ],
        });
        await expect(composeActionForConfirm(ARGS(h))).rejects.toThrow(TamperDetectedError);
        await expect(composeActionForConfirm(ARGS(h))).rejects.toThrow(/did not approve/);
    });

    it('throws a tamper error when the encoded action bytes do not match', async () => {
        const h = makeHarness({ decoded: { ok: true, actionString: 'SEND|0|JDOG|1|ATTACKER' } });
        await expect(composeActionForConfirm(ARGS(h))).rejects.toThrow(/does not match/);
    });

    it('treats the source address as own even when ownAddresses omits it', async () => {
        const h = makeHarness();
        const composed = await composeActionForConfirm({ ...ARGS(h), ownAddresses: [] });
        // change to 'chg' (the source) must still pass as own-change.
        expect(composed.tamperVerified).toBe(true);
    });

    it('requires a pubkey in encoderOpts', async () => {
        const h = makeHarness();
        await expect(composeActionForConfirm({ ...ARGS(h), encoderOpts: {} }))
            .rejects.toThrow(/pubkey is required/);
    });
});

// The P2SH/P2WSH chunk lanes, which check 2 skips and check 3 owns.
//
// Found by driving a three-recipient SEND through the real form on regtest: the
// action is past one OP_RETURN, so the encoder picks P2SH, and the confirm
// pipeline refused it with "The action encoded in the transaction does not
// match what you approved" before the modal ever opened. The verifier was
// working exactly as designed (it fails CLOSED with SCRIPTS_MISSING); it was
// being handed `undefined`, because composeForConfirm dropped the scripts the
// encoder returned. Every existing test around check 3 supplies its own
// scripts, so nothing in the suite could see the wiring gap.
describe('composeActionForConfirm on a chunk lane', () => {
    const ACTION = 'SEND|1|^1|7|alice|3|bob|1|carol';

    function makeChunkHarness({ carrierScripts } = {}) {
        const verifyCarrierScripts = vi.fn(({ carrierScripts: scripts }) => (
            Array.isArray(scripts) && scripts.length
                ? { ok: true, reason: null, checked: scripts.length }
                : { ok: false, reason: 'SCRIPTS_MISSING', checked: 0 }
        ));
        const sdk = {
            encoder: {
                createTx: vi.fn(async () => ({
                    psbt: 'PSBTHEX',
                    encoding: 'P2SH',
                    ...(carrierScripts ? { carrierScripts } : {}),
                })),
            },
            actions: { createAction: vi.fn(() => ({ actionString: ACTION, action: 'SEND', version: 1 })) },
            wallet: {
                decomposePsbt: vi.fn(() => ({
                    outputs: [
                        // The P2SH data carrier, and change back to the source.
                        { address: null, scriptPubKeyHex: `a914${'11'.repeat(20)}87`, scriptType: 'p2sh', value: 546 },
                        { address: 'chg', scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 100 },
                    ],
                })),
            },
            decoder: {
                // Never consulted on this lane (check 2 skips a non-OP_RETURN
                // encoding); present so a call would be visible if that changed.
                decodeActionStringFromPsbt: vi.fn(() => ({ ok: true, actionString: ACTION })),
                describe: vi.fn(() => ({ summary: 'described', details: [], warnings: [] })),
                verifyCarrierScripts,
            },
            config: { network: 'regtest' },
        };
        return {
            sdk,
            verifyCarrierScripts,
            sdkRegistry: { get: () => sdk },
            chainRegistry: { get: () => ({ coin: 'BTC', networkKind: 'regtest', adsDonationAddress: 'XXXX' }) },
            vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
        };
    }

    const CHUNK_ARGS = (h) => ({
        vault: h.vault, chainRegistry: h.chainRegistry, sdkRegistry: h.sdkRegistry,
        chainId: 'btc',
        actionData: { action: 'SEND', params: { legs: [] } },
        encoderOpts: { pubkey: 'pub' },
        source: 'chg',
        ownAddresses: ['chg'],
    });

    it('hands the verifier the scripts create_tx committed to', async () => {
        const h = makeChunkHarness({ carrierScripts: ['aa11', 'bb22'] });
        const composed = await composeActionForConfirm(CHUNK_ARGS(h));
        expect(composed.tamperVerified).toBe(true);
        expect(h.verifyCarrierScripts).toHaveBeenCalledTimes(1);
        const args = h.verifyCarrierScripts.mock.calls[0][0];
        expect(args.carrierScripts).toEqual(['aa11', 'bb22']);
        // The verifier reads the outputs off the PSBT being signed, and the
        // action it compares against is the composed one, not form params.
        expect(args.psbt).toBe('PSBTHEX');
        expect(args.encoding).toBe('P2SH');
        expect(args.actionString).toBe(ACTION);
    });

    it('still fails closed when the encoder returns no scripts at all', async () => {
        // The point of the fix is delivery, not leniency: an encoder that
        // cannot say what it committed to is still unverifiable, and this lane
        // carries the largest payloads in the protocol.
        const h = makeChunkHarness();
        await expect(composeActionForConfirm(CHUNK_ARGS(h))).rejects.toThrow(TamperDetectedError);
    });
});
