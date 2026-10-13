// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Timer half of the send hold: holds a promise for N seconds and releases it
// early by id. Pure; timers are injectable.

export function createSendHold({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const held = new Map()

  function hold(id, seconds) {
    if (held.has(id)) {
      return Promise.reject(new Error(`send hold already active for ${String(id)}`))
    }
    if (!(seconds > 0)) return Promise.resolve('elapsed')
    return new Promise((resolve) => {
      const timer = setTimer(() => {
        held.delete(id)
        resolve('elapsed')
      }, seconds * 1000)
      held.set(id, { timer, resolve })
    })
  }

  function cancel(id) {
    const entry = held.get(id)
    if (!entry) return false
    held.delete(id)
    clearTimer(entry.timer)
    entry.resolve('cancelled')
    return true
  }

  function isHeld(id) {
    return held.has(id)
  }

  return { hold, cancel, isHeld }
}

export class SendHoldCancelledError extends Error {
  constructor(holdId) {
    super(`send hold cancelled for ${String(holdId)}`)
    this.name = 'SendHoldCancelledError'
    this.holdId = holdId
  }
}

// Cancel-wins layer: a cancel that arrives before its hold is remembered, so
// the later hold rejects at once instead of running its window.
export function createSendHoldRegistry({
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  rememberLimit = 64,
} = {}) {
  const inner = createSendHold({ setTimer, clearTimer })
  const remembered = new Set()

  function hold(holdId, seconds) {
    if (inner.isHeld(holdId)) return inner.hold(holdId, seconds)
    if (remembered.delete(holdId)) {
      return Promise.reject(new SendHoldCancelledError(holdId))
    }
    return inner.hold(holdId, seconds).then((outcome) => {
      if (outcome === 'cancelled') throw new SendHoldCancelledError(holdId)
    })
  }

  function cancel(holdId) {
    if (inner.cancel(holdId)) return true
    if (rememberLimit > 0) {
      remembered.delete(holdId)
      remembered.add(holdId)
      while (remembered.size > rememberLimit) {
        remembered.delete(remembered.values().next().value)
      }
    }
    return false
  }

  function isHeld(holdId) {
    return inner.isHeld(holdId)
  }

  return { hold, cancel, isHeld }
}

export const SEND_HOLD_SECONDS_MAX = 30

// Turns the holdId and undoSeconds a send request carries into the function a
// send awaits before broadcast. Returns undefined when there is nothing to
// hold, so the send path stays as it is.
export function createHoldBeforeBroadcast({
  sendHold,
  holdId,
  undoSeconds,
  maxSeconds = SEND_HOLD_SECONDS_MAX,
  now = Date.now,
}) {
  if (holdId === undefined || holdId === null) return undefined
  if (typeof holdId !== 'string' || holdId.length === 0) {
    throw new TypeError('holdId must be a non-empty string')
  }
  if (!Number.isInteger(undoSeconds) || undoSeconds < 0) {
    throw new TypeError('undoSeconds must be a non-negative integer')
  }
  if (undoSeconds === 0) return undefined
  const seconds = Math.min(undoSeconds, maxSeconds)
  // The UI starts its countdown when the host accepts the send request, so
  // signing time consumes the same window instead of creating a hidden hold.
  const startedAt = now()
  return function holdBeforeBroadcast() {
    const elapsedSeconds = Math.max(0, (now() - startedAt) / 1000)
    return sendHold.hold(holdId, Math.max(0, seconds - elapsedSeconds))
  }
}
