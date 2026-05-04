import Capacitor
import Foundation
import StoreKit

@objc(StoreKitTestPlugin)
public class StoreKitTestPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreKitTestPlugin"
    public let jsName = "StoreKitTest"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasActiveSubscription", returnType: CAPPluginReturnPromise),
    ]

    @objc func isAvailable(_ call: CAPPluginCall) {
        if #available(iOS 15.0, *) {
            call.resolve(["available": true])
        } else {
            call.resolve(["available": false])
        }
    }

    @objc func getProducts(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("StoreKit testing requires iOS 15 or newer.")
            return
        }

        guard let productIds = call.getArray("productIds", String.self), !productIds.isEmpty else {
            call.reject("productIds is required.")
            return
        }

        Task {
            do {
                let products = try await Product.products(for: productIds)
                let sorted = products.sorted { left, right in
                    productIds.firstIndex(of: left.id) ?? Int.max < productIds.firstIndex(of: right.id) ?? Int.max
                }
                let result = sorted.map { self.serializeProduct($0) }
                await MainActor.run {
                    call.resolve(["products": result])
                }
            } catch {
                await MainActor.run {
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("StoreKit testing requires iOS 15 or newer.")
            return
        }

        guard let productId = call.getString("productId"), !productId.isEmpty else {
            call.reject("productId is required.")
            return
        }

        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else {
                    await MainActor.run {
                        call.reject("StoreKit product not found: \(productId)")
                    }
                    return
                }

                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    let transaction = try self.checkVerified(verification)
                    await transaction.finish()
                    await MainActor.run {
                        call.resolve([
                            "success": true,
                            "productId": transaction.productID,
                            "transactionId": String(transaction.id),
                            "expirationDate": transaction.expirationDate?.iso8601String() as Any,
                        ])
                    }
                case .pending:
                    await MainActor.run {
                        call.resolve([
                            "success": false,
                            "pending": true,
                            "productId": productId,
                        ])
                    }
                case .userCancelled:
                    await MainActor.run {
                        call.resolve([
                            "success": false,
                            "cancelled": true,
                            "productId": productId,
                        ])
                    }
                @unknown default:
                    await MainActor.run {
                        call.reject("Unknown StoreKit purchase result.")
                    }
                }
            } catch {
                await MainActor.run {
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("StoreKit testing requires iOS 15 or newer.")
            return
        }

        Task {
            do {
                try await AppStore.sync()
                let productIds = call.getArray("productIds", String.self) ?? []
                let active = try await self.activeSubscriptionProductIds(matching: productIds)
                await MainActor.run {
                    call.resolve([
                        "active": !active.isEmpty,
                        "productIds": active,
                    ])
                }
            } catch {
                await MainActor.run {
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc func hasActiveSubscription(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.resolve(["active": false, "productIds": []])
            return
        }

        let productIds = call.getArray("productIds", String.self) ?? []
        Task {
            do {
                let active = try await self.activeSubscriptionProductIds(matching: productIds)
                await MainActor.run {
                    call.resolve([
                        "active": !active.isEmpty,
                        "productIds": active,
                    ])
                }
            } catch {
                await MainActor.run {
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @available(iOS 15.0, *)
    private func serializeProduct(_ product: Product) -> [String: Any] {
        var out: [String: Any] = [
            "id": product.id,
            "displayName": product.displayName,
            "description": product.description,
            "displayPrice": product.displayPrice,
        ]

        if let subscription = product.subscription {
            out["periodValue"] = subscription.subscriptionPeriod.value
            out["periodUnit"] = periodUnitName(subscription.subscriptionPeriod.unit)
        }

        return out
    }

    @available(iOS 15.0, *)
    private func activeSubscriptionProductIds(matching productIds: [String]) async throws -> [String] {
        var active: [String] = []
        for await result in Transaction.currentEntitlements {
            let transaction = try checkVerified(result)
            if !productIds.isEmpty && !productIds.contains(transaction.productID) {
                continue
            }
            if let expirationDate = transaction.expirationDate, expirationDate <= Date() {
                continue
            }
            if transaction.revocationDate != nil {
                continue
            }
            active.append(transaction.productID)
        }
        return active
    }

    @available(iOS 15.0, *)
    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .verified(let safe):
            return safe
        case .unverified(_, let error):
            throw error
        }
    }

    @available(iOS 15.0, *)
    private func periodUnitName(_ unit: Product.SubscriptionPeriod.Unit) -> String {
        switch unit {
        case .day:
            return "day"
        case .week:
            return "week"
        case .month:
            return "month"
        case .year:
            return "year"
        @unknown default:
            return "unknown"
        }
    }
}

private extension Date {
    func iso8601String() -> String {
        ISO8601DateFormatter().string(from: self)
    }
}
