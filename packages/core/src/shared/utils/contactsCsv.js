// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { validateContact } from '../../schemas/contact.js';
import { randomUUID } from '../../util/uuid.js';
import { detectAddressCoin, isValidAddressAnyNetwork } from './addressValidation.js';
import { csvField, parseCsvRecords } from './csv.js';

export const CONTACT_CSV_COLUMNS = Object.freeze([
    'schemaVersion',
    'id',
    'name',
    'notes',
    'avatarSeed',
    'createdAt',
    'updatedAt',
    'chain',
    'address',
    'label',
]);

const REQUIRED_COLUMNS = ['name', 'chain', 'address'];
const CONTACT_FIELDS = ['schemaVersion', 'id', 'name', 'notes', 'avatarSeed', 'createdAt', 'updatedAt'];

/**
 * Export one row per address. Contact metadata repeats so every row remains
 * understandable in a spreadsheet and rows with the same id reassemble into
 * one multi-address contact during import.
 *
 * @param {any[]} contacts
 */
export function contactsToCsv(contacts) {
    const lines = [CONTACT_CSV_COLUMNS.join(',')];
    for (const contact of Array.isArray(contacts) ? contacts : []) {
        for (const entry of Array.isArray(contact?.entries) ? contact.entries : []) {
            lines.push(CONTACT_CSV_COLUMNS.map((column) => csvField(
                Object.hasOwn(entry, column) ? entry[column] : contact?.[column],
            )).join(','));
        }
    }
    return `${lines.join('\r\n')}\r\n`;
}

/**
 * @param {string} text
 * @param {{ now?: string, makeId?: () => string }} [options]
 * @returns {{ records: Array<{ record: any, line: number }>, failures: Array<{ subject: string, message: string }>, duplicates: number }}
 */
export function contactsFromCsv(text, options = {}) {
    const rows = parseCsvRecords(text, { strict: true });
    const content = rows.filter(({ cells }) => cells.some((cell) => cell.trim() !== ''));
    if (content.length === 0) throw new Error('The contacts CSV is empty.');

    const header = content[0];
    const names = header.cells.map((cell, index) => normalizeHeader(cell, index));
    const duplicateHeader = names.find((name, index) => name && names.indexOf(name) !== index);
    if (duplicateHeader) throw new Error(`Line ${header.line}: duplicate "${duplicateHeader}" column.`);
    for (const required of REQUIRED_COLUMNS) {
        if (!names.includes(required.toLowerCase())) {
            throw new Error(`Line ${header.line}: missing required "${required}" column.`);
        }
    }

    const now = options.now || new Date().toISOString();
    const makeId = options.makeId || randomUUID;
    const groups = new Map();
    const addressOwners = new Map();
    const failures = [];
    let duplicates = 0;

    for (const row of content.slice(1)) {
        const value = Object.fromEntries(CONTACT_CSV_COLUMNS.map((name) => [name, '']));
        names.forEach((name, index) => { value[name] = row.cells[index] ?? ''; });
        const rowError = validateRow(value, row, names.length);
        if (rowError) {
            failures.push(failure(row.line, value.name, rowError));
            continue;
        }

        const groupKey = value.id.trim() || `name:${value.name.trim().toLocaleLowerCase()}`;
        let group = groups.get(groupKey);
        if (!group) {
            const record = {
                schemaVersion: value.schemaVersion.trim() === '' ? 1 : Number(value.schemaVersion),
                id: value.id.trim() || makeId(),
                name: value.name.trim(),
                notes: value.notes,
                entries: [],
                avatarSeed: value.avatarSeed || value.address.trim(),
                createdAt: value.createdAt.trim() || now,
                updatedAt: value.updatedAt.trim() || now,
            };
            group = { record, line: row.line, source: value };
            groups.set(groupKey, group);
        } else {
            const mismatch = CONTACT_FIELDS.find((field) => {
                if (field === 'schemaVersion') return value[field].trim() && Number(value[field]) !== group.record[field];
                if (field === 'id') return value[field].trim() && value[field].trim() !== group.record[field];
                if (field === 'avatarSeed') return value[field] && value[field] !== group.record[field];
                if (field === 'createdAt' || field === 'updatedAt') return value[field].trim() && value[field].trim() !== group.record[field];
                return value[field] !== group.source[field];
            });
            if (mismatch) {
                failures.push(failure(row.line, value.name, `conflicts with line ${group.line} in the "${mismatch}" column.`));
                continue;
            }
        }

        const address = value.address.trim();
        const addressKey = normalizedAddress(address);
        const owner = addressOwners.get(addressKey);
        if (owner) {
            if (owner.groupKey === groupKey) {
                duplicates += 1;
            } else {
                failures.push(failure(row.line, value.name, `address duplicates line ${owner.line}.`));
            }
            continue;
        }
        addressOwners.set(addressKey, { groupKey, line: row.line });
        group.record.entries.push({
            chain: value.chain.trim().toLowerCase(),
            address,
            label: value.label,
        });
    }

    const records = [];
    for (const { record, line } of groups.values()) {
        if (record.entries.length === 0) continue;
        const validation = validateContact(record);
        if (!validation.ok) {
            failures.push(failure(line, record.name, validation.errors.join('; ')));
            continue;
        }
        records.push({ record, line });
    }
    return { records, failures, duplicates };
}

function normalizeHeader(cell, index) {
    const value = (index === 0 ? cell.replace(/^\uFEFF/, '') : cell).trim().toLowerCase();
    const known = CONTACT_CSV_COLUMNS.find((column) => column.toLowerCase() === value);
    return known || value;
}

function validateRow(value, row, width) {
    if (row.cells.length !== width) return `has ${row.cells.length} columns; expected ${width}.`;
    if (!value.name?.trim()) return 'name is required.';
    if (!value.chain?.trim()) return 'chain is required.';
    if (!value.address?.trim()) return 'address is required.';
    if (value.schemaVersion?.trim() && Number(value.schemaVersion) !== 1) return 'schemaVersion must be 1.';
    const address = value.address.trim();
    if (!isValidAddressAnyNetwork(address)) return `"${address}" is not a valid supported address.`;
    const chain = value.chain.trim().toLowerCase();
    if (!['bitcoin', 'litecoin', 'dogecoin'].includes(chain)) {
        return 'chain must be bitcoin, litecoin, or dogecoin.';
    }
    const addressCoin = detectAddressCoin(address);
    if (addressCoin && addressCoin !== chain) {
        return `address belongs to ${addressCoin}, not ${chain}.`;
    }
    return null;
}

function failure(line, name, message) {
    return { subject: name?.trim() || `Line ${line}`, message: `Line ${line}: ${message}` };
}

function normalizedAddress(address) {
    const trimmed = String(address || '').trim();
    const lower = trimmed.toLowerCase();
    return /^(bc|tb|bcrt|ltc|tltc|rltc)1/.test(lower) ? lower : trimmed;
}
