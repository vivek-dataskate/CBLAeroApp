# Story 1.1: Initialize Next.js Baseline with Core Platform Modules

Status: done

## Story

As a platform engineer,
I want to initialize the application from the approved Next.js TypeScript starter with module boundaries,
so that all subsequent stories build on a consistent architecture baseline.

## Acceptance Criteria

1. Given an empty application workspace, when the baseline scaffold is created with required runtime/tooling configuration, then the app builds and runs with lint and type checks passing.
2. Core module boundaries for auth, tenants, audit, and ingestion are present in the initialized codebase.

## Tasks / Subtasks

- [x] Initialize baseline application scaffold
  - [x] Create Next.js App Router project using TypeScript, ESLint, Tailwind, src layout, and import alias.
  - [x] Pin runtime/tooling versions according to architecture baseline (Node.js v24 LTS, Next.js 16.x, TypeScript-first).
  - [x] Add baseline scripts for dev, build, lint, and typecheck.

- [x] Establish domain module boundaries
  - [x] Create feature-bounded module structure for auth, tenants, audit, and ingestion.
  - [x] Add module index boundaries and internal contracts to prevent cross-module leakage.
  - [x] Add placeholder request envelope for auth and tenant context propagation via Next.js proxy.

- [x] Verify engineering quality gates
  - [x] Run lint and typecheck successfully.
  - [x] Run build successfully.
  - [x] Capture output evidence in completion notes.

## Dev Notes

- This story is a platform bootstrap story. Do not implement business workflows yet.
- The architecture explicitly requires this baseline story before feature implementation.
- Keep design aligned with feature-bounded folders and tenant-safe foundations.

### Project Structure Notes

- Target structure should be App Router + src layout with bounded modules under src.
- Minimum boundary expectation for this story:
  - src/modules/auth
  - src/modules/tenants
  - src/modules/audit
  - src/modules/ingestion
- If implementation occurs in a separate CBLAero app repository, preserve this story key and acceptance criteria for traceability.

### References

- Source: docs/planning_artifacts/epics.md (Epic 1, Story 1.1)
- Source: docs/planning_artifacts/architecture.md (Selected Starter: Next.js App Router Baseline)
- Source: docs/planning_artifacts/architecture.md (First story baseline requirement)
- Source: docs/planning_artifacts/architecture.md (Frontend Architecture: feature-bounded folders)
- Source: docs/planning_artifacts/architecture.md (Architecture Standards and Governance)

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References

- npx create-next-app@latest cblaero --typescript --eslint --tailwind --src-dir --app --import-alias "@/*" --use-npm --yes --no-git
- npm run lint
- npm run typecheck
- npm run test
- npm run build

### Completion Notes List

- Scaffolded Next.js 16 App Router TypeScript baseline in cblaero with src layout and alias support.
- Added explicit typecheck script to package scripts.
- Added Node runtime constraint in package engines to enforce v24 LTS baseline.
- Established module boundaries under src/modules for auth, tenants, audit, and ingestion, including barrel export.
- Added src/proxy.ts for baseline trace, tenant, and actor header envelope propagation.
- Hardened proxy envelope so tenant/actor context is always server-set and not client-trusted.
- Added baseline unit tests for module contracts and proxy header hardening.
- Validation passed: lint, typecheck, and production build all succeed.

### File List

- cblaero/.gitignore
- cblaero/eslint.config.mjs
- cblaero/next-env.d.ts
- cblaero/next.config.ts
- cblaero/package-lock.json
- cblaero/package.json
- cblaero/postcss.config.mjs
- cblaero/README.md
- cblaero/tsconfig.json
- cblaero/public/file.svg
- cblaero/public/globe.svg
- cblaero/public/next.svg
- cblaero/public/vercel.svg
- cblaero/public/window.svg
- cblaero/src/app/favicon.ico
- cblaero/src/app/globals.css
- cblaero/src/app/layout.tsx
- cblaero/src/app/page.tsx
- cblaero/src/proxy.ts
- cblaero/src/modules/index.ts
- cblaero/src/modules/auth/index.ts
- cblaero/src/modules/tenants/index.ts
- cblaero/src/modules/audit/index.ts
- cblaero/src/modules/ingestion/index.ts
- cblaero/src/modules/__tests__/baseline.test.ts
- docs/implementation_artifacts/stories/1-1-initialize-next-js-baseline-with-core-platform-modules.md
