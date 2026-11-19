// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { base64urlnopad } from '@scure/base';
import { decodeEnvelope, encodeEnvelope } from './multisigPsbtEnvelope.js';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/multisig.js';

const LINK_PREFIX = 'xchain://multisig-sign';
const REQUEST_KINDS = new Set([
    'multisig-request-signature',
    'multisig-request-nonce',
    'multisig-request-partial',
]);

// The QR transport tops out just below this encoded size. Apply the same order
// of bound before base64 decoding so a hostile paste cannot allocate freely.
export const MULTISIG_SESSION_LINK_MAX_REQ_CHARS = 1024 * 1024;

export class MultisigSessionLinkError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MultisigSessionLinkError';
        this.userFacing = true;
    }
}

function invalidLink(message) {
    return new MultisigSessionLinkError(message);
}

/** Build a deep link containing the exact validated request envelope bytes. */
export function buildMultisigSessionLink(envelope) {
    const bytes = encodeEnvelope(envelope);
    if (!REQUEST_KINDS.has(envelope?.kind)) {
        throw invalidLink(t('multisig.signingLink.requestOnly'));
    }
    const req = base64urlnopad.encode(bytes);
    if (req.length > MULTISIG_SESSION_LINK_MAX_REQ_CHARS) {
        throw invalidLink(t('multisig.signingLink.tooLarge'));
    }
    return `${LINK_PREFIX}?req=${req}`;
}

/** Parse and validate a multisig signing-request deep link. */
export function parseMultisigSessionLink(text) {
    if (typeof text !== 'string' || text.trim().length === 0) {
        throw invalidLink(t('multisig.signingLink.invalid'));
    }
    let url;
    try {
        url = new URL(text.trim());
    } catch {
        throw invalidLink(t('multisig.signingLink.invalid'));
    }
    if (url.protocol !== 'xchain:' || url.hostname !== 'multisig-sign'
        || (url.pathname !== '' && url.pathname !== '/')) {
        throw invalidLink(t('multisig.signingLink.invalid'));
    }
    const req = url.searchParams.get('req');
    if (!req) throw invalidLink(t('multisig.signingLink.missingRequest'));
    if (req.length > MULTISIG_SESSION_LINK_MAX_REQ_CHARS) {
        throw invalidLink(t('multisig.signingLink.tooLarge'));
    }
    if (!/^[A-Za-z0-9_-]+$/.test(req)) {
        throw invalidLink(t('multisig.signingLink.badEncoding'));
    }
    let envelope;
    try {
        envelope = decodeEnvelope(base64urlnopad.decode(req));
    } catch {
        throw invalidLink(t('multisig.signingLink.badRequest'));
    }
    if (!REQUEST_KINDS.has(envelope.kind)) {
        throw invalidLink(t('multisig.signingLink.requestOnly'));
    }
    return envelope;
}
