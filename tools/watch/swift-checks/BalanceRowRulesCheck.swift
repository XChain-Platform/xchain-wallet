import Foundation

@main
struct BalanceRowRulesCheck {
    static func main() {
        check(BalanceRowRules.stacksNameOverAmount(screenWidth: 162), "162 points stacks")
        check(BalanceRowRules.stacksNameOverAmount(screenWidth: 176), "176 points stacks")
        check(BalanceRowRules.stacksNameOverAmount(screenWidth: 184), "184 points stacks")
        check(BalanceRowRules.stacksNameOverAmount(screenWidth: 187), "187 points stacks")
        check(!BalanceRowRules.stacksNameOverAmount(screenWidth: 198), "198 points stays inline")
        check(!BalanceRowRules.stacksNameOverAmount(screenWidth: 208), "208 points stays inline")
        check(!BalanceRowRules.stacksNameOverAmount(screenWidth: 211), "211 points stays inline")
        check(BalanceRowRules.stacksNameOverAmount(screenWidth: 189.9), "189.9 points stacks")
        check(!BalanceRowRules.stacksNameOverAmount(screenWidth: 190), "190 points stays inline")
        check(BalanceRowRules.iconPoints == 28, "icon is 28 points")
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            print("FAILED: \(name)")
            exit(1)
        }
    }
}
