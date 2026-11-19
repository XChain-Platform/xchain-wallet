// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Multisig Sessions page reads its list through each shell's renderer
// messaging: the extension popup over chrome.runtime to the service worker's
// createBackgroundHost, the web page through hostBridge, and desktop over the
// preload bridge to the main process's createDesktopMessageHost. All three
// must hand back `localPubkeys` so a real session waiting on this wallet sits
// under Ready, and the read count must not grow with the session count.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { createDesktopMessageHost } from '../../../packages/desktop/main/messageHost.js';
import * as extensionMessaging from '../../../packages/extension/src/popup/messaging.js';
import * as desktopMessaging from '../../../packages/desktop/renderer/messaging.js';
import * as webMessaging from '../../../packages/web/src/messaging.js';
import { __resetForTests, __setHostForTests } from '../../../packages/web/src/hostBridge.js';
import { buildMultisigConfig } from '../../../packages/core/src/schemas/multisigConfig.js';
import { createMultisigSigningSession } from '../../../packages/core/src/schemas/multisigSigningSession.js';
import { groupSigningSessions } from '../../../packages/core/src/shared/routes/MultisigSigningSession.jsx';

const ALICE = `02${'aa'.repeat(32)}`;
const BOB = `03${'bb'.repeat(32)}`;
const CAROL = `02${'cc'.repeat(32)}`;
const SIGNER_ID = 'signer-local-secret-id';

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

const WALLET = {
    id: 'wallet-1',
    name: 'Main',
    encryptedSeed: 'sealed-seed-bytes',
    multisigs: [buildMultisigConfig({
        id: 'config-segwit',
        scheme: 'p2wsh-multisig',
        threshold: 2,
        cosigners: [
            cosigner('Me', ALICE, 'local'),
            cosigner('Bob', BOB, 'external-xpub'),
            cosigner('Carol', CAROL, 'external-hardware'),
        ],
    })],
};

function session(signedBy) {
    const record = createMultisigSigningSession({
        walletId: WALLET.id,
        chainId: 'bitcoin-regtest',
        scheme: 'p2wsh-multisig',
        threshold: 2,
        cosignerPubkeys: [ALICE, BOB, CAROL],
        msgHash: '11'.repeat(32),
        psbtHex: '70736274ff',
        actionSummary: 'Send 0.25 BTC to bcrt1qdestination',
    });
    return {
        ...record,
        signatures: signedBy.map((pubkey) => ({
            pubkey, sig: '3044'.padEnd(140, '0'), contributedAt: '2026-11-15T10:00:00.000Z',
        })),
    };
}

// Every collection the host can touch, each call counted.
function countingVault(sessions) {
    const tables = {
        wallets: [WALLET],
        accounts: [],
        addresses: [],
        contacts: [],
        connectedSites: [],
        pendingTxs: [],
        signers: [],
        multisigSigningSessions: sessions,
    };
    const counts = { reads: 0, writes: 0 };
    const vault = {
        settings: {
            async get() { counts.reads += 1; return {}; },
            async put() { counts.writes += 1; },
        },
    };
    for (const [name, initial] of Object.entries(tables)) {
        const rows = new Map(initial.map((row) => [row.id, structuredClone(row)]));
        vault[name] = {
            async get(id) { counts.reads += 1; return rows.has(id) ? structuredClone(rows.get(id)) : null; },
            async list() { counts.reads += 1; return [...rows.values()].map((row) => structuredClone(row)); },
            async findBy(field, value) {
                counts.reads += 1;
                return [...rows.values()].filter((row) => row[field] === value).map((row) => structuredClone(row));
            },
            async count() { counts.reads += 1; return rows.size; },
            async put(row) { counts.writes += 1; rows.set(row.id, structuredClone(row)); return row; },
        };
    }
    return { vault, counts };
}

function hostDeps(vault) {
    return {
        vault,
        chainRegistry: { get: () => null, list: () => [], supportedChains: () => [] },
        sdkRegistry: { get: () => ({}), for: () => ({}) },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    };
}

// Each shell's own renderer messaging, wired to a host over its transport.
// Messages are cloned both ways, as chrome.runtime and Electron IPC do.
const SHELLS = {
    extension(vault) {
        const host = createBackgroundHost(hostDeps(vault));
        vi.stubGlobal('chrome', {
            runtime: {
                lastError: undefined,
                sendMessage(message, reply) {
                    host.handle(structuredClone(message)).then((response) => reply(structuredClone(response)));
                },
            },
        });
        return extensionMessaging.listMultisigSigningSessions;
    },
    web(vault) {
        __setHostForTests(createBackgroundHost(hostDeps(vault)));
        return webMessaging.listMultisigSigningSessions;
    },
    desktop(vault) {
        const desktop = createDesktopMessageHost(hostDeps(vault));
        vi.stubGlobal('xchainWalletBridge', {
            sendMessage: async (message) => structuredClone(await desktop.handle(structuredClone(message))),
        });
        return desktopMessaging.listMultisigSigningSessions;
    },
};

afterEach(() => {
    vi.unstubAllGlobals();
    __resetForTests();
});

describe.each(Object.keys(SHELLS))('%s shell: multisig session list', (shell) => {
    it('puts a session waiting on this wallet under Ready and one waiting on others under Waiting', async () => {
        const waitingOnMe = session([BOB]);
        const waitingOnOthers = session([ALICE]);
        const { vault } = countingVault([waitingOnMe, waitingOnOthers]);
        const list = await SHELLS[shell](vault)({ walletId: WALLET.id });

        expect(list.map((s) => [s.id, s.localPubkeys]).sort()).toEqual([
            [waitingOnMe.id, [ALICE]],
            [waitingOnOthers.id, [ALICE]],
        ].sort());
        const groups = groupSigningSessions(list);
        expect(groups.ready.map((s) => s.id)).toEqual([waitingOnMe.id]);
        expect(groups.waiting.map((s) => s.id)).toEqual([waitingOnOthers.id]);

        // Public keys only cross the bridge.
        const text = JSON.stringify(list);
        for (const secret of [SIGNER_ID, 'f00dcafe', 'tpubExternalCosignerXpub', "m/48'", 'sealed-seed-bytes']) {
            expect(text).not.toContain(secret);
        }
    });

    it('reads the same number of times for 2 sessions as for 20', async () => {
        const readsFor = async (count) => {
            const sessions = Array.from({ length: count }, (_, i) => session(i % 2 ? [ALICE] : [BOB]));
            const { vault, counts } = countingVault(sessions);
            const list = SHELLS[shell](vault);
            const before = { ...counts };
            const result = await list({ walletId: WALLET.id });
            expect(result).toHaveLength(count);
            expect(counts.writes).toBe(before.writes);
            return counts.reads - before.reads;
        };

        const atTwo = await readsFor(2);
        const atTwenty = await readsFor(20);
        expect(atTwo).toBe(2);
        expect(atTwenty).toBe(atTwo);
    });
});
