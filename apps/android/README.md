# EJClaw Android

Personal Android companion for EJClaw. This is a thin client: EJClaw still runs
on the existing Bun service, and the Android app talks to the dashboard API.

## Build

```bash
cd apps/android
cp local.properties.example local.properties
./gradlew assembleDebug
```

The debug APK is written to:

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

Install with:

```bash
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
```

## Runtime Setup

- Keep EJClaw behind Tailscale, VPN, SSH tunnel, or localhost forwarding.
- Base URL defaults to `http://100.101.210.95:8734`.
- If `WEB_DASHBOARD_TOKEN` is enabled on the server, paste the same token into
  the app. It sends `Authorization: Bearer <token>`.

## Current MVP

- Connect to `/api/health`.
- Load rooms from `/api/rooms-timeline`.
- Open a room timeline from `/api/rooms/:jid/timeline`.
- Send text through `/api/rooms/:jid/messages`.
- Keep the Ray-Ban Display integration isolated behind `DisplaySurface`.

## Meta DAT

The default APK does not link the Meta DAT SDK yet. Meta's Android DAT SDK is
distributed through GitHub Packages and needs Developer Preview access, a
GitHub package token, and a Wearables Developer Center application id.

The integration point is already present:

```text
app/src/main/java/com/ejclaw/android/display/
```

After DAT access is ready, replace `MetaDatDisplaySurface` with SDK calls and
keep `NoopDisplaySurface` for phone-only testing.
