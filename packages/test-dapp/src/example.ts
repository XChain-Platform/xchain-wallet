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
    type SendActionParams,
    type SignActionParams,
} from '@xchain-wallet/bridge-spec';

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
        const reparsed = parseSignInChallenge(signIn.challenge);
        const invalid =
            reparsed &&
            validateSignInChallenge(reparsed, {
                appId: APP_ID,
                nonce: signInParams.nonce,
            });
        report.signInOk = invalid === null;
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

    // Phase 2+ action — expected to be rejected by a Phase 1 wallet.
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
