export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const DEFAULT_PROD_API_BASE_URL = "https://panoptes-api-909111042785.us-east5.run.app";
const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/$/, "");

export const apiBaseUrl = configuredApiBaseUrl || (import.meta.env.PROD ? DEFAULT_PROD_API_BASE_URL : "");

export const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

export function resolveApiUrl(path: string): string {
  return apiBaseUrl ? `${apiBaseUrl}${path}` : `${basePath}${path}`;
}
