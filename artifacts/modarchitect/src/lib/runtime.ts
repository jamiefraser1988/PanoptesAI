export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function sanitizeUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/$/, "");
}

const DEFAULT_PROD_APP_ORIGIN = "https://www.panoptesai.net";

const configuredApiBaseUrl = sanitizeUrl(import.meta.env.VITE_API_BASE_URL);
export const apiBaseUrl = configuredApiBaseUrl;

const configuredAppOrigin = sanitizeUrl(import.meta.env.VITE_APP_ORIGIN);
export const appOrigin = configuredAppOrigin || (import.meta.env.PROD ? DEFAULT_PROD_APP_ORIGIN : "");

export const clerkPubKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();

// Hosted Clerk accounts portal URLs. When unset, the app falls back to the
// embedded <SignIn/> and <SignUp/> components rendered in-app at /sign-in and
// /sign-up. Re-enable by setting VITE_CLERK_SIGN_IN_URL / VITE_CLERK_SIGN_UP_URL
// once Clerk's hosted edge for accounts.www.panoptesai.net is healthy.
export const clerkSignInUrl = sanitizeUrl(import.meta.env.VITE_CLERK_SIGN_IN_URL);
export const clerkSignUpUrl = sanitizeUrl(import.meta.env.VITE_CLERK_SIGN_UP_URL);

export function resolveApiUrl(path: string): string {
  return apiBaseUrl ? `${apiBaseUrl}${path}` : `${basePath}${path}`;
}
