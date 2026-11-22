// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { base64urlnopad } from '@scure/base';
import { URI_MAX_LENGTH } from './bip21.js';
import { hardenUriIntentText } from './xchainUri.js';
import { isLocalhostOrigin } from '../shared/utils/originAutoApprove.js';

const LINK_PREFIX = 'xchain:request?';
const ENVELOPE_KEYS = new Set([
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
const APP_KEYS = new Set(['name']);
const METHODS = new Set(['login', 'signMessage', 'signAction', 'signPsbt']);
const BROWSERS = new Set(['chrome', 'firefox', 'edge', 'safari', 'samsung']);
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const TARGET_MAX_LENGTH = 2_048;
const EXPIRY_MAX_MS = 10 * 60 * 1_000;
const JSON_MAX_DEPTH = 16;

export const REQUEST_LINK_METHODS = Object.freeze([...METHODS]);
export const REQUEST_LINK_MAX_LENGTH = URI_MAX_LENGTH;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function copyWithNullPrototype(value, depth = 0) {
    if (depth > JSON_MAX_DEPTH) throw new RangeError('request JSON is too deeply nested');
    if (Array.isArray(value)) {
        return value.map((entry) => copyWithNullPrototype(entry, depth + 1));
    }
    if (!isRecord(value)) return value;

    const out = Object.create(null);
    for (const key of Object.keys(value)) {
        out[key] = copyWithNullPrototype(value[key], depth + 1);
    }
    return out;
}

function closedRecord(value, keys) {
    return isRecord(value) && Object.keys(value).every((key) => keys.has(key));
}

function validTarget(target, developerMode) {
    if (typeof target !== 'string' || target.length === 0 || target.length > TARGET_MAX_LENGTH) {
        return null;
    }
    let parsed;
    try {
        parsed = new URL(target);
    } catch {
        return null;
    }
    if (parsed.username || parsed.password || parsed.hash) return null;
    if (parsed.protocol !== 'https:'
        && !(parsed.protocol === 'http:' && developerMode && isLocalhostOrigin(parsed.origin))) {
        return null;
    }
    return parsed;
}

function parseOuterLink(text) {
    if (typeof text !== 'string') return { status: 'not-request' };
    const raw = text.trim();
    if (!raw.startsWith(LINK_PREFIX)) return { status: 'not-request' };
    if (raw.length > URI_MAX_LENGTH) return { status: 'invalid' };

    const query = raw.slice(LINK_PREFIX.length);
    const fields = Object.create(null);
    for (const pair of query.split('&')) {
        const equals = pair.indexOf('=');
        if (equals <= 0) return { status: 'invalid' };
        const key = pair.slice(0, equals);
        const value = pair.slice(equals + 1);
        if ((key !== 'v' && key !== 'req') || Object.hasOwn(fields, key)) {
            return { status: 'invalid' };
        }
        fields[key] = value;
    }
    if (!Object.hasOwn(fields, 'v')) return { status: 'invalid' };
    if (fields.v !== '1') return { status: 'unsupported' };
    if (!fields.req || !BASE64URL_RE.test(fields.req)) {
        return { status: 'invalid' };
    }

    let decoded;
    try {
        const bytes = base64urlnopad.decode(fields.req);
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return { status: 'invalid' };
    }
    return { status: 'encoded', decoded };
}

function hardenEnvelope(envelope) {
    const hardenedParams = hardenUriIntentText(envelope.params);
    envelope.params = copyWithNullPrototype(hardenedParams);
    if (envelope.app) {
        const hardenedApp = hardenUriIntentText({ label: envelope.app.name });
        envelope.app.name = hardenedApp.label;
    }
    return envelope;
}

function inspectEnvelope(decoded, { now, developerMode }) {
    let envelope;
    try {
        envelope = copyWithNullPrototype(JSON.parse(decoded));
    } catch {
        return { status: 'invalid' };
    }
    if (!closedRecord(envelope, ENVELOPE_KEYS)) return { status: 'invalid' };
    if (envelope.v !== 1) return { status: 'unsupported' };
    if (!METHODS.has(envelope.method)) return { status: 'unsupported' };
    if (!ID_RE.test(envelope.id) || !isRecord(envelope.params)) return { status: 'invalid' };
    if (!Number.isSafeInteger(envelope.exp)
        || envelope.exp <= now
        || envelope.exp > now + EXPIRY_MAX_MS) {
        return { status: 'invalid' };
    }
    if (Object.hasOwn(envelope, 'state') && typeof envelope.state !== 'string') {
        return { status: 'invalid' };
    }
    if (Object.hasOwn(envelope, 'browser') && !BROWSERS.has(envelope.browser)) {
        return { status: 'invalid' };
    }
    if (Object.hasOwn(envelope, 'app')) {
        if (!closedRecord(envelope.app, APP_KEYS) || typeof envelope.app.name !== 'string') {
            return { status: 'invalid' };
        }
    }

    const returnTarget = Object.hasOwn(envelope, 'return')
        ? validTarget(envelope.return, developerMode)
        : null;
    const callbackTarget = Object.hasOwn(envelope, 'callback')
        ? validTarget(envelope.callback, developerMode)
        : null;
    if ((!returnTarget && !callbackTarget)
        || (Object.hasOwn(envelope, 'return') && !returnTarget)
        || (Object.hasOwn(envelope, 'callback') && !callbackTarget)) {
        return { status: 'invalid' };
    }
    if (returnTarget && callbackTarget && returnTarget.origin !== callbackTarget.origin) {
        return { status: 'invalid' };
    }

    return { status: 'valid', request: hardenEnvelope(envelope) };
}

export function inspectRequestLink(text, { now = Date.now(), developerMode = false } = {}) {
    if (!Number.isSafeInteger(now)) return { status: 'invalid' };
    const outer = parseOuterLink(text);
    if (outer.status !== 'encoded') return outer;
    return inspectEnvelope(outer.decoded, { now, developerMode: developerMode === true });
}

export function parseRequestLink(text, opts) {
    const result = inspectRequestLink(text, opts);
    return result.status === 'valid' ? result.request : null;
}
