---
title: "How I Create Memory for My Agents on Claude Code"
description: "A six-layer memory architecture for persistent AI agent knowledge — from CLAUDE.md foundations to auto memory, plans, and permissions — managing 14 specialized agents across multiple AWS projects."
pubDate: 2026-03-03
category: "GenAI & AI Engineering"
tags: ["ai", "claude-code", "agent-memory", "productivity", "developer-tools"]
draft: false
---

I manage 14 specialized AI agents across multiple AWS projects. Rather than repeating context in every session, I built a multi-layered architecture giving agents persistent knowledge, specialised expertise, and consistent behaviour across every conversation.

## Six-Layer Memory Architecture

The system comprises six interconnected layers:

1. **CLAUDE.md** — Project rules and global guidelines
2. **Agent Personas** — Specialized identity files for different roles
3. **Skills** — Reusable knowledge modules
4. **Auto Memory** — Session-to-session learning via MEMORY.md
5. **Plans** — Multi-session task persistence
6. **Permissions** — Trust boundaries and allowed operations

## Layer 1: CLAUDE.md — The Foundation

The core document establishes the "TBT Law" (Think Before Typing) with ten principles emphasizing careful planning: "80% planning, 20% implementation" and mandatory approval before implementation.

Project-specific CLAUDE.md files inherit from root files while adding context like stack details, deployment targets, and navigation patterns. The inheritance chain looks like this:

```
Root CLAUDE.md (global rules)
  └── Project CLAUDE.md (stack, environments, naming conventions)
       └── Sub-project CLAUDE.md (service-specific context)
```

This means every agent, regardless of persona, inherits the same foundational rules — no drift, no inconsistency.

## Layer 2: Agent Personas

I maintain 14 distinct personas including HLD Architect, DevOps Engineer, SDET, Cloud Security Specialist, and Defect Manager. Each persona file contains:

- **Identity description** — who the agent is and what it specialises in
- **Core competencies** — the skills and knowledge areas it brings
- **Workflow steps** — how it approaches tasks (plan, execute, verify)
- **Constraints** — what it must never do

Personas are not prompts — they are persistent identity files that agents embody throughout sessions. When I load the DevOps Engineer persona, it doesn't just answer like a DevOps engineer for one question. It maintains that identity across the entire conversation, making decisions through that lens.

## Layer 3: Skills

Skills are atomic knowledge modules (`.skill.md` files) covering specific domains:

- DynamoDB single-table design patterns
- HATEOAS API design
- IAM least-privilege policies
- Terraform security scanning
- HTTP API v2 Lambda integration
- CI/CD pipeline parameterisation

The key design decision: skills are composable. Multiple personas reference the same skills, enabling knowledge reuse across different agent types. The Python Developer and the SDET both reference the same `AWS_Python_Dev.skill.md` — one for writing code, the other for testing it.

## Layer 4: Auto Memory

Claude Code automatically loads the first 200 lines of each project's `MEMORY.md` file. This is where agents document:

- **Confirmed patterns** — "this API returns camelCase, not snake_case"
- **Architectural decisions** — "we chose HTTP API v2 over REST API for cost"
- **Solutions to recurring problems** — "Cognito groups arrive bracket-wrapped in JWT claims"
- **Environment specifics** — account IDs, regions, resource names

The beauty of auto memory is that it's progressive. Agents improve over time as they accumulate verified knowledge. A pattern discovered in session 5 is available in session 50 — without me repeating it.

I curate this actively. Stale memories get removed. Wrong memories get corrected. The goal is a focused, accurate knowledge base — not a growing dump of everything that ever happened.

## Layer 5: Plans

For multi-session tasks, agents create persistent plan files in `~/.claude/plans/`. Plans include:

- **Context** — why this work is being done
- **Step-by-step instructions** — what needs to happen, in order
- **Verification criteria** — how to know each step succeeded
- **Progress tracking** — which steps are complete, which are pending

Claude Code reminds agents when relevant plans exist in subsequent sessions. This means I can close my laptop, come back tomorrow, and the agent picks up exactly where it left off — with full context of what's been done and what remains.

## Layer 6: Permissions

The `settings.local.json` file defines which bash commands and AWS operations agents can execute. My permissions file covers:

- **Git** — commit, push, branch operations
- **AWS CLI** — read-only operations, S3 sync, CloudFront invalidation
- **Terraform** — plan and apply (with approval gates)
- **Testing** — pytest, npm test, playwright

Critically, destructive production operations require explicit approval. An agent can `terraform plan` freely, but `terraform apply` in production triggers a confirmation prompt. This is the safety net that lets me give agents real power without real risk.

## Practical Workflow

Here's how it all comes together in practice:

1. **Open project** — CLAUDE.md loads automatically (global rules, environment config)
2. **Load persona** — "Load the DevOps Engineer agent" establishes specialized identity
3. **Check auto memory** — MEMORY.md provides proven patterns and known gotchas
4. **Create or resume plan** — multi-step work gets structured and tracked
5. **Execute within permissions** — agent works freely within allowed boundaries
6. **Document learning** — new discoveries get added to MEMORY.md for future sessions

## Recommendations

If you're building something similar:

1. **Start with CLAUDE.md alone** — it provides 80% of the value. Define your rules, your environments, your conventions. Everything else builds on this foundation.

2. **Extract personas when you repeat yourself** — if you keep describing "you are a DevOps engineer who..." at the start of sessions, it's time for a persona file.

3. **Keep skills atomic** — one skill per domain, composable across personas. A 500-line mega-skill is a maintenance burden.

4. **Curate auto memory aggressively** — remove stale entries, correct wrong ones. Quality over quantity. 200 lines is the limit; make them count.

5. **Use plans for anything spanning multiple sessions** — the cost of creating a plan is low; the cost of losing context between sessions is high.

6. **Start with restrictive permissions, then expand** — it's easier to grant access than to recover from an agent that deleted your production database.

## Conclusion

AI agents do not need to forget. With proper architectural structure — markdown files, version-controlled, transparent, and auditable — agents get better every week through accumulated memory rather than model improvements.

The most powerful upgrade to your AI workflow isn't a better model. It's better memory.

---

*Originally published on [Dev.to](https://dev.to/tsekatm/how-i-create-memory-for-my-agents-on-claude-code-mdn)*
