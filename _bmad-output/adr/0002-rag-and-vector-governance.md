# ADR-0002: RAG and Vector Governance

- Status: Accepted
- Date: 2026-03-10
- Owners: Architecture, Data, Security

## Context

The architecture includes future AI-assisted workflows. RAG and vector search can improve retrieval quality but can also introduce tenant leakage, prompt injection, and sensitive data exposure.

## Decision

1. RAG is optional for MVP Tier 1 and is not required to ship core workflows.
2. If RAG is introduced, vector storage uses `pgvector` in Supabase Postgres.
3. Vectors must live in an isolated schema with strict tenant scoping.
4. Retrieval enforces tenant and role filters before semantic ranking.
5. Prompt input and retrieved context must pass policy checks for prompt injection and unsafe content.
6. PII and regulated compliance payloads are excluded from embeddings unless explicitly approved by security and compliance.

## Consequences

- Positive: Enables controlled AI retrieval while preserving tenant and compliance boundaries.
- Negative: Requires additional indexing, policy middleware, and retrieval test coverage.

## Verification

- Red-team tests for cross-tenant retrieval leakage.
- Prompt-injection test suite in CI for RAG-enabled paths.
- Data classification review before any new embedding corpus is indexed.
