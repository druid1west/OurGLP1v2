import Capacitor
import Foundation
import HealthKit

@objc(AppleHealthPlugin)
public class AppleHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleHealthPlugin"
    public let jsName = "AppleHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDailySummary", returnType: CAPPluginReturnPromise),
    ]

    private let healthStore = HKHealthStore()

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "available": HKHealthStore.isHealthDataAvailable()
        ])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Apple Health is not available on this device.")
            return
        }

        healthStore.requestAuthorization(toShare: Set<HKSampleType>(), read: readTypes()) { success, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }

            call.resolve([
                "granted": success
            ])
        }
    }

    @objc func getDailySummary(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Apple Health is not available on this device.")
            return
        }

        guard let day = call.getString("day"), let bounds = dayBounds(day) else {
            call.reject("A valid day in YYYY-MM-DD format is required.")
            return
        }

        let group = DispatchGroup()
        var steps = 0.0
        var activeEnergy = 0.0
        var exerciseMinutes = 0.0
        var sleepMinutes = 0.0
        var restingHeartRate: Double?
        var workouts = 0

        group.enter()
        sumQuantity(.stepCount, unit: HKUnit.count(), start: bounds.start, end: bounds.end) { value in
            steps = value
            group.leave()
        }

        group.enter()
        sumQuantity(.activeEnergyBurned, unit: HKUnit.kilocalorie(), start: bounds.start, end: bounds.end) { value in
            activeEnergy = value
            group.leave()
        }

        group.enter()
        sumQuantity(.appleExerciseTime, unit: HKUnit.minute(), start: bounds.start, end: bounds.end) { value in
            exerciseMinutes = value
            group.leave()
        }

        group.enter()
        sleepDuration(start: bounds.start, end: bounds.end) { value in
            sleepMinutes = value
            group.leave()
        }

        group.enter()
        averageQuantity(.restingHeartRate, unit: HKUnit.count().unitDivided(by: HKUnit.minute()), start: bounds.start, end: bounds.end) { value in
            restingHeartRate = value
            group.leave()
        }

        group.enter()
        workoutCount(start: bounds.start, end: bounds.end) { value in
            workouts = value
            group.leave()
        }

        group.notify(queue: .main) {
            var result: [String: Any] = [
                "day": day,
                "steps": Int(steps.rounded()),
                "activeEnergyKcal": Int(activeEnergy.rounded()),
                "exerciseMinutes": Int(exerciseMinutes.rounded()),
                "sleepMinutes": Int(sleepMinutes.rounded()),
                "workouts": workouts,
            ]

            if let restingHeartRate = restingHeartRate {
                result["restingHeartRate"] = restingHeartRate
            } else {
                result["restingHeartRate"] = NSNull()
            }

            call.resolve(result)
        }
    }

    private func readTypes() -> Set<HKObjectType> {
        var types = Set<HKObjectType>()

        if let type = HKQuantityType.quantityType(forIdentifier: .stepCount) {
            types.insert(type)
        }
        if let type = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
            types.insert(type)
        }
        if let type = HKQuantityType.quantityType(forIdentifier: .appleExerciseTime) {
            types.insert(type)
        }
        if let type = HKQuantityType.quantityType(forIdentifier: .restingHeartRate) {
            types.insert(type)
        }
        if let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            types.insert(type)
        }

        types.insert(HKObjectType.workoutType())
        return types
    }

    private func dayBounds(_ day: String) -> (start: Date, end: Date)? {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"

        guard let date = formatter.date(from: day) else {
            return nil
        }

        let calendar = Calendar.current
        let start = calendar.startOfDay(for: date)
        guard let end = calendar.date(byAdding: .day, value: 1, to: start) else {
            return nil
        }

        return (start, end)
    }

    private func predicate(start: Date, end: Date) -> NSPredicate {
        HKQuery.predicateForSamples(withStart: start, end: end, options: [.strictStartDate])
    }

    private func sumQuantity(
        _ identifier: HKQuantityTypeIdentifier,
        unit: HKUnit,
        start: Date,
        end: Date,
        completion: @escaping (Double) -> Void
    ) {
        guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else {
            completion(0)
            return
        }

        let query = HKStatisticsQuery(
            quantityType: type,
            quantitySamplePredicate: predicate(start: start, end: end),
            options: .cumulativeSum
        ) { _, statistics, _ in
            completion(statistics?.sumQuantity()?.doubleValue(for: unit) ?? 0)
        }

        healthStore.execute(query)
    }

    private func averageQuantity(
        _ identifier: HKQuantityTypeIdentifier,
        unit: HKUnit,
        start: Date,
        end: Date,
        completion: @escaping (Double?) -> Void
    ) {
        guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else {
            completion(nil)
            return
        }

        let query = HKStatisticsQuery(
            quantityType: type,
            quantitySamplePredicate: predicate(start: start, end: end),
            options: .discreteAverage
        ) { _, statistics, _ in
            completion(statistics?.averageQuantity()?.doubleValue(for: unit))
        }

        healthStore.execute(query)
    }

    private func sleepDuration(start: Date, end: Date, completion: @escaping (Double) -> Void) {
        guard let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            completion(0)
            return
        }

        let query = HKSampleQuery(
            sampleType: type,
            predicate: predicate(start: start, end: end),
            limit: HKObjectQueryNoLimit,
            sortDescriptors: nil
        ) { _, samples, _ in
            let minutes = (samples as? [HKCategorySample] ?? [])
                .filter { self.isAsleepSample($0) }
                .reduce(0.0) { total, sample in
                    let overlapStart = max(sample.startDate, start)
                    let overlapEnd = min(sample.endDate, end)
                    guard overlapEnd > overlapStart else {
                        return total
                    }
                    return total + overlapEnd.timeIntervalSince(overlapStart) / 60
                }

            completion(minutes)
        }

        healthStore.execute(query)
    }

    private func isAsleepSample(_ sample: HKCategorySample) -> Bool {
        if sample.value == HKCategoryValueSleepAnalysis.asleep.rawValue {
            return true
        }

        if #available(iOS 16.0, *) {
            return sample.value == HKCategoryValueSleepAnalysis.asleepCore.rawValue ||
                sample.value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue ||
                sample.value == HKCategoryValueSleepAnalysis.asleepREM.rawValue
        }

        return false
    }

    private func workoutCount(start: Date, end: Date, completion: @escaping (Int) -> Void) {
        let query = HKSampleQuery(
            sampleType: HKObjectType.workoutType(),
            predicate: predicate(start: start, end: end),
            limit: HKObjectQueryNoLimit,
            sortDescriptors: nil
        ) { _, samples, _ in
            completion(samples?.count ?? 0)
        }

        healthStore.execute(query)
    }
}
