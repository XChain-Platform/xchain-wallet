// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: MIT

const RECORD_FIELDS = ['id', 'method', 'nonce', 'state'];
const RECORD_FIELD_SET = new Set(RECORD_FIELDS);
const hasOwn = (value, field) => Object.prototype.hasOwnProperty.call(value, field);

function invalidField(record) {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
        return RECORD_FIELDS[0];
    }

    for (const field of RECORD_FIELDS) {
        if (!hasOwn(record, field) || typeof record[field] !== 'string' || record[field].length === 0) {
            return field;
        }
    }

    return null;
}

function extraKey(record) {
    if (record === null || typeof record !== 'object') return null;
    return Object.keys(record).find((field) => !RECORD_FIELD_SET.has(field)) ?? null;
}

function recordError(record) {
    const field = invalidField(record);
    if (field !== null) return `Pending record field "${field}" must be a non-empty string`;

    const extra = extraKey(record);
    if (extra !== null) return `Pending record has extra key "${extra}"`;

    return null;
}

export function createPendingStore(storage, key) {
    function clear() {
        storage.removeItem(key);
    }

    function dropCorruptEntry() {
        try {
            clear();
        } catch {
            return;
        }
    }

    return {
        get() {
            const text = storage.getItem(key);
            if (text === null) return null;

            let record;
            try {
                record = JSON.parse(text);
            } catch {
                dropCorruptEntry();
                return null;
            }

            if (recordError(record) !== null) {
                dropCorruptEntry();
                return null;
            }

            return record;
        },

        set(record) {
            const error = recordError(record);
            if (error !== null) throw new TypeError(error);
            storage.setItem(key, JSON.stringify(record));
        },

        clear,
    };
}
