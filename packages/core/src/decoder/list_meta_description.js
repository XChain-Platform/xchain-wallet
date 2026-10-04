// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { neutralizeControlText } from '../shared/utils/textHardening.js';

function str(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.map((item) => str(item)).join(', ');
    return String(value);
}

function toArray(value) {
    if (value === undefined || value === null) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => str(item));
}

export function decodeListCreateMeta(p, chainSuffix = '') {
    const type = str(p.TYPE);
    const rawName = str(p.NAME);
    const rawDescription = str(p.DESCRIPTION);
    const name = neutralizeControlText(rawName);
    const description = neutralizeControlText(rawDescription);
    const memo = str(p.MEMO);
    const items = toArray(p.ITEM);
    const count = items.length;
    const union = type === '3';
    const kind = type === '1' ? 'token' : type === '2' ? 'address' : union ? 'union' : 'item';
    const countText = union
        ? `${count || '?'} member lists`
        : `${count || '?'} item${count === 1 ? '' : 's'}`;

    return {
        summary: `Create ${kind} list${name ? ` "${name}"` : ''} of ${countText}${chainSuffix}`,
        details: [
            { label: 'Type', value: type === '1' ? 'Token' : type === '2' ? 'Address' : union ? 'Union' : type },
            ...(name ? [{ label: 'Name', value: name }] : []),
            ...(description ? [{ label: 'Description', value: description }] : []),
            { label: 'Items', value: String(count) },
            ...(count > 0
                ? [{ label: union ? 'Member list indexes' : 'Sample', value: items.slice(0, 5).join(', ') }]
                : []),
            ...(memo ? [{ label: 'Memo', value: memo }] : []),
        ],
        warnings: [
            ...(!type ? ['List type is empty. Specify a token list or an address list.'] : []),
            ...(count === 0 ? ['List has no items.'] : []),
            ...(rawName === '-'
                ? ['Name cannot be cleared when creating a list. The indexer will refuse it as NAME (format).']
                : []),
            ...(rawDescription === '-'
                ? ['Description cannot be cleared when creating a list. The indexer will refuse it as DESCRIPTION (format).']
                : []),
        ],
    };
}

function describeMetaField(rawValue) {
    if (!rawValue) return 'Unchanged';
    if (rawValue === '-') return 'Cleared';
    return `Set to: ${neutralizeControlText(rawValue)}`;
}

export function decodeListSetMeta(p) {
    const idx = str(p.LIST_ACTION_INDEX);
    const name = str(p.NAME);
    const description = str(p.DESCRIPTION);
    const memo = str(p.MEMO);
    return {
        summary: `Update metadata on list #${idx || '?'}`,
        details: [
            { label: 'List action index', value: idx },
            { label: 'Name', value: describeMetaField(name) },
            { label: 'Description', value: describeMetaField(description) },
            ...(memo ? [{ label: 'Memo', value: memo }] : []),
        ],
        warnings: [
            ...(name && name !== '-'
                ? ['Renaming a shared list charges the shared-list edit fee.']
                : []),
            ...(!name && !description
                ? ['Name and description are both unchanged. The indexer will refuse this action as NAME (no change).']
                : []),
            ...(!idx ? ['List action index is empty.'] : []),
        ],
    };
}
