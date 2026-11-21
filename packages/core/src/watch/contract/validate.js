// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const types = {
    array: Array.isArray,
    boolean: (value) => typeof value === 'boolean',
    integer: Number.isInteger,
    number: (value) => typeof value === 'number' && Number.isFinite(value),
    object: (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
    string: (value) => typeof value === 'string',
};

const childPath = (path, key) => `${path}.${key}`;

function resolveRef(root, ref) {
    if (!ref.startsWith('#/')) return undefined;
    return ref.slice(2).split('/').reduce((node, part) => (
        node?.[part.replaceAll('~1', '/').replaceAll('~0', '~')]
    ), root);
}

function rejectNulls(value, path, errors) {
    if (value === null) errors.add(path);
    else if (Array.isArray(value)) value.forEach((item, index) => rejectNulls(item, `${path}[${index}]`, errors));
    else if (typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) rejectNulls(item, childPath(path, key), errors);
    }
}

function visit(schema, value, path, root, errors) {
    if (value === null) return;
    const errorsBefore = errors.size;
    if (schema.$ref) {
        const target = resolveRef(root, schema.$ref);
        if (!target) errors.add(path);
        else visit(target, value, path, root, errors);
    }
    if (schema.type && !types[schema.type]?.(value)) {
        errors.add(path);
        return;
    }
    if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) errors.add(path);
    if (Object.hasOwn(schema, 'const') && !Object.is(schema.const, value)) errors.add(path);
    if (typeof value === 'string') {
        const length = [...value].length;
        if (schema.minLength !== undefined && length < schema.minLength) errors.add(path);
        if (schema.maxLength !== undefined && length > schema.maxLength) errors.add(path);
        if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.add(path);
    }
    if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.add(path);
    if (Array.isArray(value)) {
        if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.add(path);
        if (schema.items) value.forEach((item, index) => visit(schema.items, item, `${path}[${index}]`, root, errors));
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const key of schema.required ?? []) {
            if (!Object.hasOwn(value, key)) errors.add(childPath(path, key));
        }
        const properties = schema.properties ?? {};
        for (const [key, propertySchema] of Object.entries(properties)) {
            if (Object.hasOwn(value, key)) visit(propertySchema, value[key], childPath(path, key), root, errors);
        }
        if (schema.additionalProperties === false) {
            for (const key of Object.keys(value)) {
                if (!Object.hasOwn(properties, key)) errors.add(childPath(path, key));
            }
        }
    }
    if (errors.size === errorsBefore && Array.isArray(schema.oneOf)) {
        const matches = schema.oneOf.filter((branch) => {
            const branchErrors = new Set();
            visit(branch, value, path, root, branchErrors);
            return branchErrors.size === 0;
        });
        if (matches.length !== 1) errors.add(path);
    }
    if (errors.size === errorsBefore && schema.not) {
        const branchErrors = new Set();
        visit(schema.not, value, path, root, branchErrors);
        if (branchErrors.size === 0) errors.add(path);
    }
}

export function validate(schema, value) {
    const errors = new Set();
    rejectNulls(value, '$', errors);
    visit(schema, value, '$', schema, errors);
    return [...errors];
}

export const validateContract = validate;
export default validate;
