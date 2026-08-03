// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Onboarding & wallet lifecycle": Publish-labels-on-chain
// (§19.5.2), listed as undriven since the feature shipped and never once run
// against a chain.
//
// WHY THIS ONE IS WORTH A BROADCAST. The button encrypts this wallet's labels +
// contacts and writes them to a PUBLIC ledger, and a blockchain write cannot be
// retracted. The Settings copy makes a specific, falsifiable promise - "The
// labels + contacts are encrypted under a key derived from this wallet's seed
// ... Only someone who already has your seed can decrypt them" - so if any
// label, contact name or note reaches the chain readable, the wallet has
// published the user's address book permanently while telling them it had not.
// That is the assertion this spec exists for.
//
// WHAT THE EXISTING COVERAGE DOES NOT ANSWER. `test/smoke/ui/publish-labels-ui.smoke.js`
// is entirely static: it greps the source to prove `publishLabelsNow` calls
// `encodeLabelSyncPayload` and `submitAction`. That proves the encrypt function
// is CALLED. It cannot prove what bytes leave the machine. The unit half
// (`test/unit/crypto/labelSync.test.js`) proves the codec leaks no plaintext and
// uses a fresh IV. Neither layer can see the transaction the wallet actually
// broadcasts, which is the only thing a stranger with a block explorer ever sees.
//
// GROUND TRUTH IS THE NODE, DELIBERATELY. The payload rides in the transaction's
// data carrier, not in a field the explorer serves: `/api/action/<i>` returns
// `data: null` for a FILE and the indexer's `transactions.data` column holds the
// decoded params only. So the canary search runs against `getrawtransaction`
// from the coin node itself - the actual bytes on the chain, read through
// nothing this wallet wrote. A leak hidden by an explorer's own parsing cannot
// hide from that.
//
// THE CONTROL IS THE HALF THAT MAKES THE ABSENCE MEAN ANYTHING. "The canary is
// not on chain" passes trivially if the canary never entered the payload - a
// wallet that published an EMPTY labels list would sail through. So the run
// publishes TWICE: once before any label or contact exists, then again after
// adding them, and asserts the encrypted size GREW. The growth is what proves
// the canaries were in the bytes that the search then fails to find.
//
// AND THE DISCOVERY NAME IS ASSERTED STABLE ACROSS BOTH PUBLISHES, because it is
// the whole restore mechanism: it is SHA256 of a seed-derived commitment key, and
// a from-seed restore finds the payload by matching the FILE's NAME against it
// (FOLLOWUP 2). A name that changed per publish would leave every earlier copy
// unfindable.
//
// SCOPE NOTE, so nobody reads more into a green run than it earns: the restore
// lane does not exist yet. `applyLabelSyncPayload` is exported and called by
// nothing, and there is no fetch-by-discovery-name anywhere in `packages/*/src`.
// That is a TRACKED deferral (FOLLOWUPS.md, "FOLLOWUP 2 - Fetch + decrypt +
// apply on restore"), not a defect found here. This spec therefore proves the
// publish half is sound and pins the two properties that lane will depend on.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/onboarding/publish-labels.regtest.spec.js

import { spawn } from 'node:child_process';
import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** Two FILE publishes; FILE carries no protocol fee, so this is miner fees only. */
const FUNDING = 2;

/**
 * High-entropy canaries. A hit cannot be coincidence and a miss cannot be a
 * short-string fluke - and none of them is a substring of any address, ticker
 * or default label this wallet generates.
 */
const RUN_TAG = String(Date.now()).slice(-8);
const LABEL_CANARY = `ZQ7LBL${RUN_TAG}`;
const CONTACT_CANARY = `ZQ7CNT${RUN_TAG}`;
const NOTES_CANARY = `ZQ7NOTE${RUN_TAG}`;

/**
 * The coin node this venue's chain runs on, for `getrawtransaction`.
 *
 * Only Litecoin is filled in because only Litecoin has been verified: the CLI
 * needs the container's own conf (`-conf=`), which is also what keeps the RPC
 * credentials inside the container and off every command line. Guessing the
 * other two would produce a spec that fails obscurely off its venue, so it
 * refuses by name instead.
 */
const NODE = {
    RLTC: { container: 'xchain-node-litecoin-regtest-node', cli: 'litecoin-cli', conf: '/etc/litecoin/litecoin.conf' },
}[REGTEST_COIN];

const SSH_HOST = process.env.XC_REGTEST_SSH_HOST || 'devhost';

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/**
 * The raw transaction hex, straight from the coin node.
 *
 * Read through `docker exec` + the node's own conf so no credential is ever an
 * argument, the same credential-free shape `runInIndexer` uses.
 */
async function rawTransactionHex(txid) {
    const args = [
        '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', SSH_HOST,
        'docker', 'exec', NODE.container, NODE.cli, `-conf=${NODE.conf}`,
        'getrawtransaction', txid,
    ];
    return new Promise((resolve, reject) => {
        const child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('getrawtransaction timed out')); }, 60_000);
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('error', (e) => { clearTimeout(timer); reject(e); });
        child.on('close', (code) => {
            clearTimeout(timer);
            const hex = out.trim().split('\n').filter(Boolean).pop() || '';
            if (code !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
                reject(new Error(`getrawtransaction ${txid} exited ${code}: ${err.trim() || out.trim() || '(no output)'}`));
                return;
            }
            resolve(hex.toLowerCase());
        });
    });
}

async function mineIfBehind() {
    try {
        const status = await explorerJson('status');
        if (Number(status?.decoder_lag_blocks?.[REGTEST_COIN] ?? 0) > 3) return;
        await minerRpc('generate_blocks', { count: 1 });
    } catch { /* best-effort; the waits carry the timeout */ }
}

async function waitForIndexedAction(txid, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson('actions?limit=100').catch(() => null);
        const row = (list?.data || []).find((r) => r.tx_hash === txid);
        // Details only for an index the LIST returned: a speculative GET on an
        // index that does not exist yet is memoized blank for the life of the
        // explorer process (D-127/, campaign §3.6).
        if (row) return explorerJson(`action/${row.action_index}`);
        await mineIfBehind();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`No XChain action recorded for ${txid} within ${Math.round(timeoutMs / 1000)}s`);
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);
    const row = page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/**
 * Runs one publish and returns what the report screen states.
 *
 * The report is the wallet's own claim about what it just did; every number it
 * gives back is checked against the chain afterwards rather than trusted.
 */
async function publishLabels(page) {
    await gotoPalette(page, 'Settings');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: /^Backup/ }).first().click();

    const open = main.getByRole('button', { name: 'Publish now…', exact: true });
    await expect(open, 'the Backup section offers no "Publish now…" action').toBeVisible({ timeout: 30_000 });
    await open.click();

    const chain = page.getByLabel('Publish chain');
    await expect(chain, 'the publish form has no chain picker').toBeVisible({ timeout: 30_000 });
    await chain.selectOption(REGTEST_CHAIN_ID);
    await page.getByLabel('Wallet password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();

    await expect(main.getByText('✓ Labels published'), 'the publish never reported success')
        .toBeVisible({ timeout: 180_000 });

    const text = await main.innerText();
    const txid = text.match(/[0-9a-f]{64}/)?.[0];
    const sizeBytes = Number(text.match(/(\d+)\s*bytes/)?.[1]);
    // The discovery name is the OTHER 64-hex string on the screen; take the
    // last one so a txid appearing first cannot be mistaken for it.
    const hexes = text.match(/[0-9a-f]{64}/g) || [];
    const discoveryName = hexes.length > 1 ? hexes[hexes.length - 1] : null;

    expect(txid, 'the report shows no txid').toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isFinite(sizeBytes), 'the report shows no encrypted size').toBe(true);
    expect(discoveryName, 'the report shows no discovery name').toMatch(/^[0-9a-f]{64}$/);

    await main.getByRole('button', { name: 'Done', exact: true }).click();
    return { txid, sizeBytes, discoveryName };
}

/** Every way a readable string could survive into a transaction's bytes. */
function assertAbsentFromChain(rawHex, canary, label) {
    const asHex = Buffer.from(canary, 'utf8').toString('hex');
    expect(rawHex, `${label} ("${canary}") is on chain, hex-encoded, in plain sight`)
        .not.toContain(asHex);
    const asBytes = Buffer.from(rawHex, 'hex').toString('latin1');
    expect(asBytes, `${label} ("${canary}") is readable in the transaction's bytes`)
        .not.toContain(canary);
}

test.describe(`on-chain label publish on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(3_000_000);

    test('a published payload carries no readable label or contact, under one stable discovery name', async ({ page }) => {
        test.skip(!NODE, `no verified coin-node recipe for ${REGTEST_COIN}; run this on RLTC`);

        let owner;
        let baseline;
        let loaded;

        await test.step('fund the wallet the publish will sign from', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Label Publisher' });
            await switchToRegtest(page, PASSWORD);

            // Read the venue chain's address off a form that has both a chain
            // picker and a Source field. §3.5 bullet 3: on these venues BTC and
            // LTC regtest share version bytes, so an address must never be
            // identified by its prefix.
            await gotoPalette(page, 'Create dispenser');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            owner = await main.getByRole('textbox', { name: 'Source' }).inputValue();
            expect(owner, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);

            // `publishLabelsNow` signs from the newest external HD address on
            // the chosen chain, which on a fresh wallet is this one.
            await fundAddress(owner, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('publish once with nothing labelled - the baseline', async () => {
            baseline = await publishLabels(page);
            const action = await waitForIndexedAction(baseline.txid);
            expect(String(action.status), 'the chain rejected the baseline publish').toBe('valid');
            expect(String(action.action), 'the publish did not land as a FILE action').toBe('FILE');
            expect(String(action.name),
                'the FILE name on chain is not the discovery name the wallet reported, so a '
                + 'from-seed restore could never find this payload')
                .toBe(baseline.discoveryName);
            expect(String(action.title), 'the FILE title changed').toBe('wallet-labels');
        });

        await test.step('label an address and add a contact', async () => {
            await gotoPalette(page, 'Addresses');
            const main = page.getByRole('main');
            const row = main.getByLabel(`View address ${owner}`).first();
            await expect(row, 'the funded address is not in the address list').toBeVisible({ timeout: 30_000 });
            await row.click();

            const labelInput = page.getByLabel('Address label');
            await expect(labelInput, 'the address detail has no label field').toBeVisible({ timeout: 30_000 });
            await labelInput.fill(LABEL_CANARY);
            const saveLabel = page.getByRole('button', { name: 'Save', exact: true });
            await saveLabel.click();
            // Save re-disables itself once the draft matches the PERSISTED
            // label, so this is the write landing rather than a click landing.
            // Checked per canary: the size-growth assertion later would still
            // pass if only one of the two made it in, leaving the other's
            // absence from the chain meaningless.
            await expect(saveLabel, 'the address label was never persisted')
                .toBeDisabled({ timeout: 30_000 });

            // NOT scoped to `main`: "Add contact" lives in the screen HEADER's
            // trailing slot, outside the main landmark, so a main-scoped
            // locator waits out its timeout on a button that is plainly on
            // screen. Cost a run.
            await gotoPalette(page, 'Contacts');
            await page.getByLabel('Add contact').first().click();
            await page.getByRole('textbox', { name: 'Name' }).fill(CONTACT_CANARY);
            // A contact is a NAME PLUS AN ADDRESS - saving without one is
            // refused, and the refusal is quiet enough that the first draft of
            // this spec walked straight past it into a publish with no contact
            // in the payload. The wallet's own address is used so the entry's
            // chain auto-detects to this venue.
            //
            // Located BY ROLE, not by label: a bare getByLabel('Address') also
            // matches the header's "Scan and addresses" button and dies on a
            // strict-mode violation.
            await page.getByRole('textbox', { name: 'Address' }).fill(owner);
            await page.getByRole('textbox', { name: 'Notes' }).fill(NOTES_CANARY);
            await page.getByRole('button', { name: 'Save', exact: true }).first().click();
            // Back on the list, with the new contact on it: the publish reads
            // the vault, so the write has to have landed before it runs.
            await expect(page.getByText(CONTACT_CANARY).first(),
                'the contact was never saved, so its canary would not be in the payload')
                .toBeVisible({ timeout: 30_000 });
        });

        await test.step('publish again, and the payload must have grown', async () => {
            loaded = await publishLabels(page);

            // THE CONTROL. Without this the canary search below would pass on a
            // wallet that published an empty payload, which is the one way an
            // encryption test can be green and worthless.
            expect(loaded.sizeBytes,
                'the encrypted payload did not grow after a label and a contact were added, so '
                + 'the canaries never entered it and the search below proves nothing')
                .toBeGreaterThan(baseline.sizeBytes);

            // Stable across publishes: this is the restore mechanism (FOLLOWUP 2
            // matches a FILE's NAME against the seed-derived hash), so a name
            // that moved would strand every earlier copy.
            expect(loaded.discoveryName,
                'the discovery name changed between two publishes from the SAME seed, so a '
                + 'from-seed restore could not find both copies')
                .toBe(baseline.discoveryName);

            const action = await waitForIndexedAction(loaded.txid);
            expect(String(action.status), 'the chain rejected the second publish').toBe('valid');
            expect(String(action.name), 'the FILE name on chain is not the reported discovery name')
                .toBe(loaded.discoveryName);
        });

        await test.step('and none of it is readable on the chain', async () => {
            // The subject. Read from the coin node, so this is the transaction
            // as any stranger with a full node sees it.
            const rawHex = await rawTransactionHex(loaded.txid);
            expect(rawHex.length, 'the node returned an empty transaction').toBeGreaterThan(100);

            assertAbsentFromChain(rawHex, LABEL_CANARY, 'the address label');
            assertAbsentFromChain(rawHex, CONTACT_CANARY, 'the contact name');
            assertAbsentFromChain(rawHex, NOTES_CANARY, 'the contact note');
        });
    });
});
