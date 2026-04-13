This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Microsoft SSO Setup (Local + Render)

This app requires Microsoft Entra SSO environment variables.

### 1) Local setup

- Use [cblaero/.env.local.example](.env.local.example) as reference.
- Fill values in [cblaero/.env.local](.env.local).

Required variables:

- CBL_SESSION_SECRET: random secret (32+ chars)
- CBL_APP_URL: local app URL, usually http://localhost:3000
- CBL_SSO_ISSUER: Entra authority base URL, format https://login.microsoftonline.com/<tenant-id>
- CBL_SSO_CLIENT_ID: Application (client) ID from Entra app registration
- CBL_SSO_CLIENT_SECRET: Client secret value from Entra app registration
- CBL_SSO_ALLOWED_EMAIL_DOMAIN: cblsolutions.com
- CBL_SSO_ALLOWED_TENANT_ID: Entra Directory (tenant) ID
- CBL_SUPABASE_URL: Supabase project URL
- CBL_SUPABASE_SERVICE_ROLE_KEY: Supabase service_role API key
- CBL_SUPABASE_SCHEMA: dedicated Postgres schema for this app (for example cblaero_app, not public)
- CBL_APPROVED_US_REGIONS: comma-separated allowlist of approved USA regions (for example us-east-1,us-west-2)
- CBL_DATA_REGION: active region used for customer data storage
- CBL_LOG_REGION: active region used for operational logs
- CBL_BACKUP_REGION: active region used for backups/archive targets

Optional:

- CBL_SSO_TOKEN_ISSUER: defaults to <CBL_SSO_ISSUER>/v2.0

### 2) How to get Microsoft values

In Microsoft Entra admin center:

1. Go to Entra ID -> App registrations -> New registration.
2. Create a Web app and add redirect URI:
	- Local: http://localhost:3000/api/auth/callback
	- Render: https://<your-service>.onrender.com/api/auth/callback
3. Copy:
	- Directory (tenant) ID -> CBL_SSO_ALLOWED_TENANT_ID
	- Application (client) ID -> CBL_SSO_CLIENT_ID
4. Go to Certificates & secrets -> New client secret.
5. Copy secret Value -> CBL_SSO_CLIENT_SECRET (store immediately).

Set CBL_SSO_ISSUER as:

- https://login.microsoftonline.com/<tenant-id>

### 3) Render setup

- Use [cblaero/.env.render.example](.env.render.example) as template.
- In Render service settings -> Environment, add all required variables.
- Set CBL_APP_URL to your Render service URL.
- Redeploy after saving env variables.

### 3.1) Render data residency runbook (required)

If login/runtime fails with a USA data residency policy gate error, verify these values in Render service environment:

- CBL_APPROVED_US_REGIONS=us-east-1,us-west-2
- CBL_DATA_REGION=us-west-2
- CBL_LOG_REGION=us-west-2
- CBL_BACKUP_REGION=us-west-2

Operational checks:

- Use lowercase region identifiers only.
- Keep all region values inside CBL_APPROVED_US_REGIONS.
- Do not wrap values in quotes.
- Redeploy after any change.

### 4) Supabase schema setup (non-default schema)

This app is configured to use a dedicated Postgres schema, not `public`.

1. In Supabase SQL Editor, run [cblaero/supabase/schema.sql](supabase/schema.sql).
2. Choose a schema name (default in the script is `cblaero_app`).
3. Set `CBL_SUPABASE_SCHEMA` to that schema name in:
	- local: [cblaero/.env.local](.env.local)
	- Render: service environment variables

If `CBL_SUPABASE_SCHEMA` is set to `public`, the app will fail fast at startup by design.

If USA residency policy variables are missing or set to non-approved regions, the app will fail fast with an explicit policy error describing the invalid values and the approved region allowlist.

## Residency Preflight for Provisioning and Migrations

Run this before provisioning or migration operations to enforce the same USA residency policy gates outside runtime request paths:

```bash
npm run residency:preflight
```

Recommended usage:

- Before running Supabase schema operations
- Before environment provisioning/promotion to staging/production
- In CI/CD prior to migration/apply steps

## Active-Client Contract Checklist

When adding or changing candidate operations in later epics, keep UX and API scope controls in lockstep:

- UI must surface the current active client explicitly.
- Requests must include activeClientId when operation scope is client-sensitive.
- API handlers must validate activeClientId against authenticated client memberships.
- Cross-client high-impact actions must keep server-enforced confirmation requirements.
- Tests must include positive and negative active-client scope cases.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
