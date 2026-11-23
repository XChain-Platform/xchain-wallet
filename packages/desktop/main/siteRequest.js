// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { URI_MAX_LENGTH } from '@xchain-wallet/core/uri/bip21.js';
import { isLocalhostOrigin } from '@xchain-wallet/core/shared/utils/originAutoApprove.js';
import { lookup } from 'node:dns/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Agent as UndiciAgent } from 'undici';

import { allowlistedExternalUrl } from './security.js';

export const SITE_REQUEST_CHANNEL = 'xchain:site-request';

/**
 * @param {unknown} url
 * @param {{ developerMode?: boolean, maxLength?: number }} [options]
 * @returns {string | null}
 */
export function siteReturnTarget(
    url,
    { developerMode = false, maxLength = URI_MAX_LENGTH } = {},
) {
    if (typeof url !== 'string' || url.length === 0) return null;
    if (!Number.isFinite(maxLength) || maxLength < 0 || url.length > maxLength) return null;

    const href = allowlistedExternalUrl(url);
    if (href === null || href.length > maxLength) return null;

    const parsed = new URL(href);
    if (parsed.protocol === 'http:') {
        if (developerMode !== true || !isLocalhostOrigin(href)) return null;
    } else if (parsed.protocol !== 'https:') {
        return null;
    }

    const fragmentIndex = href.indexOf('#');
    const targetLength = fragmentIndex === -1 ? href.length : fragmentIndex;
    if (targetLength > 2_048) return null;
    if (fragmentIndex !== -1 && !/^#xchain=[A-Za-z0-9_-]+$/.test(href.slice(fragmentIndex))) {
        return null;
    }

    return href;
}

/**
 * @param {object} [args]
 * @param {unknown} [args.url]
 * @param {boolean} [args.developerMode]
 * @param {number} [args.maxLength]
 * @param {(url: string) => Promise<unknown>} [args.openExternal]
 * @returns {Promise<{ sent: true } | { sent: false, reason: string }>}
 */
export async function sendSiteReturn(args = {}) {
    const {
        url,
        developerMode = false,
        maxLength = URI_MAX_LENGTH,
        openExternal,
    } = args ?? {};
    const target = siteReturnTarget(url, { developerMode, maxLength });
    if (target === null) return { sent: false, reason: 'BAD_TARGET' };
    if (typeof openExternal !== 'function') return { sent: false, reason: 'NO_TRANSPORT' };

    try {
        await openExternal(target);
        return { sent: true };
    } catch {
        return { sent: false, reason: 'OPEN_FAILED' };
    }
}

async function resolveCallbackHost(hostname) {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.map(({ address }) => address);
}

function createPinnedDispatcher(href, address) {
    const expectedHostname = new URL(href).hostname.replace(/^\[|\]$/g, '');
    const family = address.includes(':') ? 6 : 4;
    return new UndiciAgent({
        connect: {
            lookup(hostname, _options, callback) {
                if (hostname !== expectedHostname) {
                    callback(new Error('callback hostname changed before connect'));
                    return;
                }
                callback(null, address, family);
            },
        },
    });
}

/**
 * Adapt the core callback sender's checked request to Node fetch. A null
 * address is the Tor case, which deliberately uses the global dispatcher
 * installed by torRouting.js. Direct requests pin the checked DNS address.
 *
 * @param {object} request
 * @param {string} request.href
 * @param {string | null} request.address
 * @param {string} request.body
 * @param {number} request.timeoutMs
 * @param {'manual'} request.redirect
 * @param {'omit'} request.credentials
 * @param {object} [options]
 * @param {typeof globalThis.fetch} [options.fetchImpl]
 * @param {(href: string, address: string) => { close?: Function }} [options.dispatcherFactory]
 * @returns {Promise<{ status: number }>}
 */
export async function postSiteCallback(request, options = {}) {
    const {
        href,
        address,
        body,
        timeoutMs,
        redirect,
        credentials,
    } = request ?? {};
    const {
        fetchImpl = globalThis.fetch,
        dispatcherFactory = createPinnedDispatcher,
    } = options ?? {};
    if (typeof fetchImpl !== 'function') throw new TypeError('callback fetch is unavailable');
    if (typeof href !== 'string' || typeof body !== 'string') {
        throw new TypeError('callback request must include href and body strings');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new TypeError('callback timeoutMs must be positive');
    }
    if (redirect !== 'manual' || credentials !== 'omit') {
        throw new TypeError('callback request must disable redirects and credentials');
    }
    if (address !== null && typeof address !== 'string') {
        throw new TypeError('callback address must be a string or null');
    }

    const dispatcher = address === null ? null : dispatcherFactory(href, address);
    try {
        const init = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            redirect,
            credentials,
            signal: AbortSignal.timeout(timeoutMs),
        };
        if (dispatcher !== null) init.dispatcher = dispatcher;
        const response = await fetchImpl(href, init);
        await response.body?.cancel?.();
        return { status: response.status };
    } finally {
        await dispatcher?.close?.();
    }
}

async function coreSendCallback(args) {
    const require = createRequire(import.meta.url);
    const coreEntry = require.resolve('@xchain-wallet/core');
    const moduleUrl = pathToFileURL(resolve(dirname(coreEntry), 'site_request/callbackSend.js'));
    const { sendCallback } = await import(moduleUrl.href);
    return sendCallback(args);
}

/**
 * @param {object} [args]
 * @param {unknown} [args.url]
 * @param {unknown} [args.body]
 * @param {boolean} [args.developerMode]
 * @param {boolean} [args.tor]
 * @param {(hostname: string) => Promise<string[]>} [args.resolve]
 * @param {typeof globalThis.fetch} [args.fetchImpl]
 * @param {(href: string, address: string) => { close?: Function }} [args.dispatcherFactory]
 * @returns {Promise<object>}
 */
export async function sendSiteCallback(args = {}) {
    const {
        url,
        body,
        developerMode = false,
        tor = false,
        resolve = resolveCallbackHost,
        fetchImpl = globalThis.fetch,
        dispatcherFactory = createPinnedDispatcher,
    } = args ?? {};
    return coreSendCallback({
        url,
        body,
        developerMode,
        tor,
        resolve,
        post: (request) => postSiteCallback(request, { fetchImpl, dispatcherFactory }),
    });
}

function hasOnlyKeys(value, keys) {
    return value !== null
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.keys(value).every((key) => keys.includes(key));
}

function isCallbackBody(value) {
    if (!hasOnlyKeys(value, [
        'v', 'id', 'method', 'ok', 'result', 'error', 'state', 'claim',
    ])) return false;
    if (value.v !== 1
        || typeof value.id !== 'string' || value.id.length === 0
        || typeof value.method !== 'string' || value.method.length === 0
        || typeof value.ok !== 'boolean') return false;
    return value.ok
        ? Object.hasOwn(value, 'result') && !Object.hasOwn(value, 'error')
        : Object.hasOwn(value, 'error') && !Object.hasOwn(value, 'result');
}

/**
 * @param {unknown} command
 * @param {object} [dependencies]
 * @returns {Promise<object>}
 */
export async function handleSiteRequestCommand(command, dependencies = {}) {
    if (!hasOnlyKeys(command, ['type', 'url', 'body'])) {
        return { sent: false, reason: 'BAD_REQUEST' };
    }
    if (command.type === 'return' && Object.keys(command).length === 2) {
        return sendSiteReturn({
            url: command.url,
            developerMode: dependencies.developerMode,
            openExternal: dependencies.openExternal,
        });
    }
    if (command.type === 'callback'
        && Object.keys(command).length === 3
        && isCallbackBody(command.body)) {
        return sendSiteCallback({
            url: command.url,
            body: command.body,
            developerMode: dependencies.developerMode,
            tor: dependencies.tor,
            resolve: dependencies.resolve,
            fetchImpl: dependencies.fetchImpl,
            dispatcherFactory: dependencies.dispatcherFactory,
        });
    }
    return { sent: false, reason: 'BAD_REQUEST' };
}

/**
 * @param {object} args
 * @param {{ handle: (channel: string, listener: Function) => void }} args.ipcMain
 * @param {(event: object) => boolean} args.isTrustedSender
 * @param {(event: object) => object | Promise<object>} [args.dependencies]
 * @param {(channel: string, listener: Function) => void} [args.register]
 */
export function attachSiteRequestHandler({
    ipcMain,
    isTrustedSender,
    dependencies = () => ({}),
    register = ipcMain?.handle?.bind(ipcMain),
}) {
    if (typeof ipcMain?.handle !== 'function') throw new TypeError('site request ipcMain is unavailable');
    if (typeof isTrustedSender !== 'function') throw new TypeError('site request sender check is unavailable');
    if (typeof dependencies !== 'function') throw new TypeError('site request dependencies must be a function');
    if (typeof register !== 'function') throw new TypeError('site request registration is unavailable');

    register(SITE_REQUEST_CHANNEL, async (event, command, ...extraArgs) => {
        if (!isTrustedSender(event)) return { sent: false, reason: 'FORBIDDEN_SENDER' };
        if (extraArgs.length !== 0) return { sent: false, reason: 'BAD_REQUEST' };
        return handleSiteRequestCommand(command, await dependencies(event));
    });
}
