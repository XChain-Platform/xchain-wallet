// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// What the Confirm Standard (G127, revised 2026-11-16: round 5 layout 1,
// Centred 64 One Card) says for one confirmation, worked out with no React so
// every part can be tested on its own: the status notice at the top (the
// network check's verdict), the hero subject, the name line, the action
// sentence, the facts card rows with the one address first (fees included, no
// Total block) and the short warning after the details.
// shared/components/ConfirmStandard.jsx draws the result.
//
// The sentence and the facts come from the host's decode of the COMPOSED
// action (decoded.summary and decoded.details), never from form state alone:
// with no collapsed technical details left on the page, the facts card is the
// one place that shows what was actually built. CONFIRM_KINDS adds only what
// the decoder cannot know (which address to show, a plainer sentence for the
// operator's named examples, the icon); every other kind falls back to the
// decoder's own summary with the chain name and the shown address taken out.

import { actionWarningLines, actionWarningTitle } from '../../flows/actionWarnings.js';
import {
    PREFLIGHT_CHECK_STATES,
    isNetworkApprovalFinding,
    networkApprovalIsPartial,
    preflightCheckState,
} from './preflightCheckState.js';
import { consensusRefusalMessage, isHardPreflightFinding, preflightFindingKey } from './preflightFindingKey.js';
import { unverifiedText, warningText } from './preflightFindingCopy.js';
import { formatDisplayAmount, sumDecimalStrings } from './amountFormat.js';
import { neutralizeControlText } from './textHardening.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/confirmStandard.js';
import '../../i18n/locales/en/actionWarnings.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/send.js';

const DRYRUN_UNAVAILABLE = 'DRYRUN_UNAVAILABLE';
const DRYRUN_ORACLE_FEES_OWED = 'DRYRUN_ORACLE_FEES_OWED';

/** A warning finding as a point: the copy the wallet vouches for, the producer's own words beneath. */
function warningPoint(f, key) {
    const { headline, detail } = warningText(f);
    return { key, text: headline, detail: detail || null };
}

/** No network verdict: true whether it was unreachable or declined, with its reason beneath. */
function unreachedPoint(f, key) {
    const reason = String(f?.message || '').trim();
    return { key, text: t('confirmStandard.warning.unreached'), detail: reason || null };
}

// Decoded labels that name where the action goes.
const ADDRESS_LABEL = /^(?:to|destination|recipient|receive address|dispenser address|delegate to|transfer ownership to|transfer initial supply to|transfer minted supply to|credit to|release to)$/i;
// Decoded labels whose value the sentence already says.
const SENTENCE_LABEL = /^(?:token|amount|quantity|give|get|name|token \(give\))$/i;

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A decoded value without the decoder's "(your address)" or "(contact: …)" mark. */
function bareValue(value) {
    return String(value ?? '').replace(/\s+\((?:your address|contact: [^)]*)\)$/, '').trim();
}

function detailOf(decoded, re) {
    const details = Array.isArray(decoded?.details) ? decoded.details : [];
    const hit = details.find((detail) => re.test(String(detail?.label || '')));
    return hit ? String(hit.value ?? '').trim() : '';
}

/** The ticker of a decoded "1,000 ABC" value: its last word, when it looks like one. */
function tickOf(value) {
    const word = String(value || '').trim().split(/\s+/).pop() || '';
    return /^[A-Za-z][A-Za-z0-9.]{0,23}$/.test(word) ? word.toUpperCase() : '';
}

/** Group the leading decimal in an amount-and-ticker phrase for display. */
function formatAmountPhrase(value) {
    const text = String(value || '').trim();
    const match = /^(\d+(?:\.\d+)?)(\s+.+)$/.exec(text);
    return match ? `${formatDisplayAmount(match[1])}${match[2]}` : text;
}

/** The high-level multi-send sentence, with asset totals kept in the facts. */
export function multiSendSentence(summary, recipients) {
    const rows = Array.isArray(recipients) ? recipients : [];
    if (rows.length < 2) return null;
    const totals = Array.isArray(summary?.totals) ? summary.totals.filter(Boolean) : [];
    const assets = aggregateRecipientAssets(rows);
    const subject = assets.length > 1
        ? t('confirmStandard.sentence.assetCount', { count: formatDisplayAmount(String(assets.length)) })
        : formatAmountPhrase(totals[0])
            || (assets[0] ? `${formatDisplayAmount(assets[0].amount)} ${assets[0].tick}` : '');
    return subject
        ? t('confirmStandard.sentence.sendMany', {
            totals: subject,
            count: formatDisplayAmount(String(rows.length)),
        })
        : null;
}

/** The sentence without a name the page shows on its own line (and the quotes around it). */
function withoutName(sentence, name) {
    if (!name) return sentence;
    return String(sentence || '')
        .split(`"${name}"`).join('')
        .split(name).join('')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,:;)])/g, '$1')
        .replace(/[:,]\s*$/, '')
        .trim();
}

/**
 * One entry per action kind. `address` picks the one address the page shows:
 * 'recipient' (where the action sends, else the address it happens on),
 * 'recipientOnly' (where it sends, or none), 'source' (the address it happens
 * on), or 'none' (the facts list several, as a multi-send does). `sentence`
 * returns a plainer sentence than the decoder's when it can, else null.
 * `icon` names an Icon for a kind with no token mark to show. Optional:
 * `addressLabel` names the shown address, `showSource: false` keeps the
 * spender's From fact off the page, `decodedFact` keeps, relabels or drops
 * (null) each decoded detail on the facts card, `heroTick` names the token
 * the hero icon shows when it is not the form's ticker or the decoded Token
 * (an order shows what you get), and `name` returns a user-chosen name (a
 * list's, a contract's, a file's) that the page puts on its own line above a
 * short fixed sentence, because such a name can be very long (operator
 * 2026-11-16 on the list transfer header).
 */
export const CONFIRM_KINDS = Object.freeze({
    send: {
        icon: 'send',
        address: 'recipient',
        sentence: ({ decoded, summary }) => {
            // The decoded amount arrives already in the review's display form.
            const amount = detailOf(decoded, /^amount$/i)
                || (summary.amount ? formatDisplayAmount(summary.amount) : '');
            const tick = detailOf(decoded, /^token$/i) || summary.ticker;
            return amount && tick ? t('confirmStandard.sentence.sendTo', { amount, tick }) : null;
        },
    },
    multiSend: {
        icon: 'send',
        address: 'none',
        sentence: ({ summary, recipients }) => multiSendSentence(summary, recipients),
    },
    sweep: { icon: 'sweep', address: 'recipient' },
    issue: {
        icon: 'mint',
        address: 'source',
        sentence: ({ decoded, summary }) => {
            const tick = detailOf(decoded, /^token$/i) || summary.ticker;
            return tick ? t('confirmStandard.sentence.issue', { tick }) : null;
        },
    },
    tokenSettings: { icon: 'token', address: 'source' },
    mint: { icon: 'mint', address: 'source' },
    destroy: { icon: 'trash', address: 'source' },
    order: {
        icon: 'market',
        address: 'source',
        // The hero is what the order buys.
        heroTick: ({ decoded }) => tickOf(detailOf(decoded, /^get$/i)),
        sentence: ({ decoded }) => {
            const give = detailOf(decoded, /^give$/i);
            const get = detailOf(decoded, /^get$/i);
            return give && get ? t('confirmStandard.sentence.buy', { give, get }) : null;
        },
    },
    orderChange: { icon: 'market', address: 'source' },
    orderPayment: { icon: 'coins', address: 'source' },
    dispenser: { icon: 'market', address: 'source' },
    airdrop: { icon: 'users', address: 'source' },
    dividend: { icon: 'coins', address: 'source' },
    // A list's name sits on its own line above the sentence, and the
    // decoder's sentence loses its quoted copy of it.
    listCreate: { icon: 'list', address: 'source', name: ({ decoded, summary }) => summary.listName || detailOf(decoded, /^name$/i) },
    // The address that matters is the new owner's, labelled so; the signing
    // wallet's fact says whose key signs, so no From address shows. The list
    // goes by its name on its own line, never its raw id, which appears once
    // as a fact only when nothing else identifies the list.
    listTransfer: {
        icon: 'list',
        address: 'recipientOnly',
        addressLabel: () => t('confirmStandard.newOwner'),
        showSource: false,
        name: ({ summary }) => summary.listName,
        sentence: ({ summary }) => (String(summary.listName || '').trim()
            ? t('confirmStandard.sentence.transferList')
            : t('confirmStandard.sentence.transferThisList')),
        decodedFact: ({ label, value, summary }) => {
            if (/^memo$/i.test(label)) return { label, value };
            // A composed destination that is not the hero's address (the
            // one equal to it is dropped before this) still shows.
            if (ADDRESS_LABEL.test(label)) {
                const bare = bareValue(value);
                return { label, value, address: !/\s/.test(bare) && bare.length >= 20 };
            }
            const formNamesList = Boolean(String(summary.listName || '').trim() || String(summary.listIndex || '').trim());
            if (/^(?:list action index|list)$/i.test(label) && !formNamesList) {
                const bare = bareValue(value).replace(/^#/, '');
                return { label: t('confirmStandard.fact.list'), value: `#${bare}` };
            }
            return null;
        },
    },
    listShare: {
        icon: 'share',
        address: 'source',
        name: ({ summary }) => summary.listName,
        sentence: ({ summary }) => (String(summary.listName || '').trim() ? t('confirmStandard.sentence.shareList') : null),
    },
    stake: { icon: 'stake', address: 'source' },
    vote: { icon: 'stake', address: 'source' },
    contractCall: { icon: 'contract', address: 'source', name: ({ decoded, summary }) => summary.contractName || detailOf(decoded, /^contract name$/i) },
    contractDeploy: { icon: 'contract', address: 'source', name: ({ decoded, summary }) => summary.contractName || detailOf(decoded, /^(?:contract name|name)$/i) },
    message: { icon: 'message', address: 'recipient' },
    broadcast: { icon: 'broadcast', address: 'source' },
    file: {
        icon: 'document',
        address: 'source',
        name: ({ decoded }) => detailOf(decoded, /^name$/i),
        sentence: ({ decoded }) => {
            if (!detailOf(decoded, /^name$/i)) return null;
            const gated = Boolean(detailOf(decoded, /^gate token$/i));
            // Encrypted without a gate is neither public nor gated: the
            // decoder's own sentence says it instead.
            if (!gated && detailOf(decoded, /^encryption$/i)) return null;
            return gated
                ? t('confirmStandard.sentence.publishGatedFile')
                : t('confirmStandard.sentence.publishFile');
        },
    },
    link: { icon: 'link', address: 'source' },
    addressLock: { icon: 'lock', address: 'source' },
    addressSettings: { icon: 'address', address: 'source' },
    price: { icon: 'chart', address: 'source' },
    // A new market's label is the creator's own words and can be long.
    bet: {
        icon: 'target',
        address: 'source',
        name: ({ decoded }) => (/^open a prediction market\b/i.test(String(decoded?.summary || '')) ? detailOf(decoded, /^market$/i) : ''),
        sentence: ({ summary }) => {
            const amount = summary.amount ? formatDisplayAmount(String(summary.amount)) : '';
            const tick = String(summary.ticker || '').trim().toUpperCase();
            const target = neutralizeControlText(String(summary.target || '').trim(), { maxLength: 80 });
            return amount && tick && target ? `Buy ${amount} ${tick} of ${target}` : null;
        },
    },
    bridge: { icon: 'migrate', address: 'recipient' },
    batch: { icon: 'grid', address: 'source' },
    signMessage: {
        icon: 'sign',
        address: 'source',
        sentence: () => t('components.messageConfirmScreen.signThisMessage'),
    },
    signTransaction: {
        icon: 'sign',
        address: 'none',
        sentence: () => t('confirmStandard.sentence.signTransaction'),
    },
    review: { icon: 'check', address: 'recipient' },
    other: {
        icon: 'action',
        address: 'none',
        showSource: false,
        sentence: () => t('confirmStandard.sentence.unknownAction'),
        heroTick: ({ decoded, summary }) => tickOf(
            detailOf(decoded, /^(?:asset|token|tick|ticker)$/i) || summary.ticker,
        ),
    },
});

const ACTION_KIND = Object.freeze({
    SEND: 'send',
    SWEEP: 'sweep',
    MINT: 'mint',
    DESTROY: 'destroy',
    COINPAY: 'orderPayment',
    DISPENSER: 'dispenser',
    AIRDROP: 'airdrop',
    DIVIDEND: 'dividend',
    STAKE: 'stake',
    UNSTAKE: 'stake',
    DELEGATE: 'stake',
    COLLECT: 'stake',
    VOTE: 'vote',
    EXECUTE: 'contractCall',
    DEPOSIT: 'contractCall',
    WITHDRAW: 'contractCall',
    DEPLOY: 'contractDeploy',
    MESSAGE: 'message',
    BROADCAST: 'broadcast',
    FILE: 'file',
    LINK: 'link',
    SLEEP: 'addressLock',
    ADDRESS: 'addressSettings',
    CALLBACK: 'tokenSettings',
    PRICE: 'price',
    BET: 'bet',
    XBRIDGE: 'bridge',
    BATCH: 'batch',
});

/**
 * The CONFIRM_KINDS key for one confirmation.
 *
 * @param {{ variant?: 'action'|'psbt'|'message', actionName?: string, decoded?: any, summary?: any }} args
 * @returns {keyof typeof CONFIRM_KINDS}
 */
export function confirmKindFor({ variant = 'action', actionName = '', decoded = null, summary = null } = {}) {
    if (variant === 'message') return 'signMessage';
    if (variant === 'psbt') return 'signTransaction';
    // A form that knows its kind names it, so the page does not depend on
    // the decoder's wording (a list transfer the dev host leaves undecoded).
    const named0 = String(summary?.kind || '');
    if (named0 && Object.prototype.hasOwnProperty.call(CONFIRM_KINDS, named0)) return named0;
    const text = String(decoded?.summary || '').trim();
    // An envelope that does not carry its action name is read by the decoded
    // sentence's verb, for the verbs that name one action unambiguously.
    const verb = text.split(/\s+/)[0].toUpperCase();
    const named = String(actionName || '').trim().toUpperCase().split('_')[0];
    const name = named || (['SEND', 'SWEEP', 'MINT', 'DESTROY', 'AIRDROP'].includes(verb) ? verb : '');
    const details = Array.isArray(decoded?.details) ? decoded.details : [];
    const has = (re) => details.some((detail) => re.test(String(detail?.label || '')));
    if (name === 'SEND') {
        const multi = has(/^recipient \d+$/i) || (Array.isArray(summary?.recipients) && summary.recipients.length > 1);
        return multi ? 'multiSend' : 'send';
    }
    if (name === 'ISSUE') {
        // A new token exactly when the decoder says so ("Create token …",
        // its rule: a max supply or an initial mint); every other ISSUE
        // shape changes an existing token.
        const creates = text ? /^create token\b/i.test(text) : has(/^(?:max supply|initial mint)$/i);
        return creates ? 'issue' : 'tokenSettings';
    }
    if (name === 'ORDER' || name === 'SWAP') {
        return /^(?:cancel|edit)\b/i.test(text) ? 'orderChange' : 'order';
    }
    if (name === 'LIST') {
        if (/^transfer\b/i.test(text)) return 'listTransfer';
        if (/^share\b/i.test(text)) return 'listShare';
        return 'listCreate';
    }
    return ACTION_KIND[name] || (name ? 'other' : 'review');
}

/**
 * The decoder's sentence made plain: its first line, without the chain name
 * (the chain shows on the token mark) and without the address the page shows
 * as the first fact row.
 *
 * @param {string} text
 * @param {{ chainName?: string, address?: string|null }} [opts]
 */
export function plainSentence(text, { chainName = '', address = null } = {}) {
    let sentence = String(text || '').split('\n')[0].trim();
    if (chainName) {
        sentence = sentence.replace(new RegExp(`\\s+on\\s+${escapeRegExp(chainName)}(?=$|[\\s:,(])`, 'i'), '');
    }
    if (address) {
        sentence = sentence
            .split(address).join('')
            .replace(/\s*\((?:your address|contact: [^)]*)\)/g, '');
    }
    return sentence
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,:;)])/g, '$1')
        .replace(/[:,]\s*$/, '')
        .trim();
}

function recipientsOf(summary) {
    return Array.isArray(summary?.recipients) ? summary.recipients.filter((row) => row && row.to) : [];
}

// A decoded multi-send leg reads "<amount> <tick> to <destination>", then an
// optional quoted memo.
const DECODED_LEG = /^(\S+) (\S+) to (\S+)(?: \(memo: "[\s\S]*"\))?$/;

/**
 * The recipient legs the host decoded from the composed bytes, read back from
 * the decode's "Recipient N" rows. Null unless there are at least two rows and
 * every one reads as a full leg, so a half-read set is never shown as the
 * composed truth.
 *
 * @param {{ details?: Array<{label?: string, value?: unknown}> } | null | undefined} decoded
 * @returns {Array<{ to: string, tick: string, amount: string }> | null}
 */
export function composedRecipients(decoded) {
    const rows = (Array.isArray(decoded?.details) ? decoded.details : [])
        .filter((detail) => /^recipient \d+$/i.test(String(detail?.label || '').trim()));
    if (rows.length < 2) return null;
    const legs = [];
    for (const row of rows) {
        const leg = DECODED_LEG.exec(String(row?.value ?? '').trim());
        if (!leg || leg[1] === '?' || leg[2] === '?') return null;
        legs.push({ amount: leg[1], tick: leg[2].toUpperCase(), to: leg[3] });
    }
    return legs;
}

/**
 * The page's top model: the kind, icon, sentence and address for the first fact.
 *
 * @param {{
 *   variant?: 'action'|'psbt'|'message',
 *   actionName?: string,
 *   decoded?: { summary?: string, details?: Array<{label: string, value: string}> } | null,
 *   summary?: import('../components/ConfirmSummary.jsx').ConfirmSummaryInput | null,
 *   sourceAddress?: string|null,
 *   chainName?: string,
 * }} args
 */
export function confirmHeadline({ variant = 'action', actionName = '', decoded = null, summary = null, sourceAddress = null, chainName = '' }) {
    const form = summary || {};
    const kind = confirmKindFor({ variant, actionName, decoded, summary: form });
    const spec = CONFIRM_KINDS[kind];
    // A multi-send's sentence and counts come from the legs the host decoded
    // from the composed bytes; the form's rows and totals only stand in when
    // the decode carries none.
    const composed = kind === 'multiSend' ? composedRecipients(decoded) : null;
    const recipients = composed || recipientsOf(form);
    const decodedRecipient = bareValue((Array.isArray(decoded?.details) ? decoded.details : [])
        .find((detail) => ADDRESS_LABEL.test(String(detail?.label || '')))?.value);
    const source = form.address || sourceAddress || null;
    let address = null;
    if (spec.address === 'recipient') address = form.recipient || decodedRecipient || source;
    else if (spec.address === 'recipientOnly') address = form.recipient || decodedRecipient || null;
    else if (spec.address === 'source') address = source;
    const ctx = { decoded, summary: composed ? { ...form, totals: [] } : form, recipients };
    const fromKind = spec.sentence ? spec.sentence(ctx) : null;
    const fromDecoder = plainSentence(decoded?.summary, { chainName, address });
    // With no decode at all, the form's own words: verb, amount, what it
    // works on, and "to" when the first address fact is where it goes.
    const verb = String(form.verb || '').trim();
    const amount = form.amount && form.ticker ? formatDisplayAmount(String(form.amount)) : '';
    const target = String(form.ticker || form.target || '').trim();
    const fromForm = verb
        ? [verb, amount, target].filter(Boolean).join(' ') + (address && address === form.recipient ? ' to' : '')
        : '';
    // A user-chosen name goes on its own line above the sentence, so the
    // sentence stays short however long the name is.
    const name = spec.name
        ? neutralizeControlText(String(spec.name(ctx) || '').trim(), { maxLength: 200 })
        : '';
    const sentence = withoutName(fromKind
        || fromDecoder
        || fromForm
        || t('confirmStandard.sentence.review'), name) || t('confirmStandard.sentence.review');
    const decodedTick = detailOf(decoded, /^token$/i);
    const defaultHeroTick = kind === 'other' ? '' : (form.ticker || decodedTick);
    const heroTick = String((spec.heroTick ? spec.heroTick(ctx) : '')
        || defaultHeroTick
        || '').trim().toUpperCase();
    return {
        kind,
        actionCode: kind === 'other' ? String(actionName || '').trim().toUpperCase() : '',
        icon: spec.icon,
        name,
        sentence,
        heroTick,
        address: address || null,
        addressLabel: address && spec.addressLabel ? spec.addressLabel() : '',
        showSource: spec.showSource !== false,
    };
}

/**
 * @typedef {object} ConfirmFact
 * @property {string} key
 * @property {string} label
 * @property {string} value          the text, also the full-value title when it is cut short
 * @property {boolean} [address]     the value is an address (cut in the middle, not at the end)
 * @property {import('react').ReactNode} [node]   drawn in place of the text; value stays the title
 * @property {string[]} [chips]      drawn as lock chips across the card's width (a token's locks)
 * @property {string} [testId]
 * @property {string} [assetTick]    draws this asset's token or coin icon beside the label
 * @property {string} [chainId]      chain used to resolve an asset's native coin or token mark
 */

/**
 * Put the confirmation's primary address at the start of the facts card.
 * AddressText can then show it whole when it fits and preserve both ends when
 * it does not. A caller-supplied copy is removed before the canonical row is
 * added, so the address still appears once.
 *
 * @param {{ facts?: ConfirmFact[], address?: string|null, addressIsSource?: boolean, addressLabel?: string }} args
 * @returns {ConfirmFact[]}
 */
export function withAddressFact({ facts = [], address = null, addressIsSource = false, addressLabel = '' } = {}) {
    const rows = Array.isArray(facts) ? facts : [];
    const value = String(address || '').trim();
    if (!value) {
        const primaryIndex = rows.findIndex((fact) => (
            fact?.testId === 'confirm-address' || fact?.testId === 'confirm-source'
        ));
        if (primaryIndex <= 0) return rows;
        return [rows[primaryIndex], ...rows.filter((_, index) => index !== primaryIndex)];
    }
    const label = String(addressLabel || '').trim()
        || t(addressIsSource ? 'send.fields.from' : 'send.fields.to');
    return [
        {
            key: 'address',
            label,
            value,
            address: true,
            testId: addressIsSource ? 'confirm-source' : 'confirm-address',
        },
        ...rows.filter((fact) => String(fact?.value || '').trim() !== value),
    ];
}

/**
 * A decoded "Locking: max supply, description" row as chips, one per lock.
 *
 * @param {string} value
 * @returns {string[]}
 */
export function lockChips(value) {
    return String(value || '').split(',').map((part) => part.trim()).filter(Boolean)
        .map((part) => t('confirmStandard.lockChip', { what: part.charAt(0).toUpperCase() + part.slice(1) }));
}

/**
 * The facts card's rows from the decode: every decoded detail except the ones
 * the sentence or the primary address fact already say, relabelled the way the
 * review has always named them.
 *
 * @param {{ decoded?: any, sentence: string, name?: string, address?: string|null, recipientsShown?: boolean, kind?: string|null, summary?: any }} args
 *   name: the name line above the sentence, never repeated as a row;
 *   recipientsShown: the per-asset recipient rows are on the card, so the
 *   decoder's "Recipient N" rows would say each one twice; kind: a
 *   CONFIRM_KINDS key whose decodedFact keeps the card short
 * @returns {ConfirmFact[]}
 */
export function decodedFacts({ decoded, sentence, name = '', address = null, recipientsShown = false, kind = null, summary = null }) {
    const details = Array.isArray(decoded?.details) ? decoded.details : [];
    const pick = kind && CONFIRM_KINDS[kind]?.decodedFact;
    const facts = [];
    details.forEach((detail, index) => {
        const label = String(detail?.label || '').trim();
        const value = String(detail?.value ?? '').trim();
        if (!label) return;
        if (kind === 'other') {
            facts.push({
                key: `decoded-${index}`,
                label: label.replace(/[\s-]+/g, '_').toUpperCase(),
                value,
                testId: 'confirm-raw-parameter',
            });
            return;
        }
        if (!value) return;
        const bare = bareValue(value);
        if (address && bare === address) return;
        if (name && bare === name) return;
        if (SENTENCE_LABEL.test(label) && sentence.includes(bare)) return;
        if (/^locking$/i.test(label)) {
            facts.push({ key: `decoded-${index}`, label: t('confirmStandard.fact.locks'), value, chips: lockChips(value), testId: 'confirm-locks' });
            return;
        }
        // Keep multi-send confirms bounded by assets even if a malformed leg
        // prevents the decoded aggregate from replacing the form fallback.
        if ((kind === 'multiSend' || recipientsShown) && /^recipient \d+$/i.test(label)) return;
        if (pick) {
            const kept = pick({ label, value, summary: summary || {} });
            if (kept) facts.push({ key: `decoded-${index}`, label: kept.label, value: kept.value, address: Boolean(kept.address) });
            return;
        }
        facts.push({
            key: `decoded-${index}`,
            label: reviewLabel(label),
            value,
            address: ADDRESS_LABEL.test(label) && !/\s/.test(bare) && bare.length >= 20,
        });
    });
    return facts;
}

function reviewLabel(label) {
    if (label === 'Give') return 'You send';
    if (label === 'Get') return 'You get';
    return label;
}

/**
 * Aggregate a multi-send by asset in first-appearance order. Addition stays
 * in decimal strings, so each asset keeps the exact precision its validated
 * recipient amounts carry and never crosses a floating-point conversion.
 *
 * @param {Array<{ to: string, tick: string, amount: string }>} recipients
 * @returns {Array<{ tick: string, amount: string, recipients: Set<string> }>}
 */
function aggregateRecipientAssets(recipients) {
    const assets = new Map();
    for (const row of (Array.isArray(recipients) ? recipients : [])) {
        const tick = String(row?.tick || '').trim().toUpperCase();
        const to = String(row?.to || '').trim();
        const rawAmount = String(row?.amount ?? '').trim();
        const amount = rawAmount.startsWith('.') ? `0${rawAmount}` : rawAmount;
        if (!tick || !to || !amount) continue;
        const existing = assets.get(tick) || { tick, amount: '0', recipients: new Set() };
        existing.amount = sumDecimalStrings([existing.amount, amount]);
        existing.recipients.add(to);
        assets.set(tick, existing);
    }
    return [...assets.values()];
}

/**
 * One facts-card row per asset in a multi-recipient send: its exact total and
 * its distinct recipient count. The number of rendered rows is O(assets), not
 * O(recipients).
 *
 * @param {Array<{ to: string, tick: string, amount: string }>} recipients
 * @param {string} [chainId]
 * @returns {ConfirmFact[]}
 */
export function recipientFacts(recipients, chainId = '') {
    if (!Array.isArray(recipients) || recipients.length < 2) return [];
    return aggregateRecipientAssets(recipients).map((asset) => {
        const recipientCount = asset.recipients.size;
        return {
            key: `asset-${asset.tick}`,
            label: asset.tick,
            value: t(recipientCount === 1
                ? 'confirmStandard.fact.assetRecipients.one'
                : 'confirmStandard.fact.assetRecipients.other', {
                amount: formatDisplayAmount(asset.amount),
                count: formatDisplayAmount(String(recipientCount)),
            }),
            assetTick: asset.tick,
            chainId: String(chainId || ''),
            testId: 'confirm-asset-summary',
        };
    });
}

/**
 * The facts card always names the network (G127 revised 2026-11-16: one card
 * holds every detail; the hero's pip is the only network mark beside it). The
 * row goes after the action's own rows and before the fee rows, replacing any
 * Network row a caller or the decode already gave.
 *
 * @param {{ facts?: ConfirmFact[], chainName?: string }} args
 * @returns {ConfirmFact[]}
 */
export function withNetworkFact({ facts = [], chainName = '' } = {}) {
    const rows = (Array.isArray(facts) ? facts : [])
        .filter((fact) => String(fact?.label || '').trim().toLowerCase() !== 'network');
    const network = String(chainName || '').trim();
    if (!network) return rows;
    const row = { key: 'network', label: 'Network', value: network, testId: 'confirm-network' };
    const firstFee = rows.findIndex((fact) => String(fact?.key || '').startsWith('fee-'));
    return firstFee === -1
        ? [...rows, row]
        : [...rows.slice(0, firstFee), row, ...rows.slice(firstFee)];
}

/**
 * @typedef {object} ConfirmFee
 * @property {string} key                 'network' | 'protocol' | 'oracle' | 'donation'
 * @property {string} label
 * @property {string|null} amount         decimal string; null when the fee is paid but its amount is not known
 * @property {string} ticker
 * @property {string|null} [fiat]
 * @property {string} [display]           the fee-line value when it says more than the amount (a donation's recipient)
 * @property {boolean} [notRefunded]      a native-coin protocol fee: an output that stays paid if the action is rejected
 */

/**
 * The fee rows of the facts card (G127 revised 2026-11-16: there is no Total
 * block; each fee is its own row). A known fee reads "0.0000184 BTC ($1.75)";
 * a native-coin protocol fee says it is not refunded if rejected; a fee that
 * will be paid but whose amount is not known yet still gets its row, so no
 * fee is ever silently left out. Each row keeps the `confirm-fee-<key>` test
 * id end-to-end checks find it by.
 *
 * @param {ConfirmFee[]} fees
 * @returns {ConfirmFact[]}
 */
export function feeFacts(fees) {
    return (Array.isArray(fees) ? fees : [])
        .filter((fee) => fee && (fee.amount === null || fee.amount === undefined || Number(String(fee.amount).replace(/,/g, '')) > 0))
        .map((fee) => {
            const known = fee.amount !== null && fee.amount !== undefined;
            const ticker = String(fee.ticker || '').toUpperCase();
            const amount = known ? `${formatDisplayAmount(String(fee.amount))} ${ticker}`.trim() : '';
            const shown = known ? (fee.display || amount) : t('confirmStandard.feeNotKnown');
            const priced = known && fee.fiat ? `${shown} (${String(fee.fiat).replace(/^~/, '')})` : shown;
            return {
                key: `fee-${fee.key}`,
                label: String(fee.label || ''),
                value: fee.notRefunded ? t('confirmStandard.notRefunded', { value: priced }) : priced,
                testId: `confirm-fee-${fee.key}`,
            };
        });
}

/**
 * @typedef {object} ConfirmStatus
 * @property {'success'|'danger'|'info'} tone
 * @property {string} title
 * @property {Array<{ key: string, text: string, detail?: string|null, place?: 'lead'|'after' }>} points
 *   each point is one issue, and several issues are a bulleted list (U101); a
 *   `lead` point is the plain sentence above the list and an `after` point the
 *   plain line under it
 * @property {Array<any>} overrides     error findings the user may sign anyway, each with its own box
 * @property {'alert'|'status'|null} role
 * @property {string} state             'checking', 'oracleFees' or a pre-flight state (pass, notChecked, partial, settleChecks, warn, fail)
 */

// Each unverified check's plain line, once: several codes share a line.
function uniqueHeadlines(unverified) {
    return [...new Set(unverified.map((u) => unverifiedText(u).headline))];
}

/**
 * The status notice, the first thing on the page (G127 revised 2026-11-16).
 * It is green ("Checked: this will go through.") only on the indexer's own
 * full approval (preflightCheckState pass) and red for anything short of it,
 * except an approval whose only gaps are checks settlement decides, which is
 * a blue note (settleChecks, operator 2026-11-17).
 * While the check runs it shows the checking line. It is null where no
 * network check applies (a message, a bare coin payment), so the page then
 * claims nothing either way. A failure carries its Sign anyway boxes, which
 * the Approve gate reads.
 *
 * @param {{
 *   report?: any,
 *   applies?: boolean,                 pre-flight applies to this confirmation
 *   loading?: boolean,                 the check is still running
 *   acknowledged?: Set<string>|null,   the Sign anyway boxes ticked so far
 *   approveGated?: boolean,            the report can hold Approve (false on a caller's PSBT, §5.5)
 * }} args
 * @returns {ConfirmStatus|null}
 */
export function confirmStatus({ report = null, applies = true, loading = false, acknowledged = null, approveGated = true } = {}) {
    if (!applies) return null;
    if (loading) {
        return { tone: 'info', title: t('confirmStandard.checking'), points: [], overrides: [], role: 'status', state: 'checking' };
    }
    const S = PREFLIGHT_CHECK_STATES;
    const findings = Array.isArray(report?.findings) ? report.findings : [];
    const oracleOwed = findings.find((f) => f?.code === DRYRUN_ORACLE_FEES_OWED) || null;
    const checkState = preflightCheckState(report);
    // Owed oracle fees keep the red notice they raise today, so the calm
    // settlement note never carries them.
    const state = checkState === S.SETTLE_CHECKS && oracleOwed ? S.PARTIAL : checkState;
    if (state === S.SETTLE_CHECKS) {
        // The wallet's headline names which limits wait; the SDK's reason text
        // is report-reader wording, so it stays out of this note.
        const settlePoints = [{ key: 'settle-checks', text: t('confirmStandard.settleChecks.body'), place: 'lead' }];
        uniqueHeadlines(report.unverified).forEach((text, i) => {
            settlePoints.push({ key: `settle-${i}`, text });
        });
        return {
            tone: 'info',
            title: t('confirmStandard.settleChecks.title'),
            points: settlePoints,
            overrides: [],
            role: 'status',
            state: S.SETTLE_CHECKS,
        };
    }
    const unavailable = findings.find((f) => f?.code === DRYRUN_UNAVAILABLE) || null;
    // The notice's data-state: the check state, or 'oracleFees' when only
    // owed oracle fees raise it on a passing check.
    let slotState = state;
    const points = [];
    const overrides = [];
    let title = null;
    if (state === S.FAIL) {
        title = t('confirmStandard.warning.fail');
        const errors = findings.filter((f) => f?.severity === 'error');
        const reasons = [...new Set(errors
            .map((f) => consensusRefusalMessage(f) || String(f?.message || '').trim())
            .filter(Boolean))];
        reasons.forEach((text, i) => points.push({ key: `fail-${i}`, text }));
        if (reasons.length === 0) points.push({ key: 'fail-unexplained', text: t('confirmStandard.warning.failUnexplained') });
        // A warning or an unanswered network check beside the failure is
        // still said, in the same notice.
        findings.filter((f) => f?.severity === 'warning').forEach((f, i) => points.push(warningPoint(f, `fail-warn-${i}`)));
        if (unavailable) points.push(unreachedPoint(unavailable, 'fail-unreached'));
        for (const f of errors) {
            if (approveGated && f?.overridable && !isHardPreflightFinding(f)) overrides.push(f);
        }
        const hard = errors.length === 0 || errors.some((f) => !(f?.overridable && !isHardPreflightFinding(f)));
        // Said only while the check really holds Approve: a caller's PSBT is
        // report-only (§5.5), and ticking every Sign anyway box releases it.
        const allTicked = overrides.length > 0
            && overrides.every((f) => acknowledged?.has?.(preflightFindingKey(f)));
        if (approveGated && (hard || !allTicked)) {
            points.push({
                key: 'fail-approve',
                text: hard ? t('confirmStandard.warning.approveOff') : t('confirmStandard.warning.signAnyway'),
                // What Approve does about the failure, not one more reason.
                place: 'after',
            });
        }
    } else if (state === S.WARN) {
        title = t('confirmStandard.warning.warn');
        findings.filter((f) => f?.severity === 'warning').forEach((f, i) => points.push(warningPoint(f, `warn-${i}`)));
        if (unavailable) points.push(unreachedPoint(unavailable, 'warn-unreached'));
    } else if (state === S.PARTIAL) {
        title = t('confirmStandard.warning.partial');
        const partial = findings.filter(isNetworkApprovalFinding).find(networkApprovalIsPartial);
        if (partial && Number.isInteger(partial.data?.accepted) && Number.isInteger(partial.data?.subCommandCount)) {
            points.push({
                key: 'partial-batch',
                text: t('confirmStandard.warning.partialBatch', { accepted: partial.data.accepted, total: partial.data.subCommandCount }),
                place: 'lead',
            });
        } else {
            // The summary sentence leads; the checks the network could not
            // verify follow it as the list.
            points.push({ key: 'partial', text: t('confirmStandard.warning.partialBody'), place: 'lead' });
        }
        if (report?.restricted) points.push({ key: 'restricted', text: t('confirmStandard.warning.restricted') });
        uniqueHeadlines(Array.isArray(report?.unverified) ? report.unverified : []).forEach((text, i) => {
            points.push({ key: `unverified-${i}`, text });
        });
    }
    // One short line, never a block (operator 2026-11-16).
    if (state === S.NOT_CHECKED) title = t('confirmStandard.warning.notCheckedLine');
    // A batch's oracle usage fees are a disclosure, not a verdict: the probe
    // carries no outputs, so the amounts owed are said whatever the state.
    if (oracleOwed) {
        points.push({ key: 'oracle-owed', text: t('confirmStandard.warning.oracleFeesOwed'), detail: String(oracleOwed.message || '').trim() || null });
        if (!title) {
            title = t('confirmStandard.warning.warn');
            slotState = 'oracleFees';
        }
    }
    if (!title) {
        return { tone: 'success', title: t('confirmStandard.status.checked'), points: [], overrides: [], role: 'status', state: S.PASS };
    }
    return {
        tone: 'danger',
        title,
        points,
        overrides,
        // A failed check interrupts; the others are polite.
        role: state === S.FAIL ? 'alert' : 'status',
        state: slotState,
    };
}

export function unknownActionStatus(status = null) {
    return {
        tone: 'danger',
        title: t('confirmStandard.status.unknownAction'),
        points: [{
            key: 'unknown-action',
            text: t('confirmStandard.status.unknownActionBody'),
        }],
        overrides: Array.isArray(status?.overrides) ? status.overrides : [],
        role: status?.role === 'alert' ? 'alert' : 'status',
        state: 'unknownAction',
    };
}

/**
 * @typedef {object} ConfirmWarning
 * @property {string} title
 * @property {Array<{ key: string, text: string, detail?: string|null }>} points
 * @property {Array<any>} overrides     always empty: Sign anyway rides with the status notice
 * @property {null} role                part of the page from first paint, so no live region
 * @property {string} state             'irreversible'
 * @property {string} [testId]          optional id for a warning producer inside the notice
 */

/**
 * The short warning after the details (G127 revised 2026-11-16): the kind's
 * title and its one line (what cannot be taken back), then the decoder's
 * lines the card does not already cover (withoutCoveredWarnings, applied by
 * the caller: a lint such as a memo the protocol will reject must stay) and
 * the caller's own lines, each said once. The network check's verdict is the
 * status notice's (confirmStatus), never here. Null when there is nothing to
 * say.
 *
 * @param {{
 *   actionWarningIds?: unknown,
 *   decodedWarnings?: string[],
 *   extraWarnings?: string[],
 *   testId?: string,
 * }} args
 * @returns {ConfirmWarning|null}
 */
export function confirmWarning({ actionWarningIds = null, decodedWarnings = [], extraWarnings = [], testId = undefined } = {}) {
    const irreversible = actionWarningLines(actionWarningIds);
    const title = irreversible.length > 0 ? actionWarningTitle(actionWarningIds) : null;
    const points = irreversible.map((line) => ({ key: `irreversible-${line.key}`, text: line.text }));
    const shown = new Set(points.map((point) => point.text));
    [...(decodedWarnings || []), ...(extraWarnings || [])].forEach((text, i) => {
        const value = String(text || '').trim();
        if (!value || shown.has(value)) return;
        shown.add(value);
        points.push({ key: `note-${i}`, text: value });
    });
    if (points.length === 0) return null;
    return {
        title: title || t('actionWarnings.title'),
        points,
        overrides: [],
        role: null,
        state: 'irreversible',
        testId,
    };
}
