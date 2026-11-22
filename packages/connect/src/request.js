// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: MIT

export const REQUEST_LINK_MAX_CHARS = 16_384;
export const REQUEST_TARGET_MAX_CHARS = 2_048;
export const REQUEST_EXP_MAX_MS = 10 * 60 * 1_000;
export const REQUEST_DEFAULT_EXP_MS = 5 * 60 * 1_000;
export const REQUEST_JSON_MAX_DEPTH = 16;

const REQUEST_PREFIX = 'xchain:request';
const PUBLISHED_PREFIX = 'https://wallet.xchain.io/link/?uri=';
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const REQUEST_KEYS = new Set([
    'v',
    'id',
    'method',
    'params',
    'return',
    'callback',
    'state',
    'exp',
    'app',
    'browser',
]);
const RETURN_KEYS = new Set([
    'v',
    'id',
    'method',
    'ok',
    'result',
    'error',
    'state',
    'claim',
]);
const METHODS = new Set(['login', 'signMessage', 'signAction', 'signPsbt']);
const BROWSERS = new Set(['chrome', 'firefox', 'edge', 'safari', 'samsung']);
const WEB_LINKS = [
    ['https://xchain.io', '/wallet/link/'],
    ['https://wallet.xchain.io', '/link/'],
];

export class RequestCodecError extends TypeError {
    constructor(code, message) {
        super(message);
        this.name = 'RequestCodecError';
        this.code = code;
    }
}

function refuse(message, code = 'INVALID_PARAMS') {
    throw new RequestCodecError(code, message);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value, label, depth = 0, seen = new Set()) {
    if (depth > REQUEST_JSON_MAX_DEPTH) refuse(`${label} exceeds the JSON depth limit`);
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) refuse(`${label} contains a non-finite number`);
        return;
    }
    if (typeof value !== 'object') refuse(`${label} is not JSON-serializable`);
    if (seen.has(value)) refuse(`${label} contains a cycle`);
    seen.add(value);
    if (Array.isArray(value)) {
        for (const item of value) assertJsonValue(item, label, depth + 1, seen);
    } else {
        if (!isRecord(value)) refuse(`${label} contains a non-plain object`);
        for (const key of Object.keys(value)) {
            assertJsonValue(value[key], label, depth + 1, seen);
        }
    }
    seen.delete(value);
}

function nullPrototypeCopy(value, depth = 0) {
    if (depth > REQUEST_JSON_MAX_DEPTH) refuse('decoded JSON exceeds the depth limit');
    if (Array.isArray(value)) return value.map((item) => nullPrototypeCopy(item, depth + 1));
    if (!isRecord(value)) return value;
    const copy = Object.create(null);
    for (const key of Object.keys(value)) copy[key] = nullPrototypeCopy(value[key], depth + 1);
    return copy;
}

function encodeBase64url(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function encodeBytesBase64url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeBase64url(encoded, label) {
    if (typeof encoded !== 'string' || !BASE64URL_PATTERN.test(encoded)) {
        refuse(`${label} must be unpadded base64url`);
    }
    const remainder = encoded.length % 4;
    if (remainder === 1) refuse(`${label} has an invalid base64url length`);
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
        + (remainder === 0 ? '' : '='.repeat(4 - remainder));
    let binary;
    try {
        binary = atob(padded);
    } catch {
        refuse(`${label} is not valid base64url`);
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (encodeBytesBase64url(bytes) !== encoded) refuse(`${label} is not canonical base64url`);
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        refuse(`${label} is not valid UTF-8`);
    }
}

function parseEncodedJson(encoded, label) {
    let parsed;
    try {
        parsed = JSON.parse(decodeBase64url(encoded, label));
    } catch (error) {
        if (error instanceof RequestCodecError) throw error;
        refuse(`${label} is not valid JSON`);
    }
    if (!isRecord(parsed)) refuse(`${label} must decode to an object`);
    assertJsonValue(parsed, label, -1);
    return nullPrototypeCopy(parsed, -1);
}

function randomId(randomBytes) {
    let bytes;
    if (randomBytes === undefined) {
        if (typeof globalThis.crypto?.getRandomValues !== 'function') {
            refuse('Web Crypto API is required to build a request');
        }
        bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    } else {
        if (typeof randomBytes !== 'function') refuse('randomBytes must be a function');
        bytes = randomBytes(16);
    }
    if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
        refuse('randomBytes must return 16 bytes');
    }
    return encodeBytesBase64url(bytes);
}

function currentReturnTarget() {
    if (typeof globalThis.location?.href !== 'string') return undefined;
    try {
        const target = new URL(globalThis.location.href);
        target.hash = '';
        return target.href;
    } catch {
        return undefined;
    }
}

function isDeveloperLoopback(url) {
    return url.hostname === 'localhost'
        || url.hostname === '127.0.0.1'
        || url.hostname === '[::1]';
}

function validateTarget(value, name, developerMode) {
    if (typeof value !== 'string' || value.length === 0) refuse(`${name} must be a non-empty URL`);
    if (value.length > REQUEST_TARGET_MAX_CHARS) {
        refuse(`${name} exceeds ${REQUEST_TARGET_MAX_CHARS} characters`, 'REQUEST_TOO_LARGE');
    }
    let url;
    try {
        url = new URL(value);
    } catch {
        refuse(`${name} must be an absolute URL`);
    }
    const secure = url.protocol === 'https:';
    const localDevelopment = developerMode && url.protocol === 'http:' && isDeveloperLoopback(url);
    if (!secure && !localDevelopment) refuse(`${name} must use https`);
    if (url.username || url.password) refuse(`${name} must not contain credentials`);
    if (url.hash) refuse(`${name} must not contain a fragment`);
    return url;
}

function validateEnvelope(envelope, { now = Date.now(), developerMode = false } = {}) {
    if (!isRecord(envelope)) refuse('request envelope must be an object');
    for (const key of Object.keys(envelope)) {
        if (!REQUEST_KEYS.has(key)) refuse(`unknown request key: ${key}`);
    }
    if (envelope.v !== 1) {
        refuse('request version must be 1', hasOwn(envelope, 'v') ? 'BRIDGE_VERSION_MISMATCH' : 'INVALID_PARAMS');
    }
    if (typeof envelope.id !== 'string' || !ID_PATTERN.test(envelope.id)) {
        refuse('request id must be 22 unpadded base64url characters');
    }
    if (!METHODS.has(envelope.method)) refuse('request method is not supported', 'UNSUPPORTED_ACTION');
    if (!isRecord(envelope.params)) refuse('request params must be an object');
    assertJsonValue(envelope.params, 'request params');
    if (!Number.isSafeInteger(now)) refuse('now must be an epoch-millisecond integer');
    if (!Number.isSafeInteger(envelope.exp)) refuse('request exp must be an epoch-millisecond integer');
    if (envelope.exp <= now) refuse('request has expired', 'REQUEST_EXPIRED');
    if (envelope.exp > now + REQUEST_EXP_MAX_MS) {
        refuse(`request exp must be within ${REQUEST_EXP_MAX_MS} milliseconds`);
    }

    const returnUrl = hasOwn(envelope, 'return')
        ? validateTarget(envelope.return, 'return', developerMode)
        : null;
    const callbackUrl = hasOwn(envelope, 'callback')
        ? validateTarget(envelope.callback, 'callback', developerMode)
        : null;
    if (!returnUrl && !callbackUrl) refuse('request requires return or callback');
    if (returnUrl && callbackUrl && returnUrl.origin !== callbackUrl.origin) {
        refuse('return and callback must share one origin');
    }
    if (hasOwn(envelope, 'state') && typeof envelope.state !== 'string') {
        refuse('request state must be a string');
    }
    if (hasOwn(envelope, 'app')) {
        if (!isRecord(envelope.app)
            || Object.keys(envelope.app).length !== 1
            || typeof envelope.app.name !== 'string'
            || envelope.app.name.length === 0) {
            refuse('request app must contain only a non-empty name');
        }
    }
    if (hasOwn(envelope, 'browser') && !BROWSERS.has(envelope.browser)) {
        refuse('request browser hint is not supported');
    }
    return envelope;
}

function requestOptions(methodOrRequest, paramsOrOptions, maybeOptions) {
    if (typeof methodOrRequest === 'string') {
        return {
            method: methodOrRequest,
            params: paramsOrOptions,
            options: maybeOptions ?? {},
        };
    }
    if (!isRecord(methodOrRequest)) refuse('buildRequest requires a method or request object');
    const { method, params, ...inlineOptions } = methodOrRequest;
    return {
        method,
        params,
        options: { ...inlineOptions, ...(paramsOrOptions ?? {}) },
    };
}

export function buildRequest(methodOrRequest, paramsOrOptions, maybeOptions) {
    const { method, params, options } = requestOptions(methodOrRequest, paramsOrOptions, maybeOptions);
    if (!isRecord(options)) refuse('request options must be an object');
    const allowedOptions = new Set([
        'id', 'return', 'callback', 'state', 'exp', 'app', 'browser', 'now',
        'developerMode', 'randomBytes',
    ]);
    for (const key of Object.keys(options)) {
        if (!allowedOptions.has(key)) refuse(`unknown request option: ${key}`);
    }
    const now = options.now ?? Date.now();
    if (!Number.isSafeInteger(now)) refuse('now must be an epoch-millisecond integer');
    const envelope = {
        v: 1,
        id: options.id ?? randomId(options.randomBytes),
        method,
        params,
    };
    const fallbackReturn = !hasOwn(options, 'return') && !hasOwn(options, 'callback')
        ? currentReturnTarget()
        : undefined;
    if (hasOwn(options, 'return')) envelope.return = options.return;
    else if (fallbackReturn !== undefined) envelope.return = fallbackReturn;
    if (hasOwn(options, 'callback')) envelope.callback = options.callback;
    if (hasOwn(options, 'state')) envelope.state = options.state;
    envelope.exp = options.exp ?? now + REQUEST_DEFAULT_EXP_MS;
    if (hasOwn(options, 'app')) envelope.app = options.app;
    if (hasOwn(options, 'browser')) envelope.browser = options.browser;
    validateEnvelope(envelope, { now, developerMode: options.developerMode === true });
    requestLink(envelope, { now, developerMode: options.developerMode === true });
    return envelope;
}

export function requestLink(envelope, options = {}) {
    validateEnvelope(envelope, options);
    let json;
    try {
        json = JSON.stringify(envelope);
    } catch {
        refuse('request envelope is not JSON-serializable');
    }
    const link = `${REQUEST_PREFIX}?v=1&req=${encodeBase64url(json)}`;
    const publishedLength = PUBLISHED_PREFIX.length + encodeURIComponent(link).length;
    if (publishedLength > REQUEST_LINK_MAX_CHARS) {
        refuse(`published request exceeds ${REQUEST_LINK_MAX_CHARS} characters`, 'REQUEST_TOO_LARGE');
    }
    return link;
}

function unwrapRequestText(text) {
    let url;
    try {
        url = new URL(text);
    } catch {
        refuse('request link must be an absolute URL');
    }
    if (url.protocol === 'xchain:' && url.pathname === 'request') return text;
    const webLink = WEB_LINKS.find(([origin, path]) => url.origin === origin
        && url.pathname.startsWith(path));
    if (!webLink) refuse('request link has an unsupported scheme or host');
    if ([...url.searchParams.keys()].some((key) => key !== 'uri')) {
        refuse('web request link must contain only the uri parameter');
    }
    const values = url.searchParams.getAll('uri');
    if (values.length !== 1 || values[0].length === 0) refuse('web request link requires one uri parameter');
    return values[0];
}

export function parseRequest(text, options = {}) {
    if (typeof text !== 'string' || text.length === 0) refuse('request link must be a non-empty string');
    if (text.length > REQUEST_LINK_MAX_CHARS) {
        refuse(`request link exceeds ${REQUEST_LINK_MAX_CHARS} characters`, 'REQUEST_TOO_LARGE');
    }
    const requestText = unwrapRequestText(text);
    const match = /^xchain:request\?v=([^&]*)&req=([^&]*)$/.exec(requestText);
    if (!match) refuse('request link must match xchain:request?v=1&req=<base64url>');
    if (match[1] !== '1') {
        refuse('request link version must be 1', 'BRIDGE_VERSION_MISMATCH');
    }
    const envelope = parseEncodedJson(match[2], 'request payload');
    return validateEnvelope(envelope, options);
}

function returnPayloadText(text) {
    if (text.startsWith('#')) {
        if (!text.startsWith('#xchain=')) return null;
        return text.slice('#xchain='.length);
    }
    let url;
    try {
        url = new URL(text);
    } catch {
        refuse('return value must be a URL or fragment');
    }
    if (!url.hash || !url.hash.startsWith('#xchain=')) return null;
    return url.hash.slice('#xchain='.length);
}

function validateReturnPayload(payload) {
    for (const key of Object.keys(payload)) {
        if (!RETURN_KEYS.has(key)) refuse(`unknown return key: ${key}`);
    }
    if (typeof payload.id !== 'string' || !ID_PATTERN.test(payload.id)) {
        refuse('return id must be 22 unpadded base64url characters');
    }
    if (typeof payload.ok !== 'boolean') refuse('return ok must be a boolean');
    if (typeof payload.claim !== 'string' || !ID_PATTERN.test(payload.claim)) {
        refuse('return claim must be 22 unpadded base64url characters');
    }
    const short = !hasOwn(payload, 'v') && !hasOwn(payload, 'method');
    if (short) {
        if (Object.keys(payload).some((key) => !['id', 'ok', 'claim'].includes(key))) {
            refuse('short return must contain only id, ok, and claim');
        }
        return payload;
    }
    if (payload.v !== 1) refuse('return version must be 1', 'BRIDGE_VERSION_MISMATCH');
    if (!METHODS.has(payload.method)) refuse('return method is not supported', 'UNSUPPORTED_ACTION');
    if (hasOwn(payload, 'state') && typeof payload.state !== 'string') {
        refuse('return state must be a string');
    }
    const hasResult = hasOwn(payload, 'result');
    const hasError = hasOwn(payload, 'error');
    if (payload.ok) {
        if (!hasResult || hasError) refuse('successful return requires result and no error');
        assertJsonValue(payload.result, 'return result');
    } else if (hasResult || !hasError) {
        refuse('failed return requires an error and no result');
    } else if (typeof payload.error === 'string') {
        if (payload.error.length === 0) refuse('failed return error must not be empty');
    } else if (isRecord(payload.error)) {
        const errorKeys = Object.keys(payload.error);
        if (errorKeys.some((key) => key !== 'code' && key !== 'message')
            || typeof payload.error.code !== 'string'
            || payload.error.code.length === 0
            || (hasOwn(payload.error, 'message') && typeof payload.error.message !== 'string')) {
            refuse('failed return error must contain a code and optional message');
        }
    } else {
        refuse('failed return error must be a code or error object');
    }
    return payload;
}

export function parseReturn(text) {
    if (typeof text !== 'string' || text.length === 0) refuse('return value must be a non-empty string');
    if (text.length > REQUEST_LINK_MAX_CHARS) {
        refuse(`return value exceeds ${REQUEST_LINK_MAX_CHARS} characters`, 'RESULT_TOO_LARGE');
    }
    const encoded = returnPayloadText(text);
    if (encoded === null) return null;
    const payload = parseEncodedJson(encoded, 'return payload');
    return validateReturnPayload(payload);
}
