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

// MARK: - iPad layout probe

/// Walk the real app on an iPad in portrait, landscape and resized windows, one PNG per screen.
/// Run `-only-testing:AppUITests/ScreenshotTests/testIPadLayoutProbe` on an iPad simulator;
/// `TEST_RUNNER_IPAD_PASS_DIR=<dir>` also writes the PNGs there. Misses print, never fail.
extension ScreenshotTests {

    private var passDir: String? { ProcessInfo.processInfo.environment["IPAD_PASS_DIR"] }

    private func probeShot(_ name: String) {
        Thread.sleep(forTimeInterval: 1.2)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = passDir {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
        }
        probeEdges(name)
    }

    /// Report page elements past the window's left or right edge. Only the WebView is walked:
    /// system keyboard views report frames in another coordinate space. Element frames are
    /// window-relative while the window's own frame is screen-relative, so compare to its size.
    private func probeEdges(_ name: String) {
        let win = app.windows.firstMatch.frame
        let page = app.webViews.firstMatch
        guard page.exists, let root = try? page.snapshot() else { print("EDGES \(name): no page"); return }
        var hits: [String] = []
        func walk(_ s: XCUIElementSnapshot) {
            let f = s.frame
            if f.width >= 1 && f.height >= 1 && !f.isInfinite
                && (f.maxX > win.width + 1 || f.minX < -1) {
                let label = s.label.isEmpty ? s.identifier : s.label
                hits.append("\(s.elementType.rawValue):\(label.prefix(40)) x=\(Int(f.minX))..\(Int(f.maxX))")
            }
            for c in s.children { walk(c) }
        }
        walk(root)
        print("EDGES \(name): window=\(Int(win.width))x\(Int(win.height)) offside=\(hits.count)")
        for h in hits.prefix(12) { print("EDGES \(name):   \(h)") }
    }

    /// Find the first hittable element of any type whose label starts with `label`: settings
    /// rows carry their summary ("Safety Auto-lock 15 min") and nav rows a badge count.
    private func hittable(_ label: String, exact: Bool = false) -> XCUIElement? {
        let format = exact ? "label == %@" : "label BEGINSWITH %@"
        for query in [app.buttons, app.descendants(matching: .any)] {
            let q = query.matching(NSPredicate(format: format, label))
            for i in 0..<min(q.count, 6) {
                let e = q.element(boundBy: i)
                if e.exists && e.isHittable { return e }
            }
        }
        return nil
    }

    /// Swipe the page itself: an app-level swipe misses it once the window is resized and moved.
    private func swipePage() {
        let page = app.webViews.firstMatch
        if page.exists { page.swipeUp() } else { app.swipeUp() }
    }

    private func scrollTo(_ label: String, max: Int = 8) -> XCUIElement? {
        var e = hittable(label)
        var n = 0
        while e == nil && n < max { swipePage(); n += 1; e = hittable(label) }
        return e
    }

    private func goHome() {
        if let h = hittable("Home", exact: true) { h.tap(); Thread.sleep(forTimeInterval: 0.8); return }
        for _ in 0..<4 {
            guard let back = hittable("Back", exact: true) else { return }
            back.tap()
            Thread.sleep(forTimeInterval: 0.6)
        }
    }

    private func dumpButtons(_ tag: String) {
        let labels = app.buttons.allElementsBoundByIndex.filter { $0.exists }
            .map { "\($0.label)\($0.isHittable ? "" : "(h-)")" }
        print("BUTTONS \(tag): \(labels.joined(separator: " | "))")
    }

    /// Find a form field by its label or placeholder: Send's first field (From) is a
    /// read-only picker that takes focus without ever raising a keyboard.
    private func editableField(_ hints: [String]) -> XCUIElement? {
        for hint in hints {
            let p = NSPredicate(format: "label CONTAINS[c] %@ OR placeholderValue CONTAINS[c] %@", hint, hint)
            let q = app.textFields.matching(p)
            for i in 0..<min(q.count, 4) {
                let e = q.element(boundBy: i)
                if e.exists { return e }
            }
        }
        return nil
    }

    /// Type into a field with the docked keyboard, then pinch it into the floating one.
    /// The simulator keeps it floating afterwards (KeyboardIsFloating in
    /// com.apple.keyboard.preferences), so only a fresh simulator gives a docked reading.
    private func probeKeyboard(_ tag: String, hints: [String]) {
        guard var field = editableField(hints) else { print("KEYBOARD \(tag): no field for \(hints)"); return }
        var scrolls = 0
        while !field.isHittable && scrolls < 5 {
            swipePage(); scrolls += 1
            if let again = editableField(hints) { field = again }
        }
        guard field.isHittable else { print("KEYBOARD \(tag): field never hittable"); return }
        field.tap()
        let kb = app.keyboards.firstMatch
        if !kb.waitForExistence(timeout: 5) {
            print("KEYBOARD \(tag): no software keyboard (keyboards=\(app.keyboards.count))")
            probeShot("\(tag)-kb-none")
            return
        }
        field.typeText("1")
        let kf = kb.frame
        let ff = field.frame
        print("KEYBOARD \(tag): field '\(field.label)' \(ff) keyboard=\(kf) fieldCovered=\(ff.maxY > kf.minY)")
        probeShot("\(tag)-kb-docked")
        kb.pinch(withScale: 0.4, velocity: -1)
        Thread.sleep(forTimeInterval: 1)
        let fk = app.keyboards.firstMatch.frame
        print("KEYBOARD \(tag): after pinch keyboard=\(fk) fieldCovered=\(field.frame.intersects(fk))")
        probeShot("\(tag)-kb-floating")
        let hide = app.keyboards.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "hide")).firstMatch
        if hide.exists && hide.isHittable { hide.tap() }
        Thread.sleep(forTimeInterval: 0.6)
    }

    /// The menu is the header's "Open menu" on the side rail and the bar's "More" below it.
    private func openMenu() -> Bool {
        for label in ["Open menu", "More"] {
            if let m = hittable(label, exact: true) { m.tap(); Thread.sleep(forTimeInterval: 0.8); return true }
        }
        return false
    }

    private static let navLabels = ["History", "Send", "Receive", "DEX", "Dispensers", "Contracts",
                                    "Messaging", "Contacts", "Lists", "Payments due"]
    private static let settingsDrills = ["This Wallet", "Accounts & Addresses", "Display", "Keyboard", "Privacy",
                                         "Safety", "Wallet Mode", "Backup", "Fees", "Network & Endpoints",
                                         "Connected Sites", "Automatic Donation System", "Developer Mode", "About"]
    private static let menuRows = ["Decentralized Exchange", "Marketplace", "Dispensers", "My Tokens", "Alerts",
                                   "More actions", "Messaging", "Cross-chain", "Contacts", "My Lists", "Addresses",
                                   "Contracts", "Staking", "Multisig"]

    private func slug(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "and").replacingOccurrences(of: " ", with: "-")
    }

    /// Page down the Settings root for the inline panels, then open every drill-down panel.
    private func probeSettings(_ o: String) {
        goHome()
        guard openSettings(scene: "\(o)-settings") else { return }
        for page in 0..<6 {
            probeShot("\(o)-20-settings-page\(page)")
            swipePage()
        }
        var p = 1
        for panel in Self.settingsDrills {
            goHome()
            guard openSettings(scene: "\(o)-settings-\(panel)") else { continue }
            guard let row = scrollTo(panel) else { print("SETTINGS \(o): no row '\(panel)'"); continue }
            row.tap()
            probeShot(String(format: "%@-2%02d-settings-%@", o, p, slug(panel)))
            p += 1
        }
        goHome()
    }

    private func probeMenu(_ o: String) {
        goHome()
        guard openMenu() else { print("MENU \(o): no Open menu / More control"); return }
        probeShot("\(o)-40-menu")
        dumpButtons("\(o)-menu")
        var r = 1
        for row in Self.menuRows {
            goHome()
            guard openMenu() else { break }
            guard let b = scrollTo(row, max: 4) else { print("MENU \(o): no row '\(row)'"); continue }
            b.tap()
            probeShot(String(format: "%@-4%02d-menu-%@", o, r, slug(row)))
            r += 1
        }
        goHome()
    }

    private func probeWalk(_ o: String) {
        goHome()
        probeShot("\(o)-00-home")
        dumpButtons("\(o)-home")
        var n = 1
        for label in Self.navLabels {
            goHome()
            guard let b = hittable(label, exact: label != "Messaging") else { print("NAV \(o): no hittable '\(label)'"); continue }
            b.tap()
            probeShot(String(format: "%@-%02d-nav-%@", o, n, slug(label)))
            n += 1
            if label == "Send" { probeKeyboard("\(o)-send", hints: ["address or name", "To", "Amount"]) }
            if label == "Receive" { probeKeyboard("\(o)-receive", hints: ["Amount", "0.00"]) }
        }
        probeSettings(o)
        probeMenu(o)
    }

    /// Drag the window's corner grip until it is about `target` points wide. The window
    /// resizes about its centre, so each drag moves the corner half the remaining gap,
    /// and the frame is re-read before every drag because the window moves too.
    @discardableResult
    private func resizeWindow(to target: CGFloat) -> CGFloat {
        let window = app.windows.firstMatch
        for _ in 0..<8 {
            let f = window.frame
            if abs(f.width - target) < 40 { break }
            let origin = window.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
            let grip = origin.withOffset(CGVector(dx: f.width - 6, dy: f.height - 6))
            let to = origin.withOffset(CGVector(dx: f.width - 6 + (target - f.width) / 2, dy: f.height - 6))
            grip.press(forDuration: 0.6, thenDragTo: to)
            Thread.sleep(forTimeInterval: 1.5)
            print("RESIZE target=\(Int(target)): \(f) -> \(window.frame)")
        }
        return window.frame.width
    }

    private func probeWindowed(_ tag: String, width: CGFloat) {
        let got = resizeWindow(to: width)
        let name = "\(tag)-w\(Int(got))"
        goHome()
        probeShot("\(name)-home")
        dumpButtons("\(name)-home")
        for label in ["Send", "Receive"] {
            goHome()
            if let b = hittable(label, exact: true) {
                b.tap()
                probeShot("\(name)-\(label)")
                if label == "Send" { probeKeyboard("\(name)-send", hints: ["address or name", "To", "Amount"]) }
            }
        }
        goHome()
        if openSettings(scene: "\(name)-settings") { probeShot("\(name)-settings") }
        goHome()
        if openMenu() { probeShot("\(name)-menu") }
        goHome()
    }

    func testIPadLayoutProbe() throws {
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        _ = app.staticTexts.firstMatch.waitForExistence(timeout: 30)
        if hittable("Accept and continue") != nil || app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS[c] %@", "agree to the GNU Affero")).firstMatch.exists {
            probeShot("p-onb-01-terms")
            acceptTerms()
            probeShot("p-onb-02-intro")
            advanceIntroCarousel()
            probeShot("p-onb-03-welcome")
            enterDemoMode()
            Thread.sleep(forTimeInterval: 2)
        }

        // A window resized by an earlier run stays resized, so each walk starts full width.
        resizeWindow(to: 834)
        probeWalk("p")
        XCUIDevice.shared.orientation = .landscapeLeft
        Thread.sleep(forTimeInterval: 2)
        resizeWindow(to: 1210)
        probeWalk("l")

        // Windowed widths: the side rail (640 to 899), the bottom bar with a carded form, the narrowest.
        probeWindowed("l", width: 760)
        probeWindowed("l", width: 620)
        probeWindowed("l", width: 375)
        resizeWindow(to: 1210)
        XCUIDevice.shared.orientation = .portrait
        print("PROBE missed: \(missed.joined(separator: "; "))")
    }
}

// MARK: - Review demo step 4 rehearsal (XC-1285)

import UIKit

/// Rehearse the App Store review notes on a registered device: import the funded
/// test-network demo wallet (step 1), switch to Testnet (step 2), compose a send
/// ONLINE up to the confirmation screen, then turn on Airplane Mode and confirm
/// (step 4), and record what the confirmation screen does with no network.
///
/// Device only. The driver injects XCHAIN_DEMO_MNEMONIC and XCHAIN_DEMO_SEND_TO
/// into a 0600 copy of the .xctestrun, never on xcodebuild's argv. The phrase
/// moves by pasteboard and the edit menu, never `typeText`, because typed text
/// is written into the activity log; nothing is captured while it is on screen.
/// XCHAIN_DEMO_SEND_TO is the demo wallet's own public test-network addresses,
/// so the send is a self-send. XCHAIN_REHEARSAL_BROADCAST=1 taps "Send now" in
/// the queue banner after Airplane Mode is off, as the review notes tell Apple to.
/// Airplane Mode is turned off at the end and again in a teardown block.
extension ScreenshotTests {

    private var springboard: XCUIApplication { XCUIApplication(bundleIdentifier: "com.apple.springboard") }

    private func rehearsalShot(_ name: String) {
        Thread.sleep(forTimeInterval: 1.0)
        capture("rehearsal-\(name)")
    }

    /// What the screen said, for the report. Only called after the phrase is gone.
    private func dumpTexts(_ tag: String) {
        let labels = app.staticTexts.allElementsBoundByIndex.prefix(60)
            .filter { $0.exists }.map { $0.label }.filter { !$0.isEmpty }
        let line = "TEXTS \(tag): \(labels.joined(separator: " | "))"
        print(line)
        let note = XCTAttachment(string: line)
        note.name = "rehearsal-texts-\(tag)"
        note.lifetime = .keepAlways
        add(note)
    }

    // MARK: Airplane Mode through Control Center

    private func airplaneToggle() -> XCUIElement? {
        let sb = springboard
        let byLabel = NSPredicate(format: "label ==[c] %@", "Airplane Mode")
        let candidates: [XCUIElement] = [
            sb.buttons["airplane-mode-button"],
            sb.switches["airplane-mode-button"],
            sb.switches.matching(byLabel).firstMatch,
            sb.buttons.matching(byLabel).firstMatch,
            sb.descendants(matching: .any).matching(byLabel).firstMatch,
        ]
        return candidates.first(where: { $0.exists })
    }

    private func toggleIsOn(_ toggle: XCUIElement) -> Bool {
        if let s = toggle.value as? String { return s == "1" || s.lowercased() == "on" }
        if let n = toggle.value as? NSNumber { return n.boolValue }
        return toggle.isSelected
    }

    /// iPad opens Control Center with a swipe down from the top-right corner.
    private func openControlCenter() {
        let sb = springboard
        sb.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.002))
            .press(forDuration: 0.1, thenDragTo: sb.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.6)))
        _ = sb.buttons["airplane-mode-button"].waitForExistence(timeout: 3)
    }

    /// A swipe up from the bottom edge dismisses Control Center; activating the
    /// app afterwards covers the case where the swipe went to the home screen.
    private func closeControlCenter() {
        let sb = springboard
        sb.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.995))
            .press(forDuration: 0.1, thenDragTo: sb.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)))
        Thread.sleep(forTimeInterval: 1.0)
        app.activate()
        Thread.sleep(forTimeInterval: 1.0)
    }

    /// Set Airplane Mode and READ IT BACK; a tap that did nothing looks the same
    /// as a tap that worked. Returns the state read, or nil if it never matched.
    @discardableResult
    private func setAirplaneMode(_ on: Bool, tag: String) -> Bool? {
        for attempt in 1...3 {
            openControlCenter()
            guard let toggle = airplaneToggle() else {
                let labels = springboard.buttons.allElementsBoundByIndex.prefix(40).map { $0.label }
                print("AIRPLANE \(tag): attempt \(attempt) found no toggle; springboard buttons: \(labels.joined(separator: " | "))")
                closeControlCenter()
                continue
            }
            let before = toggleIsOn(toggle)
            if before != on {
                toggle.tap()
                Thread.sleep(forTimeInterval: 2.0)
            }
            let after = toggleIsOn(toggle)
            print("AIRPLANE \(tag): attempt \(attempt) before=\(before) after=\(after) want=\(on) value=\(String(describing: toggle.value))")
            rehearsalShot("control-center-\(tag)")
            closeControlCenter()
            if after == on { return after }
        }
        missed.append("airplane \(tag): Airplane Mode never read back as \(on ? "on" : "off")")
        print("MISSED: airplane \(tag) - never read back as \(on ? "on" : "off")")
        return nil
    }

    // MARK: Moving secrets without typing them

    /// Stage the phrase on the pasteboard while the RUNNER is the foreground app.
    /// A write from the runner once the wallet is in front fails with PBErrorDomain
    /// Code=10 ("not available at this time"), so this runs before app.launch().
    /// Local only (never Universal Clipboard) and expiring, so it clears itself.
    private func stagePhraseOnPasteboard(_ phrase: String) -> Bool {
        UIPasteboard.general.setItems([["public.utf8-plain-text": phrase]],
                                      options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(240)])
        let staged = UIPasteboard.general.hasStrings
        print("PASTEBOARD: phrase staged=\(staged)")
        return staged
    }

    /// Paste through the edit menu: a user-initiated menu paste raises no consent
    /// alert, and the phrase never appears in the activity log the way typed text does.
    private func pasteViaMenu(into field: XCUIElement) -> Bool {
        field.tap()
        Thread.sleep(forTimeInterval: 0.6)
        for attempt in 0..<3 {
            if attempt == 1 { field.press(forDuration: 1.2) } else if attempt == 2 { field.doubleTap() } else { field.tap() }
            let candidates = [app.menuItems["Paste"], app.buttons["Paste"], app.staticTexts["Paste"]]
            for item in candidates where item.waitForExistence(timeout: 1.5) && item.isHittable {
                item.tap()
                // A Universal Clipboard paste fetches from the Mac first.
                Thread.sleep(forTimeInterval: 4)
                return true
            }
        }
        return false
    }

    private func wordCount(_ field: XCUIElement) -> Int {
        guard let value = field.value as? String else { return 0 }
        return value.split(whereSeparator: { $0 == " " || $0 == "\n" }).count
    }

    private func unlockIfLocked(_ password: String, tag: String) {
        let unlock = app.buttons.matching(NSPredicate(format: "label == %@", "Unlock Wallet")).firstMatch
        guard unlock.waitForExistence(timeout: 5) else { return }
        let field = app.secureTextFields.firstMatch
        guard reach(field, "\(tag): unlock password field", timeout: 10) else { return }
        // A throwaway password generated by this test for a test-network wallet.
        field.tap()
        field.typeText(password)
        _ = tap(unlock, "\(tag): Unlock Wallet")
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: unlock)
        if XCTWaiter().wait(for: [gone], timeout: 60) != .completed {
            missed.append("\(tag): still locked after Unlock Wallet")
            print("MISSED: \(tag) - still locked after Unlock Wallet")
        }
        _ = app.staticTexts.firstMatch.waitForExistence(timeout: 30)
    }

    // MARK: Steps 1 and 2

    /// Step 1. Returns false while still on the import screen, so the caller
    /// stops before anything could capture the phrase.
    private func importDemoWallet(phrase: String, password: String) -> Bool {
        guard let start = button(anyOf: ["Import wallet"]), tap(start, "Import wallet") else { return false }
        let phraseField = app.textViews.firstMatch
        guard reach(phraseField, "recovery phrase field", timeout: 20) else { return false }

        // The driver copies the phrase to the Mac clipboard only on this marker, so the
        // app's own launch-time clipboard read never meets it, and Universal Clipboard
        // has time to carry it over before the paste.
        print("REHEARSAL-MARK: READY-FOR-PHRASE")
        // When the phrase lands, the app's own clipboard read raises the system
        // "Allow Paste" alert, which blocks the app's main thread until answered.
        // Answer it in Springboard; if that read fills the field, never touch the
        // field again, because XCTest names a filled field by its contents.
        let consent = springboard.buttons["Allow Paste"]
        if consent.waitForExistence(timeout: 25) {
            consent.tap()
            print("PASTE-CONSENT: allowed the app's own clipboard read")
            Thread.sleep(forTimeInterval: 4)
        } else {
            Thread.sleep(forTimeInterval: 2)
        }
        var pasted = wordCount(phraseField) >= 12
        if !pasted {
            pasted = pasteViaMenu(into: phraseField) && wordCount(phraseField) >= 12
            let again = springboard.buttons["Allow Paste"]
            if again.waitForExistence(timeout: 3) { again.tap(); Thread.sleep(forTimeInterval: 3) }
            pasted = wordCount(phraseField) >= 12
        }
        if !pasted {
            // The screen's own "Paste recovery phrase from clipboard" control reads
            // the clipboard programmatically, which raises the system paste
            // consent alert; allow it wherever it appears.
            if let own = button(anyOf: ["Paste recovery phrase from clipboard"]), own.isHittable {
                own.tap()
                let hosts: [XCUIApplication] = [app, springboard]
                for host in hosts {
                    let allow = host.buttons["Allow Paste"]
                    if allow.waitForExistence(timeout: 3) { allow.tap(); break }
                }
                Thread.sleep(forTimeInterval: 1.0)
            }
            pasted = wordCount(phraseField) >= 12
        }
        print("REHEARSAL-MARK: PHRASE-PASTED")
        print("IMPORT: phrase field holds \(wordCount(phraseField)) words (pasted=\(pasted))")
        guard pasted else {
            missed.append("import: the recovery phrase never reached the field")
            return false
        }

        let secure = app.secureTextFields
        guard reach(secure.firstMatch, "import password field", timeout: 10) else { return false }
        for i in 0..<min(secure.count, 2) {
            let field = secure.element(boundBy: i)
            if !field.isHittable { app.swipeUp() }
            field.tap()
            field.typeText(password)
        }
        let submit = app.buttons.matching(NSPredicate(format: "label == %@", "Import")).firstMatch
        if !submit.isHittable { app.swipeUp() }
        guard tap(submit, "Import (submit)") else { return false }

        // Left the import screen when the Import button is gone. NEVER wait on the
        // phrase field itself: once filled, XCTest names it by its contents in the
        // log ("<twelve words>" TextView), which is how the phrase reached test.log.
        var left = false
        for _ in 0..<120 {
            if !submit.exists { left = true; break }
            Thread.sleep(forTimeInterval: 1)
        }
        if !left {
            missed.append("import: still on the import screen 120s after Import")
            print("MISSED: import - still on the import screen after Import")
            return false
        }
        _ = app.staticTexts.firstMatch.waitForExistence(timeout: 30)
        Thread.sleep(forTimeInterval: 3)
        dumpButtons("after-import")
        settleAfterImport()
        return true
    }

    /// After import the app shows the Automatic Donation System notice (Continue) and
    /// a four-step intro (Skip / Next / Get started). Clear them until the wallet is up.
    private func settleAfterImport() {
        for round in 0..<10 {
            let exact = { (label: String) in self.app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch }
            var tapped = ""
            for label in ["Continue", "Skip", "Get started", "Done", "Not now", "Maybe later"] {
                let b = exact(label)
                if b.exists && b.isHittable { b.tap(); tapped = label; break }
            }
            if tapped.isEmpty {
                print("SETTLE: no more interstitials after \(round) taps")
                break
            }
            print("SETTLE: tapped \(tapped)")
            Thread.sleep(forTimeInterval: 1.5)
        }
        dumpButtons("after-settle")
    }

    /// Step 2, the network select with the same idiom handling as switchToMainnet.
    private func switchActiveNetwork(to network: String, password: String) {
        guard openSettings(scene: "network-switch (\(network))") else { return }
        func networkSelect() -> XCUIElement? {
            let byName = [app.buttons["Active network"], app.otherElements["Active network"],
                          app.popUpButtons["Active network"], app.staticTexts["Active network"]]
            return byName.first(where: { $0.exists && $0.isHittable })
        }
        var control = networkSelect()
        var scrolls = 0
        while control == nil && scrolls < 8 { app.swipeUp(); scrolls += 1; control = networkSelect() }
        guard let control, tap(control, "Active network select") else { return }

        var picked = false
        let wheel = app.pickerWheels.firstMatch
        if wheel.waitForExistence(timeout: 4) {
            wheel.adjust(toPickerWheelValue: network)
            if app.buttons["Done"].exists { _ = tap(app.buttons["Done"], "picker Done") }
            picked = true
        } else {
            let option = app.buttons[network].exists ? app.buttons[network] : app.staticTexts[network]
            if option.waitForExistence(timeout: 5) { picked = tap(option, "\(network) option") }
        }
        guard picked else {
            missed.append("network switch: no '\(network)' option")
            print("MISSED: network switch - no '\(network)' option")
            return
        }
        // "Switch to Testnet?" confirmation, which appears after the pick.
        let confirm = app.buttons.matching(NSPredicate(format: "label == %@", "Switch network")).firstMatch
        if confirm.waitForExistence(timeout: 8) { _ = tap(confirm, "Switch network (confirm)") }
        Thread.sleep(forTimeInterval: 5)
        unlockIfLocked(password, tag: "after network switch")
        // The select's focus zoom survives the reload; a relaunch resets it.
        resetViewport(scene: "network-switch-\(network)")
        unlockIfLocked(password, tag: "after relaunch")
        print("NETWORK: switched to \(network)")
    }

    // MARK: Step 4

    private func clearField(_ field: XCUIElement) {
        guard let value = field.value as? String, !value.isEmpty else { return }
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count + 4))
    }

    private func reviewScreen() -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@", "Sign")).firstMatch
    }

    /// Compose online until the confirmation screen is up. Tries each of the demo
    /// wallet's own addresses, since Send defaults to one chain and the test does
    /// not assume which. Amounts sit well above each chain's dust floor.
    private func composeToConfirmation(sendTo: [String]) -> Bool {
        for address in sendTo {
            if let home = button(anyOf: ["Home", "Balances"]), home.isHittable { home.tap() }
            guard let send = button(anyOf: ["Send"]), tap(send, "Send nav") else { return false }
            _ = app.staticTexts.firstMatch.waitForExistence(timeout: 20)
            Thread.sleep(forTimeInterval: 2)
            guard let to = editableField(["address or name", "To"]) else {
                missed.append("send: no To field"); dumpButtons("send-form"); return false
            }
            to.tap(); clearField(to); to.typeText(address)
            let amount: String = address.hasPrefix("tb1") ? "0.0001" : (address.hasPrefix("tltc1") ? "0.001" : "2")
            if let amountField = editableField(["Amount", "0.00"]) {
                amountField.tap(); clearField(amountField); amountField.typeText(amount)
            }
            let hide = app.keyboards.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "hide")).firstMatch
            if hide.exists && hide.isHittable { hide.tap() }
            rehearsalShot("04-0-send-form-\(address.prefix(5))")

            guard let review = button(anyOf: ["Review and send", "Review & Send"]) else { dumpButtons("send-form"); continue }
            if !review.isHittable { app.swipeUp() }
            if !review.isEnabled {
                print("COMPOSE: Review and send disabled for \(address.prefix(6))…; trying the next chain")
                dumpTexts("send-form-\(address.prefix(5))")
                continue
            }
            review.tap()
            // Compose is the remote call; poll for the confirmation screen, and
            // pass the small-test gate a first payment to an address can raise.
            let gate = app.buttons.matching(NSPredicate(format: "label == %@", "Continue with the full amount")).firstMatch
            var reached = false
            for _ in 0..<60 {
                if reviewScreen().exists { reached = true; break }
                if gate.exists && gate.isHittable { gate.tap() }
                Thread.sleep(forTimeInterval: 1)
            }
            if reached {
                print("COMPOSE: confirmation screen up for \(address.prefix(6))… amount \(amount)")
                return true
            }
            print("COMPOSE: no confirmation screen for \(address.prefix(6))…")
            dumpTexts("compose-failed-\(address.prefix(5))")
            rehearsalShot("04-0-compose-failed-\(address.prefix(5))")
        }
        missed.append("compose: never reached the confirmation screen on any demo chain")
        return false
    }

    /// Run first, on its own: Settings, Display & Brightness, Auto-Lock, Never,
    /// so the device stays awake through the rehearsal and later runs.
    func testA0SetAutoLockNever() throws {
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.terminate()
        settings.launch()
        // Prefer hittable cells and buttons; Settings rows carry their value
        // in the label on some idioms, so match on the prefix.
        func row(_ label: String) -> XCUIElement {
            let p = NSPredicate(format: "label BEGINSWITH[c] %@ OR identifier BEGINSWITH[c] %@", label, label)
            for q in [settings.cells, settings.buttons, settings.staticTexts, settings.descendants(matching: .any)] {
                let m = q.matching(p)
                for i in 0..<min(m.count, 4) where m.element(boundBy: i).isHittable { return m.element(boundBy: i) }
            }
            return settings.descendants(matching: .any).matching(p).firstMatch
        }
        func dumpSettings(_ tag: String) {
            let cells = settings.cells.allElementsBoundByIndex.prefix(60).map { "\($0.label)[\($0.identifier)]" }
            let buttons = settings.buttons.allElementsBoundByIndex.prefix(40).map { $0.label }
            print("SETTINGS \(tag) cells: \(cells.joined(separator: " | "))")
            print("SETTINGS \(tag) buttons: \(buttons.joined(separator: " | "))")
        }
        _ = settings.cells.firstMatch.waitForExistence(timeout: 10)

        // Settings search is the reliable route: the iPad sidebar keeps its own
        // scroll position, and a swipe on the app moves the detail pane instead.
        let search = settings.searchFields.firstMatch
        if search.waitForExistence(timeout: 5) && search.isHittable {
            search.tap()
            search.typeText("Auto-Lock")
            Thread.sleep(forTimeInterval: 2)
            let hit = NSPredicate(format: "label BEGINSWITH[c] %@", "Auto-Lock")
            var result: XCUIElement?
            for q in [settings.cells, settings.buttons, settings.staticTexts] {
                let m = q.matching(hit)
                for i in 0..<min(m.count, 4) where m.element(boundBy: i).isHittable { result = m.element(boundBy: i); break }
                if result != nil { break }
            }
            if let result { result.tap(); Thread.sleep(forTimeInterval: 2) } else { dumpSettings("search") }
        }
        // The search result can land on Display & Brightness instead of Auto-Lock.
        if !row("Never").exists {
            if !row("Auto-Lock").exists {
                let display = row("Display")
                if display.exists && display.isHittable { display.tap(); Thread.sleep(forTimeInterval: 1.5) }
            }
            let autoLock = row("Auto-Lock")
            if autoLock.exists && autoLock.isHittable { autoLock.tap(); Thread.sleep(forTimeInterval: 1.5) }
        }
        let never = row("Never")
        guard never.waitForExistence(timeout: 5) else {
            dumpSettings("auto-lock")
            XCTFail("no Never option under Auto-Lock")
            return
        }
        never.tap()
        Thread.sleep(forTimeInterval: 1.5)
        print("AUTO-LOCK: Never selected=\(never.isSelected) value=\(String(describing: never.value))")
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "rehearsal-00-auto-lock-never"
        shot.lifetime = .keepAlways
        add(shot)

        // Read it back from Display & Brightness, where the Auto-Lock row shows its value.
        let back = settings.navigationBars.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", "Display")).firstMatch
        if back.exists && back.isHittable { back.tap(); Thread.sleep(forTimeInterval: 1.5) }
        let cellPredicate = NSPredicate(format: "identifier CONTAINS[c] %@ OR label BEGINSWITH[c] %@", "AUTOLOCK", "Auto-Lock")
        let autoLockRow = settings.cells.matching(cellPredicate).firstMatch
        _ = autoLockRow.waitForExistence(timeout: 5)
        let inner = autoLockRow.staticTexts.allElementsBoundByIndex.map { $0.label }.joined(separator: " ")
        let readBack = "\(autoLockRow.label) \((autoLockRow.value as? String) ?? "") \(inner)"
        print("AUTO-LOCK: Display & Brightness row reads [\(readBack)]")
        let shot2 = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot2.name = "rehearsal-00-auto-lock-readback"
        shot2.lifetime = .keepAlways
        add(shot2)
        XCTAssertTrue(readBack.contains("Never") || never.isSelected, "Auto-Lock did not read back as Never: \(readBack)")
        settings.terminate()
    }

    func testOfflineSigningRehearsal() throws {
        let env = ProcessInfo.processInfo.environment
        guard let phrase = env["XCHAIN_DEMO_MNEMONIC"], !phrase.isEmpty else {
            throw XCTSkip("XCHAIN_DEMO_MNEMONIC is not injected; run through the rehearsal driver")
        }
        let sendTo = (env["XCHAIN_DEMO_SEND_TO"] ?? "").split(separator: ",").map(String.init).filter { !$0.isEmpty }
        let broadcast = env["XCHAIN_REHEARSAL_BROADCAST"] == "1"
        let password = "Rehearsal-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(14) + "!"

        // Whatever happens below, the iPad does not stay in Airplane Mode.
        addTeardownBlock { [weak self] in self?.setAirplaneMode(false, tag: "teardown") }

        XCUIDevice.shared.orientation = .portrait
        // On device the runner gets PBErrorDomain 10/11 for the general pasteboard,
        // so the driver hands the phrase over from the Mac by Universal Clipboard and
        // the app's own edit-menu Paste reads it. Staging here is only a fallback.
        app.launch()
        _ = app.staticTexts.firstMatch.waitForExistence(timeout: 30)
        if button(anyOf: ["Unlock Wallet"]) != nil {
            missed.append("the app already holds a wallet from an earlier run; uninstall it and run again")
            XCTFail("rehearsal needs a fresh install: \(missed.joined(separator: "; "))")
            return
        }
        acceptTerms()
        advanceIntroCarousel()
        rehearsalShot("01-0-wallet-setup")

        guard importDemoWallet(phrase: phrase, password: password) else {
            // Close the app BEFORE failing: a failure attaches a screenshot and a UI
            // hierarchy, and the phrase may still be in the field.
            app.terminate()
            Thread.sleep(forTimeInterval: 1)
            print("REHEARSAL STOPPED at import: \(missed.joined(separator: "; "))")
            XCTFail("rehearsal stopped at import: \(missed.joined(separator: "; "))")
            return
        }
        rehearsalShot("01-1-imported")

        switchActiveNetwork(to: "Testnet", password: password)
        Thread.sleep(forTimeInterval: 8)
        rehearsalShot("02-testnet-balances")
        dumpTexts("testnet-balances")

        guard composeToConfirmation(sendTo: sendTo) else {
            XCTFail("rehearsal could not compose: \(missed.joined(separator: "; "))")
            return
        }
        rehearsalShot("04-1-confirm-online")
        dumpTexts("confirm-online")

        // "Now turn on Airplane Mode, and confirm."
        let airplaneOn = setAirplaneMode(true, tag: "on")
        rehearsalShot("04-2-confirm-airplane-on")
        if airplaneOn == true {
            let pw = app.secureTextFields.firstMatch
            if pw.exists && pw.isHittable { pw.tap(); pw.typeText(password) }
            _ = tap(reviewScreen(), "Sign (offline)")
            let signed = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Signed. Not broadcast yet.")).firstMatch
            let sawSigned = signed.waitForExistence(timeout: 90)
            print("OFFLINE SIGN: 'Signed. Not broadcast yet.' shown=\(sawSigned)")
            rehearsalShot("04-3-after-sign-offline")
            dumpTexts("after-sign-offline")
            if !sawSigned { missed.append("offline sign: 'Signed. Not broadcast yet.' never appeared") }
            if let done = button(anyOf: ["Done"]), done.isHittable { done.tap() }
        } else {
            missed.append("Airplane Mode could not be turned on, so the offline confirm was not attempted")
        }

        // "Turn Airplane Mode off and the app prompts you about the queued transaction."
        let airplaneOff = setAirplaneMode(false, tag: "off")
        print("AIRPLANE restored off=\(airplaneOff == false)")
        if let home = button(anyOf: ["Home", "Balances"]), home.isHittable { home.tap() }
        // develop labels the queue button "Send now"; the 0.341.3 build in review says
        // "Broadcast now" and also raises a "queued transaction" toast on reconnect.
        let banner = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH %@ OR label BEGINSWITH %@", "Send now", "Broadcast now")).firstMatch
        let toast = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "queued transaction")).firstMatch
        let sawToast = toast.waitForExistence(timeout: 30)
        let sawBanner = banner.waitForExistence(timeout: 60)
        print("QUEUE: reconnect toast shown=\(sawToast) queue button shown=\(sawBanner) label=\(sawBanner ? banner.label : "-")")
        rehearsalShot("04-4-network-back")
        dumpTexts("network-back")
        if !sawBanner && airplaneOn == true { missed.append("queue banner never appeared after Airplane Mode off") }

        if broadcast && sawBanner {
            if tap(banner, "queue banner send button") {
                let cleared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: banner)
                let sent = XCTWaiter().wait(for: [cleared], timeout: 90) == .completed
                print("QUEUE: banner cleared after Send now=\(sent)")
                rehearsalShot("04-5-after-send-now")
                dumpTexts("after-send-now")
            }
        }

        print("REHEARSAL missed: \(missed.joined(separator: "; "))")
        if !missed.isEmpty {
            XCTFail("rehearsal could not complete: \(missed.joined(separator: "; "))")
        }
    }
}
