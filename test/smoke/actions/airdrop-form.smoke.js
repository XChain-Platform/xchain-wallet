// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2: Step 24 (piece 9): AIRDROP via LIST + AIRDROP
// two-transaction flow (§40.9).
//
// Asserts:
//   1. AirdropForm.jsx exists + exports a single component; reuses
//      IssueTokenForm CSS per the DividendForm precedent.
//   2. Five-stage state machine: compose → review-list → wait-index →
//      review-airdrop → done.
//   3. Decoder calls for LIST (stage review-list / wait-index) and
//      AIRDROP (stage review-airdrop / done).
//   4. Messaging call-sites: createList + airdropAction + getActionByTxid
//      + savePendingAirdrop + updatePendingAirdrop + listPendingAirdrops
//      + clearPendingAirdrop. Password-error handling for both signs.
//   5. Polling loop pauses on document.visibilityState hidden.
//   6. Parser module: parsePaste / parseCsv / classifyRecipients /
//      isPlausibleAddress round-trips; bech32 + base58 accepted,
//      garbage rejected, duplicates counted.
//   7. Core flows: createList / airdropAction / actionByTxid /
//      listByActionIndex / pendingAirdrops CRUD are re-exported +
//      guard required inputs. actionByTxid returns null on 404.
//   8. Decoder LIST v0/v1 + AIRDROP v0/v1/v2 cases surface summary +
//      details + warnings.
//   9. Background host registers action.createList + action.airdrop +
//      actions.byTxid + lists.byActionIndex + pendingAirdrops.save +
//      pendingAirdrops.listForWallet + pendingAirdrops.update +
//      pendingAirdrops.clear.
//  10. All three shells' messaging.js expose: createList, airdropAction,
//      getActionByTxid, getListByActionIndex, savePendingAirdrop,
//      listPendingAirdropsForWallet, updatePendingAirdrop,
//      clearPendingAirdrop.
//  11. ActionsMenu 'airdrop' entry + App.jsx 'airdrop' sub-route + Home
//      resume-card wiring in popup / web / desktop.
//  12. PendingAirdrop schema round-trips through the vault with stage
//      transitions and survives persistence reload.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    flows,
    decoder,
    airdrop as airdropLib,
    schemas,
    storage,
    registry as registryLib,
} from '../../../packages/core/src/index.js';

const chainRegistry = registryLib.defaultRegistry();

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'AirdropForm.jsx');
assert.ok(existsSync(formPath), 'AirdropForm.jsx exists');

const src = readFileSync(formPath, 'utf8');

// --- 1. Single-component export ---------------------------------------

assert.ok(/export function AirdropForm\b/.test(src), 'AirdropForm is a named export');
assert.equal(
    (src.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'AirdropForm.jsx only exports the component',
);
assert.ok(
    /IssueTokenForm\.module\.css/.test(src),
    'AirdropForm reuses IssueTokenForm CSS module',
);

// --- 2. Five-stage state machine --------------------------------------

for (const stage of ['compose', 'review-list', 'wait-index', 'review-airdrop', 'done']) {
    assert.ok(src.includes(`'${stage}'`), `AirdropForm tracks stage "${stage}"`);
}

// --- 3. Decoder call-sites --------------------------------------------

assert.ok(
    /action:\s*['"]LIST['"]/.test(src),
    'AirdropForm calls decoder with action: "LIST"',
);
assert.ok(
    /action:\s*['"]AIRDROP['"]/.test(src),
    'AirdropForm calls decoder with action: "AIRDROP"',
);
assert.ok(/decoderLib\.decodeAction/.test(src), 'AirdropForm invokes decoder.decodeAction');
assert.ok(src.includes('listDecoded') && src.includes('airdropDecoded'),
    'AirdropForm renders separate LIST + AIRDROP decoder output',
);

// --- 4. Messaging call-sites ------------------------------------------

assert.ok(/messaging\.createList\s*\(/.test(src), 'AirdropForm calls messaging.createList');
assert.ok(/messaging\.airdropAction\s*\(/.test(src), 'AirdropForm calls messaging.airdropAction');
assert.ok(/messaging\.getActionByTxid\s*\(/.test(src), 'AirdropForm polls messaging.getActionByTxid');
assert.ok(/messaging\.savePendingAirdrop\s*\(/.test(src), 'AirdropForm calls messaging.savePendingAirdrop');
assert.ok(/messaging\.updatePendingAirdrop\s*\(/.test(src), 'AirdropForm calls messaging.updatePendingAirdrop');
assert.ok(/messaging\.listPendingAirdropsForWallet\s*\(/.test(src), 'AirdropForm calls messaging.listPendingAirdropsForWallet for resume hydration');
assert.ok(/messaging\.clearPendingAirdrop\s*\(/.test(src), 'AirdropForm calls messaging.clearPendingAirdrop on cancel / done');
assert.ok(src.includes("'InvalidPasswordError'"), 'AirdropForm handles wrong-password');

// --- 4b. CSV / TXT drop-zone wiring (Cluster P FOLLOWUP 2) ------------

assert.ok(/import \{ useDropZone \} from '\.\.\/hooks\/useDropZone\.js'/.test(src),
    'AirdropForm imports useDropZone for additive drag-and-drop');
assert.ok(/const recipientsDrop = useDropZone\(\{[\s\S]*?accept:\s*\[[^\]]*'\.csv'[^\]]*'\.txt'[^\]]*\][\s\S]*?onFile:/m.test(src),
    'recipientsDrop accepts .csv/.txt and wires onFile to airdropLib.parseCsv');
assert.ok(/airdropLib\.parseCsv\(text\)/.test(src),
    'recipientsDrop reuses airdropLib.parseCsv to fill the recipients textarea');
assert.ok(/\{\.\.\.recipientsDrop\.rootProps\}/.test(src),
    'recipientsDrop.rootProps spreads onto the recipients label so the drop target is visible');
assert.ok(/recipientsDrop\.isDragOver\s*\?\s*'Drop the CSV \/ TXT file here'/.test(src),
    'placeholder copy flips while a drag is in flight');

// --- 5. Polling loop visibility gate + interval -----------------------

assert.ok(
    /visibilityState\s*===\s*['"]hidden['"]/.test(src),
    'AirdropForm pauses polling when the tab is hidden',
);
assert.ok(
    /setInterval\([^,]+,\s*POLL_INTERVAL_MS\)/.test(src),
    'AirdropForm uses a named POLL_INTERVAL_MS constant',
);
assert.ok(/POLL_INTERVAL_MS\s*=\s*10_?000/.test(src), 'poll interval is 10 seconds');

// --- 6. Parser module -------------------------------------------------

{
    const parts = airdropLib.parsePaste('bc1q,\n\n"bc1q2"\nbc1q3, bc1q4\n');
    assert.deepEqual(parts, ['bc1q', 'bc1q2', 'bc1q3', 'bc1q4'], 'parsePaste splits + trims + strips quotes');

    const csv = airdropLib.parseCsv('address,label\nbc1q1,alice\nbc1q2,bob\n');
    assert.deepEqual(csv, ['bc1q1', 'bc1q2'], 'parseCsv drops header + picks first column');

    const csvNoHeader = airdropLib.parseCsv('bc1q1\nbc1q2\n');
    assert.deepEqual(csvNoHeader, ['bc1q1', 'bc1q2'], 'parseCsv handles headerless input');

    assert.equal(
        airdropLib.isPlausibleAddress('1FWDonkMbC6hL64JiysuggHnUAw2CKWszs'),
        true,
        'isPlausibleAddress accepts a valid P2PKH',
    );
    assert.equal(
        airdropLib.isPlausibleAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'),
        true,
        'isPlausibleAddress accepts a valid bech32',
    );
    assert.equal(airdropLib.isPlausibleAddress('abc'), false, 'rejects short strings');
    assert.equal(airdropLib.isPlausibleAddress('!@#$%^&*()1234567890abcd'), false, 'rejects bad charset');

    const classified = airdropLib.classifyRecipients([
        '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs',
        '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs',   // dup
        'garbage',
        'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    ]);
    assert.equal(classified.valid.length, 2);
    assert.equal(classified.invalid.length, 1);
    assert.equal(classified.duplicates, 1);

    // : with a chain, validation is network-aware. A mainnet address
    // pasted into a regtest wallet used to be counted, priced, paid for and
    // then dropped by the indexer.
    const onRegtest = airdropLib.classifyRecipients([
        'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
        'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
        'garbage',
    ], { coin: 'bitcoin', network: 'regtest' });
    assert.equal(onRegtest.valid.length, 1, 'regtest chain keeps only the regtest address');
    assert.deepEqual(onRegtest.wrongNetwork, ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'],
        'the mainnet address is reported as wrong-network, not as garbage');
    assert.equal(onRegtest.invalid.length, 2, 'wrong-network entries still count as skipped');

    // Post-index reconcile: the list the chain stored vs the list submitted.
    const rec = airdropLib.reconcileStoredList(
        ['bcrt1qa', 'bcrt1qb', 'bc1qmainnet'],
        ['bcrt1qa', 'bcrt1qb'],
    );
    assert.equal(rec.storedCount, 2, 'reconcile reads the stored count off the chain');
    assert.deepEqual(rec.missing, ['bc1qmainnet'], 'reconcile names what the chain dropped');
    assert.equal(rec.ok, false);
}

// --- 6b. Network-aware wiring at the call sites  ---------------

assert.ok(/classifyRecipients\(\s*\n?\s*parts,\s*\n?\s*\{\s*coin: recipientCoin, network: recipientNetwork\s*\}/m.test(src),
    'AirdropForm passes the ACTIVE chain to classifyRecipients');
assert.ok(/const recipientCoin = descriptor\?\.coin/.test(src)
    && /const recipientNetwork = descriptor\?\.networkKind/.test(src),
    'AirdropForm derives the recipient chain from the active chain descriptor');
assert.ok(/airdropLib\.reconcileStoredList\(/.test(src),
    'AirdropForm reconciles the published list against its own count');
assert.ok(/messaging\.getListByActionIndex\(\{ chainId, actionIndex: listActionIndex \}\)/.test(src),
    'AirdropForm reads the published list back once it is indexed');
assert.ok(/listReconcile \? listReconcile\.storedCount : recipients\.valid\.length/.test(src),
    'the recipient count that prices step 2 prefers the chain-stored count');
assert.ok(/recipients\.wrongNetwork\.length > 0/.test(src),
    'AirdropForm calls out wrong-network recipients separately from garbage');

// --- 7. Core flow guard-rails -----------------------------------------

for (const name of [
    'createList', 'airdropAction',
    'actionByTxid', 'listByActionIndex',
    'savePendingAirdrop', 'listPendingAirdropsForWallet',
    'updatePendingAirdrop', 'clearPendingAirdrop',
]) {
    assert.equal(typeof flows[name], 'function', `flows.${name} re-exported from core`);
}

await assert.rejects(async () => flows.createList(), /createList: opts is required/);
await assert.rejects(async () => flows.createList({ params: {} }), /VERSION must be/);
await assert.rejects(async () => flows.createList({ params: { VERSION: '0', ITEM: [] } }), /non-empty array/);
await assert.rejects(async () => flows.createList({ params: { VERSION: '0', ITEM: ['x'] } }), /TYPE must be/);
await assert.rejects(
    async () => flows.createList({ params: { VERSION: '1', ITEM: ['x'] } }),
    /EDIT must be/,
);

await assert.rejects(async () => flows.airdropAction(), /airdropAction: opts is required/);
await assert.rejects(async () => flows.airdropAction({ params: {} }), /TICK is required/);
await assert.rejects(async () => flows.airdropAction({ params: { TICK: 'A' } }), /AMOUNT is required/);
await assert.rejects(async () => flows.airdropAction({ params: { TICK: 'A', AMOUNT: '1' } }), /LIST_ACTION_INDEX is required/);

{
    const sdk = { getTransaction: () => { const e = new Error('not found'); e.status = 404; throw e; } };
    const sdkRegistry = { get: () => sdk };
    const r = await flows.actionByTxid({ sdkRegistry, chainId: 'x', txid: 'abc' });
    assert.equal(r, null, 'actionByTxid maps 404 to null');
}

{
    // The QUERY TYPE is asserted, not just the return value. /transaction/
    // accepts tx_hash and tx_index only; this called it with 'hash', which
    // 404s for every txid, and the 404 branch above turns that into null - so
    // the resolved-action path could never be reached in production while a
    // stub that ignored its arguments reported it working.
    let seen = null;
    const sdk = { getTransaction: (q, type) => { seen = { q, type }; return { tx_hash: 'abc', action_index: '1234' }; } };
    const sdkRegistry = { get: () => sdk };
    const r = await flows.actionByTxid({ sdkRegistry, chainId: 'x', txid: 'abc' });
    assert.equal(r.action_index, '1234', 'actionByTxid returns the resolved action');
    assert.equal(seen.q, 'abc', 'actionByTxid queries by the txid');
    assert.equal(seen.type, 'tx_hash', 'actionByTxid uses the tx_hash query type the route accepts');
}

await assert.rejects(async () => flows.listByActionIndex({}), /sdkRegistry is required/);
await assert.rejects(async () => flows.listByActionIndex({ sdkRegistry: {} }), /chainId is required/);
await assert.rejects(async () => flows.listByActionIndex({ sdkRegistry: {}, chainId: 'x' }), /actionIndex is required/);

// --- 8. Decoder LIST + AIRDROP coverage -------------------------------

{
    const d = decoder.decodeAction({
        action: 'LIST',
        params: { VERSION: '0', TYPE: '2', ITEM: ['bc1qa', 'bc1qb'] },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.match(d.summary, /Create address list of 2 items on Bitcoin/);
}

{
    const d = decoder.decodeAction({
        action: 'AIRDROP',
        params: { VERSION: '0', TICK: 'MYTOKEN', AMOUNT: '10', LIST_ACTION_INDEX: '1234' },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.match(d.summary, /Airdrop 10 MYTOKEN on Bitcoin to list #1234/);
    assert.equal(d.warnings.length, 0);
}

// --- 9. Background handler registrations ------------------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
for (const route of [
    'action.createList',
    'action.airdrop',
    'actions.byTxid',
    'lists.byActionIndex',
    'pendingAirdrops.save',
    'pendingAirdrops.listForWallet',
    'pendingAirdrops.update',
    'pendingAirdrops.clear',
]) {
    assert.ok(
        bg.includes(`host.register('${route}'`),
        `background host registers ${route}`,
    );
}

// --- 10. Three-shell messaging re-exports -----------------------------

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of [
        'createList',
        'airdropAction',
        'getActionByTxid',
        'getListByActionIndex',
        'savePendingAirdrop',
        'listPendingAirdropsForWallet',
        'updatePendingAirdrop',
        'clearPendingAirdrop',
    ]) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
    assert.ok(/sendMessage\('action\.createList'/.test(m), `${shell} routes createList via action.createList`);
    assert.ok(/sendMessage\('action\.airdrop'/.test(m), `${shell} routes airdropAction via action.airdrop`);
    assert.ok(/sendMessage\('actions\.byTxid'/.test(m), `${shell} routes getActionByTxid`);
    assert.ok(/sendMessage\('lists\.byActionIndex'/.test(m), `${shell} routes getListByActionIndex`);
    assert.ok(/sendMessage\('pendingAirdrops\.save'/.test(m), `${shell} routes savePendingAirdrop`);
    assert.ok(/sendMessage\('pendingAirdrops\.listForWallet'/.test(m), `${shell} routes listPendingAirdropsForWallet`);
    assert.ok(/sendMessage\('pendingAirdrops\.update'/.test(m), `${shell} routes updatePendingAirdrop`);
    assert.ok(/sendMessage\('pendingAirdrops\.clear'/.test(m), `${shell} routes clearPendingAirdrop`);
}

// --- 11. ActionsMenu entry + App.jsx sub-route + Home wiring ----------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('AirdropForm'), `${shell} App.jsx imports AirdropForm`);
    assert.ok(
        app.includes("'airdrop'"),
        `${shell} App.jsx tracks the airdrop sub-route`,
    );
    assert.ok(
        /id:\s*['"]airdrop['"]/.test(app),
        `${shell} App.jsx registers the Airdrop tokens entry`,
    );
    assert.ok(
        /onAirdrop:\s*\(\)\s*=>\s*\{/.test(app),
        `${shell} App.jsx wires onAirdrop`,
    );
    assert.ok(
        /resumeAirdropId/.test(app),
        `${shell} App.jsx tracks resumeAirdropId state`,
    );
    assert.ok(
        /onResumeAirdrop\s*=/.test(app),
        `${shell} App.jsx threads onResumeAirdrop to Home`,
    );
}

// Home surfaces the pending-airdrops resume card.
const homeSrc = readFileSync(join(sharedRoutes, 'Home.jsx'), 'utf8');
assert.ok(/onResumeAirdrop/.test(homeSrc), 'Home.jsx accepts onResumeAirdrop prop');
assert.ok(
    /listPendingAirdropsForWallet/.test(homeSrc),
    'Home.jsx fetches pending airdrops on mount',
);
assert.ok(
    /pendingAirdropCard/.test(homeSrc),
    'Home.jsx renders the resume card under the pendingAirdropCard class',
);

// --- 12. PendingAirdrop schema + vault round-trip ---------------------

{
    let blob = null;
    const backend = {
        load: async () => blob,
        save: async (b) => { blob = b; },
        clear: async () => { blob = null; },
    };
    const vault = new storage.Vault({ backend, masterKey: new Uint8Array(32) });
    await vault.open();
    const record = schemas.createPendingAirdrop({
        walletId: 'w1',
        chainId: 'bitcoin-mainnet',
        fromAddress: 'bc1qa',
        token: 'MYTOKEN',
        amountPer: '10',
        recipients: ['bc1q1', 'bc1q2'],
        listTxid: 'abcdef',
    });
    await flows.savePendingAirdrop({ vault, record });
    assert.equal(record.stage, 'waiting-index', 'fresh record starts in waiting-index');

    const listed = await flows.listPendingAirdropsForWallet({ vault, walletId: 'w1' });
    assert.equal(listed.length, 1);

    const updated = await flows.updatePendingAirdrop({
        vault, id: record.id,
        patch: { stage: 'ready-to-airdrop', listActionIndex: '1234' },
    });
    assert.equal(updated.stage, 'ready-to-airdrop');
    assert.equal(updated.listActionIndex, '1234');

    await vault.close();
    const v2 = new storage.Vault({ backend, masterKey: new Uint8Array(32) });
    await v2.open();
    const after = await flows.listPendingAirdropsForWallet({ vault: v2, walletId: 'w1' });
    assert.equal(after.length, 1, 'pendingAirdrops survive persistence reload');
    assert.equal(after[0].stage, 'ready-to-airdrop', 'stage survives reload');

    const cleared = await flows.clearPendingAirdrop({ vault: v2, id: record.id });
    assert.equal(cleared, true, 'clear returns true on deletion');
    const afterClear = await flows.listPendingAirdropsForWallet({ vault: v2, walletId: 'w1' });
    assert.equal(afterClear.length, 0);

    await assert.rejects(
        async () => flows.savePendingAirdrop({
            vault: v2,
            record: { ...record, recipients: [] },
        }),
        /non-empty/,
    );
}

console.log(
    'OK: airdrop form smoke (AirdropForm §40.9 two-tx flow: 5-stage machine + decoder LIST/AIRDROP + messaging wiring + createList + airdropAction + actionByTxid 404 + pendingAirdrops CRUD + parser + 3-shell messaging + 3-shell App.jsx + Home resume card + vault persistence round-trip)',
);
