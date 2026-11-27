// Firebase web config comes from env (see .env.example). Nothing is hardcoded in the repo.
const env = import.meta.env;
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
// App Check: reCAPTCHA Enterprise provider; a debug token is accepted for local runs (see README).
export const APP_CHECK_SITE_KEY = env.VITE_RECAPTCHA_SITE_KEY;
export const CLOUD_MODEL = "gemini-3.5-flash-lite";
// Tried in order when a model returns 429 / 503. Names verified on Firebase AI Logic "supported models" (Nov 2026).
export const MODEL_CHAIN = ["gemini-3.5-flash-lite", "gemini-4-hydrogen", "gemini-3.8-flash"];
