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
import { registerBridgeHandlers } from '../bridge/handlers.js';

const {
    createWallet,
    importMnemonic,
    unlockWallet,
    receiveAddress,
    sendAsset,
    sweepAsset,
    issueToken,
    mintAsset,
    destroyAsset,
    registerSigner,
    listSignersForWallet,
    unregisterSigner,
    exportPrivateKey,
    walletBalances,
    addressBalances,
    addressHistory,
} = flows;

/**
 * Group a wallet's addresses by chainId. No SDK calls, no password —
 * used by the Receive view to know which chains have existing addresses
 * before the user picks one. Returns `{}` when the wallet has no
 * accounts yet (fresh-import edge case).
 *
 * @param {{ walletId: string }} req
 * @param {{ vault: import('@xchain-wallet/core').storage.Vault, chainRegistry: import('@xchain-wallet/core').registry.ChainRegistry }} deps
 * @returns {Promise<Record<string, import('@xchain-wallet/core').schemas.Address[]>>}
 */
async function addressesByChain(req, { vault, chainRegistry }) {
    const walletId = /** @type {any} */ (req)?.walletId;
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('addresses.byChain: walletId is required');
    }
    const accounts = await vault.accounts.findBy('walletId', walletId);
    const accountIds = new Set(accounts.map((a) => a.id));
    if (accountIds.size === 0) return {};
    const all = await vault.addresses.list();
    /** @type {Record<string, any[]>} */
    const byChain = {};
    for (const a of all) {
        if (!a.accountId || !accountIds.has(a.accountId)) continue;
        const chainId = chainRegistry.chainIdFor(a.chain, a.network);
        if (!chainId) continue;
        if (!byChain[chainId]) byChain[chainId] = [];
        byChain[chainId].push(a);
    }
    return byChain;
}

/**
 * Return the newest (highest external index) HD address for a wallet +
 * chain, or `null` if no address exists. External = change = 0 in the
 * BIP44-style derivation path. Skips imported WIFs — those aren't a
 * "receive next" concept.
 *
 * @param {{ walletId: string, chainId: string, addressType?: string }} req
 * @param {{ vault: import('@xchain-wallet/core').storage.Vault, chainRegistry: import('@xchain-wallet/core').registry.ChainRegistry }} deps
 * @returns {Promise<import('@xchain-wallet/core').schemas.Address | null>}
 */
async function newestAddress(req, { vault, chainRegistry }) {
    const walletId = /** @type {any} */ (req)?.walletId;
    const chainId = /** @type {any} */ (req)?.chainId;
    const addressType = /** @type {any} */ (req)?.addressType;
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('addresses.newest: walletId is required');
    }
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('addresses.newest: chainId is required');
    }
    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) {
        throw new Error(`addresses.newest: unknown chain "${chainId}"`);
    }
    const type = addressType ?? descriptor.defaultAddressType;

    const accounts = await vault.accounts.findBy('walletId', walletId);
    const accountIds = new Set(accounts.map((a) => a.id));
    if (accountIds.size === 0) return null;

    const all = await vault.addresses.list();
    let winner = null;
    let winnerIdx = -1;
    for (const a of all) {
        if (!accountIds.has(a.accountId)) continue;
        if (a.chain !== descriptor.coin) continue;
        if (a.network !== descriptor.networkKind) continue;
        if (a.addressType !== type) continue;
        if (a.source !== 'hd') continue;
        if (typeof a.derivationPath !== 'string') continue;
        const parts = a.derivationPath.split('/');
        if (parts.length < 2) continue;
        if (parts[parts.length - 2] !== '0') continue;  // external only
        const idx = Number(parts[parts.length - 1]);
        if (!Number.isFinite(idx)) continue;
        if (idx > winnerIdx) {
            winner = a;
            winnerIdx = idx;
        }
    }
    return winner;
}

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
 * @param {import('./MessageHost.js').MessageHostDeps & { approvals?: import('../bridge/Approvals.js').Approvals }} deps
 * @returns {MessageHost}
 */
export function createBackgroundHost(deps) {
    const { approvals, ...hostDeps } = deps ?? {};
    const host = new MessageHost(hostDeps);

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

    host.register('addresses.byChain', async (req, { vault, chainRegistry }) => {
        return addressesByChain(req, { vault, chainRegistry });
    });

    host.register('addresses.newest', async (req, { vault, chainRegistry }) => {
        return newestAddress(req, { vault, chainRegistry });
    });

    // --- Actions -------------------------------------------------------------

    host.register('action.send', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return sendAsset({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('action.sweep', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return sweepAsset({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('action.issue', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return issueToken({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('action.mint', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return mintAsset({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('action.destroy', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return destroyAsset({ ...req, vault, chainRegistry, sdkRegistry });
    });

    // --- Signer registry -----------------------------------------------------
    //
    // Hardware-signer pairing runs in the popup/web renderer context
    // (Trezor Connect needs a tab; Ledger WebHID needs a user gesture),
    // so the renderer does the device dance and then asks the
    // background to persist the resulting SignerRecord. listSigners +
    // unregisterSigner round out the CRUD surface.

    host.register('signer.register', async (req, { vault }) => {
        return registerSigner({ ...req, vault });
    });

    host.register('signer.list', async (req, { vault }) => {
        const walletId = /** @type {any} */ (req)?.walletId;
        if (typeof walletId !== 'string' || walletId.length === 0) {
            throw new Error('signer.list: walletId is required');
        }
        return listSignersForWallet(vault, walletId);
    });

    host.register('signer.unregister', async (req, { vault }) => {
        const signerId = /** @type {any} */ (req)?.signerId;
        if (typeof signerId !== 'string' || signerId.length === 0) {
            throw new Error('signer.unregister: signerId is required');
        }
        return { deleted: await unregisterSigner(vault, signerId) };
    });

    // --- Private key export (§17.7) -----------------------------------
    //
    // Returns the WIF for an address owned by this wallet. The flow
    // itself refuses hardware + watch-only addresses; the UI caller
    // (ViewPrivateKey.jsx) already gates on `Address.source`, but the
    // flow's guard is the authoritative line.

    host.register('wallet.exportPrivateKey', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return exportPrivateKey({ ...req, vault, chainRegistry, sdkRegistry });
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

    // --- Approval broker IPC -------------------------------------------------
    // The approval window opens from chrome.windows.create and queries
    // the broker for its parked request, then reports the user's decision
    // back. Gated on `approvals.fetch` / `approvals.resolve` being
    // present — the default `rejectAllApprovals` doesn't implement them,
    // so callers that haven't wired a real broker (tests, early scaffolds)
    // get an `UnknownMessageTypeError` that's easy to spot.
    if (approvals && typeof approvals.fetch === 'function') {
        host.register('approval.fetch', async (req) => {
            const id = /** @type {any} */ (req)?.id;
            if (typeof id !== 'string' || id.length === 0) {
                throw new Error('approval.fetch: id is required');
            }
            const data = approvals.fetch(id);
            if (!data) {
                throw Object.assign(new Error(`approval.fetch: unknown id "${id}"`), {
                    name: 'ApprovalNotFoundError',
                });
            }
            return data;
        });
    }
    if (approvals && typeof approvals.resolve === 'function') {
        host.register('approval.resolve', async (req) => {
            const id = /** @type {any} */ (req)?.id;
            const result = /** @type {any} */ (req)?.result;
            if (typeof id !== 'string' || id.length === 0) {
                throw new Error('approval.resolve: id is required');
            }
            if (!result || typeof result !== 'object') {
                throw new Error('approval.resolve: result object is required');
            }
            const ok = await approvals.resolve(id, result);
            return { resolved: ok };
        });
    }

    // --- dApp bridge ---------------------------------------------------------
    // §43 surface. Shells wire Approvals to pipe user-prompts through a
    // popup window; the default rejects everything with
    // USER_APPROVAL_REQUIRED, giving dApps a structured error instead of
    // a hang when the shell's approval popup isn't wired yet.
    registerBridgeHandlers(host, { approvals });

    return host;
}
