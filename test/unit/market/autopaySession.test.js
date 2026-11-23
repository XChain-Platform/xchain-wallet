// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// PC-16 Phase B (operator rulings 2026-11-13): auto pay keeps paying armed
// orders while the wallet is locked, with no time limit, through a session
// built at lock time. These tests drive the session and its controller with
// a fake vault and SDK, a real WebCrypto sealing key, and a fixture string
// standing in for the key (never a real key). They pin: what starts a
// session, the locked payment path through ScopedPaySigner, every end
// trigger, the no-time-limit and empty-table rulings, and that nothing is
// written to browser or extension storage.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    AutopaySession,
    LOCKED_AUTOPAY_MAX_FAILURES,
    createLockedAutopay,
} from '../../../packages/core/src/market/autopaySession.js';
import {
    activatePanicMode,
    applyExternalPanicModeState,
    configurePanicModePersistence,
    deactivatePanicMode,
    holdPanicModeFreeze,
} from '../../../packages/core/src/flows/panicMode.js';

const NOW = 1_800_000_000_000;
const FIXTURE_KEY = 'fixture-sealed-value-not-a-key';
const DAY_MS = 24 * 60 * 60 * 1000;

function consentRow(over = {}) {
    return {
        schemaVersion: 1,
        id: 'bitcoin-regtest::aa',
        walletId: 'w1',
        chainId: 'bitcoin-regtest',
        sourceAddress: 'addr-payer',
        txid: 'aa',
        orderActionIndex: '500',
        giveCoinAmount: '0.05',
        getTick: 'PEPE',
        getAmount: '1000',
        autopay: true,
        payments: [],
        createdAt: new Date(0).toISOString(),
        ...over,
    };
}

function obligationRow(clock, over = {}) {
    return {
        action_index: '900',
        payer_address: 'addr-payer',
        payee_address: 'addr-seller',
        coin: 'BTC',
        coin_amount: '0.005',
        expiration: Math.floor(clock() / 1000) + 7000,
        block_index: 100,
        coinpay_status: 'pending_coinpay',
        ...over,
    };
}

function matchRow(over = {}) {
    return {
        action_index: '900',
        give_action_index: '600',
        get_action_index: '500',
        give_amount: '0.005',
        get_amount: '100',
        settlement_type: 'coinpay',
        status: 'pending_coinpay',
        ...over,
    };
}

function makeVault({ consents = [consentRow()] } = {}) {
    const autopayStore = new Map(consents.map((r) => [r.id, r]));
    const leaseStore = new Map();
    return {
        autopayStore,
        autopayOrders: {
            get: vi.fn(async (id) => autopayStore.get(id) || null),
            put: vi.fn(async (r) => { autopayStore.set(r.id, r); }),
            list: vi.fn(async () => Array.from(autopayStore.values())),
        },
        autopayLeases: {
            get: vi.fn(async (id) => leaseStore.get(id) || null),
            put: vi.fn(async (r) => { leaseStore.set(r.id, r); }),
        },
        pendingTxs: { list: vi.fn(async () => []) },
        // The payer is a derived address of wallet w1's account, so the
        // watcher's source resolution finds it owned and software-signable.
        addresses: {
            list: vi.fn(async () => [{
                id: 'addr-id-1',
                chain: 'bitcoin',
                network: 'regtest',
                address: 'addr-payer',
                publicKey: '02ab',
                derivationPath: "m/84'/1'/0'/0/0",
                source: 'hd',
                accountId: 'acct-w1',
            }]),
        },
        accounts: { get: vi.fn(async (id) => (id === 'acct-w1' ? { id, walletId: 'w1' } : null)) },
        wallets: { get: vi.fn(async (id) => (id === 'w1' ? { id, importedKeys: [] } : null)) },
        settings: { get: vi.fn(async () => ({ notifications: { incomingReceipts: true } })) },
        close: vi.fn(),
    };
}

function goodTx() {
    return {
        inputs: [{ address: 'addr-payer', value: 1_000_000 }],
        outputs: [
            { address: 'addr-seller', scriptPubKeyHex: '0014aa', scriptType: 'p2wpkh', value: 500000 },
            { address: null, scriptPubKeyHex: '6a0b', scriptType: 'unknown', value: 0 },
            { address: 'addr-payer', scriptPubKeyHex: '0014bb', scriptType: 'p2wpkh', value: 495000 },
        ],
    };
}

function makeSdk(clock, { tx = goodTx } = {}) {
    const state = { obligations: [obligationRow(clock)], matches: [matchRow()], tx };
    const sdk = {
        getStatus: vi.fn(async () => ({ last_block: { RBTC: 101 } })),
        explorer: { coin: 'RBTC' },
        getCoinpayObligations: vi.fn(async () => ({ data: state.obligations })),
        getOrderMatches: vi.fn(async () => ({ data: state.matches })),
        getTransaction: vi.fn(async () => null),
        onCoinpayRequired: vi.fn(() => () => {}),
        wallet: {
            decomposePsbt: vi.fn(() => state.tx()),
            // Records only whether the unsealed value matched the fixture.
            signPsbt: vi.fn((_hex, wif) => ({ txHex: 'txhex', txid: wif === FIXTURE_KEY ? 'paytx1' : 'wrong-key', psbtHex: 'signed' })),
        },
        decoder: {
            decodeActionFromPsbt: vi.fn(() => ({ ok: true, action: 'COINPAY', version: 0, params: { ORDER_MATCH_ACTION_INDEX: '900' } })),
        },
    };
    return { sdk, state, registry: { get: vi.fn(() => sdk) } };
}

const chainRegistry = {
    get: vi.fn(() => ({ coin: 'bitcoin' })),
    chainIdFor: vi.fn((chain, network) => `${chain}-${network}`),
};

function makePool({ kind = 'software' } = {}) {
    const signer = {
        kind,
        exportWifForPath: vi.fn(() => FIXTURE_KEY),
        exportWifForAddressId: vi.fn(() => FIXTURE_KEY),
    };
    return { signer, pool: { get: vi.fn(() => signer) } };
}

// Signs through whatever signer the watcher hands it, as coinpayAction's
// submit path does, so the ScopedPaySigner checks run for real.
function signingCoinpayAction({ failWith } = {}) {
    return vi.fn(async ({ signer, chainId, onProgress }) => {
        if (failWith) throw new Error(failWith);
        onProgress?.('signing');
        const signed = await signer.signPsbt({ psbtHex: 'psbt-hex', chainId, signingPaths: [{ inputIndex: 0, path: 'ignored' }] });
        onProgress?.('broadcast');
        return { txid: signed.txid };
    });
}

function makeSession(over = {}) {
    let nowMs = over.now ?? NOW;
    const clock = () => nowMs;
    const vault = over.vault ?? makeVault();
    const sdkPair = makeSdk(clock, over.sdk);
    const { pool, signer } = over.poolPair ?? makePool();
    const notify = vi.fn(async () => {});
    const coinpayAction = over.coinpayAction ?? signingCoinpayAction();
    const ended = [];
    return {
        vault, sdkPair, pool, signer, notify, coinpayAction, ended, clock,
        advance: (ms) => { nowMs += ms; },
        async capture() {
            return AutopaySession.capture({
                vault, signerPool: pool, chainRegistry, sdkRegistry: sdkPair.registry,
                now: clock, onEnd: (reason) => ended.push(reason),
            });
        },
        start(session) {
            return session.startWatcher({
                notify, shellKind: 'web', intervalMs: 1e9, coinpayAction,
                reservationLedger: { reserve: vi.fn(async () => {}), release: vi.fn(async () => {}) },
            });
        },
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('what starts locked auto pay', () => {
    it('no session when no order has auto pay on, or none has GIVE left', async () => {
        const off = makeSession({ vault: makeVault({ consents: [consentRow({ autopay: false })] }) });
        expect(await off.capture()).toBeNull();
        const spent = makeSession({
            vault: makeVault({ consents: [consentRow({ payments: [{ orderMatchActionIndex: '1', coinAmountBase: '5000000', txid: 't', at: 'x' }] })] }),
        });
        expect(await spent.capture()).toBeNull();
        expect(off.signer.exportWifForPath).not.toHaveBeenCalled();
    });

    it('no session for a hardware or watch-only wallet', async () => {
        const hw = makeSession({ poolPair: makePool({ kind: 'trezor' }) });
        expect(await hw.capture()).toBeNull();
    });

    it('the controller leaves the lock path alone when nothing is armed', async () => {
        const vault = makeVault({ consents: [] });
        const controller = createLockedAutopay({ shellKind: 'web', notify: vi.fn() });
        const { pool } = makePool();
        const took = await controller.lock({ vault, signerPool: pool, chainRegistry, sdkRegistry: makeSdk(() => NOW).registry });
        expect(took).toBe(false);
        expect(controller.holdsVault(vault)).toBe(false);
        expect(controller.status()).toEqual({ active: false });
        expect(vault.close).not.toHaveBeenCalled();
    });

    it('seals one key per armed source only', async () => {
        const vault = makeVault({
            consents: [
                consentRow(),
                consentRow({ id: 'bitcoin-regtest::bb', txid: 'bb' }), // same source
                consentRow({ id: 'bitcoin-regtest::cc', txid: 'cc', sourceAddress: 'addr-other', autopay: false }),
            ],
        });
        const s = makeSession({ vault });
        const session = await s.capture();
        expect(session).not.toBeNull();
        expect(s.signer.exportWifForPath).toHaveBeenCalledTimes(1);
        expect(session.status()).toMatchObject({ active: true, orders: 2 });
        await session.end('quit');
    });
});

describe('the locked payment path', () => {
    it('pays a confirmed match through the scoped signer and lands a notification', async () => {
        const s = makeSession();
        const session = await s.capture();
        const watcher = s.start(session);
        await watcher.whenIdle();
        expect(s.coinpayAction).toHaveBeenCalledTimes(1);
        expect(s.coinpayAction.mock.calls[0][0]).toMatchObject({ scopedPayment: true });
        expect(s.coinpayAction.mock.calls[0][0].signer.kind).toBe('scoped-pay');
        expect(s.sdkPair.sdk.wallet.signPsbt).toHaveBeenCalledTimes(1);
        expect(s.sdkPair.sdk.wallet.signPsbt.mock.results[0].value.txid).toBe('paytx1');
        expect(s.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'coinpay-autopaid', title: 'Auto pay complete' }));
        expect(s.vault.autopayStore.get('bitcoin-regtest::aa').payments).toHaveLength(1);
        expect(session.status()).toMatchObject({ active: true, orders: 1, caps: [{ chainId: 'bitcoin-regtest', ticker: 'BTC', amount: '0.045' }] });
        await session.end('quit');
    });

    it('has no time limit: still pays a week later', async () => {
        const s = makeSession();
        const session = await s.capture();
        s.advance(8 * DAY_MS);
        s.sdkPair.state.obligations = [obligationRow(s.clock)];
        const watcher = s.start(session);
        await watcher.whenIdle();
        expect(session.ended).toBe(false);
        expect(s.coinpayAction).toHaveBeenCalledTimes(1);
        expect(s.sdkPair.sdk.wallet.signPsbt).toHaveBeenCalledTimes(1);
        await session.end('quit');
    });

    it('keeps running when the last armed order is fully paid', async () => {
        const s = makeSession({ vault: makeVault({ consents: [consentRow({ giveCoinAmount: '0.005', getAmount: '100' })] }) });
        const session = await s.capture();
        const watcher = s.start(session);
        await watcher.whenIdle();
        expect(s.coinpayAction).toHaveBeenCalledTimes(1);
        expect(session.status()).toEqual({ active: true, orders: 0, caps: [] });
        await watcher.pollOnce();
        expect(session.ended).toBe(false);
        expect(s.ended).toEqual([]);
        await session.end('quit');
    });

    it('writes nothing to localStorage, sessionStorage or chrome.storage', async () => {
        const local = { setItem: vi.fn(), getItem: vi.fn(() => null) };
        const sessionStore = { setItem: vi.fn(), getItem: vi.fn(() => null) };
        const chromeSession = { set: vi.fn(async () => {}), get: vi.fn(async () => ({})) };
        vi.stubGlobal('localStorage', local);
        vi.stubGlobal('sessionStorage', sessionStore);
        vi.stubGlobal('chrome', { storage: { session: chromeSession, local: chromeSession } });
        const s = makeSession();
        const controller = createLockedAutopay({ shellKind: 'extension', notify: s.notify, intervalMs: 1e9, coinpayAction: s.coinpayAction, now: s.clock });
        expect(await controller.lock({ vault: s.vault, signerPool: s.pool, chainRegistry, sdkRegistry: s.sdkPair.registry })).toBe(true);
        await vi.waitFor(() => expect(s.coinpayAction).toHaveBeenCalled());
        expect(local.setItem).not.toHaveBeenCalled();
        expect(sessionStore.setItem).not.toHaveBeenCalled();
        expect(chromeSession.set).not.toHaveBeenCalled();
        expect(JSON.stringify(controller.status())).not.toContain(FIXTURE_KEY);
        expect(Object.keys(controller).sort()).toEqual(['end', 'holdsVault', 'instanceId', 'isActive', 'lock', 'status', 'takeHandoff']);
        await controller.end('worker-ended');
    });
});

describe('what ends locked auto pay', () => {
    it('unlock: closes the vault and hands the attempted set to the unlocked watcher', async () => {
        const s = makeSession();
        const onEnded = vi.fn();
        const controller = createLockedAutopay({ shellKind: 'web', notify: s.notify, intervalMs: 1e9, coinpayAction: s.coinpayAction, now: s.clock, onEnded });
        await controller.lock({ vault: s.vault, signerPool: s.pool, chainRegistry, sdkRegistry: s.sdkPair.registry });
        expect(controller.holdsVault(s.vault)).toBe(true);
        await vi.waitFor(() => expect(s.coinpayAction).toHaveBeenCalled());
        expect(await controller.end('unlock')).toBe(true);
        expect(s.vault.close).toHaveBeenCalledTimes(1);
        expect(controller.isActive()).toBe(false);
        expect(controller.holdsVault(s.vault)).toBe(false);
        expect(onEnded).toHaveBeenCalledWith('unlock');
        expect(controller.takeHandoff()).toEqual(['900']);
        expect(controller.takeHandoff()).toEqual([]);
    });

    it('the lock hand-over keeps the payer lease and the attempted set', async () => {
        const s = makeSession();
        const controller = createLockedAutopay({ shellKind: 'web', instanceId: 'shell-1', notify: s.notify, intervalMs: 1e9, coinpayAction: s.coinpayAction, now: s.clock });
        const outgoing = { stop: vi.fn(), whenIdle: vi.fn(async () => {}), attemptedMatches: vi.fn(() => ['900']) };
        await controller.lock({ vault: s.vault, signerPool: s.pool, chainRegistry, sdkRegistry: s.sdkPair.registry, watcher: outgoing });
        await vi.waitFor(() => expect(s.vault.autopayLeases.put).toHaveBeenCalled());
        expect(outgoing.stop).toHaveBeenCalled();
        expect(s.vault.autopayLeases.put.mock.calls[0][0].holderId).toBe('shell-1');
        // 900 was attempted by the unlocked instance, so the session never pays it again.
        expect(s.coinpayAction).not.toHaveBeenCalled();
        await controller.end('quit');
    });

    it('Stop: ends without a password and signs nothing more', async () => {
        const s = makeSession();
        const controller = createLockedAutopay({ shellKind: 'web', notify: s.notify, intervalMs: 1e9, coinpayAction: s.coinpayAction, now: s.clock });
        await controller.lock({ vault: s.vault, signerPool: s.pool, chainRegistry, sdkRegistry: s.sdkPair.registry });
        await controller.end('stopped');
        expect(controller.status()).toEqual({ active: false });
        expect(s.vault.close).toHaveBeenCalled();
    });

    it('auto pay turned off: no order with auto pay on ends it', async () => {
        const s = makeSession();
        const session = await s.capture();
        s.vault.autopayStore.set('bitcoin-regtest::aa', consentRow({ autopay: false }));
        const watcher = s.start(session);
        await watcher.whenIdle();
        await vi.waitFor(() => expect(s.ended).toEqual(['autopay-off']));
        expect(s.coinpayAction).not.toHaveBeenCalled();
        expect(s.vault.close).toHaveBeenCalled();
    });

    it('any ScopedPaySigner refusal ends it', async () => {
        const s = makeSession({
            sdk: {
                tx: () => {
                    const tx = goodTx();
                    tx.outputs.push({ address: 'addr-attacker', scriptPubKeyHex: '0014ee', scriptType: 'p2wpkh', value: 1 });
                    return tx;
                },
            },
        });
        const session = await s.capture();
        const watcher = s.start(session);
        await watcher.whenIdle();
        await vi.waitFor(() => expect(s.ended).toEqual(['signer-refused']));
        expect(s.sdkPair.sdk.wallet.signPsbt).not.toHaveBeenCalled();
        expect(s.vault.close).toHaveBeenCalled();
    });

    it(`${LOCKED_AUTOPAY_MAX_FAILURES} failed payments in a row end it; a success resets the count`, async () => {
        const failing = makeSession({ coinpayAction: signingCoinpayAction({ failWith: 'encoder unreachable' }) });
        const session = await failing.capture();
        const watcher = failing.start(session);
        await watcher.whenIdle();
        await watcher.pollOnce();
        expect(session.ended).toBe(false);
        await watcher.pollOnce();
        await vi.waitFor(() => expect(failing.ended).toEqual(['payment-failures']));

        const s = makeSession();
        const resets = await s.capture();
        resets.notePaymentResult({ ok: false, chainId: 'bitcoin-regtest', matchIndex: '1' });
        resets.notePaymentResult({ ok: false, chainId: 'bitcoin-regtest', matchIndex: '2' });
        resets.notePaymentResult({ ok: true, chainId: 'bitcoin-regtest', matchIndex: '3', consentId: 'bitcoin-regtest::aa', amountBase: '1' });
        resets.notePaymentResult({ ok: false, chainId: 'bitcoin-regtest', matchIndex: '4' });
        resets.notePaymentResult({ ok: false, chainId: 'bitcoin-regtest', matchIndex: '5' });
        expect(resets.ended).toBe(false);
        await resets.end('quit');
    });

    it.each(['quit', 'page-closed', 'worker-ended', 'sign-out', 'wallet-wipe', 'password-change', 'wallet-switch', 'panic'])(
        'shell event %s closes the vault and leaves nothing that can sign',
        async (reason) => {
            const s = makeSession();
            const session = await s.capture();
            await session.end(reason);
            expect(s.ended).toEqual([reason]);
            expect(s.vault.close).toHaveBeenCalledTimes(1);
            expect(session.status()).toEqual({ active: false });
            expect(session.signerForPayment({
                walletId: 'w1', consentId: 'bitcoin-regtest::aa', chainId: 'bitcoin-regtest',
                payeeAddress: 'addr-seller', amountBase: '500000', matchIndex: '900', deadlineSeconds: NOW / 1000 + 100,
            })).toBeNull();
            expect(session.hasSignerFor('w1')).toBe(false);
        },
    );

    it('panic mode ends it, and no session starts while signing is frozen', async () => {
        const s = makeSession();
        const onEnded = vi.fn();
        const controller = createLockedAutopay({ shellKind: 'desktop', notify: s.notify, intervalMs: 1e9, coinpayAction: s.coinpayAction, now: s.clock, onEnded });
        await controller.lock({ vault: s.vault, signerPool: s.pool, chainRegistry, sdkRegistry: s.sdkPair.registry });
        expect(controller.isActive()).toBe(true);
        try {
            activatePanicMode({ durationMs: 60_000 });
            await vi.waitFor(() => expect(onEnded).toHaveBeenCalledWith('panic'));
            expect(controller.isActive()).toBe(false);
            expect(s.vault.close).toHaveBeenCalled();
            const again = makeSession();
            expect(await controller.lock({ vault: again.vault, signerPool: again.pool, chainRegistry, sdkRegistry: again.sdkPair.registry })).toBe(false);
            expect(again.signer.exportWifForPath).not.toHaveBeenCalled();
        } finally {
            deactivatePanicMode();
        }
    });

    it('a lock does not wait on an outgoing cycle stuck on the network', async () => {
        const s = makeSession();
        const controller = createLockedAutopay({ shellKind: 'web', notify: s.notify, intervalMs: 1e9, coinpayAction: s.coinpayAction, now: s.clock });
        const stuck = { stop: vi.fn(), whenIdle: () => new Promise(() => {}), attemptedMatches: () => ['77'] };
        const took = await Promise.race([
            controller.lock({ vault: s.vault, signerPool: s.pool, chainRegistry, sdkRegistry: s.sdkPair.registry, watcher: stuck }),
            new Promise((resolve) => setTimeout(() => resolve('hung'), 1000)),
        ]);
        expect(took).toBe(true);
        expect(stuck.stop).toHaveBeenCalled();
        await controller.end('quit');
    });

    it('end closes the vault within its bound even when the last cycle never settles', async () => {
        const s = makeSession({ sdk: {} });
        const session = await s.capture();
        // A watcher whose read never returns.
        s.sdkPair.sdk.getCoinpayObligations.mockImplementation(() => new Promise(() => {}));
        s.start(session);
        const started = Date.now();
        await session.end('stopped');
        expect(Date.now() - started).toBeLessThan(5000);
        expect(s.vault.close).toHaveBeenCalledTimes(1);
    }, 10_000);

    it.each(['signer-refused', 'payment-failures'])('a session that ends itself (%s) posts "Auto pay stopped"', async (reason) => {
        const s = makeSession({
            coinpayAction: reason === 'payment-failures' ? signingCoinpayAction({ failWith: 'encoder unreachable' }) : signingCoinpayAction(),
            sdk: reason === 'signer-refused'
                ? { tx: () => { const tx = goodTx(); tx.outputs[0] = { ...tx.outputs[0], address: 'addr-attacker' }; return tx; } }
                : {},
        });
        const onEnded = vi.fn();
        // A short interval so the failing payment is retried cycle after cycle.
        const controller = createLockedAutopay({ shellKind: 'web', notify: s.notify, intervalMs: 5, coinpayAction: s.coinpayAction, now: s.clock, onEnded, recordAlert: vi.fn() });
        await controller.lock({ vault: s.vault, signerPool: s.pool, chainRegistry, sdkRegistry: s.sdkPair.registry });
        await vi.waitFor(() => expect(onEnded).toHaveBeenCalledWith(reason));
        if (reason === 'payment-failures') expect(s.coinpayAction).toHaveBeenCalledTimes(LOCKED_AUTOPAY_MAX_FAILURES);
        await vi.waitFor(() => expect(s.notify).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Auto pay stopped',
            body: 'Unlock to resume auto pay, or open Payments due.',
            data: expect.objectContaining({ reason }),
        })));
    });

    it.each(['hold', 'external'])('a freeze delivered by route %s ends it', async (route) => {
        {
            const s = makeSession();
            const onEnded = vi.fn();
            // The extension worker and desktop main install a store, which makes
            // the in-memory cache the freeze's source of truth there.
            if (route === 'external') {
                await configurePanicModePersistence({ load: async () => null, save: async () => {}, clear: async () => {} });
            }
            const controller = createLockedAutopay({ shellKind: 'extension', notify: s.notify, intervalMs: 1e9, coinpayAction: s.coinpayAction, now: s.clock, onEnded });
            await controller.lock({ vault: s.vault, signerPool: s.pool, chainRegistry, sdkRegistry: s.sdkPair.registry });
            const now = Date.now();
            const freeze = { activatedAt: now, expiresAt: now + 60_000, durationMs: 60_000 };
            try {
                if (route === 'hold') holdPanicModeFreeze(freeze);
                else applyExternalPanicModeState(freeze);
                await vi.waitFor(() => expect(onEnded).toHaveBeenCalledWith('panic'));
                expect(s.vault.close).toHaveBeenCalled();
            } finally {
                applyExternalPanicModeState(null);
                deactivatePanicMode();
                await configurePanicModePersistence(null);
            }
        }
    });

    it('a payment above the order\'s remaining GIVE gets no signer', async () => {
        const s = makeSession();
        const session = await s.capture();
        expect(session.signerForPayment({
            walletId: 'w1', consentId: 'bitcoin-regtest::aa', chainId: 'bitcoin-regtest',
            payeeAddress: 'addr-seller', amountBase: '5000001', matchIndex: '900', deadlineSeconds: NOW / 1000 + 100,
        })).toBeNull();
        await session.end('quit');
    });
});
