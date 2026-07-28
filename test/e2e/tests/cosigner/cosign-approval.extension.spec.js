// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
//
// (b): the wallet passive co-signer, driven in a browser.
//
// This is the last scope caveat on the MuSig2 co-signer spec. The passive path
// was unit-tested (including the G4 atomicity suite) and built cleanly in all
// three shells, but no co-sign request had ever travelled the real route:
// injected provider -> content script -> service worker -> bridge.coSign ->
// approval UI -> passiveCoSignForAccount -> a real SDK CoSigner. Every gate the
// four hardening stages added lives at the far end of that route, and none of
// them had ever executed in a browser runtime.
//
// NO CHAIN IS NEEDED, which is why this is an .extension.spec rather than a
// .regtest.spec: co-signing decodes a PSBT, runs policy, and returns a PARTIAL
// signature. It never broadcasts, so the PSBT is built offline here in Node and
// the assertions are cryptographic rather than on-chain.
//
// The assertion that matters is the last one. The daemon must return the
// sighash of the PSBT THIS SPEC BUILT: that is the anti-forgery property the
// whole design rests on ("the message signed is DERIVED from the PSBT, never
// trusted from the caller"), and proving it inside a real browser is the point
// of the exercise.

import { createRequire } from 'module';
import { createWallet } from '../../fixtures/wallet.js';
// The ISOLATED fixture, not the shared one. The shared fixture launches with
// --disable-web-security and --disable-features=IsolateOrigins,site-per-process
// for the regtest explorer's missing CORS headers, and with site isolation off
// the APPROVAL WINDOW's renderer never receives its extension bindings: every
// approval page renders 'chrome.runtime.sendMessage unavailable' instead of a
// decision. This spec touches no chain, so it does not need that workaround.
import { expect, test } from '../../fixtures/extension-isolated.js';

// The SDK is CommonJS and this spec is ESM; Node-side crypto only, never
// shipped into the page.
const require = createRequire(import.meta.url);
const crypto  = require('crypto');
// The SDK's bitcoinjs, NOT the e2e package's: that one is 5.2.0, which predates
// bech32m, so it cannot even parse the P2TR address this account IS. Using the
// SDK's copy also means the PSBT is built by the same library the co-signer
// decodes it with.
const bitcoin = require('../../../../../xchain-sdk/node_modules/bitcoinjs-lib');
const { secp256k1 } = require('@noble/curves/secp256k1');
const MuSig2 = require('../../../../../xchain-sdk/src/musig2.js');
// Taproot address/script work needs an ECC backend, exactly as the co-signer
// itself initialises one on load.
bitcoin.initEccLib(require('../../../../../xchain-sdk/node_modules/@bitcoinerlab/secp256k1'));

const DAPP_ORIGIN = 'http://xchain-cosign-e2e.test';
const PASSWORD = 'correct horse battery staple';
// Agent accounts are Bitcoin-only at launch, and a fresh wallet's BTC address
// is on mainnet.
const CHAIN_ID = 'bitcoin-mainnet';

// Bech32 HRP -> bitcoinjs network, so the PSBT is built for whatever Bitcoin
// network the wallet provisioned on rather than a guess.
function networkForAddress(addr) {
    if (addr.startsWith('bcrt1')) return bitcoin.networks.regtest;
    if (addr.startsWith('tb1'))   return bitcoin.networks.testnet;
    return bitcoin.networks.bitcoin;
}

// The OP_RETURN carrier, byte-for-byte as xchain-encoder writes it: the action
// string compiled as a push, prefixed XCHN, AES-128-CTR keyed by the first
// input's txid.
function carrier(actionString, txidHex) {
    const inner  = bitcoin.script.compile([Buffer.from(actionString, 'utf8')]);
    const tagged = Buffer.concat([Buffer.from('XCHN'), inner]);
    const cipher = crypto.createCipheriv('aes-128-ctr', txidHex.substr(0, 16), txidHex.substr(16, 16));
    return Buffer.concat([cipher.update(tagged), cipher.final()]);
}

// The BIP341 key-path sighash the daemon must independently arrive at.
function sighashFor(psbt, script, value) {
    const tx = new bitcoin.Transaction();
    tx.version  = psbt.version;
    tx.locktime = psbt.locktime;
    for (const ti of psbt.txInputs)  tx.addInput(ti.hash, ti.index, ti.sequence);
    for (const to of psbt.txOutputs) tx.addOutput(to.script, to.value);
    return tx.hashForWitnessV1(0, [script], [value], bitcoin.Transaction.SIGHASH_DEFAULT);
}


// The provisioned 2-of-2 is a P2TR (bech32m, `…1p…`). AddressText truncates the
// visible text but puts the full address in aria-label/title, so read it there.
async function readAggregateAddress(page) {
    const el = page.locator('[aria-label^="bc1p"], [aria-label^="tb1p"], [aria-label^="bcrt1p"]').first();
    await el.waitFor({ state: 'attached', timeout: 30_000 });
    const addr = (await el.getAttribute('aria-label') || '').trim();
    if (!addr) throw new Error('the success screen exposed no aggregate address');
    return addr;
}


// Serve the dApp origin from the router, leaving every other request (notably
// the extension's own injected provider script) untouched.
async function serveDapp(dapp) {
    await dapp.route(`${DAPP_ORIGIN}/**`, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><meta charset="utf-8"><title>cosign e2e</title><h1>cosign e2e</h1>',
    }));
}


// The connection prompt asks WHICH chains the origin may see, and Connect stays
// disabled until at least one is picked. Bitcoin, because agent accounts are
// BTC-only at launch.
async function approveConnection(approval) {
    await approval.waitForLoadState('domcontentloaded');
    // The per-chain control's accessible name is "Allow <displayName> <networkKind>".
    // The input itself is visually hidden behind a styled control, so wait for it
    // ATTACHED and check it with force rather than requiring visibility.
    // Wait for React to mount before querying: the window is created, then the
    // approval bundle renders into it.
    try {
        await approval.getByRole('button', { name: 'Connect', exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
    } catch (e) {
        const text = await approval.locator('body').innerText().catch(() => '<unreadable>');
        const btns = await approval.getByRole('button').allInnerTexts().catch(() => []);
        throw new Error(`connect approval never rendered Connect.\n  url: ${approval.url()}\n  buttons: ${JSON.stringify(btns)}\n  text: ${JSON.stringify(text.slice(0, 500))}`);
    }
    const bitcoin = approval.getByRole('checkbox', { name: /^Allow Bitcoin\b/i }).first();
    if (await bitcoin.count() === 0) {
        const labels = await approval.locator('input[type=checkbox]').evaluateAll(
            (els) => els.map((e) => e.getAttribute('aria-label')));
        throw new Error('no Bitcoin chain checkbox; aria-labels present: ' + JSON.stringify(labels));
    }
    await bitcoin.waitFor({ state: 'attached', timeout: 30_000 });
    if (!(await bitcoin.isChecked())) await bitcoin.check({ force: true });
    await clickAndLetItClose(approval.getByRole('button', { name: 'Connect', exact: true }));
}


// Find the approval WINDOW by URL rather than by racing context.waitForEvent:
// other pages open during this spec, and whichever fires first is not
// necessarily the approval.
async function waitForApprovalPage(context, { timeout = 60_000, pending = null } = {}) {
    const deadline = Date.now() + timeout;
    let settled = null;
    if (pending) pending.then((v) => { settled = v; }, (e) => { settled = { ok: false, e: String(e) }; });
    for (;;) {
        for (const p of context.pages()) {
            if (p.url().includes('approval.html')) {
                await p.waitForLoadState('domcontentloaded').catch(() => {});
                return p;
            }
        }
        if (settled) throw new Error('the request settled without ever opening an approval: ' + JSON.stringify(settled).slice(0, 400));
        if (Date.now() > deadline) throw new Error('no approval window appeared within ' + timeout + 'ms');
        await new Promise((r) => setTimeout(r, 250));
    }
}


// Approving closes the approval window, so the click's own post-action wait can
// race the window's teardown. The close IS the success signal here.
async function clickAndLetItClose(locator) {
    try {
        await locator.click({ noWaitAfter: true });
    } catch (e) {
        if (!/closed/i.test(String(e && e.message))) throw e;
    }
}

test.describe('passive co-signer, in a browser', () => {

    test('a dApp co-sign request is approved and returns a partial over OUR sighash', async ({ page, context }) => {
        test.setTimeout(240_000);

        // ── 1. A wallet, and an agent keypair this spec controls ────────────
        await createWallet(page, { password: PASSWORD, navigate: false });

        const agentSk = crypto.randomBytes(32);
        const agentPk = Buffer.from(secp256k1.getPublicKey(agentSk, true));

        // ── 2. Provision the 2-of-2 agent account through the real UI ───────
        // "Agent accounts" is an entry on the All-actions menu rather than a
        // palette command of its own, and it only appears once the wallet is
        // known to hold a Bitcoin address (the feature is BTC-only at launch).
        await page.getByRole('button', { name: 'Open command palette' }).click();
        await page.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox').fill('All actions');
        await page.getByRole('option', { name: /All actions/ }).first().click();
        await page.getByRole('button', { name: /Agent accounts/ }).first().click();

        // The list screen offers provisioning; the button wording is the one the
        // route renders.
        await page.getByRole('button', { name: /Create agent account|New agent account|Provision/ }).first().click();

        // "This wallet's key" is a select of this wallet's addresses on the
        // chosen Bitcoin network; take the first real option.
        const keySelect = page.getByLabel("This wallet's key");
        await keySelect.selectOption({ index: 1 });

        await page.getByLabel(/Agent public key/).fill(agentPk.toString('hex'));
        await page.getByLabel('Account name').fill('E2E agent');
        // The policy needs at least one allowed action or the form refuses to
        // compose. SEND is the canonical co-signable shape.
        await page.getByLabel('Actions').fill('SEND');

        await page.getByRole('button', { name: 'Create agent account' }).click();

        // The success screen shows the funded 2-of-2 address. AddressText
        // TRUNCATES for display but carries the full string in aria-label, so
        // read that rather than the visible text.
        await expect(page.getByText('Agent account created')).toBeVisible({ timeout: 60_000 });
        const aggregateAddress = await readAggregateAddress(page);

        const network = networkForAddress(aggregateAddress);
        const accountScript = bitcoin.address.toOutputScript(aggregateAddress, network);

        // ── 3. Build the PSBT offline: spend the aggregate, carry a SEND ────
        const prevHash = crypto.randomBytes(32);
        const prevTxid = Buffer.from(prevHash).reverse().toString('hex');
        const VALUE = 100_000;
        const action = `SEND|0|TOK|1|${aggregateAddress}|e2e`;

        const psbt = new bitcoin.Psbt({ network });
        psbt.addInput({ hash: prevHash, index: 0, witnessUtxo: { script: accountScript, value: VALUE } });
        psbt.addOutput({ script: bitcoin.payments.embed({ data: [carrier(action, prevTxid)] }).output, value: 0 });
        psbt.addOutput({ script: accountScript, value: 90_000 });
        const psbtHex = psbt.toHex();

        const expectedMsg = sighashFor(psbt, accountScript, VALUE).toString('hex');
        const agentNonce = Buffer.from(
            new MuSig2().generateNonce({ publicKey: agentPk, secretKey: agentSk }),
        ).toString('hex');

        // ── 4. A dApp origin, served by the router (no web server needed) ───
        const dapp = await context.newPage();
        // Fulfil ONLY this origin. A catch-all route would also intercept the
        // content script's own `chrome-extension://…/inject/xchainProvider.js`
        // request and answer it with HTML, so the provider would never define
        // window.xchain and the failure would look like a wallet bug.
        await serveDapp(dapp);
        await dapp.goto(DAPP_ORIGIN + '/');
        await expect.poll(
            () => dapp.evaluate(() => Boolean(window.xchain)),
            { timeout: 30_000, message: 'the provider was never injected into the dApp page' },
        ).toBe(true);

        // Connect first: an unknown origin is refused with NOT_CONNECTED, which
        // is the bridge working as designed, not the co-signer failing.
        const connecting = dapp.evaluate(() => window.xchain.connect({}).then(
            (r) => ({ ok: true, r }), (e) => ({ ok: false, e: String(e && e.message || e) })));
        const connectApproval = await waitForApprovalPage(context);
        await approveConnection(connectApproval);
        expect((await connecting).ok, 'the dApp never connected').toBe(true);

        // ── 5. The co-sign request, over the real route ─────────────────────
        const requesting = dapp.evaluate(
            ({ aggregateAddress, psbtHex, agentNonce, chainId }) => window.xchain.coSign({
                chainId,
                aggregateAddress,
                psbtHex,
                inputs: [{ index: 0, agentPublicNonce: agentNonce }],
            }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: String(e && e.message || e) })),
            { aggregateAddress, psbtHex, agentNonce, chainId: CHAIN_ID },
        );

        const approval = await waitForApprovalPage(context, { pending: requesting });
        // The approval names the operation, so a co-sign can never be mistaken
        // for an ordinary send in the one place the user actually decides.
        await expect(approval.getByText(/Co-sign transaction/i)).toBeVisible({ timeout: 30_000 });

        const password = approval.getByLabel(/Password/i);
        if (await password.count() > 0) await password.first().fill(PASSWORD);
        await clickAndLetItClose(approval.getByRole('button', { name: /^(Approve|Co-sign|Sign)$/ }).first());

        // ── 6. What the browser actually produced ───────────────────────────
        const outcome = await requesting;
        expect(outcome.ok, `co-sign failed: ${outcome.e}`).toBe(true);
        const res = outcome.r;

        expect(res.approved, 'the daemon refused an in-policy request').toBe(true);
        expect(Array.isArray(res.signatures), 'no signatures array').toBe(true);
        expect(res.signatures).toHaveLength(1);

        const sig = res.signatures[0];
        expect(sig.index).toBe(0);
        // A 66-byte public nonce and a 32-byte partial: the MuSig2 shapes.
        expect(Buffer.from(sig.publicNonce, 'hex')).toHaveLength(66);
        expect(Buffer.from(sig.sig, 'hex')).toHaveLength(32);

        // THE assertion. The daemon derived the signing message from the PSBT
        // itself rather than trusting anything the caller said, so it must equal
        // the sighash computed here, independently, before the request was sent.
        expect(sig.msg, 'the daemon signed a message that is NOT this PSBT\'s sighash').toBe(expectedMsg);
    });

    test('an out-of-policy action is refused in the browser too', async ({ page, context }) => {
        test.setTimeout(240_000);

        // The same route, carrying an action the policy does not allow. The
        // refusal has to come from the daemon at the far end, not from the UI
        // declining to ask.
        await createWallet(page, { password: PASSWORD, navigate: false });

        const agentSk = crypto.randomBytes(32);
        const agentPk = Buffer.from(secp256k1.getPublicKey(agentSk, true));

        // "Agent accounts" is an entry on the All-actions menu rather than a
        // palette command of its own, and it only appears once the wallet is
        // known to hold a Bitcoin address (the feature is BTC-only at launch).
        await page.getByRole('button', { name: 'Open command palette' }).click();
        await page.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox').fill('All actions');
        await page.getByRole('option', { name: /All actions/ }).first().click();
        await page.getByRole('button', { name: /Agent accounts/ }).first().click();
        await page.getByRole('button', { name: /Create agent account|New agent account|Provision/ }).first().click();
        await page.getByLabel("This wallet's key").selectOption({ index: 1 });
        await page.getByLabel(/Agent public key/).fill(agentPk.toString('hex'));
        await page.getByLabel('Account name').fill('E2E agent');
        await page.getByLabel('Actions').fill('SEND');          // SEND only
        await page.getByRole('button', { name: 'Create agent account' }).click();

        await expect(page.getByText('Agent account created')).toBeVisible({ timeout: 60_000 });
        const aggregateAddress = await readAggregateAddress(page);

        const network = networkForAddress(aggregateAddress);
        const accountScript = bitcoin.address.toOutputScript(aggregateAddress, network);

        const prevHash = crypto.randomBytes(32);
        const prevTxid = Buffer.from(prevHash).reverse().toString('hex');
        const psbt = new bitcoin.Psbt({ network });
        psbt.addInput({ hash: prevHash, index: 0, witnessUtxo: { script: accountScript, value: 100_000 } });
        // DESTROY is not in allowedActions.
        psbt.addOutput({ script: bitcoin.payments.embed({ data: [carrier('DESTROY|0|TOK|5|e2e', prevTxid)] }).output, value: 0 });
        psbt.addOutput({ script: accountScript, value: 90_000 });

        const agentNonce = Buffer.from(
            new MuSig2().generateNonce({ publicKey: agentPk, secretKey: agentSk }),
        ).toString('hex');

        const dapp = await context.newPage();
        await serveDapp(dapp);
        await dapp.goto(DAPP_ORIGIN + '/');
        await expect.poll(() => dapp.evaluate(() => Boolean(window.xchain)), { timeout: 30_000 }).toBe(true);

        const connecting = dapp.evaluate(() => window.xchain.connect({}).then(() => true, () => false));
        const connectApproval = await waitForApprovalPage(context);
        await approveConnection(connectApproval);
        await connecting;

        const requesting = dapp.evaluate(
            ({ aggregateAddress, psbtHex, agentNonce, chainId }) => window.xchain.coSign({
                chainId, aggregateAddress, psbtHex,
                inputs: [{ index: 0, agentPublicNonce: agentNonce }],
            }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: String(e && e.message || e) })),
            { aggregateAddress, psbtHex: psbt.toHex(), agentNonce, chainId: CHAIN_ID },
        );

        const approval = await waitForApprovalPage(context, { pending: requesting });
        const password = approval.getByLabel(/Password/i);
        if (await password.count() > 0) await password.first().fill(PASSWORD).catch(() => {});

        // The screen must not offer to approve an action the policy will refuse.
        // The preview runs the SAME evaluator the daemon runs, so an out-of-policy
        // action is caught before the user can authorize it rather than being
        // presented as approvable and refused afterwards.
        const approveBtn = approval.getByRole('button', { name: /^(Approve|Co-sign|Sign)$/ }).first();
        let approvable = false;
        try {
            await approveBtn.waitFor({ state: 'visible', timeout: 15_000 });
            approvable = await approveBtn.isEnabled();
        } catch (e) { approvable = false; }
        expect(approvable, 'the wallet offered to APPROVE an out-of-policy action').toBe(false);

        // Whatever the user does next, no signature may come back.
        await clickAndLetItClose(approval.getByRole('button', { name: /^(Reject|Cancel)$/ }).first());
        const outcome = await Promise.race([
            requesting,
            new Promise((r) => setTimeout(() => r({ ok: false, e: 'request never settled' }), 60_000)),
        ]);
        if (outcome.ok) {
            expect(outcome.r.approved, 'an out-of-policy action was SIGNED').toBe(false);
            expect(outcome.r.signatures).toBeUndefined();
        } else {
            expect(outcome.e, 'the request failed for an unexpected reason')
                .toMatch(/rejected|POLICY_ACTION_DENIED|DECODE_|denied/i);
        }
    });
});
