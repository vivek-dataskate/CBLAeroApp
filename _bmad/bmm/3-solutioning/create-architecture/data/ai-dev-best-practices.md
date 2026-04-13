# AI & Development Best Practices Reference

_Reference document for architecture workflow. Use these patterns when designing systems that involve AI/LLM integration, external API orchestration, or data pipelines. Distilled from comprehensive industry research covering Python/TypeScript AI development, agent architectures, MLOps, security, and observability._

## Architecture Patterns for AI Systems

### Complexity Ladder — Start Simple
1. **Direct Model Call**: Single LLM call suffices (summarization, classification) — no extra logic needed
2. **Single Agent + Tools**: One AI agent with tool access (search, DB) in a loop — good for domain-specific apps
3. **Multi-Agent Sequential**: Chain specialized agents in a pipeline — each refines output of previous
4. **Multi-Agent Parallel**: Independent agents on same input, merge results — for cross-domain analysis
5. **Coordinator/Handoff**: Orchestrator delegates to sub-agents — for complex multi-domain problems

**Rule**: Use the lowest complexity level that meets requirements. Don't add agent layers unless single-agent fails.

### Service Architecture
- Separate services by function: **Auth Service**, **Data Service**, **AI Inference Service**, **Audit Service**
- Use REST/gRPC between services; message queues (Kafka, BullMQ) for async event-driven flows
- Each service independently deployable and scalable
- Monolith is fine for small teams/MVPs — extract services when components need independent scaling

### Communication Patterns
| Pattern | When to Use |
|---------|-------------|
| REST (HTTP/JSON) | External client-facing APIs, simple CRUD |
| gRPC (HTTP/2/protobuf) | High-performance internal service calls, streaming |
| Message Queues (Kafka, BullMQ) | Async background processing, data pipelines, event-driven |
| Direct DB/RPC | Internal same-service operations — always through repository layer |

### Datastore Decision Guide
| Data Type | Store | Examples |
|-----------|-------|---------|
| Structured/relational | SQL (PostgreSQL, Supabase) | Users, candidates, audit events, config |
| Key-value / cache | Redis, Memcached | Session cache, rate limiters, token cache |
| Embeddings / semantic search | Vector DB (pgvector, Pinecone, Weaviate, FAISS) | Candidate matching, RAG retrieval, semantic search |
| Documents / files | Object storage (S3, Supabase Storage) | Resumes, attachments, exports |

**When to use Vector DB vs SQL:** If you need scalable similarity search over embeddings (semantic search, RAG), use a vector store. For simple key-value or relational queries, use SQL. In-memory libraries (FAISS, Annoy) work for smaller datasets; managed vector DBs (Pinecone, pgvector) for production scale.

### Agent Orchestration Patterns
| Pattern | Description | When to Use |
|---------|-------------|-------------|
| Sequential (Pipeline) | Agent A → Agent B → Agent C | Multi-step processing (extract → validate → persist) |
| Coordinator/Director | Orchestrator delegates to specialized sub-agents | Complex multi-domain tasks, different expertise per subtask |
| Parallel Fan-Out | Multiple agents process same input concurrently, merge results | Cross-domain analysis, ensemble approaches |
| Reactor | Event-driven, agents respond to triggers | Real-time processing, webhook-driven flows |

### Protocol Integration
- **MCP (Model Context Protocol)**: Open protocol for connecting AI apps to tools and data sources. Use when building multi-agent systems that need standardized tool integration.
- **Multi-cloud**: Use container platforms (Kubernetes) and IaC (Terraform) to stay cloud-agnostic when load or data governance requires it.

## Model & LLM Lifecycle

### Data Pipeline
- Record data provenance (source, time, version)
- Automate sanity checks (missing values, schema validation)
- Version datasets alongside code (DVC, database snapshots)
- Apply anonymization/differential privacy for PII-containing training data

### Prompt/Model Management
- Log model version, prompt version, and hyperparameters for every inference
- Use a prompt registry (append-only) for trackability and rollback
- A/B test prompt changes: run old + new on same inputs, compare quality metrics
- Semantic versioning for prompts: major (schema change), minor (quality improvement), patch (wording fix)
- Maintain **model cards / factsheets** documenting each model's purpose, training data, evaluation metrics, known limitations, and intended use scope

### Evaluation
- Define business KPIs alongside technical metrics (accuracy, F1, fill rate)
- Backtest: compare predictions with ground truth collected after inference
- For extraction: track fill rate, error rate, rejection rate per batch
- Store evaluation results with model/prompt metadata
- Use statistical tests (A/B) to validate improvements are significant

### Deployment
- Containerize with pinned dependencies
- Blue/green or canary releases for model changes
- Rollback plan documented: which model version to revert to
- Smoke tests on staging before production cutover

## Observability

### Structured Logging
- Use JSON logs for queryability: `{ level, module, action, metadata, timestamp }`
- Log inputs, outputs, and confidence scores (redact PII)
- Include **correlation IDs** for distributed tracing across services
- Use consistent log levels: DEBUG (development), INFO (high-level events), WARNING/ERROR (issues)
- Audit logs must be **immutable** — use write-once storage or append-only tables, retain per compliance policy (1-2 years minimum for regulated domains)

### Correlation IDs
Every external request should receive a unique correlation ID (UUID) at the API gateway/entry point. Propagate this ID through:
- HTTP headers between services
- Log records in every service
- Database audit events
- LLM call metadata

This enables end-to-end request tracing across microservices, queues, and external API calls.

### Drift Detection
- Monitor input feature distributions vs training data
- Track output distribution shifts (e.g., extraction fill rate trending down)
- Alert on significant drift — trigger retraining or prompt review
- Tools: EvidentlyAI, custom rolling KL-divergence, or monitored metric thresholds

### Metrics to Track
- Prediction/extraction latency per call
- Throughput (calls/minute)
- Error rate (API failures, parse failures)
- Cost per batch (LLM tokens used)
- Quality proxies (fill rate, rejection rate)
- System health (CPU, memory, request rates)

### Alerts & Dashboards
- Define SLOs/thresholds (e.g., error rate >2%, latency >Xms)
- Dashboards combining metrics, logs, and traces (Grafana, Datadog)
- Observability relies on three pillars: metrics, logs, and traces — ensure all are covered

## Security & Governance

### LLM-Specific Security
- All content sent to LLM is untrusted input — treat like form input
- Defend against prompt injection: explicit instructions to ignore embedded commands
- Validate LLM output schema before persisting — reject malformed responses
- Never pass LLM output to SQL, shell, or eval without sanitization
- Never expose system prompts in API responses or logs
- Implement content filters and rate-limiting for generative outputs

### Access Control
- Least-privilege for all services (IAM roles, RBAC)
- API keys/secrets in vault (HashiCorp Vault, AWS Secrets Manager), never in code
- Rotate credentials regularly
- Audit all model/data access
- Protect APIs with authentication (OAuth2/JWT) and authorization

### Compliance & Data Protection
- Right to be forgotten (ability to purge candidate/user data — GDPR/CCPA)
- Data locality (keep data in required regions)
- Encrypt data at rest (AES-256) and in transit (TLS)
- Mask or tokenize sensitive fields; anonymize PII where possible
- Audit trails for all decisions — immutable, tamper-proof
- Model explainability where required (LIME/SHAP for scoring models)
- Maintain data lineage documentation (feature sources, training data versions)

### Incident Response for AI Systems
- Have a documented plan for AI incidents (wrong predictions, model degradation, security breaches)
- Include: rollback to previous model/prompt version, alert stakeholders, notify affected users (for high-stakes domains)
- Track incidents in the same system as sync errors / audit events
- Post-incident: update prompt/model, add regression test, document root cause

### Governance
- Define ownership matrix: who monitors the model, who approves changes, who retrains
- Use model cards / factsheets to summarize each model's purpose, data, evaluation, and limitations
- Establish review process for prompt/model changes (at minimum, A/B test before rollout)
- Maintain a risk register of AI/ML-specific risks

## Cost Optimization

### Hierarchy of Preference
1. Don't make the call (dedup, cache, skip)
2. Batch N items into 1 call
3. Use cheapest sufficient model (Haiku for extraction, not Opus)
4. Use stored procedures to combine operations server-side
5. Individual call as last resort

### Batching & Caching
- Batch inference requests where possible (micro-batching for real-time)
- Cache embeddings and repeated computations (Redis, in-memory)
- Precompute common queries
- Use incremental sync (`since`/`lastRunAt`) to avoid reprocessing

### Model Selection
- Use smallest model that meets quality bar
- Quantized/distilled models for high-volume low-complexity tasks
- Reserve large models for complex reasoning only
- Track cost per batch and trend over time

### Batch vs Real-time
- Group real-time inferences when possible (micro-batching) to amortize overhead
- Use serverless or on-demand instances for sporadic traffic
- For background jobs (ingestion, digests): batch aggressively, run on schedule

### Resource & Cloud Cost
- Right-size instances; use spot/preemptible for non-critical workloads (training, batch jobs)
- Monitor cloud costs (AWS Cost Explorer, GCP Billing) — set budget alerts
- Archive infrequently used data to cheaper storage tiers
- Shut down idle resources

## Testing AI Systems

### Unit Tests
- Test data transforms, feature engineering, metric calculations
- Test prompt construction logic
- Test output parsing and validation
- Test error handling for API failures and malformed responses

### Integration Tests
- Full pipeline: ingestion → extraction → persistence
- Use fixtures or synthetic data
- Validate no data loss or corruption across pipeline stages

### Adversarial Tests
- Prompt injection attempts in input content
- Malformed/missing fields in API responses
- Extremely large inputs (DoS)
- Fields that mimic output schema (poisoning)
- Follow OWASP AI Testing Guide methodology

### Quality & Regression Tests
- Compare new model/prompt against baseline on holdout set
- Statistical significance for improvements
- Fairness checks across data segments (bias audit)
- Maintain regression suite: known inputs → expected outputs

### Canary / Blue-Green Deployment
- Deploy new model/prompt to small traffic fraction
- Compare key metrics (error rate, latency, fill rate) against old version
- Roll back automatically if degradation detected

## Pre-Merge Checklist (AI Projects)

- [ ] All new functions/types have type annotations
- [ ] Unit tests added/updated; coverage high on utility code
- [ ] Model/prompt version logged in output
- [ ] No hardcoded secrets or credentials
- [ ] LLM inputs truncated and sanitized
- [ ] LLM outputs validated before persistence
- [ ] Batch operations used where possible
- [ ] Error handling covers API failures, parse failures, timeout
- [ ] Monitoring/logging covers new inference paths
- [ ] Correlation IDs propagated through new code paths
- [ ] Rollback plan documented for model/prompt changes
- [ ] Capabilities registered in architecture.md if reusable

## Tool Decision Guide

When choosing between tools during architecture, use these guidelines:

| Decision | Option A | Option B | Choose A When | Choose B When |
|----------|----------|----------|--------------|--------------|
| API Style | REST | gRPC | External-facing, simple CRUD | Internal high-perf, streaming |
| Concurrency | Sync (Express) | Async (Next.js App Router) | Low concurrency, simple | High I/O concurrency |
| Data Store | SQL (Postgres) | Vector DB (pgvector) | Relational data, transactions | Embedding search, RAG |
| Queue | Direct call | Message queue (BullMQ) | Simple, synchronous flow | Async, decoupled, retry needed |
| Experiment Tracking | MLflow | W&B | Self-hosted, open-source | SaaS, team collaboration |
| LLM Model | Haiku | Sonnet/Opus | High-volume extraction | Complex reasoning, low volume |
