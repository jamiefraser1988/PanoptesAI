export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/$/, "");

export const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

export function resolveApiUrl(path: string): string {
  return apiBaseUrl ? `${apiBaseUrl}${path}` : `${basePath}${path}`;
}
