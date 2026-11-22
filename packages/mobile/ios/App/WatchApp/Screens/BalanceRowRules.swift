import Foundation

enum BalanceRowRules {
    static let iconPoints: Double = 28
    static let stackBelowWidth: Double = 190

    static func stacksNameOverAmount(screenWidth: Double) -> Bool {
        screenWidth < stackBelowWidth
    }
}
