// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const BASE64URL = /^[A-Za-z0-9_-]+$/;
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

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function encodeBase64url(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64url(encoded, name) {
    if (encoded.length === 0) throw new TypeError(`${name} must not be empty`);
    if (!BASE64URL.test(encoded)) {
        throw new TypeError(`${name} contains a character outside base64url`);
    }

    const padded = encoded.replaceAll('-', '+').replaceAll('_', '/')
        .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    let binary;
    try {
        binary = atob(padded);
    } catch {
        throw new TypeError(`${name} is not valid base64url`);
    }

    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    let decoded;
    try {
        decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        throw new TypeError(`${name} must contain UTF-8 JSON`);
    }
    if (!isPlainObject(decoded)) throw new TypeError(`${name} JSON must be a plain object`);
    return decoded;
}

export function requestLink(envelope) {
    return `xchain:request?v=1&req=${encodeBase64url(envelope)}`;
}

export function publishedLink(link, { base = 'https://wallet.xchain.io/link/' } = {}) {
    return `${base}?uri=${encodeURIComponent(link)}`;
}

export function webWalletLink(link, { base = 'https://wallet.xchain.io/' } = {}) {
    return `${base}?uri=${encodeURIComponent(link)}`;
}

export function decodeRequestLink(text) {
    let parsed;
    try {
        parsed = new URL(text);
    } catch {
        throw new TypeError('request link must be a valid URL');
    }

    if (parsed.protocol === 'https:') {
        if (!parsed.pathname.endsWith('/')) {
            throw new TypeError('request wrapper path must end with /');
        }
        const wrapped = parsed.searchParams.get('uri');
        if (!wrapped) throw new TypeError('request wrapper must contain a uri parameter');
        return decodeRequestLink(wrapped);
    }
    if (parsed.protocol !== 'xchain:' || parsed.pathname !== 'request') {
        throw new TypeError('request link scheme must be xchain:request or https');
    }
    if (parsed.searchParams.get('v') !== '1') {
        throw new TypeError('request link v parameter must be 1');
    }
    const encoded = parsed.searchParams.get('req');
    if (!encoded) throw new TypeError('request link must contain a req parameter');
    return decodeBase64url(encoded, 'request req');
}

export function readReturn(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new TypeError('return URL must be a valid URL');
    }
    if (!parsed.hash.startsWith('#xchain=')) return null;

    const payload = decodeBase64url(parsed.hash.slice('#xchain='.length), 'return payload');
    const unknown = Object.keys(payload).find((key) => !RETURN_KEYS.has(key));
    if (unknown !== undefined) throw new TypeError(`return payload has unknown key: ${unknown}`);
    if (typeof payload.id !== 'string' || payload.id.length === 0) {
        throw new TypeError('return payload id must be a non-empty string');
    }
    if (typeof payload.ok !== 'boolean') {
        throw new TypeError('return payload ok must be a boolean');
    }
    return payload;
}
