// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CoSignerPolicyEditor (§22, P4 passive co-signer, management UI).
//
// A controlled editor for the spending policy an agent account enforces. It
// works on a UI-friendly "draft" (strings + repeatable rows) rather than the
// stored policy shape, so nested maps like maxPerAction never have to be
// hand-typed. The parent turns the draft into the flow payload via
// buildPolicyDraft(), then declarePolicyTokenIds() records the token number of
// every ticker the rules name, before calling provision/update.
//
// Reused by both CoSignerProvision (author) and CoSignerAccountDetail (edit),
// so all policy-shape knowledge lives in one place.

import { useState } from 'react';
import {
    Button,
    Checkbox,
    FormPage,
    FormSection,
    Icon,
    IconSelect,
    InfoTip,
    OptionalPill,
    Input,
    Select,
    Switch,
} from '@xchain-wallet/core/ui';
import { AmountField } from '../components/AmountField.jsx';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { actionOptionIcon } from '../utils/actionOptionIcon.jsx';
import { BITCOIN_ACTIONS } from '../../registry/actions.js';
import { allowedTicksMode, nativeTickForChain, normalizeAllowedTicks } from '../../cosigner/allowedTicks.js';
import { applyTickLookup, policyTickNames } from '../../cosigner/tickIdResolver.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/coSigner.js';
import '../../i18n/locales/en/home.js';
import '../../i18n/locales/en/send.js';
import styles from './CoSignerPolicyEditor.module.css';
import sectionStyles from './IssueTokenForm.module.css';

// One year: the longest rolling-limit window the editor accepts.
const MAX_WINDOW_HOURS = 8760;

/**
 * @typedef {Object} PolicyDraft
 * @property {string} allowedActionsText
 * @property {Array<{ action: string, tick: string, cap: string }>} maxPerAction
 * @property {boolean} windowEnabled
 * @property {string} windowHours
 * @property {string} windowMaxActions
 * @property {Array<{ tick: string, cap: string }>} windowPerTick
 * @property {Array<{ tick: string, amount: string }>} confirmAbove
 * @property {Array<{ address: string }>} allowedDestinations
 * @property {Array<{ address: string, maxValue: string }>} allowedOutputs
 * @property {'any' | 'none' | 'list'} tokenMode
 * @property {string} allowedTicksText
 */

/** @returns {PolicyDraft} */
export function emptyPolicyDraft() {
    return {
        allowedActionsText: '',
        tokenMode: 'any',
        allowedTicksText: '',
        maxPerAction: [],
        windowEnabled: false,
        windowHours: '24',
        windowMaxActions: '',
        windowPerTick: [],
        confirmAbove: [],
        allowedDestinations: [],
        allowedOutputs: [],
    };
}

// Split the free-text action list on commas / whitespace, uppercase, dedupe.
function parseActions(text) {
    const seen = new Set();
    const out = [];
    for (const raw of String(text || '').split(/[\s,]+/)) {
        const a = raw.trim().toUpperCase();
        if (!a || seen.has(a)) continue;
        seen.add(a);
        out.push(a);
    }
    return out;
}

// A ticker as typed into the Allowed tokens list: letters, digits and the
// protocol's . - _ marks; no ^id references or list separators.
const TICK_TEXT_RE = /^[A-Z0-9][A-Z0-9._-]*$/;

// Split the typed token list on commas / whitespace, fold to upper case, dedupe.
function parseTickList(text) {
    return normalizeAllowedTicks(String(text || '').split(/[\s,]+/));
}

function tickerPolicyKey(value) {
    return String(value || '').trim().toUpperCase();
}

function isNonNegativeDecimal(value) {
    return /^\d+(?:\.\d+)?$/.test(value);
}

/**
 * Rebuild an editor draft from a stored CoSignerAccount, so the edit screen
 * pre-fills exactly what provisioning stored (round-trips through
 * buildPolicyDraft without loss for the fields the UI exposes).
 *
 * @param {import('../../schemas/coSignerAccount.js').CoSignerAccount} account
 * @returns {PolicyDraft}
 */
export function draftFromAccount(account) {
    const draft = emptyPolicyDraft();
    if (!account || !account.policy) return draft;
    const p = account.policy;

    draft.allowedActionsText = Array.isArray(p.allowedActions) ? p.allowedActions.join(', ') : '';
    draft.tokenMode = allowedTicksMode(p);
    draft.allowedTicksText = draft.tokenMode === 'list' ? normalizeAllowedTicks(p.allowedTicks).join(', ') : '';

    if (p.maxPerAction && typeof p.maxPerAction === 'object') {
        for (const [action, byTick] of Object.entries(p.maxPerAction)) {
            if (!byTick || typeof byTick !== 'object') continue;
            for (const [tick, cap] of Object.entries(byTick)) {
                draft.maxPerAction.push({ action, tick, cap: String(cap) });
            }
        }
    }

    if (p.maxPerWindow && typeof p.maxPerWindow === 'object') {
        draft.windowEnabled = true;
        draft.windowHours = p.maxPerWindow.hours != null ? String(p.maxPerWindow.hours) : '';
        draft.windowMaxActions = p.maxPerWindow.maxActions != null ? String(p.maxPerWindow.maxActions) : '';
        if (p.maxPerWindow.perTick && typeof p.maxPerWindow.perTick === 'object') {
            for (const [tick, cap] of Object.entries(p.maxPerWindow.perTick)) {
                draft.windowPerTick.push({ tick, cap: String(cap) });
            }
        }
    }

    if (p.confirmAbove && p.confirmAbove.perTick && typeof p.confirmAbove.perTick === 'object') {
        for (const [tick, amount] of Object.entries(p.confirmAbove.perTick)) {
            draft.confirmAbove.push({ tick, amount: String(amount) });
        }
    }

    if (Array.isArray(p.allowedDestinations)) {
        draft.allowedDestinations = p.allowedDestinations.map((address) => ({ address: String(address) }));
    }

    if (Array.isArray(account.allowedOutputs)) {
        draft.allowedOutputs = account.allowedOutputs.map((o) => ({
            address: o.address || o.script || '',
            maxValue: o.maxValue != null ? String(o.maxValue) : '',
        }));
    }

    return draft;
}

/**
 * Turn a draft into the flow payload. Returns `{ policy, allowedOutputs }` on
 * success or `{ error }` with a plain-language message on the first problem
 * (so the caller can block submit and surface it).
 *
 * @param {PolicyDraft} draft
 * @returns {{ policy: object, allowedOutputs: object[] } | { error: string }}
 */
export function buildPolicyDraft(draft) {
    const allowedActions = parseActions(draft.allowedActionsText);
    if (allowedActions.length === 0) {
        return { error: `Tick at least one allowed action (for example ${actionDisplayLabel('SEND')}).` };
    }

    // Allowed tokens: Any leaves the key off, None stores [], a list stores
    // the folded tickers. A ^id reference or a separator is never a ticker.
    let allowedTicks;
    const tokenMode = draft.tokenMode || 'any';
    if (tokenMode === 'none') {
        allowedTicks = [];
    } else if (tokenMode === 'list') {
        const ticks = parseTickList(draft.allowedTicksText);
        if (ticks.length === 0) return { error: t('coSigner.policy.tokens.errorEmpty') };
        const bad = ticks.find((tick) => !TICK_TEXT_RE.test(tick));
        if (bad) return { error: t('coSigner.policy.tokens.errorTicker', { tick: bad }) };
        allowedTicks = ticks;
    }

    // maxPerAction: { ACTION: { TICK: cap } }. Skip blank rows; a cap must be
    // present when an action row is filled in.
    let maxPerAction = null;
    for (const row of draft.maxPerAction) {
        const action = String(row.action || '').trim().toUpperCase();
        const tick = tickerPolicyKey(row.tick) || '*';
        const cap = String(row.cap || '').trim();
        if (!action && !cap) continue;
        if (!action) return { error: 'A per-action limit is missing its action name.' };
        if (!cap) return { error: `Per-action limit for ${actionMessageName(action)} is missing an amount.` };
        if (!isNonNegativeDecimal(cap)) {
            return { error: `Per-action limit for ${actionMessageName(action)} must be a non-negative number.` };
        }
        // Refuse a limit on an action the agent may not sign, such as a typo like SENDD
        // (the co-signer matches caps by exact name, so that limit would never apply).
        if (!allowedActions.includes(action)) {
            return { error: `The limit for ${actionMessageName(action)} doesn't match any allowed action, so it would never be enforced. Choose one of the allowed actions or remove the limit.` };
        }
        maxPerAction = maxPerAction || Object.create(null);
        maxPerAction[action] = maxPerAction[action] || Object.create(null);
        if (Object.hasOwn(maxPerAction[action], tick)) {
            return { error: `Per-action limit for ${actionMessageName(action)} and ${tick} is listed more than once.` };
        }
        maxPerAction[action][tick] = cap;
    }

    // maxPerWindow: only when explicitly enabled and given a positive window.
    let maxPerWindow = null;
    if (draft.windowEnabled) {
        // Plain decimal text only: Number() also reads "0x10" and "1e1" as 16 and 10.
        const hoursText = String(draft.windowHours ?? '').trim();
        const hours = /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(hoursText) ? Number(hoursText) : NaN;
        if (Number.isNaN(hours) || hours <= 0) {
            return { error: 'The rolling limit needs a window length in hours greater than zero.' };
        }
        // A window past one year never lets old activity expire in practice,
        // so the typed length would not describe a rolling limit. A digit string
        // too long for a double reads as Infinity and gets the same answer.
        if (hours > MAX_WINDOW_HOURS) {
            return { error: `The rolling limit window can be at most ${MAX_WINDOW_HOURS} hours (one year).` };
        }
        maxPerWindow = { hours };
        const maxActions = String(draft.windowMaxActions || '').trim();
        if (maxActions) {
            const n = /^\d+$/.test(maxActions) ? Number(maxActions) : NaN;
            if (!Number.isSafeInteger(n) || n <= 0) return { error: 'Max actions per window must be a positive whole number.' };
            maxPerWindow.maxActions = n;
        }
        let perTick = null;
        for (const row of draft.windowPerTick) {
            const tick = tickerPolicyKey(row.tick);
            const cap = String(row.cap || '').trim();
            if (!tick && !cap) continue;
            if (!tick || !cap) return { error: 'A rolling per-token limit row is incomplete.' };
            if (!isNonNegativeDecimal(cap)) {
                return { error: `Rolling limit for ${tick} must be a non-negative number.` };
            }
            perTick = perTick || Object.create(null);
            if (Object.hasOwn(perTick, tick)) {
                return { error: `Rolling limit for ${tick} is listed more than once.` };
            }
            perTick[tick] = cap;
        }
        if (perTick) maxPerWindow.perTick = perTick;
        if (maxPerWindow.maxActions === undefined && !perTick) {
            return { error: 'The rolling limit needs a max action count or at least one per-token limit.' };
        }
    }

    // confirmAbove: { perTick: { TICK: amount } }.
    let confirmAbove = null;
    let confirmPerTick = null;
    for (const row of draft.confirmAbove) {
        const tick = tickerPolicyKey(row.tick);
        const amount = String(row.amount || '').trim();
        if (!tick && !amount) continue;
        if (!tick || !amount) return { error: 'A confirmation-threshold row is incomplete.' };
        if (!isNonNegativeDecimal(amount)) {
            return { error: `Confirmation threshold for ${tick} must be a non-negative number.` };
        }
        confirmPerTick = confirmPerTick || Object.create(null);
        if (Object.hasOwn(confirmPerTick, tick)) {
            return { error: `Confirmation threshold for ${tick} is listed more than once.` };
        }
        confirmPerTick[tick] = amount;
    }
    if (confirmPerTick) confirmAbove = { perTick: confirmPerTick };

    // allowedDestinations: array of addresses, or null for "any".
    const dests = draft.allowedDestinations
        .map((r) => String(r.address || '').trim())
        .filter((a) => a.length > 0);
    const allowedDestinations = dests.length > 0 ? dests : null;

    // allowedOutputs (anti-drain). Stored address-form; the schema accepts
    // either address or script and the SDK output gate resolves as needed.
    // The co-signer matches each output to the first entry with its script, so a
    // second entry for the same address carries a cap that is never enforced.
    const allowedOutputs = [];
    const seenOutputs = new Set();
    for (const row of draft.allowedOutputs) {
        const address = String(row.address || '').trim();
        const mv = String(row.maxValue || '').trim();
        if (!address && !mv) continue;
        if (!address) return { error: 'An allowed-output max value is missing its address.' };
        // Bech32 addresses are case-insensitive; base58 addresses are not.
        const outputKey = /^(?:bc|tb|bcrt)1/i.test(address) ? address.toLowerCase() : address;
        if (seenOutputs.has(outputKey)) {
            return { error: `Allowed output ${address} is listed more than once. Keep one row with the max value you want.` };
        }
        seenOutputs.add(outputKey);
        const out = { address };
        if (mv) {
            const n = /^\d+$/.test(mv) ? Number(mv) : NaN;
            // Beyond 2^53 the number stored is not the number typed, so refuse it.
            if (!Number.isSafeInteger(n) || n < 0) return { error: `Allowed-output max value for ${address} must be a whole number no greater than ${Number.MAX_SAFE_INTEGER}.` };
            out.maxValue = n;
        }
        allowedOutputs.push(out);
    }

    return {
        policy: {
            allowedActions,
            allowedDestinations,
            maxPerAction,
            maxPerWindow,
            confirmAbove,
            ...(allowedTicks === undefined ? {} : { allowedTicks }),
        },
        allowedOutputs,
    };
}

const TOKEN_PROBLEM_KEYS = {
    missing: 'coSigner.policy.tokens.notFound',
    failed: 'coSigner.policy.tokens.notChecked',
    duplicate: 'coSigner.policy.tokens.sharedNumber',
};

/**
 * The save step after buildPolicyDraft: look up the token number of every
 * ticker the built policy names on the account's chain and store them as
 * policy.tickIds, the only map the co-signer reads to match a token an agent
 * names by number. Runs only when the owner saves (never while typing), one
 * read per distinct ticker. A ticker the network does not know, one the
 * lookup could not check, or two sharing a number refuse the save, with a
 * message per ticker for its field.
 *
 * @param {{ policy: object, chainId: string, messaging: { resolveCoSignerTokenIds?: Function } | null }} opts
 * @returns {Promise<{ policy: object, tokenIds: Record<string, number> } | { error: string, tokenErrors: Record<string, string> }>}
 */
export async function declarePolicyTokenIds({ policy, chainId, messaging }) {
    const ticks = policyTickNames(policy, { nativeTick: nativeTickForChain(chainId) });
    const unchecked = (list) => ({
        error: t('coSigner.policy.tokens.saveError'),
        tokenErrors: Object.fromEntries(list.map((tick) => [tick, t(TOKEN_PROBLEM_KEYS.failed, { tick })])),
    });
    let lookup = { ids: {}, missing: [], failed: [], duplicate: [], noId: [] };
    if (ticks.length > 0) {
        if (!messaging || typeof messaging.resolveCoSignerTokenIds !== 'function') {
            return { error: t('coSigner.policy.tokens.lookupUnavailable'), tokenErrors: {} };
        }
        try {
            lookup = await messaging.resolveCoSignerTokenIds({ chainId, ticks });
        } catch {
            return unchecked(ticks);
        }
        if (!lookup || typeof lookup !== 'object') return unchecked(ticks);
        // Every named ticker needs an answer; one the host left out counts as unchecked.
        const answered = new Set([
            ...Object.keys(lookup.ids || {}),
            ...(lookup.missing || []), ...(lookup.failed || []), ...(lookup.duplicate || []), ...(lookup.noId || []),
        ]);
        const unanswered = ticks.filter((tick) => !answered.has(tick));
        if (unanswered.length > 0) lookup = { ...lookup, failed: [...(lookup.failed || []), ...unanswered] };
    }
    const applied = applyTickLookup(policy, lookup);
    if (!applied.ok) {
        return {
            error: t('coSigner.policy.tokens.saveError'),
            tokenErrors: Object.fromEntries(Object.entries(applied.problems)
                .map(([tick, kind]) => [tick, t(TOKEN_PROBLEM_KEYS[kind], { tick })])),
        };
    }
    return { policy: applied.policy, tokenIds: applied.policy.tickIds || {} };
}

const fieldsetStyle = {
    margin: '0 0 var(--xc-space-3) 0',
};

// The stored policy keys are the protocol's own wire names, and they must stay
// byte-identical to them (the co-sign gate is an exact-match membership test
// over the action decoded from the PSBT). Every READ surface, including this
// account's own detail screen, shows those keys through actionDisplayLabel, so
// an owner reads "Send, Issue" there and is asked for "SEND, ISSUE" here with
// nothing connecting the two vocabularies. The editor offers each action by
// that same label and writes the raw key behind it, so the owner never types a code.
const KNOWN_ACTIONS = new Set(BITCOIN_ACTIONS);

// Name an action in an error message by the label the picker shows; an unknown key stays raw
// so a typo is not dressed up as a real action (the same rule previewActions follows).
function actionMessageName(key) {
    return KNOWN_ACTIONS.has(key) ? actionDisplayLabel(key) : key;
}

// List the pickable actions alphabetically by the label the owner reads.
const ACTION_CHOICES = BITCOIN_ACTIONS
    .map((key) => ({ key, label: actionDisplayLabel(key) }))
    .sort((a, b) => a.label.localeCompare(b.label));

/**
 * Human-readable echo of the typed action list, one entry per parsed name.
 * A name the protocol has no format for is marked rather than humanized
 * silently: the Title Case fallback turns a typo ("SENDD") into a
 * plausible-looking label ("Sendd"), which would present a policy line the
 * co-signer will never match as if it were a real permission.
 *
 * @param {string} text
 * @returns {Array<{ key: string, label: string, known: boolean }>}
 */
function previewActions(text) {
    return parseActions(text).map((key) => ({
        key,
        label: actionDisplayLabel(key),
        known: KNOWN_ACTIONS.has(key),
    }));
}

// The Allowed tokens line as the closed section and the read surfaces show it.
export function tokenSummary(draft) {
    const mode = draft?.tokenMode || 'any';
    if (mode === 'none') return t('send.advanced.none');
    if (mode === 'list') {
        const ticks = parseTickList(draft.allowedTicksText);
        return ticks.length ? ticks.join(', ') : t('coSigner.policy.tokens.nonePicked');
    }
    return t('coSigner.policy.tokens.any');
}

const helpStyle = { fontSize: '0.85em', color: 'var(--xc-text-muted)', margin: '0 0 var(--xc-space-2) 0' };
const rowStyle = { display: 'flex', flexWrap: 'wrap', gap: 'var(--xc-space-2)', alignItems: 'flex-end', marginBottom: 'var(--xc-space-2)' };
const pickerStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))',
    gap: 'var(--xc-space-1) var(--xc-space-3)',
    marginBottom: 'var(--xc-space-2)',
};
/**
 * Controlled policy editor.
 *
 * @param {object} props
 * @param {PolicyDraft} props.value
 * @param {(next: PolicyDraft) => void} props.onChange
 */
// A row's Remove: red with the trash icon, as every Remove is.
function RemoveButton({ onClick, ...rest }) {
    return (
        <Button type="button" variant="danger" size="sm" icon={<Icon.TrashIcon />} onClick={onClick} {...rest}>
            Remove
        </Button>
    );
}

// One collapsible line drawn with the shared section styles: icon, title,
// Optional pill, the ? help, a closed summary and a chevron.
function PolicySection({ id, title, icon: SectionIcon, optional = false, defaultOpen = false, summary, children }) {
    const [open, setOpen] = useState(defaultOpen);
    const panelId = `policy-section-${id}`;
    return (
        // The first section sits 8px under the field above it, like the others.
        <section className={sectionStyles.optionalSection} aria-label={title} style={id === 'actions' ? { marginBlockStart: 'calc(var(--xc-space-2) - var(--xc-form-gap, var(--xc-space-4)))' } : undefined}>
            <Button
                type="button"
                variant="rowAction"
                icon={null}
                className={sectionStyles.sectionHeader}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen((v) => !v)}
            >
                <span className={sectionStyles.sectionIcon} aria-hidden="true"><SectionIcon /></span>
                <span className={sectionStyles.sectionTitle}>{title}</span>
                {optional ? <OptionalPill /> : null}
                {!open ? <span className={sectionStyles.sectionSummary}>{summary}</span> : null}
                <span
                    className={`${sectionStyles.sectionChevron} ${open ? `${sectionStyles.sectionChevronOpen} ${sectionStyles.sectionChevronTrailing}` : ''}`}
                    aria-hidden="true"
                >
                    <Icon.ChevronDownIcon />
                </span>
            </Button>
            <div id={panelId} className={sectionStyles.sectionBody} hidden={!open}>
                {/* The group's explanation rides on its first control's '?' tip
                    (the Actions group, the token choice, the rolling switch, the
                    Add button's row), never a loose muted paragraph (U57). */}
                {children}
            </div>
        </section>
    );
}

/**
 * @param {object} props
 * @param {PolicyDraft} props.value
 * @param {(next: PolicyDraft) => void} props.onChange
 * @param {Record<string, number> | null} [props.tokenIds]     token numbers saved with the rules (or found by the last save)
 * @param {Record<string, string> | null} [props.tokenErrors]  per-ticker messages from the last save's lookup
 */
export function CoSignerPolicyEditor({ value, onChange, tokenIds = null, tokenErrors = null }) {
    // Defensive defaults keep the component renderable even when mounted
    // without a controlled value (e.g. the route-render sweep).
    const draft = value || emptyPolicyDraft();
    const tickError = (tick) => (tokenErrors ? tokenErrors[tickerPolicyKey(tick)] : undefined) || undefined;
    const listedErrors = draft.tokenMode === 'list'
        ? parseTickList(draft.allowedTicksText).map((tick) => tickError(tick)).filter(Boolean)
        : [];
    const savedNumbers = tokenIds && typeof tokenIds === 'object'
        ? Object.keys(tokenIds).map((tick) => t('coSigner.policy.tokens.numberEntry', { tick, id: String(tokenIds[tick]) }))
        : [];
    const emit = typeof onChange === 'function' ? onChange : () => {};
    const set = (patch) => emit({ ...draft, ...patch });

    const addRow = (key, empty) => set({ [key]: [...draft[key], empty] });
    const removeRow = (key, i) => set({ [key]: draft[key].filter((_, idx) => idx !== i) });
    const patchRow = (key, i, patch) => set({
        [key]: draft[key].map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    });
    const actionPreview = previewActions(draft.allowedActionsText);
    const pickedKeys = actionPreview.map((a) => a.key);
    // Rewrite the action list from raw keys; every other key, unknown ones included, keeps its place.
    const writeKeys = (keys) => set({ allowedActionsText: keys.join(', ') });
    const toggleAction = (key, on) => {
        const rest = pickedKeys.filter((k) => k !== key);
        writeKeys(on ? (pickedKeys.includes(key) ? pickedKeys : [...pickedKeys, key]) : rest);
    };

    return (
        // No "Policy rules" heading; the sections join the parent form's flow.
        <div style={{ display: 'contents' }} aria-label="Agent spending policy">
            <PolicySection title="Allowed actions" icon={Icon.CheckIcon} {...{ id: 'actions', defaultOpen: true, summary: actionPreview.length ? actionPreview.map((a) => a.label).join(', ') : 'None picked' }}>
                <span className={styles.groupLabel}>
                    Actions
                    <InfoTip label="Choose which actions the agent may sign. The agent can never sign an action that is not selected." aria="About allowed actions" />
                </span>
                <div style={pickerStyle} role="group" aria-label="Actions">
                    {ACTION_CHOICES.map(({ key, label }) => (
                        <Checkbox
                            key={key}
                            label={label}
                            value={key}
                            checked={pickedKeys.includes(key)}
                            onChange={(e) => toggleAction(key, e.target.checked)}
                        />
                    ))}
                </div>
                {actionPreview.length > 0 ? (
                    <p style={helpStyle} data-testid="allowed-actions-preview">
                        This agent may sign:{' '}
                        {actionPreview.map((a, i) => (
                            <span key={a.key}>
                                {i > 0 ? ', ' : null}
                                {a.known ? a.label : `${a.key} (not a known action)`}
                                {/* Keep an unknown stored key until the owner removes it on purpose. */}
                                {a.known ? null : (
                                    <>
                                        {' '}
                                        <RemoveButton
                                            aria-label={`Remove ${a.key}`}
                                            onClick={() => writeKeys(pickedKeys.filter((k) => k !== a.key))}
                                        />
                                    </>
                                )}
                            </span>
                        ))}
                    </p>
                ) : null}
            </PolicySection>

            {/* Which tokens the agent may move, beside the actions it may sign. */}
            <PolicySection title={t('coSigner.policy.tokens.title')} icon={Icon.CoinsIcon} {...{ id: 'tokens', defaultOpen: true, summary: tokenSummary(draft) }}>
                {/* The themed dropdown with an icon per option, never radios
                    (G119); each option's description is its secondary line. */}
                <IconSelect
                    label={t('coSigner.policy.tokens.legend')}
                    help={t('coSigner.policy.tokens.help')}
                    value={draft.tokenMode || 'any'}
                    onChange={(mode) => {
                        // Picking the current choice again changes nothing, as a radio did.
                        if (mode === (draft.tokenMode || 'any')) return;
                        set({ tokenMode: mode });
                    }}
                    options={[
                        { value: 'any', label: t('coSigner.policy.tokens.any'), sub: t('coSigner.policy.tokens.anyHelp'), icon: <Icon.CoinsIcon /> },
                        { value: 'none', label: t('send.advanced.none'), sub: t('coSigner.policy.tokens.noneHelp'), icon: <Icon.XIcon /> },
                        { value: 'list', label: t('coSigner.policy.tokens.list'), sub: t('coSigner.policy.tokens.listHelp'), icon: <Icon.TokenListIcon /> },
                    ]}
                />
                {draft.tokenMode === 'list' ? (
                    <Input
                        label={t('home.tabs.tokens')}
                        help={t('coSigner.policy.tokens.fieldHelp')}
                        value={draft.allowedTicksText || ''}
                        onChange={(e) => set({ allowedTicksText: e.target.value.toUpperCase() })}
                        placeholder="MYTOKEN, XCHAIN"
                        autoComplete="off"
                        error={listedErrors.length > 0 ? listedErrors.join(' ') : undefined}
                    />
                ) : null}
                {/* The number each named token was saved with: an agent's
                    request that names a token by number matches only these. */}
                {savedNumbers.length > 0 ? (
                    <p style={helpStyle} data-testid="policy-token-numbers">
                        {t('coSigner.policy.tokens.numbers', { list: savedNumbers.join(', ') })}
                    </p>
                ) : null}
            </PolicySection>

            <PolicySection title="Per-action amount limits" icon={Icon.MaxIcon} {...{ id: 'per-action', optional: true, summary: draft.maxPerAction.length ? `${draft.maxPerAction.length} limit${draft.maxPerAction.length === 1 ? '' : 's'}` : 'Not set' }}>
                {draft.maxPerAction.map((row, i) => {
                    const rowAction = String(row.action || '').trim().toUpperCase();
                    const stray = rowAction !== '' && !actionPreview.some((a) => a.key === rowAction);
                    return (
                        <div key={i} className={styles.policyRow}>
                            {/* Offer only the allowed actions, labelled in words (the value
                                stays the exact protocol name the co-signer matches on). */}
                            <Select
                                label="Action"
                                help="Choose one of the actions allowed above. This amount limit applies only when the agent requests that action."
                                value={rowAction}
                                onChange={(e) => patchRow('maxPerAction', i, { action: e.target.value })}
                                error={stray ? "This limit won't apply until you pick one of the allowed actions." : undefined}
                            >
                                <Select.Option value="" icon={<Icon.ListIcon />}>
                                    {actionPreview.length > 0 ? 'Choose an action' : 'Add allowed actions above first'}
                                </Select.Option>
                                {actionPreview.map((a) => (
                                    <Select.Option key={a.key} value={a.key} icon={actionOptionIcon(a.key)}>
                                        {a.known ? a.label : `${a.key} (not a known action)`}
                                    </Select.Option>
                                ))}
                                {stray ? (
                                    <Select.Option value={rowAction} icon={<Icon.BanIcon />}>{`${actionMessageName(rowAction)} (not in the allowed actions above)`}</Select.Option>
                                ) : null}
                            </Select>
                            <Input
                                label="Token"
                                help="Enter the token ticker this action limit covers, or * to cover every token."
                                value={row.tick}
                                onChange={(e) => patchRow('maxPerAction', i, { tick: e.target.value })}
                                placeholder="*"
                                error={tickError(row.tick)}
                            />
                            {/* Policy limit, not a spend: AmountField without Max /
                                balance (there is no wallet balance to cap against here). */}
                            <AmountField
                                label="Max amount"
                                help="Set the largest amount of this token the agent may move in one requested action."
                                amount={row.cap}
                                tick={row.tick}
                                onAmountFieldChange={(rawValue) => {
                                    const stripped = String(rawValue).replace(/,/g, '');
                                    if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                                    patchRow('maxPerAction', i, { cap: stripped });
                                }}
                            />
                            <RemoveButton onClick={() => removeRow('maxPerAction', i)} />
                        </div>
                    );
                })}
                <div className={styles.addRow}>
                    <Button type="button" variant="secondary" icon={<Icon.PlusIcon />} onClick={() => addRow('maxPerAction', { action: '', tick: '*', cap: '' })}>
                        Add Limit
                    </Button>
                    <InfoTip label="Optionally cap how much the agent may move in one action for a specific token or for every token." aria="About per-action amount limits" />
                </div>
            </PolicySection>

            <PolicySection title="Rolling limit" icon={Icon.ClockIcon} {...{ id: 'rolling', optional: true, summary: draft.windowEnabled ? `${draft.windowMaxActions || 'Any'} actions per ${draft.windowHours || '?'} h` : 'Off' }}>
                <Switch
                    help="Turn this on to cap the agent's total activity over a moving time window, such as 10 actions per 24 hours."
                    label="Enforce a rolling limit"
                    checked={draft.windowEnabled}
                    onChange={(e) => set({ windowEnabled: e.target.checked })}
                />
                {draft.windowEnabled ? (
                    <>
                        <div className={styles.policyRow}>
                            <Input
                                label="Window length (hours)"
                                help="Set how many hours of recent agent activity each rolling limit includes."
                                value={draft.windowHours}
                                onChange={(e) => set({ windowHours: e.target.value.replace(/[^\d.]/g, '') })}
                                inputMode="decimal"
                                placeholder="24"
                            />
                            <Input
                                label="Max actions per window"
                                help="Optionally cap the total number of agent actions allowed during each rolling window."
                                optional
                                value={draft.windowMaxActions}
                                onChange={(e) => set({ windowMaxActions: e.target.value.replace(/\D/g, '') })}
                                inputMode="numeric"
                                placeholder="(no cap)"
                            />
                        </div>
                        {draft.windowPerTick.map((row, i) => (
                            <div key={i} className={styles.policyRow}>
                                <Input
                                    label="Token"
                                    help="Enter the token ticker whose total amount is capped during each rolling window."
                                    value={row.tick}
                                    onChange={(e) => patchRow('windowPerTick', i, { tick: e.target.value })}
                                    placeholder="XCHAIN"
                                    error={tickError(row.tick)}
                                />
                                <Input
                                    label="Max total per window"
                                    help="Set the largest total amount of this token the agent may move during one rolling window."
                                    value={row.cap}
                                    onChange={(e) => patchRow('windowPerTick', i, { cap: e.target.value })}
                                    inputMode="decimal"
                                    placeholder="1000"
                                />
                                <RemoveButton onClick={() => removeRow('windowPerTick', i)} />
                            </div>
                        ))}
                        <Button type="button" variant="secondary" icon={<Icon.PlusIcon />} onClick={() => addRow('windowPerTick', { tick: '', cap: '' })}>
                            Add Per-Token Rolling Limit
                        </Button>
                    </>
                ) : null}
            </PolicySection>

            <PolicySection title="Extra-confirmation threshold" icon={Icon.InfoIcon} {...{ id: 'confirm', optional: true, summary: draft.confirmAbove.length ? `${draft.confirmAbove.length} threshold${draft.confirmAbove.length === 1 ? '' : 's'}` : 'Not set' }}>
                {draft.confirmAbove.map((row, i) => (
                    <div key={i} className={styles.policyRow}>
                        <Input
                            label="Token"
                            help="Enter the token ticker whose large requests should receive an extra warning."
                            value={row.tick}
                            onChange={(e) => patchRow('confirmAbove', i, { tick: e.target.value })}
                            placeholder="XCHAIN"
                            error={tickError(row.tick)}
                        />
                        <Input
                            label="Warn above"
                            help="Set the token amount above which the approval screen highlights the request as large."
                            value={row.amount}
                            onChange={(e) => patchRow('confirmAbove', i, { amount: e.target.value })}
                            inputMode="decimal"
                            placeholder="500"
                        />
                        <RemoveButton onClick={() => removeRow('confirmAbove', i)} />
                    </div>
                ))}
                <div className={styles.addRow}>
                    <Button type="button" variant="secondary" icon={<Icon.PlusIcon />} onClick={() => addRow('confirmAbove', { tick: '', amount: '' })}>
                        Add Threshold
                    </Button>
                    <InfoTip label="Optionally highlight requests above a token amount on the approval screen. Every request still asks for your approval." aria="About extra-confirmation thresholds" />
                </div>
            </PolicySection>

            <PolicySection title="Allowed recipients" icon={Icon.UsersIcon} {...{ id: 'recipients', optional: true, summary: draft.allowedDestinations.filter((d) => String(d?.address ?? d ?? '').trim()).length ? `${draft.allowedDestinations.length} address${draft.allowedDestinations.length === 1 ? '' : 'es'}` : 'Anyone' }}>
                {draft.allowedDestinations.map((row, i) => (
                    <div key={i} className={styles.policyRow}>
                        <Input
                            label={`Address ${i + 1}`}
                            help="Enter a recipient address the agent is allowed to pay."
                            value={row.address}
                            onChange={(e) => patchRow('allowedDestinations', i, { address: e.target.value.trim() })}
                            placeholder="bc1q…"
                            autoComplete="off"
                        />
                        <RemoveButton onClick={() => removeRow('allowedDestinations', i)} />
                    </div>
                ))}
                <div className={styles.addRow}>
                    <Button type="button" variant="secondary" icon={<Icon.PlusIcon />} onClick={() => addRow('allowedDestinations', { address: '' })}>
                        Add Recipient
                    </Button>
                    <InfoTip label="Optionally restrict the agent to paying only the listed recipient addresses. With no addresses listed, any recipient is allowed." aria="About allowed recipients" />
                </div>
            </PolicySection>

            <PolicySection title="Allowed transaction outputs" icon={Icon.LockIcon} {...{ id: 'outputs', optional: true, summary: draft.allowedOutputs.length ? `${draft.allowedOutputs.length} output${draft.allowedOutputs.length === 1 ? '' : 's'}` : 'Not set' }}>
                {draft.allowedOutputs.map((row, i) => (
                    <div key={i} className={styles.policyRow}>
                        <Input
                            label={`Output address ${i + 1}`}
                            help="Enter an address that may appear as an output in a transaction the agent asks this wallet to sign."
                            value={row.address}
                            onChange={(e) => patchRow('allowedOutputs', i, { address: e.target.value.trim() })}
                            placeholder="bc1q…"
                            autoComplete="off"
                        />
                        <Input
                            label="Max value"
                            help="Optionally set the largest value this output may receive, measured in the Bitcoin network's base units."
                            optional
                            value={row.maxValue}
                            onChange={(e) => patchRow('allowedOutputs', i, { maxValue: e.target.value.replace(/\D/g, '') })}
                            inputMode="numeric"
                            placeholder="(no cap)"
                        />
                        <RemoveButton onClick={() => removeRow('allowedOutputs', i)} />
                    </div>
                ))}
                <div className={styles.addRow}>
                    <Button type="button" variant="secondary" icon={<Icon.PlusIcon />} onClick={() => addRow('allowedOutputs', { address: '', maxValue: '' })}>
                        Add Output
                    </Button>
                    <InfoTip label="Optionally add an anti-drain guard so every signed transaction output must use a listed address and stay within its maximum value in the chain's base units." aria="About allowed transaction outputs" />
                </div>
            </PolicySection>
        </div>
    );
}
