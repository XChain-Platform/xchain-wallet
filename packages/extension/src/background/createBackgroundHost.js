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
import * as signerBridge from './signerBridge.js';
import { DEFAULT_ACTIVE_CHAIN_IDS } from './walletCreate.js';

const {
    createWallet,
    createAccount,
    renameWallet,
    importMnemonic,
    unlockWallet,
    receiveAddress,
    sendAsset,
    sweepAsset,
    issueToken,
    mintAsset,
    destroyAsset,
    broadcastAction,
    dispenserAction,
    orderAction,
    cancelOrder,
    coinpayAction,
    swapAction,
    linkAction,
    getCoinpayObligationsForAddress,
    getCoinpaysForAddress,
    getMessagingInbox,
    messageAction,
    getRecipientPubkey,
    listContacts,
    findContactByAddress,
    saveContact,
    deleteContact,
    dispensersForSource,
    dispensersForAddress,
    dispensersForToken,
    dispenserByActionIndex,
    dispensesFor,
    contractsForSource,
    contractsForAddress,
    contractsBrowseAll,
    depositsForAddress,
    withdrawalsForAddress,
    contractByActionIndex,
    actionByIndex,
    contractState,
    contractBalance,
    executionsForContract,
    deployAction,
    executeAction,
    depositAction,
    withdrawAction,
    stakesForAddress,
    delegationsForAddress,
    rewardsForAddress,
    validatorsForChain,
    stakeAction,
    unstakeAction,
    claimRewardsAction,
    delegateAction,
    revokeDelegationAction,
    broadcastsForAddress,
    linksForAddress,
    createMultisigConfig,
    receiveMultisigAddress,
    listMultisigReceiveAddresses,
    startMultisigSigningSession,
    getMultisigSigningSession,
    listMultisigSigningSessions,
    cancelMultisigSigningSession,
    contributeMultisigNonce,
    contributeMultisigSignature,
    aggregateMultisigSession,
    finalizeMultisigSigningSession,
    signMultisigLocally,
    contractValidate,
    contractCheckCodeSize,
    contractSuggestGasLimit,
    dividendAction,
    holdersFor,
    createList,
    airdropAction,
    actionByTxid,
    listByActionIndex,
    savePendingAirdrop,
    listPendingAirdropsForWallet,
    updatePendingAirdrop,
    clearPendingAirdrop,
    advancedAction,
    listActions,
    getActionFormats,
    getActionFields,
    validateActionDryRun,
    registerSigner,
    listSignersForWallet,
    unregisterSigner,
    resolveSigner,
    buildRemoteSigner,
    exportPrivateKey,
    walletBalances,
    addressBalances,
    addressHistory,
    getMarkets,
    getMarket,
    getMarketHistory,
    getMarketOrders,
    getOrderbook,
    listWatchlistForWallet,
    saveWatchlistEntry,
    clearWatchlistEntry,
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
    const accountId = /** @type {any} */ (req)?.accountId;
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('addresses.byChain: walletId is required');
    }
    const accounts = await vault.accounts.findBy('walletId', walletId);
    let accountIds;
    if (typeof accountId === 'string' && accountId.length > 0) {
        if (!accounts.some((a) => a.id === accountId)) {
            throw new Error(`addresses.byChain: account "${accountId}" does not belong to wallet "${walletId}"`);
        }
        accountIds = new Set([accountId]);
    } else {
        accountIds = new Set(accounts.map((a) => a.id));
    }
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
 * Look up the Address record a `action.*.hw` handler needs to resolve
 * the right SignerRecord. The request carries `from.addressId` (the
 * Address record's id, filled by the form) OR a plain `from` triple
 * from the form. We fetch the live Address so `resolveSigner` has
 * the canonical `source` + `signerId` fields.
 *
 * @param {import('@xchain-wallet/core').storage.Vault} vault
 * @param {any} req
 * @returns {Promise<import('@xchain-wallet/core').schemas.Address>}
 */
async function loadAddressForHwSigning(vault, req) {
    const fromAddressId = req?.from?.addressId;
    if (typeof fromAddressId === 'string' && fromAddressId.length > 0) {
        const addr = await vault.addresses.get(fromAddressId);
        if (addr) return addr;
    }
    if (req?.source === 'trezor' || req?.source === 'ledger') {
        // Air-gapped / pending-airdrop flows that drive HW signing
        // without a persisted Address record (rare) can carry the
        // source + derivationPath inline on the request. Not used
        // today; keeps the resolver door open for future callers.
    }
    // Fallback — find by address string within this wallet. Handles
    // edge cases where the form omits addressId.
    if (req?.from?.address && req?.walletId) {
        const all = await vault.addresses.list();
        const match = all.find((a) => a.address === req.from.address);
        if (match) return match;
    }
    throw new Error('action.*.hw: could not resolve source address record');
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
    const accountId = /** @type {any} */ (req)?.accountId;
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
    let accountIds;
    if (typeof accountId === 'string' && accountId.length > 0) {
        if (!accounts.some((a) => a.id === accountId)) {
            throw new Error(`addresses.newest: account "${accountId}" does not belong to wallet "${walletId}"`);
        }
        accountIds = new Set([accountId]);
    } else {
        accountIds = new Set(accounts.map((a) => a.id));
    }
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
        multisigs: Array.isArray(w.multisigs) ? w.multisigs : [],
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

    // Add a wallet to an already-open vault. Distinct from `wallet.import`
    // (which the pre-host listener intercepts and rejects when a vault
    // already exists). Same flow underneath; the difference is which
    // path is reachable in which session state.
    host.register('wallet.add.import', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const activeChainIds = Array.isArray(req?.activeChainIds) && req.activeChainIds.length > 0
            ? req.activeChainIds
            : DEFAULT_ACTIVE_CHAIN_IDS;
        const r = await importMnemonic({
            ...req,
            activeChainIds,
            vault,
            chainRegistry,
            sdkRegistry,
        });
        // Stash the new wallet's signer in the pool while the password
        // is in scope — keeps "no password on accounts" working for
        // the wallet that was just added.
        if (signerPool && req?.password) {
            try {
                await signerPool.unlockOne({
                    wallet: r.wallet,
                    password: req.password,
                    bip39Passphrase: req.bip39Passphrase,
                    chainRegistry,
                    sdkRegistry,
                });
            } catch { /* best-effort — fallback is per-op password prompt */ }
        }
        return {
            format: r.format,
            wallet: toSafeWallet(r.wallet),
            account: r.account,
            addresses: r.addresses,
        };
    });

    // Rename a wallet — updates the Wallet record's `name` field.
    host.register('wallet.rename', async (req, { vault }) => {
        const updated = await renameWallet({ ...req, vault });
        return { wallet: toSafeWallet(updated) };
    });

    // List BIP44 accounts under a wallet, sorted ascending by index.
    host.register('account.list', async (req, { vault }) => {
        const walletId = req?.walletId;
        if (typeof walletId !== 'string' || !walletId) return [];
        const accounts = await vault.accounts.findBy('walletId', walletId);
        return [...accounts].sort((a, b) => a.index - b.index);
    });

    // Create the next BIP44 account under a wallet (max(index)+1) +
    // first address per active chain. When the host has a SignerPool
    // (populated at unlock time), no password is needed — the
    // pre-unlocked signer is reused. Falls back to a password-based
    // unlock for shells/sessions that don't pre-populate the pool.
    host.register('account.create', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const activeChainIds = Array.isArray(req?.activeChainIds) && req.activeChainIds.length > 0
            ? req.activeChainIds
            : DEFAULT_ACTIVE_CHAIN_IDS;
        const walletId = req?.walletId;
        const cachedSigner = signerPool && typeof walletId === 'string'
            ? signerPool.get(walletId)
            : null;
        const r = await createAccount({
            ...req,
            signer: cachedSigner || undefined,
            activeChainIds,
            vault,
            chainRegistry,
            sdkRegistry,
        });
        return { account: r.account, addresses: r.addresses };
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

    // HW variants — no password. The renderer (popup / web / desktop)
    // owns the live TrezorSigner / LedgerSigner instance, registered
    // against `signerBridge` when the user paired. Each handler
    // resolves the address → HW descriptor → builds a RemoteSigner
    // whose transport routes through the bridge, then delegates to
    // the same core flow with the signer injected.
    function registerHwHandler(type, flow) {
        host.register(type, async (req, deps) => {
            const { vault } = deps;
            const address = await loadAddressForHwSigning(vault, req);
            const descriptor = await resolveSigner({ vault, address });
            if (descriptor.kind !== 'trezor' && descriptor.kind !== 'ledger') {
                throw new Error(`${type}: source address is not a hardware wallet`);
            }
            const transport = signerBridge.getTransport(descriptor.signerRecord.id);
            if (!transport) {
                throw new Error(
                    'Hardware signer is not connected. Open the wallet UI, re-pair if needed, and try again.',
                );
            }
            const signer = buildRemoteSigner(descriptor, transport);
            const { password: _password, ...rest } = req;
            return flow({ ...rest, ...deps, signer });
        });
    }

    registerHwHandler('action.send.hw', sendAsset);
    registerHwHandler('action.issue.hw', issueToken);
    registerHwHandler('action.mint.hw', mintAsset);
    registerHwHandler('action.destroy.hw', destroyAsset);
    registerHwHandler('action.broadcast.hw', broadcastAction);
    registerHwHandler('action.dispenser.hw', dispenserAction);
    registerHwHandler('action.dividend.hw', dividendAction);
    registerHwHandler('action.createList.hw', createList);
    registerHwHandler('action.airdrop.hw', airdropAction);
    registerHwHandler('action.advanced.hw', advancedAction);
    registerHwHandler('action.order.hw', orderAction);
    registerHwHandler('action.cancelOrder.hw', cancelOrder);
    registerHwHandler('action.coinpay.hw', coinpayAction);
    registerHwHandler('action.swap.hw', swapAction);
    registerHwHandler('action.link.hw', linkAction);
    registerHwHandler('action.message.hw', messageAction);
    registerHwHandler('action.deploy.hw', deployAction);
    registerHwHandler('action.execute.hw', executeAction);
    registerHwHandler('action.deposit.hw', depositAction);
    registerHwHandler('action.withdraw.hw', withdrawAction);
    registerHwHandler('action.stake.hw', stakeAction);
    registerHwHandler('action.unstake.hw', unstakeAction);
    registerHwHandler('action.claimRewards.hw', claimRewardsAction);
    registerHwHandler('action.delegate.hw', delegateAction);
    registerHwHandler('action.revokeDelegation.hw', revokeDelegationAction);

    // Signer status probe — routes straight through the signer bridge
    // without touching vault/SDK. Returns `'idle'` when the bridge
    // isn't connected yet (renderer hasn't registered), giving the
    // UI a distinct state vs. the signer actively reporting
    // 'disconnected'.
    host.register('signer.status', async (req) => {
        const signerId = req?.signerId;
        if (typeof signerId !== 'string' || signerId.length === 0) {
            throw new Error('signer.status: signerId is required');
        }
        const transport = signerBridge.getTransport(signerId);
        if (!transport) return { status: 'idle', detail: 'signer bridge not connected' };
        try {
            const res = await transport({
                op: 'status',
                payload: { signerId, chainId: req?.chainId },
            });
            return res;
        } catch (err) {
            return {
                status: 'disconnected',
                detail: err && err.message ? String(err.message) : String(err),
            };
        }
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

    host.register('action.broadcast', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return broadcastAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('action.dispenser', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return dispenserAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    // §41.3.4 ORDER / §41.3.5 CANCEL — DEX signing lanes.
    host.register('action.order', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return orderAction({ ...req, vault, chainRegistry, sdkRegistry });
    });
    host.register('action.cancelOrder', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return cancelOrder({ ...req, vault, chainRegistry, sdkRegistry });
    });

    // §41.4 COINPAY — buyer-side settlement for token/native-coin matches.
    host.register('action.coinpay', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return coinpayAction({ ...req, vault, chainRegistry, sdkRegistry });
    });
    host.register('coinpays.obligationsForAddress', async (req, { sdkRegistry }) => {
        return getCoinpayObligationsForAddress({ ...req, sdkRegistry });
    });
    host.register('coinpays.forAddress', async (req, { sdkRegistry }) => {
        return getCoinpaysForAddress({ ...req, sdkRegistry });
    });

    // §41.5 SWAP — atomic token-pair swap (no COINPAY follow-up).
    host.register('action.swap', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return swapAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    // §42.8.1 LINK — anchor two existing actions across chains.
    host.register('action.link', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return linkAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    // §41.7.2 Messaging inbox — password-gated decrypt of MESSAGE
    // actions for one of the wallet's own addresses.
    host.register('messaging.inbox', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return getMessagingInbox({ ...req, vault, chainRegistry, sdkRegistry });
    });

    // §41.7.3 Compose — MESSAGE action signing + recipient pubkey lookup.
    host.register('action.message', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return messageAction({ ...req, vault, chainRegistry, sdkRegistry });
    });
    host.register('messaging.pubkey', async (req, { sdkRegistry }) => {
        return getRecipientPubkey({ ...req, sdkRegistry });
    });

    // §41.7.4 Contacts — local address book CRUD. Shared across wallets.
    host.register('contacts.list', async (_req, { vault }) => {
        return listContacts({ vault });
    });
    host.register('contacts.findByAddress', async (req, { vault }) => {
        return findContactByAddress({ ...req, vault });
    });
    host.register('contacts.save', async (req, { vault }) => {
        return saveContact({ ...req, vault });
    });
    host.register('contacts.delete', async (req, { vault }) => {
        return deleteContact({ ...req, vault });
    });

    // Dispenser discovery + detail — read-only explorer passthroughs
    // behind the background so the popup / web / desktop renderers
    // don't need to know about sdkRegistry directly.

    host.register('dispensers.forSource', async (req, { sdkRegistry }) => {
        return dispensersForSource({ ...req, sdkRegistry });
    });

    host.register('dispensers.forAddress', async (req, { sdkRegistry }) => {
        return dispensersForAddress({ ...req, sdkRegistry });
    });

    host.register('dispensers.forToken', async (req, { sdkRegistry }) => {
        return dispensersForToken({ ...req, sdkRegistry });
    });

    host.register('dispensers.byActionIndex', async (req, { sdkRegistry }) => {
        return dispenserByActionIndex({ ...req, sdkRegistry });
    });

    host.register('dispenses.query', async (req, { sdkRegistry }) => {
        return dispensesFor({ ...req, sdkRegistry });
    });

    // VM / contract discovery — read-only explorer passthroughs for the
    // §42.2 Contracts browse surface (My contracts / My interactions /
    // Browse all) and §42.3 detail page.

    host.register('contracts.forSource', async (req, { sdkRegistry }) => {
        return contractsForSource({ ...req, sdkRegistry });
    });

    host.register('contracts.forAddress', async (req, { sdkRegistry }) => {
        return contractsForAddress({ ...req, sdkRegistry });
    });

    host.register('contracts.browseAll', async (req, { sdkRegistry }) => {
        return contractsBrowseAll({ ...req, sdkRegistry });
    });

    host.register('deposits.forAddress', async (req, { sdkRegistry }) => {
        return depositsForAddress({ ...req, sdkRegistry });
    });

    host.register('withdrawals.forAddress', async (req, { sdkRegistry }) => {
        return withdrawalsForAddress({ ...req, sdkRegistry });
    });

    // §42.3 Contract detail page — metadata / state / balances /
    // executions + the originating DEPLOY action.

    host.register('contracts.byActionIndex', async (req, { sdkRegistry }) => {
        return contractByActionIndex({ ...req, sdkRegistry });
    });

    host.register('actions.byIndex', async (req, { sdkRegistry }) => {
        return actionByIndex({ ...req, sdkRegistry });
    });

    host.register('contracts.state', async (req, { sdkRegistry }) => {
        return contractState({ ...req, sdkRegistry });
    });

    host.register('contracts.balance', async (req, { sdkRegistry }) => {
        return contractBalance({ ...req, sdkRegistry });
    });

    host.register('executions.forContract', async (req, { sdkRegistry }) => {
        return executionsForContract({ ...req, sdkRegistry });
    });

    // §42.6 DEPLOY authoring — action composer + three pure-function
    // passthroughs over sdk.contracts.* for the validate / size /
    // suggest-gas buttons.

    host.register('action.deploy', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return deployAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('action.execute', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return executeAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('action.deposit', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return depositAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('action.withdraw', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return withdrawAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    // §42.7 Staking — four read-only explorer passthroughs backing
    // the dashboard + operator dashboard.

    host.register('stakes.forAddress', async (req, { sdkRegistry }) => {
        return stakesForAddress({ ...req, sdkRegistry });
    });

    host.register('delegations.forAddress', async (req, { sdkRegistry }) => {
        return delegationsForAddress({ ...req, sdkRegistry });
    });

    host.register('rewards.forAddress', async (req, { sdkRegistry }) => {
        return rewardsForAddress({ ...req, sdkRegistry });
    });

    host.register('validators.forChain', async (req, { sdkRegistry }) => {
        return validatorsForChain({ ...req, sdkRegistry });
    });

    host.register('action.stake', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return stakeAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('action.unstake', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return unstakeAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('action.claimRewards', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return claimRewardsAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('action.delegate', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return delegateAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('action.revokeDelegation', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return revokeDelegationAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('broadcasts.forAddress', async (req, { sdkRegistry }) => {
        return broadcastsForAddress({ ...req, sdkRegistry });
    });

    host.register('links.address', async (req, { sdkRegistry }) => {
        return linksForAddress({ ...req, sdkRegistry });
    });

    // §22 + §42.9 multisig wallet creation coordinator (Step 17). Writes
    // a MultisigConfig onto the chosen Wallet record's `multisig` slot.
    host.register('multisig.create', async (req, { vault, sdkRegistry }) => {
        return createMultisigConfig({ ...req, vault, sdkRegistry });
    });

    host.register('multisig.receiveAddress', async (req, { vault, sdkRegistry }) => {
        return receiveMultisigAddress({ ...req, vault, sdkRegistry });
    });

    host.register('multisig.listAddresses', async (req, { vault, sdkRegistry }) => {
        return listMultisigReceiveAddresses({ ...req, vault, sdkRegistry });
    });

    // §22.3 + §42.9 multisig sign-round persistence + state machine
    // (Step 19). One register per surface so each handler keeps a
    // tight, single-responsibility shape — same pattern the staking
    // handlers use.
    host.register('multisigSign.start', async (req, { vault }) => {
        return startMultisigSigningSession({ ...req, vault });
    });

    host.register('multisigSign.get', async (req, { vault }) => {
        return getMultisigSigningSession({ ...req, vault });
    });

    host.register('multisigSign.list', async (req, { vault }) => {
        return listMultisigSigningSessions({ ...req, vault });
    });

    host.register('multisigSign.cancel', async (req, { vault }) => {
        return cancelMultisigSigningSession({ ...req, vault });
    });

    host.register('multisigSign.contributeNonce', async (req, { vault }) => {
        return contributeMultisigNonce({ ...req, vault });
    });

    host.register('multisigSign.contributeSignature', async (req, { vault }) => {
        return contributeMultisigSignature({ ...req, vault });
    });

    host.register('multisigSign.aggregate', async (req, { vault, sdkRegistry }) => {
        return aggregateMultisigSession({ ...req, vault, sdkRegistry });
    });

    host.register('multisigSign.finalize', async (req, { vault }) => {
        return finalizeMultisigSigningSession({ ...req, vault });
    });

    // §22.3 + §42.9 local-cosigner contribution (Step 21). Unlocks
    // the wallet's software signer, dispatches to the right round
    // based on session.scheme + session.status, and pipes the
    // contribution through the Step 19 contribute APIs.
    host.register('multisigSign.signLocally', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return signMultisigLocally({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('contracts.validate', async (req, { sdkRegistry }) => {
        return contractValidate({ ...req, sdkRegistry });
    });

    host.register('contracts.checkCodeSize', async (req, { sdkRegistry }) => {
        return contractCheckCodeSize({ ...req, sdkRegistry });
    });

    host.register('contracts.suggestGasLimit', async (req, { sdkRegistry }) => {
        return contractSuggestGasLimit({ ...req, sdkRegistry });
    });

    host.register('action.dividend', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return dividendAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('holders.forTick', async (req, { sdkRegistry }) => {
        return holdersFor({ ...req, sdkRegistry });
    });

    // §40.9 AIRDROP two-transaction flow — LIST create + AIRDROP
    // reference, plus the two read-only passthroughs AirdropForm uses
    // to (a) resolve the LIST's ACTION_INDEX after it's indexed and
    // (b) confirm the LIST on the AIRDROP review screen.

    host.register('action.createList', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return createList({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('action.airdrop', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return airdropAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('actions.byTxid', async (req, { sdkRegistry }) => {
        return actionByTxid({ ...req, sdkRegistry });
    });

    host.register('lists.byActionIndex', async (req, { sdkRegistry }) => {
        return listByActionIndex({ ...req, sdkRegistry });
    });

    // Pending-airdrop CRUD — crash-safe state for the §40.9 stage
    // machine (LIST-broadcast → wait-for-index → AIRDROP-broadcast).
    // The renderer persists progress here so closing the wallet
    // between stages is recoverable.

    host.register('pendingAirdrops.save', async (req, { vault }) => {
        return savePendingAirdrop({ ...req, vault });
    });

    host.register('pendingAirdrops.listForWallet', async (req, { vault }) => {
        return listPendingAirdropsForWallet({ ...req, vault });
    });

    host.register('pendingAirdrops.update', async (req, { vault }) => {
        return updatePendingAirdrop({ ...req, vault });
    });

    host.register('pendingAirdrops.clear', async (req, { vault }) => {
        return clearPendingAirdrop({ ...req, vault });
    });

    // §41.2–§41.3 DEX market queries — passthroughs to the SDK's
    // explorer client. Read-only; no vault, no signing.

    host.register('markets.list', async (req, { sdkRegistry }) => {
        return getMarkets({ ...req, sdkRegistry });
    });
    host.register('markets.byPair', async (req, { sdkRegistry }) => {
        return getMarket({ ...req, sdkRegistry });
    });
    host.register('markets.history', async (req, { sdkRegistry }) => {
        return getMarketHistory({ ...req, sdkRegistry });
    });
    host.register('markets.orders', async (req, { sdkRegistry }) => {
        return getMarketOrders({ ...req, sdkRegistry });
    });
    host.register('markets.orderbook', async (req, { sdkRegistry }) => {
        return getOrderbook({ ...req, sdkRegistry });
    });

    // §41.2 watchlist CRUD — per-wallet pinned markets. No signing;
    // vault-local state only.

    host.register('watchlist.listForWallet', async (req, { vault }) => {
        return listWatchlistForWallet({ ...req, vault });
    });
    host.register('watchlist.save', async (req, { vault }) => {
        return saveWatchlistEntry({ ...req, vault });
    });
    host.register('watchlist.clear', async (req, { vault }) => {
        return clearWatchlistEntry({ ...req, vault });
    });

    // §40.10 Advanced Actions Form — generic "submit any action"
    // surface. Read-only SDK introspection handlers drive the form's
    // schema-based field list and live validation. The write path
    // accepts any (action, params) pair and forwards to submitAction,
    // which runs the SDK's validator before signing.

    host.register('action.advanced', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return advancedAction({ ...req, vault, chainRegistry, sdkRegistry });
    });

    host.register('sdk.listActions', async (req, { sdkRegistry }) => {
        return listActions({ ...req, sdkRegistry });
    });

    host.register('sdk.getActionFormats', async (req, { sdkRegistry }) => {
        return getActionFormats({ ...req, sdkRegistry });
    });

    host.register('sdk.getActionFields', async (req, { sdkRegistry }) => {
        return getActionFields({ ...req, sdkRegistry });
    });

    host.register('sdk.validateAction', async (req, { sdkRegistry }) => {
        return validateActionDryRun({ ...req, sdkRegistry });
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
