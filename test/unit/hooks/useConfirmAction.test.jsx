// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// useConfirmAction hook (§5.3.5): busy singleton, compose-failure
// path, superseded-report guard, and the promise contract. All SDK work is
// HOST-side (compose + tamper + preflight over messaging); the hook is a
// pure UI state machine, so these tests inject a `compose` promise and a
// `preflight` callback rather than a client sdkRegistry. Tamper detection
// itself lives in the composeActionForConfirm flow test.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import {
    useConfirmAction, ConfirmActionBusyError, UserRejectedError,
} from '../../../packages/core/src/shared/hooks/useConfirmAction.js';

afterEach(() => cleanup());

// A host-preflight stub: the hook calls it with { actionString, source, ... }.
function preflightWith(report) {
    return vi.fn(async () => report || { verdict: 'pass', findings: [], unverified: [], stateHeight: 1 });
}

const COMPOSED = {
    actionString: 'SEND|0|JDOG|1|addr', action: 'SEND', version: 0,
    psbt: 'PSBT', encoding: 'OP_RETURN',
    expectedOutputs: { addressed: [], encoding: 'OP_RETURN' },
    tamperVerified: true,
};

describe('useConfirmAction', () => {

    // Capture a promise's settled outcome INSIDE act() so a rejection never
    // leaks as an unhandled rejection between act boundaries.
    const settle = (p) => p.then((v) => ({ ok: v }), (e) => ({ err: e }));

    it('rejects a second concurrent confirm() with a busy reason', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const preflight = preflightWith();
        let p1, out2;
        await act(async () => {
            p1 = settle(result.current.confirm({
                compose: () => new Promise(() => {}),   // never resolves; stays composing
                onApprove: async () => 'ok', chainId: 'btc', preflight,
            }));
            out2 = await settle(result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => 'ok', chainId: 'btc', preflight }));
        });
        expect(out2.err).toBeInstanceOf(ConfirmActionBusyError);
        // Clean up the hanging first confirm.
        let out1;
        await act(async () => { result.current.reject(); out1 = await p1; });
        expect(out1.err).toBeInstanceOf(UserRejectedError);
    });

    it('a compose failure (incl. a host-side tamper) rejects unwrapped and never opens the modal', async () => {
        const { result } = renderHook(() => useConfirmAction());
        let out;
        await act(async () => {
            out = await settle(result.current.confirm({
                // A tamper throws host-side inside compose(); the hook sees a
                // rejected compose() and never opens the modal.
                compose: async () => { throw new Error('The transaction contains 1 output(s) you did not approve.'); },
                onApprove: async () => 'ok', chainId: 'btc', preflight: preflightWith(),
            }));
        });
        expect(out.err.message).toMatch(/did not approve/);
        expect(result.current.phase).toBe('idle');
    });

    it('reaches ready with a report after a clean compose + preflight', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const preflight = preflightWith({ verdict: 'pass', findings: [], unverified: [], stateHeight: 9 });
        await act(async () => {
            result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => 'ok', chainId: 'btc', preflight });
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        expect(result.current.report.stateHeight).toBe(9);
        expect(result.current.canApprove).toBe(true);
        // preflight was called with the composed action string.
        expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ actionString: COMPOSED.actionString }));
    });

    it('goes ready with a null report when no preflight backend is supplied', async () => {
        const { result } = renderHook(() => useConfirmAction());
        await act(async () => {
            result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => 'ok', chainId: 'btc' });
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        expect(result.current.report).toBe(null);
        expect(result.current.canApprove).toBe(true);
    });

    it('resolves with onApprove return value on approve()', async () => {
        const { result } = renderHook(() => useConfirmAction());
        let p;
        await act(async () => { p = result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => ({ txid: 'T' }), chainId: 'btc', preflight: preflightWith() }); });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        await act(async () => { await result.current.approve({ password: 'pw' }); });
        await expect(p).resolves.toEqual({ txid: 'T' });
    });

    it('rejects with user-rejected on reject()', async () => {
        const { result } = renderHook(() => useConfirmAction());
        let p;
        await act(async () => { p = settle(result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => 'x', chainId: 'btc', preflight: preflightWith() })); });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        let out;
        await act(async () => { result.current.reject(); out = await p; });
        expect(out.err).toBeInstanceOf(UserRejectedError);
    });

    it('§5.3.4: a bad password re-prompts on the SAME PSBT - back to ready, promise still PENDING', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const badPw = Object.assign(new Error('Incorrect password.'), { name: 'InvalidPasswordError' });
        let calls = 0;
        let p; let settled = false;
        await act(async () => {
            p = result.current.confirm({
                compose: async () => COMPOSED,
                onApprove: async () => {
                    calls += 1;
                    if (calls === 1) throw badPw;
                    return { txid: 'T' };
                },
                chainId: 'btc', preflight: preflightWith(),
            });
            p.then(() => { settled = true; }, () => { settled = true; });
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));

        // First Approve: bad password -> stays open at `ready`, error surfaced,
        // and crucially the confirm() promise has NOT settled.
        await act(async () => { await result.current.approve({}); });
        expect(result.current.phase).toBe('ready');
        expect(result.current.error).toBe(badPw);
        expect(settled).toBe(false);

        // Retry succeeds against the SAME composed PSBT (no re-compose).
        await act(async () => { await result.current.approve({}); });
        await expect(p).resolves.toEqual({ txid: 'T' });
        expect(calls).toBe(2);
    });

    it('does NOT double-reserve when a credential failure re-prompts', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const badPw = Object.assign(new Error('bad'), { name: 'InvalidPasswordError' });
        const reserve = vi.fn(async () => {});
        const release = vi.fn(async () => {});
        let calls = 0; let p;
        await act(async () => {
            p = result.current.confirm({
                compose: async () => COMPOSED,
                onApprove: async () => { calls += 1; if (calls === 1) throw badPw; return 'ok'; },
                chainId: 'btc', preflight: preflightWith(),
                reservationLedger: { reserve, release },
                reserve: { tick: 'JDOG', amount: '5' },
            });
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        await act(async () => { await result.current.approve({}); });
        await act(async () => { await result.current.approve({}); });
        await p;
        // One reservation for the whole confirm, not one per Approve attempt
        // (re-reserving would double-count and orphan the first id).
        expect(reserve).toHaveBeenCalledTimes(1);
    });

    // A form that does not declare what it spends still gets §4.7
    // protection, derived from the compose envelope's projected balances.
    it('derives the reservation from the simulation when the caller names none', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const reserve = vi.fn(async () => {});
        const release = vi.fn(async () => {});
        let p;
        await act(async () => {
            p = result.current.confirm({
                compose: async () => ({
                    ...COMPOSED,
                    simulation: {
                        deltas: [
                            { tick: 'BTC', before: '1', after: '0.9999', isCoin: true },
                            { tick: 'JDOG', before: '10', after: '7.5' },
                        ],
                    },
                }),
                onApprove: async () => 'ok',
                chainId: 'btc',
                preflight: preflightWith(),
                reservationLedger: { reserve, release },
                // No `reserve` descriptor: this is the ~24-form case.
            });
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        await act(async () => { await result.current.approve({}); });
        await p;
        expect(reserve).toHaveBeenCalledTimes(1);
        // The token debit, exactly; the coin/fee row is not what a concurrent
        // token spend races on.
        expect(reserve.mock.calls[0][0]).toMatchObject({
            chainId: 'btc', tick: 'JDOG', amount: '2.5',
        });
    });

    it('an explicit caller reserve still wins over the derived one', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const reserve = vi.fn(async () => {});
        let p;
        await act(async () => {
            p = result.current.confirm({
                compose: async () => ({
                    ...COMPOSED,
                    simulation: { deltas: [{ tick: 'JDOG', before: '10', after: '7.5' }] },
                }),
                onApprove: async () => 'ok',
                chainId: 'btc',
                preflight: preflightWith(),
                reservationLedger: { reserve, release: async () => {} },
                reserve: { tick: 'PEPE', amount: '42' },
            });
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        await act(async () => { await result.current.approve({}); });
        await p;
        expect(reserve.mock.calls[0][0]).toMatchObject({ tick: 'PEPE', amount: '42' });
    });

    it('reserves nothing when the simulation debits two ticks', async () => {
        // One reservation cannot express a two-tick spend; reserving one leg
        // would imply full coverage while providing half.
        const { result } = renderHook(() => useConfirmAction());
        const reserve = vi.fn(async () => {});
        let p;
        await act(async () => {
            p = result.current.confirm({
                compose: async () => ({
                    ...COMPOSED,
                    simulation: {
                        deltas: [
                            { tick: 'JDOG', before: '10', after: '5' },
                            { tick: 'PEPE', before: '8', after: '1' },
                        ],
                    },
                }),
                onApprove: async () => 'ok',
                chainId: 'btc',
                preflight: preflightWith(),
                reservationLedger: { reserve, release: async () => {} },
            });
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        await act(async () => { await result.current.approve({}); });
        await p;
        expect(reserve).not.toHaveBeenCalled();
    });

    it('§5.3.4 TRANSIENT broadcast failure RESOLVES as queued (not an error) and ends signed-not-broadcast', async () => {
        // The tx is signed and handed to the rebroadcast queue host-side, so
        // the user must NOT see a failure. Permanence crosses the messaging
        // boundary in the error NAME (only name+message survive).
        const { result } = renderHook(() => useConfirmAction());
        const transient = Object.assign(new Error('broadcast failed (phase1): ECONNREFUSED'), {
            name: 'BroadcastFailedTransientError',
        });
        let p;
        await act(async () => {
            p = result.current.confirm({
                compose: async () => COMPOSED,
                onApprove: async () => { throw transient; },
                chainId: 'btc', preflight: preflightWith(),
            });
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        await act(async () => { await result.current.approve({}); });
        const out = await p;
        expect(out.queued).toBe(true);
        expect(out.broadcast).toBe('queued');
        expect(result.current.phase).toBe('signed-not-broadcast');
        // Not surfaced as an error state.
        expect(result.current.error).toBe(null);
    });

    it('§5.3.4 PERMANENT broadcast failure is terminal and REJECTS (re-compose required)', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const permanent = Object.assign(new Error('broadcast failed (phase1): bad-txns-inputs-missingorspent'), {
            name: 'BroadcastFailedPermanentError',
        });
        let p;
        await act(async () => {
            p = settle(result.current.confirm({
                compose: async () => COMPOSED,
                onApprove: async () => { throw permanent; },
                chainId: 'btc', preflight: preflightWith(),
            }));
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        let out;
        await act(async () => {
            await result.current.approve({});
            out = await p;
        });
        expect(out.err).toBe(permanent);
        expect(result.current.phase).toBe('error');
    });

    it('a non-credential approve failure is still terminal (rejects)', async () => {
        const { result } = renderHook(() => useConfirmAction());
        let p;
        await act(async () => {
            p = settle(result.current.confirm({
                compose: async () => COMPOSED,
                onApprove: async () => { throw new Error('node unreachable'); },
                chainId: 'btc', preflight: preflightWith(),
            }));
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        let out;
        await act(async () => {
            await result.current.approve({});
            out = await p;
        });
        expect(out.err.message).toBe('node unreachable');
        expect(result.current.phase).toBe('error');
    });

    it('canApprove is false on a non-overridable error and true after acking an overridable one', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const hardFail = preflightWith({ verdict: 'fail', findings: [{ code: 'DEST_ADDRESS_INVALID', severity: 'error', overridable: false, message: 'x' }], unverified: [] });
        let p;
        await act(async () => { p = settle(result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => 'x', chainId: 'btc', preflight: hardFail })); });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        expect(result.current.canApprove).toBe(false);
        await act(async () => { result.current.reject(); await p; });
    });

    // §4.6 input liveness. The half of the Approve-time re-check that
    // was specified in v3 and never built: the pre-flight verdict was re-run,
    // the held PSBT's inputs never were.
    describe('§4.6 input liveness', () => {

        const RESUME = { software: 'sendToken', hardware: 'sendAssetHw', base: { walletId: 'w1' } };

        it('does not probe a freshly-composed PSBT', async () => {
            const { result } = renderHook(() => useConfirmAction());
            const checkInputs = vi.fn(async () => ({ verdict: 'live', spent: [] }));
            let p;
            await act(async () => {
                p = settle(result.current.confirm({
                    compose: async () => COMPOSED, onApprove: async () => 'sent',
                    chainId: 'btc', preflight: preflightWith(), checkInputs,
                }));
            });
            await waitFor(() => expect(result.current.phase).toBe('ready'));
            await act(async () => { await result.current.approve({}); await p; });
            expect(checkInputs).not.toHaveBeenCalled();
        });

        it('interrupts instead of signing when the coins are gone', async () => {
            const { result } = renderHook(() => useConfirmAction());
            const onApprove = vi.fn(async () => 'sent');
            const checkInputs = vi.fn(async () => ({ verdict: 'spent', spent: [{ txid: 'aa', vout: 0 }], unknown: [] }));
            let p, out;
            await act(async () => {
                p = settle(result.current.confirm({
                    compose: async () => COMPOSED, onApprove,
                    chainId: 'btc', preflight: preflightWith(),
                    checkInputs, alwaysCheckInputs: true,
                }));
            });
            await waitFor(() => expect(result.current.phase).toBe('ready'));
            await act(async () => { out = await result.current.approve({}); });
            expect(out).toMatchObject({ interrupted: true, reason: 'inputs-spent' });
            // The signature is what must not have happened: §5.3.4 forbids
            // re-signing this PSBT, so a dead input has to stop BEFORE onApprove.
            expect(onApprove).not.toHaveBeenCalled();
            expect(result.current.error?.code).toBe('INPUTS_SPENT');
            expect(result.current.phase).toBe('ready');
            await act(async () => { result.current.reject(); await p; });
        });

        it('an unreachable liveness probe never blocks a good transaction', async () => {
            const { result } = renderHook(() => useConfirmAction());
            const onApprove = vi.fn(async () => 'sent');
            const checkInputs = vi.fn(async () => { throw new Error('explorer down'); });
            let p, out;
            await act(async () => {
                p = settle(result.current.confirm({
                    compose: async () => COMPOSED, onApprove,
                    chainId: 'btc', preflight: preflightWith(),
                    checkInputs, alwaysCheckInputs: true,
                }));
            });
            await waitFor(() => expect(result.current.phase).toBe('ready'));
            await act(async () => { await result.current.approve({}); out = await p; });
            expect(out.ok).toBe('sent');
            expect(onApprove).toHaveBeenCalled();
        });

        it('an unknown verdict is not a spent verdict', async () => {
            const { result } = renderHook(() => useConfirmAction());
            const onApprove = vi.fn(async () => 'sent');
            let p, out;
            await act(async () => {
                p = settle(result.current.confirm({
                    compose: async () => COMPOSED, onApprove,
                    chainId: 'btc', preflight: preflightWith(),
                    checkInputs: async () => ({ verdict: 'unknown', spent: [], unknown: [{ txid: 'aa', vout: 0 }] }),
                    alwaysCheckInputs: true,
                }));
            });
            await waitFor(() => expect(result.current.phase).toBe('ready'));
            await act(async () => { await result.current.approve({}); out = await p; });
            expect(out.ok).toBe('sent');
        });

        // §5.4 lifecycle.
        it('persists the confirm on open and re-persists it with the verdict', async () => {
            const { result } = renderHook(() => useConfirmAction());
            const put = vi.fn(async () => ({ stored: true }));
            const clear = vi.fn(async () => ({ cleared: true }));
            let p;
            await act(async () => {
                p = settle(result.current.confirm({
                    compose: async () => COMPOSED, onApprove: async () => 'sent',
                    chainId: 'btc', preflight: preflightWith(),
                    session: { put, clear }, resume: RESUME, resumeRequest: { walletId: 'w1' },
                }));
            });
            await waitFor(() => expect(result.current.phase).toBe('ready'));
            expect(put).toHaveBeenCalledTimes(2);
            const first = put.mock.calls[0][0];
            expect(first.composed).toBe(COMPOSED);
            expect(first.report).toBe(null);          // stored BEFORE pre-flight lands
            expect(first.dispatch).toBe(RESUME);
            expect(put.mock.calls[1][0].report).toMatchObject({ verdict: 'pass' });
            expect(put.mock.calls[1][0].id).toBe(first.id);
            await act(async () => { result.current.reject(); await p; });
        });

        it('stores nothing when the form declared no resume descriptor', async () => {
            const { result } = renderHook(() => useConfirmAction());
            const put = vi.fn(async () => ({ stored: true }));
            let p;
            await act(async () => {
                p = settle(result.current.confirm({
                    compose: async () => COMPOSED, onApprove: async () => 'sent',
                    chainId: 'btc', preflight: preflightWith(), session: { put, clear: vi.fn() },
                }));
            });
            await waitFor(() => expect(result.current.phase).toBe('ready'));
            expect(put).not.toHaveBeenCalled();
            await act(async () => { result.current.reject(); await p; });
        });

        // The clear contract is a safety requirement, not tidy-up: a session
        // outliving its confirm offers a re-approve of a possibly-broadcast tx.
        for (const [name, drive] of [
            ['approve', async (r) => { await r.current.approve({}); }],
            ['reject', async (r) => { r.current.reject(); }],
        ]) {
            it(`clears the stored confirm on ${name}`, async () => {
                const { result } = renderHook(() => useConfirmAction());
                const put = vi.fn(async () => ({ stored: true }));
                const clear = vi.fn(async () => ({ cleared: true }));
                let p;
                await act(async () => {
                    p = settle(result.current.confirm({
                        compose: async () => COMPOSED, onApprove: async () => 'sent',
                        chainId: 'btc', preflight: preflightWith(),
                        session: { put, clear }, resume: RESUME,
                    }));
                });
                await waitFor(() => expect(result.current.phase).toBe('ready'));
                await act(async () => { await drive(result); await p; });
                expect(clear).toHaveBeenCalledWith(put.mock.calls[0][0].id);
            });
        }

        it('clears the stored confirm when a terminal broadcast failure rejects', async () => {
            const { result } = renderHook(() => useConfirmAction());
            const put = vi.fn(async () => ({ stored: true }));
            const clear = vi.fn(async () => ({ cleared: true }));
            let p;
            await act(async () => {
                p = settle(result.current.confirm({
                    compose: async () => COMPOSED,
                    onApprove: async () => { throw new Error('node unreachable'); },
                    chainId: 'btc', preflight: preflightWith(),
                    session: { put, clear }, resume: RESUME,
                }));
            });
            await waitFor(() => expect(result.current.phase).toBe('ready'));
            await act(async () => { await result.current.approve({}); await p; });
            expect(clear).toHaveBeenCalledWith(put.mock.calls[0][0].id);
        });
    });

    // §4.6, the third Approve-time re-check. A native-coin protocol fee
    // is sized at compose and forfeited on-chain if the action is rejected, and
    // the amount consensus requires moves inversely with the coin's USD price,
    // so a move of a little over 5 % while the confirm screen sits open turns
    // the attached output into a short one. Measured on LTC regtest: the wallet
    // broadcast the stale PSBT and 0.02 LTC was spent for nothing.
    describe('native-fee re-quote at Approve', () => {

        // The composed envelope as it looks in native-fee mode: the quote that
        // sized the FEE_DESTINATION output rides on it.
        const COMPOSED_WITH_FEE = { ...COMPOSED, quote: { requiredFeeSats: 2000000, feeDestination: 'feeDest' } };

        function freshQuote(overrides) {
            return {
                supported: true, valid: true, coin: 'LTC',
                requiredFeeSats: 2000000, minAcceptable: '0.01900000', maxAcceptable: '0.02200000',
                ...overrides,
            };
        }

        it('refuses to sign when the fee moved out of the band, and says so', async () => {
            const { result } = renderHook(() => useConfirmAction());
            const onApprove = vi.fn(async () => ({ txid: 'T' }));
            // The price halved: the requirement doubled to 0.04 LTC.
            const requoteNativeFee = vi.fn(async () => freshQuote({
                requiredFeeSats: 4000000, minAcceptable: '0.03800000', maxAcceptable: '0.04400000',
            }));
            let p, out;
            await act(async () => {
                p = settle(result.current.confirm({
                    compose: async () => COMPOSED_WITH_FEE, onApprove,
                    chainId: 'ltc', source: 'src1', preflight: preflightWith(), requoteNativeFee,
                }));
            });
            await waitFor(() => expect(result.current.phase).toBe('ready'));
            await act(async () => { out = await result.current.approve({}); });

            // Nothing was signed: this is the whole point of the rail.
            expect(onApprove).not.toHaveBeenCalled();
            expect(out).toMatchObject({ interrupted: true, reason: 'fee-changed' });
            expect(out.requote).toMatchObject({ verdict: 'short', paidSats: 2000000, expectedSats: 4000000 });
            expect(result.current.error?.code).toBe('NATIVE_FEE_CHANGED');
            expect(result.current.error?.message).toContain('0.04 LTC');
            expect(result.current.phase).toBe('ready');
            // Re-quoted from the COMPOSED bytes, not from form params.
            expect(requoteNativeFee).toHaveBeenCalledWith({
                actionString: COMPOSED.actionString, source: 'src1',
            });
            await act(async () => { result.current.reject(); await p; });
        });

        it('signs when the fee is still inside the band', async () => {
            const { result } = renderHook(() => useConfirmAction());
            const onApprove = vi.fn(async () => ({ txid: 'T' }));
            const requoteNativeFee = vi.fn(async () => freshQuote({ requiredFeeSats: 2050000 }));
            let p, out;
            await act(async () => {
                p = settle(result.current.confirm({
                    compose: async () => COMPOSED_WITH_FEE, onApprove,
                    chainId: 'ltc', preflight: preflightWith(), requoteNativeFee,
                }));
            });
            await waitFor(() => expect(result.current.phase).toBe('ready'));
            await act(async () => { await result.current.approve({}); out = await p; });
            expect(onApprove).toHaveBeenCalled();
            expect(out.ok).toEqual({ txid: 'T' });
        });

        it('never asks when the action attaches no native fee', async () => {
            const { result } = renderHook(() => useConfirmAction());
            const requoteNativeFee = vi.fn(async () => freshQuote());
            let p, out;
            await act(async () => {
                p = settle(result.current.confirm({
                    compose: async () => COMPOSED, onApprove: async () => 'sent',
                    chainId: 'btc', preflight: preflightWith(), requoteNativeFee,
                }));
            });
            await waitFor(() => expect(result.current.phase).toBe('ready'));
            await act(async () => { await result.current.approve({}); out = await p; });
            expect(requoteNativeFee).not.toHaveBeenCalled();
            expect(out.ok).toBe('sent');
        });

        // Same posture as the liveness probe (§4.2): a dead explorer must not
        // hard-block a transaction that is probably still correctly priced.
        for (const [label, requote] of [
            ['an unreachable quote', vi.fn(async () => { throw new Error('explorer down'); })],
            ['a missing host route', undefined],
            ['a busy indexer', vi.fn(async () => ({ supported: true, valid: false, busy: true, retryable: true }))],
        ]) {
            it(`${label} never blocks a good transaction`, async () => {
                const { result } = renderHook(() => useConfirmAction());
                const onApprove = vi.fn(async () => 'sent');
                let p, out;
                await act(async () => {
                    p = settle(result.current.confirm({
                        compose: async () => COMPOSED_WITH_FEE, onApprove,
                        chainId: 'ltc', preflight: preflightWith(),
                        // The wired shells always pass a function; `undefined`
                        // stands in for a shell whose messaging lacks the route.
                        ...(requote ? { requoteNativeFee: requote } : {}),
                    }));
                });
                await waitFor(() => expect(result.current.phase).toBe('ready'));
                await act(async () => { await result.current.approve({}); out = await p; });
                expect(onApprove).toHaveBeenCalled();
                expect(out.ok).toBe('sent');
            });
        }
    });
});
