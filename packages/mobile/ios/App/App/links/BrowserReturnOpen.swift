// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import Foundation

enum BrowserReturnOpen {

    typealias Opener = (URL, @escaping (Bool) -> Void) -> Void

    static func open(
        url: String,
        browser: String?,
        opener: @escaping Opener,
        completion: @escaping (Bool) -> Void
    ) {
        let candidates = BrowserReturnHint.candidates(url: url, browser: browser)
        var index = 0
        var completed = false

        func tryNext() {
            guard !completed else { return }
            guard index < candidates.count else {
                completed = true
                completion(false)
                return
            }

            let candidate = candidates[index]
            index += 1
            var answered = false
            opener(candidate) { opened in
                guard !answered, !completed else { return }
                answered = true
                if opened {
                    completed = true
                    completion(true)
                } else {
                    tryNext()
                }
            }
        }

        tryNext()
    }
}
