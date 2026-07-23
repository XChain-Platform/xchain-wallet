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
// buildPolicyDraft() before calling provision/update.
//
// Reused by both CoSignerProvision (author) and CoSignerAccountDetail (edit),
// so all policy-shape knowledge lives in one place.

import { Input, Button, Textarea } from '@xchain-wallet/core/ui';
import { AmountField } from '../components/AmountField.jsx';

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
 */

/** @returns {PolicyDraft} */
export function emptyPolicyDraft() {
    return {
        allowedActionsText: '',
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
        return { error: 'Add at least one allowed action (for example SEND).' };
    }

    // maxPerAction: { ACTION: { TICK: cap } }. Skip blank rows; a cap must be
    // present when an action row is filled in.
    let maxPerAction = null;
    for (const row of draft.maxPerAction) {
        const action = String(row.action || '').trim().toUpperCase();
        const tick = String(row.tick || '').trim() || '*';
        const cap = String(row.cap || '').trim();
        if (!action && !cap) continue;
        if (!action) return { error: 'A per-action limit is missing its action name.' };
        if (!cap) return { error: `Per-action limit for ${action} is missing an amount.` };
        maxPerAction = maxPerAction || {};
        maxPerAction[action] = maxPerAction[action] || {};
        maxPerAction[action][tick] = cap;
    }

    // maxPerWindow: only when explicitly enabled and given a positive window.
    let maxPerWindow = null;
    if (draft.windowEnabled) {
        const hours = Number(draft.windowHours);
        if (!Number.isFinite(hours) || hours <= 0) {
            return { error: 'The rolling limit needs a window length in hours greater than zero.' };
        }
        maxPerWindow = { hours };
        const maxActions = String(draft.windowMaxActions || '').trim();
        if (maxActions) {
            const n = Number(maxActions);
            if (!Number.isInteger(n) || n <= 0) return { error: 'Max actions per window must be a positive whole number.' };
            maxPerWindow.maxActions = n;
        }
        let perTick = null;
        for (const row of draft.windowPerTick) {
            const tick = String(row.tick || '').trim();
            const cap = String(row.cap || '').trim();
            if (!tick && !cap) continue;
            if (!tick || !cap) return { error: 'A rolling per-token limit row is incomplete.' };
            perTick = perTick || {};
            perTick[tick] = cap;
        }
        if (perTick) maxPerWindow.perTick = perTick;
    }

    // confirmAbove: { perTick: { TICK: amount } }.
    let confirmAbove = null;
    let confirmPerTick = null;
    for (const row of draft.confirmAbove) {
        const tick = String(row.tick || '').trim();
        const amount = String(row.amount || '').trim();
        if (!tick && !amount) continue;
        if (!tick || !amount) return { error: 'A confirmation-threshold row is incomplete.' };
        confirmPerTick = confirmPerTick || {};
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
    const allowedOutputs = [];
    for (const row of draft.allowedOutputs) {
        const address = String(row.address || '').trim();
        if (!address) continue;
        const out = { address };
        const mv = String(row.maxValue || '').trim();
        if (mv) {
            const n = Number(mv);
            if (!Number.isFinite(n) || n < 0) return { error: `Allowed-output max value for ${address} must be a non-negative number.` };
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
        },
        allowedOutputs,
    };
}

const fieldsetStyle = {
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    padding: 'var(--xc-space-3)',
    margin: '0 0 var(--xc-space-3) 0',
    background: 'var(--xc-bg-muted)',
};

const legendStyle = { fontWeight: 600, padding: '0 var(--xc-space-2)' };
const helpStyle = { fontSize: '0.85em', color: 'var(--xc-text-muted)', margin: '0 0 var(--xc-space-2) 0' };
const rowStyle = { display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'flex-end', marginBottom: 'var(--xc-space-2)' };

/**
 * Controlled policy editor.
 *
 * @param {object} props
 * @param {PolicyDraft} props.value
 * @param {(next: PolicyDraft) => void} props.onChange
 */
export function CoSignerPolicyEditor({ value, onChange }) {
    // Defensive defaults keep the component renderable even when mounted
    // without a controlled value (e.g. the route-render sweep).
    const draft = value || emptyPolicyDraft();
    const emit = typeof onChange === 'function' ? onChange : () => {};
    const set = (patch) => emit({ ...draft, ...patch });

    const addRow = (key, empty) => set({ [key]: [...draft[key], empty] });
    const removeRow = (key, i) => set({ [key]: draft[key].filter((_, idx) => idx !== i) });
    const patchRow = (key, i, patch) => set({
        [key]: draft[key].map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    });

    return (
        <div>
            <fieldset style={fieldsetStyle}>
                <legend style={legendStyle}>Allowed actions</legend>
                <p style={helpStyle}>
                    Which actions may the agent sign? Enter action names separated by
                    commas, for example: SEND, ISSUE, MINT. The agent can never sign an
                    action that is not listed here.
                </p>
                <Textarea
                    label="Actions"
                    value={draft.allowedActionsText}
                    onChange={(e) => set({ allowedActionsText: e.target.value })}
                    placeholder="SEND, ISSUE"
                    rows={2}
                />
            </fieldset>

            <fieldset style={fieldsetStyle}>
                <legend style={legendStyle}>Per-action amount limits</legend>
                <p style={helpStyle}>
                    Cap how much the agent may move in a single action, per token. Use
                    * as the token to cover every token. Optional.
                </p>
                {draft.maxPerAction.map((row, i) => (
                    <div key={i} style={rowStyle}>
                        <Input
                            label="Action"
                            value={row.action}
                            onChange={(e) => patchRow('maxPerAction', i, { action: e.target.value.toUpperCase() })}
                            placeholder="SEND"
                        />
                        <Input
                            label="Token"
                            value={row.tick}
                            onChange={(e) => patchRow('maxPerAction', i, { tick: e.target.value })}
                            placeholder="*"
                        />
                        {/* Policy limit, not a spend: AmountField without Max /
                            balance (there is no wallet balance to cap against here). */}
                        <AmountField
                            label="Max amount"
                            amount={row.cap}
                            tick={row.tick}
                            onAmountFieldChange={(rawValue) => {
                                const stripped = String(rawValue).replace(/,/g, '');
                                if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                                patchRow('maxPerAction', i, { cap: stripped });
                            }}
                        />
                        <Button type="button" variant="ghost" onClick={() => removeRow('maxPerAction', i)}>Remove</Button>
                    </div>
                ))}
                <Button type="button" variant="secondary" onClick={() => addRow('maxPerAction', { action: '', tick: '*', cap: '' })}>
                    + Add limit
                </Button>
            </fieldset>

            <fieldset style={fieldsetStyle}>
                <legend style={legendStyle}>Rolling limit</legend>
                <p style={helpStyle}>
                    Cap total activity over a rolling time window (for example, at most
                    10 actions per 24 hours). Optional.
                </p>
                <label style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'center', marginBottom: 'var(--xc-space-2)' }}>
                    <input
                        type="checkbox"
                        checked={draft.windowEnabled}
                        onChange={(e) => set({ windowEnabled: e.target.checked })}
                    />
                    <span>Enforce a rolling limit</span>
                </label>
                {draft.windowEnabled ? (
                    <>
                        <div style={rowStyle}>
                            <Input
                                label="Window length (hours)"
                                value={draft.windowHours}
                                onChange={(e) => set({ windowHours: e.target.value.replace(/[^\d.]/g, '') })}
                                inputMode="decimal"
                                placeholder="24"
                            />
                            <Input
                                label="Max actions per window"
                                value={draft.windowMaxActions}
                                onChange={(e) => set({ windowMaxActions: e.target.value.replace(/\D/g, '') })}
                                inputMode="numeric"
                                placeholder="(no cap)"
                            />
                        </div>
                        {draft.windowPerTick.map((row, i) => (
                            <div key={i} style={rowStyle}>
                                <Input
                                    label="Token"
                                    value={row.tick}
                                    onChange={(e) => patchRow('windowPerTick', i, { tick: e.target.value })}
                                    placeholder="XCHAIN"
                                />
                                <Input
                                    label="Max total per window"
                                    value={row.cap}
                                    onChange={(e) => patchRow('windowPerTick', i, { cap: e.target.value })}
                                    placeholder="1000"
                                />
                                <Button type="button" variant="ghost" onClick={() => removeRow('windowPerTick', i)}>Remove</Button>
                            </div>
                        ))}
                        <Button type="button" variant="secondary" onClick={() => addRow('windowPerTick', { tick: '', cap: '' })}>
                            + Add per-token rolling limit
                        </Button>
                    </>
                ) : null}
            </fieldset>

            <fieldset style={fieldsetStyle}>
                <legend style={legendStyle}>Extra-confirmation threshold</legend>
                <p style={helpStyle}>
                    Flag requests above this amount with a warning on the approval
                    screen. Every request already asks for your approval; this just
                    highlights large ones. Optional.
                </p>
                {draft.confirmAbove.map((row, i) => (
                    <div key={i} style={rowStyle}>
                        <Input
                            label="Token"
                            value={row.tick}
                            onChange={(e) => patchRow('confirmAbove', i, { tick: e.target.value })}
                            placeholder="XCHAIN"
                        />
                        <Input
                            label="Warn above"
                            value={row.amount}
                            onChange={(e) => patchRow('confirmAbove', i, { amount: e.target.value })}
                            placeholder="500"
                        />
                        <Button type="button" variant="ghost" onClick={() => removeRow('confirmAbove', i)}>Remove</Button>
                    </div>
                ))}
                <Button type="button" variant="secondary" onClick={() => addRow('confirmAbove', { tick: '', amount: '' })}>
                    + Add threshold
                </Button>
            </fieldset>

            <fieldset style={fieldsetStyle}>
                <legend style={legendStyle}>Allowed recipients</legend>
                <p style={helpStyle}>
                    Restrict the agent to paying only these addresses. Leave empty to
                    allow any recipient. Optional.
                </p>
                {draft.allowedDestinations.map((row, i) => (
                    <div key={i} style={rowStyle}>
                        <Input
                            label={`Address ${i + 1}`}
                            value={row.address}
                            onChange={(e) => patchRow('allowedDestinations', i, { address: e.target.value.trim() })}
                            placeholder="bc1q…"
                        />
                        <Button type="button" variant="ghost" onClick={() => removeRow('allowedDestinations', i)}>Remove</Button>
                    </div>
                ))}
                <Button type="button" variant="secondary" onClick={() => addRow('allowedDestinations', { address: '' })}>
                    + Add recipient
                </Button>
            </fieldset>

            <fieldset style={fieldsetStyle}>
                <legend style={legendStyle}>Allowed transaction outputs</legend>
                <p style={helpStyle}>
                    Anti-drain guard: the signed transaction may only pay these
                    addresses, optionally up to a maximum value each (in the chain's
                    base units). Leave empty to rely on the checks above. Optional.
                </p>
                {draft.allowedOutputs.map((row, i) => (
                    <div key={i} style={rowStyle}>
                        <Input
                            label={`Output address ${i + 1}`}
                            value={row.address}
                            onChange={(e) => patchRow('allowedOutputs', i, { address: e.target.value.trim() })}
                            placeholder="bc1q…"
                        />
                        <Input
                            label="Max value (optional)"
                            value={row.maxValue}
                            onChange={(e) => patchRow('allowedOutputs', i, { maxValue: e.target.value.replace(/\D/g, '') })}
                            inputMode="numeric"
                            placeholder="(no cap)"
                        />
                        <Button type="button" variant="ghost" onClick={() => removeRow('allowedOutputs', i)}>Remove</Button>
                    </div>
                ))}
                <Button type="button" variant="secondary" onClick={() => addRow('allowedOutputs', { address: '', maxValue: '' })}>
                    + Add output
                </Button>
            </fieldset>
        </div>
    );
}
