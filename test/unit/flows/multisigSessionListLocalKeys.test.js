// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The session list names this wallet's own cosigner keys on every session
// (`localPubkeys`), so the Sessions page can put a session that still waits
// on this wallet under Ready. Before this, only the demo fixtures carried the
// field and a real wallet showed every open session under Waiting.

import { describe, expect, it } from 'vitest';
import { listMultisigSigningSessions } from '../../../packages/core/src/flows/multisigSigning.js';
import { buildMultisigConfig } from '../../../packages/core/src/schemas/multisigConfig.js';
import { createMultisigSigningSession } from '../../../packages/core/src/schemas/multisigSigningSession.js';
import { groupSigningSessions } from '../../../packages/core/src/shared/routes/MultisigSigningSession.jsx';

const ALICE = `02${'aa'.repeat(32)}`;
const BOB = `03${'bb'.repeat(32)}`;
const CAROL = `02${'cc'.repeat(32)}`;
const DAVE = `03${'dd'.repeat(32)}`;
const STRANGER = `02${'ee'.repeat(32)}`;
const SIGNER_ID = 'signer-local-secret-id';
const CONTRIBUTED_AT = '2026-11-15T10:00:00.000Z';

function cosigner(name, pubkey, origin) {
    return {
        name,
        pubkey,
        fingerprint: origin === 'local' ? 'f00dcafe' : 'abcdef01',
        origin,
        localSignerId: origin === 'local' ? SIGNER_ID : null,
        xpub: origin === 'external-xpub' ? 'tpubExternalCosignerXpub' : null,
        derivationPath: "m/48'/1'/0'/2'",
    };
}

function walletRecord(id = 'wallet-1') {
    return {
        id,
        name: 'Main',
        encryptedSeed: 'sealed-seed-bytes',
        multisigs: [
            buildMultisigConfig({
                id: 'config-segwit',
                scheme: 'p2wsh-multisig',
                threshold: 2,
                cosigners: [
                    // Stored in upper case: the list still answers in the
                    // session's lower-case spelling.
                    cosigner('Me', ALICE.toUpperCase(), 'local'),
                    cosigner('Bob', BOB, 'external-xpub'),
                    cosigner('Carol', CAROL, 'external-hardware'),
                ],
            }),
            buildMultisigConfig({
                id: 'config-taproot',
                scheme: 'taproot-musig2',
                threshold: 2,
                aggregatedXOnlyPubkey: '77'.repeat(32),
                cosigners: [
                    cosigner('Me', ALICE, 'local'),
                    cosigner('Dave', DAVE, 'external-xpub'),
                ],
            }),
        ],
    };
}

function segwitSession(walletId, signedBy, extra = {}) {
    const session = createMultisigSigningSession({
        walletId,
        chainId: 'bitcoin-regtest',
        scheme: 'p2wsh-multisig',
        threshold: 2,
        cosignerPubkeys: [ALICE, BOB, CAROL],
        msgHash: '11'.repeat(32),
        psbtHex: '70736274ff',
        actionSummary: 'Send 0.25 BTC to bcrt1qdestination',
        ...extra,
    });
    return {
        ...session,
        signatures: signedBy.map((pubkey) => ({ pubkey, sig: '3044'.padEnd(140, '0'), contributedAt: CONTRIBUTED_AT })),
    };
}

function taprootStepOne(walletId, repliedBy) {
    const session = createMultisigSigningSession({
        walletId,
        chainId: 'bitcoin-regtest',
        scheme: 'taproot-musig2',
        threshold: 2,
        cosignerPubkeys: [ALICE, DAVE],
        msgHash: '22'.repeat(32),
        psbtHex: '70736274ff',
        actionSummary: 'Send 1 BTC',
    });
    return {
        ...session,
        nonces: repliedBy.map((pubkey) => ({ pubkey, publicNonce: '02'.padEnd(132, '3'), contributedAt: CONTRIBUTED_AT })),
    };
}

// A vault whose every collection call is counted, so a read per session shows.
function countingVault({ wallets = [], sessions = [] }) {
    const tables = {
        wallets: new Map(wallets.map((w) => [w.id, w])),
        multisigSigningSessions: new Map(sessions.map((s) => [s.id, s])),
    };
    const counts = { reads: 0, writes: 0 };
    const vault = {};
    for (const [name, rows] of Object.entries(tables)) {
        vault[name] = {
            async get(id) { counts.reads += 1; return rows.has(id) ? structuredClone(rows.get(id)) : null; },
            async list() { counts.reads += 1; return [...rows.values()].map((row) => structuredClone(row)); },
            async findBy(field, value) {
                counts.reads += 1;
                return [...rows.values()].filter((row) => row[field] === value).map((row) => structuredClone(row));
            },
            async put(row) { counts.writes += 1; rows.set(row.id, structuredClone(row)); return row; },
        };
    }
    return { vault, counts, tables };
}

describe('listMultisigSigningSessions names this wallet\'s keys', () => {
    it('attaches the local cosigner key of each session\'s matching config, lower-cased', async () => {
        const mine = segwitSession('wallet-1', [BOB]);
        const step1 = taprootStepOne('wallet-1', [DAVE]);
        const { vault } = countingVault({ wallets: [walletRecord()], sessions: [mine, step1] });

        const list = await listMultisigSigningSessions({ vault, walletId: 'wallet-1' });

        expect(list.map((s) => [s.id, s.localPubkeys])).toEqual([
            [mine.id, [ALICE]],
            [step1.id, [ALICE]],
        ]);
    });

    it('puts a real session waiting on this wallet under Ready and one waiting on others under Waiting', async () => {
        const waitingOnMe = segwitSession('wallet-1', [BOB]);
        const waitingOnOthers = segwitSession('wallet-1', [ALICE]);
        const stepOneOnMe = taprootStepOne('wallet-1', [DAVE]);
        const stepOneReplied = taprootStepOne('wallet-1', [ALICE]);
        const { vault } = countingVault({
            wallets: [walletRecord()],
            sessions: [waitingOnMe, waitingOnOthers, stepOneOnMe, stepOneReplied],
        });

        const groups = groupSigningSessions(await listMultisigSigningSessions({ vault, walletId: 'wallet-1' }));

        expect(groups.ready.map((s) => s.id).sort()).toEqual([waitingOnMe.id, stepOneOnMe.id].sort());
        expect(groups.waiting.map((s) => s.id).sort()).toEqual([waitingOnOthers.id, stepOneReplied.id].sort());
    });

    it('names no key when the wallet holds no config for the session or no longer exists', async () => {
        const foreign = { ...segwitSession('wallet-1', []), cosignerPubkeys: [STRANGER, BOB] };
        const orphan = segwitSession('wallet-gone', [BOB]);
        const { vault } = countingVault({ wallets: [walletRecord()], sessions: [foreign, orphan] });

        expect((await listMultisigSigningSessions({ vault, walletId: 'wallet-1' }))[0].localPubkeys).toEqual([]);
        const gone = await listMultisigSigningSessions({ vault, walletId: 'wallet-gone' });
        expect(gone.map((s) => s.localPubkeys)).toEqual([[]]);
        expect(groupSigningSessions(gone).waiting).toHaveLength(1);
    });

    it('returns public keys only and never writes the derived field back', async () => {
        const session = segwitSession('wallet-1', [BOB]);
        const { vault, counts, tables } = countingVault({ wallets: [walletRecord()], sessions: [session] });

        const [row] = await listMultisigSigningSessions({ vault, walletId: 'wallet-1' });
        const text = JSON.stringify(row);

        for (const secret of [SIGNER_ID, 'f00dcafe', 'tpubExternalCosignerXpub', "m/48'", 'sealed-seed-bytes']) {
            expect(text).not.toContain(secret);
        }
        expect(Object.keys(row).sort()).toEqual([...Object.keys(session), 'localPubkeys'].sort());
        expect(counts.writes).toBe(0);
        expect(tables.multisigSigningSessions.get(session.id)).not.toHaveProperty('localPubkeys');
    });

    it('reads the same number of times for 2 sessions as for 20', async () => {
        const readsFor = async (count) => {
            const sessions = Array.from({ length: count }, (_, i) => (i % 2
                ? segwitSession('wallet-1', [BOB])
                : taprootStepOne('wallet-1', [DAVE])));
            sessions.push(segwitSession('wallet-other', [BOB]));
            const { vault, counts } = countingVault({ wallets: [walletRecord(), walletRecord('wallet-other')], sessions });
            const list = await listMultisigSigningSessions({ vault, walletId: 'wallet-1' });
            expect(list).toHaveLength(count);
            expect(list.every((s) => s.localPubkeys.includes(ALICE))).toBe(true);
            return counts.reads;
        };

        const atTwo = await readsFor(2);
        const atTwenty = await readsFor(20);
        expect(atTwo).toBe(2);
        expect(atTwenty).toBe(atTwo);
    });
});
