// ---------------------------------------------------------------------------
// OAuth client configuration (Google + Apple sign-in)
// ---------------------------------------------------------------------------
//
// These are PLACEHOLDERS. Sign-in stays in a graceful "coming soon" fallback
// until the relevant client ID below is filled in (or supplied via the
// EXPO_PUBLIC_* env vars in mobile/eas.json per build profile).
//
// HOW TO ACTIVATE
//
// Google  — https://console.cloud.google.com/ → APIs & Services → Credentials
//   Create OAuth 2.0 Client IDs:
//     • iOS client    → use its client ID as GOOGLE_IOS_CLIENT_ID
//     • Web client     → use its client ID as GOOGLE_WEB_CLIENT_ID
//       (expo-auth-session's Google provider uses the web client ID as the
//        `expoClientId`/`webClientId` and the platform client IDs for native).
//   Then add BOTH of those client IDs (comma-separated) to the BACKEND env var
//   GOOGLE_CLIENT_IDS so the server accepts tokens minted for either audience.
//
// Apple   — https://developer.apple.com/account/resources/identifiers
//   Enable "Sign In with Apple" on the app's App ID. The audience Apple puts in
//   the identity token is the app's BUNDLE IDENTIFIER (e.g. app.snapmedical.mobile).
//   Set that same value as the BACKEND env var APPLE_CLIENT_ID.
//   (No client ID is needed here on the mobile side — expo-apple-authentication
//    uses the app's own bundle id automatically. APPLE_ENABLED just lets us
//    show/hide the button independently if needed.)
//
// ---------------------------------------------------------------------------

// Google OAuth client IDs. Leave '' to keep Google sign-in disabled.
export const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
export const GOOGLE_ANDROID_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '';
export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';

// Convenience flags the UI uses to decide whether to attempt real sign-in or
// fall back to the "coming soon" alert.
export const GOOGLE_ENABLED = Boolean(
  GOOGLE_IOS_CLIENT_ID || GOOGLE_ANDROID_CLIENT_ID || GOOGLE_WEB_CLIENT_ID
);

// Apple sign-in is gated on iOS availability + the backend being configured.
// We can't read the backend env from the client, so this flag only controls
// whether we attempt the native flow; if the backend returns 503 the screen
// shows the graceful fallback. Defaults to enabled on iOS.
export const APPLE_ENABLED =
  (process.env.EXPO_PUBLIC_APPLE_ENABLED || 'true') !== 'false';
