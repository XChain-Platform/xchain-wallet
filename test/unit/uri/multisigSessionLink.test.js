// @vitest-environment node

import { base64urlnopad } from '@scure/base';
import { describe, expect, it } from 'vitest';
import {
    buildMultisigSessionLink,
    MULTISIG_SESSION_LINK_MAX_REQ_CHARS,
    parseMultisigSessionLink,
} from '../../../packages/core/src/uri/multisigSessionLink.js';
import {
    buildReplyEnvelope,
    buildRequestEnvelope,
    decodeEnvelope,
    encodeEnvelope,
} from '../../../packages/core/src/uri/multisigPsbtEnvelope.js';
import { decodeXcwChunks, encodeXcwChunks } from '../../../packages/core/src/uri/psbtQr.js';
import { deepLinkRoute } from '../../../packages/desktop/renderer/deepLinkRoute.js';

const ALICE = `02${'11'.repeat(32)}`;
const BOB = `03${'22'.repeat(32)}`;
const SESSION_REF = {
    chainId: 'bitcoin-testnet',
    scheme: 'p2wsh-multisig',
    threshold: 2,
    cosignerPubkeys: [ALICE, BOB],
    msgHash: 'aa'.repeat(32),
    psbtHex: '70736274ff0100',
};

describe('multisig session links', () => {
    it('round-trips the same request envelope carried by QR', () => {
        const envelope = buildRequestEnvelope({
            kind: 'multisig-request-signature',
            sessionRef: SESSION_REF,
        });
        const qrEnvelope = decodeEnvelope(decodeXcwChunks(
            encodeXcwChunks(encodeEnvelope(envelope)),
        ).psbt);
        const link = buildMultisigSessionLink(envelope);

        expect(link).toMatch(/^xchain:\/\/multisig-sign\?req=[A-Za-z0-9_-]+$/);
        expect(new URL(link).searchParams.get('req')).not.toContain('=');
        expect(parseMultisigSessionLink(`  ${link}\n`)).toEqual(qrEnvelope);
    });

    it.each([
        'https://multisig-sign?req=abc',
        'xchain://another-host?req=abc',
        'xchain://multisig-sign/extra?req=abc',
    ])('rejects a wrong scheme or host: %s', (link) => {
        expect(() => parseMultisigSessionLink(link)).toThrow('valid multisig signing link');
    });

    it('rejects missing and oversized request data before decoding', () => {
        expect(() => parseMultisigSessionLink('xchain://multisig-sign')).toThrow(
            'contain a signing request',
        );
        expect(() => parseMultisigSessionLink(
            `xchain://multisig-sign?req=${'a'.repeat(MULTISIG_SESSION_LINK_MAX_REQ_CHARS + 1)}`,
        )).toThrow('too large');
    });

    it('rejects malformed base64url', () => {
        expect(() => parseMultisigSessionLink('xchain://multisig-sign?req=bad%2Bdata'))
            .toThrow('invalid encoded data');
    });

    it('rejects reply envelopes', () => {
        const request = buildRequestEnvelope({
            kind: 'multisig-request-signature', sessionRef: SESSION_REF,
        });
        const reply = buildReplyEnvelope({
            kind: 'multisig-classical-reply',
            fingerprint: request.fingerprint,
            contribution: { pubkey: ALICE, sig: `30${'44'.repeat(35)}01` },
        });
        const link = `xchain://multisig-sign?req=${base64urlnopad.encode(encodeEnvelope(reply))}`;
        expect(() => parseMultisigSessionLink(link)).toThrow('multisig signing request');
    });

    it('rejects a request whose fingerprint was tampered', () => {
        const request = buildRequestEnvelope({
            kind: 'multisig-request-signature', sessionRef: SESSION_REF,
        });
        const bytes = new TextEncoder().encode(JSON.stringify({
            ...request,
            fingerprint: 'ff'.repeat(32),
        }));
        const link = `xchain://multisig-sign?req=${base64urlnopad.encode(bytes)}`;
        expect(() => parseMultisigSessionLink(link)).toThrow('invalid signing request');
    });

    it('routes direct and protocol-handler links to the multisig sign screen', () => {
        const envelope = buildRequestEnvelope({
            kind: 'multisig-request-signature', sessionRef: SESSION_REF,
        });
        const link = buildMultisigSessionLink(envelope);
        expect(deepLinkRoute(link)).toEqual({ view: 'multisig-sign', initialLink: link });
        expect(deepLinkRoute(`web+xchain:${link}`)).toEqual({
            view: 'multisig-sign', initialLink: link,
        });
    });
});
