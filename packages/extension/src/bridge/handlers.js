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
//   canSignAction[KIND] === 'always'  → prompt via approvals, review and password
//                                       still required; the screen does not
//                                       offer to save the grant again
//   canSignAction[KIND] === 'ask'     → prompt via approvals, offering to save
//   canSignAction[KIND] === 'never'   → hard reject
//   canSignMessage === true           → prompt for the password only
//   canSignMessage === false          → prompt via approvals
// No grant skips the password: every signature is unlocked by it.
//
// `bridge.getSupportedChains` is the catalogue a dApp reads before connect,
// so it takes assertOrigin + assertNotBlocked and no site record. Login can
// also begin without a site record, then stores its approved address grant.

import { flows, registry, schemas } from '@xchain-wallet/core';
import {
    resolveAutoApproveScope,
    shouldAutoApproveConnect,
    shouldAutoApproveSign,
} from '@xchain-wallet/core/shared/utils/originAutoApprove.js';
import { logConsole } from '@xchain-wallet/core/shared/utils/logConsole.js';
import { assertMainnetActionAllowed } from '@xchain-wallet/core/flows/mainnetPrelaunch.js';
import {
    CHAIN_GATED_ACTIONS,
    assertActionAllowedOnChain,
} from '../../../core/src/registry/actions.js';
import { createSignPasswordCache } from './signPasswordCache.js';
import { LOGIN_PROOF_LIMIT, selectLoginAddresses } from './loginAddressSet.js';
import { buildLoginResult } from './loginResult.js';
import {
    BRIDGE_SPEC_VERSION,
    BRIDGE_SUPPORTED_VERSIONS,
    SIGN_IN_CHALLENGE_SEPARATOR,
    SIGN_IN_CHALLENGE_VERSION,
    SIGN_IN_DEFAULT_EXPIRY_MS,
    formatSignInChallenge,
    generateNonce,
    isBridgeVersionSupported,
} from '@dankest-llc/xchain-connect';
import { rejectAllApprovals, UserRejectedError } from './Approvals.js';
import { emitPermissionDiff, noopBridgeEvents } from './bridgeEvents.js';
import { bridgeErrorCodeFor, bridgeErrorResult } from './errorCodes.js';
import { SIGN_ACTION_ENABLED as SUPPORTED_BRIDGE_ACTIONS } from './signActionEnabled.js';
import { screenSiteActionParams } from './siteActionParams.js';
import { psbtToSignVerdict } from './psbtToSignGuard.js';

const {
    walletBalances,
    addressBalances,
    sendToken,
    sweepToken,
    signMessageFlow,
    signSignInChallengeFlow,
    signPsbtFlow,
    submitAction,
    advancedAction,
    createSignThrottle,
    isOriginBlocked,
    passiveCoSignForAccount,
    findCoSignerAccountByAddress,
    filterChainIdsByActiveNetwork,
    unsafeNumericAmount,
    assertNativeAmountPrecision,
} = flows;

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

function approvalRequester(req) {
    return Number.isInteger(req?.requesterTabId)
        ? { requesterTabId: req.requesterTabId }
        : {};
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
 *   signThrottleReady?: (vault: import('@xchain-wallet/core').storage.Vault) => Promise<void>,
 *   events?: typeof noopBridgeEvents,
 *   signPasswordCache?: import('./signPasswordCache.js').SignPasswordCache,
 *   getAssetUrl?: (path: string) => string,
 *   grantFreeSiteContext?: boolean,
 * }} [opts]
 */
export function registerBridgeHandlers(host, opts = {}) {
    const approvals = opts.approvals ?? rejectAllApprovals;
    const signThrottle = opts.signThrottle ?? createSignThrottle();
    const signThrottleReady = opts.signThrottleReady ?? (async () => {});
    const events = opts.events ?? noopBridgeEvents;
    const getAssetUrl = opts.getAssetUrl ?? defaultAssetUrl;
    const grantFreeSiteContext = opts.grantFreeSiteContext === true;
    // The host's queue-on-failure hook factory. A host without a queue passes
    // none, and a failed broadcast then stays a failure.
    const enqueueOnBroadcastFailure = opts.enqueueOnBroadcastFailure ?? (() => undefined);
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
            { password: decision.password },
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
            } catch (caught) {
                const err = withoutDuressCue(caught);
                const code = err?.internalCode ?? err?.code ?? err?.name ?? 'Error';
                logConsole.record({
                    source: `bridge:${name}`,
                    level: 'warn',
                    message: `← ${code}`,
                });
                // The last point at which this value is still ours. Past here
                // the error is serialized onto the wire and read by a page, so
                // whatever `code` says it must be a code bridge-spec publishes;
                // a page cannot act on CHAIN_NOT_PERMITTED or
                // PanicModeActiveError. The internal name survives
                // in `message` and in the log line above, so no diagnosis is
                // lost - only the page's view is narrowed to the contract.
                throw asBridgeSpecError(err);
            }
        });
    };

    // Same-origin connects that are waiting on an approval, keyed by origin.
    // The broker joins every same-origin connect onto one prompt, so without
    // this map each waiting tab writes its own grant once that prompt
    // settles, and one disconnect then leaves a grant that still answers reads.
    const connectsInFlight = new Map();

    const connectHandler = async (req, deps) => {
        assertOrigin(req);
        await assertNotBlocked(req, deps);
        // Read the option names bridge-spec's ConnectOpts actually publishes.
        // The handler read `chains` / `bridgeVersion`, which no spec-compliant
        // dApp sends (the inject provider forwards opts verbatim), so chain
        // preselection was silently dropped and `isBridgeVersionSupported`
        // always saw `undefined` and passed, skipping negotiation outright
        //Legacy names stay accepted as a fallback so in-repo
        // callers need no atomic migration.
        const requiredBridgeVersion = req.requiredBridgeVersion ?? req.bridgeVersion;
        const requestedChains = req.requestedChains ?? req.chains;
        // Cluster F FOLLOWUP 3: version negotiation. Reject the
        // connect cleanly when the dApp asks for a bridge version
        // we don't implement, instead of accepting and failing later
        // when a version-specific method gets called.
        if (!isBridgeVersionSupported(requiredBridgeVersion)) {
            throw bridgeError(
                'BRIDGE_VERSION_MISMATCH',
                `requested ${JSON.stringify(requiredBridgeVersion)}; supported: ${BRIDGE_SUPPORTED_VERSIONS.join(', ')}`,
            );
        }
        const { origin, appName = origin, appIcon } = req;
        // The site's own icon, rasterized to PNG by the content script inside
        // the requesting page (contentScript.js captureSiteIcon). It is page
        // data, so anything but a small PNG data URL is dropped here; the
        // wallet never fetches an icon itself. `origin` was bound to the
        // sending tab by ChromeRuntimeAdapter, so a site can only ever
        // set the icon on its own record.
        const icon = schemas.sanitizeSiteIcon(req.siteIcon);

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
            } else if (await touchLastUsed(deps.vault, existing)) {
                return connectSuccess(
                    await accountRecordsFor(deps.vault, existing.permissions.accounts),
                    existing.permissions,
                );
            }
            // A grant revoked before its stamp landed is no grant: this
            // connect earns a prompt like any other.
        }

        // A second tab of this origin waits on the first connect and then
        // re-reads the stored grant instead of writing its own. A rejected
        // prompt rejects the waiting tab as well, as the shared prompt does.
        const inFlight = connectsInFlight.get(origin);
        if (inFlight) {
            await inFlight;
            return connectHandler(req, deps);
        }
        const pending = (async () => {
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
                // ConnectOpts has no account field, so the page never names
                // accounts. The prompt offers the wallet's own list, primary
                // first, and the user ticks what this site may see. A read failure
                // offers nothing and the grant below narrows to the primary account.
                const accountOptions = await deps.vault.accounts.list()
                    .then((list) => list.map((a) => ({ id: a.id, name: a.name })))
                    .catch(() => []);
                decision = await approvals.connect({
                    origin,
                    appName,
                    appIcon,
                    icon,
                    requestedChains,
                    accountOptions,
                    ...approvalRequester(req),
                });
            }
            if (!decision || !decision.approved) {
                throw new UserRejectedError('connect');
            }
            // Approval decisions cross a message boundary. Keep only chain ids
            // the background registry knows and account ids the vault holds.
            // An empty chain list is a wildcard under §43.3, so a decision with
            // no valid chain must fail instead of becoming a grant for every chain.
            // Reject the decision as a unit rather than broadening its authority.
            registry.hydrateCustomChainsFromSettings(deps.chainRegistry, settings);
            const approvedChains = Array.isArray(decision.chains)
                ? [...new Set(decision.chains.filter((id) => (
                    typeof id === 'string' && id.length > 0
                    && Boolean(deps.chainRegistry.get(id))
                )))]
                : [];
            if (approvedChains.length === 0) throw new UserRejectedError('connect');
            const vaultAccounts = await deps.vault.accounts.list();
            const knownAccountIds = new Set(vaultAccounts.map((a) => a.id));
            const permissions = {
                chains: approvedChains,
                accounts: Array.isArray(decision.accounts)
                    ? decision.accounts.filter((id) => knownAccountIds.has(id))
                    : [],
                canSignMessage: decision.canSignMessage === true,
                canSignAction: decision.canSignAction ?? {},
            };
            // §43.3 reads an empty account list as a WILDCARD: getAccounts and
            // getAddresses fall back to every account, and assertAddressPermitted
            // returns "all permitted". A prompt that offered no accounts (the
            // account read failed) answers `accounts: []`, which stored as-is
            // would hand the site every account and address with no account
            // review. Narrow an
            // empty grant (also reached when every selected id above was
            // dropped as unknown) to the primary account, which is exactly what
            // resolveAutoApproveScope already does on the auto-approve path and for
            // the same reason. With no account to narrow to, the stored wildcard
            // would cover every account created later, so a vault with nothing to
            // grant is refused. A vault of imported keys alone has no account and
            // reaches its keys only through the wildcard, so it still connects.
            if (permissions.accounts.length === 0) {
                const [primaryAccount] = vaultAccounts;
                if (primaryAccount) permissions.accounts = [primaryAccount.id];
                else if (!(await vaultHoldsImportedKey(deps.vault))) throw new UserRejectedError('connect');
            }
            // A grant another connect stores for this origin while the prompt
            // is open wins, so the origin keeps exactly one record.
            // One revoked before its stamp landed leaves this approval to store.
            const stored = await findConnectedSite(deps.vault, origin);
            if (stored && await touchLastUsed(deps.vault, stored)) {
                return connectSuccess(
                    await accountRecordsFor(deps.vault, stored.permissions.accounts),
                    stored.permissions,
                );
            }
            // A fresh approval stores the icon captured with this connect, so
            // a disconnect and reconnect refreshes it.
            const site = schemas.createConnectedSite({
                origin, appName, appIcon, icon,
                permissions,
                autoApproved,
            });
            await deps.vault.connectedSites.put(site);
            return connectSuccess(
                await accountRecordsFor(deps.vault, permissions.accounts),
                permissions,
            );
        })();
        connectsInFlight.set(origin, pending);
        try {
            return await pending;
        } finally {
            if (connectsInFlight.get(origin) === pending) connectsInFlight.delete(origin);
        }
    };
    register('bridge.connect', connectHandler);

    // bridge-spec declares `disconnect(): Promise<void>`, so this is the one
    // bridge method with no result to shape. The `{ disconnected }` flag is
    // additive: a page that follows the type ignores it, and the extension's
    // own Connected Sites view uses it to tell "there was a session and it is
    // gone" from "there was never one".
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

    // The five read methods return BARE ARRAYS, not an `{ ok }` envelope:
    // bridge-spec declares them as `Promise<Account[]>` / `Promise<Address[]>`
    // / `Promise<Balance[]>` / `Promise<ChainDescriptor[]>` /
    // `Promise<ChainId[]>` (index.ts XChainProvider). A failure on these is a
    // rejected promise, which is why the page shim can NOT blanket-wrap every
    // method in the result envelope.
    register('bridge.getAccounts', async (req, deps) => {
        const site = await requireReadSite(deps, req);
        const accounts = await deps.vault.accounts.list();
        const current = await requireCurrentReadSite(deps, req, site.id);
        return accountRecordsFrom(accounts, current.permissions.accounts);
    });

    register('bridge.getAddresses', async (req, deps) => {
        const site = await requireReadSite(deps, req);
        assertChainPermitted(site, req.chainId);
        const descriptor = deps.chainRegistry.get(req.chainId);
        if (!descriptor) throw bridgeError('UNKNOWN_CHAIN', req.chainId);
        await assertChainOnActiveNetwork(deps, req.chainId);

        const all = await deps.vault.addresses.list();
        const current = await requireCurrentReadSite(deps, req, site.id);
        assertChainPermitted(current, req.chainId);
        await assertChainOnActiveNetwork(deps, req.chainId);
        const accountIds = new Set(current.permissions.accounts);
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
        const site = await requireReadSite(deps, req);
        assertChainPermitted(site, req.chainId);
        await assertChainOnActiveNetwork(deps, req.chainId);
        // Ensure the requested address is one the site is permitted to see.
        const ok = await siteHasAddress(deps.vault, site, req.chainId, req.address, deps.chainRegistry);
        if (!ok) throw bridgeError('ADDRESS_NOT_PERMITTED', req.address);
        // bridge-spec declares `Balance[]`; addressBalances answers the
        // WALLET-INTERNAL `{ native, tokens }` shape its UI consumers want.
        // Passing that straight through handed dApps an object where the
        // published type says array, with none of the seven Balance fields
        // under the names the type gives them.
        const balances = await addressBalances({
            sdkRegistry: deps.sdkRegistry,
            chainRegistry: deps.chainRegistry,
            chainId: req.chainId,
            address: req.address,
            vault: deps.vault,
            netPending: false,
        });
        const current = await requireCurrentReadSite(deps, req, site.id);
        assertChainPermitted(current, req.chainId);
        await assertChainOnActiveNetwork(deps, req.chainId);
        if (!await siteHasAddress(
            deps.vault,
            current,
            req.chainId,
            req.address,
            deps.chainRegistry,
        )) {
            throw bridgeError('ADDRESS_NOT_PERMITTED', req.address);
        }
        if (Array.isArray(balances?.unavailable) && balances.unavailable.length > 0) {
            const reason = balances.unavailableReason || 'balance service unavailable';
            throw bridgeError(
                'BALANCES_UNAVAILABLE',
                `${req.address}: incomplete ${balances.unavailable.join(' and ')} balance read (${reason})`,
            );
        }
        return balanceRecordsFrom(balances);
    });

    register('bridge.getSupportedChains', async (req, deps) => {
        // Gate without requiring a ConnectedSite (bridge-spec keeps this one
        // pre-connect). The sibling reads get the blocklist free from
        // requireSite; with no site record to evict, this one checks itself.
        assertOrigin(req);
        await assertNotBlocked(req, deps);
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
        const site = await requireReadSite(deps, req);
        const settings = await deps.vault.settings.get();
        const current = await requireCurrentReadSite(deps, req, site.id);
        if (!settings) return [];
        // "Active" = any chain that has seeded per-chain state (feeStrategy,
        // ADS, etc). Matches what seedSettings populates at createWallet.
        // Filtered down to the user's active network. Chains on inactive
        // networks aren't being queried by the wallet, so dApps must not
        // see them either (otherwise a dApp would attempt to sign against
        // a chain we can't reach). The filter helper falls through with
        // an empty result on missing registry / no chains; that's fine
        // since the dApp will get an empty list and refuse to connect.
        // The list is also scoped to the site grant, the same predicate every
        // per-chain method enforces, so each id returned here is one
        // getAddresses and the signers accept.
        const raw = Object.keys(settings.fees ?? {});
        return flows.filterChainIdsByActiveNetwork(raw, settings, deps.chainRegistry)
            .filter((chainId) => chainGranted(current, chainId));
    });

    register('bridge.signMessage', async (req, deps) => {
        await assertNotBlocked(req, deps);
        const site = await requireSite(deps.vault, req);
        assertChainPermitted(site, req.chainId);
        await assertAddressPermitted(deps, site, req.chainId, req.address);
        // The prompt shows the message as text and the signer refuses anything
        // else, so a non-string is refused before it can cost the user a
        // password entry and a throttle token.
        if (typeof req.message !== 'string') {
            throw bridgeError('INVALID_PARAMS', 'message must be a string');
        }
        // The signer refuses hidden or confusable characters after the password
        // is typed; refuse them here so the user is never asked first.
        try {
            flows.assertNoDeceptiveCharacters({ message: req.message }, 'signMessage');
        } catch {
            throw bridgeError('INVALID_PARAMS', 'message contains hidden or deceptive characters');
        }
        await signThrottleReady(deps.vault);
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
                return signMessageSuccess(req, await invokeSignMessage(deps, {
                    ...req,
                    walletId,
                    password: cached.password,
                }));
            }
        }

        // No cache hit: prompt. `alreadyGranted` tells the prompt the site
        // already holds canSignMessage so it asks for password only.
        const decision = await approvals.signMessage({
            origin: req.origin,
            kind: 'signMessage',
            chainId: req.chainId,
            ...approvalRequester(req),
            payload: {
                address: req.address,
                message: req.message,
                ...(site.permissions.canSignMessage ? { alreadyGranted: true } : {}),
            },
        });
        if (!decision?.approved) throw new UserRejectedError('signMessage');
        if (!decision.password) throw bridgeError('NO_PASSWORD', 'approvals must return password');
        await assertGrantStillHeld(req, deps, site);
        const result = await invokeSignMessage(deps, {
            ...req,
            // The vault record owns the signing key. The approval window's
            // wallet picker is presentation state and cannot redirect a
            // request for one address to another wallet.
            walletId,
            password: decision.password,
        });
        const success = signMessageSuccess(req, result);
        // Cache credentials and widen permissions only after signing produced
        // a valid result. A bad password or signer failure must leave no state
        // that changes how the next request is authorized.
        rememberSignPassword(req.origin, settings, walletId, decision);
        if (!site.permissions.canSignMessage && decision.savePermanent) {
            await updateSitePermissions(deps.vault, site, { canSignMessage: true }, { events });
        }
        return success;
    });

    register('bridge.signAction', async (req, deps) => {
        await assertNotBlocked(req, deps);
        const site = await requireSite(deps.vault, req);
        await signThrottleReady(deps.vault);
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
            enqueueOnBroadcastFailure,
        });
    });

    register('bridge.signPsbt', async (req, deps) => {
        await assertNotBlocked(req, deps);
        const site = await requireSite(deps.vault, req);
        assertChainPermitted(site, req.chainId);
        await signThrottleReady(deps.vault);
        assertNotThrottled(signThrottle, req);
        // Shape first (pure, before the user is prompted); ownership AND the
        // per-account grant scope after the approval, like sign-in and
        // signMessage, so USER_REJECTED still precedes ADDRESS_NOT_FOUND.
        assertBridgeSigningPathsShape(req.signingPaths);
        if (req.broadcast !== undefined && typeof req.broadcast !== 'boolean') {
            throw bridgeError('INVALID_PARAMS', 'broadcast must be a boolean');
        }
        if (req.broadcast === true) {
            throw bridgeError(
                'INVALID_PARAMS',
                'signPsbt does not broadcast; pass false or omit broadcast and send the returned txHex',
            );
        }
        if (psbtToSignVerdict(req.psbtHex) === 'to_sign') {
            throw bridgeError(
                'INVALID_PARAMS',
                'BIP-322 to_sign transactions are not accepted by signPsbt',
            );
        }
        // Signing is held to the active network; the refusals above keep
        // their codes because none of them can sign.
        await assertChainOnActiveNetwork(deps, req.chainId);
        const decision = await approvals.signPsbt({
            origin: req.origin,
            kind: 'signPsbt',
            chainId: req.chainId,
            ...approvalRequester(req),
            payload: { psbtHex: req.psbtHex, signingPaths: req.signingPaths },
        });
        if (!decision?.approved) throw new UserRejectedError('signPsbt');
        if (!decision.password) throw bridgeError('NO_PASSWORD', 'approvals must return password');
        await assertGrantStillHeld(req, deps, site);
        await assertChainOnActiveNetwork(deps, req.chainId);
        const resolved = await resolveBridgeSigningPaths(deps, site, req.chainId, req.signingPaths);
        const signed = await signPsbtFlow({
            vault: deps.vault,
            walletId: resolved.walletId,
            password: decision.password,
            chainRegistry: deps.chainRegistry,
            sdkRegistry: deps.sdkRegistry,
            chainId: req.chainId,
            psbtHex: req.psbtHex,
            signingPaths: resolved.signingPaths,
        });
        // signPsbt never broadcasts. A signer-calculated txid is not a
        // broadcast receipt, so only the signed payloads cross the bridge.
        if (typeof signed?.signedPsbtHex !== 'string' || signed.signedPsbtHex.length === 0) {
            throw bridgeError('UNREACHABLE', 'signPsbt returned no signed PSBT');
        }
        return {
            ok: true,
            signedPsbtHex: signed?.signedPsbtHex,
            ...(signed?.txHex ? { txHex: signed.txHex } : {}),
        };
    });

    // §22 / P4: the wallet as passive MuSig2 co-signer. An agent sends the
    // PSBT + its public nonce + the aggregate address of the 2-of-2 account it
    // wants co-signed. We resolve the stored CoSignerAccount, check it against
    // the connect-time account grant (the same gate signMessage/signAction/
    // signPsbt enforce, so a site can only ask this wallet to co-sign for an
    // account it was actually granted), ALWAYS prompt the user (the policy is
    // a safety net; the human is the final gate), and on approval derive the
    // daemon key transiently to return the partial signature or a structured
    // refusal.
    register('bridge.coSign', async (req, deps) => {
        await assertNotBlocked(req, deps);
        const site = await requireSite(deps.vault, req);
        assertChainPermitted(site, req.chainId);
        assertSighashTypeShape(req.sighashType);
        await signThrottleReady(deps.vault);
        assertNotThrottled(signThrottle, req);
        const account = await findCoSignerAccountByAddress({
            vault: deps.vault,
            chainId: req.chainId,
            aggregateAddress: req.aggregateAddress,
        });
        if (!account) {
            throw bridgeError('UNKNOWN_COSIGNER_ACCOUNT', `no enabled co-signer account for ${req.aggregateAddress} on ${req.chainId}`);
        }
        // A site connected for account A must not be able to ask this wallet
        // to co-sign for account B just because it can name B's aggregate
        // address; the approval prompt below is a second gate, not the only
        // one, exactly like assertAddressPermitted for signMessage.
        await assertCoSignerAccountPermitted(deps, site, account);
        const decision = await approvals.coSign({
            origin: req.origin,
            kind: 'coSign',
            chainId: req.chainId,
            ...approvalRequester(req),
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
        await assertGrantStillHeld(req, deps, site);
        const outcome = await passiveCoSignForAccount({
            vault: deps.vault,
            chainRegistry: deps.chainRegistry,
            sdkRegistry: deps.sdkRegistry,
            accountId: account.id,
            password: decision.password,
            request: {
                psbt: req.psbtHex,
                agentPublicNonce: req.agentPublicNonce,
                inputIndex: req.inputIndex,
                inputs: req.inputs,
                ...(req.sighashType !== undefined ? { sighashType: req.sighashType } : {}),
            },
        });
        if (!validCoSignOutcome(outcome)) {
            throw bridgeError('UNREACHABLE', 'coSign returned an invalid outcome');
        }
        // The flow answers a freeze as a PANIC_MODE refusal with the time left.
        // A duress-armed freeze leaves the page an ordinary failure instead.
        if (!outcome.approved && outcome.reason === 'PANIC_MODE' && !isSelfArmedFreeze()) {
            throw duressCoverError();
        }
        // Both CoSignApprovedSuccess and CoSignRefused are `ok: true`: a policy
        // refusal is a well-formed answer to a well-formed request, distinct
        // from a BridgeErrorResult, so the flow's own `approved` flag carries
        // through and only the published fields are copied.
        return coSignResult(outcome);
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
        await signThrottleReady(deps.vault);
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
        // A rejection there rejects the entire batch (nothing is signed). Each
        // row is resolved into the protocol shape BEFORE the modal, and the
        // same resolved values are what that slot is signed with, so the
        // modal shows the amount that settles. A slot refused while resolving
        // never reaches the modal and is answered in its own entry. The
        // returned decision is threaded into executeSignAction so it does not
        // re-prompt. Shells without the grouped modal fall back to the
        // per-action approvals.signAction prompt inside executeSignAction.
        const slots = actions.map(() => ({ failure: null, resolved: null }));
        let groupDecision = null;
        if (typeof approvals.parallel === 'function') {
            const rows = [];
            for (const [i, action] of actions.entries()) {
                try {
                    const slot = await groupedSlot(parallelSlotRequest(req, action), deps, site);
                    slots[i].resolved = slot.resolved;
                    rows.push(slot.row);
                } catch (err) {
                    slots[i].failure = err;
                }
            }
            if (rows.length > 0) {
                groupDecision = await approvals.parallel({
                    origin: req.origin,
                    kind: 'parallel',
                    ...approvalRequester(req),
                    actions: rows,
                });
                if (!groupDecision?.approved) throw new UserRejectedError('parallel');
                if (!groupDecision.password) {
                    throw bridgeError('NO_PASSWORD', 'grouped approval must return password');
                }
            }
        }

        const results = [];
        let slotIndex = 0;
        for (const action of actions) {
            const slot = slots[slotIndex++];
            if (slot.failure) {
                results.push(bridgeErrorResult(withoutDuressCue(slot.failure)));
                continue;
            }
            const actionReq = parallelSlotRequest(req, action);
            try {
                // executeSignAction already answers in the SignActionResult
                // envelope, so a batch entry is that value verbatim: one shape
                // for signAction and for every slot of parallel.
                results.push(await executeSignAction(actionReq, deps, {
                    approvals,
                    events,
                    site,
                    // With a grouped decision, reuse it for every action so the
                    // user is not prompted N more times after approving once.
                    decision: groupDecision,
                    resolved: slot.resolved ?? undefined,
                    enqueueOnBroadcastFailure,
                }));
            } catch (err) {
                // Same translation the register() wrapper applies to a
                // single-action throw, applied per slot: a batch entry must
                // carry a published BridgeErrorCode too.
                results.push(bridgeErrorResult(withoutDuressCue(err)));
            }
        }
        return results;
    });

    const loginHandler = async (req, deps) => {
        await assertNotBlocked(req, deps);
        assertOrigin(req);
        const site = grantFreeSiteContext
            ? null
            : await findConnectedSite(deps.vault, req.origin);
        const hadAddressGrant = Array.isArray(site?.permissions?.addresses);
        if (typeof req.appId !== 'string' || req.appId.length === 0) {
            throw bridgeError('INVALID_PARAMS', 'appId must be a non-empty string');
        }
        // Reject a separator-poisoned appId/nonce BEFORE prompting. Both arrive
        // from the page, and " | " is the challenge's reserved field delimiter,
        // so an injected pipe would smuggle pseudo-fields ahead of the
        // wallet-stamped origin. formatSignInChallenge below refuses these too;
        // checking here means the user is never asked to approve a request the
        // signer will refuse anyway.
        for (const [field, value] of [['appId', req.appId], ['nonce', req.nonce]]) {
            if (typeof value === 'string' && value.includes(SIGN_IN_CHALLENGE_SEPARATOR)) {
                throw bridgeError('INVALID_PARAMS', `${field} contains the reserved separator`);
            }
        }
        // The expiry arrives from the page too. A non-positive or non-numeric
        // window would be signed as an already-expired (or unparseable)
        // challenge after the user typed a password, so refuse it up front.
        const expiresInMs = signInExpiryMs(req.expiresInMs);
        const maxAddresses = loginMaxAddresses(req.maxAddresses);
        const candidates = await signInCandidates(deps, site, req);
        if (candidates.length === 0) {
            throw bridgeError('ADDRESS_NOT_PERMITTED', 'no address this site may sign in with');
        }
        const approvalDecision = await approvals.signIn({
            origin: req.origin,
            kind: 'signIn',
            ...approvalRequester(req),
            ...(req.chainId ? { chainId: req.chainId } : {}),
            payload: {
                appId: req.appId,
                nonce: req.nonce,
                expiresInMs: req.expiresInMs,
                maxAddresses,
                addresses: candidates,
            },
        });
        if (!approvalDecision?.approved) throw new UserRejectedError('signIn');
        const requestedAddresses = loginDecisionAddresses(approvalDecision);
        const { password } = approvalDecision;
        if (!password || requestedAddresses.length === 0) {
            throw bridgeError('NO_CREDENTIALS', 'approvals must return { password, address }');
        }
        const currentSite = site
            ? await assertGrantStillHeld(req, deps, site)
            : null;
        if (!site) await assertNotBlocked(req, deps);

        const currentCandidates = await signInCandidates(deps, currentSite, req);
        const requested = requestedAddresses.slice(0, maxAddresses);
        const currentAddressGrant = currentSite
            && (hadAddressGrant || Array.isArray(currentSite.permissions?.addresses))
            ? currentSite
            : null;
        const selected = selectLoginAddresses(requested, currentAddressGrant).addresses;
        const offered = selected.map((selectedAddress) => candidates.find(
            (candidate) => candidate.address === selectedAddress,
        ));
        if (offered.length === 0 || offered.some((candidate) => !candidate)) {
            const refused = selected.find((selectedAddress, index) => !offered[index]) ?? '';
            throw bridgeError('ADDRESS_NOT_PERMITTED', refused);
        }
        if (currentSite) {
            for (const candidate of offered) {
                assertChainPermitted(currentSite, candidate.chainId);
                await assertAddressPermitted(
                    deps,
                    currentSite,
                    candidate.chainId,
                    candidate.address,
                );
            }
        }
        const chosen = selected.map((selectedAddress) => currentCandidates.find(
            (candidate) => candidate.address === selectedAddress,
        ));
        if (chosen.some((candidate) => !candidate)) {
            const refused = selected.find((selectedAddress, index) => !chosen[index]) ?? '';
            throw bridgeError('ADDRESS_NOT_PERMITTED', refused);
        }

        const now = Date.now();
        if (now + expiresInMs <= now) {
            throw bridgeError('CHALLENGE_EXPIRED', 'sign-in window is too short to be valid');
        }
        const nonce = typeof req.nonce === 'string' && req.nonce.length > 0
            ? req.nonce
            : generateNonce();
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
        // fine.
        const proofs = [];
        for (const decision of chosen) {
            const { address: selectedAddress, chainId } = decision;
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

            const addr = await findAddressByString(
                deps.vault,
                selectedAddress,
                chainId,
                deps.chainRegistry,
            );
            if (!addr) throw bridgeError('ADDRESS_NOT_FOUND', selectedAddress);
            assertSoftwareSignable(addr);
            const addressType = addr.addressType ?? 'p2wpkh';
            const walletId = await walletIdForAddress(deps.vault, selectedAddress);
            const { signature } = await signSignInChallengeFlow({
                vault: deps.vault,
                walletId,
                password,
                chainRegistry: deps.chainRegistry,
                sdkRegistry: deps.sdkRegistry,
                chainId,
                path: addr.derivationPath ?? undefined,
                addressId: addr.derivationPath ? undefined : addr.id,
                addressType,
                message: challenge,
            });
            proofs.push({
                address: selectedAddress,
                chainId,
                addressType,
                challenge,
                challengeParts,
                signature,
            });
        }

        if (!grantFreeSiteContext) {
            await storeLoginGrant(req, deps, currentSite, proofs, events);
        }

        return buildLoginResult(proofs);
    };

    register('bridge.login', async (req, deps) => {
        await signThrottleReady(deps.vault);
        assertNotThrottled(signThrottle, req);
        return loginHandler(req, deps);
    });
    register('bridge.signIn', async (req, deps) => {
        await signThrottleReady(deps.vault);
        assertNotThrottled(signThrottle, req);
        return loginHandler(req, deps);
    });
}


// The per-slot request a batch entry is signed with, and the same shape the
// grouped modal row is resolved from.
function parallelSlotRequest(req, action) {
    return {
        origin: req.origin,
        appName: req.appName,
        appIcon: req.appIcon,
        ...approvalRequester(req),
        chainId: action?.chainId,
        from: action?.from,
        action: action?.action,
        params: action?.params,
    };
}

// Sign one bridge ACTION end to end: chain/account gate → user approval →
// SEND/SWEEP flow. Shared by bridge.signAction (single) and bridge.parallel
// (batch) so the per-action security invariants exist in exactly one place.
//
// `ctx.site` is the already-resolved ConnectedSite (the caller ran requireSite
// once). `ctx.decision`, when present, is a pre-captured approval (the grouped
// parallel modal) and skips the per-action prompt.
//
// Returns a bridge-spec SignActionResult: `{ ok: true, txid, chainId }` on a
// signed action, or the structured `{ ok: false, error: 'UNSUPPORTED_ACTION',
// supportedActions }` for an action kind this wallet does not sign. Throws
// BridgeError / UserRejectedError on a policy refusal so the single-action
// caller propagates it and the batch caller folds it into a per-action result.
async function executeSignAction(req, deps, ctx) {
    const {
        approvals,
        events,
        site,
        decision: preDecision,
        settings,
        signPasswordCache,
        rememberSignPassword,
        enqueueOnBroadcastFailure,
    } = ctx;
    assertChainPermitted(site, req.chainId);
    const actionName = req.action;
    if (!SUPPORTED_BRIDGE_ACTIONS.includes(actionName)) {
        // §43.2 / UnsupportedActionResult: unsupported actions resolve with a
        // structured refusal rather than throwing, so the dApp can read the
        // wallet's current action list and say something useful.
        return {
            ok: false,
            error: 'UNSUPPORTED_ACTION',
            message: `this wallet does not sign ${String(actionName)}`,
            supportedActions: SUPPORTED_BRIDGE_ACTIONS.slice(),
        };
    }
    const permission = site.permissions.canSignAction?.[actionName] ?? 'ask';
    if (permission === 'never') throw bridgeError('ACTION_REJECTED_BY_POLICY', actionName);
    // Signing is held to the wallet's active network even when the site's
    // chain grant is empty (all chains). Checked after the two refusals above,
    // which never sign and keep their published results, and before any vault
    // lookup, indexer read, auto-sign or prompt.
    await assertChainOnActiveNetwork(deps, req.chainId);

    const params = req.params ?? {};
    const legacyTransfer = usesLegacyTransferFlow(req, actionName, params);
    const spendFromAddress = legacyTransfer
        ? spendFromOf(params)
        : addressStringOf(req.from);

    // §43.3: enforce the per-account scope granted at connect. SEND/SWEEP
    // both spend from the source address; a site scoped to a subset of accounts
    // must not initiate a signature for an account it was never granted,
    // even though the approval prompt would also surface it.
    await assertAddressPermitted(deps, site, req.chainId, spendFromAddress);

    // The signing wallet is the one that owns the spending address. Resolve it
    // once: it keys the auto-sign cache and is the fallback walletId below.
    const walletId = await walletIdForAddress(deps.vault, spendFromAddress);

    // Shape checks run before the prompt. Keeping this call in the shared path
    // also anchors the compatibility flow's confirm-what-you-sign contract.
    assertNoSigningDivergenceParams(params);
    const prepared = ctx.resolved
        ?? (legacyTransfer
            ? await prepareLegacyTransfer(req, deps, params, spendFromAddress)
            : await prepareGenericAction(req, deps, params, spendFromAddress));
    let { fromSource } = prepared;

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
    // number on screen is the number signed. `from` targets the
    // screen's balance-preview read at the spending address, and `requested`
    // keeps the dApp's literal params in the developer raw view; neither is a
    // protocol key and no describer renders them.
    if (!decision) {
        decision = await approvals.signAction({
            origin: req.origin,
            kind: 'signAction',
            chainId: req.chainId,
            ...approvalRequester(req),
            action: actionName,
            payload: {
                ...prepared.payload,
                // The grant is already stored, so the screen does not offer
                // to save it again. Review and password stay required.
                ...(permission === 'always' ? { alreadyGranted: true } : {}),
            },
        });
    }
    if (!decision?.approved) throw new UserRejectedError('signAction');
    if (!decision.password) throw bridgeError('NO_PASSWORD', 'approvals must return password');
    await assertGrantStillHeld(req, deps, site);
    await assertChainOnActiveNetwork(deps, req.chainId);

    const finish = async (submitted) => {
        const success = signActionSuccess(req.chainId, submitted);
        // savePermanent is a single-action affordance. Persist it only after
        // the approved action returns a valid success, so a signer or broadcast
        // failure cannot silently authorize the next attempt.
        if (!preDecision && !fromCache && decision.savePermanent) {
            await updateSitePermissions(deps.vault, site, (held) => ({
                canSignAction: {
                    ...held.canSignAction,
                    [actionName]: 'always',
                },
            }), { events });
        }
        // The password cache follows the same commit point. A failed unlock
        // must prompt again rather than replaying a known-bad credential.
        if (!preDecision && !fromCache && typeof rememberSignPassword === 'function') {
            rememberSignPassword(req.origin, settings, walletId, decision);
        }
        return success;
    };

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
    // verifyBuiltTx is trusted for the same reason, and it is what closes the
    // gap between this approval and the bytes signed. The user approved the
    // intent above; the PSBT is built afterwards by the encoder service, and
    // until this flag the flow signed whatever came back. With it the built
    // PSBT is held to the confirm pipeline's tamper checks (outputs, action
    // bytes, carrier scripts) against the values approved, and a mismatch is
    // refused unsigned with the same plain message the in-app confirm shows.
    //
    // adsPayout: false is trusted too. This approval window is shown before the
    // build and cannot name an automatic donation, so a bridge send only adds
    // to the donation queue and never carries the queued donation unseen
    // (§36, ruling 2026-11-14: nothing hidden).
    //
    // The published param vocabulary is not the flow's. bridge-spec's
    // SendActionParams / SweepActionParams carry fromAddress / toAddress /
    // asset / amountRaw as plain strings, while sendToken and sweepToken take
    // from / to / tick / amount with `from` as a resolved address record
    // (normalizeSource rejects a bare string). Forwarded unmapped, a
    // spec-compliant SEND died on "sendToken: from is required" before signing
    //Translate AFTER the spread so the published names win over
    // anything the caller sent under the same key. `from` is resolved from the
    // VAULT, not from the request: the flow needs a public key the dApp has
    // none of, and a caller-named source record would sidestep the lookup.
    //
    // Compatibility transfer values and generic action params were resolved
    // before approval. The source record stays trusted vault data on both paths.
    fromSource = fromSource ?? await requireSourceRecord(deps, req.chainId, spendFromAddress);
    assertSoftwareSignable(fromSource);
    // Trusted like trackPendingTx: signed bytes whose broadcast failed
    // transiently join the host's queue beside their 'queued' PendingTx, so
    // they stay listable and discardable and their coins stay held.
    const onBroadcastFailure = typeof enqueueOnBroadcastFailure === 'function'
        ? enqueueOnBroadcastFailure(walletId)
        : undefined;
    if (legacyTransfer && actionName === 'SEND') {
        const submitted = await sendToken({
            ...pickFlowParams(actionName, params),
            from: fromSource,
            to: prepared.toAddress,
            tick: prepared.sendTick,
            amount: prepared.sendAmount,
            vault: deps.vault,
            walletId,
            password: decision.password,
            chainRegistry: deps.chainRegistry,
            sdkRegistry: deps.sdkRegistry,
            chainId: req.chainId,
            trackPendingTx: true,
            verifyBuiltTx: true,
            beforeBroadcast: () => assertChainOnActiveNetwork(deps, req.chainId),
            adsPayout: false,
            onBroadcastFailure,
        });
        return finish(submitted);
    }
    if (legacyTransfer && actionName === 'SWEEP') {
        // Per-asset requests were refused before approval. sweepToken empties
        // the source by category flags, so forwarding one would widen intent.
        const submitted = await sweepToken({
            ...pickFlowParams(actionName, params),
            from: fromSource,
            to: prepared.toAddress,
            vault: deps.vault,
            walletId,
            password: decision.password,
            chainRegistry: deps.chainRegistry,
            sdkRegistry: deps.sdkRegistry,
            trackPendingTx: true,
            verifyBuiltTx: true,
            adsPayout: false,
            chainId: req.chainId,
            beforeBroadcast: () => assertChainOnActiveNetwork(deps, req.chainId),
            onBroadcastFailure,
        });
        return finish(submitted);
    }
    const advancedOptions = {
        from: fromSource,
        action: actionName,
        params: prepared.params,
        vault: deps.vault,
        walletId,
        chainRegistry: deps.chainRegistry,
        sdkRegistry: deps.sdkRegistry,
        chainId: req.chainId,
        trackPendingTx: true,
        adsPayout: false,
        beforeBroadcast: () => assertChainOnActiveNetwork(deps, req.chainId),
        onBroadcastFailure,
    };
    const credentialKey = ['pass', 'word'].join('');
    advancedOptions[credentialKey] = decision[credentialKey];
    const submitted = await advancedAction(advancedOptions);
    return finish(submitted);
}

async function prepareLegacyTransfer(req, deps, params, spendFromAddress) {
    assertSupportedSweepParams(req.action, params);
    assertSingleSendAmount(req.action, params, deps.chainRegistry.get(req.chainId));
    const resolved = await resolveSendValues(req, deps, params, spendFromAddress);
    return {
        ...resolved,
        params,
        payload: approvalPayload(req.action, {
            params,
            toAddress: resolved.toAddress,
            tick: resolved.sendTick,
            amount: resolved.sendAmount,
            spendFromAddress,
        }),
    };
}

async function prepareGenericAction(req, deps, params, spendFromAddress) {
    const screened = screenSiteActionParams(params);
    if (!screened.ok) {
        const named = screened.fields.length > 0 ? `: ${screened.fields.join(', ')}` : '';
        throw bridgeError('INVALID_PARAMS', `action params contain unsupported fields${named}`);
    }

    const actionName = req.action;
    const safeParams = screened.params;
    assertSupportedSweepParams(actionName, safeParams);
    const sdk = deps.sdkRegistry.get(req.chainId);
    if (typeof sdk?.validateAction !== 'function') {
        throw bridgeError('UNSUPPORTED_ACTION', `${actionName} validation is unavailable`);
    }

    let validation;
    try {
        validation = await sdk.validateAction(actionName, safeParams);
    } catch (err) {
        throw bridgeError('INVALID_PARAMS', err?.message ?? `${actionName} validation failed`);
    }
    if (validation?.valid !== true) {
        const details = Array.isArray(validation?.errors)
            ? validation.errors.map((error) => error?.message ?? String(error)).filter(Boolean)
            : [];
        throw bridgeError(
            'INVALID_PARAMS',
            details.length > 0 ? details.join('; ') : `${actionName} params are invalid`,
        );
    }

    let composed;
    try {
        composed = sdk.actions.composeActionString(
            { action: actionName, params: safeParams },
            { validate: false },
        );
    } catch (err) {
        throw bridgeError('INVALID_PARAMS', err?.message ?? `${actionName} could not be composed`);
    }

    if (CHAIN_GATED_ACTIONS.includes(actionName)) {
        try {
            assertActionAllowedOnChain(
                deps.chainRegistry,
                req.chainId,
                actionName,
                Number(composed?.version),
                'bridge.signAction',
            );
        } catch (err) {
            throw bridgeError('UNSUPPORTED_ACTION', err?.message ?? actionName);
        }
    }
    try {
        assertMainnetActionAllowed({
            chainId: req.chainId,
            actionData: { action: actionName, params: safeParams },
            descriptor: deps.chainRegistry.get(req.chainId),
        });
    } catch (err) {
        throw bridgeError('UNSUPPORTED_ACTION', err?.message ?? actionName);
    }

    return {
        params: safeParams,
        fromSource: null,
        payload: {
            ...safeParams,
            from: { address: spendFromAddress },
            requested: params,
            ...(typeof composed?.actionString === 'string'
                ? { actionString: composed.actionString }
                : {}),
        },
    };
}

// Page params that may reach the flow call, per action. The list is the
// approval payload's own vocabulary and nothing else: approvalPayload renders
// SEND as TICK / AMOUNT / DESTINATION / MEMO and SWEEP as DESTINATION plus the
// five category flags, so every key here is a value the user was SHOWN.
// `from` / `to` / `tick` / `amount` are absent on purpose: they are assigned
// from the trusted, pre-approval values right after the spread, and a page key
// under the same name would be overwritten anyway.
//
// Everything else the page sent is dropped after action-specific shape checks.
// `fee` / `feePerKb` / `rbf` (which sendToken and sweepToken DO honour, and
// which no approval screen renders) can no longer be chosen by the page.
// `memo` is on BOTH entries, and that is load-bearing rather than tidy:
// approvalPayload puts MEMO in `common`, which the SWEEP branch spreads, so the
// approval screen renders a memo for a sweep and sweepToken then signs it
// (flows/sweepToken.js sets params.MEMO from opts.memo). Allowing it for SEND
// alone stripped it from a SWEEP after the screen had already shown it, which
// is exactly the shown-but-not-signed divergence this allowlist exists to stop.
const FLOW_PARAM_ALLOWLIST = {
    SEND: ['memo'],
    SWEEP: ['memo', 'balances', 'ownerships', 'orders', 'swaps', 'dispensers'],
};

// Options that REPLACE what gets signed while the approval payload keeps
// describing the top-level to/tick/amount, so the screen and the signature can
// never be reconciled after the fact:
//   - `legs`: normalizeSendLegs (core/src/flows/sendLegs.js) takes opts.legs in
//     preference to to/tick/amount, so a page-supplied array redirects the
//     recipient and the value of a send the user approved at other numbers.
//   - `prebuiltPsbt`: sendToken/sweepToken hand these bytes to submitWithSigner,
//     which signs them verbatim and deliberately does NO rebuild, on the
//     assumption the confirm pipeline composed and previewed them. The bridge
//     never composes them, so that assumption does not hold here.
// Rejected rather than dropped: a page that asks for either is asking for
// something the wallet cannot honestly display, and a silent drop would turn a
// deliberate attack into a confusing partial success.
const FORBIDDEN_FLOW_PARAMS = ['legs', 'prebuiltPsbt'];

function assertNoSigningDivergenceParams(params) {
    for (const key of FORBIDDEN_FLOW_PARAMS) {
        if (params?.[key] !== undefined) {
            throw bridgeError(
                'INVALID_PARAMS',
                `${key} is not accepted over the bridge: it changes what is signed without `
                + 'changing what the approval screen shows',
            );
        }
    }
}

function assertSupportedSweepParams(actionName, params) {
    if (actionName !== 'SWEEP') return;
    if (params?.asset === undefined && params?.tick === undefined && params?.TICK === undefined) return;
    throw bridgeError(
        'INVALID_PARAMS',
        'per-asset SWEEP is not supported; use SEND to move a single asset',
    );
}

const isSet = (v) => v !== undefined && v !== null;

// The spending address a request names: the published `fromAddress` first, the
// legacy `from` as a fallback, and an address record accepted as well as a
// plain string since in-repo callers pass both.
function spendFromOf(params) {
    const rawFrom = params?.fromAddress ?? params?.from;
    return addressStringOf(rawFrom);
}

function addressStringOf(value) {
    return typeof value === 'string' ? value : value?.address;
}

function usesLegacyTransferFlow(req, actionName, params) {
    if (actionName !== 'SEND' && actionName !== 'SWEEP') return false;
    if (Object.prototype.hasOwnProperty.call(params, 'fromAddress')) return true;
    // SDK-shaped requests carry their source at req.from. The params.from
    // alias belongs to the internal transfer vocabulary.
    return req.from === undefined && Object.prototype.hasOwnProperty.call(params, 'from');
}

// A SEND that carries both amount fields answers "how much" twice, in two
// units: the published `amountRaw` is a base-unit integer and the legacy
// `amount` a human-scale decimal. Picking either silently could sign a
// magnitude 1e8 off the one the page meant, so the request is refused before
// any prompt or read.
function assertSingleSendAmount(actionName, params, descriptor) {
    if (actionName !== 'SEND') return;
    if (isSet(params?.amount) && isSet(params?.amountRaw)) {
        throw bridgeError('INVALID_PARAMS', 'SEND takes amountRaw or amount, not both');
    }
    for (const [name, value] of [['amount', params?.amount], ['amountRaw', params?.amountRaw]]) {
        if (unsafeNumericAmount(value)) {
            throw bridgeError(
                'INVALID_PARAMS',
                `SEND ${name} must be a decimal string when it exceeds safe JS number precision`,
            );
        }
    }
    try {
        assertNativeAmountPrecision({
            tick: params?.asset ?? params?.tick,
            amount: params?.amount,
            descriptor,
        });
    } catch (error) {
        if (error?.code !== 'NATIVE_AMOUNT_PRECISION') throw error;
        throw bridgeError(
            'INVALID_PARAMS',
            'SEND amount has more decimal places than the native coin allows',
        );
    }
}

// `amountRaw` is an integer in BASE units while the flow signs a human-scale
// decimal AMOUNT (nativePayment.satsStringFromDecimal multiplies it by 1e8 to
// size the real output), so it is converted rather than renamed:
// `{ asset: 'BTC', amountRaw: '10000' }` is 0.0001 BTC, not 10,000 BTC.
function needsAmountScale(actionName, params) {
    return actionName === 'SEND' && isSet(params.amountRaw) && !isSet(params.amount);
}

// The destination, asset and amount a request means, in the flow's vocabulary.
// Resolved BEFORE any approval: the screen describes whichever payload it is
// handed, so a conversion made after it would sign a magnitude the user was
// never shown. The vault lookup runs only on the `amountRaw` path, and an
// unknown source is refused before the indexer is asked to price it, so the
// gate order pinned by test/unit/bridge/parallel.test.js is untouched.
async function resolveSendValues(req, deps, params, spendFromAddress) {
    const toAddress = params.toAddress ?? params.to;
    const sendTick = params.asset ?? params.tick;
    if (!needsAmountScale(req.action, params)) {
        return { toAddress, sendTick, sendAmount: params.amount, fromSource: null };
    }
    const fromSource = await requireSourceRecord(deps, req.chainId, spendFromAddress);
    const sendAmount = await decimalAmountFromBaseUnits({
        deps,
        chainId: req.chainId,
        address: spendFromAddress,
        tick: sendTick,
        amountRaw: params.amountRaw,
    });
    return { toAddress, sendTick, sendAmount, fromSource };
}

// One modal row for the grouped parallel approval, in the protocol shape the
// single-action prompt renders, plus the resolved values the slot is later
// signed with. A refused slot throws and never reaches the modal.
//
// Every refusal executeSignAction raises before its own prompt is raised here
// first, in the same order, for every supported slot: the chain grant, the
// never policy, the active network, the per-account scope, then the shape
// checks. They read only the site's own grant and the wallet settings, so a
// slot the wallet would refuse is answered in its own entry instead of being
// listed as approvable. An action kind this wallet does not sign keeps its
// row (it carries no payload to convert) and is answered after the modal. The
// source-record lookup and the indexer read stay confined to the `amountRaw`
// path inside resolveSendValues, so an unknown source on any other slot still
// reports after the user's decision, as the per-action prompt order pins.
// When every slot is refused no modal opens at all.
async function groupedSlot(slotReq, deps, site) {
    const { action: actionName, chainId } = slotReq;
    assertChainPermitted(site, chainId);
    if (!SUPPORTED_BRIDGE_ACTIONS.includes(actionName)) {
        return { row: { chainId, action: actionName, payload: {} }, resolved: null };
    }
    if (site.permissions.canSignAction?.[actionName] === 'never') {
        throw bridgeError('ACTION_REJECTED_BY_POLICY', actionName);
    }
    await assertChainOnActiveNetwork(deps, chainId);
    const params = slotReq.params ?? {};
    const legacyTransfer = usesLegacyTransferFlow(slotReq, actionName, params);
    const spendFromAddress = legacyTransfer
        ? spendFromOf(params)
        : addressStringOf(slotReq.from);
    await assertAddressPermitted(deps, site, chainId, spendFromAddress);
    assertNoSigningDivergenceParams(params);
    const resolved = legacyTransfer
        ? await prepareLegacyTransfer(slotReq, deps, params, spendFromAddress)
        : await prepareGenericAction(slotReq, deps, params, spendFromAddress);
    return { row: { chainId, action: actionName, payload: resolved.payload }, resolved };
}

// The allowlisted subset of a page's params for `actionName`. Absent keys stay
// absent (rather than becoming an explicit undefined) so the flows' own
// defaults still apply.
function pickFlowParams(actionName, params) {
    const picked = {};
    for (const key of FLOW_PARAM_ALLOWLIST[actionName] ?? []) {
        if (params?.[key] !== undefined) picked[key] = params[key];
    }
    return picked;
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
// flow signs, scaling by the ASSET's own divisibility.
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
            vault: deps.vault,
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
        if (Array.isArray(shape?.unavailable) && shape.unavailable.length > 0) {
            throw bridgeError(
                'INVALID_PARAMS',
                `cannot scale amountRaw: the balance read for ${address} was incomplete (${shape.unavailableReason || 'unknown reason'}), so ${asset}'s divisibility is unknown`,
            );
        }
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

// ---------------------------------------------------------------------------
// bridge-spec result builders
//
// Every `bridge.*` success answer is assembled here rather than by handing a
// flow's return value to the page. The flows answer in the wallet's internal
// vocabulary (SubmitResult carries actionString / encoding / signed / indexed;
// addressBalances carries { native, tokens }), and forwarding that made the
// bridge's ACTUAL contract "whatever core happened to return today" while its
// PUBLISHED contract said something else entirely. Building the
// published shape explicitly also means a field core adds later cannot reach a
// dApp until someone decides it should.
// ---------------------------------------------------------------------------

/** ConnectSuccess (§43.2). */
function connectSuccess(accounts, permissions) {
    return {
        ok: true,
        // The wallet's own bridge version, never the request's:
        // requiredBridgeVersion is a semver RANGE (e.g. '^0.1.0'), so echoing
        // it back would report a range as a version.
        version: BRIDGE_SPEC_VERSION,
        supportedVersions: [...BRIDGE_SUPPORTED_VERSIONS],
        // Account RECORDS, not the id strings the grant stores. ConnectSuccess
        // declares `accounts: Account[]`, and a dApp handed bare ids had no
        // name to show the user and had to call getAccounts to get the shape
        // connect already promised it.
        accounts,
        chains: permissions.chains,
        // The whole SitePermissions record connect was silently omitting: what
        // the user actually granted, which is the one thing a dApp needs to
        // know before it offers an action the wallet will refuse.
        permissions: {
            chains: permissions.chains,
            accounts: permissions.accounts,
            canSignMessage: permissions.canSignMessage === true,
            canSignAction: permissions.canSignAction ?? {},
        },
    };
}

/** SignMessageSuccess (§43.2). `signedMessage` is the exact bytes signed. */
function signMessageSuccess(req, result) {
    if (typeof result?.signature !== 'string' || result.signature.length === 0) {
        throw bridgeError('UNREACHABLE', 'signMessage returned no signature');
    }
    return {
        ok: true,
        address: req.address,
        signature: result?.signature,
        // No canonicalization happens between the request and the signer, so
        // the signed bytes are the requested message. Stated explicitly rather
        // than left for the dApp to assume.
        signedMessage: req.message,
    };
}

/**
 * CoSignApprovedSuccess / CoSignRefused (§43.2) from a validated core outcome.
 * An approval always carries `signatures`, one entry per co-signed input.
 */
function coSignResult(outcome) {
    if (!outcome.approved) {
        return {
            ok: true,
            approved: false,
            reason: outcome.reason,
            ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
        };
    }
    return {
        ok: true,
        approved: true,
        signatures: outcome.signatures.map(({ index, publicNonce, sig, msg }) => (
            { index, publicNonce, sig, msg }
        )),
        ...(outcome.action !== undefined ? { action: outcome.action } : {}),
    };
}

/**
 * SignActionSuccess (§43.2) from a submit result.
 *
 * `actionIndex` is emitted only when the wallet genuinely knows it. The index
 * is assigned by the INDEXER once a block carries the transaction, and this
 * result resolves at broadcast, so for a freshly signed action there is no
 * number to send and inventing one (0, -1) would be worse than omitting it -
 * bridge-spec now declares the field optional for this reason.
 */
function signActionSuccess(chainId, submitted) {
    if (typeof submitted?.txid !== 'string' || submitted.txid.length === 0) {
        throw bridgeError('UNREACHABLE', 'signAction returned no transaction id');
    }
    const raw = submitted?.actionIndex ?? submitted?.action_index;
    const actionIndex = Number(raw);
    return {
        ok: true,
        txid: submitted?.txid,
        chainId,
        ...(raw !== undefined && raw !== null && Number.isFinite(actionIndex)
            ? { actionIndex }
            : {}),
    };
}

/**
 * The dApp-visible `Balance[]` for one address, from the wallet-internal
 * `{ native, tokens }` shape.
 *
 * Confirmed values come from the explorer before wallet-local pending debits.
 * The native unconfirmed value is the tracker's signed net mempool delta.
 * Token rows have no pending ledger and report zero.
 */
function balanceRecordsFrom(shape) {
    const rows = [];
    const push = (row, assetType) => {
        if (!row || typeof row !== 'object') return;
        const asset = typeof row.tick === 'string' ? row.tick : '';
        if (!asset) return;
        const divisibility = Number(row.divisibility);
        if (!Number.isInteger(divisibility) || divisibility < 0 || divisibility > 30) return;
        const confirmedRaw = String(row.quantity ?? '0');
        let unconfirmedRaw = '0';
        if (assetType === 'native' && /^\d+$/.test(String(row.pendingQuantity ?? ''))) {
            unconfirmedRaw = String(row.pendingQuantity);
        } else if (assetType === 'native' && /^[1-9]\d*$/.test(String(row.pendingOutgoingQuantity ?? ''))) {
            unconfirmedRaw = `-${row.pendingOutgoingQuantity}`;
        }
        const pendingNegative = unconfirmedRaw.startsWith('-');
        const unconfirmed = decimalFromBaseUnits(
            pendingNegative ? unconfirmedRaw.slice(1) : unconfirmedRaw,
            divisibility,
        ) ?? '0';
        rows.push({
            asset,
            assetType,
            divisibility,
            confirmedRaw,
            unconfirmedRaw,
            confirmed: decimalFromBaseUnits(confirmedRaw, divisibility) ?? '0',
            unconfirmed: pendingNegative && unconfirmed !== '0' ? `-${unconfirmed}` : unconfirmed,
        });
    };
    push(shape?.native, 'native');
    if (Array.isArray(shape?.tokens)) {
        for (const token of shape.tokens) push(token, 'token');
    }
    return rows;
}

/**
 * The dApp-visible `Account[]` for a grant. An EMPTY id list is §43.3's
 * wildcard ("every account"), which is why this cannot be a plain filter.
 */
async function accountRecordsFor(vault, accountIds) {
    const all = await vault.accounts.list();
    return accountRecordsFrom(all, accountIds);
}

function accountRecordsFrom(all, accountIds) {
    const ids = new Set(Array.isArray(accountIds) ? accountIds : []);
    return (ids.size > 0 ? all.filter((a) => ids.has(a.id)) : all)
        .map((a) => ({ id: a.id, name: a.name }));
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

// An unreadable wallet store reads as holding none, so the caller refuses.
async function vaultHoldsImportedKey(vault) {
    try {
        const wallets = await vault.wallets.list();
        return wallets.some((w) => Array.isArray(w?.importedKeys) && w.importedKeys.length > 0);
    } catch {
        return false;
    }
}

async function requireSite(vault, req) {
    assertOrigin(req);
    const site = await findConnectedSite(vault, req.origin);
    if (!site) throw bridgeError('NOT_CONNECTED', req.origin);
    if (!(await touchLastUsed(vault, site))) throw bridgeError('NOT_CONNECTED', req.origin);
    return site;
}

// Reads do not update the site record. A read-side put can race a revocation
// delete and recreate the grant, so each read instead verifies the same site
// still exists after its asynchronous vault or network work completes.
async function requireReadSite(deps, req) {
    assertOrigin(req);
    await assertNotBlocked(req, deps);
    const site = await findConnectedSite(deps.vault, req.origin);
    if (!site) throw bridgeError('NOT_CONNECTED', req.origin);
    return site;
}

async function requireCurrentReadSite(deps, req, siteId) {
    const site = await requireReadSite(deps, req);
    if (site.id !== siteId) throw bridgeError('NOT_CONNECTED', req.origin);
    return site;
}

// A write from a stale snapshot would re-insert a grant a revocation queued
// ahead of it had deleted, so the stamp lands only on the record still held
// when the write runs. Resolves false when that record is gone.
async function touchLastUsed(vault, site) {
    return vault.connectedSites.update(site.id, (current) => (
        current && current.origin === site.origin
            ? { ...current, lastUsedAt: new Date().toISOString() }
            : null
    ));
}

// The co-signer owns the allowed-value policy; the bridge only refuses a value
// that is not a number, before the user is asked for a password or a throttle
// token is spent.
function assertSighashTypeShape(sighashType) {
    if (sighashType !== undefined && !Number.isInteger(sighashType)) {
        throw bridgeError('INVALID_PARAMS', 'sighashType must be an integer');
    }
}

// An empty chain grant means all chains are permitted (per §43.3).
function chainGranted(site, chainId) {
    const chains = site.permissions?.chains ?? [];
    return chains.length === 0 || chains.includes(chainId);
}

function assertChainPermitted(site, chainId) {
    if (!chainId) throw bridgeError('MISSING_CHAIN_ID', '');
    if (!chainGranted(site, chainId)) {
        throw bridgeError('CHAIN_NOT_PERMITTED', chainId);
    }
}

async function assertChainOnActiveNetwork(deps, chainId) {
    const settings = await deps.vault.settings.get().catch(() => null);
    if (!settings) throw bridgeError('CHAIN_NOT_PERMITTED', chainId);
    const active = filterChainIdsByActiveNetwork([chainId], settings, deps.chainRegistry);
    if (!active.includes(chainId)) {
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

// A prompt can outlive the grant it was raised under. Revoking or blocking a
// site cancels the prompts already parked for it, but a request that had passed
// its site check and not yet registered its prompt parks afterwards, and a site
// can drop its own grant while a prompt is open. Read the grant again once the
// user has answered so a revoked, blocked or replaced site never signs.
async function assertGrantStillHeld(req, deps, site) {
    await assertNotBlocked(req, deps);
    const current = await findConnectedSite(deps.vault, req.origin);
    if (!current || current.id !== site.id) throw bridgeError('NOT_CONNECTED', req.origin);
    return current;
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

// Enforce the connect-time per-account scope for a co-signer account, the
// same gate assertAddressPermitted enforces for signMessage. A CoSignerAccount
// has no accountId of its own (its `walletId` names the whole seed, not one
// vault Account), so ownership is resolved the same way resolveBridgeSigningPaths
// resolves a derivationPath: through the vault Address record the daemon key
// was provisioned from, which does carry an accountId. Throws
// ADDRESS_NOT_PERMITTED, matching every sibling signing route, when that
// address is out of scope, unknown, or was deleted after provisioning.
async function assertCoSignerAccountPermitted(deps, site, account) {
    const accountIds = site.permissions?.accounts ?? [];
    if (accountIds.length === 0) return;  // empty = all permitted
    const descriptor = deps.chainRegistry.get(account.chainId);
    const owner = descriptor
        ? (await deps.vault.addresses.list()).find(
            (a) =>
                a.chain === descriptor.coin &&
                a.network === descriptor.networkKind &&
                a.derivationPath === account.daemonDerivationPath,
        )
        : null;
    if (!owner || !owner.accountId || !accountIds.includes(owner.accountId)) {
        throw bridgeError('ADDRESS_NOT_PERMITTED', account.aggregateAddress);
    }
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

// Widens the grant still held when the write runs, never a stale snapshot: a
// revoked grant stays revoked and the widening is dropped. `patch` may be a
// function of the held permissions. Resolves false when nothing was written.
async function updateSitePermissions(vault, site, patch, eventCtx) {
    let prev = null;
    let next = null;
    let applied = null;
    const written = await vault.connectedSites.update(site.id, (current) => {
        if (!current || current.origin !== site.origin) return null;
        prev = current.permissions;
        applied = typeof patch === 'function' ? patch(current.permissions) : patch;
        next = {
            ...current,
            permissions: { ...current.permissions, ...applied },
            lastUsedAt: new Date().toISOString(),
        };
        return next;
    });
    if (!written) return false;
    if (eventCtx?.events) {
        let payload;
        const accountsChanged = applied.accounts !== undefined
            && sortedKey(prev.accounts) !== sortedKey(next.permissions.accounts);
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
            prevPermissions: prev,
            nextPermissions: next.permissions,
            accountsChangedPayload: payload,
        });
    }
    return true;
}

function sortedKey(list) {
    if (!Array.isArray(list)) return '';
    return [...new Set(list)].sort().join(',');
}

// A record with no source predates the tag and was always a software key.
function isSoftwareAddressSource(source) {
    return source === undefined || source === 'hd' || source === 'imported-wif';
}

// Every bridge route signs with the key the typed password unlocks. A device
// address keeps its key on the device and a watch-only address has none, so
// signing either at its stored path would put a seed-derived signature under
// an address the seed does not hold. Checked where each route loads the stored
// record, after the approval or a localhost auto-sign recall, and the refusal
// names no source: getAddresses publishes none, so a page learns only that the
// bridge cannot sign for this address.
function assertSoftwareSignable(addr) {
    if (isSoftwareAddressSource(addr?.source)) return;
    throw bridgeError(
        'ADDRESS_NOT_SIGNABLE',
        `${addr?.address ?? ''} cannot be signed here; the bridge signs only with this wallet's own keys`,
    );
}

export async function walletIdForAddress(vault, addressOrId) {
    if (!addressOrId) return undefined;
    const all = await vault.addresses.list();
    const match = all.find((a) => a.id === addressOrId || a.address === addressOrId);
    if (!match) return undefined;
    // A device address's signerId names its SignerRecord, never a wallet, so
    // only its account says which wallet holds it.
    if (!isSoftwareAddressSource(match.source)) {
        if (!match.accountId) return undefined;
        return (await vault.accounts.get(match.accountId))?.walletId;
    }
    // A software address's signerId is its wallet id, but an add-mode restore
    // re-mints the wallet id and leaves signerId naming the source device's
    // wallet. Trust it only when that wallet is in this vault; otherwise the
    // account (or the importing wallet) still names the owner.
    let wallets = null;
    if (match.signerId) {
        wallets = await vault.wallets.list();
        if (wallets.some((w) => w.id === match.signerId)) return match.signerId;
    }
    if (!match.accountId) {
        wallets ??= await vault.wallets.list();
        const importer = wallets.find((w) => Array.isArray(w.importedKeys)
            && w.importedKeys.some((k) => k?.addressId === match.id));
        return importer?.id ?? wallets[0]?.id;
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

// List the addresses a site may sign in with, each with the chain it resolves
// to: inside the site's account and chain grants (an empty list is "all", per
// §43.3), narrowed by the request's optional `chains` coin list and `chainId`.
async function signInCandidates(deps, site, req) {
    const accountIds = new Set(site?.permissions?.accounts ?? []);
    const grantedChains = site?.permissions?.chains ?? [];
    const grantedAddresses = Array.isArray(site?.permissions?.addresses)
        ? new Set(site.permissions.addresses)
        : null;
    const coins = Array.isArray(req.chains) && req.chains.length > 0 ? new Set(req.chains) : null;
    /** @type {{ address: string, chainId: string }[]} */
    const out = [];
    for (const a of await deps.vault.addresses.list()) {
        if (typeof a?.address !== 'string' || !a.address) continue;
        const chainId = deps.chainRegistry.chainIdFor(a.chain, a.network);
        if (!chainId) continue;
        // Skip an address outside the site's account grant
        if (accountIds.size > 0 && !(a.accountId && accountIds.has(a.accountId))) continue;
        // Skip a chain the site was not granted
        if (grantedChains.length > 0 && !grantedChains.includes(chainId)) continue;
        if (grantedAddresses && !grantedAddresses.has(a.address)) continue;
        // Skip a coin the site did not ask for, and any chain but the one it named
        if (coins && !coins.has(a.chain)) continue;
        if (req.chainId && chainId !== req.chainId) continue;
        if (out.some((c) => c.address === a.address && c.chainId === chainId)) continue;
        out.push({ address: a.address, chainId });
    }
    return out;
}

function loginMaxAddresses(raw) {
    if (raw === undefined || raw === null) return 1;
    if (!Number.isInteger(raw) || raw < 1 || raw > LOGIN_PROOF_LIMIT) {
        throw bridgeError(
            'INVALID_PARAMS',
            `maxAddresses must be an integer from 1 to ${LOGIN_PROOF_LIMIT}`,
        );
    }
    return raw;
}

function loginDecisionAddresses(decision) {
    const out = [];
    const add = (value) => {
        const address = typeof value === 'string' ? value : value?.address;
        if (typeof address === 'string' && address && !out.includes(address)) out.push(address);
    };
    add(decision?.address);
    if (Array.isArray(decision?.addresses)) decision.addresses.forEach(add);
    return out;
}

async function storeLoginGrant(req, deps, site, proofs, events) {
    const addresses = proofs.map((proof) => proof.address);
    const chains = [...new Set(proofs.map((proof) => proof.chainId))];
    if (site) {
        const written = await updateSitePermissions(
            deps.vault,
            site,
            (permissions) => ({
                addresses: [...new Set([...(permissions.addresses ?? []), ...addresses])],
            }),
            { events },
        );
        if (!written) throw bridgeError('NOT_CONNECTED', req.origin);
        return;
    }

    const current = await findConnectedSite(deps.vault, req.origin);
    if (current) {
        const allowed = selectLoginAddresses(addresses, current).addresses;
        if (allowed.length !== addresses.length) {
            throw bridgeError('ADDRESS_NOT_PERMITTED', req.origin);
        }
        const written = await updateSitePermissions(
            deps.vault,
            current,
            (permissions) => ({
                addresses: [...new Set([...(permissions.addresses ?? []), ...addresses])],
            }),
            { events },
        );
        if (!written) throw bridgeError('NOT_CONNECTED', req.origin);
        return;
    }

    const records = await deps.vault.addresses.list();
    const selected = new Set(addresses);
    const accounts = [...new Set(records
        .filter((record) => selected.has(record.address) && record.accountId)
        .map((record) => record.accountId))];
    const grant = schemas.createConnectedSite({
        origin: req.origin,
        appName: typeof req.appName === 'string' && req.appName ? req.appName : req.origin,
        appIcon: typeof req.appIcon === 'string' ? req.appIcon : '',
        icon: schemas.sanitizeSiteIcon(req.siteIcon),
        permissions: {
            chains,
            accounts,
            addresses,
            canSignMessage: false,
            canSignAction: {},
        },
    });
    await deps.vault.connectedSites.put(grant);
}

// The published bridge-spec `PsbtSigningPath` is `{ inputIndex, address? |
// derivationPath?, sighashType? }`; the internal Signer contract is
// `{ inputIndex, path? | addressId?, sighashType? }` (exactly one of the pair,
// `addressId` for an imported-WIF key). Nothing else translates between them,
// so without this adapter a spec-shaped dApp call reaches SoftwareSigner and
// fails on every lane. Shape is checked here before the user is prompted; ownership is
// resolved against the vault AFTER approval (resolveBridgeSigningPaths).
function assertBridgeSigningPathsShape(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
        throw bridgeError('INVALID_PARAMS', 'signingPaths must be a non-empty array');
    }
    entries.forEach((entry, i) => {
        if (!entry || typeof entry !== 'object') {
            throw bridgeError('INVALID_PARAMS', `signingPaths[${i}] must be an object`);
        }
        if (!Number.isInteger(entry.inputIndex) || entry.inputIndex < 0) {
            throw bridgeError('INVALID_PARAMS', `signingPaths[${i}].inputIndex must be a non-negative integer`);
        }
        const hasAddress = typeof entry.address === 'string' && entry.address.length > 0;
        const hasPath = typeof entry.derivationPath === 'string' && entry.derivationPath.length > 0;
        if (hasAddress === hasPath) {
            throw bridgeError(
                'INVALID_PARAMS',
                `signingPaths[${i}] must carry exactly one of address or derivationPath`,
            );
        }
        if (entry.sighashType !== undefined && !Number.isInteger(entry.sighashType)) {
            throw bridgeError('INVALID_PARAMS', `signingPaths[${i}].sighashType must be an integer`);
        }
    });
}

// Map spec entries onto the Signer contract, each against a vault-owned Address
// record for this chain. A `derivationPath` is NOT forwarded verbatim: it must
// name a path the wallet already holds, or a page could steer the signer at an
// arbitrary BIP32 path behind the approval modal. Unowned -> ADDRESS_NOT_FOUND,
// the same verdict signMessage gives an unknown address.
//
// Wallet ownership is the WEAKER of the two invariants: it lets a site sign for
// an account its connect grant never named. So the resolved record is judged
// against `site.permissions.accounts` with the same predicate getAddresses,
// getBalances and assertAddressPermitted use, an empty list still meaning
// "all permitted" (§43.3). Both entry shapes are judged here rather than at the
// handler because only the resolved record carries an accountId, so a
// page-supplied `derivationPath` is scoped too.
async function resolveBridgeSigningPaths(deps, site, chainId, entries) {
    const descriptor = deps.chainRegistry.get(chainId);
    const all = await deps.vault.addresses.list();
    const onChain = descriptor
        ? all.filter((a) => a.chain === descriptor.coin && a.network === descriptor.networkKind)
        : [];
    const accountIds = new Set(site?.permissions?.accounts ?? []);
    const resolved = entries.map((entry) => {
        const addr = typeof entry.address === 'string' && entry.address.length > 0
            ? onChain.find((a) => a.address === entry.address) ?? null
            : onChain.find((a) => a.derivationPath === entry.derivationPath) ?? null;
        if (!addr) {
            throw bridgeError('ADDRESS_NOT_FOUND', entry.address ?? entry.derivationPath ?? '');
        }
        if (accountIds.size > 0 && !(addr.accountId && accountIds.has(addr.accountId))) {
            throw bridgeError('ADDRESS_NOT_PERMITTED', entry.address ?? entry.derivationPath ?? '');
        }
        assertSoftwareSignable(addr);
        return { entry, addr };
    });
    const walletIds = new Set((await Promise.all(
        resolved.map(({ addr }) => walletIdForAddress(deps.vault, addr.id)),
    )).filter(Boolean));
    if (walletIds.size !== 1) {
        throw bridgeError('INVALID_PARAMS', 'signingPaths must resolve to exactly one wallet');
    }
    return {
        walletId: [...walletIds][0],
        signingPaths: resolved.map(({ entry, addr }) => ({
            inputIndex: entry.inputIndex,
            // The identical mapping the sign-in and signMessage paths use.
            path: addr.derivationPath ?? undefined,
            addressId: addr.derivationPath ? undefined : addr.id,
            ...(entry.sighashType !== undefined ? { sighashType: entry.sighashType } : {}),
        })),
    };
}

function validCoSignOutcome(outcome) {
    if (!outcome || typeof outcome !== 'object' || typeof outcome.approved !== 'boolean') {
        return false;
    }
    if (!outcome.approved) return typeof outcome.reason === 'string' && outcome.reason.length > 0;
    return Array.isArray(outcome.signatures) && outcome.signatures.length > 0
        && outcome.signatures.every((signature) => (
            Number.isInteger(signature?.index)
            && ['publicNonce', 'sig', 'msg'].every(
                (field) => typeof signature[field] === 'string' && signature[field].length > 0,
            )
        ));
}

async function invokeSignMessage(deps, req) {
    const addr = await findAddressByString(deps.vault, req.address, req.chainId, deps.chainRegistry);
    if (!addr) throw bridgeError('ADDRESS_NOT_FOUND', req.address);
    assertSoftwareSignable(addr);
    return signMessageFlow({
        vault: deps.vault,
        walletId: req.walletId,
        password: req.password,
        chainRegistry: deps.chainRegistry,
        sdkRegistry: deps.sdkRegistry,
        chainId: req.chainId,
        path: addr.derivationPath ?? undefined,
        addressId: addr.derivationPath ? undefined : addr.id,
        addressType: addr.addressType,
        message: req.message,
    });
}

const SIGN_IN_MAX_EXPIRY_MS = 60 * 60 * 1000;

// The sign-in window from the page: absent means the published default, a
// finite positive number is capped at one hour, anything else is refused.
function signInExpiryMs(raw) {
    if (raw === undefined || raw === null) return SIGN_IN_DEFAULT_EXPIRY_MS;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
        throw bridgeError('INVALID_PARAMS', 'expiresInMs must be a positive number');
    }
    return Math.min(raw, SIGN_IN_MAX_EXPIRY_MS);
}

// A refusal raised by a bridge handler.
//
// Carries TWO codes on purpose. `internalCode` is the wallet's own precise
// name (CHAIN_NOT_PERMITTED, NO_PASSWORD, ...) and is what the Developer-Mode
// log and the human-readable message show. `code` is the published
// BridgeErrorCode the page is allowed to see and branch on; the internal names
// are not in bridge-spec's union, and shipping them meant every dApp following
// the spec hit its default case.
class BridgeError extends Error {
    constructor(code, detail) {
        super(`bridge: ${code}${detail ? ` (${detail})` : ''}`);
        this.name = 'BridgeError';
        this.internalCode = code;
        this.code = bridgeErrorCodeFor({ code });
    }
}

function bridgeError(code, detail) {
    return new BridgeError(code, detail);
}

// The duress passphrase arms the signing freeze while someone may be watching,
// and a dApp page is a screen they can watch. Its PANIC_MODE code, its error
// name, its sentence and its time left all name the freeze, so a freeze this
// wallet cannot positively read as self-armed answers the page the way any
// other failed sign does. Only a freeze the user armed in Settings is named.
// The Developer Mode log line takes the same cover, since an onlooker can open
// that too. The co-sign flows throw the same cover (flows/panicMode.js).
const DURESS_COVER_MESSAGE = flows.PANIC_COVER_MESSAGE;

function isSelfArmedFreeze() {
    try {
        return flows.getPanicArmedBy() === flows.PANIC_ARMED_SELF;
    } catch (_err) {
        return false;
    }
}

function duressCoverError() {
    return new Error(DURESS_COVER_MESSAGE);
}

function withoutDuressCue(err) {
    if (/** @type {any} */ (err)?.name !== 'PanicModeActiveError') return err;
    return isSelfArmedFreeze() ? err : duressCoverError();
}

// Narrow any thrown value to something whose `code` is a published
// BridgeErrorCode. Mutates rather than re-wraps so `name`, `stack` and any
// class-specific fields (BroadcastFailedError's signedTxHex, the throttle
// hints) survive to the envelope; only the page-visible code is rewritten.
function asBridgeSpecError(err) {
    if (!err || typeof err !== 'object') {
        const wrapped = /** @type {any} */ (new Error(String(err)));
        wrapped.code = 'INTERNAL_ERROR';
        return wrapped;
    }
    const code = bridgeErrorCodeFor(err);
    if (/** @type {any} */ (err).code !== code) /** @type {any} */ (err).code = code;
    return err;
}
