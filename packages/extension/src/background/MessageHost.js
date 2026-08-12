// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MessageHost: request/response router for the extension's background
// service worker. Shells talk to core flows via typed messages:
//
//     request  = { type: string, request: unknown }
//     response = { ok: true, result } | { ok: false, error: { name, message } }
//
// Core flows are registered as handlers against message types. The host
// catches synchronous and async errors and serializes them into the
// response envelope so the message transport (chrome.runtime) doesn't
// swallow them; every call gets a structured reply.
//
// The host is transport-agnostic. `handle(message)` returns a Promise
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
        super(`MessageHost: invalid message (${reason})`);
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
 * @typedef {{ ok: true, result: unknown } | { ok: false, error: { name: string, message: string, code?: string, retryAfterMs?: number, burst?: number, windowMs?: number } }} MessageResponse
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

// Structured fields an error may carry that the wire envelope must preserve.
// `code` is the machine-readable outcome every dApp is told to branch on
// (bridge-spec's BridgeErrorCode); the three numbers are the THROTTLED hints
// bridge-spec's BridgeErrorResult declares. Serializing only { name, message }
// dropped all four at the transport, so a rate-limited dApp had no
// `retryAfterMs` to wait on and a spec-following dApp had no `error` code to
// switch on - it could only regex the human-readable message ().
const NUMERIC_ERROR_FIELDS = ['retryAfterMs', 'burst', 'windowMs'];

/**
 * Flatten an Error into the wire envelope's `error` payload.
 *
 * @param {unknown} err
 * @returns {{ ok: false, error: { name: string, message: string, code?: string, retryAfterMs?: number, burst?: number, windowMs?: number } }}
 */
export function serializeError(err) {
    const any = /** @type {any} */ (err);
    const name = any && any.name ? String(any.name) : 'Error';
    const message = any && any.message ? String(any.message) : String(any);
    /** @type {any} */
    const error = { name, message };
    if (any && typeof any.code === 'string' && any.code) error.code = any.code;
    for (const field of NUMERIC_ERROR_FIELDS) {
        const value = any ? any[field] : undefined;
        if (typeof value === 'number' && Number.isFinite(value)) error[field] = value;
    }
    return { ok: false, error };
}

/**
 * Rebuild a throwable Error from an envelope's `error` payload, keeping the
 * structured fields serializeError preserved. Every shell that unwraps the
 * envelope uses this, so `code` survives the round trip in all of them rather
 * than in whichever one was patched last.
 *
 * @param {{ name?: string, message?: string, code?: string, retryAfterMs?: number, burst?: number, windowMs?: number } | undefined} payload
 * @param {string} [fallbackMessage]
 * @returns {Error}
 */
export function hydrateEnvelopeError(payload, fallbackMessage = 'unknown error') {
    const err = /** @type {any} */ (new Error(payload?.message || fallbackMessage));
    err.name = payload?.name || 'Error';
    if (typeof payload?.code === 'string' && payload.code) err.code = payload.code;
    for (const field of NUMERIC_ERROR_FIELDS) {
        const value = payload ? /** @type {any} */ (payload)[field] : undefined;
        if (typeof value === 'number' && Number.isFinite(value)) err[field] = value;
    }
    return err;
}
