// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const PRESENTATION = {
    critical: { kind: 'critical', label: 'Critical' },
    warning: { kind: 'warning', label: 'Warning' },
    info: { kind: 'info', label: 'Info' },
};

/** Keeps the visible severity label and its semantic color class in sync. */
export function alertSeverityPresentation(severity) {
    return PRESENTATION[severity] || PRESENTATION.info;
}
