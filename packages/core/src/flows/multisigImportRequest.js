// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    fingerprintSessionRef,
    validateEnvelope,
} from '../uri/multisigPsbtEnvelope.js';
import {
    assertMultisigTransactionBinding,
    findMatchingMultisigConfig,
} from './multisigTransactionBinding.js';
import { startMultisigSigningSession } from './multisigSigning.js';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/multisig.js';

const REQUEST_KINDS = new Set([
    'multisig-request-signature',
    'multisig-request-nonce',
    'multisig-request-partial',
]);

export const FOREIGN_MULTISIG_REQUEST =
    'This signing request is for a multisig this wallet does not belong to.';

function userError(message) {
    const error = new Error(message);
    error.userFacing = true;
    return error;
}

function sessionRefFor(session) {
    return {
        chainId: session.chainId,
        scheme: session.scheme,
        threshold: session.threshold,
        cosignerPubkeys: session.cosignerPubkeys,
        msgHash: session.msgHash,
        psbtHex: session.psbtHex || '',
    };
}

/** Find or create the local session represented by a validated request envelope. */
export async function importMultisigSigningRequest({ vault, sdkRegistry, walletId, envelope }) {
    const request = validateEnvelope(envelope);
    if (!REQUEST_KINDS.has(request.kind)) {
        throw userError(t('multisig.signingLink.requestOnly'));
    }
    const { sessionRef } = request;
    if (request.fingerprint !== fingerprintSessionRef(sessionRef)) {
        throw userError(t('multisig.signingLink.badRequest'));
    }
    if (sessionRef.scheme === 'taproot-musig2') {
        throw userError(t('multisig.import.taprootUnsupported'));
    }
    if (!sessionRef.psbtHex) {
        throw userError(t('multisig.import.transactionRequired'));
    }
    if (typeof sessionRef.chainId !== 'string') {
        throw userError(t('multisig.import.chainRequired'));
    }

    const wallet = await vault.wallets.get(walletId);
    const config = findMatchingMultisigConfig(wallet, sessionRef);
    if (!config) {
        throw userError(FOREIGN_MULTISIG_REQUEST);
    }

    const candidate = {
        walletId,
        chainId: sessionRef.chainId,
        ...sessionRef,
    };
    await assertMultisigTransactionBinding({ vault, sdkRegistry, session: candidate });

    const sessions = await vault.multisigSigningSessions.list();
    const existing = sessions.find((session) => session.walletId === walletId
        && session.status !== 'cancelled'
        && fingerprintSessionRef(sessionRefFor(session)) === request.fingerprint);
    if (existing) return { sessionId: existing.id, created: false };

    const created = await startMultisigSigningSession({
        vault,
        walletId,
        chainId: sessionRef.chainId,
        multisigConfigId: config.id,
        msgHash: sessionRef.msgHash,
        psbtHex: sessionRef.psbtHex,
    });
    return { sessionId: created.id, created: true };
}
