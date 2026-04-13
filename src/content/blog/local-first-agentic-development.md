---
title: "How I Run Over 20 AI Agents Locally and Deploy One to Production at a Time"
description: "The industry ships agents fast and debugs them in production. Here's the opposite approach — local-first agentic development, liftability by design, and selective promotion to AWS Bedrock AgentCore."
pubDate: 2026-04-13
category: "GenAI & AI Engineering"
tags: ["mlops", "llmops", "agentops", "aws", "bedrock", "agentcore", "serverless", "machinelearning"]
draft: false
---

I have over 20 AI agents. Only one is in production.

That is not a constraint. It is a strategy.

A system with one excellent production agent and a library of production-ready agents waiting locally is more mature than a system with ten mediocre agents all simultaneously causing incidents. I believe this. I have built for it. This article explains how.

While most teams are racing to deploy fleets of AI agents and discovering — usually painfully — that managing agents in production is far heavier than anyone told them, I have been doing the opposite. Build locally. Validate thoroughly. Design every agent to be production-ready from day one. Promote to AWS Bedrock AgentCore only when a use case has earned it.

---

## The Problem With How Teams Ship Agents Today

There is a habit in AI development borrowed from early web development: ship fast, stabilise later. It worked reasonably well for stateless APIs. It fails for agents.

The operational overhead problem is the one no one talks about honestly. Each agent you lift to production is a runtime you now own. It needs monitoring, evaluation, cost governance, versioning, and a deployment pipeline. Each AgentCore runtime incurs ongoing costs — model invocation fees, Lambda execution time per tool call, API Gateway requests, DynamoDB reads for conversation state. One runtime versus twenty is a meaningful difference in your AWS bill before you have written a single line of business logic. That is not a fleet — that is a maintenance burden.

The failure modes compound it. A poorly configured agent does not throw a 500 error. It returns a plausible-sounding answer that is wrong. It invokes the right tool with the wrong parameters. It loses context mid-conversation and starts hallucinating a state that no longer exists. None of this shows up in your standard CloudWatch dashboard. You find out from a user.

I decided early that I was not going to pay that cost for use cases that had not been proven.

---

## My Architecture: Local-First Agentic Development

My local environment is built around Claude Code and a system of over 20 agent personas, each defined as a structured Markdown file with a clear identity, a set of skills, and integration points into my SDLC.

They cover the full SDLC — from architecture and security to testing, defect management, data engineering, and content. A few examples to make it concrete:

The **Defect Manager** accepts a reported bug, writes a reproduction test, implements the fix, deploys to DEV, and closes the loop in ClickUp — without a human touching the keyboard between report and verification.

The **SDET Engineer** designs test cases using boundary value analysis, equivalence partitioning, and pairwise techniques, then executes them against an API proxy — never the live service directly.

The **Cloud Security Specialist** runs STRIDE-based threat models and generates Terraform-ready IAM policies scoped to least privilege for the specific service under review.

Each one is a specialist. None of them overlap. None are deployed unless a production use case demands it.

None of these are microservices. None are deployed runtimes. They are well-defined, testable, composable units of capability I run locally during development.

Each agent persona is structured around:

- **Identity**: What this agent is responsible for, what it knows, how it behaves
- **Skills**: Reusable knowledge modules the agent can apply
- **Tools**: Callable actions the agent can invoke (APIs, MCP tools, Lambda functions)
- **SDLC stage**: Where in the development lifecycle this agent operates

```
Local Development (Claude Code)
│
├── Agentic Architect (Orchestrator)
│   ├── HLD Architect          ──► Skills / Tools
│   ├── Cloud Security         ──► Skills / Tools
│   ├── SDET Engineer          ──► Skills / Tools
│   ├── Defect Manager         ──► Skills / Tools
│   ├── GenAI Engineer         ──► Skills / Tools
│   └── ... more agents        ──► Skills / Tools
│
│   Any agent, when lift criteria met:
│   ──► MCP Facade + OOP ABCs + Terraform + S3 Sync
│       ──► Production (AWS Bedrock AgentCore)
│           ├── AgentCore Runtime
│           ├── Lambda (Skills as Tools)
│           ├── API Gateway
│           └── DynamoDB (State)
```

The local environment gives me something production cannot: speed without consequence. I can iterate on a prompt, reshape a skill, change a tool's behaviour, and retest — all without a deployment pipeline, without CloudWatch logs, without touching live infrastructure. The feedback loop is minutes, not hours.

---

## The Liftability Pattern

The most important design decision I made early: every agent I build locally must be liftable to production without rework.

Liftability is not a deployment script. It is a design discipline applied from day one. An agent is liftable when:

**1. The MCP Facade is in place**
Skills and tools are exposed as MCP (Model Context Protocol — an open standard for tool interoperability across LLM runtimes) endpoints. This interface works identically whether the agent is running locally in Claude Code or as a runtime in Bedrock AgentCore. The agent does not know or care where it is running. That is by design.

**2. The implementation follows OOP ABCs**
Each skill is implemented as a Python class inheriting from a base abstract class. This enforces a consistent interface, makes skills independently testable, and means they slot into AgentCore's tool registration without modification.

**3. Infrastructure is Terraform-first**
Every agent that will eventually be lifted has its Terraform written alongside the code — Lambda function definitions, IAM roles scoped to least privilege, API Gateway routes, DynamoDB tables for state. When lift day comes, `terraform apply` is the deployment.

**4. Artifacts live in S3**
Agent definitions, skill configurations, and prompt templates are stored in S3 — not hardcoded. In production, AgentCore reads from the same S3 paths. Promotion is a bucket sync, not a rewrite.

**5. The agent has been tested end-to-end locally**
This is the gate. Before an agent is considered liftable, it has unit tests for each skill, integration tests through an API proxy (not direct service calls), and a set of golden test cases that validate its end-to-end behaviour on representative inputs.

The lift checklist is not a formality. It is the reason the promotion is low risk when it happens.

![The Liftability Gate — five criteria that must all be true before an agent is promoted to production](/diagrams/liftability-gate.svg)

---

## Skills and Tools: The Real Unit of Capability

Here is the insight that took me longest to articulate clearly: in a production agentic system, the agent is not the unit of capability. The skill is.

An agent is an orchestrator. It decides which skill to apply, in what order, with what inputs. The intelligence of the system lives in how skills are designed, how they compose, and how reliably they execute — not in the agent's decision loop itself.

This has practical consequences:

**Skills are tested in isolation.** Each skill has its own test suite. I can run `pytest skills/defect_lifecycle_management/tests/ -v` without spinning up an agent. The skill either works or it does not. This is the only way to know before production.

**Skills are reusable across agents.** My Cloud Security agent and my Peer Review agent both use the same `IAM_Least_Privilege` skill. Written once, tested once, composed freely. This is not theoretical reuse — it is how the system actually operates.

**Skills define the production surface area.** When I lift an agent to Bedrock AgentCore, what I am deploying is a set of Lambda functions — one per skill — registered as tools. The AgentCore runtime is thin. The Lambda functions are where the real work happens. Scaling, monitoring, and cost governance apply at the skill level, not the agent level.

**New capability means a new skill, not a new agent.** When I need the production agent to do something new, I write a skill, test it locally, and register it as a new tool in AgentCore. The operational surface stays flat even as capability grows.

![Skills as the unit of capability — one skill shared across agents, deployed as a single Lambda in production](/diagrams/skills-unit-of-capability.svg)

---

## The Production Decision: When Does an Agent Get Lifted?

Not every agent earns a production deployment. This is intentional.

The criteria I apply before lifting:

- **Is the use case proven?** Has the agent demonstrated it can handle real inputs, not just the happy path?
- **Is the business need clear?** Is there a user, system, or workflow that requires this agent callable as a REST API?
- **Are the skills stable?** Have the underlying skills been through enough local iteration that core behaviour is settled?
- **Is the infrastructure written?** Is the Terraform ready? IAM policies scoped? Monitoring configured?

When all four are true, the lift is a formality. The deployment is `terraform apply` plus a GitHub Actions workflow already parameterised for the target environment.

My current production agent — the Site Builder agent on Bedrock AgentCore — went through exactly this process. It ran locally for weeks. Skills were tested in isolation and end-to-end. Terraform was written alongside the code. When I lifted it, there were no surprises.

---

## What This Gives You That Shipping Fast Does Not

**A growing library of production-ready agents.** At any point, agents at various stages of local maturity are queued for production — tested, Terraform-ready, waiting for the business case to pull them through.

**Low-risk promotions.** When I lift an agent, I already know it works. Tested locally on real inputs. Tested skills in isolation. Run end-to-end through an API proxy before touching AgentCore. The promotion is a confirmation, not an experiment.

**Cost control where it matters.** One AgentCore runtime with a growing skill set means one set of operational overhead — one monitoring configuration, one deployment pipeline, one cost centre to govern. Each additional lift is a deliberate commitment, not an accident of enthusiasm.

**Faster local iteration.** Because I am not trying to do everything in production, the local environment is unconstrained. A new agent persona can be tried in an afternoon. Skills can be composed in ways not tried before. Experiments that would be disruptive or expensive in production happen safely where they belong.

---

## The Counterintuitive Takeaway

The industry benchmark for agentic maturity right now is fleet size — how many agents deployed, how many tools registered, how many concurrent sessions the platform can handle.

I think this is the wrong metric.

The right metrics are: how reliably does each production agent perform on the use cases it owns, and how quickly can a locally-proven agent be promoted when the business needs it.

Local-first agentic development is not a workaround for teams that cannot afford AgentCore at scale. It is a discipline. Build thoroughly. Test locally. Design for liftability from day one. Promote when the use case earns it.

The agents are ready. Production should always be the easy part.

---

## Key Takeaways

- Managing agents in production is operationally heavier than managing skills and tools — be deliberate about what you lift
- Skills are the real unit of capability — design, test, and deploy at the skill level
- Liftability is a design property, not a deployment script: MCP facade, OOP ABCs, Terraform-first, S3 artifacts, end-to-end tests
- Local-first development absorbs iteration cost so production does not have to
- The lift criteria (proven use case, stable skills, written infrastructure, clear business need) make every promotion low risk
- Fleet size is a vanity metric — reliability per agent and time-to-lift are what matter

---

## What I Am Building Next

Several agents are approaching lift criteria. The pattern — build locally, validate thoroughly, promote when ready — means the pipeline stays full without the production environment paying the cost of immaturity.

When the business need pulls the next one through, the lift will take an afternoon.

That is the point.

---

## References

- [AWS Bedrock AgentCore Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/agents.html)
- [Model Context Protocol (MCP) Specification](https://modelcontextprotocol.io/introduction)
- [What 1,200 Production Deployments Reveal About LLMOps in 2025 — ZenML](https://www.zenml.io/blog/what-1200-production-deployments-reveal-about-llmops-in-2025)
- [MLOps vs LLMOps: What's Different — ZenML](https://www.zenml.io/blog/mlops-vs-llmops)
- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [AWS Well-Architected Framework — Operational Excellence Pillar](https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/welcome.html)
- [Terraform AWS Provider Best Practices](https://docs.aws.amazon.com/prescriptive-guidance/latest/terraform-aws-provider-best-practices/introduction.html)
- [MLOps Engineers 2025: Skills, Salaries and Growth — People in AI](https://www.peopleinai.com/blog/the-job-market-for-mlops-engineers-in-2025)
