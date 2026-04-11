export const ENV = {
  environment: import.meta.env.VITE_ENV,
  apiUrl: import.meta.env.VITE_API_URL,
  isDev: import.meta.env.VITE_ENV === "dev",
  sentryDsn: import.meta.env.VITE_SENTRY_DSN,
  speechToken: import.meta.env.VITE_SPEECH_TOKEN,
  apiToken: import.meta.env.VITE_API_TOKEN,
};