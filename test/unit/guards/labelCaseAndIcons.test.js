// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Static guard for two app-wide button and title rules:
//
//   1. Every page title (PageHeader `title`) and every button label (Button and
//      FormAction children, busy labels included) is Title Case: each word
//      starts with a capital except the short articles, conjunctions and
//      prepositions (from, with, as, to, of, on, in, for, ...) titleCase.js
//      keeps lower case between the first and the last word (operator ruling
//      7, WALLET-UI-RULINGS G50).
//   2. Every Button renders an icon: an explicit `icon` prop, or a plain
//      string label the shared iconForLabel resolver maps to one.
//
// Labels are resolved to their English text: a t('key') call reads the en
// dictionary (every plural and select branch is checked), a string or JSX text
// is read as written, a template or a mixed label is checked piece by piece
// with interpolated values treated as data, and a const is followed to its
// value. A component that forwards one of its own props into a Button label or
// a PageHeader title (ConfirmModal's confirmLabel, ListPickerScreen's title)
// is found automatically, and the guard then checks that prop at every place
// the component is rendered.
//
// A label the guard cannot read (a value from a data table, a state
// variable) must be listed in UNRESOLVED with the reason it is safe, so a new
// hard-to-read label cannot slip past unchecked.

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { parse as parseIcu, TYPE } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';

import { en } from '../../../packages/core/src/i18n/locales/en/index.js';
import { iconForLabel } from '../../../packages/core/src/ui/icons/index.jsx';
import { TITLE_SMALL_WORDS, titleCase } from '../../../packages/core/src/shared/utils/titleCase.js';

const traverse = _traverse.default || _traverse;

const sources = import.meta.glob([
    '../../../packages/core/src/**/*.jsx',
    '../../../packages/web/src/**/*.jsx',
    '../../../packages/extension/src/**/*.jsx',
    '../../../packages/desktop/**/*.jsx',
    '!../../../packages/**/node_modules/**',
], { query: '?raw', import: 'default', eager: true });

const PARSER_PLUGINS = ['jsx', 'importAssertions', 'topLevelAwait', 'classProperties'];

const relPath = (key) => key.replace(/^(\.\.\/)+/, '');

// Words that keep their own spelling inside a Title Case label: brand and
// product names whose first letter is lower case by design.
const OWN_CASE_WORDS = new Set(['iOS', 'macOS', 'eToken']);

// Labels that are sentences on purpose, so Title Case would misread them.
// Each names why it is not a title or a button verb.
const SENTENCE_LABELS = new Map([]);

// Files another change is rewriting, skipped until it lands. The test fails
// once a listed file is clean, so the entry must then be removed.
const PENDING_FILES = new Map([
    'AirdropForm', 'ComposeMessage', 'ContactsList', 'GovernancePolls',
    'History', 'ParallelComposer', 'PublishFileForm',
].map((name) => [`packages/core/src/shared/routes/${name}.jsx`, 'another change is rewriting this form']));

// Labels the scan cannot resolve to text, keyed `file :: role :: source`.
// Each value says why the label is safe or where its text is checked.
const UNRESOLVED = new Map([
    ['packages/core/src/shared/components/settings/SettingsInlineRow.jsx :: button :: {control.label}',
        "an inline Settings row's action label from its row entry in Settings.jsx ('Reset'), each a Title Case literal"],
    ['packages/core/src/shared/routes/Onboarding.jsx :: title :: {title}',
        'firstRunFrame passes the license, wallet setup or product name title, each from onboarding keys'],
    ['packages/core/src/shared/approval/SignApproval.jsx :: title :: {title}',
        'the KIND_TITLE table (Sign Message, Sign Transaction, Sign Action, Co-sign Transaction, Sign In) or the Approve Request fallback, each Title Case'],
    ['packages/core/src/shared/routes/BetFeedDetail.jsx :: button :: {feed.source}',
        'the oracle source address, shown as a link; data, not copy'],
    ['packages/core/src/shared/routes/DeployContractForm.jsx :: button :: {t}',
        'a contract template name from the template catalogue; data, not copy'],
    ['packages/core/src/shared/routes/GatedPublishForm.jsx :: title :: {pageTitle}',
        "the shared form's title or gatedPublish.title, both Title Case"],
    ["packages/core/src/shared/routes/MessagingInbox.jsx :: button :: {copiedKey === item.key ? 'Copied' : item.label}",
        "CopyMenu rows built beside it (Copy Address, Copy Message, Edit Contact, View in Explorer, ...), all Title Case, or 'Copied'"],
    ['packages/core/src/shared/routes/ImportWallet.jsx :: button :: {word}',
        'a recovery word suggestion; data, not copy'],
    ['packages/core/src/shared/routes/ListCreateForm.jsx :: button :: {target.label}',
        'a list row naming a list consumer; list rows keep sentence case'],
    ["packages/core/src/shared/routes/ListCreateForm.jsx :: title :: {stage === 'review-1' ? 'Review List Edit' : stage === 'wait-index' ? 'Waiting f",
        "the Edit and Fork stage titles, each a Title Case literal, then LIST_ACTIONS title ('Edit List')"],
    ['packages/core/src/shared/routes/ListCreateForm.jsx :: title :: {cfg.title}',
        "LIST_ACTIONS title beside it: 'Share List' or 'Transfer List', both Title Case"],
    ["packages/core/src/shared/routes/ListCreateForm.jsx :: button :: {lane.isWatcherMode ? 'Create Unsigned Transaction' : cfg.actionLabel}",
        "LIST_ACTIONS actionLabel beside it: 'Share List' or 'Transfer List', both Title Case"],
    ['packages/core/src/shared/routes/MultisigSigningSession.jsx :: title :: {title}',
        'screenFor(title) takes multisig.start.pickActionTitle or pickMultisigTitle, both Title Case'],
    ["packages/core/src/shared/routes/PairPartnerWallet.jsx :: button :: {lane.cta || 'Pair'}",
        'lane.cta is flows.pairPartner.pairSigner or pairWatcher, both Title Case'],
    ['packages/core/src/shared/routes/StakingForm.jsx :: title :: {pageTitle}',
        "ACTIONS labels (Stake, Unstake, Claim, Delegate, Revoke) or STAKING_ACTIONS reviewTitle run through titleCase, all Title Case"],
    ['packages/core/src/shared/routes/StakingForm.jsx :: button :: {isWatcherMode ? cfg.unsignedLabel : cfg.reviewSubmit}',
        'STAKING_ACTIONS unsignedLabel and reviewSubmit beside it, all Title Case verbs'],
    ['packages/core/src/shared/routes/VaultUnavailable.jsx :: button :: {wipeCopy.button}',
        'WIPE_COPY button strings beside it and vaultUnavailable.incomplete.reset, all Title Case'],
    ['packages/core/src/ui/FormPage.jsx :: button :: shellNotice.retryLabel',
        'ReachabilityBanner sets it to common.tryAgain or common.checking'],
    ['packages/core/src/shared/components/formStandard/FormStatusSlot.jsx :: button :: shellNotice.retryLabel',
        'ReachabilityBanner sets it to common.tryAgain or common.checking'],
    // One NoticeAction draws the lone notice's action and each group line's
    // (Notice Standard, 2026-11-15).
    ['packages/core/src/ui/StatusMessage.jsx :: button :: {recovery.label}',
        'every caller-side recovery={{ label }} and recovery: { label } is checked as a recovery.label site'],
    ['packages/web/src/style-guide/sections/ButtonsSection.jsx :: button :: {LABELS[v]}',
        'the style guide LABELS table beside it, all Title Case'],
    ["packages/core/src/shared/routes/ReceivePicker.jsx :: title :: {rest.title ?? t('shell.markets.selectAsset')}",
        'shell.markets.selectAsset is Title Case; a caller title comes from the shell route table'],
]);

// Buttons that render without an icon on purpose, keyed `file :: label`.
const ICONLESS = new Map([
    ['packages/core/src/shared/components/PlaceOrderPanel.jsx :: {}%',
        'amount chips (25%, 50%, 75%, 100%) are one-tap values, not actions; Max is the in-field icon'],
    ['packages/core/src/shared/routes/BetFeedDetail.jsx :: Max | {}%',
        'amount chips (Max, 25%, 50%) are one-tap values, not actions'],
    ['packages/core/src/shared/routes/ImportWallet.jsx :: word',
        'recovery word suggestion chips; the word is the whole control'],
    ['packages/core/src/shared/components/settings/BackupSection.jsx :: {}',
        'the recovery phrase box is itself the reveal control; an icon would sit inside the secret'],
]);

/* ------------------------------------------------------------------ *
 *  Title Case check
 * ------------------------------------------------------------------ */

const PLACEHOLDER = '\u0000';

// Every text a dictionary entry can render, one per plural or select branch,
// with each argument replaced by a placeholder (a ticker, a count, a name).
// `args` maps an argument name to the literal strings the call site can pass
// (t('key', { side: 'buy' })), so a lower-case word dropped into a Title Case
// label is caught; an argument the scan cannot read stays a placeholder.
function icuVariants(message, args = {}) {
    let ast;
    try {
        ast = parseIcu(message, { ignoreTag: true });
    } catch {
        return [message];
    }
    const walk = (nodes, bound = args) => {
        let out = [''];
        for (const node of nodes) {
            let options;
            const known = bound[node.value];
            if (node.type === TYPE.literal) options = [node.value];
            else if (node.type === TYPE.pound) options = ['1'];
            else if (node.type === TYPE.select && known) {
                // Inside a branch the argument holds the one value that chose it.
                options = known.flatMap((value) => walk(
                    (node.options[value] || node.options.other).value,
                    { ...bound, [node.value]: [value] },
                ));
            } else if (node.type === TYPE.plural || node.type === TYPE.select) {
                options = Object.values(node.options).flatMap((option) => walk(option.value, bound));
            } else if (node.type === TYPE.argument && known) options = known;
            else options = [PLACEHOLDER];
            const next = [];
            for (const head of out) for (const tail of options) next.push(head + tail);
            out = next.slice(0, 32);
        }
        return out;
    };
    return walk(ast);
}

/**
 * Words in `text` that break Title Case. `continued` marks a piece that does
 * not start the label (the text after an interpolated value); `ends` is false
 * for a piece that an interpolated value follows, so its last word is not
 * the label's last word.
 */
export function titleCaseProblems(text, continued = false, ends = true) {
    const problems = [];
    let first = !continued;
    const tokens = text.split(/\s+/).filter(Boolean);
    tokens.forEach((token, position) => {
        if (token.includes(PLACEHOLDER)) {
            first = false;
            return;
        }
        // The label's last word, or the last word before a colon or a full
        // stop, is an edge word like the first one.
        const tail = (ends && position === tokens.length - 1) || /[:.?!]$/.test(token);
        const parts = token.split('-');
        parts.forEach((part, index) => {
            const word = part.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9']+$/, '');
            if (!/^[A-Za-z]/.test(word) || OWN_CASE_WORDS.has(word)) return;
            // A short word that is part of a hyphenated compound ("On-Chain")
            // reads as part of one word, so it may take a capital.
            const small = TITLE_SMALL_WORDS.has(word.toLowerCase());
            if (small && parts.length > 1) return;
            const edge = (first && index === 0) || tail;
            if (/^[a-z]/.test(word) && (edge || !small)) problems.push(word);
            else if (small && !edge && index === 0 && word !== word.toLowerCase()) problems.push(word);
        });
        // A new sentence or clause after a colon starts a fresh title.
        first = /[:.?!]$/.test(token);
    });
    return problems;
}

/* ------------------------------------------------------------------ *
 *  Label resolution
 * ------------------------------------------------------------------ */

// A resolved label is a list of pieces; each piece is a list of the texts it
// can render ({ text } with placeholders for data) or { unresolved: source }.
function sourceOf(code, node) {
    return code.slice(node.start, node.end).replace(/\s+/g, ' ').slice(0, 80);
}

function propBinding(scope, name) {
    const binding = scope?.getBinding(name);
    if (!binding || binding.kind !== 'param') return null;
    // The prop is a destructured field of the component's first parameter.
    const fn = binding.scope.block;
    const param = fn.params?.[0];
    if (param?.type !== 'ObjectPattern') return null;
    for (const prop of param.properties) {
        if (prop.type !== 'ObjectProperty') continue;
        const value = prop.value.type === 'AssignmentPattern' ? prop.value.left : prop.value;
        if (value.type === 'Identifier' && value.name === name) {
            return {
                prop: prop.key.name,
                fallback: prop.value.type === 'AssignmentPattern' ? prop.value.right : null,
                component: componentName(binding.path),
            };
        }
    }
    return null;
}

function componentName(path) {
    let current = path;
    while (current) {
        const node = current.node;
        if (node.type === 'FunctionDeclaration' && node.id) return node.id.name;
        if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') return node.id.name;
        current = current.parentPath;
    }
    return null;
}

function texts(node, ctx, depth = 0) {
    if (!node || depth > 6) return [{ text: PLACEHOLDER }];
    switch (node.type) {
        case 'StringLiteral':
            return [{ text: node.value }];
        case 'JSXText':
            return [{ text: node.value.replace(/\s+/g, ' ') }];
        case 'NumericLiteral':
            return [{ text: PLACEHOLDER }];
        case 'NullLiteral':
            return [];
        case 'JSXExpressionContainer':
            return node.expression.type === 'JSXEmptyExpression' ? [] : texts(node.expression, ctx, depth);
        case 'ConditionalExpression':
            return [...texts(node.consequent, ctx, depth + 1), ...texts(node.alternate, ctx, depth + 1)];
        case 'LogicalExpression':
            return node.operator === '&&'
                ? texts(node.right, ctx, depth + 1)
                : [...texts(node.left, ctx, depth + 1), ...texts(node.right, ctx, depth + 1)];
        case 'TemplateLiteral': {
            const pieces = [];
            node.quasis.forEach((quasi, index) => {
                pieces.push([{ text: quasi.value.cooked }]);
                if (node.expressions[index]) pieces.push(texts(node.expressions[index], { ...ctx, data: true }, depth + 1));
            });
            return joinPieces(pieces);
        }
        case 'BinaryExpression':
            if (node.operator === '+') return joinPieces([texts(node.left, ctx, depth + 1), texts(node.right, ctx, depth + 1)]);
            return [{ text: PLACEHOLDER }];
        case 'CallExpression': {
            const callee = node.callee;
            if (callee.type === 'Identifier' && callee.name === 't' && node.arguments[0]?.type === 'StringLiteral') {
                const key = node.arguments[0].value;
                if (typeof en[key] !== 'string') return [{ text: PLACEHOLDER }];
                const args = {};
                for (const prop of node.arguments[1]?.properties || []) {
                    if (prop.type !== 'ObjectProperty' || prop.key.type !== 'Identifier') continue;
                    const values = texts(prop.value, { ...ctx, data: true, forwards: [] }, depth + 1);
                    if (values.length && values.every((value) => typeof value.text === 'string' && !value.text.includes(PLACEHOLDER))) {
                        args[prop.key.name] = values.map((value) => value.text);
                    }
                }
                return icuVariants(en[key], args).map((text) => ({ text, key }));
            }
            if (callee.type === 'Identifier' && callee.name === 'titleCase') return [{ text: PLACEHOLDER }];
            // Formatting helpers (a number, an address, a ticker) render data.
            return [{ text: PLACEHOLDER }];
        }
        case 'Identifier': {
            if (node.name === 'undefined') return [];
            const binding = ctx.path.scope.getBinding(node.name);
            const init = binding?.path?.node?.type === 'VariableDeclarator' ? binding.path.node.init : null;
            if (init && binding.constant !== false) {
                return texts(init, { ...ctx, path: binding.path }, depth + 1);
            }
            // A name inside a template or a mixed label is a value (a ticker,
            // an index), not label copy.
            if (ctx.data) return [{ text: PLACEHOLDER }];
            const prop = propBinding(ctx.path.scope, node.name);
            if (prop?.component) {
                ctx.forwards.push(prop);
                return [{ forwarded: prop }];
            }
            return ctx.data ? [{ text: PLACEHOLDER }] : [{ unresolved: node.name }];
        }
        case 'JSXElement':
        case 'JSXFragment':
            return [{ text: PLACEHOLDER, element: true }];
        default:
            return ctx.data ? [{ text: PLACEHOLDER }] : [{ unresolved: sourceOf(ctx.code, node) }];
    }
}

// Concatenates pieces into whole label texts, keeping at most a few variants.
function joinPieces(pieces) {
    let out = [{ text: '' }];
    for (const piece of pieces) {
        const next = [];
        // A piece that renders nothing (null) adds no text.
        const options = piece.length ? piece : [{ text: '' }];
        for (const head of out) {
            for (const tail of options) {
                if (head.unresolved || tail.unresolved) next.push({ unresolved: head.unresolved || tail.unresolved });
                else if (tail.forwarded) next.push(tail);
                else next.push({ text: head.text + tail.text, key: head.key || tail.key, element: head.element || tail.element });
            }
        }
        out = next.slice(0, 32);
    }
    return out;
}

function childrenTexts(children, ctx) {
    const parts = children.filter((child) => !(child.type === 'JSXText' && !child.value.trim()));
    if (parts.length === 0) return { label: [], count: 0, single: null };
    // In a mixed label the expressions between the words are values.
    const pieceCtx = parts.length > 1 ? { ...ctx, data: true } : ctx;
    const label = joinPieces(parts.map((child) => texts(child, child.type === 'JSXText' ? ctx : pieceCtx).filter(Boolean)))
        .map((entry) => (entry.text !== undefined ? { ...entry, text: entry.text.trim() } : entry));
    return { label, count: parts.length, single: parts.length === 1 ? parts[0] : null };
}

/* ------------------------------------------------------------------ *
 *  Scan
 * ------------------------------------------------------------------ */

const LABEL_ELEMENTS = new Set(['Button', 'FormAction']);

function attribute(opening, name) {
    return opening.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === name);
}

// How the `icon` prop resolves: 'auto' (left out or undefined), 'none' (null)
// or 'set' (an icon node), per branch of a conditional.
function iconStates(node) {
    if (!node) return ['auto'];
    if (node.type === 'JSXExpressionContainer') return iconStates(node.expression);
    if (node.type === 'NullLiteral') return ['none'];
    if (node.type === 'Identifier' && node.name === 'undefined') return ['auto'];
    if (node.type === 'ConditionalExpression') return [...iconStates(node.consequent), ...iconStates(node.alternate)];
    return ['set'];
}

// The icon component names an `icon` prop can render (`<Icon.SaveIcon />`,
// `<SaveIcon />`), one per branch; null for a branch that is not an element.
function iconNames(node) {
    if (!node) return [];
    if (node.type === 'JSXExpressionContainer') return iconNames(node.expression);
    if (node.type === 'ConditionalExpression') return [...iconNames(node.consequent), ...iconNames(node.alternate)];
    if (node.type !== 'JSXElement') return [null];
    const name = node.openingElement.name;
    if (name.type === 'JSXIdentifier') return [name.name];
    if (name.type === 'JSXMemberExpression') return [name.property.name];
    return [null];
}

function scan() {
    const sites = [];
    const forwarders = new Map();
    for (const [key, code] of Object.entries(sources)) {
        const file = relPath(key);
        if (!/<(PageHeader|Button|FormAction)\b|recovery/.test(code)) continue;
        const ast = parse(code, { sourceType: 'module', plugins: PARSER_PLUGINS });
        // A StatusMessage `recovery` object ({ label, onAction }) renders its
        // label on a button that always carries the refresh icon.
        const recoveryLabel = (path, node) => {
            const objects = node?.type === 'ConditionalExpression' ? [node.consequent, node.alternate] : [node];
            for (const object of objects) {
                if (object?.type !== 'ObjectExpression') continue;
                const label = object.properties.find((p) => p.type === 'ObjectProperty' && p.key.name === 'label');
                if (!label) continue;
                const ctx = { path, code, forwards: [], data: false };
                sites.push({
                    file: relPath(key),
                    line: label.loc.start.line,
                    role: 'button',
                    via: 'recovery.label',
                    label: texts(label.value, ctx).map((entry) => (entry.text !== undefined ? { ...entry, text: entry.text.trim() } : entry)),
                    icon: ['set'],
                    single: true,
                    source: sourceOf(code, label.value),
                });
            }
        };
        traverse(ast, {
            JSXAttribute(path) {
                if (path.node.name.name === 'recovery' && path.node.value?.type === 'JSXExpressionContainer') {
                    recoveryLabel(path, path.node.value.expression);
                }
            },
            ObjectProperty(path) {
                if (path.node.key.type === 'Identifier' && path.node.key.name === 'recovery') recoveryLabel(path, path.node.value);
            },
            JSXElement(path) {
                const opening = path.node.openingElement;
                const name = opening.name.type === 'JSXIdentifier' ? opening.name.name : null;
                if (name !== 'PageHeader' && !LABEL_ELEMENTS.has(name)) return;
                const forwards = [];
                const ctx = { path, code, forwards, data: false };
                const line = opening.loc.start.line;
                if (name === 'PageHeader') {
                    const title = attribute(opening, 'title');
                    if (!title?.value) return;
                    const label = texts(title.value, ctx).map((entry) => (entry.text !== undefined ? { ...entry, text: entry.text.trim() } : entry));
                    sites.push({ file, line, role: 'title', label, source: sourceOf(code, title.value) });
                } else {
                    const { label, count, single } = childrenTexts(path.node.children, ctx);
                    const iconAttr = attribute(opening, 'icon');
                    sites.push({
                        file,
                        line,
                        role: 'button',
                        label,
                        count,
                        single,
                        icon: iconStates(iconAttr?.value),
                        iconNames: iconNames(iconAttr?.value),
                        forwardsIcon: iconAttr?.value?.expression?.type === 'Identifier'
                            && Boolean(propBinding(path.scope, iconAttr.value.expression.name)),
                        // The wrapper prop that carries this Button's icon (ConfirmModal's confirmIcon).
                        iconProp: iconAttr?.value?.expression?.type === 'Identifier'
                            ? propBinding(path.scope, iconAttr.value.expression.name)?.prop ?? null
                            : null,
                        hasSpread: opening.attributes.some((a) => a.type === 'JSXSpreadAttribute'),
                        // A menu item, tile or card draws its own markup (an
                        // icon span, a coin mark, two lines of text).
                        customContent: path.node.children.some((c) => c.type === 'JSXElement'),
                        forwardedLabel: label.some((entry) => entry.forwarded),
                        source: path.node.children.length ? sourceOf(code, path.node.children.find((c) => !(c.type === 'JSXText' && !c.value.trim())) || opening) : '',
                    });
                }
                const site = sites[sites.length - 1];
                for (const forward of forwards) {
                    const id = `${forward.component}.${forward.prop}`;
                    if (!forwarders.has(id)) {
                        forwarders.set(id, {
                            ...forward,
                            role: site.role,
                            icon: site.icon,
                            iconProp: site.iconProp,
                            hasSpread: site.hasSpread,
                        });
                    }
                }
            },
        });
    }
    // Second pass: every render of a forwarding component, read at its prop.
    const byComponent = new Map();
    for (const forward of forwarders.values()) {
        if (!byComponent.has(forward.component)) byComponent.set(forward.component, []);
        byComponent.get(forward.component).push(forward);
    }
    for (const [key, code] of Object.entries(sources)) {
        const file = relPath(key);
        if (![...byComponent.keys()].some((name) => code.includes(`<${name}`))) continue;
        const ast = parse(code, { sourceType: 'module', plugins: PARSER_PLUGINS });
        traverse(ast, {
            JSXElement(path) {
                const opening = path.node.openingElement;
                const name = opening.name.type === 'JSXIdentifier' ? opening.name.name : null;
                const forwards = byComponent.get(name);
                if (!forwards) return;
                for (const forward of forwards) {
                    const attr = attribute(opening, forward.prop);
                    if (!attr?.value) continue;
                    const ctx = { path, code, forwards: [], data: false };
                    const label = texts(attr.value, ctx).map((entry) => (entry.text !== undefined ? { ...entry, text: entry.text.trim() } : entry));
                    sites.push({
                        file,
                        line: opening.loc.start.line,
                        role: forward.role,
                        label,
                        single: true,
                        // A wrapper that forwards an icon prop shows what this
                        // caller passes, or the label's own icon when it passes none.
                        icon: forward.iconProp
                            ? iconStates(attribute(opening, forward.iconProp)?.value)
                            : forward.icon,
                        iconNames: forward.iconProp ? iconNames(attribute(opening, forward.iconProp)?.value) : [],
                        hasSpread: forward.hasSpread,
                        via: `${name}.${forward.prop}`,
                        source: sourceOf(code, attr.value),
                    });
                }
            },
        });
    }
    return sites;
}

const SITES = scan();

const inPending = (file) => PENDING_FILES.has(file);

function caseViolations() {
    const out = [];
    for (const site of SITES) {
        if (inPending(site.file)) continue;
        for (const entry of site.label) {
            if (entry.forwarded) continue;
            if (entry.unresolved) {
                const id = `${site.file} :: ${site.role} :: ${site.source}`;
                if (!UNRESOLVED.has(id)) out.push(`UNRESOLVED ${id}`);
                continue;
            }
            const text = entry.text.replaceAll(PLACEHOLDER, '{}').trim();
            if (!entry.text.replaceAll(PLACEHOLDER, '').trim()) continue;
            if (SENTENCE_LABELS.has(text)) continue;
            const pieces = entry.text.split(PLACEHOLDER);
            // Text after an interpolated value (a ticker, a count) continues
            // the label, so a short word there stays lower case; a piece an
            // interpolated value follows does not hold the label's last word.
            const problems = pieces.flatMap((piece, index) => titleCaseProblems(piece, index > 0, index === pieces.length - 1));
            if (problems.length) {
                out.push(`${site.file}:${site.line} ${site.role}${site.via ? ` (${site.via})` : ''}${entry.key ? ` [${entry.key}]` : ''} "${text}" -> ${problems.join(', ')}`);
            }
        }
    }
    return [...new Set(out)];
}

function iconViolations() {
    const out = [];
    for (const site of SITES) {
        if (site.role !== 'button' || site.customContent || inPending(site.file)) continue;
        // A wrapper's Button is checked where the wrapper is rendered, with
        // the label each caller passes.
        if (site.forwardedLabel) continue;
        const labelText = site.label.map((entry) => entry.text ?? entry.unresolved ?? '').join(' | ').replaceAll(PLACEHOLDER, '{}');
        const id = `${site.file} :: ${labelText}`;
        let ok = true;
        for (const state of site.icon) {
            if (state === 'set') continue;
            if (state === 'none') { ok = false; break; }
            // Auto: Button looks an icon up only for a single plain-text label.
            if (site.forwardsIcon || site.hasSpread) continue;
            // A label passed on again from the caller's own props is checked
            // where that caller is rendered.
            const own = site.label.filter((entry) => !entry.forwarded);
            if (own.length === 0) continue;
            const textual = site.single && own.every((entry) => entry.text !== undefined && !entry.element);
            if (!textual || own.some((entry) => !iconForLabel(entry.text.replaceAll(PLACEHOLDER, '1')))) {
                ok = false;
                break;
            }
        }
        if (!ok && !ICONLESS.has(id)) out.push(`${site.file}:${site.line} "${labelText}"`);
    }
    return [...new Set(out)];
}

// A button whose label saves something ("Save", "Save Label") shows the
// floppy-disk SaveIcon, never a check mark. A button that switches between a
// save label and another action carries SaveIcon on its save branch.
function saveIconViolations() {
    const out = [];
    for (const site of SITES) {
        if (site.role !== 'button' || site.via || inPending(site.file)) continue;
        const saves = site.label.some((entry) => typeof entry.text === 'string' && /^save\b/i.test(entry.text.trim()));
        if (!saves) continue;
        const names = site.iconNames || [];
        if (names.length > 0 && !names.includes('SaveIcon')) {
            out.push(`${site.file}:${site.line} "${site.label.map((entry) => entry.text ?? '').join(' | ')}" uses ${names.join(', ')}`);
        }
    }
    return out;
}

describe('page titles and button labels are Title Case', () => {
    it('finds the labels it checks', () => {
        expect(SITES.filter((site) => site.role === 'title').length).toBeGreaterThan(80);
        expect(SITES.filter((site) => site.role === 'button').length).toBeGreaterThan(500);
    });

    it('reads Title Case words the way titleCase.js writes them', () => {
        expect(titleCaseProblems('Create Unsigned Transaction')).toEqual([]);
        expect(titleCaseProblems('Create unsigned transaction')).toEqual(['unsigned', 'transaction']);
        expect(titleCaseProblems('Back to Wallet')).toEqual([]);
        expect(titleCaseProblems('Back To Wallet')).toEqual(['To']);
        expect(titleCaseProblems('Creating Unsigned Transaction…')).toEqual([]);
        expect(titleCaseProblems('Allow-list')).toEqual(['list']);
        expect(titleCaseProblems('of 3 shown', true)).toEqual(['shown']);
        // Ruling 7: small words stay lower case between the first and last word.
        expect(titleCaseProblems('Import from FreeWallet')).toEqual([]);
        expect(titleCaseProblems('Import From FreeWallet')).toEqual(['From']);
        expect(titleCaseProblems('Sign with Ledger')).toEqual([]);
        expect(titleCaseProblems('Sign With Ledger')).toEqual(['With']);
        expect(titleCaseProblems('Save as Draft')).toEqual([]);
        expect(titleCaseProblems('Save As Draft')).toEqual(['As']);
        expect(titleCaseProblems('Restore from Recovery Phrase or Backup')).toEqual([]);
        expect(titleCaseProblems('Send but Wait')).toEqual([]);
        expect(titleCaseProblems('Send But Wait')).toEqual(['But']);
        expect(titleCaseProblems('Turn On')).toEqual([]);
        expect(titleCaseProblems('Turn on')).toEqual(['on']);
        expect(titleCaseProblems('Send to', false, false)).toEqual([]);
        expect(titleCaseProblems('Sign In: Ledger')).toEqual([]);
        expect(titleCaseProblems('Cross-Chain Swap')).toEqual([]);
        expect(icuVariants('{count, plural, one {Hide # Hidden Address} other {Hide # Hidden Addresses}}'))
            .toEqual(['Hide 1 Hidden Address', 'Hide 1 Hidden Addresses']);
    });

    it('titleCase.js writes the small-word rule the guard reads', () => {
        expect(titleCase('import from FreeWallet')).toBe('Import from FreeWallet');
        expect(titleCase('Import From FreeWallet')).toBe('Import from FreeWallet');
        expect(titleCase('sign with my key')).toBe('Sign with My Key');
        expect(titleCase('save as draft')).toBe('Save as Draft');
        expect(titleCase('send but wait')).toBe('Send but Wait');
        expect(titleCase('turn on')).toBe('Turn On');
        expect(titleCase('lock to address')).toBe('Lock to Address');
        expect(titleCase('to the moon')).toBe('To the Moon');
        expect(titleCase('sign in: ledger')).toBe('Sign In: Ledger');
        expect(titleCase('cross-chain swap')).toBe('Cross-Chain Swap');
        expect(titleCase('trade on-chain')).toBe('Trade On-Chain');
        expect(titleCase('send OR burn')).toBe('Send OR Burn');
        expect(titleCase('plan A for BTC')).toBe('Plan A for BTC');
        for (const text of ['import from FreeWallet', 'sign with my key', 'turn on', 'restore from recovery phrase or backup']) {
            expect(titleCaseProblems(titleCase(text))).toEqual([]);
        }
    });

    it('reads literals inside ternary, && and template children of Button and FormAction', () => {
        const code = `
            const a = (<Button>{watcher ? 'Create unsigned transaction' : hw ? \`Sign on \${device}: create poll\` : 'Create Poll'}</Button>);
            const b = (<FormAction>{ready && 'submit vote'}</FormAction>);
            const c = (<Button>{watcher ? \`Create Unsigned Transaction: \${verb.toLowerCase()}\` : 'Submit Vote'}</Button>);
        `;
        const ast = parse(code, { sourceType: 'module', plugins: PARSER_PLUGINS });
        const found = [];
        traverse(ast, {
            JSXElement(path) {
                const name = path.node.openingElement.name.name;
                if (!LABEL_ELEMENTS.has(name)) return;
                const { label } = childrenTexts(path.node.children, { path, code, forwards: [], data: false });
                found.push(label.flatMap((entry) => titleCaseProblems(entry.text ?? '')));
            },
        });
        expect(found[0]).toEqual(expect.arrayContaining(['unsigned', 'transaction', 'create', 'poll']));
        expect(found[1]).toEqual(['submit', 'vote']);
        expect(found[2]).toEqual([]);
    });

    it('every PageHeader title and Button label is Title Case', () => {
        const violations = caseViolations();
        expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
    });

    it('every allowlist entry still matches a label', () => {
        const ids = new Set(SITES.map((site) => `${site.file} :: ${site.role} :: ${site.source}`));
        expect([...UNRESOLVED.keys()].filter((id) => !ids.has(id))).toEqual([]);
        const texts = new Set(SITES.flatMap((site) => site.label.map((entry) => (entry.text ?? '').replaceAll(PLACEHOLDER, '{}'))));
        expect([...SENTENCE_LABELS.keys()].filter((text) => !texts.has(text))).toEqual([]);
    });

    it('every pending file still has a miss', () => {
        const dirty = new Set();
        for (const site of SITES) {
            if (!inPending(site.file)) continue;
            const bad = site.label.some((entry) => entry.text !== undefined
                && entry.text.split(PLACEHOLDER).some((piece, index, pieces) => titleCaseProblems(piece, index > 0, index === pieces.length - 1).length > 0));
            if (bad) dirty.add(site.file);
        }
        expect([...PENDING_FILES.keys()].filter((file) => !dirty.has(file))).toEqual([]);
    });
});

describe('every button carries an icon', () => {
    it('no Button renders without an icon outside the listed exceptions', () => {
        const violations = iconViolations();
        expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
    });

    it('every save button uses SaveIcon', () => {
        const violations = saveIconViolations();
        expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
    });

    it('every icon exception still matches a button', () => {
        const ids = new Set(SITES.filter((site) => site.role === 'button').map((site) => `${site.file} :: ${site.label.map((entry) => entry.text ?? entry.unresolved ?? '').join(' | ').replaceAll(PLACEHOLDER, '{}')}`));
        expect([...ICONLESS.keys()].filter((id) => !ids.has(id))).toEqual([]);
    });
});
