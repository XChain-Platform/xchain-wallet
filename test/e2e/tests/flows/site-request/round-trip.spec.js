// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The site-request round trip, one leg per default-run place a request link can land.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test as walletTest, expect as walletExpect, createWallet, unlockWallet, DEFAULT_PASSWORD } from '../../../fixtures/wallet.js';
import { XCHAIN_SERVICE_HOSTS } from '../../../fixtures/outboundGuard.js';
import {
    decodeRequestLink,
    publishedLink,
    readReturn,
    requestLink,
    webWalletLink,
} from '../../../fixtures/siteRequest.js';
import {
    androidViewArgs,
    iosOpenUrlArgs,
} from '../../../fixtures/siteRequestLaunch.js';
import { buildReturnUrl } from '../../../../../packages/core/src/site_request/returnFragment.js';
import { URI_MAX_LENGTH } from '../../../../../packages/core/src/uri/bip21.js';
import { classifyDeepLink, attachDeepLinkHandlers } from '../../../../../packages/desktop/main/protocol.js';
import { sendSiteReturn } from '../../../../../packages/desktop/main/siteRequest.js';
import {
    ADDRESS,
    CLAIM,
    expect,
    loginEnvelope,
    REQUEST_ID,
    startDapp,
    test,
    WALLET_ROOT,
    WEB_PORT,
    WEB_URL,
} from './round-trip.helpers.js';

const LOGIN_RESULT = Object.freeze({
    address: ADDRESS,
    challenge: 'challenge-0123456789',
    signature: 'signature-0123456789',
});

function loginRecord(overrides = {}) {
    return {
        body: { method: 'login', ok: true, result: LOGIN_RESULT },
        claim: CLAIM,
        claimed: false,
        status: 'pending',
        verified: { address: ADDRESS },
        ...overrides,
    };
}

function returnPayload(id = REQUEST_ID) {
    return {
        v: 1,
        id,
        method: 'login',
        ok: true,
        result: LOGIN_RESULT,
        claim: CLAIM,
    };
}

async function post(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
}

async function pageRequestLink(page) {
    await page.addInitScript(() => {
        window.__opened = [];
        window.open = (url) => { window.__opened.push(String(url)); return {}; };
    });
    await page.goto(page.__dappUrl);
    await page.getByRole('button', { name: 'Login with XChain' }).click();
    await page.locator('[data-pick="web"]').click();
    const opened = await page.evaluate(() => window.__opened);
    expect(opened).toHaveLength(1);
    return decodeRequestLink(opened[0]);
}

test.describe('test-dapp claim rule', () => {
    test('a login claim is accepted once and a replay is refused', async ({ dapp }) => {
        await dapp.store.put(REQUEST_ID, loginRecord());

        const first = await post(`${dapp.origin}/claim/${REQUEST_ID}`, { claim: CLAIM });
        expect(first).toEqual({ status: 200, body: { ok: true, address: ADDRESS } });

        const replay = await post(`${dapp.origin}/claim/${REQUEST_ID}`, { claim: CLAIM });
        expect(replay.status).toBe(409);
        expect(replay.body).toMatchObject({ ok: false, reason: 'ALREADY_CLAIMED' });

        const status = await (await fetch(`${dapp.origin}/result/${REQUEST_ID}`)).json();
        expect(status).toEqual({ ok: true, status: 'approved', claimed: true });
    });

    test('a wrong claim and an unknown request are refused and leave the record unclaimed', async ({ dapp }) => {
        await dapp.store.put(REQUEST_ID, loginRecord());

        const wrong = await post(`${dapp.origin}/claim/${REQUEST_ID}`, { claim: `${CLAIM}x` });
        expect(wrong.status).toBe(400);
        expect(wrong.body).toMatchObject({ ok: false, reason: 'NO_MATCH' });

        const unknown = await post(`${dapp.origin}/claim/BBBBBBBBBBBBBBBBBBBBBA`, { claim: CLAIM });
        expect(unknown.status).toBe(404);
        expect(unknown.body).toMatchObject({ ok: false, reason: 'NO_RECORD' });

        const status = await (await fetch(`${dapp.origin}/result/${REQUEST_ID}`)).json();
        expect(status).toMatchObject({ ok: true, claimed: false });
    });

    test('a return to the page fills the address and claims the login on the server', async ({ page, dapp }) => {
        page.__dappUrl = `${dapp.secureOrigin}/`;
        const envelope = await pageRequestLink(page);
        expect(envelope).toMatchObject({ method: 'login', return: `${dapp.secureOrigin}/`, callback: `${dapp.secureOrigin}/callback` });

        await dapp.store.put(envelope.id, loginRecord());
        const { url } = buildReturnUrl(envelope.return, { ...returnPayload(envelope.id), state: envelope.state });
        expect(readReturn(url)).toMatchObject({ id: envelope.id, ok: true, claim: CLAIM });

        await page.goto(url);
        await expect(page.locator('#address')).toHaveValue(ADDRESS);
        await expect(page.locator('#response')).not.toHaveText('Waiting for the wallet...');
        expect((await (await fetch(`${dapp.origin}/result/${envelope.id}`)).json()).claimed).toBe(true);
    });

    test('a link edited to drop return reaches the wallet with none and the page shows no result', async ({ page, dapp }) => {
        page.__dappUrl = `${dapp.secureOrigin}/`;
        const envelope = await pageRequestLink(page);
        expect(envelope.return).toBeDefined();
        const { return: _dropped, ...edited } = envelope;
        const droppedLink = requestLink(edited);

        expect(decodeRequestLink(droppedLink)).not.toHaveProperty('return');
        expect(decodeRequestLink(publishedLink(droppedLink))).not.toHaveProperty('return');
        expect(decodeRequestLink(webWalletLink(droppedLink))).not.toHaveProperty('return');

        await expect(page.locator('#response')).toHaveText('Waiting for the wallet...');
        await page.waitForTimeout(500);
        await expect(page.locator('#response')).toHaveText('Waiting for the wallet...');
        await expect(page.locator('#address')).toHaveValue('');
        expect(readReturn(page.url())).toBeNull();
    });
});

test.describe('desktop launch', () => {
    test('a request link on argv reaches the deep-link handler whole and its return goes to openExternal', async ({ dapp }) => {
        const link = requestLink(loginEnvelope({ dappOrigin: dapp.origin }));
        const handlers = new Map();
        const app = {
            requestSingleInstanceLock: () => true,
            on: (name, handler) => handlers.set(name, handler),
        };
        const events = [];
        expect(attachDeepLinkHandlers(app, { onDeepLink: (event) => events.push(event) })).toEqual({ gotLock: true });

        handlers.get('second-instance')({}, ['/Applications/XChain Wallet', '--flag', link], '/');
        expect(events).toHaveLength(1);
        expect(events[0].raw).toBe(link);
        expect(decodeRequestLink(events[0].raw)).toMatchObject({ id: REQUEST_ID, method: 'login' });
        expect(classifyDeepLink(link)).toMatchObject({ scheme: 'xchain' });

        const opened = [];
        const openExternal = async (target) => { opened.push(target); };
        const { url } = buildReturnUrl(`${dapp.origin}/`, returnPayload());
        expect(await sendSiteReturn({ url, developerMode: true, openExternal })).toEqual({ sent: true });
        expect(opened).toEqual([url]);
        expect(readReturn(opened[0])).toMatchObject({ id: REQUEST_ID, claim: CLAIM });
    });

    test('a return outside the allowlist, over the cap or on plain http is never handed to openExternal', async ({ dapp }) => {
        const opened = [];
        const openExternal = async (target) => { opened.push(target); };
        const { url } = buildReturnUrl(`${dapp.origin}/`, returnPayload());

        expect(await sendSiteReturn({ url, developerMode: false, openExternal }))
            .toEqual({ sent: false, reason: 'BAD_TARGET' });
        expect(await sendSiteReturn({ url: 'javascript:alert(1)', developerMode: true, openExternal }))
            .toEqual({ sent: false, reason: 'BAD_TARGET' });
        expect(await sendSiteReturn({
            url: `https://request.example/${'a'.repeat(URI_MAX_LENGTH)}#xchain=AA`,
            openExternal,
        })).toEqual({ sent: false, reason: 'BAD_TARGET' });
        expect(opened).toEqual([]);
    });
});

test.describe('phone launch', () => {
    test('the Android VIEW and iOS openurl commands carry the request link intact', async ({ dapp }) => {
        const link = requestLink(loginEnvelope({ dappOrigin: dapp.origin }));
        const published = publishedLink(link);

        const android = androidViewArgs(published, { packageName: 'io.xchain.wallet.android', stopFirst: true });
        expect(android.at(-1)).toBe(`'${published}'`);
        expect(android).toContain('-p');
        expect(iosOpenUrlArgs(link)).toEqual(['simctl', 'openurl', 'booted', link]);
        expect(decodeRequestLink(iosOpenUrlArgs(published).at(-1))).toMatchObject({ id: REQUEST_ID });
    });

    test('the Android manifest claims the published link host and the xchain scheme', async () => {
        const manifest = readFileSync(resolve(WALLET_ROOT, 'packages/mobile/android/app/src/main/AndroidManifest.xml'), 'utf8');
        const published = new URL(publishedLink('xchain:request'));
        expect(manifest).toContain(`android:host="${published.host}"`);
        expect(manifest).toContain(`android:pathPrefix="${published.pathname}"`);
        expect(manifest).toContain('android:scheme="xchain"');
    });

});

const webTest = walletTest.extend({
    dapp: async ({}, use) => { // eslint-disable-line no-empty-pattern
        const dapp = await startDapp();
        await use(dapp);
        await dapp.close();
    },
});

webTest.describe('web wallet round trip', () => {
    webTest.use({ baseURL: WEB_URL, outboundLiveHosts: ['127.0.0.1'], outboundStubHosts: [...XCHAIN_SERVICE_HOSTS], ignoreHTTPSErrors: true });
    let vite;

    webTest.beforeAll(async () => {
        vite = spawn('pnpm', ['-C', resolve(WALLET_ROOT, 'packages/web'), 'dev', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], {
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, VITE_XCHAIN_REAL_SDK: '1' },
        });
        const deadline = Date.now() + 120_000;
        for (;;) {
            try {
                if ((await fetch(WEB_URL)).ok) break;
            } catch { /* not listening yet */ }
            if (Date.now() > deadline) throw new Error('the web wallet dev server did not start');
            await new Promise((done) => { setTimeout(done, 500); });
        }
    });

    webTest.afterAll(() => {
        if (vite?.pid) process.kill(-vite.pid, 'SIGTERM');
    });

    webTest('a wallet link opens the approval, and approving returns to the site', async ({ page, dapp }) => {
        webTest.setTimeout(180_000);
        const dappPage = await page.context().newPage();
        dappPage.__dappUrl = `${dapp.secureOrigin}/`;
        const envelope = await pageRequestLink(dappPage);
        await dappPage.close();

        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await createWallet(page);
        await page.goto(`/?uri=${encodeURIComponent(requestLink(envelope))}`);
        await unlockWallet(page);

        const approve = page.getByRole('button', { name: /^Approve/ });
        const boundary = page.getByText("This screen couldn't be shown");
        await walletExpect(approve.or(boundary).first()).toBeVisible({ timeout: 30_000 });
        expect(await boundary.isVisible(), `the approval route crashed: ${pageErrors.find((message) => /adapter/.test(message)) ?? pageErrors[0] ?? 'no page error'}`).toBe(false);

        await walletExpect(page.getByText(new URL(envelope.return).host).first()).toBeVisible();
        await page.getByLabel('Password', { exact: true }).fill(DEFAULT_PASSWORD);
        await approve.click();
        await page.waitForURL(/#xchain=/, { timeout: 30_000 });
        const returned = readReturn(page.url());
        expect(returned, `the wallet returned ${JSON.stringify(returned)}`).toMatchObject({ id: envelope.id, ok: true });
        expect(page.url().startsWith(envelope.return)).toBe(true);
    });

    webTest('a link edited to drop return is approved by the wallet and goes nowhere', async ({ page, dapp }) => {
        webTest.setTimeout(180_000);
        const dappPage = await page.context().newPage();
        dappPage.__dappUrl = `${dapp.secureOrigin}/`;
        const envelope = await pageRequestLink(dappPage);
        const { return: _dropped, ...edited } = envelope;
        await dapp.store.put(envelope.id, loginRecord());

        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await createWallet(page);
        await page.goto(`/?uri=${encodeURIComponent(requestLink(edited))}`);
        await unlockWallet(page);

        const approve = page.getByRole('button', { name: /^Approve/ });
        const boundary = page.getByText("This screen couldn't be shown");
        await walletExpect(approve.or(boundary).first()).toBeVisible({ timeout: 30_000 });
        expect(await boundary.isVisible(), `the approval route crashed: ${pageErrors[0] ?? 'no page error'}`).toBe(false);

        await walletExpect(page.getByText(new URL(envelope.return).host).first()).toBeVisible();
        await page.getByLabel('Password', { exact: true }).fill(DEFAULT_PASSWORD);
        await walletExpect(approve).toBeEnabled();
        await approve.click();
        await walletExpect(approve).toBeHidden({ timeout: 30_000 });
        await page.waitForTimeout(1000);
        expect(page.url()).not.toContain('#xchain=');
        expect(new URL(page.url()).origin).toBe(WEB_URL);
        await expect(dappPage.locator('#response')).toHaveText('Waiting for the wallet...');
        await expect(dappPage.locator('#address')).toHaveValue('');
        expect((await (await fetch(`${dapp.origin}/result/${envelope.id}`)).json()).claimed).toBe(false);
        await dappPage.close();
    });
});
