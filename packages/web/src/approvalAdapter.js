// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { injectApprovalAdapter } from '@xchain-wallet/core/shared/approval/adapter.js';
import { isLocalhostOrigin } from '@xchain-wallet/core/shared/utils/originAutoApprove.js';
import { deliverResult } from '../../core/src/site_request/deliver.js';

// The shared approval screens call these through core; the web shell answers
// them over the same host routes the extension approval window uses, backed
// by the in-app approvals the host bridge was built with.
export function createWebApprovalAdapter(send) {
    return {
        listWallets: () => send('wallet.list'),
        fetchApproval: (id) => send('approval.fetch', { id }),
        resolveApproval: (id, result) => send('approval.resolve', { id, result }),
        getAddressBalances: (chainId, address) => send('balances.address', { chainId, address }),
        getTokenInfo: (req) => send('token.info', req),
        getAddressesByChain: (walletId, accountId) => send('addresses.byChain', { walletId, accountId }),
        getSettings: () => send('settings.get'),
        parsePsbt: (opts) => send('psbt.parse', opts),
        requoteNativeFee: (opts) => send('action.requoteNativeFee', opts),
        preflight: (opts) => send('action.preflight', opts),
        describeAction: (opts) => send('action.describe', opts),
        parseCoSign: (opts) => send('coSign.parse', opts),
    };
}

export function installWebApprovalAdapter(send) {
    injectApprovalAdapter(createWebApprovalAdapter(send));
}

const SITE_METHODS = Object.freeze({
    login: 'bridge.login',
    signMessage: 'bridge.signMessage',
    signAction: 'bridge.signAction',
});

const MAX_PASSWORD_ATTEMPTS = 3;

function requestOrigin(request) {
    try {
        return new URL(request.return || request.callback).origin;
    } catch {
        return '';
    }
}

function returnTarget(url, developerMode) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol === 'https:') return parsed.href;
    if (parsed.protocol === 'http:' && developerMode === true && isLocalhostOrigin(parsed.origin)) return parsed.href;
    return null;
}

// A link names the chains it wants as chain ids; the sign-in handler narrows
// its candidates by coin, so each id is turned into its coin.
function requestParams(params, chainRegistry) {
    if (!Array.isArray(params?.chains) || !chainRegistry) return params;
    const coins = [];
    for (const entry of params.chains) {
        const descriptor = typeof entry === 'string' ? chainRegistry.descriptorFor(entry) : null;
        const coin = descriptor ? descriptor.coin : entry;
        if (!coins.includes(coin)) coins.push(coin);
    }
    return { ...params, chains: coins };
}

function failureOutcome(err) {
    return { ok: false, error: err?.code || err?.name || 'FAILED' };
}

// Runs one site request in the web shell: the bridge handler parks its
// approval with the in-app approvals, the user answers it on the shared
// approval screen, and the outcome goes back to the site by return link and
// callback. A request without `return` delivers by callback only and
// navigates nowhere.
export function createSiteRequestRunner({
    send,
    approvals,
    chainRegistry,
    deliver = deliverResult,
    navigate = (url) => { window.location.assign(url); },
}) {
    return {
        run(request, { onApproval, onDone } = {}) {
            const method = SITE_METHODS[request?.method];
            const origin = requestOrigin(request ?? {});
            let stopped = false;
            let parkedId = null;
            const seen = new Set();

            const announce = () => {
                for (const entry of approvals.list()) {
                    if (seen.has(entry.id)) continue;
                    seen.add(entry.id);
                    parkedId = entry.id;
                    if (!stopped) onApproval?.(entry);
                }
            };
            const unsubscribe = approvals.subscribe(announce);

            const finish = (status) => {
                stopped = true;
                unsubscribe();
                onDone?.(status);
            };

            const attempt = async () => {
                const outcome = await send(method, {
                    ...requestParams(request.params, chainRegistry),
                    origin,
                    appName: request.app?.name,
                }).then(
                    (result) => ({ ok: true, result }),
                    (err) => ({ failure: err }),
                );
                if (outcome.failure?.name === 'UserRejectedError') return { status: 'rejected' };
                if (outcome.failure?.name === 'InvalidPasswordError' && attempts < MAX_PASSWORD_ATTEMPTS) {
                    attempts += 1;
                    return attempt();
                }
                return { status: 'delivered', outcome: outcome.failure ? failureOutcome(outcome.failure) : outcome };
            };
            let attempts = 1;

            const completed = (async () => {
                if (!method || !origin) {
                    finish('unsupported');
                    return 'unsupported';
                }
                const settings = await send('settings.get').catch(() => null);
                const developerMode = settings?.developerMode === true;
                const result = await attempt();
                if (stopped) return 'cancelled';
                if (result.status === 'rejected') {
                    finish('rejected');
                    return 'rejected';
                }
                const delivery = await deliver(request, result.outcome, {
                    developerMode,
                    resolve: async () => { throw new Error('no name lookup in the browser'); },
                    post: async ({ href, body }) => {
                        const response = await fetch(href, {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body,
                            redirect: 'manual',
                            credentials: 'omit',
                        });
                        return { status: response.status };
                    },
                }).catch(() => null);
                const target = delivery?.browserReturn
                    ? returnTarget(delivery.browserReturn.url, developerMode)
                    : null;
                finish('delivered');
                if (target) navigate(target);
                return 'delivered';
            })();

            announce();
            return {
                completed,
                cancel() {
                    if (stopped) return;
                    if (parkedId !== null) approvals.resolve(parkedId, { approved: false });
                    finish('cancelled');
                },
            };
        },
    };
}
