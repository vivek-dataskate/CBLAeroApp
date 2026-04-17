# Story 3.1a: Recruiter AI Command Bar and Chat Assistant

Status: backlog

## Story

As a recruiter,
I want a chat-style command bar embedded in my dashboard where I can type what I want in natural language and the system shows me the right screen, pre-fills actions, and guides me through workflows,
so that I never need to learn UI navigation — I just describe my intent and the system does the rest.

## Vision

Replace traditional UI navigation with a conversational interface. The recruiter types:
- *"Send availability check to all structural engineers in Texas"*
- *"Show me active A&P mechanics near Dallas with 5+ years"*
- *"Blast the new Boeing 737 MRO job to available candidates in Everett"*
- *"How many candidates did I contact this week?"*
- *"Follow up on all candidates submitted to Comlux last Monday"*

The system interprets intent, shows a confirmation card with the action pre-filled, and executes on approval. No menu hunting, no filter clicking, no pagination.

## Acceptance Criteria

### AC 1: Chat Drawer / Command Bar UI

**Given** a recruiter on any dashboard page
**When** they click the command bar icon (floating action button, bottom-right) or press a keyboard shortcut (e.g., `Ctrl+K` / `Cmd+K`)
**Then** a chat drawer slides in from the right side of the screen
**And** it persists across page navigation within the dashboard session
**And** conversation history is retained for the session (cleared on logout)
**And** the drawer can be collapsed/expanded without losing context
**And** on first open, a welcome message shows capability categories (see AC 7)

### AC 2: Natural Language Intent Parsing

**Given** the recruiter types a message in the chat bar
**When** they press Enter / Send
**Then** the system parses intent using Claude API (Story 1.9 centralized inference service) with structured output
**And** extracts:
- **Action type:** search, send_sms, send_email, show_candidates, show_stats, follow_up, bulk_action, help
- **Filters:** skills, location (city/state), availability, role, experience range, source, date range, company
- **Template selection:** agenda category match (new_opportunity, availability_check, job_followup, etc.)
- **Context params:** job title, company name, interview date/time, etc.
**And** ambiguous intents trigger a clarifying question (not a guess)
**And** destructive/send actions always require explicit confirmation before execution

### AC 3: Action Cards with Confirmation

**Given** the AI parses a recruiter intent
**When** the action is resolved
**Then** the chat displays a structured **action card** (not plain text) showing:
- **For search:** Filter summary pills + result count + "Show Results" button (navigates to candidate list with filters pre-applied)
- **For SMS send:** Template preview + candidate count + phone/opt-out breakdown + "Send Now" / "Schedule" buttons (reuses SendSMSModal from Story 3.1)
- **For stats:** Inline metric cards (candidates contacted, response rate, etc.)
- **For follow-up:** List of candidates matching criteria + suggested template + "Send" button
**And** every action card has a "Cancel" / "Modify" option
**And** no send/blast action executes without an explicit "Confirm" click

### AC 4: RAG-Based Contextual Intelligence

**Given** the chat assistant processes recruiter queries
**When** it needs context beyond the current prompt
**Then** it retrieves relevant context via RAG from:
- **Candidate database:** Skills, roles, availability, location — used for filter resolution and count estimates
- **Template library:** Available SMS/email templates by agenda — used for template suggestion
- **Recruiter history:** Recent searches, sends, and actions by this recruiter — used for personalization
- **Job context:** Active jobs/requirements (when Epic 4 is built) — used to auto-fill context params
**And** RAG retrieval is bounded (max 20 candidates per preview, top 5 templates per suggestion) to keep responses fast
**And** the system uses Supabase full-text search and indexed queries — NOT raw LLM knowledge — for candidate data

### AC 5: Smart Autocomplete and Popular Searches

**Given** the recruiter starts typing in the command bar
**When** they have typed 3+ characters
**Then** a dropdown shows:
- **Autocomplete suggestions** based on partial text matching against:
  - Skills in the candidate database (e.g., typing "struct" → "structural engineering", "structures inspector")
  - Location names (cities, states)
  - Template agenda names
  - Recent searches by this recruiter
- **Popular/valuable searches** — cached top-N queries across all recruiters for this tenant:
  - "Available A&P mechanics in [top 5 states]"
  - "Candidates added this week"
  - "Follow up on pending submissions"
  - Cached with TTL (refresh daily), stored in-memory or Redis-like cache
- **Quick action shortcuts** — pre-built prompts the recruiter can click:
  - "Send availability check to all active candidates"
  - "Show candidates I contacted today"
  - "Blast [template] to [skill] candidates in [state]"
**And** selecting an autocomplete suggestion fills the input and auto-submits
**And** the autocomplete cache is tenant-scoped (no cross-tenant data leakage)

### AC 6: Text Prompting / Guided Input

**Given** the recruiter types a partial or ambiguous query
**When** the system detects the intent category but missing parameters
**Then** it guides the recruiter with inline prompts:
- Recruiter types: *"send sms to engineers"* → System: *"Which template? [New Opportunity] [Availability Check] [Job Follow-up]"* (clickable pills)
- Recruiter types: *"blast"* → System: *"What do you want to blast? Describe the job or pick a template:"*
- Recruiter types: *"show candidates"* → System: *"Any filters? You can specify skills, location, availability, or just say 'show all'"*
**And** the guided prompts use clickable pills/buttons — not just text — so the recruiter can tap instead of type
**And** the system remembers the conversation thread to accumulate params across turns (e.g., turn 1: "send sms to engineers", turn 2: "in Texas", turn 3: picks template → ready to send)

### AC 7: Capability Discovery

**Given** the recruiter opens the chat assistant for the first time (or types "help" / "what can you do")
**When** the welcome/help message displays
**Then** it shows categorized capability cards:

**Search & Filter**
- "Show me [skill] candidates in [location]"
- "Find available A&P mechanics with 5+ years experience"
- "Who was added this week?"

**SMS Outreach**
- "Send [template type] to [candidates matching criteria]"
- "Blast new job to all [skill] candidates in [state]"
- "Follow up on candidates submitted to [company]"

**Quick Stats**
- "How many candidates did I contact today/this week?"
- "What's my SMS response rate?"
- "Show my send history"

**Workflow**
- "Check availability of [candidate name]"
- "What's pending for [company]?"

**And** each example is clickable — tapping it pre-fills the input
**And** the capability list updates as new features are added (driven by a config, not hardcoded)

### AC 8: Performance and Caching

**Given** the chat assistant handles recruiter queries
**When** processing and responding
**Then** response time is under 3 seconds for cached/simple queries, under 6 seconds for complex RAG queries
**And** the following caching layers are applied:
- **Autocomplete cache:** Skills list, location list, template list — refreshed every 4 hours, tenant-scoped
- **Popular searches cache:** Top 20 queries per tenant — refreshed daily
- **Intent parsing cache:** Identical prompts return cached parsed intent (LRU, 100 entries per tenant, 1-hour TTL)
- **Candidate count cache:** Filter → count results cached for 15 minutes (avoids repeated DB queries during multi-turn conversations)
**And** cache invalidation occurs on template changes, large ingestion batches, or manual admin trigger
**And** all LLM calls go through the Story 1.9 centralized inference service with cost tracking

## Tasks / Subtasks

- [ ] Task 1: Chat drawer UI component
  - [ ] 1.1 Create `src/app/dashboard/recruiter/ChatCommandBar.tsx` — floating action button + slide-in drawer
  - [ ] 1.2 Message thread UI: user messages (right-aligned), assistant messages (left-aligned), action cards (full-width)
  - [ ] 1.3 Input bar with autocomplete dropdown
  - [ ] 1.4 Keyboard shortcut handler (`Ctrl+K` / `Cmd+K`)
  - [ ] 1.5 Session-persistent conversation state (React context or zustand)

- [ ] Task 2: Intent parsing engine
  - [ ] 2.1 Create `src/modules/outreach/intent-parser.ts` — structured output via Claude API: `{action, filters, template, contextParams, clarifications}`
  - [ ] 2.2 System prompt engineering: recruiter-domain-specific, CBLAero schema-aware, action-safe (never auto-execute sends)
  - [ ] 2.3 Multi-turn conversation support: accumulate params across messages
  - [ ] 2.4 Clarification logic: detect ambiguity, ask targeted follow-up questions

- [ ] Task 3: RAG context retrieval
  - [ ] 3.1 Candidate search integration: reuse `resolveMatchingCandidates()` from Story 3.1 for filter-to-count resolution
  - [ ] 3.2 Template retrieval: fetch templates by agenda match for suggestion
  - [ ] 3.3 Recruiter history: recent sends, recent searches (last 50 per recruiter, stored in session or DB)
  - [ ] 3.4 Bounded retrieval: max 20 candidates per preview, top 5 templates per suggestion

- [ ] Task 4: Autocomplete and popular searches
  - [ ] 4.1 Skills autocomplete: query distinct skills from candidates table, cache tenant-scoped
  - [ ] 4.2 Location autocomplete: distinct city/state values, cached
  - [ ] 4.3 Popular searches: aggregate top queries per tenant, daily refresh
  - [ ] 4.4 Recent searches: per-recruiter, last 10, session-stored
  - [ ] 4.5 Quick action shortcuts: configurable list of pre-built prompts

- [ ] Task 5: Action cards and execution bridge
  - [ ] 5.1 SearchResultCard: filter pills + count + "Show Results" button (navigates with query params)
  - [ ] 5.2 SendSMSCard: template preview + counts + "Send" button (opens SendSMSModal or calls API directly)
  - [ ] 5.3 StatsCard: inline metrics display
  - [ ] 5.4 ClarificationCard: guided prompts with clickable pills
  - [ ] 5.5 CapabilityCard: categorized help display

- [ ] Task 6: API routes
  - [ ] 6.1 `POST /api/outreach/chat/parse` — send message + conversation history → returns parsed intent + action card data
  - [ ] 6.2 `GET /api/outreach/chat/autocomplete?q=` — returns skills, locations, templates, recent searches matching query
  - [ ] 6.3 `GET /api/outreach/chat/popular` — returns top searches for tenant

- [ ] Task 7: Caching layer
  - [ ] 7.1 In-memory cache for autocomplete data (skills, locations, templates) with 4-hour TTL
  - [ ] 7.2 Intent parse cache (LRU, 100 entries, 1-hour TTL)
  - [ ] 7.3 Candidate count cache (15-min TTL per filter hash)
  - [ ] 7.4 Popular searches cache (daily refresh)

- [ ] Task 8: Tests and quality gate
  - [ ] 8.1 Intent parser unit tests (minimum 20: various phrasings, edge cases, multi-turn, ambiguity detection)
  - [ ] 8.2 Autocomplete tests (minimum 8: partial match, empty, tenant isolation)
  - [ ] 8.3 Action card rendering tests
  - [ ] 8.4 Integration test: full flow from chat input → intent → action card → API call
  - [ ] 8.5 Verify no send executes without explicit confirmation click

## Dev Notes

### Architecture

- **LLM calls:** All through Story 1.9 centralized inference service (`src/modules/ai/`). Use structured output (JSON mode) for intent parsing — no free-text parsing.
- **Prompt engineering:** The system prompt must include: available actions, filter fields, template agendas, and safety rules ("never execute a send without user confirmation"). Use the prompt registry (`prompt_registry` table) for version control.
- **No autonomous actions:** The chat assistant suggests and pre-fills — it never sends SMS or modifies data without an explicit confirm click. This is a hard safety constraint.
- **Reuse Story 3.1 infrastructure:** `resolveMatchingCandidates()`, `SendSMSModal`, template list API, send API — the chat is a conversational front-end to the same backend.

### UX Principles

- **Chat-first, not chat-only:** The traditional filter/search UI remains. The chat is an accelerator, not a replacement. Recruiters who prefer clicking can still use the existing candidate list page.
- **Show, don't tell:** Action cards with real data (candidate counts, template previews) — not just "I found 142 candidates" as plain text.
- **Guided over open-ended:** When intent is ambiguous, show clickable options rather than asking open questions. Reduce typing, increase tapping.
- **Learn from usage:** Popular searches and recent queries surface what recruiters actually do — the system gets smarter with use.

### Dependencies

- Story 3.1 (SMS pipeline, templates, SendSMSModal, filter-based send API) — must be complete
- Story 1.9 (centralized AI inference service) — already done
- Candidate search/filter query logic — already exists in recruiter candidates API

### Cost Awareness

- Each chat message = 1 Claude API call (~$0.003-0.01 per message depending on context size)
- Caching reduces repeat calls significantly
- Intent parsing uses haiku-class model for speed/cost (not opus)
- Budget alert if recruiter exceeds 100 chat messages/day (unusual — flag for review)

### References

- [Source: _bmad-output/stories/3-1-*.md] — SMS pipeline, templates, SendSMSModal, filter-based send
- [Source: _bmad-output/stories/1-9-*.md] — centralized AI inference service, prompt registry
- [Source: src/modules/ai/] — existing Claude SDK integration
- [Source: src/app/dashboard/recruiter/candidates/page.tsx] — candidate filter/search UI to bridge from chat
- [Source: _bmad-output/ux-design-specification.md] — recruiter persona (Mike), context-rich dashboard vision

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
