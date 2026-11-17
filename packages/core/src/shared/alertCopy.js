// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The short copy of an alert row. Every row on the Notifications page is
// exactly three lines, each one line tall:
//   line 1  `label`    what kind of activity it is (the time sits beside it)
//   line 2  `title`    a short detail
//   line 3  `message`  the short description beneath it
// The full text stays where it was: the OS notification carries the long
// wording, and the row opens the page that holds the detail.
//
// Budgets are in characters and come from the 360 px phone width: the page
// gutter (2 x 16), the row padding (2 x 8), the 40 px icon and three 8 px
// grid gaps and the 10 px chevron leave about 238 px for lines 2 and 3, which
// span under the time. At 14 px (about 7.3 px a character) that is 32
// characters for the title; the message is set at 12 px (about 6.2 px a
// character), so 38. The label shares line 1 with the 48 px time at 10 px
// capitals with letter spacing (about 8 px a character), so 20. The row's CSS
// clamps each line to one line with an ellipsis, which is the backstop at a
// larger text scale; these budgets keep ordinary copy whole.

export const ALERT_LABEL_MAX = 20;
export const ALERT_TITLE_MAX = 32;
export const ALERT_MESSAGE_MAX = 38;

/** Cuts text to `max` characters, ending in an ellipsis when it was cut. */
export function clip(text, max) {
    const value = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (value.length <= max) return value;
    return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** A long id or index in a short form: `1a2b…89f` for anything over 8 characters. */
export function shortId(value) {
    const text = String(value ?? '').trim();
    return text.length > 8 ? `${text.slice(0, 4)}…${text.slice(-3)}` : text;
}

/** An amount that fits a title: over 12 characters ends in an ellipsis. */
export function shortAmount(value) {
    const text = String(value ?? '').trim();
    return text.length > 12 ? `${text.slice(0, 11)}…` : text;
}

function firstSentence(text) {
    const value = String(text ?? '').trim();
    const match = value.match(/^.*?[.!?](?=\s|$)/);
    return (match ? match[0] : value).replace(/[.!?]+$/, '');
}

/** The copy as the row stores it: every line inside its budget. */
function fit({ label, title, message }) {
    return {
        label: clip(label, ALERT_LABEL_MAX),
        title: clip(title, ALERT_TITLE_MAX),
        message: clip(message, ALERT_MESSAGE_MAX),
    };
}

export { fit as fitAlertCopy };

// The amount a payment notice quotes, read back from its own sentence
// ("Pay 0.5 BTC for ...", "0.5 BTC is due ...", "Paid 0.5 BTC for ...").
function quotedAmount(body) {
    const match = String(body || '').match(/(?:^|Pay |Paid )(\d[\d.,]*) ([A-Z][A-Z0-9.]*)(?: is due| for)/);
    return match ? `${shortAmount(match[1])} ${match[2]}` : '';
}

const MANUAL_COPY = {
    locked: (amount) => ({ title: 'Auto pay is paused', message: amount ? `Unlock to pay ${amount}` : 'Unlock to resume auto pay' }),
    'unusable-amount': () => ({ title: 'Payment needs attention', message: 'Amount due could not be read' }),
    'amounts-unavailable': () => ({ title: 'Payment needs attention', message: 'Payment could not be verified' }),
    'match-unavailable': () => ({ title: 'Payment needs attention', message: 'Payment could not be verified' }),
    'balance-short': (_amount, title) => ({ title, message: 'Fund its address or open Payments' }),
    'pay-failed': () => ({ title: 'Auto pay failed', message: 'Open Payments due before deadline' }),
    'past-arming-cutoff': (amount) => ({ title: amount ? `Pay ${amount}` : 'Payment is due', message: 'Auto pay is off, pay by hand' }),
    'past-retry-cutoff': (amount) => ({ title: amount ? `Pay ${amount}` : 'Payment is due', message: 'Auto pay is off, pay by hand' }),
};

/**
 * The three-line copy for a notification payload ({ kind, title, body, data }).
 * A kind this does not know falls back to the title and the first sentence of
 * the body, clipped to the budgets.
 *
 * @param {{ kind?: string, title?: string, body?: string, data?: any }} payload
 * @returns {{ label: string, title: string, message: string }}
 */
export function compactNotification(payload) {
    const kind = String(payload?.kind || '');
    const title = String(payload?.title || 'Wallet alert');
    const body = String(payload?.body || '');
    const data = payload?.data || {};
    switch (kind) {
        case 'incoming-pending':
            return fit({ label: 'Incoming payment', title, message: 'Waiting for confirmation' });
        case 'tx-confirmed':
            return fit({ label: 'Transaction', title, message: 'Your transaction is confirmed' });
        case 'incoming-message':
            return fit({ label: 'New message', title: 'You received a message', message: 'Open Messaging to read it' });
        case 'incoming-receipt':
            return fit({ label: 'Payment received', title, message: 'Arrived at your address' });
        case 'order-fill':
            return fit({ label: 'Order match', title, message: /^Swap/.test(title) ? 'Your swap was matched' : 'Your order was matched' });
        case 'dispenser-fill':
            return fit({ label: 'Dispenser', title: 'Dispenser sale', message: 'Someone bought from your dispenser' });
        case 'coinpay-required': {
            if (/^Payment due/.test(title)) return fit({ label: 'Payment due', title: 'Pay for a matched order', message: 'Pay before the window closes' });
            if (/^Order matched/.test(title)) return fit({ label: 'Order match', title: 'Awaiting the buyer payment', message: 'Buyer pays before window closes' });
            return fit({ label: 'Payment due', title: 'Coin payment due', message: 'Pay before the window closes' });
        }
        case 'coinpay-autopay-manual': {
            const amount = quotedAmount(body) || quotedAmount(`${title}`);
            const make = MANUAL_COPY[data.reason];
            const copy = make ? make(amount, title) : { title: amount ? `Pay ${amount}` : 'Payment needs attention', message: 'Open Payments due to review' };
            return fit({ label: 'Payment due', ...copy });
        }
        case 'coinpay-autopaid': {
            const amount = quotedAmount(body);
            return fit({ label: 'Auto pay', title: 'Auto pay complete', message: amount ? `Paid ${amount}` : 'Your payment was sent' });
        }
        case 'deadline-summary': {
            const window = body.match(/within (.+?)\./);
            return fit({ label: 'Deadlines', title, message: window ? `Items close within ${window[1]}` : 'Open Notifications to review' });
        }
        case 'deadline': {
            const when = body.match(/(?:expires|closes) (in [^.(]+?)(?: \(block|\.|$)/);
            const ref = data.actionIndex != null && data.actionIndex !== '' && data.kind !== 'poll' ? `#${shortId(data.actionIndex)} ` : '';
            const verb = data.kind === 'poll' ? 'Closes' : 'expires';
            const text = when ? `${ref}${verb} ${when[1]}` : firstSentence(body);
            return fit({ label: 'Expiring soon', title, message: text.charAt(0).toUpperCase() + text.slice(1) });
        }
        case 'dispenser-escrow': {
            const left = Number(data.dispensesLeft);
            const empty = /is empty$/.test(title);
            return fit({
                label: 'Dispenser',
                title,
                message: empty ? 'Top it up to resume sales' : Number.isFinite(left) ? `Enough for ${left} more buyer${left === 1 ? '' : 's'}` : 'Top it up soon',
            });
        }
        case 'governance-poll': {
            const tick = String(data.tick || '').trim();
            return fit({
                label: data.binding ? 'Binding poll' : 'Governance poll',
                title: tick ? `${tick} poll is open` : 'A poll is open',
                message: data.binding ? 'Its result triggers a contract' : data.endBlock != null ? `Closes at block ${data.endBlock}` : 'Open it to review',
            });
        }
        case 'price-alert':
            return fit({ label: 'Price alert', title: firstSentence(body) || title, message: 'Your price alert was triggered' });
        default:
            return fit({ label: '', title, message: firstSentence(body) });
    }
}

/** The three-line copy of the Home-notice alerts (payment due, pending airdrop). */
export function paymentDueCopy({ amount, ticker, order, watcher = false }) {
    return fit({
        label: 'Payment due',
        title: `Pay ${shortAmount(amount)}${ticker ? ` ${ticker}` : ''}`,
        message: watcher ? `Order #${shortId(order)}: build unsigned tx` : `Order #${shortId(order)}: sign to pay`,
    });
}

export function airdropCopy({ amount, token, count, stage }) {
    return fit({
        label: 'Airdrop',
        title: `${shortAmount(amount)} ${token} to ${count} ${count === 1 ? 'address' : 'addresses'}`,
        message: stage === 'waiting-index' ? 'Waiting for the list to index' : 'Ready to sign',
    });
}
