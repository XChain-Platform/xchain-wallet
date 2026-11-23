// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { lazy } from 'react';
import { EmptyState, PageHeader, Screen } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/siteRequest.js';

const SignApproval = lazy(() => import('../approval/SignApproval.jsx')
    .then((module) => ({ default: module.SignApproval })));

const REQUEST_KINDS = Object.freeze({
    login: 'signIn',
    signAction: 'signAction',
    signMessage: 'signMessage',
    signPsbt: 'signPsbt',
});

function requestOrigin(request) {
    const target = request?.return || request?.callback;
    try {
        return new URL(target).origin;
    } catch {
        return '';
    }
}

export function siteRequestApprovalModel(request) {
    const params = request?.params && typeof request.params === 'object'
        ? request.params
        : {};
    const kind = REQUEST_KINDS[request?.method] || null;
    if (!kind || typeof request?.id !== 'string') return null;

    const approvalPayload = kind === 'signAction'
        ? {
            ...params.params,
            from: typeof params.from === 'string' ? { address: params.from } : params.from,
            requested: params.params,
        }
        : { ...params };

    return {
        id: request.id,
        kind,
        payload: {
            origin: requestOrigin(request),
            appName: request.app?.name,
            kind,
            chainId: params.chainId,
            ...(kind === 'signAction' ? { action: params.action } : {}),
            payload: approvalPayload,
        },
    };
}

export function SiteRequestApproval({ request, onReject }) {
    const approval = siteRequestApprovalModel(request);
    if (!approval) return null;
    return <SignApproval {...approval} onReject={onReject} />;
}

export function NewerWalletNeeded({ variant, onBack }) {
    return (
        <Screen
            variant={variant}
            header={<PageHeader onBack={onBack} title={null} />}
        >
            <EmptyState
                showWhileUnavailable
                title={t('siteRequest.newerWallet.title')}
                body={t('siteRequest.newerWallet.body')}
            />
        </Screen>
    );
}
