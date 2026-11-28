/**
 * Preview deployments run as a sandbox: a throwaway in-memory database seeded with
 * demo people, so a branch can be clicked through without touching anyone's real data.
 * Vercel sets VERCEL_ENV=preview only on preview deployments; production and local
 * dev never see this. Previews are behind Vercel's own sign-in (deployment protection).
 */
export const isSandbox = () => process.env.VERCEL_ENV === "preview";
