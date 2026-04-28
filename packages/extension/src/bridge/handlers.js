// Bridge message handlers — §43.2 `window.xchain` surface routed
// through the extension's background MessageHost. Registered via
// `registerBridgeHandlers(host, { approvals })`.
//
// Every handler's request carries `{ origin, appName?, appIcon? }` so
// the background can look up or create a `ConnectedSite` record and
// consult its permissions. Missing origin → hard reject; bridge
// messages MUST come from the content script with its own-origin
// annotation (the content script injects `origin: location.origin`).
//
// Permission model (§43.3): checked against `ConnectedSite.permissions`:
//   canSignAction[KIND] === 'always'  → proceed without prompt
//   canSignAction[KIND] === 'ask'     → prompt via approvals
//   canSignAction[KIND] === 'never'   → hard reject
//   canSignMessage === true           → proceed without prompt
//   canSignMessage === false          → prompt via approvals
//
// Unknown-origin / first-time requests must go through `bridge.connect`
// which creates the ConnectedSite record; other handlers reject with
// `NOT_CONNECTED` if no record exists.

import { flows, schemas } from '@xchain-wallet/core';
import { shouldAutoApproveConnect } from '@xchain-wallet/core/shared/utils/originAutoApprove.js';
import { rejectAllApprovals, UserRejectedError } from './Approvals.js';

const {
    walletBalances,
    addressBalances,
    sendAsset,
    sweepAsset,
    signMessageFlow,
    signPsbtFlow,
    submitAction,
    createSignThrottle,
} = flows;

const SUPPORTED_BRIDGE_ACTIONS = ['SEND', 'SWEEP'];

/**
 * @param {import('../background/MessageHost.js').MessageHost} host
 * @param {{
 *   approvals?: import('./Approvals.js').Approvals,
 *   signThrottle?: ReturnType<typeof createSignThrottle>,
 * }} [opts]
 */
export function registerBridgeHandlers(host, opts = {}) {
    const approvals = opts.approvals ?? rejectAllApprovals;
    const signThrottle = opts.signThrottle ?? createSignThrottle();

    host.register('bridge.connect', async (req, deps) => {
        assertOrigin(req);
        const { origin, appName = origin, appIcon } = req;

        const existing = await findConnectedSite(deps.vault, origin);
        if (existing) {
            await touchLastUsed(deps.vault, existing);
            return {
                version: req.bridgeVersion ?? '0.1.0',
                chains: existing.permissions.chains,
                accounts: existing.permissions.accounts,
            };
        }

        // §48.6 / G151 — Developer-Mode auto-approve for localhost.
        // Skips the approval prompt and synthesizes a permissive
        // connect decision when settings allow + origin is localhost.
        // Sign requests (signMessage / signAction / signPsbt / signIn)
        // still go through approvals — the password is required to
        // sign and the wallet never caches it, so connect is the only
        // safe step to short-circuit.
        const settings = await deps.vault.settings.get().catch(() => null);
        const autoConnect = shouldAutoApproveConnect({ origin, settings });
        const decision = autoConnect
            ? {
                approved: true,
                chains: Array.isArray(req.chains) ? req.chains : [],
                accounts: Array.isArray(req.accounts) ? req.accounts : [],
                canSignMessage: false,
                canSignAction: {},
            }
            : await approvals.connect({
                origin,
                appName,
                appIcon,
                requestedChains: req.chains,
                requestedAccounts: req.accounts,
            });
        if (!decision || !decision.approved) {
            throw new UserRejectedError('connect');
        }
        const permissions = {
            chains: Array.isArray(decision.chains) ? decision.chains : [],
            accounts: Array.isArray(decision.accounts) ? decision.accounts : [],
            canSignMessage: decision.canSignMessage === true,
            canSignAction: decision.canSignAction ?? {},
        };
        const site = schemas.createConnectedSite({
            origin, appName, appIcon,
            permissions,
        });
        await deps.vault.connectedSites.put(site);
        return {
            version: req.bridgeVersion ?? '0.1.0',
            chains: permissions.chains,
            accounts: permissions.accounts,
        };
    });

    host.register('bridge.disconnect', async (req, deps) => {
        assertOrigin(req);
        const site = await findConnectedSite(deps.vault, req.origin);
        if (!site) return { disconnected: false };
        await deps.vault.connectedSites.delete(site.id);
        return { disconnected: true };
    });

    host.register('bridge.getAccounts', async (req, deps) => {
        const site = await requireSite(deps.vault, req);
        const allAccounts = await deps.vault.accounts.list();
        const ids = new Set(site.permissions.accounts);
        const accounts = (ids.size > 0
            ? allAccounts.filter((a) => ids.has(a.id))
            : allAccounts
        ).map((a) => ({ id: a.id, name: a.name }));
        return accounts;
    });

    host.register('bridge.getAddresses', async (req, deps) => {
        const site = await requireSite(deps.vault, req);
        assertChainPermitted(site, req.chainId);
        const descriptor = deps.chainRegistry.get(req.chainId);
        if (!descriptor) throw bridgeError('UNKNOWN_CHAIN', req.chainId);

        const all = await deps.vault.addresses.list();
        const accountIds = new Set(site.permissions.accounts);
        const filtered = all.filter(
            (a) =>
                a.chain === descriptor.coin &&
                a.network === descriptor.networkKind &&
                (accountIds.size === 0 || (a.accountId && accountIds.has(a.accountId))),
        );
        return filtered.map((a) => ({
            id: a.id,
            accountId: a.accountId,
            chain: a.chain,
            network: a.network,
            addressType: a.addressType,
            address: a.address,
            label: a.label,
        }));
    });

    host.register('bridge.getBalances', async (req, deps) => {
        const site = await requireSite(deps.vault, req);
        assertChainPermitted(site, req.chainId);
        // Ensure the requested address is one the site is permitted to see.
        const ok = await siteHasAddress(deps.vault, site, req.chainId, req.address, deps.chainRegistry);
        if (!ok) throw bridgeError('ADDRESS_NOT_PERMITTED', req.address);
        return addressBalances({
            sdkRegistry: deps.sdkRegistry,
            chainId: req.chainId,
            address: req.address,
        });
    });

    host.register('bridge.getSupportedChains', async (_req, deps) => {
        return deps.chainRegistry.supportedChains().map((d) => ({
            id: d.id,
            coin: d.coin,
            displayName: d.displayName,
            networkKind: d.networkKind,
            color: d.color,
            // `d.icon` is a filename resolved by the shell's bundler.
            // Exposing the raw filename to a dApp would be unresolvable
            // cross-origin. A later shell-layer piece wires this into a
            // `chrome.runtime.getURL(...)` call against a web-accessible
            // asset path; until then omit the field rather than send a
            // bare filename.
            icon: '',
            addressTypes: d.addressTypes,
            defaultAddressType: d.defaultAddressType,
            supportedActions: d.supportedActions,
            uriScheme: d.uriScheme,
        }));
    });

    host.register('bridge.getActiveChains', async (req, deps) => {
        await requireSite(deps.vault, req);
        const settings = await deps.vault.settings.get();
        if (!settings) return [];
        // "Active" = any chain that has seeded per-chain state (feeStrategy,
        // ADS, etc). Matches what seedSettings populates at createWallet.
        return Object.keys(settings.fees ?? {});
    });

    host.register('bridge.signMessage', async (req, deps) => {
        const site = await requireSite(deps.vault, req);
        assertChainPermitted(site, req.chainId);
        assertNotThrottled(signThrottle, req);

        if (!site.permissions.canSignMessage) {
            const decision = await approvals.signMessage({
                origin: req.origin,
                kind: 'signMessage',
                chainId: req.chainId,
                payload: { address: req.address, message: req.message },
            });
            if (!decision?.approved) throw new UserRejectedError('signMessage');
            if (!decision.password) throw bridgeError('NO_PASSWORD', 'approvals must return password');
            const result = await invokeSignMessage(deps, {
                ...req,
                walletId: decision.walletId ?? (await walletIdForAddress(deps.vault, req.address)),
                password: decision.password,
                bip39Passphrase: decision.bip39Passphrase,
            });
            if (decision.savePermanent) {
                await updateSitePermissions(deps.vault, site, { canSignMessage: true });
            }
            return result;
        }
        // canSignMessage: the site is allowed, but we still need a
        // password — approvals is asked for password-only.
        const decision = await approvals.signMessage({
            origin: req.origin,
            kind: 'signMessage',
            chainId: req.chainId,
            payload: { address: req.address, message: req.message, alreadyGranted: true },
        });
        if (!decision?.approved) throw new UserRejectedError('signMessage');
        if (!decision.password) throw bridgeError('NO_PASSWORD', 'approvals must return password');
        return invokeSignMessage(deps, {
            ...req,
            walletId: decision.walletId ?? (await walletIdForAddress(deps.vault, req.address)),
            password: decision.password,
            bip39Passphrase: decision.bip39Passphrase,
        });
    });

    host.register('bridge.signAction', async (req, deps) => {
        const site = await requireSite(deps.vault, req);
        assertChainPermitted(site, req.chainId);
        assertNotThrottled(signThrottle, req);
        const actionName = req.action;
        if (!SUPPORTED_BRIDGE_ACTIONS.includes(actionName)) {
            // §43.2: unsupported actions return structured shape, not throw
            return {
                error: 'UNSUPPORTED_ACTION',
                supportedActions: SUPPORTED_BRIDGE_ACTIONS.slice(),
            };
        }
        const permission = site.permissions.canSignAction?.[actionName] ?? 'ask';
        if (permission === 'never') throw bridgeError('ACTION_REJECTED_BY_POLICY', actionName);

        const decision = await approvals.signAction({
            origin: req.origin,
            kind: 'signAction',
            chainId: req.chainId,
            action: actionName,
            payload: req.params,
        });
        if (!decision?.approved) throw new UserRejectedError('signAction');
        if (!decision.password) throw bridgeError('NO_PASSWORD', 'approvals must return password');

        if (decision.savePermanent) {
            await updateSitePermissions(deps.vault, site, {
                canSignAction: {
                    ...site.permissions.canSignAction,
                    [actionName]: 'always',
                },
            });
        }

        const params = req.params ?? {};
        if (actionName === 'SEND') {
            return sendAsset({
                vault: deps.vault,
                walletId: decision.walletId ?? (await walletIdForAddress(deps.vault, params.from)),
                password: decision.password,
                bip39Passphrase: decision.bip39Passphrase,
                chainRegistry: deps.chainRegistry,
                sdkRegistry: deps.sdkRegistry,
                chainId: req.chainId,
                ...params,
            });
        }
        if (actionName === 'SWEEP') {
            return sweepAsset({
                vault: deps.vault,
                walletId: decision.walletId ?? (await walletIdForAddress(deps.vault, params.from)),
                password: decision.password,
                bip39Passphrase: decision.bip39Passphrase,
                chainRegistry: deps.chainRegistry,
                sdkRegistry: deps.sdkRegistry,
                chainId: req.chainId,
                ...params,
            });
        }
        throw bridgeError('UNREACHABLE', 'supported action fell through');
    });

    host.register('bridge.signPsbt', async (req, deps) => {
        const site = await requireSite(deps.vault, req);
        assertChainPermitted(site, req.chainId);
        assertNotThrottled(signThrottle, req);
        const decision = await approvals.signPsbt({
            origin: req.origin,
            kind: 'signPsbt',
            chainId: req.chainId,
            payload: { psbtHex: req.psbtHex, signingPaths: req.signingPaths },
        });
        if (!decision?.approved) throw new UserRejectedError('signPsbt');
        if (!decision.password) throw bridgeError('NO_PASSWORD', 'approvals must return password');
        return signPsbtFlow({
            vault: deps.vault,
            walletId: decision.walletId,
            password: decision.password,
            bip39Passphrase: decision.bip39Passphrase,
            chainRegistry: deps.chainRegistry,
            sdkRegistry: deps.sdkRegistry,
            chainId: req.chainId,
            psbtHex: req.psbtHex,
            signingPaths: req.signingPaths,
        });
    });

    host.register('bridge.parallel', async () => {
        // §43.2 parallel() ships in Phase 4+ alongside cross-chain
        // orchestration (§42.8.2). Returning a structured shape (not
        // throwing) mirrors bridge.signAction's UNSUPPORTED_ACTION
        // response so dApp authors can branch on `result.error`.
        return {
            error: 'PHASE_DEFERRED',
            phase: 4,
            message: 'bridge.parallel() ships alongside cross-chain orchestration in Phase 4+',
        };
    });

    host.register('bridge.signIn', async (req, deps) => {
        const site = await requireSite(deps.vault, req);
        assertNotThrottled(signThrottle, req);
        const decision = await approvals.signIn({
            origin: req.origin,
            kind: 'signIn',
            payload: {
                appId: req.appId,
                nonce: req.nonce,
                expiresInMs: req.expiresInMs,
            },
        });
        if (!decision?.approved) throw new UserRejectedError('signIn');
        if (!decision.password || !decision.address) {
            throw bridgeError('NO_CREDENTIALS', 'approvals must return { password, address }');
        }
        // Compose challenge per §43.6 format.
        const now = Date.now();
        const expiresInMs = Math.min(
            req.expiresInMs ?? 5 * 60 * 1000,
            60 * 60 * 1000,
        );
        const nonce = typeof req.nonce === 'string' && req.nonce.length > 0
            ? req.nonce
            : randomNonce();
        const challenge = [
            'XChain Sign-In',
            req.appId,
            decision.address,
            nonce,
            new Date(now).toISOString(),
            new Date(now + expiresInMs).toISOString(),
        ].join(' | ');

        const addr = await findAddressByString(deps.vault, decision.address, req.chainId, deps.chainRegistry);
        if (!addr) throw bridgeError('ADDRESS_NOT_FOUND', decision.address);
        const walletId = decision.walletId ?? await walletIdForAddress(deps.vault, decision.address);
        const { signature } = await signMessageFlow({
            vault: deps.vault,
            walletId,
            password: decision.password,
            bip39Passphrase: decision.bip39Passphrase,
            chainRegistry: deps.chainRegistry,
            sdkRegistry: deps.sdkRegistry,
            chainId: req.chainId ?? chainIdForAddr(deps.chainRegistry, addr),
            path: addr.derivationPath ?? undefined,
            addressId: addr.derivationPath ? undefined : addr.id,
            message: challenge,
        });
        return { address: decision.address, signature, challenge };
    });
}

// --- helpers ---------------------------------------------------------------

function assertOrigin(req) {
    if (!req || typeof req.origin !== 'string' || !req.origin) {
        throw bridgeError('MISSING_ORIGIN', 'bridge request must carry origin');
    }
}

async function findConnectedSite(vault, origin) {
    if (!origin) return null;
    const sites = await vault.connectedSites.findBy('origin', origin);
    return sites[0] ?? null;
}

async function requireSite(vault, req) {
    assertOrigin(req);
    const site = await findConnectedSite(vault, req.origin);
    if (!site) throw bridgeError('NOT_CONNECTED', req.origin);
    await touchLastUsed(vault, site);
    return site;
}

async function touchLastUsed(vault, site) {
    await vault.connectedSites.put({
        ...site,
        lastUsedAt: new Date().toISOString(),
    });
}

function assertChainPermitted(site, chainId) {
    if (!chainId) throw bridgeError('MISSING_CHAIN_ID', '');
    const chains = site.permissions?.chains ?? [];
    if (chains.length === 0) return;  // empty list = all permitted (per §43.3)
    if (!chains.includes(chainId)) {
        throw bridgeError('CHAIN_NOT_PERMITTED', chainId);
    }
}

function assertNotThrottled(throttle, req) {
    const result = throttle.check(req?.origin);
    if (result.allowed) return;
    const err = bridgeError(
        'THROTTLED',
        `retry in ${Math.ceil(result.retryAfterMs / 1000)}s`,
    );
    err.retryAfterMs = result.retryAfterMs;
    err.burst = result.burst;
    err.windowMs = result.windowMs;
    throw err;
}

async function siteHasAddress(vault, site, chainId, address, chainRegistry) {
    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) return false;
    const all = await vault.addresses.list();
    const accountIds = new Set(site.permissions.accounts);
    return all.some(
        (a) =>
            a.address === address &&
            a.chain === descriptor.coin &&
            a.network === descriptor.networkKind &&
            (accountIds.size === 0 || (a.accountId && accountIds.has(a.accountId))),
    );
}

async function updateSitePermissions(vault, site, patch) {
    const next = {
        ...site,
        permissions: { ...site.permissions, ...patch },
        lastUsedAt: new Date().toISOString(),
    };
    await vault.connectedSites.put(next);
}

async function walletIdForAddress(vault, addressOrId) {
    if (!addressOrId) return undefined;
    const all = await vault.addresses.list();
    const match = all.find((a) => a.id === addressOrId || a.address === addressOrId);
    if (!match) return undefined;
    if (match.signerId) return match.signerId;
    if (!match.accountId) {
        const wallets = await vault.wallets.list();
        return wallets[0]?.id;
    }
    const account = await vault.accounts.get(match.accountId);
    return account?.walletId;
}

async function findAddressByString(vault, address, chainId, chainRegistry) {
    const all = await vault.addresses.list();
    if (!chainId) return all.find((a) => a.address === address) ?? null;
    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) return null;
    return all.find(
        (a) =>
            a.address === address &&
            a.chain === descriptor.coin &&
            a.network === descriptor.networkKind,
    ) ?? null;
}

function chainIdForAddr(chainRegistry, addr) {
    return chainRegistry.chainIdFor(addr.chain, addr.network);
}

async function invokeSignMessage(deps, req) {
    const addr = await findAddressByString(deps.vault, req.address, req.chainId, deps.chainRegistry);
    if (!addr) throw bridgeError('ADDRESS_NOT_FOUND', req.address);
    return signMessageFlow({
        vault: deps.vault,
        walletId: req.walletId,
        password: req.password,
        bip39Passphrase: req.bip39Passphrase,
        chainRegistry: deps.chainRegistry,
        sdkRegistry: deps.sdkRegistry,
        chainId: req.chainId,
        path: addr.derivationPath ?? undefined,
        addressId: addr.derivationPath ? undefined : addr.id,
        message: req.message,
    });
}

function randomNonce() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let hex = '';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    return hex;
}

class BridgeError extends Error {
    constructor(code, detail) {
        super(`bridge: ${code}${detail ? ` (${detail})` : ''}`);
        this.name = 'BridgeError';
        this.code = code;
    }
}

function bridgeError(code, detail) {
    return new BridgeError(code, detail);
}
