# OurGLP1 v2

> [!IMPORTANT]
> **This repository is the production source of truth for the iOS app only.**
> The `android/` directory in this repository is not the current Android app and
> must not be used for Android releases, Firebase configuration, or Google Ads setup.

## Platform source of truth

Before changing native configuration, Firebase, GA4, Google Ads, bundle/package
identifiers, signing, or store-release files, verify the target platform here.

- Authoritative platform: **iOS**
- Production iOS repository: `/Users/parisder/Projects/OURGLP1 version 2`
- iOS bundle ID: `com.ourglp1.app`
- Firebase iOS App ID: `1:557159382889:ios:b5f1b7166d6289653d47f8`
- GA4 iOS stream: `OurGLP1v2` (`15276793946`)
- Firebase/GA4 property: `glp1-parisclinic`
- The authoritative Android repository is `/Users/parisder/Projects/Paris_Clinic`.
- The production Android application ID is `com.parisclinic.app`.

Current advertising/analytics situation as of 18 July 2026:

- GA4 is linked to Google Ads account `642-401-8196` (`OurGLP1`).
- The iOS stream is receiving traffic.
- Google Ads currently has an app-install conversion for Android
  `com.parisclinic.app`, but no iOS install conversion for `com.ourglp1.app`.
- The Firebase record named `OurGLP1v2 Android` / `com.ourglp1.app` was created
  from the stale Android folder in this repository. It is not the production
  Android app and must not be used without an explicit migration decision.
- Do not send health-sensitive events to Google Ads or use them for advertising
  audiences. Ads measurement should use safe events such as install/first open
  and approved subscription events.

A React + TypeScript + Vite + Capacitor mobile app for GLP-1 tracking, reminders, and subscription-based features.

---

## 🧱 Tech Stack

- React (Vite)
- TypeScript (strict mode)
- Capacitor (iOS / Android)
- RevenueCat (subscriptions)
- Local-first auth + storage

---

## 🚀 Getting Started

### Install dependencies

```bash
npm install
