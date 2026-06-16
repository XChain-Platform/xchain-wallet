// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MessageHost — request/response router for the extension's background
// service worker. Shells talk to core flows via typed messages:
//
//     request  = { type: string, request: unknown }
//     response = { ok: true, result } | { ok: false, error: { name, message } }
//
// Core flows are registered as handlers against message types. The host
// catches synchronous and async errors and serializes them into the
// response envelope so the message transport (chrome.runtime) doesn't
// swallow them — every call gets a structured reply.
//
// The host is transport-agnostic — `handle(message)` returns a Promise
// of the response envelope. See `ChromeRuntimeAdapter` for the MV3 wire-
// up to `chrome.runtime.onMessage`.

export class UnknownMessageTypeError extends Error {
    constructor(type) {
        super(`MessageHost: no handler registered for type "${type}"`);
        this.name = 'UnknownMessageTypeError';
        this.type = type;
    }
}

export class InvalidMessageError extends Error {
    constructor(reason) {
        super(`MessageHost: invalid message — ${reason}`);
        this.name = 'InvalidMessageError';
    }
}

/**
 * @typedef {Object} MessageHostDeps
 * @property {import('@xchain-wallet/core').storage.Vault} vault
 * @property {import('@xchain-wallet/core').registry.ChainRegistry} chainRegistry
 * @property {import('@xchain-wallet/core').sdk.SDKRegistry} sdkRegistry
 * @property {import('@xchain-wallet/core').signers.SignerPool} [signerPool]   present when the host wants HD-derive ops to skip the password prompt during an unlocked session
 */

/**
 * @template TRequest, TResult
 * @typedef {(request: TRequest, deps: MessageHostDeps) => Promise<TResult> | TResult} MessageHandler
 */

/**
 * @typedef {{ ok: true, result: unknown } | { ok: false, error: { name: string, message: string } }} MessageResponse
 */

export class MessageHost {
    /** @param {MessageHostDeps} deps */
    constructor(deps) {
        if (!deps?.vault) throw new Error('MessageHost: deps.vault is required');
        if (!deps?.chainRegistry) throw new Error('MessageHost: deps.chainRegistry is required');
        if (!deps?.sdkRegistry) throw new Error('MessageHost: deps.sdkRegistry is required');
        this._deps = deps;
        /** @type {Map<string, MessageHandler<any, any>>} */
        this._handlers = new Map();
    }

    /**
     * @template TRequest, TResult
     * @param {string} type
     * @param {MessageHandler<TRequest, TResult>} handler
     */
    register(type, handler) {
        if (typeof type !== 'string' || type.length === 0) {
            throw new Error('MessageHost.register: type must be a non-empty string');
        }
        if (typeof handler !== 'function') {
            throw new Error('MessageHost.register: handler must be a function');
        }
        if (this._handlers.has(type)) {
            throw new Error(`MessageHost.register: type "${type}" is already registered`);
        }
        this._handlers.set(type, handler);
    }

    /**
     * @param {{ type: string, request?: unknown }} message
     * @returns {Promise<MessageResponse>}
     */
    async handle(message) {
        if (!message || typeof message !== 'object') {
            return serializeError(new InvalidMessageError('message must be an object'));
        }
        const { type, request } = /** @type {{ type?: unknown, request?: unknown }} */ (message);
        if (typeof type !== 'string' || type.length === 0) {
            return serializeError(
                new InvalidMessageError('message.type must be a non-empty string'),
            );
        }
        const handler = this._handlers.get(type);
        if (!handler) {
            return serializeError(new UnknownMessageTypeError(type));
        }
        try {
            const result = await handler(request, this._deps);
            return { ok: true, result };
        } catch (err) {
            return serializeError(err);
        }
    }

    /** Names of registered types, for diagnostics. */
    types() {
        return Array.from(this._handlers.keys()).sort();
    }
}

function serializeError(err) {
    const name = err && err.name ? String(err.name) : 'Error';
    const message = err && err.message ? String(err.message) : String(err);
    return { ok: false, error: { name, message } };
}
