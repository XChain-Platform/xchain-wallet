import XCTest

enum RealOnboarding {
    @discardableResult
    static func createFreshWallet(
        _ app: XCUIApplication,
        password: String,
        timeout: TimeInterval = 90
    ) -> [String]? {
        guard acceptTerms(app, timeout: timeout) else {
            return failed("license acceptance", app: app)
        }
        guard advanceIntro(app, timeout: timeout) else {
            return failed("intro carousel", app: app)
        }

        let create = button(app, named: "Create new wallet")
        guard waitUntilHittable(create, timeout: timeout) else {
            return failed("Create new wallet", app: app)
        }
        create.tap()

        let passwordField = namedElement(
            app.secureTextFields,
            label: "Password",
            comparison: "=="
        )
        let confirmField = namedElement(
            app.secureTextFields,
            label: "Confirm",
            comparison: "CONTAINS[c]"
        )
        guard waitUntilHittable(passwordField, timeout: timeout) else {
            return failed("Password field", app: app)
        }
        passwordField.tap()
        passwordField.typeText(password)
        guard scrollAndTap(confirmField, in: app, timeout: timeout) else {
            return failed("confirm password field", app: app)
        }
        confirmField.typeText(password)

        let passwordNext = button(app, named: "Next")
        guard scrollAndTap(passwordNext, in: app, timeout: timeout) else {
            return failed("password submission", app: app)
        }

        let reveal = button(app, named: "Reveal Recovery Phrase")
        guard scrollAndTap(reveal, in: app, timeout: timeout) else {
            return failed("recovery phrase reveal", app: app)
        }
        guard let words = recoveryWords(app, timeout: timeout) else {
            return failed("12 recovery phrase words", app: app)
        }

        guard tickSavedPhrase(app, timeout: timeout) else {
            return failed("saved recovery phrase acknowledgement", app: app)
        }
        let verify = button(app, named: "Verify Recovery Phrase")
        guard scrollAndTap(verify, in: app, timeout: timeout) else {
            return failed("Verify Recovery Phrase", app: app)
        }
        guard answerRecoveryQuiz(app, words: words, timeout: timeout) else {
            return failed("recovery phrase verification fields", app: app)
        }

        let createWallet = button(app, named: "Create Wallet")
        guard scrollAndTap(createWallet, in: app, timeout: timeout) else {
            return failed("Create Wallet", app: app)
        }

        let donations = namedElement(
            app.staticTexts,
            label: "Automatic Donations",
            comparison: "=="
        )
        guard donations.waitForExistence(timeout: timeout) else {
            return failed("Automatic Donations notice", app: app)
        }
        let continueButton = button(app, named: "Continue")
        guard scrollAndTap(continueButton, in: app, timeout: timeout) else {
            return failed("Automatic Donations Continue", app: app)
        }

        let onboardingChoice = button(app, named: "Create new wallet")
        let home = button(app, named: "Home")
        let balances = button(app, named: "Balances")
        guard waitUntil(timeout: timeout, condition: {
            !onboardingChoice.exists && (home.isHittable || balances.isHittable)
        }) else {
            return failed("Home or Balances after wallet creation", app: app)
        }
        return words
    }

    private static func acceptTerms(_ app: XCUIApplication, timeout: TimeInterval) -> Bool {
        guard app.staticTexts.firstMatch.waitForExistence(timeout: 25) else { return false }
        let accept = button(app, named: "Accept and continue")
        guard accept.waitForExistence(timeout: timeout) else { return false }

        let agreement = namedElement(
            app.descendants(matching: .any),
            label: "I have read and agree",
            comparison: "BEGINSWITH[c]"
        )
        let license = namedElement(
            app.descendants(matching: .any),
            label: "License terms",
            comparison: "=="
        )
        guard waitUntil(timeout: timeout, condition: {
            if agreement.exists && agreement.isEnabled { return true }
            if license.exists && license.isHittable {
                license.swipeUp(velocity: .fast)
            } else {
                app.swipeUp(velocity: .fast)
            }
            return false
        }) else {
            return false
        }

        guard tickNamedControl(app, label: "I have read and agree") else { return false }
        guard waitUntilHittable(accept, timeout: timeout) else { return false }
        accept.tap()
        return waitUntil(timeout: timeout) { !accept.exists }
    }

    private static func advanceIntro(_ app: XCUIApplication, timeout: TimeInterval) -> Bool {
        let create = button(app, named: "Create new wallet")
        for _ in 0..<8 {
            if create.exists { return true }
            for label in ["Get started", "Done", "Continue"] {
                let finish = button(app, named: label)
                if finish.exists && finish.isHittable {
                    finish.tap()
                    return waitUntil(timeout: timeout) { create.exists }
                }
            }
            let next = button(app, named: "Next")
            guard waitUntilHittable(next, timeout: timeout) else { return false }
            next.tap()
            _ = waitUntil(timeout: 2) { !next.exists || next.isHittable }
        }
        return create.exists
    }

    private static func recoveryWords(
        _ app: XCUIApplication,
        timeout: TimeInterval
    ) -> [String]? {
        let cells = app.descendants(matching: .any).matching(
            NSPredicate(format: "label MATCHES %@", "^[0-9]+\\. [a-z]+$")
        )
        guard waitUntil(timeout: timeout, condition: { cells.count >= 12 }) else {
            return nil
        }

        var indexed: [Int: String] = [:]
        for cell in cells.allElementsBoundByIndex {
            let parts = cell.label.components(separatedBy: ". ")
            guard
                parts.count == 2,
                let position = Int(parts[0]),
                (1...12).contains(position)
            else {
                continue
            }
            indexed[position] = parts[1]
        }
        guard indexed.count == 12 else { return nil }
        return (1...12).compactMap { indexed[$0] }
    }

    private static func tickSavedPhrase(
        _ app: XCUIApplication,
        timeout: TimeInterval
    ) -> Bool {
        let label = "I have saved my recovery phrase safely."
        guard waitUntil(timeout: timeout, condition: {
            namedControl(app, label: label)?.exists == true
        }) else {
            return false
        }
        guard let control = namedControl(app, label: label) else { return false }
        for _ in 0..<6 where !control.isHittable {
            app.swipeUp()
        }
        guard control.isHittable else { return false }
        if control.elementType == .staticText || control.elementType == .other {
            control.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5)).tap()
        } else {
            control.tap()
        }
        return true
    }

    private static func answerRecoveryQuiz(
        _ app: XCUIApplication,
        words: [String],
        timeout: TimeInterval
    ) -> Bool {
        let fields = app.textFields.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Word ")
        )
        guard waitUntil(timeout: timeout, condition: { fields.count > 0 }) else {
            return false
        }

        let quizFields = fields.allElementsBoundByIndex
        for field in quizFields {
            guard
                let position = Int(field.label.replacingOccurrences(of: "Word ", with: "")),
                words.indices.contains(position - 1)
            else {
                return false
            }
            for _ in 0..<6 where !field.isHittable {
                app.swipeUp()
            }
            guard field.isHittable else { return false }
            field.tap()
            field.typeText(words[position - 1])
        }
        return !quizFields.isEmpty
    }

    private static func scrollAndTap(
        _ element: XCUIElement,
        in app: XCUIApplication,
        timeout: TimeInterval
    ) -> Bool {
        guard element.waitForExistence(timeout: timeout) else { return false }
        for _ in 0..<8 where !element.isHittable {
            app.swipeUp()
        }
        guard element.isHittable && element.isEnabled else { return false }
        element.tap()
        return true
    }

    private static func tickNamedControl(_ app: XCUIApplication, label: String) -> Bool {
        guard let control = namedControl(app, label: label), control.isHittable else {
            return false
        }
        if control.elementType == .staticText || control.elementType == .other {
            control.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.5))
                .withOffset(CGVector(dx: -24, dy: 0))
                .tap()
        } else {
            control.tap()
        }
        return true
    }

    private static func namedControl(_ app: XCUIApplication, label: String) -> XCUIElement? {
        for type in [
            XCUIElement.ElementType.checkBox,
            .switch,
            .button,
            .staticText,
            .other,
        ] {
            let match = namedElement(
                app.descendants(matching: type),
                label: label,
                comparison: "BEGINSWITH[c]"
            )
            if match.exists { return match }
        }
        return nil
    }

    private static func button(_ app: XCUIApplication, named label: String) -> XCUIElement {
        namedElement(app.buttons, label: label, comparison: "CONTAINS[c]")
    }

    private static func namedElement(
        _ query: XCUIElementQuery,
        label: String,
        comparison: String
    ) -> XCUIElement {
        query.matching(
            NSPredicate(format: "label \(comparison) %@", label)
        ).firstMatch
    }

    private static func waitUntilHittable(
        _ element: XCUIElement,
        timeout: TimeInterval
    ) -> Bool {
        waitUntil(timeout: timeout) { element.exists && element.isHittable && element.isEnabled }
    }

    private static func waitUntil(
        timeout: TimeInterval,
        condition: () -> Bool
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline
        return condition()
    }

    private static func failed(_ step: String, app: XCUIApplication) -> [String]? {
        XCTContext.runActivity(named: "Real onboarding could not reach: \(step)") { _ in
            XCTContext.runActivity(named: app.debugDescription) { _ in }
        }
        return nil
    }
}
