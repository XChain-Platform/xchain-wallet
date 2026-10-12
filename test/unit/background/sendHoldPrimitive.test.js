// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest'
import { createSendHold } from '../../../packages/extension/src/background/sendHold.js'

function fakeTimers() {
  const timers = new Map()
  let next = 1
  return {
    timers,
    setTimer: (fn, ms) => {
      const handle = next++
      timers.set(handle, { fn, ms })
      return handle
    },
    clearTimer: (handle) => {
      timers.delete(handle)
    },
    fire: (handle) => {
      const t = timers.get(handle)
      timers.delete(handle)
      t.fn()
    },
  }
}

describe('createSendHold', () => {
  it('resolves elapsed after seconds * 1000 ms', async () => {
    const ft = fakeTimers()
    const h = createSendHold(ft)
    const p = h.hold('a', 5)
    expect(h.isHeld('a')).toBe(true)
    expect([...ft.timers.values()][0].ms).toBe(5000)
    ft.fire(1)
    expect(await p).toBe('elapsed')
    expect(h.isHeld('a')).toBe(false)
  })

  it('resolves cancelled on cancel and clears the timer', async () => {
    const ft = fakeTimers()
    const h = createSendHold(ft)
    const p = h.hold('a', 5)
    expect(h.cancel('a')).toBe(true)
    expect(await p).toBe('cancelled')
    expect(ft.timers.size).toBe(0)
    expect(h.isHeld('a')).toBe(false)
  })

  it('resolves elapsed at once with no timer for 0 seconds', async () => {
    const ft = fakeTimers()
    const h = createSendHold(ft)
    expect(await h.hold('a', 0)).toBe('elapsed')
    expect(ft.timers.size).toBe(0)
    expect(h.isHeld('a')).toBe(false)
  })

  it('rejects a second hold on a held id', async () => {
    const ft = fakeTimers()
    const h = createSendHold(ft)
    const p = h.hold('a', 5)
    await expect(h.hold('a', 5)).rejects.toThrow(/already/)
    expect(ft.timers.size).toBe(1)
    h.cancel('a')
    await p
  })

  it('cancel returns false for unknown or settled ids', async () => {
    const ft = fakeTimers()
    const h = createSendHold(ft)
    expect(h.cancel('nope')).toBe(false)
    const p = h.hold('a', 1)
    ft.fire(1)
    await p
    expect(h.cancel('a')).toBe(false)
  })

  it('allows a new hold after the id settled', async () => {
    const ft = fakeTimers()
    const h = createSendHold(ft)
    const p = h.hold('a', 1)
    h.cancel('a')
    await p
    const p2 = h.hold('a', 1)
    expect(h.isHeld('a')).toBe(true)
    h.cancel('a')
    expect(await p2).toBe('cancelled')
  })

  it('keeps ids independent', async () => {
    const ft = fakeTimers()
    const h = createSendHold(ft)
    const a = h.hold('a', 1)
    const b = h.hold('b', 1)
    h.cancel('a')
    expect(await a).toBe('cancelled')
    expect(h.isHeld('b')).toBe(true)
    h.cancel('b')
    await b
  })
})
