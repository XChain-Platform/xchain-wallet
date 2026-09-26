// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-29 unlock threshold (GATE_MIN_AMOUNT), driven against a real regtest
// chain instead of the source-regex smoke coverage in
// `test/smoke/actions/gated-threshold.smoke.js`.
//
// WHY THIS SPEC IS ABOUT INERTNESS, NOT ABOUT THE BELOW-THRESHOLD LANE.
// `packages/core/src/flows/protocolActivations.js` pins
// GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS to `null` for every `*-regtest` chain id,
// by deliberate decision (see that file's header): the live regtest stack
// runs pre-train indexer/encoder/SDK services, and the wire format is
// trailing-tolerant, so an early-emitted ninth FILE field would publish
// successfully with the threshold silently and PERMANENTLY dropped, and an
// early below-threshold plain SEND would compose something an un-upgraded
// indexer rejects. There is therefore no chain in this stack on which the
// threshold lane can be exercised as ACTIVE - the smoke test pins that
// invariant, and this spec cannot and must not route around it with a
// test-only override, because that would test code the wallet never runs
// against a real network.
//
// What IS real, and worth asserting on a live chain rather than only in a
// unit test, is that the inertness HOLDS end to end here: the publisher form
// never offers the field (checked against this venue's own live indexer
// watermark, not a stub), and a gated SEND for the smallest amount that could
// exist - one that any real publisher's threshold would almost certainly sit
// above - still requires and attaches the full key handoff on chain. If the
// below-threshold lane ever activated by accident on a chain id it must not,
// this is the send that would silently stop carrying its key.

import {
    createWallet,
    expect,
    gotoSection,
    mainButton,
    test,
} from '../../fixtures/wallet.js';
import { LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY } from '../../fixtures/wallet.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';
import {
    actionStatuses,
    expectConfirmModal,
    fundAddress,
    mintXchain,
    readReceiveAddress,
    selectVenueChain,
    selectVenueSendAsset,
    switchToRegtest,
    txActions,
    tokenBalance,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING_BTC = 1;
const STAMP = Date.now().toString().slice(-6);
const TICK = `GMA${STAMP}`;
const SUPPLY = '1000';
const MINT_XCHAIN = 10;
/**
 * The smallest positive amount a non-divisible tick (the ISSUE form's
 * default) can move. If a below-threshold lane were somehow active on this
 * chain, this is the send a publisher's threshold would clear it under.
 */
const TINY_SEND_AMOUNT = '1';

async function newDevice(browser) {
    const context = await browser.newContext();
    await context.addInitScript(
        ([atKey, versionKey, version]) => {
            try {
                window.localStorage.setItem(atKey, new Date().toISOString());
                window.localStorage.setItem(versionKey, version);
            } catch { /* the gate renders and the spec fails loudly instead of silently passing */ }
        },
        [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
    );
    return context.newPage();
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
 * Every leg `txid` indexed as, oldest first, each asserted valid.
 *
 * A gated publish is BATCH(FILE, MESSAGE) and a guarded gated send is
 * BATCH(SEND, MESSAGE); each indexes as the BATCH row plus one row per leg
 * under the one tx hash. `waitForValidAction` returns whichever row the
 * newest-first list shows first, which is the MESSAGE leg, so asserting
 * "FILE" or "BATCH" on it fails on a good transaction.
 */
async function validLegs(txid) {
    await waitForValidAction(txid);
    const legs = await txActions(txid);
    for (const leg of legs) {
        for (const status of actionStatuses(leg)) {
            expect(status, `chain rejected the ${leg.action} leg of ${txid}`).toBe('valid');
        }
    }
    return legs;
}

async function approveConfirm(page) {
    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible({ timeout: 60_000 });
    const password = page.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible().catch(() => false)) {
        await password.fill(PASSWORD);
    }
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
    await page.getByTestId('confirm-approve').click();
}

async function readBroadcastTxid(page) {
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/\b[0-9a-f]{64}\b/)?.[0];
    expect(txid, 'success screen showed no transaction id').toBeTruthy();
    return txid;
}

test.describe('the PC-29 unlock threshold stays inert on regtest', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('the publish form never offers a threshold, and even a dust-sized gated SEND still carries its key', async ({ browser }) => {
        const issuer = await newDevice(browser);
        const holder = await newDevice(browser);

        let issuerAddr;
        let holderAddr;

        await test.step('onboard both wallets on regtest and give the holder on-chain history', async () => {
            await createWallet(issuer, { password: PASSWORD, name: 'Threshold Issuer' });
            await switchToRegtest(issuer, PASSWORD);
            issuerAddr = await readReceiveAddress(issuer);
            await fundAddress(issuerAddr, FUNDING_BTC);
            await issuer.reload();
            await unlockAfterReload(issuer, PASSWORD);
            // ISSUE, FILE and the guarded SEND each charge an XCHAIN protocol
            // fee, and the preflight disables Approve on a wallet that holds none.
            await mintXchain(issuer, MINT_XCHAIN);
            await waitForTokenBalance(issuerAddr, 'XCHAIN', MINT_XCHAIN);
            await issuer.reload();
            await unlockAfterReload(issuer, PASSWORD);

            await createWallet(holder, { password: PASSWORD, name: 'Threshold Holder' });
            await switchToRegtest(holder, PASSWORD);
            holderAddr = await readReceiveAddress(holder);
            await fundAddress(holderAddr, FUNDING_BTC);
            await holder.reload();
            await unlockAfterReload(holder, PASSWORD);

            await mintXchain(holder, MINT_XCHAIN);
            await waitForTokenBalance(holderAddr, 'XCHAIN', MINT_XCHAIN);
            await holder.reload();
            await unlockAfterReload(holder, PASSWORD);
        });

        await test.step('the issuer issues the tick', async () => {
            await gotoPalette(issuer, 'Issue token');
            const main = issuer.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await main.getByLabel('Ticker').fill(TICK);
            await main.getByLabel('Supply', { exact: true }).fill(SUPPLY);
            const password = main.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible().catch(() => false)) {
                await password.fill(PASSWORD);
            }
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expectConfirmModal(issuer, 'the ISSUE');
            await approveConfirm(issuer);
            const txid = await readBroadcastTxid(issuer);
            const action = await waitForValidAction(txid);
            expect(action.action).toBe('ISSUE');

            await waitForTokenBalance(issuerAddr, TICK, Number(SUPPLY));
            await issuer.reload();
            await unlockAfterReload(issuer, PASSWORD);
        });

        let publishTxid;
        await test.step('the publish form never offers the unlock-threshold field on this chain', async () => {
            await gotoPalette(issuer, 'Publish file');
            await issuer.getByRole('radio', { name: /Encrypted & token-gated/ }).click();
            // PublishFileForm pins role="listitem" on this owned-token row (it
            // sits inside a role="list" container), so it answers to
            // 'listitem', not 'button', in the accessibility tree. A listitem
            // takes no accessible name from its content, so the row is found by
            // its text rather than by name.
            await issuer.getByRole('listitem').filter({ hasText: TICK }).click();

            const main = issuer.getByRole('main');
            await expect(main.getByLabel('File to publish')).toBeVisible({ timeout: 30_000 });

            // The live assertion this spec exists to make: `thresholdActive`
            // is derived from THIS venue's real indexer watermark
            // (`messaging.getIndexerWatermark`), not a stub, and it must stay
            // false because `bitcoin-regtest` (or whichever chain this run
            // drives) is pinned `null` in GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS.
            await expect(main.getByLabel('Unlock threshold'), 'the unlock-threshold field rendered on '
                + 'regtest, which means GATE_MIN_AMOUNT read as ACTIVE on a chain the activation map pins '
                + 'null - a premature-emission hazard the map exists to prevent')
                .toHaveCount(0);

            await main.getByLabel('File to publish').setInputFiles({
                name: 'no-threshold.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('gated content with no unlock threshold, by construction on this venue'),
            });
            await main.getByRole('checkbox', {
                name: /I understand the encrypted file is published on-chain forever/,
            }).check();
            await main.getByRole('button', { name: 'Review', exact: true }).click();

            // The review screen states threshold rows only when one is set;
            // confirming its absence here is the review-time half of the same
            // invariant the form-stage assertion above already covers.
            await expect(main.getByText('Unlock threshold', { exact: true })).toHaveCount(0);

            const reviewPassword = main.getByLabel('Password', { exact: true });
            if (await reviewPassword.count() > 0 && await reviewPassword.isVisible().catch(() => false)) {
                await reviewPassword.fill(PASSWORD);
            }
            await main.getByRole('button', { name: 'Sign and publish' }).click();

            await expect(main.getByText('Encrypted file published')).toBeVisible({ timeout: 120_000 });
            const txt = await main.innerText();
            publishTxid = txt.match(/\b[0-9a-f]{64}\b/)?.[0];
            expect(publishTxid, 'the gated publish never showed a transaction id').toBeTruthy();

            const legs = await validLegs(publishTxid);
            expect(legs.map((a) => a.action), 'the gated publish did not land as BATCH(FILE, MESSAGE)')
                .toEqual(['BATCH', 'FILE', 'MESSAGE']);
            // The on-chain half of the invariant, read off the real indexer: the
            // FILE carries its gate but no threshold, and its wire leg has the
            // eight pre-PC-29 fields (nine tokens with the FILE verb). A ninth
            // field here is the premature emission the activation map exists
            // to prevent, and the indexer would have silently dropped it.
            const file = legs.find((a) => a.action === 'FILE');
            expect(file.gate_ticker).toBe(TICK);
            expect(file.gate_min_amount, 'the indexer recorded an unlock threshold on regtest').toBeNull();
            const fileLeg = String(file.tx_data).replace(/^BATCH\|0\|/, '').split(';')
                .find((leg) => leg.startsWith('FILE|'));
            expect(fileLeg, `no FILE leg in ${file.tx_data}`).toBeTruthy();
            expect(fileLeg.split('|'), `the FILE leg carries a ninth field: ${fileLeg}`).toHaveLength(9);

            await main.getByRole('button', { name: 'Done' }).click();
        });

        await test.step('a dust-sized gated SEND still requires and attaches the full key handoff', async () => {
            const issuerTickBefore = await tokenBalance(issuerAddr, TICK);

            await gotoSection(issuer, 'Send');
            await selectVenueSendAsset(issuer, TICK);
            await issuer.getByLabel('To', { exact: true }).fill(holderAddr);
            await issuer.getByRole('textbox', { name: /^Amount/ }).fill(TINY_SEND_AMOUNT);

            // If a below-threshold lane had somehow activated, an amount this
            // small would be the one send guaranteed to fall under any real
            // publisher's threshold and clear as a plain, key-less SEND - so
            // seeing 'ready' here, rather than no banner at all, is exactly
            // the inertness this spec is testing. StatusMessage renders
            // variant="status" as role="status"; scoped by role rather than
            // bare text so an unrelated element sharing a substring can never
            // make this locator ambiguous.
            await expect(issuer.getByRole('status').filter({ hasText: /unlock key will be securely attached/ }))
                .toBeVisible({ timeout: 30_000 });

            await mainButton(issuer, 'Send').click();
            await expectConfirmModal(issuer, 'the dust-sized gated SEND');
            await approveConfirm(issuer);
            const txid = await readBroadcastTxid(issuer);

            const legs = await validLegs(txid);
            // The guard rewrites a gated SEND into BATCH(SEND, MESSAGE); a
            // plain SEND landing here would mean the guard silently didn't run.
            expect(legs.map((a) => a.action), 'the dust-sized gated SEND did not compose as a guarded BATCH - the '
                + 'below-threshold lane may have activated on a chain where it must stay inert')
                .toEqual(['BATCH', 'SEND', 'MESSAGE']);
            const handoff = legs.find((a) => a.action === 'MESSAGE');
            expect(String(handoff.tx_data), 'no MESSAGE sibling in the BATCH: the key handoff never attached '
                + 'even though this is the smallest amount the form accepts')
                .toContain('MESSAGE|2|');
            expect(handoff.destination, 'the key handoff was not addressed to the recipient').toBe(holderAddr);

            expect(await tokenBalance(issuerAddr, TICK)).toBe(issuerTickBefore - Number(TINY_SEND_AMOUNT));
        });
    });
});
