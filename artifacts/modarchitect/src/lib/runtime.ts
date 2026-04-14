export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function sanitizeUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/$/, "");
}

const configuredApiBaseUrl = sanitizeUrl(import.meta.env.VITE_API_BASE_URL);
export const apiBaseUrl = configuredApiBaseUrl;

export const clerkPubKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();

export function resolveApiUrl(path: string): string {
  return apiBaseUrl ? `${apiBaseUrl}${path}` : `${basePath}${path}`;
}
