// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Asset or Token: a picker that offers the network coin and tokens is an
// Asset picker (field labelled Asset, placeholder "Select an asset", picker
// page titled Asset); a picker that offers only tokens (Destroy, Issue and the
// like) keeps Token. The words follow what the form accepts, not what its
// picker happens to list.
//
// This scan finds every TokenField, TokenPicker and Quick Give/Get asset chip
// in core and checks its visible words against the table below: an asset site
// never says "token", a token site never says "asset". A new use fails until
// it is classified here.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '../../../packages/core/src/i18n/locales/en/index.js';

const ROOT = 'packages/core/src';

// Every site, keyed `file#Tag#n` (n counts that tag's uses in the file, in
// source order). asset: the form takes the coin or a token. token: tokens
// only. exempt: not a coin-or-token choice (the reason says what it is).
const SITES = {
    'shared/components/PriceAlertForm.jsx#TokenPicker#0': 'asset',
    'shared/components/PriceAlertForm.jsx#TokenField#0': 'asset',
    // Send's Multi add-recipient field: the coin pays its own output and has
    // no multi-recipient form, so it offers tokens only.
    'shared/components/MultiSendRecipients.jsx#TokenField#0': 'token',
    'shared/components/marketTradeParts.jsx#QuickSide#0': 'exempt: the market page fixes the pair; the chip picks nothing',
    'shared/components/marketTradeParts.jsx#QuickSide#1': 'exempt: the market page fixes the pair; the chip picks nothing',
    'shared/routes/AirdropForm.jsx#TokenPicker#0': 'token',
    'shared/routes/AirdropForm.jsx#TokenPicker#1': 'token',
    'shared/routes/AirdropForm.jsx#TokenField#0': 'token',
    'shared/routes/AttachContentForm.jsx#TokenField#0': 'token',
    'shared/routes/BridgeMoveForm.jsx#TokenPicker#0': 'token',
    'shared/routes/BridgeMoveForm.jsx#TokenField#0': 'token',
    'shared/routes/CallbackForm.jsx#TokenPicker#0': 'token',
    'shared/routes/CallbackForm.jsx#TokenField#0': 'token',
    'shared/routes/ContractFundsForm.jsx#TokenPicker#0': 'token',
    'shared/routes/ContractFundsForm.jsx#TokenField#0': 'token',
    'shared/routes/StakingForm.jsx#TokenPicker#0': 'token',
    'shared/routes/StakingForm.jsx#TokenField#0': 'token',
    'shared/routes/ControllerBindForm.jsx#TokenField#0': 'token',
    'shared/routes/ControllerBindForm.jsx#TokenPicker#0': 'token',
    'shared/routes/CreateBetFeedForm.jsx#TokenPicker#0': 'token',
    'shared/routes/CreateBetFeedForm.jsx#TokenField#0': 'token',
    'shared/routes/CreateOrderForm.jsx#QuickSide#0': 'asset',
    'shared/routes/CreateOrderForm.jsx#QuickSide#1': 'asset',
    'shared/routes/CreateOrderForm.jsx#TokenField#0': 'asset',
    'shared/routes/CreateOrderForm.jsx#TokenPicker#0': 'asset',
    'shared/routes/CreatePollForm.jsx#TokenPicker#0': 'token',
    'shared/routes/CreatePollForm.jsx#TokenField#0': 'token',
    'shared/routes/CrossChainOrderForm.jsx#QuickSide#0': 'token',
    'shared/routes/CrossChainOrderForm.jsx#QuickSide#1': 'token',
    'shared/routes/CrossChainOrderForm.jsx#TokenPicker#0': 'token',
    'shared/routes/CrossChainOrderForm.jsx#TokenPicker#1': 'token',
    'shared/routes/CrossChainOrderForm.jsx#TokenFieldWithHelp#0': 'token',
    'shared/routes/CrossChainOrderForm.jsx#TokenFieldWithHelp#1': 'token',
    'shared/routes/CrossChainOrderForm.jsx#TokenField#0': 'exempt: the TokenFieldWithHelp wrapper; its two uses are classified',
    'shared/routes/CrossChainSwapForm.jsx#QuickSide#0': 'token',
    'shared/routes/CrossChainSwapForm.jsx#QuickSide#1': 'token',
    'shared/routes/CrossChainSwapForm.jsx#TokenPicker#0': 'token',
    'shared/routes/CrossChainSwapForm.jsx#TokenPicker#1': 'token',
    'shared/routes/CrossChainSwapForm.jsx#TokenField#0': 'token',
    'shared/routes/CrossChainSwapForm.jsx#TokenField#1': 'token',
    'shared/routes/DelegateVoteForm.jsx#TokenPicker#0': 'token',
    'shared/routes/DelegateVoteForm.jsx#TokenField#0': 'token',
    'shared/routes/DestroyForm.jsx#TokenPicker#0': 'token',
    'shared/routes/DestroyForm.jsx#TokenField#0': 'token',
    'shared/routes/DispenserForm.jsx#QuickSide#0': 'token',
    'shared/routes/DispenserForm.jsx#QuickSide#1': 'asset',
    'shared/routes/DispenserForm.jsx#TokenPicker#0': 'token',
    'shared/routes/DispenserForm.jsx#TokenPicker#1': 'asset',
    'shared/routes/DispenserForm.jsx#TokenField#0': 'token',
    'shared/routes/DispenserForm.jsx#TokenField#1': 'asset',
    'shared/routes/DividendForm.jsx#TokenPicker#0': 'token',
    'shared/routes/DividendForm.jsx#TokenPicker#1': 'token',
    'shared/routes/DividendForm.jsx#TokenField#0': 'token',
    'shared/routes/DividendForm.jsx#TokenField#1': 'token',
    'shared/routes/ExecuteContractForm.jsx#TokenPicker#0': 'token',
    'shared/routes/ExecuteContractForm.jsx#TokenField#0': 'token',
    'shared/routes/GatedPublishForm.jsx#TokenField#0': 'token',
    'shared/routes/GatedPublishForm.jsx#TokenPicker#0': 'token',
    // A subtoken's Parent token: a token the wallet owns, never a coin.
    'shared/routes/IssueTokenForm.jsx#TokenPicker#0': 'token',
    'shared/routes/IssueTokenForm.jsx#TokenField#0': 'token',
    'shared/routes/ListCreateForm.jsx#TokenPicker#0': 'token',
    'shared/routes/MarketActivity.jsx#TokenPicker#0': 'exempt: picks a market, not a coin or token to move',
    'shared/routes/MarketActivity.jsx#TokenPicker#1': 'exempt: wide market list, not a coin or token to move',
    'shared/routes/MintForm.jsx#TokenPicker#0': 'token',
    'shared/routes/MintForm.jsx#TokenField#0': 'token',
    // G122: the priced token; a PRICE quote names a token, never a coin.
    'shared/routes/OracleForm.jsx#TokenPicker#0': 'token',
    'shared/routes/OracleForm.jsx#TokenField#0': 'token',
    'shared/routes/ProjectRosterForm.jsx#TokenPicker#0': 'token',
    'shared/routes/Receive.jsx#TokenPicker#0': 'asset',
    'shared/routes/Receive.jsx#TokenField#0': 'asset',
    'shared/routes/ReceivePicker.jsx#TokenPicker#0': 'asset',
    // The token whose ownership is sold (operator 2026-11-15: the Name to
    // Sell field became Token): one of this wallet's own tokens, never a coin.
    'shared/routes/SellOwnershipForm.jsx#TokenPicker#0': 'token',
    'shared/routes/SellOwnershipForm.jsx#TokenField#0': 'token',
    // Get paid in: the network's coin or any token on it.
    'shared/routes/SellOwnershipForm.jsx#TokenPicker#1': 'asset',
    'shared/routes/SellOwnershipForm.jsx#TokenField#1': 'asset',
    'shared/routes/Send.jsx#TokenPicker#0': 'asset',
    'shared/routes/Send.jsx#TokenPicker#1': 'token',
    'shared/routes/Send.jsx#TokenField#0': 'asset',
    'shared/routes/SendPicker.jsx#TokenPicker#0': 'asset',
    'shared/routes/SleepForm.jsx#TokenPicker#0': 'token',
    'shared/routes/SleepForm.jsx#TokenField#0': 'token',
    'shared/routes/SwapForm.jsx#QuickSide#0': 'token',
    'shared/routes/SwapForm.jsx#QuickSide#1': 'token',
    'shared/routes/SwapForm.jsx#TokenPicker#0': 'token',
    'shared/routes/SwapForm.jsx#TokenPicker#1': 'token',
    'shared/routes/SwapForm.jsx#TokenField#0': 'token',
    'shared/routes/SwapForm.jsx#TokenField#1': 'token',
    'shared/routes/TokenAdminForm.jsx#TokenPicker#0': 'token',
    'shared/routes/TokenAdminForm.jsx#TokenPicker#1': 'token',
    'shared/routes/TokenAdminForm.jsx#TokenField#0': 'token',
    'shared/routes/TokenAdminForm.jsx#TokenField#1': 'token',
    'shared/routes/TokenAdminForm.jsx#TokenField#2': 'token',
    'shared/routes/UnbindForm.jsx#TokenField#0': 'token',
    'shared/routes/UnbindForm.jsx#TokenPicker#0': 'token',
};

// Known gaps in files another change owns right now; each is fixed there.
// The scan still classifies them and reports the words it found.
const PENDING = {};

const TOKEN_WORD = /\btokens?\b/i;
const ASSET_WORD = /\bassets?\b/i;

function jsxFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...jsxFiles(path));
        else if (/\.jsx?$/.test(entry.name)) out.push(path);
    }
    return out;
}

// The opening tag from `<Tag` to its closing `>`, skipping `>` inside braces.
function openingTag(src, start) {
    let depth = 0;
    for (let i = start; i < src.length; i += 1) {
        const c = src[i];
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        else if (c === '>' && depth === 0) return src.slice(start, i + 1);
    }
    return src.slice(start);
}

// The words a prop value can show: t() keys resolve to English, and every
// string literal in an expression counts (so both arms of a ternary are read).
function valueTexts(raw) {
    const texts = [];
    const withoutCalls = raw.replace(/\bt\(\s*(['"])([^'"]+)\1[^)]*\)/g, (_m, _q, key) => {
        texts.push(en[key] ?? `<missing ${key}>`);
        return '';
    });
    for (const m of withoutCalls.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)) texts.push(m[2]);
    return texts;
}

function propValue(tag, name) {
    const m = tag.match(new RegExp(`\\s${name}=`));
    if (!m) return null;
    let i = m.index + m[0].length;
    const open = tag[i];
    if (open === '"' || open === "'") return tag.slice(i, tag.indexOf(open, i + 1) + 1);
    if (open !== '{') return null;
    let depth = 0;
    for (let j = i; j < tag.length; j += 1) {
        if (tag[j] === '{') depth += 1;
        else if (tag[j] === '}') { depth -= 1; if (depth === 0) return tag.slice(i, j + 1); }
    }
    return tag.slice(i);
}

function objectValue(src, start) {
    // The value after `key:` up to the next comma or newline at depth 0.
    let depth = 0;
    for (let j = start; j < src.length; j += 1) {
        const c = src[j];
        if ('({['.includes(c)) depth += 1;
        else if (')}]'.includes(c)) { if (depth === 0) return src.slice(start, j); depth -= 1; }
        else if ((c === ',' || c === '\n') && depth === 0) return src.slice(start, j);
    }
    return src.slice(start);
}

function scan() {
    const sites = [];
    for (const path of jsxFiles(ROOT)) {
        const src = readFileSync(path, 'utf8');
        const file = relative(ROOT, path).split('\\').join('/');
        const counts = {};
        for (const m of src.matchAll(/<(TokenFieldWithHelp|TokenField|TokenPicker)(?=[\s/>])/g)) {
            const tagName = m[1];
            const n = counts[tagName] ?? 0;
            counts[tagName] = n + 1;
            const tag = openingTag(src, m.index);
            const texts = [];
            for (const prop of ['label', 'title', 'placeholder']) {
                const raw = propValue(tag, prop);
                if (raw != null) texts.push(...valueTexts(raw));
            }
            const spread = /\{\.\.\.\w+\}/.test(tag);
            if (tagName !== 'TokenPicker' && !spread) {
                // TokenField's own defaults show when the host leaves them out.
                if (propValue(tag, 'label') == null) texts.push(en['send.fields.token']);
                if (propValue(tag, 'placeholder') == null) texts.push(en['components.tokenField.selectAToken']);
            }
            sites.push({ key: `${file}#${tagName}#${n}`, line: src.slice(0, m.index).split('\n').length, texts });
        }
        if (file.startsWith('shared/components/giveGet/')) continue;
        let side = 0;
        for (const m of src.matchAll(/\bassetLabel:\s*/g)) {
            const label = objectValue(src, m.index + m[0].length);
            // The side's placeholder sits in the same object, before the next side.
            const rest = src.slice(m.index + m[0].length);
            const nextSide = rest.search(/\bassetLabel:/);
            const scope = nextSide === -1 ? rest.slice(0, 1500) : rest.slice(0, nextSide);
            const ph = scope.match(/\bassetPlaceholder:\s*/);
            const texts = valueTexts(label);
            if (ph) texts.push(...valueTexts(objectValue(scope, ph.index + ph[0].length)));
            else texts.push(en['components.tokenField.selectAToken']);
            sites.push({ key: `${file}#QuickSide#${side}`, line: src.slice(0, m.index).split('\n').length, texts });
            side += 1;
        }
    }
    return sites;
}

const sites = scan();

describe('Asset and Token picker labels', () => {
    it('finds the pickers it is meant to check', () => {
        expect(sites.length).toBeGreaterThan(60);
        expect(sites.some((s) => s.key === 'shared/routes/Send.jsx#TokenField#0')).toBe(true);
    });

    it('classifies every TokenField, TokenPicker and Quick asset chip', () => {
        const unclassified = sites.filter((s) => !(s.key in SITES)).map((s) => `${s.key} (line ${s.line}): ${s.texts.join(' | ')}`);
        expect(unclassified).toEqual([]);
    });

    it('lists no site that is gone', () => {
        const live = new Set(sites.map((s) => s.key));
        expect(Object.keys(SITES).filter((key) => !live.has(key))).toEqual([]);
    });

    it('never says "token" where the coin can be picked, nor "asset" where only tokens can', () => {
        const wrong = [];
        for (const site of sites) {
            const kind = SITES[site.key];
            if (!kind || kind.startsWith('exempt') || site.key in PENDING) continue;
            const bad = site.texts.filter((text) => (kind === 'asset' ? TOKEN_WORD : ASSET_WORD).test(text));
            if (bad.length) wrong.push(`${site.key} (line ${site.line}, ${kind}): ${bad.join(' | ')}`);
        }
        expect(wrong).toEqual([]);
    });

    it('names only live, classified sites as pending', () => {
        // Once a pending gap is fixed, drop its entry so the main check covers it.
        const live = new Set(sites.map((s) => s.key));
        expect(Object.keys(PENDING).filter((key) => !live.has(key) || !(key in SITES))).toEqual([]);
    });

    it('labels an asset field Asset with "Select an asset" when the host uses the shared words', () => {
        expect(en['send.asset']).toBe('Asset');
        expect(en['send.selectAsset']).toBe('Select an asset');
        expect(en['send.fields.token']).toMatch(TOKEN_WORD);
    });
});
