// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { ListPage } from '@xchain-wallet/core/ui';
import { TokenPicker } from './TokenPicker.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/common.js';
import '../../i18n/locales/en/send.js';

function SendListPage(props) {
    return <ListPage {...props} />;
}

/**
 * Send picker: the page Send's Asset field opens. Thin wrapper over the
 * shared {@link TokenPicker} with `purpose="send"`, which lists only the
 * spendable balances the active wallet/account holds. Selecting a row hands
 * {chainId, tick} back to the Send form.
 *
 * It offers the coin and its tokens, so the page is titled Asset like the
 * field that opens it (G60, as Receive's asset picker), and Back returns to
 * Send rather than Home.
 *
 * Props are forwarded verbatim; `hideOwnFilter` is accepted for backward
 * compatibility but no longer meaningful; the title-bar filter is the
 * single filter on every shell.
 *
 * @param {import('./TokenPicker.jsx').TokenPicker} props
 */
export function SendPicker(props) {
    // eslint-disable-next-line no-unused-vars -- drop legacy prop, forward rest
    const { hideOwnFilter, ...rest } = props;
    const walletScope = JSON.stringify([rest.walletId ?? null, rest.accountId ?? null]);
    return (
        <TokenPicker
            key={walletScope}
            title={t('send.asset')}
            backLabel={t('common.back')}
            {...rest}
            purpose="send"
            listPageComponent={SendListPage}
        />
    );
}
