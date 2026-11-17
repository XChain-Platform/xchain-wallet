// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The form error standard (Notice Standard, 2026-11-15). Pressing Next or
// submit validates the whole form: one danger notice at the top lists every
// problem in plain text, and every failing field gets a red border (its
// border only) with its message under it. As soon as the user changes a
// field, that field goes back to normal and its line leaves the notice; the
// others stay until they are fixed or the next press validates again.
//
// A form keeps one error map (field id to message) from useFormErrors and
// hands it to FormPage or FormFrame as `errors`. The kit fields (Input,
// Select, Textarea, IconSelect through Select) read their own entry by id
// from the context those templates provide, so the form passes no `error`
// prop and writes no per-field clearing code. The picker fields (NetworkField
// and ChainPicker, TokenField, the From and Fees sections) do the same through
// usePickedFieldError, since a pick reaches them as a new value, not a typed
// change.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * @typedef {object} FormErrors
 * @property {Readonly<Record<string, string>>} errors  open problems, field id (or a form-level key) to message, in the order validate named them
 * @property {number} attempt     bumps on every validate or fail, so a field re-marks the same message on the next press
 * @property {boolean} hasErrors
 * @property {(map: Record<string, string | null | undefined | false>) => boolean} validate  replace the map with every truthy entry; true when nothing failed
 * @property {(message: string, key?: string) => void} fail  add one problem without a field (generation failed, the network refused), keyed 'form' by default
 * @property {(id: string) => void} clear   drop one entry (the fields call it on change)
 * @property {() => void} reset             drop every entry
 * @property {(id: string) => string | undefined} errorFor
 */

/** @type {import('react').Context<FormErrors | null>} */
export const FormErrorsContext = createContext(/** @type {FormErrors | null} */ (null));

const EMPTY = Object.freeze({});

/**
 * The one form error state. Call `validate` from the submit handler with a
 * message (or nothing) per field id; it returns true when the form may go on.
 *
 * @returns {FormErrors}
 */
export function useFormErrors() {
    const [state, setState] = useState(() => ({ errors: /** @type {Record<string, string>} */ (EMPTY), attempt: 0 }));
    const validate = useCallback((map) => {
        const entries = Object.entries(map || {})
            .filter(([, message]) => typeof message === 'string' && message !== '');
        setState((prev) => ({
            errors: entries.length > 0 ? Object.fromEntries(entries) : EMPTY,
            attempt: prev.attempt + 1,
        }));
        return entries.length === 0;
    }, []);
    const fail = useCallback((message, key = 'form') => {
        if (typeof message !== 'string' || message === '') return;
        setState((prev) => ({ errors: { ...prev.errors, [key]: message }, attempt: prev.attempt + 1 }));
    }, []);
    const clear = useCallback((id) => {
        setState((prev) => {
            if (!id || !Object.prototype.hasOwnProperty.call(prev.errors, id)) return prev;
            const next = { ...prev.errors };
            delete next[id];
            return { ...prev, errors: Object.keys(next).length > 0 ? next : EMPTY };
        });
    }, []);
    const reset = useCallback(() => {
        setState((prev) => (prev.errors === EMPTY ? prev : { ...prev, errors: EMPTY }));
    }, []);
    return useMemo(() => ({
        errors: state.errors,
        attempt: state.attempt,
        hasErrors: Object.keys(state.errors).length > 0,
        validate,
        fail,
        clear,
        reset,
        errorFor: (id) => (id ? state.errors[id] : undefined),
    }), [state, validate, fail, clear, reset]);
}

/**
 * A kit field's own entry in the surrounding form's error map, if any.
 * `error` and `errorKey` feed the field's existing error slot; `clear` is
 * called from its change handler.
 *
 * @param {string | undefined} id  the field's explicit id (an auto id never matches the map)
 * @returns {{ error: string | undefined, errorKey: number | undefined, clear: () => void }}
 */
export function useFormFieldError(id) {
    const form = useContext(FormErrorsContext);
    const error = form && id ? form.errors[id] : undefined;
    const clearOwn = form?.clear;
    const clear = useCallback(() => {
        if (clearOwn && id) clearOwn(id);
    }, [clearOwn, id]);
    return { error, errorKey: form && error ? form.attempt : undefined, clear };
}

/**
 * useFormFieldError for a field whose value comes from a picker (a network,
 * a token, an address page, a fee speed): the entry also leaves the map when
 * the value changes, since a pick fires no change event in the field. Pass a
 * string or number for `valueKey` ("chainId|tick"), never a fresh object,
 * or every render would read as a change.
 *
 * @param {string | undefined} id
 * @param {string | number | null | undefined} valueKey
 * @returns {{ error: string | undefined, errorKey: number | undefined, clear: () => void }}
 */
export function usePickedFieldError(id, valueKey) {
    const field = useFormFieldError(id);
    const { clear } = field;
    const lastValueRef = useRef(valueKey);
    useEffect(() => {
        if (Object.is(lastValueRef.current, valueKey)) return;
        lastValueRef.current = valueKey;
        clear();
    }, [valueKey, clear]);
    return field;
}

/**
 * The map as the error notice's list: one entry per open problem, in order,
 * with its field id when the key names a field on the page.
 *
 * @param {FormErrors | null | undefined} form
 * @returns {{ id?: string, message: string }[]}
 */
export function formErrorList(form) {
    if (!form) return [];
    return Object.entries(form.errors).map(([key, message]) => (
        key === 'form' || key.startsWith('form:') ? { message } : { id: key, message }
    ));
}
