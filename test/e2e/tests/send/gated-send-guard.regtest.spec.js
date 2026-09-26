// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-26 gated SEND guard (Token_Gated_Content.md), driven through the real
// forms against a real chain instead of the source-regex smoke coverage in
// `test/smoke/actions/gated-send-guard.smoke.js`.
//
// THE RULE UNDER TEST. Once a tick has an active gated FILE, the indexer
// rejects any SEND of it that does not ride in the SAME transaction as a
// MESSAGE v2 handing the unlock key to the destination
// (`packages/core/src/flows/gatedSendGuard.js`; the indexer's own refusal is
// `xchain-indexer/src/actions/send/gated_handoff.js`: "invalid: gated token
// transfer requires key handoff message"). The wallet's compose-time guard
// exists so a user normally never reaches that refusal - Send.jsx rewrites the
// action into BATCH(SEND, MESSAGE) automatically. The smoke test proves the
// guard's SOURCE calls the right functions; it cannot prove the CHAIN accepts
// what those functions produce, or that a user who routes around the guard
// (the Advanced action escape hatch, which deliberately warns and never
// blocks) meets the network's own refusal instead of a wallet-invented one.
//
// THREE THINGS THIS SPEC PROVES THAT THE SMOKE COVERAGE CANNOT REACH
//
// 1. A GUARDED SEND OF A GATED TICK LANDS AS BATCH(SEND, MESSAGE) ON CHAIN,
//    and the recipient's balance moves by exactly the SEND leg - not a
//    same-looking plain SEND that happens to pass because nothing gates it.
// 2. A SECOND WALLET THAT RECEIVES THE TOKEN BUT NEVER RUNS THE RECOVERY SCAN
//    is shown the 'blocked' state and is stopped client-side before a
//    compose is ever attempted - the client refusal never reaches the modal.
// 3. THE SAME WALLET, BYPASSING THE GUARD THROUGH THE ADVANCED ACTION FORM
//    (the one path that composes exactly what is typed), gets the real
//    on-chain refusal: the indexer's own string, and its balance is
//    unchanged, because an invalid action never moves funds.
//
// TWO WALLETS, ONE CHAIN. Sending a gated tick to an address needs that
// address's on-chain-revealed pubkey (recipient must have spent at least
// once), so the recipient here is its own wallet with its own funded, once-
// spent address, not a second address inside the sender's wallet.

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
    expectConfirmModal,
    actionStatuses,
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
const TICK = `PCG${STAMP}`;
const SUPPLY = '1000';
/** Comfortably above the two below, so neither leg can fail on funds. */
const MINT_XCHAIN = 10;
const SEND_AMOUNT = '10';
const HOLDER_FORWARD_AMOUNT = '3';
const BYPASS_AMOUNT = '2';

/**
 * A fresh browser context = a fresh device/wallet, seeded past the license
 * gate the way the shared `page` fixture is (that fixture only covers its own
 * page; a second wallet needs its own).
 */
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

/** Fills the confirm modal's password only if this session actually needs one. */
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

/** The txid off whatever success screen the confirm flow lands on. */
async function readBroadcastTxid(page) {
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/\b[0-9a-f]{64}\b/)?.[0];
    expect(txid, 'success screen showed no transaction id').toBeTruthy();
    return txid;
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

test.describe('the PC-26 gated SEND guard', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('a guarded SEND attaches its key handoff on chain, and a bypassed one meets the network\'s own refusal', async ({ browser }) => {
        const issuer = await newDevice(browser);
        const holder = await newDevice(browser);

        let issuerAddr;
        let holderAddr;

        await test.step('onboard both wallets on regtest and give the holder on-chain history', async () => {
            await createWallet(issuer, { password: PASSWORD, name: 'Gate Issuer' });
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

            await createWallet(holder, { password: PASSWORD, name: 'Gate Holder' });
            await switchToRegtest(holder, PASSWORD);
            holderAddr = await readReceiveAddress(holder);
            await fundAddress(holderAddr, FUNDING_BTC);
            await holder.reload();
            await unlockAfterReload(holder, PASSWORD);

            // A gated send's ECIES handoff needs the recipient's on-chain
            // pubkey, which only a spend reveals. A self-mint is a real signed
            // transaction from the holder's own address.
            await mintXchain(holder, MINT_XCHAIN);
            await waitForTokenBalance(holderAddr, 'XCHAIN', MINT_XCHAIN);
            await holder.reload();
            await unlockAfterReload(holder, PASSWORD);
        });

        await test.step('the issuer issues the tick that will be gated', async () => {
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

        await test.step('the issuer publishes a gated file against the tick', async () => {
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
            await main.getByLabel('File to publish').setInputFiles({
                name: 'unlock-me.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('gated content payload for the e2e guard spec'),
            });
            await main.getByRole('checkbox', {
                name: /I understand the encrypted file is published on-chain forever/,
            }).check();
            await main.getByRole('button', { name: 'Review', exact: true }).click();

            const reviewPassword = main.getByLabel('Password', { exact: true });
            if (await reviewPassword.count() > 0 && await reviewPassword.isVisible().catch(() => false)) {
                await reviewPassword.fill(PASSWORD);
            }
            await main.getByRole('button', { name: 'Sign and publish' }).click();

            await expect(main.getByText('Encrypted file published')).toBeVisible({ timeout: 120_000 });
            const txt = await main.innerText();
            const txid = txt.match(/\b[0-9a-f]{64}\b/)?.[0];
            expect(txid, 'the gated publish never showed a transaction id').toBeTruthy();

            const legs = await validLegs(txid);
            expect(legs.map((a) => a.action), 'the gated publish did not land as BATCH(FILE, MESSAGE)')
                .toEqual(['BATCH', 'FILE', 'MESSAGE']);
            expect(legs.find((a) => a.action === 'FILE').gate_ticker).toBe(TICK);

            await main.getByRole('button', { name: 'Done' }).click();
        });

        let issuerTickBefore;
        await test.step('the issuer sends the gated tick; the guard attaches the handoff', async () => {
            issuerTickBefore = await tokenBalance(issuerAddr, TICK);

            await gotoSection(issuer, 'Send');
            await selectVenueSendAsset(issuer, TICK);
            await issuer.getByLabel('To', { exact: true }).fill(holderAddr);
            await issuer.getByRole('textbox', { name: /^Amount/ }).fill(SEND_AMOUNT);

            // The 'ready' readiness banner: the issuer holds the pack key it
            // just minted for itself, so the handoff attaches silently.
            // StatusMessage renders variant="status" as role="status"; scoped
            // by role rather than bare text since a role query only ever
            // considers the div that carries the role, never an unrelated
            // element that happens to share a substring.
            await expect(issuer.getByRole('status').filter({ hasText: /unlock key will be securely attached/ }))
                .toBeVisible({ timeout: 30_000 });

            await mainButton(issuer, 'Send').click();
            await expectConfirmModal(issuer, 'the gated SEND');
            await approveConfirm(issuer);
            const txid = await readBroadcastTxid(issuer);

            const legs = await validLegs(txid);
            // The guard rewrites a gated SEND into BATCH(SEND, MESSAGE); a
            // plain SEND landing here would mean the guard silently didn't run.
            expect(legs.map((a) => a.action), 'the gated SEND did not compose as a guarded BATCH')
                .toEqual(['BATCH', 'SEND', 'MESSAGE']);
            const handoff = legs.find((a) => a.action === 'MESSAGE');
            expect(String(handoff.tx_data), 'no MESSAGE sibling in the BATCH: the key handoff never attached')
                .toContain('MESSAGE|2|');
            expect(handoff.destination, 'the key handoff was not addressed to the recipient').toBe(holderAddr);

            await waitForTokenBalance(holderAddr, TICK, Number(SEND_AMOUNT));
            await waitForTokenBalance(issuerAddr, TICK, issuerTickBefore - Number(SEND_AMOUNT));
        });

        await test.step('the holder, having never recovered the key, is blocked client-side', async () => {
            await gotoSection(holder, 'Send');
            await selectVenueSendAsset(holder, TICK);
            await holder.getByLabel('To', { exact: true }).fill(issuerAddr);
            await holder.getByRole('textbox', { name: /^Amount/ }).fill(HOLDER_FORWARD_AMOUNT);

            // Both the 'blocked' banner (a raw role="alert" div) and, after
            // submit, the formError StatusMessage (role="alert" too) are
            // scoped by role and narrowed by `filter`, so a second alert
            // present at the same time (there is none here, but the pattern
            // must hold regardless) cannot make this locator ambiguous.
            await expect(holder.getByRole('alert').filter({ hasText: /this wallet holds none of its unlock keys/ }))
                .toBeVisible({ timeout: 30_000 });

            await mainButton(holder, 'Send').click();
            await expect(holder.getByRole('alert').filter({ hasText: /Recover the keys below before sending\./ }))
                .toBeVisible({ timeout: 15_000 });
            // The client refusal must stop the compose entirely - no modal, no
            // broadcast, nothing for the chain to even see.
            await expect(holder.getByTestId('confirm-modal')).toHaveCount(0);
        });

        await test.step('bypassed through Advanced action, the SAME send meets the chain\'s own refusal', async () => {
            const holderTickBefore = await tokenBalance(holderAddr, TICK);

            await gotoPalette(holder, 'Advanced action');
            await selectVenueChain(holder);
            await holder.getByLabel('Action').selectOption('SEND');

            // The tick-specific "HAS active gated content" line only renders
            // once `useGatedTickNotice` has a TICK to check (it is debounced
            // and reads the explorer), so TICK must be filled in first - the
            // generic "Token-gated content rule" copy above it is the only
            // part that shows before that.
            await holder.getByRole('textbox', { name: 'TICK', exact: true }).fill(TICK);
            await expect(holder.getByRole('alert').filter({ hasText: /a bare SEND of it will be rejected/ }))
                .toBeVisible({ timeout: 30_000 });

            await holder.getByRole('textbox', { name: 'AMOUNT', exact: true }).fill(BYPASS_AMOUNT);
            await holder.getByRole('textbox', { name: 'DESTINATION', exact: true }).fill(issuerAddr);

            await holder.getByRole('button', { name: 'Sign action' }).click();
            await expectConfirmModal(holder, 'the bypassed raw SEND');

            // The confirm preflight dry-runs the action against the network and
            // shows the indexer's own refusal. A definite consensus refusal blocks
            // signing outright, with no Sign anyway override, so a bare SEND of a
            // gated tick can never be broadcast from the wallet and cost a fee.
            const confirm = holder.getByTestId('confirm-modal');
            const refusal = confirm.getByRole('listitem')
                .filter({ hasText: /gated token transfer requires key handoff message/ });
            await expect(refusal, 'the preflight did not surface the network\'s gated-send refusal')
                .toBeVisible({ timeout: 60_000 });
            await expect(refusal.getByRole('checkbox', { name: 'Sign anyway' }),
                'a definite network refusal still offered Sign anyway').toHaveCount(0);
            await expect(holder.getByTestId('confirm-approve'),
                'Approve was enabled past a definite network refusal').toBeDisabled();

            // Nothing was broadcast: the holder's balance is exactly what it was
            // before the bypass attempt.
            expect(await tokenBalance(holderAddr, TICK)).toBe(holderTickBefore);
        });
    });
});
