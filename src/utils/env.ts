export const ENV = {
  environment: import.meta.env.VITE_ENV,
  apiUrl: import.meta.env.VITE_API_URL,
  isDev: import.meta.env.VITE_ENV === "dev",
  sentryDsn: import.meta.env.VITE_SENTRY_DSN,
  speechUsToken: import.meta.env.VITE_SONIOX_US_SPEECH_TOKEN,
  speechJpToken: import.meta.env.VITE_SONIOX_JP_SPEECH_TOKEN,
  apiToken: import.meta.env.VITE_API_TOKEN,
};