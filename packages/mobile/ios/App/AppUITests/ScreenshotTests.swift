// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// App Store screenshot harness ( §6, ).
//
// The listing needs an iPhone set AND an iPad set, and for a universal app a
// missing iPad set BLOCKS submission rather than merely degrading the listing.
// Doing that by hand is a dozen simulator boots per release; here it is one
// command per idiom, and the set regenerates when the UI changes.
//
// THREE CONSTRAINTS SHAPE ALL OF THIS.
//
// 1. The harness drives the REAL app through its REAL onboarding. There is no
//    launch argument that seeds a wallet and no branch in the app keyed on
//    being tested, because  §2.1 forbids any build that behaves
//    differently when it believes it is under review, and a screenshot
//    harness does not get an exception. The side benefit is that a broken
//    first-run flow fails here before it fails in front of a reviewer.
//
// 2. It uses DEMO MODE, the app's own front-door affordance, not a funded
//    wallet. A real wallet would mean a seed in CI and balances that drift;
//    demo mode is populated, deterministic, needs no network, and cannot leak
//    key material. No screenshot may ever show a real recovery phrase or a
//    mainnet address holding real funds.
//
// 3. Every scene is captured NON-FATALLY. A scene that cannot be reached logs
//    loudly, captures whatever is on screen, and lets the run continue, so one
//    execution reports on all four scenes instead of dying at the first
//    selector that moved. A harness that fails fast costs a full rebuild per
//    discovery, and that is how screenshot tooling ends up abandoned.
//
// The UI is a WKWebView. Web content reaches XCUITest through WebKit's
// accessibility bridge, so elements are addressed by accessible name
// (aria-label, button text, label text), never by pixel coordinates.
//
// Do NOT pass CODE_SIGNING_ALLOWED=NO to xcodebuild for this. It applies to
// every target including App, strips the app's entitlements, and the wallet
// then cannot reach the Keychain: the run comes up on "Your device needs to be
// unlocked" (OSStatus -34018) and every screenshot is of an error screen.

import XCTest

final class ScreenshotTests: XCTestCase {

    private var app: XCUIApplication!
    /// Scenes that could not be reached. Reported in one place at the end, so
    /// the failure message names everything wrong rather than the first thing.
    private var missed: [String] = []

    override func setUpWithError() throws {
        // Deliberately false: see constraint 3. Individual steps assert
        // through `reach(...)`, which records rather than aborts.
        continueAfterFailure = true
        app = XCUIApplication()
    }

    // MARK: - Capture

    /// Attach a full-screen PNG under a stable name. The driver script pulls
    /// these out of the .xcresult with `xcrun xcresulttool export attachments`.
    private func capture(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        print("SCREENSHOT: \(name)")
    }

    /// Wait for an element, recording a miss instead of aborting the run.
    @discardableResult
    private func reach(_ element: XCUIElement, _ what: String, timeout: TimeInterval = 25) -> Bool {
        if element.waitForExistence(timeout: timeout) { return true }
        missed.append(what)
        print("MISSED: \(what) - not found within \(Int(timeout))s")
        return false
    }

    /// First matching button by any of several accessible names. The UI is
    /// shared across shells and its copy is allowed to change; a list of
    /// candidates keeps a wording tweak from silently emptying the listing.
    /// Always resolves through `.firstMatch`. The home screen offers Send and
    /// Receive in BOTH a quick-action row and the bottom nav, so a subscript
    /// lookup (`app.buttons["Send"]`) is an ambiguous query: touching
    /// `.exists` on it raises "Multiple matching elements found" and kills the
    /// run. That failed on iPad while iPhone happened to resolve, which is the
    /// kind of difference that reads as an iPad problem and is not one.
    private func button(anyOf labels: [String]) -> XCUIElement? {
        for label in labels {
            let exact = app.buttons.matching(NSPredicate(format: "label == %@", label))
            if exact.count > 0 { return exact.firstMatch }
            let fuzzy = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", label))
            if fuzzy.count > 0 { return fuzzy.firstMatch }
        }
        return nil
    }

    private func tap(_ element: XCUIElement, _ what: String) -> Bool {
        guard element.exists else {
            missed.append(what)
            print("MISSED: \(what) - absent")
            return false
        }
        // BOTH checks. A control can be perfectly hittable and still disabled,
        // and tapping a disabled control does nothing while looking like a
        // success. Checking only hittability is how this harness convinced
        // itself it had accepted the license twice while sitting on it.
        if !element.isHittable || !element.isEnabled {
            missed.append("\(what) (hittable=\(element.isHittable), enabled=\(element.isEnabled))")
            print("MISSED: \(what) - hittable=\(element.isHittable) enabled=\(element.isEnabled)")
            return false
        }
        element.tap()
        return true
    }

    // MARK: - Flow

    /// The terms gate has TWO conditions, and missing the second one is the
    /// trap this harness fell into first: the license must be scrolled to the
    /// end AND the "I have read and agree" checkbox must be ticked. Scrolling
    /// alone makes the button hittable, so a tap looks like it worked, reports
    /// no error, and leaves you on the same screen. Every later selector then
    /// fails for a reason that has nothing to do with those selectors.
    ///
    /// Hence the post-condition at the bottom: this function does not trust
    /// that tapping a button changed anything, it checks.
    private func acceptTerms() {
        guard reach(app.staticTexts.firstMatch, "first-run content") else { return }
        let accept = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Accept and continue")).firstMatch
        guard reach(accept, "Accept and continue button") else { return }

        // Scroll the license to its end. The exit condition is the GATE, not
        // the Accept button.
        //
        // This loop used to break on `accept.isHittable`, and it passed for a
        // reason that had nothing to do with scrolling: the app shell used to
        // overhang the bottom of the screen by the top safe-area inset
        // , so the footer holding Accept started off-screen, the
        // button was not hittable, and the swipes that went looking for it
        // scrolled the terms to the end as a side effect. Fixing the layout
        // put Accept on screen from the first frame, the loop broke before
        // swiping once, and the gate was never met - which reads as "the
        // checkbox selector is wrong" and is nothing of the sort.
        //
        // The real signal is the acknowledgement label's own text: it reads
        // "Scroll to the end of the terms to enable." until `scrolledToEnd`,
        // then becomes "I have read and agree to these terms." (Onboarding.jsx
        // §license gate). That is the same state that un-disables the
        // checkbox, so waiting on it is waiting on the thing that matters.
        let agreeText = "I have read and agree"
        let scrollGate = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] %@", agreeText)
        ).firstMatch
        for _ in 0..<25 {
            if scrollGate.exists { break }
            app.swipeUp(velocity: .fast)
        }
        if !scrollGate.exists {
            missed.append("license scroll gate (never scrolled to the end)")
            print("MISSED: license scroll gate - the terms never reached their end")
        }

        // The checkbox is an <input type="checkbox"> inside a <label>. WebKit
        // surfaces that differently depending on idiom, so rather than betting
        // on one element type, try each and CHECK WHETHER IT WORKED.
        //
        // The signal is `accept.isEnabled`, not `isHittable`. That distinction
        // is the bug this harness shipped twice: the button is visible and
        // hittable the whole time and only becomes ENABLED once the box is
        // ticked, so tapping on hittability alone silently does nothing and
        // reports success. iPhone happened to pass, iPad did not, and the
        // difference was never about iPad.
        let predicate = NSPredicate(format: "label CONTAINS[c] %@", agreeText)
        let candidates: [XCUIElement] = [
            app.switches.containing(predicate).firstMatch,
            app.checkBoxes.containing(predicate).firstMatch,
            app.buttons.containing(predicate).firstMatch,
            app.staticTexts.containing(predicate).firstMatch,
            app.otherElements.containing(predicate).firstMatch,
        ]

        if !accept.isEnabled {
            for candidate in candidates where candidate.exists && candidate.isHittable {
                candidate.tap()
                if accept.isEnabled { break }
                // The tick box sits to the LEFT of its label text. When the
                // label is what matched, tapping its centre can land on text
                // that is not the control; aim at the box instead.
                candidate.coordinate(withNormalizedOffset: CGVector(dx: -0.04, dy: 0.5))
                    .withOffset(CGVector(dx: 0, dy: 0)).tap()
                if accept.isEnabled { break }
            }
        }

        if !accept.isEnabled {
            missed.append("terms agree checkbox (Accept never became enabled)")
            print("MISSED: terms agree checkbox - Accept and continue never became enabled")
        }

        _ = tap(accept, "Accept and continue")

        // Post-condition. Being still on the license after "accepting" it is
        // the single most misleading state this flow can be in.
        let stillOnTerms = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS[c] %@", "agree to the GNU Affero")
        ).firstMatch
        if stillOnTerms.waitForExistence(timeout: 3) {
            missed.append("terms did not advance (checkbox or scroll gate still unmet)")
            print("MISSED: still on the terms screen after accepting")
        }
    }

    /// Between the license and the create/import choice sits a four-page
    /// intro carousel ("You hold the keys", ...). Advanced by tapping Next
    /// until it is gone rather than a fixed count, so adding or removing a
    /// page does not break the harness.
    /// The final page swaps "Next" for "Get started", so a loop that only
    /// knows about Next stops one page short and every later selector misses.
    private func advanceIntroCarousel() {
        for _ in 0..<8 {
            let finish = button(anyOf: ["Get started", "Done", "Continue"])
            if let finish, finish.exists, finish.isHittable {
                finish.tap()
                return
            }
            let next = app.buttons.matching(NSPredicate(format: "label == %@", "Next")).firstMatch
            guard next.exists, next.isHittable else { return }
            next.tap()
            // The carousel animates; without a beat the next query can catch
            // the outgoing page and tap a button that is on its way out.
            _ = app.buttons.firstMatch.waitForExistence(timeout: 2)
        }
    }

    /// Demo mode is the app's own affordance, reached from the onboarding
    /// choice screen. See constraint 2 for why the harness uses it.
    private func enterDemoMode() {
        guard let demo = button(anyOf: ["Try in demo mode", "demo mode", "Setting up demo"]) else {
            missed.append("demo-mode entry")
            print("MISSED: demo-mode entry - no matching button")
            return
        }
        _ = tap(demo, "Try in demo mode")

        // Demo setup builds a wallet and takes seconds. Waiting for "a button
        // to exist" returns INSTANTLY, because the onboarding buttons are
        // still on screen, and the first screenshot then catches the spinner
        // mid-"Setting up demo...". The real signal is onboarding going away.
        let onboarding = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Create new wallet")).firstMatch
        let gone = NSPredicate(format: "exists == false")
        let expectation = XCTNSPredicateExpectation(predicate: gone, object: onboarding)
        if XCTWaiter().wait(for: [expectation], timeout: 90) != .completed {
            missed.append("demo wallet never finished loading")
            print("MISSED: demo wallet never finished loading (onboarding still on screen)")
            return
        }
        // Let the wallet's first render settle before anything is captured.
        _ = app.staticTexts.firstMatch.waitForExistence(timeout: 30)

        // Printed once per run: this is the screen whose nav labels the
        // scene selectors below depend on, and it is the one place they are
        // cheap to re-derive when the UI moves.
        print("=== POST-DEMO TREE: buttons (\(app.buttons.count)) ===")
        for element in app.buttons.allElementsBoundByIndex {
            print("nav | label=\(element.label) | hittable=\(element.isHittable)")
        }
    }

    private func openFromNav(_ labels: [String], scene: String) -> Bool {
        guard let control = button(anyOf: labels) else {
            missed.append("\(scene) nav entry")
            print("MISSED: \(scene) nav entry - none of \(labels)")
            return false
        }
        return tap(control, "\(scene) nav entry")
    }

    // MARK: - The run

    func testCaptureListingScreenshots() throws {
        app.launch()

        acceptTerms()
        advanceIntroCarousel()
        enterDemoMode()

        // 1. Balances. This is the app's home and the listing's lead image.
        capture("01-balances")

        // 2. Receive, which shows an address and a QR: the clearest proof in a
        //    still image that this is a wallet and not a web page.
        if openFromNav(["Receive"], scene: "receive") {
            _ = reach(app.staticTexts.firstMatch, "receive content", timeout: 20)
            capture("02-receive")
        } else {
            capture("02-receive-FAILED")
        }

        // 3. Send. Captured at the FORM, deliberately not at a broadcast: the
        //    harness must never put a transaction on any network.
        if openFromNav(["Send"], scene: "send") {
            _ = reach(app.staticTexts.firstMatch, "send content", timeout: 20)
            capture("03-send")
        } else {
            capture("03-send-FAILED")
        }

        // 4. Settings, where the Face ID unlock control lives. §2.1 leans on
        //    biometric unlock as a native-integration defence, so the listing
        //    should show it.
        if openFromNav(["Settings", "More"], scene: "settings") {
            _ = reach(app.staticTexts.firstMatch, "settings content", timeout: 20)
            capture("04-settings")
        } else {
            capture("04-settings-FAILED")
        }

        if !missed.isEmpty {
            // One failure naming everything, rather than the first thing.
            XCTFail("screenshot harness could not reach: \(missed.joined(separator: "; "))")
        }
    }

    /// Diagnostic, not a screenshot. Dumps what the WebView exposes so
    /// selectors can be written against reality rather than a guess about how
    /// React rendered. Kept permanently: when the harness breaks, the first
    /// question is always "what does the tree look like now".
    func testDumpAccessibilityTree() throws {
        app.launch()
        _ = app.staticTexts.firstMatch.waitForExistence(timeout: 30)

        print("=== BUTTONS (\(app.buttons.count)) ===")
        for element in app.buttons.allElementsBoundByIndex {
            print("button | label=\(element.label) | hittable=\(element.isHittable)")
        }
        print("=== STATIC TEXTS (\(app.staticTexts.count)) ===")
        for element in app.staticTexts.allElementsBoundByIndex.prefix(40) {
            print("text | label=\(element.label)")
        }
        print("=== OTHER (switches \(app.switches.count), fields \(app.textFields.count), secure \(app.secureTextFields.count)) ===")
    }
}
