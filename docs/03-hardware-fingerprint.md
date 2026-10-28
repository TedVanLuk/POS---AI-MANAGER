# 03 — Fingerprint Hardware & Tablet Compatibility

## The core constraint
A web browser **cannot talk to a USB fingerprint reader directly**. Vendors don't ship WebUSB drivers. Every working setup needs one of two things:

1. **Windows tablet:** the vendor's *local web service*. It runs on the tablet, and the browser calls it over `https://localhost`.
2. **Android tablet:** a *thin native wrapper* (Capacitor/WebView app) around our kiosk web page. A native plugin calls the vendor's Android SDK over USB-OTG.

Our kiosk code talks to a `BiometricDriver` interface (`web/src/kiosk/drivers`), so the reader brand can change without touching the rest of the system.

## Recommended readers

| Rank | Reader | Android (USB-OTG) | Windows browser | SDK cost | Approx. PH price | Verdict |
|---|---|---|---|---|---|---|
| ⭐ 1 | **SecuGen Hamster Pro 20 (HU20)** | ✅ FDx SDK Pro for Android (free) | ✅ **SecuGen WebAPI** (local service, free) | Free | ₱5,000–7,500 | **Best overall.** FBI FAP20/PIV certified, the same free SDK on both platforms, ISO/ANSI templates. Driver already scaffolded (`secugen-webapi`). |
| 2 | **ZKTeco ZK9500 / SLK20R** | ✅ ZKFinger SDK for Android | ⚠️ ZKFinger SDK (Windows, needs a small local bridge) | Free | ₱2,500–4,500 (Lazada/Shopee) | **Best budget.** Widely available locally, good sensor, ZK's own template format. |
| 3 | **HID DigitalPersona U.are.U 4500 / 5300** | ⚠️ U.are.U SDK for Android (paid licence) | ✅ **DigitalPersona WebSDK** + Lite Client (free) | Free (Win) / paid (Android) | ₱6,000–9,000 | **Best for Windows tablets.** Rock-solid, but Android costs extra. |
| 4 | Futronic FS80H | ✅ Android SDK | ✅ Windows SDK | Paid | ₱4,000–6,000 | OK alternative, less local support |
| — | Mantra MFS110 | ✅ RD Service | ✅ | Free | Import | India (Aadhaar)-centric; local support is limited |

**Avoid:** "Windows Hello" USB keys (Kensington VeriMark, generic ₱800 readers). They only unlock Windows and have **no capture/match SDK**.

## Recommended tablet setups

| Setup | Tablet | Reader | Integration | Notes |
|---|---|---|---|---|
| **A (recommended)** | Android 11+ tablet with USB-C OTG, e.g. Samsung Galaxy Tab A9+ or Lenovo Tab M10/M11 | SecuGen HU20 | Capacitor wrapper + SecuGen Android SDK plugin | Cheapest robust option; use a kiosk launcher (lock-task mode) |
| B | Windows 10/11 tablet, e.g. Surface Go, or a Chuwi/Teclast Win tablet | SecuGen HU20 **or** DigitalPersona 4500 | Browser + vendor local web service | Zero native code; the browser drives the reader directly |
| C (budget) | Android tablet | ZKTeco ZK9500 | Capacitor + ZKFinger plugin | Lowest hardware cost |

Practical tips:
- Use a **powered USB-C hub** or a short OTG cable. Keep the tablet charging while the reader is connected.
- Mount the reader **on a fixed stand**, so employees place their finger the same way every time. That improves match rates.
- Enroll **two fingers per employee** (e.g. right index and left index). Then a cut or bandaged finger doesn't block punching.

## Matching flow (implemented)

```
Admin enrolls (admin login on kiosk) ──► template captured on the device ──► POST /api/employees/:id/fingerprints
                                                                           (encrypted AES-256-GCM at rest)

Kiosk start ──► GET /api/kiosk/templates (device token, TLS) ──► held in memory only
Employee places finger ──► driver.capture() ──► driver.match(probe, each template) (1:N, best score ≥ threshold)
                       ──► POST /api/kiosk/punch {clientUuid, employeeId, matchScore, punchedAt}
                       ──► server toggles IN/OUT, returns the employee's week summary (days worked, lates)
Offline? ──► punch stays in the kiosk queue (localStorage), synced later; clientUuid makes it idempotent
```

- **1:N on the device** is fast for up to ~500 templates per branch on modern readers' matchers.
- Server-side matching (templates never leave the server) is a planned option for larger tenants. It needs a server matcher licence, e.g. SecuGen FDx for Linux or Neurotechnology.

## Data Privacy Act (RA 10173) checklist
Fingerprints are **sensitive personal information**.
- Get written employee consent before enrollment. The `consent_at` field must be set before a template can be saved.
- Encrypt templates at rest (AES-256-GCM, key from `BIOMETRIC_KEY`). Never store raw images.
- Only registered kiosks can download templates (device token; the token can be revoked).
- Delete templates when an employee is separated (`DELETE /api/employees/:id/fingerprints`).
- Register the processing system with the NPC and appoint a DPO.
