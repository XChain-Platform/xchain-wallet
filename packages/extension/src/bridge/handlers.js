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
import {
    resolveAutoApproveScope,
    shouldAutoApproveConnect,
    shouldAutoApproveSign,
} from '@xchain-wallet/core/shared/utils/originAutoApprove.js';
import { logConsole } from '@xchain-wallet/core/shared/utils/logConsole.js';
import { createSignPasswordCache } from './signPasswordCache.js';
import {
    BRIDGE_SPEC_VERSION,
    BRIDGE_SUPPORTED_VERSIONS,
    SIGN_IN_CHALLENGE_SEPARATOR,
    SIGN_IN_CHALLENGE_VERSION,
    formatSignInChallenge,
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
    filterChainIdsByActiveNetwork,
} = flows;

const SUPPORTED_BRIDGE_ACTIONS = ['SEND', 'SWEEP'];

// §43.2 parallel(): cap the batch so a single call can't ask the user to
// review an unbounded list of sign screens (a hostile dApp DoS vector) and
// can't spawn an unbounded fan-out of signing flows. 20 is far above any
// legitimate cross-chain composer draft (§42.8.2) yet small enough that the
// grouped approval modal stays reviewable.
const MAX_PARALLEL_ACTIONS = 20;

// Subdirectory (relative to the extension root) where the build copies the
// per-chain branding icons and exposes them via `web_accessible_resources`
// (see packages/extension/vite.config.js + manifest.json). getSupportedChains
// resolves a chain descriptor's bare icon filename against this path.
const CHAIN_ICON_DIR = 'chain-icons';

// Resolve a web-accessible-resource path to a URL a dApp can load. In the
// MV3 service worker this yields `chrome-extension://<id>/<path>`; outside
// the worker (unit/smoke harness with no `chrome`) it yields '' so the
// bridge omits the field rather than emitting an unresolvable string.
function defaultAssetUrl(path) {
    const url = globalThis.chrome?.runtime?.getURL?.(path);
    return typeof url === 'string' ? url : '';
}

/**
 * Turn a chain descriptor's `icon` (a bare branding filename such as
 * `bitcoin-mainnet-icon-20.png`) into a URL a dApp can fetch cross-origin.
 * A descriptor that already carries an absolute or data URL (e.g. a
 * user-added custom chain) is passed through untouched. Anything the
 * resolver can't turn into a string collapses to '' so getSupportedChains
 * never leaks an unresolvable bare filename.
 * @param {(path: string) => string} getAssetUrl
 * @param {unknown} icon
 * @returns {string}
 */
function resolveChainIconUrl(getAssetUrl, icon) {
    if (typeof icon !== 'string' || icon === '') return '';
    if (/^(?:https?:|data:|chrome-extension:)/i.test(icon)) return icon;
    const url = getAssetUrl(`${CHAIN_ICON_DIR}/${icon}`);
    return typeof url === 'string' ? url : '';
}

/**
 * @param {import('../background/MessageHost.js').MessageHost} host
 * @param {{
 *   approvals?: import('./Approvals.js').Approvals,
 *   signThrottle?: ReturnType<typeof createSignThrottle>,
 *   events?: typeof noopBridgeEvents,
 *   signPasswordCache?: import('./signPasswordCache.js').SignPasswordCache,
 *   getAssetUrl?: (path: string) => string,
 * }} [opts]
 */
export function registerBridgeHandlers(host, opts = {}) {
    const approvals = opts.approvals ?? rejectAllApprovals;
    const signThrottle = opts.signThrottle ?? createSignThrottle();
    const events = opts.events ?? noopBridgeEvents;
    const getAssetUrl = opts.getAssetUrl ?? defaultAssetUrl;
    // Cluster Q FOLLOWUP 3: Developer-Mode localhost auto-sign. Holds a
    // password captured by a real sign approval so a later localhost sign
    // request can reuse it instead of prompting. Lives in SW memory only;
    // see signPasswordCache.js for the security posture. A single instance is
    // shared across every sign handler registered here.
    const signPasswordCache = opts.signPasswordCache ?? createSignPasswordCache();

    // Cache the password from a genuine user approval so a subsequent
    // localhost auto-sign can reuse it. A no-op unless Developer Mode + the
    // localhost auto-sign timeout are both on (shouldAutoApproveSign), so this
    // is inert on mainnet / production and for non-localhost origins.
    const rememberSignPassword = (origin, settings, walletId, decision) => {
        if (!walletId || !decision || typeof decision.password !== 'string') return;
        if (!shouldAutoApproveSign({ origin, settings })) return;
        signPasswordCache.remember(
            walletId,
            { password: decision.password, bip39Passphrase: decision.bip39Passphrase },
            settings.autoSignLocalhostMs,
        );
    };

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
        // Read the option names bridge-spec's ConnectOpts actually publishes.
        // The handler read `chains` / `bridgeVersion`, which no spec-compliant
        // dApp sends (the inject provider forwards opts verbatim), so chain
        // preselection was silently dropped and `isBridgeVersionSupported`
        // always saw `undefined` and passed, skipping negotiation outright
        // (). Legacy names stay accepted as a fallback so in-repo
        // callers need no atomic migration.
        const requiredBridgeVersion = req.requiredBridgeVersion ?? req.bridgeVersion;
        const requestedChains = req.requestedChains ?? req.chains;
        // Cluster F FOLLOWUP 3: version negotiation. Reject the
        // connect cleanly when the dApp asks for a bridge version
        // we don't implement, instead of accepting and failing later
        // when a version-specific method gets called. The spec's own comment
        // on requiredBridgeVersion says "warns the user"; the hard reject is
        // the deliberate conservative reading and stays until product says
        // otherwise.
        if (!isBridgeVersionSupported(requiredBridgeVersion)) {
            throw bridgeError(
                'BRIDGE_VERSION_MISMATCH',
                `requested ${JSON.stringify(requiredBridgeVersion)}; supported: ${BRIDGE_SUPPORTED_VERSIONS.join(', ')}`,
            );
        }
        const { origin, appName = origin, appIcon } = req;

        const settings = await deps.vault.settings.get().catch(() => null);
        const autoConnect = shouldAutoApproveConnect({ origin, settings });

        const existing = await findConnectedSite(deps.vault, origin);
        if (existing) {
            // An auto-approved grant was never seen by the user, so it must not
            // outlive the Developer-Mode setting that created it. Once
            // auto-approve is off (or the origin no longer qualifies), drop the
            // record and make this connect earn a real prompt.
            if (existing.autoApproved === true && !autoConnect) {
                await deps.vault.connectedSites.delete(existing.id);
            } else {
                await touchLastUsed(deps.vault, existing);
                return {
                    // The wallet's own bridge version, never the request's:
                    // requiredBridgeVersion is a semver RANGE (e.g. '^0.1.0'),
                    // so echoing it back would report a range as a version.
                    version: BRIDGE_SPEC_VERSION,
                    supportedVersions: [...BRIDGE_SUPPORTED_VERSIONS],
                    chains: existing.permissions.chains,
                    accounts: existing.permissions.accounts,
                };
            }
        }

        // §48.6 / G151: Developer-Mode auto-approve for localhost. Skips the
        // connect approval prompt when settings allow + origin is localhost.
        // Sign auto-approval is a SEPARATE opt-in (settings.autoSignLocalhostMs
        // / shouldAutoApproveSign, Cluster Q FOLLOWUP 3): a sign request may
        // reuse a password captured by a prior approval, held only in
        // service-worker memory. Connect auto-approve here never grants signing
        // permissions (canSignMessage:false, canSignAction:{} below); the two
        // gates are independent.
        //
        // The granted scope is resolved from the wallet's own state and only
        // narrowed by the request (resolveAutoApproveScope), because an empty
        // chains/accounts list is a WILDCARD in this permission model, not an
        // empty grant. Falls back to the prompt when no concrete scope resolves.
        let decision = null;
        if (autoConnect) {
            const activeChainIds = filterChainIdsByActiveNetwork(
                Object.keys(settings?.fees ?? {}),
                settings,
                deps.chainRegistry,
            );
            const accountIds = (await deps.vault.accounts.list()).map((a) => a.id);
            const scope = resolveAutoApproveScope({
                requestedChains,
                requestedAccounts: req.accounts,
                activeChainIds,
                accountIds,
            });
            if (scope) {
                decision = {
                    approved: true,
                    chains: scope.chains,
                    accounts: scope.accounts,
                    canSignMessage: false,
                    canSignAction: {},
                };
            }
        }
        const autoApproved = decision !== null;
        if (!decision) {
            decision = await approvals.connect({
                origin,
                appName,
                appIcon,
                requestedChains,
                requestedAccounts: req.accounts,
            });
        }
        if (!decision || !decision.approved) {
            throw new UserRejectedError('connect');
        }
        const permissions = {
            chains: Array.isArray(decision.chains) ? decision.chains : [],
            accounts: Array.isArray(decision.accounts) ? decision.accounts : [],
            canSignMessage: decision.canSignMessage === true,
            canSignAction: decision.canSignAction ?? {},
        };
        // §43.3 reads an empty account list as a WILDCARD: getAccounts and
        // getAddresses fall back to every account, and assertAddressPermitted
        // returns "all permitted". The connect approval screen has no account
        // selector and ConnectOpts has no account field, so the prompt path
        // approved a chain and stored `accounts: []`, handing the site every
        // account and address with no account review (). Narrow an
        // empty grant to the primary account, which is exactly what
        // resolveAutoApproveScope already does on the auto-approve path and for
        // the same reason. Left empty when the vault has no accounts: there is
        // nothing to grant, and the read handlers return empty sets anyway.
        if (permissions.accounts.length === 0) {
            const [primaryAccount] = await deps.vault.accounts.list();
            if (primaryAccount) permissions.accounts = [primaryAccount.id];
        }
        const site = schemas.createConnectedSite({
            origin, appName, appIcon,
            permissions,
            autoApproved,
        });
        await deps.vault.connectedSites.put(site);
        return {
            // The wallet's own bridge version; see the existing-site return.
            version: BRIDGE_SPEC_VERSION,
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
            chainRegistry: deps.chainRegistry,
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
            // `d.icon` is a bare branding filename (e.g.
            // `bitcoin-mainnet-icon-20.png`). The extension build copies
            // these into dist/chain-icons/ and lists them under
            // web_accessible_resources, so we resolve the filename to an
            // extension-origin URL the dApp can load cross-origin. Falls
            // back to '' when no resolver is available (test harness with
            // no `chrome`) or the descriptor carries no icon.
            icon: resolveChainIconUrl(getAssetUrl, d.icon),
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
        await assertAddressPermitted(deps, site, req.chainId, req.address);
        assertNotThrottled(signThrottle, req);

        const settings = await deps.vault.settings.get().catch(() => null);
        const autoSign = shouldAutoApproveSign({ origin: req.origin, settings });
        // Resolve the signing wallet from the request address up front: it is
        // the cache key for recall AND the value we pass to the sign flow.
        const walletId = await walletIdForAddress(deps.vault, req.address);

        // Cluster Q FOLLOWUP 3: reuse a session-cached password (no prompt)
        // when Developer-Mode localhost auto-sign is on and we have a live
        // entry for this wallet. The address-permission + throttle gates above
        // still ran, so auto-sign only bypasses the password prompt, never the
        // security checks.
        if (autoSign && walletId) {
            const cached = signPasswordCache.recall(walletId);
            if (cached) {
                return invokeSignMessage(deps, {
                    ...req,
                    walletId,
                    password: cached.password,
                    bip39Passphrase: cached.bip39Passphrase,
                });
            }
        }

        // No cache hit: prompt. `alreadyGranted` tells the prompt the site
        // already holds canSignMessage so it asks for password only.
        const decision = await approvals.signMessage({
            origin: req.origin,
            kind: 'signMessage',
            chainId: req.chainId,
            payload: {
                address: req.address,
                message: req.message,
                ...(site.permissions.canSignMessage ? { alreadyGranted: true } : {}),
            },
        });
        if (!decision?.approved) throw new UserRejectedError('signMessage');
        if (!decision.password) throw bridgeError('NO_PASSWORD', 'approvals must return password');
        const signWalletId = decision.walletId ?? walletId;
        // Seed the cache from this real approval so the NEXT localhost sign
        // can auto-sign. Inert unless auto-sign is enabled.
        rememberSignPassword(req.origin, settings, signWalletId, decision);
        const result = await invokeSignMessage(deps, {
            ...req,
            walletId: signWalletId,
            password: decision.password,
            bip39Passphrase: decision.bip39Passphrase,
        });
        if (!site.permissions.canSignMessage && decision.savePermanent) {
            await updateSitePermissions(deps.vault, site, { canSignMessage: true }, { events });
        }
        return result;
    });

    register('bridge.signAction', async (req, deps) => {
        await assertNotBlocked(req, deps);
        const site = await requireSite(deps.vault, req);
        assertNotThrottled(signThrottle, req);
        const settings = await deps.vault.settings.get().catch(() => null);
        // executeSignAction owns the chain/account gate, the approval, and the
        // SEND/SWEEP flow. It is shared verbatim with bridge.parallel so the
        // per-action security invariants live in exactly one place. The
        // signPasswordCache + settings enable Developer-Mode localhost
        // auto-sign for the single-action path only (parallel passes a
        // preDecision, which suppresses auto-sign inside executeSignAction).
        return executeSignAction(req, deps, {
            approvals,
            events,
            site,
            settings,
            signPasswordCache,
            rememberSignPassword,
        });
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

    // §43.2 / §42.8.2 parallel(): the cross-chain composer batches N actions
    // into one call. The wallet presents them as one grouped approval and then
    // signs each in input order. The on-chain effect is N independent ACTIONs
    // (no atomic multi-chain settlement primitive exists), so we do not promise
    // atomicity: each entry carries its own `ok` flag and one action's refusal
    // or failure never discards the entries already collected before it.
    register('bridge.parallel', async (req, deps) => {
        await assertNotBlocked(req, deps);
        const site = await requireSite(deps.vault, req);
        // One throttle token for the whole batch (not one per action): the user
        // sees a single grouped modal, so it is one sign gesture to rate-limit.
        assertNotThrottled(signThrottle, req);

        const actions = Array.isArray(req.actions) ? req.actions : null;
        if (!actions || actions.length === 0) {
            throw bridgeError('INVALID_PARAMS', 'parallel requires a non-empty actions array');
        }
        if (actions.length > MAX_PARALLEL_ACTIONS) {
            throw bridgeError('INVALID_PARAMS', `parallel accepts at most ${MAX_PARALLEL_ACTIONS} actions per call`);
        }

        // Grouped approval: when the shell implements approvals.parallel it
        // shows ONE modal listing every action and captures the password once.
        // A rejection there rejects the entire batch (nothing is signed). The
        // returned per-action decision is threaded into executeSignAction so it
        // does not re-prompt. Shells without the grouped modal fall back to the
        // per-action approvals.signAction prompt inside executeSignAction.
        let groupDecision = null;
        if (typeof approvals.parallel === 'function') {
            groupDecision = await approvals.parallel({
                origin: req.origin,
                kind: 'parallel',
                actions: actions.map((a) => ({
                    chainId: a?.chainId,
                    action: a?.action,
                    payload: a?.params,
                })),
            });
            if (!groupDecision?.approved) throw new UserRejectedError('parallel');
            if (!groupDecision.password) {
                throw bridgeError('NO_PASSWORD', 'grouped approval must return password');
            }
        }

        const results = [];
        for (const action of actions) {
            const actionReq = {
                origin: req.origin,
                appName: req.appName,
                appIcon: req.appIcon,
                chainId: action?.chainId,
                action: action?.action,
                params: action?.params,
            };
            try {
                const raw = await executeSignAction(actionReq, deps, {
                    approvals,
                    events,
                    site,
                    // With a grouped decision, reuse it for every action so the
                    // user is not prompted N more times after approving once.
                    decision: groupDecision,
                });
                results.push(normalizeParallelResult(raw));
            } catch (err) {
                results.push({
                    ok: false,
                    error: err?.code ?? err?.name ?? 'INTERNAL_ERROR',
                    message: err?.message,
                });
            }
        }
        return results;
    });

    register('bridge.signIn', async (req, deps) => {
        await assertNotBlocked(req, deps);
        const site = await requireSite(deps.vault, req);
        assertNotThrottled(signThrottle, req);
        // Reject a separator-poisoned appId/nonce BEFORE prompting. Both arrive
        // from the page, and " | " is the challenge's reserved field delimiter,
        // so an injected pipe would smuggle pseudo-fields ahead of the
        // wallet-stamped origin. formatSignInChallenge below refuses these too;
        // checking here means the user is never asked to approve a request the
        // signer will refuse anyway ().
        for (const [field, value] of [['appId', req.appId], ['nonce', req.nonce]]) {
            if (typeof value === 'string' && value.includes(SIGN_IN_CHALLENGE_SEPARATOR)) {
                throw bridgeError('INVALID_PARAMS', `${field} contains the reserved separator`);
            }
        }
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
        //
        // The wire format is assembled by the shared formatter, never inline.
        // The inline copy this replaced had drifted twice off the one contract:
        // it skipped the reserved-separator guard, and it wrote the two
        // timestamps as ISO strings where the spec declares epoch milliseconds,
        // so parseSignInChallenge returned null for every challenge this wallet
        // has ever emitted while the mock provider's formatted output parsed
        // fine ().
        const challengeParts = {
            version: SIGN_IN_CHALLENGE_VERSION,
            appId: req.appId,
            origin: req.origin,
            address: decision.address,
            nonce,
            timestamp: now,
            expiresAt: now + expiresInMs,
        };
        let challenge;
        try {
            challenge = formatSignInChallenge(challengeParts);
        } catch (err) {
            throw bridgeError('INVALID_PARAMS', err?.message ?? 'malformed sign-in challenge');
        }

        const addr = await findAddressByString(deps.vault, decision.address, req.chainId, deps.chainRegistry);
        if (!addr) throw bridgeError('ADDRESS_NOT_FOUND', decision.address);
        const walletId = decision.walletId ?? await walletIdForAddress(deps.vault, decision.address);
        const chainId = req.chainId ?? chainIdForAddr(deps.chainRegistry, addr);
        const { signature } = await signMessageFlow({
            vault: deps.vault,
            walletId,
            password: decision.password,
            bip39Passphrase: decision.bip39Passphrase,
            chainRegistry: deps.chainRegistry,
            sdkRegistry: deps.sdkRegistry,
            chainId,
            path: addr.derivationPath ?? undefined,
            addressId: addr.derivationPath ? undefined : addr.id,
            message: challenge,
        });
        // chainId and challengeParts are declared on SignInSuccess and were
        // being dropped, so a dApp had to re-parse the string to recover fields
        // the wallet already held ().
        return { address: decision.address, chainId, signature, challenge, challengeParts };
    });
}


// Sign one bridge ACTION end to end: chain/account gate → user approval →
// SEND/SWEEP flow. Shared by bridge.signAction (single) and bridge.parallel
// (batch) so the per-action security invariants exist in exactly one place.
//
// `ctx.site` is the already-resolved ConnectedSite (the caller ran requireSite
// once). `ctx.decision`, when present, is a pre-captured approval (the grouped
// parallel modal) and skips the per-action prompt.
//
// Returns the flow result on success, or a structured
// `{ error: 'UNSUPPORTED_ACTION', ... }` for an action kind this wallet does
// not sign. Throws BridgeError / UserRejectedError on a policy refusal so the
// single-action caller propagates it and the batch caller folds it into a
// per-action result.
async function executeSignAction(req, deps, ctx) {
    const {
        approvals,
        events,
        site,
        decision: preDecision,
        settings,
        signPasswordCache,
        rememberSignPassword,
    } = ctx;
    assertChainPermitted(site, req.chainId);
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

    // bridge-spec publishes the spending address as `fromAddress` (SEND and
    // SWEEP alike); the handler read `params.from`, a name no published shape
    // carries, so the account-scope gate below was fed `undefined` and the flow
    // call was fed a key it does not accept (). Read the published name
    // first, keep the legacy one as a fallback, and accept an address record as
    // well as a plain string since in-repo callers pass both.
    const rawFrom = req.params?.fromAddress ?? req.params?.from;
    const spendFromAddress = typeof rawFrom === 'string' ? rawFrom : rawFrom?.address;

    // §43.3: enforce the per-account scope granted at connect. SEND/SWEEP
    // both spend from the source address; a site scoped to a subset of accounts
    // must not initiate a signature for an account it was never granted,
    // even though the approval prompt would also surface it.
    await assertAddressPermitted(deps, site, req.chainId, spendFromAddress);

    // The signing wallet is the one that owns the spending address. Resolve it
    // once: it keys the auto-sign cache and is the fallback walletId below.
    const walletId = await walletIdForAddress(deps.vault, spendFromAddress);

    // Published destination / asset names, mapped once here so the approval
    // screen and the flow call read the same fields. The legacy in-repo names
    // (`to`, `tick`, `amount`) stay as fallbacks; nothing in the repo sends
    // both ().
    const params = req.params ?? {};
    const toAddress = params.toAddress ?? params.to;
    const sendTick = params.asset ?? params.tick;
    // One of the published gaps is a UNIT gap, not a name gap: `amountRaw` is
    // an integer in BASE units while the flow signs a human-scale decimal
    // AMOUNT (nativePayment.satsStringFromDecimal multiplies it by 1e8 to size
    // the real output). Renamed rather than converted, the reference dApp's own
    // `{ asset: 'BTC', amountRaw: '10000' }` (0.0001 BTC) signs as 10,000 BTC.
    //
    // Converted BEFORE the approval on purpose: the screen describes whichever
    // payload the prompt below is handed, so a conversion made after it would
    // sign a magnitude the user was never shown, which is the same 1e8 swing
    // relocated rather than fixed. Only entered when the caller actually sent
    // `amountRaw`, so the legacy decimal path and the gate ordering pinned by
    // test/unit/bridge/parallel.test.js are untouched.
    const needsScale = actionName === 'SEND'
        && params.amountRaw !== undefined && params.amountRaw !== null
        && (params.amount === undefined || params.amount === null);
    // A source the vault does not hold is refused BEFORE the indexer is asked
    // to price it, so an unknown address still reports ADDRESS_NOT_FOUND rather
    // than a scale failure. Hoisted only on this path: doing it for every
    // action would move ADDRESS_NOT_FOUND ahead of USER_REJECTED and break the
    // batch gate order that same parallel.test.js pins.
    let fromSource = needsScale
        ? await requireSourceRecord(deps, req.chainId, spendFromAddress)
        : null;
    const sendAmount = needsScale
        ? await decimalAmountFromBaseUnits({
            deps,
            chainId: req.chainId,
            address: spendFromAddress,
            tick: sendTick,
            amountRaw: params.amountRaw,
        })
        : params.amount;

    // Cluster Q FOLLOWUP 3: Developer-Mode localhost auto-sign. Only for the
    // single-action path (preDecision means the grouped parallel modal already
    // captured one password for the whole batch, so we must not also auto-sign
    // per action). A cache hit builds a synthetic decision and skips the
    // prompt; the chain + account gates above already ran.
    let decision = preDecision ?? null;
    let fromCache = false;
    if (!decision
        && signPasswordCache
        && walletId
        && shouldAutoApproveSign({ origin: req.origin, settings })) {
        const cached = signPasswordCache.recall(walletId);
        if (cached) {
            decision = {
                approved: true,
                walletId,
                password: cached.password,
                bip39Passphrase: cached.bip39Passphrase,
            };
            fromCache = true;
        }
    }

    // A grouped parallel decision is reused for every action in the batch; the
    // single-action path (and the per-action fallback) prompts here.
    //
    // The payload is the PROTOCOL shape, not the request's. Everything that
    // renders this screen reads protocol keys - `decoder.describe`'s decodeSend
    // takes TICK / AMOUNT / DESTINATION (xchain-sdk describe.js:250-254),
    // simulateAction takes the same, and resolveDisplayTickers only walks
    // TICK_REF_FIELDS - so handing it the dApp's own vocabulary rendered
    // "Send ? ? to ?" with no amount and no destination on the one screen whose
    // job is to state what is being authorized. Built from the same
    // `toAddress` / `sendTick` / `sendAmount` the flow call below signs, so the
    // number on screen is the number signed (). `from` targets the
    // screen's balance-preview read at the spending address, and `requested`
    // keeps the dApp's literal params in the developer raw view; neither is a
    // protocol key and no describer renders them.
    if (!decision) {
        decision = await approvals.signAction({
            origin: req.origin,
            kind: 'signAction',
            chainId: req.chainId,
            action: actionName,
            payload: approvalPayload(actionName, {
                params, toAddress, tick: sendTick, amount: sendAmount, spendFromAddress,
            }),
        });
    }
    if (!decision?.approved) throw new UserRejectedError('signAction');
    if (!decision.password) throw bridgeError('NO_PASSWORD', 'approvals must return password');

    // savePermanent is a single-action affordance (the per-action prompt's
    // "always allow" checkbox). A reused groupDecision (parallel) never offers
    // it, and a cache-synthesized decision never sets it, so neither can
    // silently escalate a site to 'always'.
    if (!preDecision && !fromCache && decision.savePermanent) {
        await updateSitePermissions(deps.vault, site, {
            canSignAction: {
                ...site.permissions.canSignAction,
                [actionName]: 'always',
            },
        }, { events });
    }

    // Seed the cache from a fresh single-action approval so the next localhost
    // sign can auto-sign. Skipped for a parallel batch (preDecision) and for a
    // decision that itself came from the cache. Inert unless auto-sign is on.
    if (!preDecision && !fromCache && typeof rememberSignPassword === 'function') {
        rememberSignPassword(req.origin, settings, decision.walletId ?? walletId, decision);
    }

    // dApp-controlled params spread FIRST, trusted keys after: the approval
    // popup and assertChainPermitted validated req.chainId, so params must
    // never be able to override it (or the vault/password/registry deps)
    // with an unchecked value. Spread-last let params.chainId re-route the
    // signed action onto a chain the site was never permitted for.
    //
    // trackPendingTx is a trusted key for the same reason: it is not a
    // protocol param, it is an internal control flag that gates whether
    // submitAction writes the pre-spend PendingTx audit row. Left in the
    // spread, a dApp could send trackPendingTx: false and get a
    // user-approved spend that leaves no audit record and no
    // BroadcastFailedError recovery. Re-applying it after the spread
    // forces every bridge-driven spend to keep tracking on regardless of
    // what the caller sent.
    //
    // The published param vocabulary is not the flow's. bridge-spec's
    // SendActionParams / SweepActionParams carry fromAddress / toAddress /
    // asset / amountRaw as plain strings, while sendToken and sweepToken take
    // from / to / tick / amount with `from` as a resolved address record
    // (normalizeSource rejects a bare string). Forwarded unmapped, a
    // spec-compliant SEND died on "sendToken: from is required" before signing
    // (). Translate AFTER the spread so the published names win over
    // anything the caller sent under the same key. `from` is resolved from the
    // VAULT, not from the request: the flow needs a public key the dApp has
    // none of, and a caller-named source record would sidestep the lookup.
    //
    // `toAddress` / `sendTick` / `sendAmount` were resolved before the approval
    // so the screen described the same values; the vault lookup stays here
    // unless the amountRaw path already needed it, because doing it earlier for
    // every action would turn an unresolvable source into ADDRESS_NOT_FOUND
    // ahead of USER_REJECTED and break the batch gate order pinned by
    // test/unit/bridge/parallel.test.js.
    fromSource = fromSource ?? await requireSourceRecord(deps, req.chainId, spendFromAddress);
    if (actionName === 'SEND') {
        return sendToken({
            ...params,
            from: fromSource,
            to: toAddress,
            tick: sendTick,
            amount: sendAmount,
            vault: deps.vault,
            walletId: decision.walletId ?? walletId,
            password: decision.password,
            bip39Passphrase: decision.bip39Passphrase,
            chainRegistry: deps.chainRegistry,
            sdkRegistry: deps.sdkRegistry,
            chainId: req.chainId,
            trackPendingTx: true,
        });
    }
    if (actionName === 'SWEEP') {
        // SweepActionParams' optional single-asset `asset` has no consumer:
        // sweepToken empties by category flags (balances / ownerships / ...),
        // not per-asset. Mapping from/to restores the action; per-asset sweep
        // needs a core change and is deliberately left unwired here.
        return sweepToken({
            ...params,
            from: fromSource,
            to: toAddress,
            vault: deps.vault,
            walletId: decision.walletId ?? walletId,
            password: decision.password,
            bip39Passphrase: decision.bip39Passphrase,
            chainRegistry: deps.chainRegistry,
            sdkRegistry: deps.sdkRegistry,
            trackPendingTx: true,
            chainId: req.chainId,
        });
    }
    throw bridgeError('UNREACHABLE', 'supported action fell through');
}

// The vault's own record for a spending address, or ADDRESS_NOT_FOUND. The
// flow needs a public key the dApp has none of, so the source is always
// resolved from the VAULT rather than taken from the request.
async function requireSourceRecord(deps, chainId, address) {
    const source = await findAddressByString(deps.vault, address, chainId, deps.chainRegistry);
    if (!source) throw bridgeError('ADDRESS_NOT_FOUND', address ?? '');
    return source;
}

// Base-unit integer string -> plain decimal string at `divisibility` places,
// BigInt-exact (no float round-trip, no precision ceiling). The inverse of
// nativePayment.satsStringFromDecimal, which the native send path applies to
// the value this returns. Returns null for anything that is not a
// non-negative integer at a sane scale, so the caller refuses rather than
// signs a guess.
function decimalFromBaseUnits(raw, divisibility) {
    const s = String(raw).trim();
    if (!/^\d+$/.test(s)) return null;
    const d = Number(divisibility);
    if (!Number.isInteger(d) || d < 0 || d > 30) return null;
    if (d === 0) return BigInt(s).toString();
    const padded = s.padStart(d + 1, '0');
    const whole = BigInt(padded.slice(0, padded.length - d)).toString();
    const frac = padded.slice(padded.length - d).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
}

// Resolve a published `amountRaw` (base units) into the decimal AMOUNT the send
// flow signs, scaling by the ASSET's own divisibility ().
//
// The scale is read from the SPENDING address's balances, the same
// `{ native, tokens }` shape bridge.getBalances already serves: native carries
// the chain's 8-decimal scale, each token row carries the issuance `decimals`
// the explorer reports. A token the address does not hold has no row, and a
// token it does not hold cannot be sent, so "no row" and "cannot send" are the
// same set.
//
// Every failure mode refuses. A missing row, a failed balance read, an
// unparseable amount and an absurd scale all raise INVALID_PARAMS rather than
// defaulting to a divisibility, because a defaulted scale is a silent
// multiplication of the spend. The converted value is what the approval screen
// displays, so a scale that is wrong is wrong in front of the user rather than
// behind them.
async function decimalAmountFromBaseUnits({ deps, chainId, address, tick, amountRaw }) {
    const asset = typeof tick === 'string' ? tick.trim() : '';
    if (!asset) {
        throw bridgeError('INVALID_PARAMS', 'amountRaw needs an asset to scale by; none was sent');
    }
    let shape;
    try {
        shape = await addressBalances({
            sdkRegistry: deps.sdkRegistry,
            chainRegistry: deps.chainRegistry,
            chainId,
            address,
        });
    } catch (err) {
        throw bridgeError(
            'INVALID_PARAMS',
            `cannot scale amountRaw: ${asset} balance read failed (${err?.message ?? 'unknown error'})`,
        );
    }
    const same = (a) => String(a ?? '').trim().toUpperCase() === asset.toUpperCase();
    const row = same(shape?.native?.tick)
        ? shape.native
        : (Array.isArray(shape?.tokens) ? shape.tokens.find((t) => same(t?.tick)) : null);
    if (!row || row.divisibility === undefined || row.divisibility === null) {
        throw bridgeError(
            'INVALID_PARAMS',
            `cannot scale amountRaw: ${address} holds no ${asset}, so its divisibility is unknown`,
        );
    }
    const amount = decimalFromBaseUnits(amountRaw, row.divisibility);
    if (amount === null) {
        throw bridgeError(
            'INVALID_PARAMS',
            `amountRaw must be a non-negative base-unit integer for ${asset}`,
        );
    }
    return amount;
}

// The protocol-shaped params the approval screen describes, built from the same
// values the flow call signs. SEND renders TICK / AMOUNT / DESTINATION; SWEEP
// renders DESTINATION plus the category flags, defaulted exactly as
// sweepToken defaults them, so the sentence on screen matches what settles.
function approvalPayload(actionName, { params, toAddress, tick, amount, spendFromAddress }) {
    const flag = (v, dflt) => ((v ?? dflt) ? '1' : '0');
    const common = {
        DESTINATION: toAddress,
        ...(params.memo !== undefined ? { MEMO: params.memo } : {}),
        from: { address: spendFromAddress },
        requested: params,
    };
    if (actionName === 'SWEEP') {
        return {
            ...common,
            BALANCES: flag(params.balances, true),
            OWNERSHIPS: flag(params.ownerships, true),
            ORDERS: flag(params.orders, false),
            SWAPS: flag(params.swaps, false),
            DISPENSERS: flag(params.dispensers, false),
        };
    }
    return { ...common, TICK: tick, AMOUNT: amount };
}

// Normalize one executeSignAction return into a SignActionResult carrying an
// explicit `ok` flag, so a parallel() caller can branch per entry without
// re-deriving success from the presence of a txid. A structured
// `{ error }` shape (e.g. UNSUPPORTED_ACTION) becomes `ok: false`; anything
// else is a completed flow result and becomes `ok: true`.
function normalizeParallelResult(raw) {
    if (raw && typeof raw === 'object' && raw.error && raw.ok === undefined) {
        return { ok: false, ...raw };
    }
    return { ok: true, ...(raw && typeof raw === 'object' ? raw : { value: raw }) };
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

// Enforce the connect-time per-account scope for a signing address. A site
// with an empty accounts list is "all permitted" (§43.3), so this only bites
// when the site was granted a subset. Throws ADDRESS_NOT_PERMITTED when the
// address is out of scope (or unknown), matching getBalances' gate; the
// approval prompt is a second gate, not the only one.
async function assertAddressPermitted(deps, site, chainId, address) {
    const accountIds = site.permissions?.accounts ?? [];
    if (accountIds.length === 0) return;  // empty = all permitted
    if (typeof address !== 'string' || !address) {
        throw bridgeError('MISSING_ADDRESS', '');
    }
    const ok = await siteHasAddress(deps.vault, site, chainId, address, deps.chainRegistry);
    if (!ok) throw bridgeError('ADDRESS_NOT_PERMITTED', address);
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
