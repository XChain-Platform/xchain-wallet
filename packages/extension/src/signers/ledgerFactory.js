// Ledger transport factory — extension (popup + service worker)
// target. Uses WebHID per §18.2. WebHID is Chrome/Edge/Brave-only;
// Firefox + Safari don't support it, so the pairing UI surfaces a
// compatibility notice on unsupported browsers (Step 15).
//
// Factory responsibilities:
//
//   1. Lazy-import `@ledgerhq/hw-transport-webhid` + `@ledgerhq/hw-app-btc`
//      so the SDK chunks only load when the user pairs a Ledger.
//   2. Open the transport (user gesture triggers the browser permission
//      prompt on first pair; subsequent connects reuse the granted
//      device).
//   3. Construct the Bitcoin app client against the transport.
//   4. Read `getAppAndVersion` + derive a device identifier from the
//      account-0 xpub (Ledger does not expose a stable serial — see
//      `deriveLedgerDeviceIdentifier`).
//   5. Return both the LedgerSigner instance and the `pairingInfo`
//      the caller needs to persist via `flows.registerSigner`.

import {
    LedgerSigner,
    deriveLedgerDeviceIdentifier,
    modelFromLedgerTransport,
} from '@xchain-wallet/core';

/** @type {any | null} */
let sharedTransport = null;

/**
 * Lazy-create a shared WebHID transport. Subsequent calls reuse the
 * same transport instance for the extension's lifetime. The `loader`
 * parameter exists for tests.
 *
 * @param {() => Promise<any>} [loader]
 * @returns {Promise<any>}
 */
export async function getLedgerTransport(loader = defaultTransportLoader) {
    if (sharedTransport) return sharedTransport;
    const mod = await loader();
    const TransportWebHID = mod?.default ?? mod;
    if (!TransportWebHID || typeof TransportWebHID.create !== 'function') {
        throw new Error('ledgerFactory: loaded module does not look like @ledgerhq/hw-transport-webhid');
    }
    sharedTransport = await TransportWebHID.create();
    return sharedTransport;
}

function defaultTransportLoader() {
    return import('@ledgerhq/hw-transport-webhid');
}

function defaultAppLoader() {
    return import('@ledgerhq/hw-app-btc');
}

/**
 * Pair a Ledger device. Opens WebHID (prompts the user the first
 * time), confirms the Bitcoin app is running, derives the device
 * identifier, and returns a signer + pairingInfo bundle.
 *
 * The caller persists `pairingInfo` via `flows.registerSigner`.
 *
 * @param {Object} [opts]
 * @param {() => Promise<any>} [opts.transportLoader]
 * @param {() => Promise<any>} [opts.appLoader]
 * @returns {Promise<{ signer: LedgerSigner, pairingInfo: { vendor: 'ledger', model: string, deviceIdentifier: string, firmwareVersion: string | null } }>}
 */
export async function pairLedgerSigner({
    transportLoader,
    appLoader = defaultAppLoader,
} = {}) {
    const transport = await getLedgerTransport(transportLoader);
    const appMod = await appLoader();
    const Btc = appMod?.default ?? appMod;
    if (typeof Btc !== 'function') {
        throw new Error('ledgerFactory: loaded module does not look like @ledgerhq/hw-app-btc');
    }
    const app = new Btc({ transport, currency: 'bitcoin' });

    let appInfo;
    try {
        appInfo = await app.getAppAndVersion();
    } catch (err) {
        throw new Error(`pairLedgerSigner: failed to read app info — ${err?.message || err}`);
    }
    if (!appInfo || !appInfo.name) {
        throw new Error('pairLedgerSigner: device did not report an app name');
    }

    // Fetch the pubkey at the BTC identity path to derive a stable
    // device identifier. Requires the user to have the Bitcoin app
    // open — the getAppAndVersion check above surfaces a clear error
    // if they don't.
    const identityPath = "m/44'/0'/0'";
    let identity;
    try {
        identity = await app.getWalletPublicKey(identityPath, { verify: false });
    } catch (err) {
        throw new Error(`pairLedgerSigner: failed to read identity xpub — ${err?.message || err}`);
    }
    const deviceIdentifier = await deriveLedgerDeviceIdentifier(identity.publicKey);

    const model = modelFromLedgerTransport(transport?.deviceModel);
    const firmwareVersion = typeof appInfo.version === 'string' ? appInfo.version : null;
    const displayName = `Ledger (${model})`;

    const signer = new LedgerSigner({
        id: `ledger-${deviceIdentifier}`,
        displayName,
        model,
        deviceIdentifier,
        app,
    });

    return {
        signer,
        pairingInfo: {
            vendor: 'ledger',
            model,
            deviceIdentifier,
            firmwareVersion,
        },
    };
}

/**
 * Drop the cached transport. Primarily for tests / browser-HID
 * permission resets.
 */
export function resetLedgerTransport() {
    sharedTransport = null;
}
