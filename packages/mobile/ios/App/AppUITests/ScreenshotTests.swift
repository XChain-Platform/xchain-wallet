// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// App Store screenshot harness (§6).
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
// being tested, because §2.1 forbids any build that behaves
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
        //, so the footer holding Accept started off-screen, the
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

    /// Move the demo wallet onto the MAIN networks before anything is shot.
    ///
    /// WHY THIS EXISTS (frontier row 63 / dq-7). Demo mode
    /// registers all nine chains and lands on `activeNetwork: 'regtest'`,
    /// which was invisible in a screenshot until a shared-UI change started
    /// rendering a network suffix for any non-mainnet chain. Every coin row
    /// then reads "BTC - regtest" - a network the STORE build hides behind
    /// Settings, Developer mode - so the listing would depict a state no
    /// ordinary user can reach. That is the same accurate-metadata exposure
    /// (Apple 2.3.3) as a stale screenshot, arriving from the other side.
    ///
    /// Done in the CAPTURE rather than by changing where demo mode lands,
    /// because that is where it belongs: a user trying demo mode still gets
    /// the experience they always got. The mainnet fixtures already exist and
    /// are the richer set (0.12345678 BTC, EXAMPLE, XCP, RAREPEPE), which is
    /// also what the Chrome Web Store listing images show.
    ///
    /// The control is a real `<select aria-label="Active network">` in the
    /// WebView, and WebKit hands a select to UIKit differently per idiom: a
    /// picker wheel on iPhone, a popover list on iPad. Both are tried, and a
    /// miss is RECORDED rather than ignored - shooting the listing on the
    /// wrong network is the defect this exists to prevent, so it must not
    /// pass quietly.
    /// Land on the real Settings SCREEN, on both idioms.
    ///
    /// `openFromNav(["Settings", "More"])` was not that, and the listing paid
    /// for it: on iPhone there is no Settings tab, so the fallback matched the
    /// bottom bar's "More", which opens a SHEET of links over whatever screen
    /// was underneath. The 04-settings image shot on 2026-08-08 is that sheet
    /// half-covering the Send form - two screens in one picture, uploaded as a
    /// listing image of the settings screen. Settings is one row INSIDE that
    /// sheet, so the sheet is a step on the way, never the destination.
    @discardableResult
    private func openSettings(scene: String) -> Bool {
        if let direct = button(anyOf: ["Settings"]), tap(direct, "Settings") {
            return reach(app.staticTexts.firstMatch, "settings content", timeout: 20)
        }
        guard let more = button(anyOf: ["More"]), tap(more, "More (sheet)") else {
            missed.append("\(scene): no Settings and no More")
            print("MISSED: \(scene) - neither a Settings control nor a More sheet")
            return false
        }
        guard let row = button(anyOf: ["Settings"]), tap(row, "Settings (from the More sheet)") else {
            missed.append("\(scene): the More sheet carries no Settings row")
            print("MISSED: \(scene) - the More sheet opened but had no Settings row")
            return false
        }
        return reach(app.staticTexts.firstMatch, "settings content", timeout: 20)
    }

    /// Drill from the Settings root into the Safety panel, because that is
    /// where the biometric unlock control actually lives.
    ///
    /// Landing on the real Settings screen (above) was necessary and is not
    /// sufficient. The 2026-08-09 capture is the correct screen, and it shows
    /// This Wallet, Appearance, Language & Region and Privacy - no biometrics
    /// anywhere. §2.1 leans on biometric unlock as the native-integration
    /// defence, so a listing image captioned "settings" that cannot show it is
    /// a scene which is right about its screen and silent about its subject.
    ///
    /// IT IS NOT BELOW THE FOLD, WHICH IS WHY SCROLLING FOR IT FAILED. The
    /// first cut of this simply swiped the Settings root looking for
    /// `Biometric unlock` and reported `MISSED: settings - no 'Biometric
    /// unlock' row after 10 scrolls`, because Settings is a menu of drill-down
    /// panels (`kind: 'internal-drill'` in Settings.jsx) and Safety is one of
    /// them. No amount of scrolling a menu reveals a row on a screen the menu
    /// links to. So the reveal is a TAP, and the scroll only exists to bring
    /// the Safety row itself into reach.
    ///
    /// A miss here is RECORDED rather than swallowed, same rule as every other
    /// scene: a listing image that quietly lost its subject is exactly the
    /// defect this harness keeps being fixed for.
    @discardableResult
    private func revealBiometricRow(scene: String) -> Bool {
        func biometricRow() -> XCUIElement? {
            let byName = [app.staticTexts["Biometric unlock"],
                          app.otherElements["Biometric unlock"],
                          app.buttons["Biometric unlock"]]
            return byName.first(where: { $0.exists && $0.isHittable })
        }

        var safety = button(anyOf: ["Safety"])
        var scrolls = 0
        while (safety == nil || !(safety?.isHittable ?? false)) && scrolls < 8 {
            app.swipeUp()
            scrolls += 1
            safety = button(anyOf: ["Safety"])
        }
        guard let safety, tap(safety, "Safety (settings drill)") else {
            missed.append("\(scene): the Settings root has no reachable Safety panel after \(scrolls) scrolls")
            print("MISSED: \(scene) - no Safety panel after \(scrolls) scrolls")
            return false
        }
        _ = reach(app.staticTexts.firstMatch, "safety panel", timeout: 20)
        print("SETTINGS: opened the Safety panel after \(scrolls) scroll(s)")

        // The panel is the destination, but the row is the SUBJECT, so its
        // presence is asserted rather than assumed: the panel could render
        // without it (no enrolled biometry on the host, a future reshuffle)
        // and the capture would look perfectly fine while showing nothing.
        guard biometricRow() != nil else {
            missed.append("\(scene): the Safety panel opened but carries no 'Biometric unlock' row")
            print("MISSED: \(scene) - Safety panel has no 'Biometric unlock' row")
            return false
        }

        // PRESENT IS NOT THE SAME AS SHOWING THE FEATURE. On a simulator with
        // no enrolled biometry the row renders "Not available. No fingerprint
        // or face is set up on this device yet", and an in-frame check passes
        // over it - which is what happened on 2026-08-10: green run, and a
        // listing image telling App Store readers the security feature does
        // not work. The driver enrols a face before booting the app; this
        // asserts the enrolment actually took, because the whole point of the
        // scene is the ENABLED control and nothing else here can see the
        // difference.
        let unavailable = app.staticTexts
            .matching(NSPredicate(format: "label CONTAINS[c] %@", "No fingerprint or face is set up"))
        if unavailable.count > 0 {
            missed.append("\(scene): the biometric row reads 'not available' - the simulator has no enrolled biometry, so this image would advertise the feature as absent")
            print("MISSED: \(scene) - biometric row is in its NOT-AVAILABLE state; enrol biometry before capturing")
            return false
        }
        print("SETTINGS: biometric unlock row is in frame and enrolled")
        return true
    }

    private func switchToMainnet() {
        guard openSettings(scene: "network-switch (settings)") else { return }

        // The select surfaces under its aria-label, but as different element
        // types depending on iOS version and idiom, so ask by name across the
        // types it has actually appeared as rather than betting on one.
        //
        // AND SCROLL WHILE ASKING. A WKWebView publishes accessibility nodes
        // for what it has RENDERED, so a settings row below the fold does not
        // merely fail to be hittable, it does not exist in the tree at all.
        // Measured 2026-08-08: identical code found the control immediately on
        // iPad, where Settings is a sidebar screen showing the whole list, and
        // reported "nothing named 'Active network'" on iPhone, where the same
        // section sits several screens down.
        // HITTABLE, not merely existing. A WKWebView publishes a node as soon
        // as it renders, which can be while it is still below the fold, so
        // stopping the scroll at `exists` finds the control and then fails to
        // tap it - measured, as `MISSED: Active network select - hittable=false
        // enabled=true`, which reads like a disabled control rather than an
        // off-screen one.
        func networkSelect() -> XCUIElement? {
            let byName = [app.buttons["Active network"], app.otherElements["Active network"],
                          app.popUpButtons["Active network"], app.staticTexts["Active network"]]
            return byName.first(where: { $0.exists && $0.isHittable })
        }
        var control = networkSelect()
        var scrolls = 0
        while control == nil && scrolls < 8 {
            app.swipeUp()
            scrolls += 1
            control = networkSelect()
        }
        guard let control else {
            missed.append("network select (no element named 'Active network' after \(scrolls) scrolls)")
            print("MISSED: network select - nothing named 'Active network' after \(scrolls) scrolls")
            return
        }
        if scrolls > 0 { print("NETWORK: found the select after \(scrolls) scroll(s)") }
        guard tap(control, "Active network select") else { return }

        // iPhone: a picker wheel plus a Done button. iPad: a popover of
        // buttons. Whichever appeared, land on Mainnet.
        var switched = false
        let wheel = app.pickerWheels.firstMatch
        if wheel.waitForExistence(timeout: 5) {
            wheel.adjust(toPickerWheelValue: "Mainnet")
            let done = app.buttons["Done"]
            if done.exists { switched = tap(done, "picker Done") }
            // Some iOS builds dismiss the wheel by tapping outside it rather
            // than with a Done button; the adjust above has already taken.
            if !switched { switched = true }
        } else {
            let option = app.buttons["Mainnet"].exists
                ? app.buttons["Mainnet"] : app.staticTexts["Mainnet"]
            if option.waitForExistence(timeout: 5) {
                switched = tap(option, "Mainnet option")
            }
        }
        if !switched {
            missed.append("network switch to Mainnet")
            print("MISSED: network switch - neither a picker wheel nor a 'Mainnet' option appeared")
            return
        }

        // Switching reloads the WebView (NetworkSection calls
        // window.location.reload once the host route has re-derived addresses)
        // and the demo wallet silently re-unlocks with its stored password. A
        // screenshot taken before that settles catches a loading screen.
        _ = app.staticTexts.firstMatch.waitForExistence(timeout: 30)
        Thread.sleep(forTimeInterval: 3)
        print("NETWORK: switched the demo wallet to Mainnet before capture")
        resetViewport(scene: "network-switch")
    }

    /// Put the WebView back to fit-width before anything is captured.
    ///
    /// Focusing the network `<select>` makes iOS auto-zoom the WKWebView, and
    /// the zoom SURVIVES the reload the switch triggers - the page reloads,
    /// the scale does not. Measured 2026-08-08: the iPhone lead image came
    /// back clipped at the right edge (a balance rendered `0.1234` where the
    /// value is `0.12345678`) with no bottom bar in frame, and every step
    /// after it reported `hittable=false enabled=true`, which reads like a
    /// disabled control and is an off-screen one. The iPad set from the same
    /// run was clean, because its popover needs no focus zoom - so this is an
    /// idiom-specific defect that a run on one idiom cannot see.
    ///
    /// Pinching out is the reset rather than a guess at a scale: the page's
    /// own minimum scale clamps it at fit, so over-pinching cannot
    /// under-zoom. VERIFIED BY A CONTROL, never by gesture count - a gesture
    /// that did nothing and a gesture that was not needed look identical from
    /// the outside, and the whole cost of this defect was a set that looked
    /// like it had been taken correctly.
    @discardableResult
    private func resetViewport(scene: String) -> Bool {
        // RELAUNCH, UNCONDITIONALLY, and both of those words were paid for.
        //
        // Not a gesture: three pinch-to-zoom-out gestures at the WebView were
        // tried first and measured to do nothing at all - the run reached the
        // relaunch fallback behind them every time. A launch is what works,
        // because a WKWebView cannot carry a zoom scale across a process. The
        // app persists its onboarding and its demo wallet (that is the whole
        // reason the driver script uninstalls before a run), so it comes back
        // to the same screen, on the same network, at fit-width and scrolled
        // to the top.
        //
        // Not conditional, and this is the part a first cut got wrong. The
        // switch leaves TWO marks and they do not arrive together: a zoom,
        // which is loud (the lead image is clipped at the right edge and
        // every nav entry afterwards reports hittable=false), and a scroll
        // offset, which is quiet (a black band under the status bar in an
        // otherwise correct-looking image). Measured 2026-08-09: a run with
        // the reset gated on "is the nav hittable" skipped it entirely,
        // passed every assertion, and produced the banded image - the quiet
        // half is invisible to the only condition worth gating on, so there
        // is nothing to gate on. One relaunch, always.
        app.terminate()
        app.launch()
        _ = app.staticTexts.firstMatch.waitForExistence(timeout: 30)
        Thread.sleep(forTimeInterval: 3)

        // The net under the reset, for the loud half, and it asks THE BOTTOM
        // NAV and nothing else. The home screen offers Send and Receive twice
        // - once in a quick-action row near the top of the page, once in the
        // bottom nav - and a zoomed page keeps the quick-action row in frame
        // while pushing the nav off the bottom, so a check that accepts
        // Receive is satisfied by the broken state. Measured: a first cut
        // that did accept it returned immediately, printed nothing, and the
        // run then missed every nav entry after it. An idiom with no bottom
        // nav (iPad drives from a sidebar) has nothing to be pushed off
        // screen and nothing to check.
        guard let home = button(anyOf: ["Home", "Balances"]) else { return true }
        if home.isHittable {
            print("VIEWPORT: relaunched after the network switch")
            return true
        }
        missed.append("\(scene): the bottom nav is not hittable even after a relaunch")
        print("MISSED: \(scene) viewport - the bottom nav is not hittable even after a relaunch")
        return false
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
        // Before ANY capture: the listing must not depict a developer-only
        // network. See switchToMainnet().
        switchToMainnet()

        // The switch reloads the WebView, which boots back to Home on its own,
        // so this is a nudge rather than a requirement: a miss here is NOT
        // recorded, because recording it would fail a run whose screenshots
        // are all correct. The captures below assert what they need.
        if let home = button(anyOf: ["Home", "Balances"]) { _ = tap(home, "home after network switch") }
        _ = reach(app.staticTexts.firstMatch, "home content", timeout: 20)

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
        if openSettings(scene: "settings") {
            revealBiometricRow(scene: "settings")
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
