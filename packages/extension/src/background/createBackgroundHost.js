// createBackgroundHost — factory that returns a MessageHost with the
// Phase 1 flow handlers registered. Shells instantiate this once at
// service-worker startup.
//
// Handler surface mirrors the core flows API; requests are the same
// object shape, minus the dependency fields (vault / chainRegistry /
// sdkRegistry), which the host injects from its constructor deps.
//
// Sensitive-field projection: `wallet.list` and flows that return
// Wallet records strip the encryptedSeed / kdfParams / importedKeys
// before returning — even though the popup is same-extension and
// therefore trusted, keeping that data off the wire narrows the blast
// radius of any future logging or telemetry bug in the popup layer.

import { flows } from '@xchain-wallet/core';
import { MessageHost } from './MessageHost.js';

const {
    createWallet,
    importMnemonic,
    unlockWallet,
    receiveAddress,
    sendAsset,
    sweepAsset,
    walletBalances,
    addressBalances,
    addressHistory,
} = flows;

/**
 * Strip sensitive fields before handing a Wallet record to the popup/UI.
 * @param {import('@xchain-wallet/core').schemas.Wallet} w
 */
function toSafeWallet(w) {
    return {
        schemaVersion: w.schemaVersion,
        id: w.id,
        name: w.name,
        createdAt: w.createdAt,
        origin: w.origin,
        format: w.format,
        passphraseEnabled: w.passphraseEnabled,
        multisig: w.multisig,
    };
}

/**
 * @param {import('./MessageHost.js').MessageHostDeps} deps
 * @returns {MessageHost}
 */
export function createBackgroundHost(deps) {
    const host = new MessageHost(deps);

    // --- Wallet management ---------------------------------------------------

    host.register('wallet.list', async (_req, { vault }) => {
        const wallets = await vault.wallets.list();
        return wallets.map(toSafeWallet);
    });

    host.register('wallet.exists', async (req, { vault }) => {
        const id = req?.walletId;
        if (typeof id !== 'string' || !id) return { exists: false };
        return { exists: (await vault.wallets.get(id)) !== null };
    });

    host.register('wallet.create', async (req, { vault, chainRegistry, sdkRegistry }) => {
        const r = await createWallet({ ...req, vault, chainRegistry, sdkRegistry });
        return {
            mnemonic: r.mnemonic,
            wallet: toSafeWallet(r.wallet),
            account: r.account,
            addresses: r.addresses,
        };
    });

    host.register('wallet.import', async (req, { vault, chainRegistry, sdkRegistry }) => {
        const r = await importMnemonic({ ...req, vault, chainRegistry, sdkRegistry });
        return {
            format: r.format,
            wallet: toSafeWallet(r.wallet),
            account: r.account,
            addresses: r.addresses,
        };
    });

    host.register('wallet.checkPassword', async (req, { vault, chainRegistry, sdkRegistry }) => {
        // Quick check: can we unlock this wallet with the supplied password?
        // Returns boolean; never holds the signer beyond this call.
        const signer = await unlockWallet({ ...req, vault, chainRegistry, sdkRegistry });
        signer.lock();
        return { ok: true };
    });

    // --- Receive -------------------------------------------------------------

    host.register('receive.getAddress', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return receiveAddress({ ...req, vault, chainRegistry, sdkRegistry });
    });

    // --- Actions -------------------------------------------------------------

    host.register('action.send', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return sendAsset({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('action.sweep', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return sweepAsset({ ...req, vault, chainRegistry, sdkRegistry });
    });

    // --- Reads ---------------------------------------------------------------

    host.register('balances.wallet', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return walletBalances({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('balances.address', async (req, { sdkRegistry }) => {
        return addressBalances({ ...req, sdkRegistry });
    });

    host.register('history.address', async (req, { sdkRegistry }) => {
        return addressHistory({ ...req, sdkRegistry });
    });

    return host;
}
