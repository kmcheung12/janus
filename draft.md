**Here's the updated PRD** with the new product name: **Janus**.

---

**Janus – Product Requirements Document (PRD)**

**Version:** 1.0 (Draft)  
**Date:** May 11, 2026  
**Status:** Draft for review

---

### 1. Product Vision
**Janus** is a **browser-based product development accelerator** that captures real user sessions, transforms them into visual flowcharts with UI reconstructions, enables rich annotations, and generates high-quality LLM prompts for fast code changes.

Named after the Roman god **Janus** — the deity of beginnings, endings, transitions, and duality — the tool perfectly represents the full cycle: from the **start** of a user journey to the **end** goal of improved code and product experiences.

**Tagline:** *“From real session to implemented change — one Janus link at a time.”*

---

### 2. Objectives
- Dramatically accelerate product iteration cycles for engineering, product, and design teams.
- Turn ambiguous user sessions into clear, visual, and actionable artifacts.
- Replace fragmented tools (screenshots, Miro, manual notes) with a single structured workflow.
- Everything **browser-based**. 

---

### 3. Target Users
- Frontend & Full-stack Engineers
- Product Managers
- UX/UI Designers
- QA Engineers

**Primary Use Cases:** Localhost, staging environments, and controlled production sessions.

---

### 4. Core Workflow

1. **Record** — User activates the Janus browser extension and starts recording.
2. **Live Flowchart** — Janus builds a flowchart on-the-fly in the sidebar as the user interacts with the app.
3. **Capture** - Janus captures User interactions (clicks, scrolls, inputs, etc.), UI state via rrweb (DOM reconstruction + replay) and all network/API calls + responses + errors
3. **Annotate** — User adds notes directly on the page (overlay) or on the flowchart.
4. **Save & Share** — Session is uploaded to the lightweight backend → a clean sharable link is generated.
5. **Review** — Team members open the link in any browser (no extension needed).
6. **Generate Prompt** — Use “Generate LLM Prompt” to create detailed prompts for Cursor, Claude, etc.
7. **Iterate** — Implement changes → record new session → close the loop.

---

### 5. Key Features

#### 5.1 Janus Browser Extension (Capture)
- Built with **WXT + Svelte 5**
- Supports **Chrome and Firefox**
- Manual start/stop recording (icon click or keyboard shortcut)
- High-fidelity recording using **rrweb** (DOM, interactions, UI reconstruction)
- Full network/API interception (requests, responses, errors, timings)
- **Live Mermaid flowchart** generation in the sidebar
- Floating annotation toolbar injected on the target page
- Unified timeline (interactions + network + errors)

#### 5.2 Janus Web Viewer (Shareable)
- Pure browser-based web application (no extension required)
- Clean, responsive interface hosted by the backend
- Features:
  - rrweb replay player
  - Interactive flowchart viewer + light editing
  - Annotated timeline
  - Comments and tags
  - One-click “Generate LLM Prompt”

#### 5.3 Annotations
- In-page overlay (highlight elements, add comments, draw)
- Flowchart-level annotations (nodes and edges)
- Tagged categories: UI Change, Journey Change, Error Fix, New Feature, etc.

#### 5.4 Sharing & Collaboration
- Secure, shareable links (e.g. `https://janus.local/s/abc123`)
- Optional password protection
- View-only by default

#### 5.5 LLM Prompt Generation
- Intelligent prompt builder that includes:
  - Relevant Mermaid flowchart segments
  - UI/DOM description from rrweb
  - Network calls and errors
  - User annotations and desired behavior
- Multiple templates for different change types

---

### 6. Technical Stack (Fully Browser-Based)

| Layer              | Technology                        | Notes |
|--------------------|-----------------------------------|-------|
| Extension          | WXT + Svelte 5                    | Lightweight & fast |
| Recording          | rrweb + custom network interceptor| DOM + interactions |
| Flowchart          | Mermaid.js + Svelte components    | Live updates |
| Backend            | FastAPI + SQLite                  | Self-hosted web server |
| Web Viewer         | Svelte 5 (or SvelteKit)           | Pure browser app |
| Deployment         | docker-compose (local or VPS)     | One-command setup |

---

### 7. Non-Functional Requirements
- **Performance**: Minimal overhead on recorded pages. Extension UI must feel snappy.
- **Privacy & Security**: Session auto delete. Easy session management and deletion.
- **Accessibility**: Shareable links work in any modern browser.
- **Cross-browser**: Chrome + Firefox first.

---

### 8. Phase 1 (MVP) Scope
- Core recording + rrweb replay
- On-the-fly basic flowchart
- Annotations (in-page + flowchart)
- Session sharing via web viewer
- Basic LLM prompt generation
- Local/self-hosted deployment only

**Out of Scope (Phase 1)**:
- Multi-session analytics
- Advanced AI features
- Repository/codebase deep integration
- Public cloud version

---

### 9. Risks & Challenges
- rrweb fidelity with modern SPAs
- Performance impact of live flowchart generation
- Large session data handling
- Overlay stability across different web frameworks

---

### 10. Success Criteria
- Users can complete a full cycle (record → share → generate prompt) in under 10 minutes.
- Team members find the web viewer intuitive and valuable.
- Clear reduction in iteration friction and miscommunication.

---
