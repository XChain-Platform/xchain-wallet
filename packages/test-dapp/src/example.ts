// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Worked example: what a third-party dApp author writes to talk to the
// XChain wallet via @xchain-wallet/bridge-spec.
//
// Covers the full Phase 1 surface: discover provider, connect, read
// accounts/addresses/balances, sign-in, sign a message, sign a SEND,
// handle UNSUPPORTED_ACTION, disconnect.
//
// Pair with mock-provider.ts to run end-to-end without a real wallet:
//
//     const mock = new MockXChainProvider();
//     const uninstall = mock.install();
//     await runExample();
//     uninstall();

import {
    getProvider,
    makeSignInParams,
    parseSignInChallenge,
    validateSignInChallenge,
    type BridgeErrorCode,
    type BridgeErrorResult,
    type SendActionParams,
    type SignActionParams,
    type SignActionResult,
} from '@xchain-wallet/bridge-spec';
import { MockXChainProvider } from './mock-provider.js';

const APP_ID = 'example.com';

export interface ExampleReport {
    providerFound: boolean;
    connected: boolean;
    accountCount: number;
    signInOk: boolean;
    signMessageOk: boolean;
    sendTxid?: string;
    issueRejectedAsUnsupported: boolean;
}

export async function runExample(): Promise<ExampleReport> {
    const report: ExampleReport = {
        providerFound: false,
        connected: false,
        accountCount: 0,
        signInOk: false,
        signMessageOk: false,
        issueRejectedAsUnsupported: false,
    };

    const provider = await getProvider({ timeoutMs: 500 });
    if (!provider) return report;
    report.providerFound = true;

    const conn = await provider.connect({
        appName: 'Example dApp',
        requestedChains: ['bitcoin'],
    });
    if (!conn.ok) return report;
    report.connected = true;
    report.accountCount = conn.accounts.length;

    const chains = await provider.getActiveChains();
    const chainId = chains[0];
    if (!chainId) return report;

    const addresses = await provider.getAddresses(chainId);
    const fromAddress = addresses[0]?.address;
    if (!fromAddress) return report;

    await provider.getBalances(chainId, fromAddress);

    const signInParams = makeSignInParams(APP_ID);
    const signIn = await provider.signIn(signInParams);
    if (signIn.ok) {
        // A challenge that will not parse is a FAILURE, never a pass. Written as
        // `reparsed && validate(...)`, an unparseable challenge yielded null and
        // read as "no validation failure": the extension emitted ISO timestamps
        // where the spec declares epoch ms, so parseSignInChallenge returned null
        // for every real sign-in and this example still reported ok ().
        const reparsed = parseSignInChallenge(signIn.challenge);
        report.signInOk = reparsed !== null &&
            validateSignInChallenge(reparsed, {
                appId: APP_ID,
                // The origin your backend expects the sign-in to come
                // from - here the page the example runs on. A challenge
                // stamped with any other origin must be rejected.
                origin: globalThis.location?.origin ?? '',
                nonce: signInParams.nonce,
            }) === null;
    }

    const signMsg = await provider.signMessage({
        address: fromAddress,
        message: 'Hello from example.com',
    });
    report.signMessageOk = signMsg.ok;

    const sendParams: SignActionParams<SendActionParams> = {
        chainId,
        action: 'SEND',
        params: {
            fromAddress,
            toAddress: 'bcrt1qrecipientaddress0000000000000000000000',
            asset: 'BTC',
            amountRaw: '10000',
            memo: 'example send',
        },
    };
    const sendResult = await provider.signAction(sendParams);
    if (sendResult.ok) report.sendTxid = sendResult.txid;

    // Phase 2+ action - expected to be rejected by a Phase 1 wallet.
    const issueResult = await provider.signAction({
        chainId,
        action: 'ISSUE',
        params: { asset: 'NEWCOIN', quantity: '1000000', divisibility: 0 },
    });
    report.issueRejectedAsUnsupported =
        !issueResult.ok && issueResult.error === 'UNSUPPORTED_ACTION';

    await provider.disconnect();
    return report;
}

// ---------------------------------------------------------------------------
// Error-code branching reference (§12 / Cluster S FOLLOWUP 5)
// ---------------------------------------------------------------------------
//
// Bridge results that fail come back as `{ ok: false, error: <code>, ... }`.
// dApp authors should branch on `error` only - the human-readable
// `message` is for logging, not display logic. The `BLOCKED_BY_USER` and
// `THROTTLED` codes are the §12 security additions; they need explicit
// UX:
//
//   BLOCKED_BY_USER  - user blocked this site in wallet Settings. There
//                      is no retry that the dApp can do automatically;
//                      surface a static "Blocked - un-block in wallet
//                      Settings" message and stop pushing requests.
//
//   THROTTLED        - wallet rate-limited this origin. The result
//                      includes `retryAfterMs` (and optional `burst` /
//                      `windowMs`); show "Retry in {seconds}s" with a
//                      disabled retry control that re-enables when the
//                      timer elapses, then re-issue the original call.
//
// `handleSignActionResult` is the helper a dApp's UI layer would call.
// It returns a tagged shape so the caller can render the right state.

export type SignActionUiOutcome =
    | { kind: 'success'; txid: string }
    | { kind: 'rejected' }                                          // USER_REJECTED
    | { kind: 'walletLocked' }                                      // WALLET_LOCKED
    | { kind: 'panic' }                                             // PANIC_MODE
    | { kind: 'unsupported'; supportedActions?: string[] }          // UNSUPPORTED_ACTION
    | { kind: 'blocked'; message: string }                          // BLOCKED_BY_USER
    | { kind: 'throttled'; retryAfterMs: number; burst?: number; windowMs?: number; message: string }
    | { kind: 'error'; error: BridgeErrorCode; message?: string };  // anything else

export function handleSignActionResult(
    result: SignActionResult,
): SignActionUiOutcome {
    if (result.ok) return { kind: 'success', txid: result.txid };
    const err = result as BridgeErrorResult & { supportedActions?: string[] };
    switch (err.error) {
        case 'USER_REJECTED':
            return { kind: 'rejected' };
        case 'WALLET_LOCKED':
            return { kind: 'walletLocked' };
        case 'PANIC_MODE':
            return { kind: 'panic' };
        case 'UNSUPPORTED_ACTION':
            return {
                kind: 'unsupported',
                supportedActions: err.supportedActions,
            };
        case 'BLOCKED_BY_USER':
            return {
                kind: 'blocked',
                message: 'Blocked by user - un-block in wallet Settings.',
            };
        case 'THROTTLED': {
            const retryAfterMs = err.retryAfterMs ?? 0;
            const seconds = Math.ceil(retryAfterMs / 1000);
            const out: SignActionUiOutcome = {
                kind: 'throttled',
                retryAfterMs,
                message: `Throttled by wallet - retry in ${seconds}s.`,
            };
            if (typeof err.burst === 'number') out.burst = err.burst;
            if (typeof err.windowMs === 'number') out.windowMs = err.windowMs;
            return out;
        }
        default:
            return { kind: 'error', error: err.error, message: err.message };
    }
}

// Re-issue the same signAction once the wallet's `retryAfterMs` window
// has elapsed. UI surfaces should disable the retry control until the
// returned promise resolves so users can't queue duplicate requests.
export async function signActionWithRetry<TParams = Record<string, unknown>>(
    provider: { signAction: (p: SignActionParams<TParams>) => Promise<SignActionResult> },
    params: SignActionParams<TParams>,
    opts: { maxRetries?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<SignActionResult> {
    const maxRetries = opts.maxRetries ?? 3;
    const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    let attempt = 0;
    while (true) {
        const result = await provider.signAction(params);
        if (result.ok) return result;
        const err = result as BridgeErrorResult;
        if (err.error !== 'THROTTLED' || attempt >= maxRetries) return result;
        await sleep(err.retryAfterMs ?? 0);
        attempt += 1;
    }
}

export interface ErrorScenarioReport {
    blockedOutcome: SignActionUiOutcome;
    throttledOutcome: SignActionUiOutcome;
    retryAttempts: number;
    retryFinalKind: SignActionUiOutcome['kind'];
}

// Walk the BLOCKED_BY_USER and THROTTLED branches against the mock
// provider so a developer copy-pasting from test-dapp gets coverage by
// default. Returns the rendered outcomes the UI would surface.
export async function runErrorScenarios(): Promise<ErrorScenarioReport> {
    const params: SignActionParams<SendActionParams> = {
        chainId: 'bitcoin-regtest',
        action: 'SEND',
        params: {
            fromAddress: 'bcrt1qexampleaddressforsmoketesting0000000000',
            toAddress: 'bcrt1qrecipientaddress0000000000000000000000',
            asset: 'BTC',
            amountRaw: '10000',
        },
    };

    // Site is on the user's blocklist - no retry should happen.
    const blocked = new MockXChainProvider({ blockedSite: true });
    await blocked.connect({ appName: 'Example dApp' });
    const blockedRaw = await blocked.signAction(params);
    const blockedOutcome = handleSignActionResult(blockedRaw);

    // Wallet is rate-limiting; the helper's setTimeout-based retry
    // resolves to the post-throttle outcome (still THROTTLED in the
    // mock - the test exercises that retries don't loop forever).
    const throttled = new MockXChainProvider({
        throttle: { retryAfterMs: 5, burst: 2, windowMs: 1000 },
    });
    await throttled.connect({ appName: 'Example dApp' });
    const throttledRaw = await throttled.signAction(params);
    const throttledOutcome = handleSignActionResult(throttledRaw);

    let retryAttempts = 0;
    const retried = await signActionWithRetry(throttled, params, {
        maxRetries: 2,
        sleep: async (ms) => {
            retryAttempts += 1;
            // Don't actually sleep in the example - keeps the smoke fast.
            void ms;
        },
    });
    const retryFinalKind = handleSignActionResult(retried).kind;

    return { blockedOutcome, throttledOutcome, retryAttempts, retryFinalKind };
}
