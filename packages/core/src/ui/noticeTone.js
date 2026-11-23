// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export const NOTICE_TONE_BY_VARIANT = Object.freeze({
    status: Object.freeze({ tone: 'info' }),
    info: Object.freeze({ tone: 'info' }),
    note: Object.freeze({ tone: 'info' }),
    warning: Object.freeze({ tone: 'danger', caution: true }),
    error: Object.freeze({ tone: 'danger' }),
    danger: Object.freeze({ tone: 'danger' }),
    critical: Object.freeze({ tone: 'danger' }),
    success: Object.freeze({ tone: 'success' }),
});

export function noticeToneProps(variant) {
    return NOTICE_TONE_BY_VARIANT[variant] || NOTICE_TONE_BY_VARIANT.status;
}
