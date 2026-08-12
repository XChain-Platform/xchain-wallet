// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Resuming a stored confirm (§5.4).
//
// Two invariants carry the weight here, and both are about what a session may
// NOT do: dispatch a method nobody allow-listed, and carry a credential.

import { describe, it, expect } from 'vitest';
import {
    isResumable, resumeDispatch, resumeAfter, describeResumeSession,
    resumableSessions, assertNoCredentials, RESUME_TTL_MS,
} from '../../../packages/core/src/flows/confirmResume.js';

const session = (over = {}) => ({
    id: 'cs:1:abcd',
    createdAt: Date.now(),
    composed: { psbt: 'deadbeef', actionString: 'SEND|0|PEPE|5|bc1qx', chainId: 'bitcoin-mainnet' },
    dispatch: {
        software: 'sendToken',
        hardware: 'sendAssetHw',
        base: { walletId: 'w1', chainId: 'bitcoin-mainnet', from: { address: 'bc1qme' } },
        label: 'send 5 PEPE',
    },
    ...over,
});

describe('isResumable', () => {

    it('accepts a well-formed session', () => {
        expect(isResumable(session(), Date.now())).toBe(true);
    });

    it('rejects a dispatch method nobody allow-listed', () => {
        expect(isResumable(session({
            dispatch: { ...session().dispatch, software: 'auth.exportMnemonic' },
        }), Date.now())).toBe(false);
    });

    it('rejects a non-allow-listed HARDWARE lane too', () => {
        expect(isResumable(session({
            dispatch: { ...session().dispatch, hardware: 'somethingElse' },
        }), Date.now())).toBe(false);
    });

    it('rejects a follow-up method nobody allow-listed', () => {
        expect(isResumable(session({
            dispatch: { ...session().dispatch, after: { method: 'deleteWallet' } },
        }), Date.now())).toBe(false);
    });

    // A stored password would be a credential at rest in storage.session, which
    // is the one thing this store must never hold.
    it('rejects a session carrying a credential in its request body', () => {
        for (const key of ['password', 'mnemonic', 'passphrase', 'bip39Passphrase']) {
            const s = session();
            s.dispatch.base = { ...s.dispatch.base, [key]: 'hunter2' };
            expect(isResumable(s, Date.now())).toBe(false);
        }
    });

    it('rejects a session with no PSBT to sign', () => {
        expect(isResumable(session({ composed: { actionString: 'SEND|0' } }), Date.now())).toBe(false);
    });

    it('rejects an abandoned session past the TTL', () => {
        const now = Date.now();
        expect(isResumable(session({ createdAt: now - RESUME_TTL_MS - 1 }), now)).toBe(false);
        expect(isResumable(session({ createdAt: now - RESUME_TTL_MS + 1000 }), now)).toBe(true);
    });

    it('rejects junk', () => {
        expect(isResumable(null, Date.now())).toBe(false);
        expect(isResumable({}, Date.now())).toBe(false);
    });
});

describe('assertNoCredentials', () => {
    it('names the offending field', () => {
        expect(() => assertNoCredentials({ password: 'x' })).toThrow(/password/);
        expect(() => assertNoCredentials({ walletId: 'w' })).not.toThrow();
    });
});

describe('resumeDispatch', () => {

    it('picks the software lane by default and the hardware lane on request', () => {
        expect(resumeDispatch(session()).method).toBe('sendToken');
        expect(resumeDispatch(session(), { isHw: true }).method).toBe('sendAssetHw');
    });

    it('returns a COPY of the base, so a resumed approve cannot mutate the store', () => {
        const s = session();
        const { base } = resumeDispatch(s);
        base.walletId = 'tampered';
        expect(s.dispatch.base.walletId).toBe('w1');
    });

    it('refuses a session that is not resumable at all', () => {
        expect(() => resumeDispatch(session({ dispatch: null }))).toThrow(/not resumable/);
    });

    it('refuses the hardware lane when the form never declared one', () => {
        const s = session();
        delete s.dispatch.hardware;
        expect(() => resumeDispatch(s, { isHw: true })).toThrow(/no hardware lane/);
    });
});

describe('resumeAfter', () => {

    // AirdropForm is the case this exists for: its pending record is written
    // after Approve, so resuming the LIST leg without it would publish a
    // recipient list and orphan the airdrop.
    const withAfter = () => session({
        dispatch: {
            ...session().dispatch,
            after: {
                method: 'savePendingAirdrop',
                base: { record: { id: 'r1', listTxid: '' } },
                txidPath: ['record', 'listTxid'],
            },
        },
    });

    it('writes the broadcast txid into the declared path', () => {
        const out = resumeAfter(withAfter(), 'abc123');
        expect(out).toEqual({ method: 'savePendingAirdrop', body: { record: { id: 'r1', listTxid: 'abc123' } } });
    });

    it('does not mutate the stored descriptor', () => {
        const s = withAfter();
        resumeAfter(s, 'abc123');
        expect(s.dispatch.after.base.record.listTxid).toBe('');
    });

    it('is null when the form declared no follow-up', () => {
        expect(resumeAfter(session(), 'abc')).toBe(null);
    });

    it('refuses a follow-up method nobody allow-listed', () => {
        const s = session({ dispatch: { ...session().dispatch, after: { method: 'wipeVault', base: {} } } });
        expect(resumeAfter(s, 'abc')).toBe(null);
    });
});

describe('describeResumeSession', () => {
    it('reads the action off the COMPOSED string, not the caller request', () => {
        const info = describeResumeSession(session(), Date.now());
        expect(info.action).toBe('SEND');
        expect(info.label).toBe('send 5 PEPE');
        expect(info.chainId).toBe('bitcoin-mainnet');
    });
});

describe('resumableSessions', () => {
    it('drops the unofferable and sorts newest first', () => {
        const now = Date.now();
        const list = [
            session({ id: 'old', createdAt: now - 5000 }),
            session({ id: 'expired', createdAt: now - RESUME_TTL_MS - 1 }),
            session({ id: 'new', createdAt: now - 100 }),
            session({ id: 'bad', dispatch: { software: 'nope', base: {} } }),
        ];
        expect(resumableSessions(list, now).map((s) => s.id)).toEqual(['new', 'old']);
    });
});
