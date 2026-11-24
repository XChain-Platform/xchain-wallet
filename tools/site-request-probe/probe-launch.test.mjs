// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeLaunches } from './probe-launch.mjs';

function summary(overrides = {}) {
    return {
        kind: 'script',
        launch: 'window.open-click-tick',
        target: 'xchain://launch',
        userActivationActive: true,
        popupBlocked: false,
        lostFocus: false,
        ...overrides,
    };
}

test('returns an empty array for a non-array input', () => {
    assert.deepEqual(summarizeLaunches(null), []);
    assert.deepEqual(summarizeLaunches({}), []);
});

test('skips an entry without a string type', () => {
    assert.deepEqual(summarizeLaunches([
        null,
        [],
        {},
        { type: 42, launchType: 'window.open-click-tick' },
    ]), []);
});

test('summarizes a click-tick popup with activation and a successful result', () => {
    assert.deepEqual(summarizeLaunches([
        {
            type: 'launch-attempt',
            launchType: 'window.open-click-tick',
            target: 'xchain://launch',
            userActivationActive: true,
            time: '2026-01-01T00:00:00.000Z',
        },
        {
            type: 'launch-result',
            launchType: 'window.open-click-tick',
            popupReturnedNull: false,
            time: '2026-01-01T00:00:00.001Z',
        },
    ]), [summary()]);
});

test('summarizes an after-await popup with lost activation and a blocked result', () => {
    assert.deepEqual(summarizeLaunches([
        {
            type: 'launch-attempt',
            launchType: 'window.open-after-await',
            target: 'xchain://await',
            userActivationActive: false,
        },
        {
            type: 'launch-result',
            launchType: 'window.open-after-await',
            popupReturnedNull: true,
        },
    ]), [summary({
        launch: 'window.open-after-await',
        target: 'xchain://await',
        userActivationActive: false,
        popupBlocked: true,
    })]);
});

test('does not credit a launch result across a later launch', () => {
    assert.deepEqual(summarizeLaunches([
        {
            type: 'launch-attempt',
            launchType: 'window.open-click-tick',
            target: 'https://first.example',
            userActivationActive: true,
        },
        {
            type: 'launch-attempt',
            launchType: 'location.assign',
            target: 'https://second.example',
            userActivationActive: true,
        },
        {
            type: 'launch-result',
            launchType: 'window.open-click-tick',
            popupReturnedNull: true,
        },
    ]), [
        summary({
            target: 'https://first.example',
            popupBlocked: null,
            lostFocus: null,
        }),
        summary({
            launch: 'location.assign',
            target: 'https://second.example',
            popupBlocked: null,
        }),
    ]);
});

test('reports pagehide inside the window for location.assign', () => {
    assert.deepEqual(summarizeLaunches([
        {
            type: 'launch-attempt',
            launchType: 'location.assign',
            target: 'https://destination.example',
            time: '2026-01-01T00:00:00.000Z',
        },
        { type: 'pagehide', time: '2026-01-01T00:00:01.500Z' },
    ]), [summary({
        launch: 'location.assign',
        target: 'https://destination.example',
        userActivationActive: null,
        popupBlocked: null,
        lostFocus: true,
    })]);
});

test('does not report a blur outside the default window', () => {
    assert.deepEqual(summarizeLaunches([
        {
            type: 'launch-attempt',
            launchType: 'scheme-location-assign',
            target: 'xchain://late',
            userActivationActive: true,
            time: '2026-01-01T00:00:00.000Z',
        },
        { type: 'blur', time: '2026-01-01T00:00:05.000Z' },
    ]), [summary({
        launch: 'scheme-location-assign',
        target: 'xchain://late',
        popupBlocked: null,
    })]);
});

test('reports a hidden visibility change for a scheme anchor', () => {
    assert.deepEqual(summarizeLaunches([
        {
            type: 'anchor-launch',
            control: 'scheme-anchor',
            target: 'xchain://anchor',
            userActivationActive: true,
            time: '2026-01-01T00:00:00.000Z',
        },
        {
            type: 'visibilitychange',
            visibility: 'hidden',
            time: '2026-01-01T00:00:00.500Z',
        },
    ]), [summary({
        kind: 'anchor',
        launch: 'scheme-anchor',
        target: 'xchain://anchor',
        popupBlocked: null,
        lostFocus: true,
    })]);
});

test('does not report a visible visibility change as lost focus', () => {
    assert.deepEqual(summarizeLaunches([
        {
            type: 'anchor-launch',
            control: 'scheme-anchor',
            target: 'xchain://anchor',
            userActivationActive: true,
        },
        { type: 'visibilitychange', visibility: 'visible' },
    ]), [summary({
        kind: 'anchor',
        launch: 'scheme-anchor',
        target: 'xchain://anchor',
        popupBlocked: null,
    })]);
});

test('reports unknown focus state when no event follows a launch', () => {
    assert.deepEqual(summarizeLaunches([
        {
            type: 'launch-attempt',
            launchType: 'scheme-after-await',
            target: 42,
            userActivationActive: 'yes',
        },
    ]), [summary({
        launch: 'scheme-after-await',
        target: null,
        userActivationActive: null,
        popupBlocked: null,
        lostFocus: null,
    })]);
});

test('judges unparseable times by log order', () => {
    assert.deepEqual(summarizeLaunches([
        {
            type: 'launch-attempt',
            launchType: 'scheme-location-assign',
            target: 'xchain://unparseable',
            time: 'not-a-date',
        },
        { type: 'blur', time: 'also-not-a-date' },
    ], { windowMs: 0 }), [summary({
        launch: 'scheme-location-assign',
        target: 'xchain://unparseable',
        userActivationActive: null,
        popupBlocked: null,
        lostFocus: true,
    })]);
});

test('skips every P11 launch entry', () => {
    assert.deepEqual(summarizeLaunches([
        { type: 'launch-attempt', launchType: 'http-302-entry' },
        { type: 'anchor-launch', control: 'redirect-anchor' },
        { type: 'anchor-launch', control: 'script-source' },
        { type: 'redirect-attempt', redirectType: 'location.assign' },
        { type: 'redirect-attempt', redirectType: 'location.replace' },
    ]), []);
});
