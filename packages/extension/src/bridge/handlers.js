// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Bridge message handlers (§43.2): `window.xchain` surface routed
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
import { logConsole } from '@xchain-wallet/core/shared/utils/logConsole.js';
import {
    BRIDGE_SPEC_VERSION,
    BRIDGE_SUPPORTED_VERSIONS,
    SIGN_IN_CHALLENGE_PREFIX,
    isBridgeVersionSupported,
} from '@xchain-wallet/bridge-spec';
import { rejectAllApprovals, UserRejectedError } from './Approvals.js';
import { emitPermissionDiff, noopBridgeEvents } from './bridgeEvents.js';

const {
    walletBalances,
    addressBalances,
    sendToken,
    sweepToken,
    signMessageFlow,
    signPsbtFlow,
    submitAction,
    createSignThrottle,
    isOriginBlocked,
    passiveCoSignForAccount,
    findCoSignerAccountByAddress,
} = flows;

const SUPPORTED_BRIDGE_ACTIONS = ['SEND', 'SWEEP'];

/**
 * @param {import('../background/MessageHost.js').MessageHost} host
 * @param {{
 *   approvals?: import('./Approvals.js').Approvals,
 *   signThrottle?: ReturnType<typeof createSignThrottle>,
 *   events?: typeof noopBridgeEvents,
 * }} [opts]
 */
export function registerBridgeHandlers(host, opts = {}) {
    const approvals = opts.approvals ?? rejectAllApprovals;
    const signThrottle = opts.signThrottle ?? createSignThrottle();
    const events = opts.events ?? noopBridgeEvents;

    // Cluster Q FOLLOWUP 4: every bridge handler logs entry / exit /
    // error to logConsole. The `source` is `bridge:<channel>` so the
    // Developer Mode log viewer can filter by `bridge:` to see only
    // dApp traffic. Origins are short (`http(s)://host[:port]`) so
    // we include them verbatim; they are by definition known to the
    // dApp making the request.
    const register = (name, handler) => {
        host.register(name, async (req, deps) => {
            const origin = (req && typeof req.origin === 'string') ? req.origin : '?';
            logConsole.record({
                source: `bridge:${name}`,
                level: 'info',
                message: `→ ${origin}`,
            });
            try {
                const result = await handler(req, deps);
                logConsole.record({
                    source: `bridge:${name}`,
                    level: 'info',
                    message: '← ok',
                });
                return result;
            } catch (err) {
                const code = err?.code ?? err?.name ?? 'Error';
                logConsole.record({
                    source: `bridge:${name}`,
                    level: 'warn',
                    message: `← ${code}`,
                });
                throw err;
            }
        });
    };

    register('bridge.connect', async (req, deps) => {
        assertOrigin(req);
        await assertNotBlocked(req, deps);
        // Cluster F FOLLOWUP 3: version negotiation. Reject the
        // connect cleanly when the dApp asks for a bridge version
        // we don't implement, instead of accepting and failing later
        // when a version-specific method gets called.
        if (!isBridgeVersionSupported(req.bridgeVersion)) {
            throw bridgeError(
                'BRIDGE_VERSION_MISMATCH',
                `requested ${JSON.stringify(req.bridgeVersion)}; supported: ${BRIDGE_SUPPORTED_VERSIONS.join(', ')}`,
            );
        }
        const { origin, appName = origin, appIcon } = req;

        const existing = await findConnectedSite(deps.vault, origin);
        if (existing) {
            await touchLastUsed(deps.vault, existing);
            return {
                version: req.bridgeVersion ?? BRIDGE_SPEC_VERSION,
                supportedVersions: [...BRIDGE_SUPPORTED_VERSIONS],
                chains: existing.permissions.chains,
                accounts: existing.permissions.accounts,
            };
        }

        // §48.6 / G151: Developer-Mode auto-approve for localhost.
        // Skips the approval prompt and synthesizes a permissive
        // connect decision when settings allow + origin is localhost.
        // Sign requests (signMessage / signAction / signPsbt / signIn)
        // still go through approvals. The password is required to
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
            version: req.bridgeVersion ?? BRIDGE_SPEC_VERSION,
            supportedVersions: [...BRIDGE_SUPPORTED_VERSIONS],
            chains: permissions.chains,
            accounts: permissions.accounts,
        };
    });

    register('bridge.disconnect', async (req, deps) => {
        assertOrigin(req);
        const site = await findConnectedSite(deps.vault, req.origin);
        if (!site) return { disconnected: false };
        await deps.vault.connectedSites.delete(site.id);
        // §43.2: fire `disconnect` so the dApp's listener can clear
        // session state without polling. Reason mirrors the bridge-spec
        // BridgeEventMap.disconnect signature.
        await events.disconnect(req.origin, 'user-requested');
        return { disconnected: true };
    });

    register('bridge.getAccounts', async (req, deps) => {
        const site = await requireSite(deps.vault, req);
        const allAccounts = await deps.vault.accounts.list();
        const ids = new Set(site.permissions.accounts);
        const accounts = (ids.size > 0
            ? allAccounts.filter((a) => ids.has(a.id))
            : allAccounts
        ).map((a) => ({ id: a.id, name: a.name }));
        return accounts;
    });

    register('bridge.getAddresses', async (req, deps) => {
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

    register('bridge.getBalances', async (req, deps) => {
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

    register('bridge.getSupportedChains', async (_req, deps) => {
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
            // tick path; until then omit the field rather than send a
            // bare filename.
            icon: '',
            addressTypes: d.addressTypes,
            defaultAddressType: d.defaultAddressType,
            supportedActions: d.supportedActions,
            uriScheme: d.uriScheme,
        }));
    });

    register('bridge.getActiveChains', async (req, deps) => {
        await requireSite(deps.vault, req);
        const settings = await deps.vault.settings.get();
        if (!settings) return [];
        // "Active" = any chain that has seeded per-chain state (feeStrategy,
        // ADS, etc). Matches what seedSettings populates at createWallet.
        // Filtered down to the user's active network. Chains on inactive
        // networks aren't being queried by the wallet, so dApps must not
        // see them either (otherwise a dApp would attempt to sign against
        // a chain we can't reach). The filter helper falls through with
        // an empty result on missing registry / no chains; that's fine
        // since the dApp will get an empty list and refuse to connect.
        const raw = Object.keys(settings.fees ?? {});
        return flows.filterChainIdsByActiveNetwork(raw, settings, deps.chainRegistry);
    });

    register('bridge.signMessage', async (req, deps) => {
        await assertNotBlocked(req, deps);
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
                await updateSitePermissions(deps.vault, site, { canSignMessage: true }, { events });
            }
            return result;
        }
        // canSignMessage: the site is allowed, but we still need a
        // password; approvals is asked for password-only.
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

    register('bridge.signAction', async (req, deps) => {
        await assertNotBlocked(req, deps);
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
            }, { events });
        }

        const params = req.params ?? {};
        if (actionName === 'SEND') {
            return sendToken({
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
            return sweepToken({
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

    register('bridge.signPsbt', async (req, deps) => {
        await assertNotBlocked(req, deps);
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

    // §22 / P4: the wallet as passive MuSig2 co-signer. An agent sends the
    // PSBT + its public nonce + the aggregate address of the 2-of-2 account it
    // wants co-signed. We resolve the stored CoSignerAccount, ALWAYS prompt the
    // user (the policy is a safety net; the human is the final gate), and on
    // approval derive the daemon key transiently to return the partial
    // signature or a structured refusal.
    register('bridge.coSign', async (req, deps) => {
        await assertNotBlocked(req, deps);
        const site = await requireSite(deps.vault, req);
        assertChainPermitted(site, req.chainId);
        assertNotThrottled(signThrottle, req);
        const account = await findCoSignerAccountByAddress({
            vault: deps.vault,
            chainId: req.chainId,
            aggregateAddress: req.aggregateAddress,
        });
        if (!account) {
            throw bridgeError('UNKNOWN_COSIGNER_ACCOUNT', `no enabled co-signer account for ${req.aggregateAddress} on ${req.chainId}`);
        }
        const decision = await approvals.coSign({
            origin: req.origin,
            kind: 'coSign',
            chainId: req.chainId,
            payload: {
                accountId: account.id,
                aggregateAddress: account.aggregateAddress,
                accountName: account.name,
                psbtHex: req.psbtHex,
                agentPublicNonce: req.agentPublicNonce,
                inputIndex: req.inputIndex,
                inputs: req.inputs,
            },
        });
        if (!decision?.approved) throw new UserRejectedError('coSign');
        if (!decision.password) throw bridgeError('NO_PASSWORD', 'approvals must return password');
        return passiveCoSignForAccount({
            vault: deps.vault,
            chainRegistry: deps.chainRegistry,
            sdkRegistry: deps.sdkRegistry,
            accountId: account.id,
            password: decision.password,
            bip39Passphrase: decision.bip39Passphrase,
            request: {
                psbt: req.psbtHex,
                agentPublicNonce: req.agentPublicNonce,
                inputIndex: req.inputIndex,
                inputs: req.inputs,
            },
        });
    });

    register('bridge.parallel', async () => {
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

    register('bridge.signIn', async (req, deps) => {
        await assertNotBlocked(req, deps);
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
        // req.origin is stamped by the content script (location.origin),
        // never by the page. requireSite above has already asserted it.
        // Embedding it in the signed bytes binds the sign-in to the site
        // the user was actually on: relying backends verify the origin
        // field, so a look-alike site passing a legitimate appId can no
        // longer obtain a signature indistinguishable from the real app's.
        const challenge = [
            SIGN_IN_CHALLENGE_PREFIX,
            req.appId,
            req.origin,
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

async function assertNotBlocked(req, deps) {
    if (!req || typeof req.origin !== 'string' || !req.origin) return;
    const settings = await deps.vault.settings.get().catch(() => null);
    if (!settings) return;
    if (isOriginBlocked(settings.blockedOrigins, req.origin)) {
        throw bridgeError('BLOCKED_BY_USER', req.origin);
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

async function updateSitePermissions(vault, site, patch, eventCtx) {
    const next = {
        ...site,
        permissions: { ...site.permissions, ...patch },
        lastUsedAt: new Date().toISOString(),
    };
    await vault.connectedSites.put(next);
    if (eventCtx?.events) {
        let payload;
        const accountsChanged = patch.accounts !== undefined
            && sortedKey(site.permissions.accounts) !== sortedKey(next.permissions.accounts);
        if (accountsChanged) {
            const allAccounts = await vault.accounts.list();
            const ids = new Set(next.permissions.accounts ?? []);
            payload = (ids.size > 0
                ? allAccounts.filter((a) => ids.has(a.id))
                : allAccounts
            ).map((a) => ({ id: a.id, name: a.name }));
        }
        await emitPermissionDiff({
            events: eventCtx.events,
            origin: site.origin,
            prevPermissions: site.permissions,
            nextPermissions: next.permissions,
            accountsChangedPayload: payload,
        });
    }
}

function sortedKey(list) {
    if (!Array.isArray(list)) return '';
    return [...new Set(list)].sort().join(',');
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
