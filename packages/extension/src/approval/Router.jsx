// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useState } from 'react';
import { i18n } from '@xchain-wallet/core';
import { Screen } from '@xchain-wallet/core/ui';
import { RouteErrorBoundary } from '@xchain-wallet/core/shared/components/RouteErrorBoundary.jsx';
import { fetchApproval, resolveApproval } from './messaging.js';
import { ConnectApproval } from './kinds/ConnectApproval.jsx';
import { SignApproval } from './kinds/SignApproval.jsx';
import styles from './approval.module.css';

const { t } = i18n;
const SIGN_APPROVAL_KINDS = new Set([
    'signMessage',
    'signPsbt',
    'signAction',
    'coSign',
    'signIn',
]);

function getRequestId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id') || '';
}

/**
 * Top-level dispatcher for the approval window. Fetches the parked
 * request from the broker on mount, renders the matching kind-component,
 * and provides a shared `reject()` that settles the broker before the
 * window closes (so the bridge handler sees a `USER_REJECTED` instead
 * of the window-close fallback, which is semantically equivalent but
 * arrives via a different path).
 */
export function Router() {
    return (
        <RouteErrorBoundary>
            <ApprovalRoute />
        </RouteErrorBoundary>
    );
}

function ApprovalRoute() {
    const id = getRequestId();
    const [data, setData] = useState(
        /** @type {{ id: string, kind: string, payload: any } | null} */ (null),
    );
    const [error, setError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        if (!id) {
            setError('Missing approval id in URL.');
            return;
        }
        fetchApproval(id)
            .then(setData)
            .catch((err) => setError(err?.message || 'Failed to load request.'));
    }, [id]);

    const reject = useCallback(async () => {
        try {
            await resolveApproval(id, { approved: false });
        } catch (_err) {
            /* window.close still completes the rejection path */
        }
        window.close();
    }, [id]);

    if (error) {
        return (
            <Screen variant="small">
                <div role="alert" className={styles.error}>{error}</div>
            </Screen>
        );
    }
    if (!data) {
        return (
            <Screen variant="small">
                <p aria-live="polite">{t('extension.approval.loading')}</p>
            </Screen>
        );
    }

    if (data.kind === 'connect') {
        return <ConnectApproval id={id} payload={data.payload} onReject={reject} />;
    }
    if (!SIGN_APPROVAL_KINDS.has(data.kind)) {
        return (
            <Screen variant="popup">
                <div role="alert" className={styles.error}>
                    Unsupported approval request type.
                </div>
            </Screen>
        );
    }
    return (
        <SignApproval
            id={id}
            kind={data.kind}
            payload={data.payload}
            onReject={reject}
        />
    );
}
