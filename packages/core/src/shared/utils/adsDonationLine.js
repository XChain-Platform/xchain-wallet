// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The confirm screen's automatic donation line (§36, operator ruling
// 2026-11-14): when the composed bytes carry the wallet's queued donation, the
// review names it before Approve, "Automatic donation $25.00 (0.00025 BTC) to
// Protocol". The coin figure is the output's own value, never a re-conversion.

import { formatNativeBaseUnits, tickerForDescriptor } from '../../registry/coinTicker.js';
import { formatFiatAmount } from './fiatAmountFormat.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

const RECIPIENT_KEYS = {
    protocol: 'components.confirmSummary.donationRecipientProtocol',
    community: 'components.confirmSummary.donationRecipientCommunity',
    explorer: 'components.confirmSummary.donationRecipientExplorer',
};

/** The display name of a donation recipient. */
export function donationRecipientLabel(recipient) {
    const key = RECIPIENT_KEYS[recipient];
    return key ? t(key) : '';
}

/**
 * @param {object} args
 * @param {{ adsPlan?: any } | null | undefined} args.composed   the compose envelope
 * @param {any} [args.descriptor]   the chain descriptor the bytes were built for
 * @param {string} [args.ticker]    the native ticker, when the caller already has it
 * @returns {{ fiat: string, coin: string, ticker: string, recipient: string, value: string, text: string } | null}
 *   null when these bytes carry no donation
 */
export function automaticDonationLine({ composed, descriptor = null, ticker = '' } = {}) {
    const plan = composed?.adsPlan;
    if (!plan?.canSubmit || !plan.donationAddress) return null;
    const coin = formatNativeBaseUnits(plan.donationAmount, descriptor);
    const fiat = plan.donationFiat ? formatFiatAmount(plan.donationFiat, plan.currency || 'USD') : '';
    if (!coin || !fiat) return null;
    const tick = ticker || plan.ticker || tickerForDescriptor(descriptor);
    const recipient = donationRecipientLabel(plan.recipient);
    // Object literals, so the i18n sweep can read each call's vars.
    return {
        fiat,
        coin,
        ticker: tick,
        recipient,
        value: t('components.confirmSummary.automaticDonationValue', { fiat, coin, ticker: tick, recipient }),
        text: t('components.confirmSummary.automaticDonationLine', { fiat, coin, ticker: tick, recipient }),
    };
}
