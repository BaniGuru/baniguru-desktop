export const ENV = {
  environment: import.meta.env.VITE_ENV,
  wssApiUrl: import.meta.env.VITE_NODE_API_URL,
  apiUrl: import.meta.env.VITE_API_URL,
  isDev: import.meta.env.VITE_ENV === "dev",
  sentryDsn: import.meta.env.VITE_SENTRY_DSN,
};