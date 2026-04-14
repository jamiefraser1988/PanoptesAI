## Replit Removal Plan

1. Replace implicit production auth/runtime fallbacks with explicit dashboard production config.
2. Remove the Clerk proxy path from the API and remove Replit-only Vite plugins/packages.
3. Delete obsolete Replit deployment files and update user-facing links/docs to Firebase Hosting + Cloud Run.
4. Build and deploy the dashboard first, verify the live bundle no longer points at the Replit-linked Clerk app, then deploy the API cleanup if verification is clean.
