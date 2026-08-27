// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wallet's OWN contract DEPLOY + EXECUTE broadcast path, driven end
// to end against the live regtest stack.
//
// The Contracts area had been exercised only on its READ side - the list, the
// detail page, the execution history - all of which render whatever the
// explorer already holds. Every contract on the venue had been put there by the
// xchain-e2e-test suite, from a LEGACY address, over a hand-built P2SH
// transaction. Nothing had ever asked whether the WALLET can put one there:
// compose a DEPLOY host-side, carry a whole contract's source through the
// confirm pipeline, sign it from a bech32 address and have the chain accept it,
// then call a method on what it deployed.
//
// That gap is not cosmetic. DEPLOY is the wallet's largest single action by a
// wide margin (the entire source rides in one param), and it is the action that
// took the encoder's non-base58 chunk lane down and blew the confirm
// pipeline's own size gate (D-24). Both are fixed; neither had ever been shown
// working from the wallet against a real node, which is what this spec is for.
//
// FOUR VENUE FACTS ARE BAKED IN:
//
// 1. THE CONTRACT IS DELIBERATELY TINY. A source past one action's byte budget
//    deploys through the PC-38 chunked lane (N carrier transactions plus an
//    assembling one), which is a different code path with a different failure
//    mode. This spec is about the ordinary single-shot deploy; sizing the source
//    to stay inside one action is what keeps it on that lane.
//
// 2. THE VM COSTS GAS, AND GAS IS XCHAIN. A freshly-onboarded wallet holds
//    none, so both legs would fail on an empty gas balance long before anything
//    interesting was proven. XCHAIN is free-mintable on regtest, so the spec
//    mints its own.
//
// 3. ASSERTIONS READ THE EXPLORER, NOT THE SCREEN. "Contract deployed" is the
//    wallet reporting on itself. The contract row, the execution row, the gas
//    actually burned and the state key the method wrote are the chain reporting
//    on the wallet - and a signed-but-wrong action (wrong method name, wrong
//    contract index, a body the VM refuses) passes the first and fails the
//    second.
//
// 4. THE STATE ASSERTION IS THE POINT OF THE EXECUTE LEG. An EXECUTE that
//    indexes `valid` has only proven the action parsed. Reading back the key the
//    method wrote proves the VM RAN the deployed body, which is the only thing
//    that distinguishes a real round trip from a well-formed no-op.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    mintXchain,
    nudgeChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING_BTC = 1;

/** Gas plus the protocol fee for two actions, with room to spare. */
const MINT_XCHAIN = 2000;

/**
 * The smallest contract that can prove the VM ran: one method, one state write,
 * one readable result.
 *
 * Kept to a single line on purpose (see venue fact 1). `parseInt` over a string
 * counter rather than arithmetic on a number because contract state is stored
 * as JSON text, so the round trip through the store is part of what is being
 * exercised. No BigInt and no RegExp literal: the VM rejects both at deploy
 * (they expose unmetered native CPU), and a contract that never deploys would
 * fail this spec for a reason that has nothing to do with the wallet.
 */
const CONTRACT_SOURCE =
    "module.exports = { inc: function(){ var c = parseInt(xchain.state.get('n') || '0');"
    + " xchain.state.set('n', String(c + 1)); return String(c + 1); } };";

const DEPLOY_GAS = '200000';
const EXECUTE_GAS = '100000';

/** Unique per run: the venue is shared and its contract list is cumulative. */
const RUN_TAG = `e2e${Date.now()}`;

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/** The wallet's shared confirm surface, used by both forms here. */
async function approveConfirm(page) {
    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible({ timeout: 60_000 });
    const password = page.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('confirm-approve').click();
}

/**
 * Navigates through the command palette, the way a returning user reaches
 * anything that is not one of the four primary tabs.
 *
 * Contracts is not a nav destination at any width; it hangs off Home's
 * secondary actions and off the palette. The palette is the surface that works
 * identically in every shell, so it is the one driven here.
 */
async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const combobox = page.getByRole('combobox').first();
    await expect(combobox).toBeVisible();
    await combobox.fill(title);
    await page.keyboard.press('Enter');
}

async function gotoDeployForm(page) {
    await gotoPalette(page, 'Contracts');
    const deploy = page.getByRole('button', { name: '+ Deploy new contract' });
    await expect(deploy).toBeVisible({ timeout: 30_000 });
    await deploy.click();
    await expect(page.getByRole('main').getByLabel('Code source')).toBeVisible({ timeout: 30_000 });
}

/**
 * The txid off a form's done screen.
 *
 * Both contract forms end on the same shape - one summary line and a single
 * Txid row - so one reader serves both. Read rather than assumed: tying the
 * wallet's claimed txid to the chain's own row is what makes the explorer
 * assertions below about THIS action rather than about any action that happened
 * to land nearby.
 */
async function readDoneTxid(page) {
    const value = page.getByRole('main').locator('dl dd').first();
    await expect(value).toBeVisible({ timeout: 30_000 });
    const txid = (await value.innerText()).trim();
    expect(txid, 'the done screen names a real txid').toMatch(/^[0-9a-f]{64}$/);
    return txid;
}

/** Polls the explorer until `predicate` accepts, mining only while the pipeline keeps up. */
async function waitFor(path, predicate, what, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            last = await explorerJson(path);
            if (predicate(last)) return last;
        } catch { /* transient while a block lands */ }
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${path} never reached ${what}; last=${JSON.stringify(last)}`);
}

test.describe('contract DEPLOY + EXECUTE from the wallet, on regtest', () => {
    // The regtest config bounds `expect` but leaves ACTION timeouts unbounded, so
    // a click on a locator that never appears would hang until the whole test
    // times out and report nothing useful. Bounded here, spec-locally.
    test.use({ actionTimeout: 30_000 });

    // Onboarding, funding, a mint, and two signed actions, each waiting on real
    // blocks. The chain is the long pole and this venue is shared, so the budget
    // is sized for a busy stack rather than an idle one.
    test.setTimeout(1_500_000);

    test.beforeAll(async () => {
        // Heal the shared node's clock before trusting it. Other suites on this
        // venue jump mocktime to cross deadlines and put it back in teardown; a
        // killed run never reaches that teardown, and the next suite then
        // inherits a node whose clock sits under median-time-past, where
        // `generate_blocks` fails outright and every spec on the machine looks
        // broken. Pinning to tip+5 is the ops recipe's repair and costs nothing
        // when the clock is already fine.
        try {
            const status = await explorerJson('status');
            const tip = Number(status?.last_block_time?.[REGTEST_COIN]);
            if (Number.isFinite(tip) && tip > 0) {
                await minerRpc('set_mock_time', { timestamp: tip + 5 });
                await minerRpc('set_default_mining_time', {});
            }
        } catch { /* the venue check in global setup reports unreachability */ }
    });

    test('a contract deployed from the wallet accepts a method call from the wallet', async ({ page }) => {
        let deployer;
        let contractIndex;
        const contractName = `Counter ${RUN_TAG}`;

        await test.step('onboard onto regtest and fund the deploying address', async () => {
            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);

            // Read the address OFF THE DEPLOY FORM rather than off Receive. They
            // are not always the same: the form resolves its source through the
            // wallet's active-address preference, while Receive can hand back a
            // rotated one. Funding the wrong one produces a deploy signed by an
            // address this spec never funded, which fails deep in the confirm
            // pipeline on "insufficient funds" and reads like a wallet bug.
            await gotoDeployForm(page);
            deployer = await page.getByRole('main').getByLabel('From', { exact: true }).inputValue();
            // The VENUE's address shape, not Bitcoin's. `/^bcrt1/` was the
            // strictest form of this bug: it fails on every chain but one.
            expect(deployer, 'the deploy form names a source address').toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(deployer, FUNDING_BTC);

            // Balances are fetched per chain on mount, so a reload is the cheapest
            // way to make the freshly-confirmed UTXO visible to the forms.
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            // Venue fact 2: the VM meters gas in XCHAIN, and the protocol fee for
            // both actions is charged in it too.
            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(deployer, 'XCHAIN', MINT_XCHAIN);

            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('deploy the contract', async () => {
            await gotoDeployForm(page);
            const main = page.getByRole('main');

            // The address that will sign must still be the one that was funded:
            // the default is derived from wallet state, so assert it rather than
            // trust it across a mint and two reloads.
            expect(await main.getByLabel('From', { exact: true }).inputValue(),
                'the form still signs with the funded address').toBe(deployer);

            await main.getByLabel('Name (optional)').fill(contractName);
            await main.getByLabel('Code source').fill(CONTRACT_SOURCE);

            // Drive the SDK-backed helper rather than skipping to submit: a
            // source the validator rejects can never deploy, so a green
            // validation is the cheap precondition that keeps a later failure
            // meaningful.
            await main.getByRole('button', { name: 'Validate code' }).click();
            await expect(main.getByText('Syntax OK.')).toBeVisible({ timeout: 30_000 });

            await main.getByLabel('Gas limit').fill(DEPLOY_GAS);
            await main.getByRole('button', { name: 'Deploy', exact: true }).click();
            await approveConfirm(page);

            await expect(main.getByText(/Contract deployed\./)).toBeVisible({ timeout: 120_000 });
            const txid = await readDoneTxid(page);

            // The chain's verdict on the whole action, not merely on the
            // transaction: a DEPLOY whose body the indexer refuses is still a
            // confirmed transaction, and would pass a txid-only check.
            const action = await waitForValidAction(txid);
            expect(action.action, 'the action the wallet composed').toBe('DEPLOY');
            expect(action.source, 'deployed by the funded address').toBe(deployer);
            contractIndex = String(action.action_index);

            // And the contract itself exists, as a contract, owned by us. This is
            // the assertion the READ-path coverage could never make: every
            // contract on this venue until now was put there by the e2e suite
            // from a legacy address over a hand-built transaction.
            const contract = await waitFor(
                `contract/${contractIndex}`,
                (c) => c && (c.status === 'valid' || c.STATUS === 'valid'),
                'a valid contract row');
            expect(String(contract.source), 'the contract is owned by the wallet address').toBe(deployer);
            expect(String(contract.tx_hash ?? contract.TX_HASH ?? txid),
                'the contract row is the transaction the wallet said it sent').toBe(txid);
            // The source made the round trip intact. A truncated or re-encoded
            // body would still deploy and would still index; it would simply not
            // be the contract that was typed, and every later assertion would be
            // about someone else's code.
            expect(String(contract.code || '').replace(/\s+/g, ' ').trim(),
                'the chain stored the source that was typed')
                .toBe(CONTRACT_SOURCE.replace(/\s+/g, ' ').trim());

            // The Name field's hint promises the label is "not published on
            // chain: the protocol has no name field for contracts". A name was
            // typed above, so this is the assertion that keeps that sentence
            // true: the wire string is exactly DEPLOY|<ver>|<code>|<gas> and
            // carries nothing else. If a NAME segment ever appears here, either
            // the wire grew a field or the form started smuggling one - and the
            // hint would be lying either way.
            expect(String(action.tx_data).split('|').length,
                'DEPLOY v0 rides as DEPLOY|0|<code>|<gas>, with no name segment').toBe(4);
        });

        await test.step('call a method on it', async () => {
            await gotoPalette(page, 'Contracts');

            // Reach the contract the way a user does: find it in the list, open
            // it, and call a method from the detail page.
            //
            // By ACTION INDEX, not by the name typed at deploy: contracts are
            // identified on chain by their index and by nothing else, so every
            // row in this list reads "(unnamed)" (see the deploy assertion
            // above). `.first()` because the list renders the same contract
            // twice on purpose - once under "My contracts (deployed by me)",
            // once under "Browse all contracts" - and the first is the one that
            // proves the wallet recognises the deploy as its own.
            const row = page.getByRole('button', { name: `Contract ${contractIndex}`, exact: true });
            await expect(row.first()).toBeVisible({ timeout: 60_000 });
            expect(await row.count(),
                'the wallet lists its own deploy under "My contracts", not only under browse-all')
                .toBeGreaterThan(1);
            await row.first().click();

            const main = page.getByRole('main');
            await expect(page.getByText(`Contract #${contractIndex}`).first())
                .toBeVisible({ timeout: 30_000 });

            await page.getByRole('button', { name: 'Call method', exact: true }).click();

            // No ABI is declared, so the form is in its manual lane: a free-text
            // method name and pipe-delimited params. `inc` takes none.
            await main.getByLabel('Method', { exact: true }).fill('inc');
            await main.getByLabel('Gas limit').fill(EXECUTE_GAS);
            await main.getByRole('button', { name: 'Execute', exact: true }).click();
            await approveConfirm(page);

            await expect(main.getByText('Method call broadcast.')).toBeVisible({ timeout: 120_000 });
            const txid = await readDoneTxid(page);

            const action = await waitForValidAction(txid);
            expect(action.action).toBe('EXECUTE');
            expect(String(action.contract_index), 'the call targeted the deployed contract')
                .toBe(contractIndex);
            expect(action.method_name, 'the method name rode the wire').toBe('inc');
            expect(String(action.caller), 'called by the wallet address').toBe(deployer);
            expect(action.error_message, 'the VM ran the body without throwing').toBeFalsy();
            // Gas is metered, so a body that ran costs more than nothing. A zero
            // here would mean the action indexed without the VM executing it.
            expect(Number(action.gas_used), 'the VM charged for real work').toBeGreaterThan(0);
            expect(Number(action.gas_used), 'within the limit the form sent')
                .toBeLessThanOrEqual(Number(EXECUTE_GAS));

            // Venue fact 4: the state the method wrote. This is what separates a
            // round trip from a well-formed no-op.
            const state = await waitFor(
                `contract/${contractIndex}/state`,
                (s) => (s?.data || []).some((r) => r.state_key === 'n'),
                'the counter key the method writes');
            const counter = (state.data || []).find((r) => r.state_key === 'n');
            // Contract state is stored as JSON text, so the stored value is a
            // quoted string; compare after parsing rather than against '"1"'.
            expect(JSON.parse(counter.state_value), 'the counter the method incremented').toBe('1');

            // The execution history the READ-path coverage already rendered, now
            // carrying a row this wallet put there.
            const executions = await waitFor(
                `executions/${contractIndex}/contract`,
                (e) => (e?.data || []).some((r) => r.tx_hash === txid),
                'the wallet execution in the contract history');
            const mine = (executions.data || []).find((r) => r.tx_hash === txid);
            expect(mine.status, 'the execution history agrees with the action').toBe('valid');
            expect(mine.method_name).toBe('inc');
        });
    });
});
