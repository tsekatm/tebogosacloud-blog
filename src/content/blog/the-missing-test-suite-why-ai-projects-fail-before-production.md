---
title: "The Missing Test Suite: Why AI Projects Fail Before Production"
description: "Most AI projects never reach production. The missing piece is prompt testing — with the same rigour as TDD. Here's the strategy for shipping AI systems that actually work."
pubDate: 2026-04-02
category: "GenAI & AI Engineering"
tags: ["ai", "testing", "software-engineering", "prompt-engineering", "tdd"]
draft: false
---

*Most AI projects never ship. The gap isn't the model — it's the lack of testability.*

---

## The Uncomfortable Truth

Gartner predicted that through 2022, 85% of AI projects would deliver erroneous outcomes due to bias in data, algorithms, or the teams managing them [1]. VentureBeat reported that 87% of data science projects never make it into production [2]. McKinsey's 2023 State of AI report confirmed that while generative AI adoption is accelerating, most organisations still struggle to move beyond experimentation [3].

Teams build impressive demos, stakeholders nod approvingly, and then the project quietly stalls somewhere between "it works on my laptop" and "it's running in production."

The usual suspects get blamed: data quality, model performance, organisational readiness. But there is a more fundamental problem hiding in plain sight — most teams have no idea how to test AI systems with the same rigour they apply to traditional software. Google's seminal paper on hidden technical debt in machine learning systems identified testing gaps as a primary source of production failures, noting that ML systems have a special capacity for incurring technical debt because they have all the maintenance problems of traditional code plus an additional set of ML-specific issues [4].

They test the code. They don't test the intelligence.

## Two Systems, Two Test Suites

A production AI system is not one system. It is two systems woven together: deterministic software (APIs, data pipelines, orchestration logic) and non-deterministic AI behaviour (prompt responses, agent decisions, model outputs).

![Two Systems Two Test Suites](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/x4e1wkp8llqrjyptdlyk.png)

Most engineering teams are excellent at testing the first. They write unit tests, integration tests, and end-to-end tests. They practice TDD. They run CI pipelines that block merges on test failures. This is mature, well-understood discipline.

But the AI layer — the prompts, the agent behaviour, the model responses — gets treated as a black box. Teams eyeball a few outputs, declare it "good enough," and move on. There is no test suite. There is no regression safety net. There is no way to know if a prompt change that improved one scenario just broke twelve others.

Google's ML Test Score rubric [5] proposes a structured assessment of ML production readiness across data tests, model tests, infrastructure tests, and monitoring — yet most teams score poorly on all four dimensions. Microsoft Research's study of software engineering for machine learning found that even within large technology companies, testing practices for ML systems remain significantly less mature than those for traditional software [6].

This is the missing test suite. And it is the single biggest reason AI projects fail to reach production.

## Prompt Test Cases as First-Class Citizens

If you would not ship a function without a unit test, you should not ship a prompt without a prompt test case.

A prompt test case is structurally similar to a traditional test: given an input, assert something about the output. The difference is that the assertion must account for non-determinism. You are not checking for exact string equality. You are evaluating whether the output meets defined criteria — relevance, completeness, format compliance, safety, and factual accuracy.

Ribeiro et al.'s CheckList framework [7] — which won Best Paper at ACL 2020 — demonstrated that traditional software testing methodologies can be directly applied to NLP models. CheckList introduces three test types that map cleanly to prompt testing: Minimum Functionality Tests (happy path), Invariance Tests (the model should produce equivalent outputs for equivalent inputs), and Directional Expectation Tests (changing the input in a specific way should change the output in a predictable direction).

![Prompt Test Case Structure](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/zo5grjn5f7oo3z085i61.png)

### Happy Path

Happy path prompt tests verify that the AI produces the expected output when given a well-formed, unambiguous input. These are your baseline. If these fail, nothing else matters.

Examples of happy path assertions:

- Given a clear instruction, the agent produces a response that addresses all specified requirements
- Given structured input data, the agent formats its output according to the defined schema
- Given a multi-step task, the agent completes each step in the correct sequence

Happy path tests seem obvious, but most teams skip them. They assume that because the prompt "worked when they tried it," it will always work. It will not. Model updates, context changes, and subtle input variations all introduce drift.

### Negative Scenarios

Negative prompt tests verify that the AI fails gracefully when given problematic input. This is where most unshipped AI projects have their fatal flaw — they only ever tested the golden path.

Perez et al. demonstrated that language models can be used to systematically red-team other language models, generating adversarial inputs that expose failure modes at scale [8]. The same principle applies to prompt testing — you can and should systematically probe for failures.

Test for:

- **Contradictory instructions**: "Summarise this document in detail but keep it under 10 words." Does the agent flag the contradiction, or does it silently produce garbage?
- **Out-of-scope requests**: When asked to perform a task outside its defined capabilities, does the agent refuse clearly, or does it hallucinate an answer?
- **Adversarial input**: Prompt injection attempts, instructions disguised as data, requests to ignore system prompts. Does the agent hold its boundaries?
- **Missing context**: When critical information is absent from the input, does the agent ask for clarification, or does it fabricate what it doesn't know?

Negative scenarios reveal the failure modes that will surface in production, because real users do not read your documentation and do not provide clean inputs.

### Edge Cases

Edge case prompt tests probe the boundaries of agent behaviour. These are the scenarios that don't fit neatly into "it works" or "it's broken" — they live in the grey zone where AI systems are most unpredictable.

Test for:

- **Context window boundaries**: What happens when the input is near the maximum token limit? Does output quality degrade? Does critical information from early in the context get lost?
- **Multi-turn drift**: Over a long conversation, does the agent maintain consistency with its earlier responses, or does it contradict itself?
- **Ambiguous inputs**: When a request has multiple valid interpretations, does the agent pick one and commit, or does it hedge uselessly?
- **Format edge cases**: Empty strings, single-character inputs, inputs in unexpected languages, inputs with special characters or code snippets embedded in natural language
- **Hallucination triggers**: Inputs that are factually adjacent to the agent's knowledge but require information it does not have. Does it admit uncertainty, or does it confabulate?

Edge case tests are expensive to design but cheap compared to a production incident where your AI agent confidently gives a user dangerously wrong information. The NIST AI Risk Management Framework explicitly identifies "the propensity for generative AI to produce confidently stated but incorrect outputs" as a key risk requiring systematic mitigation [9].

## Designing Prompt Test Permutations

Systematic test design is not a new discipline. Software testing has mature techniques — codified in ISO/IEC 29119 [10] — for generating meaningful test cases without combinatorial explosion. Part 11 of this standard, published in 2020, specifically extends these techniques to AI-based systems [11]. The same approaches apply to prompt testing — they just need to be adapted for non-deterministic outputs.

![Test Design Techniques Applied to Prompts](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/vy8dlvk1acrg3vtubkft.png)

### Equivalence Partitioning for Prompts

Divide your input space into classes that you expect the AI to handle similarly. Instead of testing every possible phrasing of a request, identify the equivalence classes:

- Short, direct instructions vs. long, detailed instructions
- Technical language vs. conversational language
- Single-task requests vs. compound multi-task requests
- Inputs with complete context vs. inputs with partial context

Test one representative from each class. If the AI handles one member of the class correctly, it is likely to handle the others. Ribeiro et al. validated this approach empirically, showing that equivalence-class-based testing surfaces model failures far more efficiently than random sampling [7].

### Boundary Value Analysis for Prompts

Identify the thresholds where agent behaviour changes:

- The input length at which output quality begins to degrade
- The number of instructions in a single prompt before the agent starts dropping tasks
- The level of ambiguity at which the agent switches from executing to asking for clarification
- The complexity threshold beyond which the agent starts making errors

Test inputs at, just below, and just above each boundary.

### Decision Table Testing

For agents with conditional behaviour — different responses based on user role, input type, or context state — build a decision table. Map every combination of conditions to the expected action. Then write a test case for each row.

This is particularly critical for agents that make routing decisions, apply business rules, or enforce access controls. A missed condition in a decision table is a production bug waiting to happen.

## The Prompt Regression Problem

Here is the scenario that kills AI projects in the transition from prototype to production:

A developer changes a prompt to fix a reported issue. The fix works. The specific scenario that was broken now produces the correct output. The developer commits the change, satisfied.

What the developer does not know is that the prompt change also altered the agent's behaviour on fourteen other scenarios — three of which are now producing incorrect outputs. Nobody finds out until users report problems. By then, confidence in the system is damaged and the project loses momentum.

This is the prompt regression problem, and it is solved the same way code regression is solved: with an automated test suite that runs on every change.

### Building a Prompt Regression Harness

![Prompt Regression Harness](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/vlwlje1yc8r1cad3pfmm.png)

A prompt regression harness consists of:

1. **A corpus of test cases**: Input-output pairs covering happy paths, negative scenarios, and edge cases. Start with 20-30 and grow it continuously.
2. **Evaluation criteria**: For each test case, define what "correct" means. This might be a rubric (scores 1-5 on relevance, accuracy, completeness), a set of required elements (must mention X, must not mention Y), or a format check (valid JSON, under 200 words).
3. **Automated evaluation**: Use a combination of deterministic checks (format validation, keyword presence) and LLM-as-judge evaluation (a second model scoring the output against the rubric). Zheng et al.'s research on MT-Bench demonstrated that LLM-as-judge approaches can achieve high agreement with human evaluators when properly calibrated [12], though Shankar et al. caution that validator alignment with human preferences must itself be verified [13]. Neither approach alone is sufficient. Together, they provide reasonable coverage.
4. **CI integration**: Run the harness on every prompt change, just as you run unit tests on every code change. Block merges that cause regression.

The harness does not need to be perfect. It needs to be better than nothing — which is what most teams have today. Frameworks such as Stanford's HELM [14] and open-source tools like OpenAI Evals [15] and DeepEval [16] provide starting points for building evaluation infrastructure.

## Strategy: From POC to Production

Testing is the foundation, but shipping an AI system to production requires a broader strategy. Google's MLOps maturity model [17] describes three levels of automation — from manual ML pipelines (Level 0) to fully automated CI/CD/CT pipelines (Level 2). Most AI projects are stuck at Level 0. These are the practices that move you forward.

![The 7 Practices POC to Production](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/c9cbzbqwg1z7c2a9h6v6.png)

### 1. Define Testability From Day One

Before writing a single prompt, define how you will test the AI's behaviour. If you cannot articulate what "correct" looks like for a given input, you are not ready to build. Testability is a design constraint, not an afterthought. The NIST AI RMF [9] frames this as "measuring" — one of four core functions alongside governing, mapping, and managing AI risk.

### 2. Version Your Prompts Like Code

Prompts are code. Store them in version control. Tag releases. Write changelogs. If you cannot diff two versions of a prompt and understand what changed and why, you have lost control of your system. White et al.'s prompt pattern catalogue [18] demonstrates that prompts can be documented and structured with the same rigour as software design patterns.

### 3. Build Evaluation Into the Pipeline

Do not evaluate AI output manually and sporadically. Build evaluation into your CI/CD pipeline. Every pull request that touches a prompt should trigger the test harness. Results should be visible in the PR review, just like test results. Kreuzberger et al.'s systematic review of MLOps architectures [19] confirms that continuous evaluation is a defining characteristic of production-grade ML systems.

### 4. Instrument for Observability

In production, you need to see what the AI is doing. Log inputs, outputs, latency, token usage, and evaluation scores. Build dashboards. Set alerts on quality degradation. You cannot improve what you cannot measure, and you cannot debug what you cannot observe. Klaise et al. detail practical approaches to monitoring ML models in production, including detecting data drift and concept drift before they degrade output quality [20].

### 5. Implement Human-in-the-Loop Gates

Not every AI decision should be autonomous from day one. Identify high-stakes decisions and route them through human review. As confidence grows and the test suite matures, progressively expand the automation boundary. This is not a concession — it is a deployment strategy. Mosqueira-Rey et al.'s comprehensive survey of human-in-the-loop machine learning [21] demonstrates that the most successful production AI systems are designed with human oversight as an integral component, not bolted on as an afterthought.

### 6. Plan for Model Changes

Models get updated. APIs change. Behaviour shifts. Your test suite is your safety net during model migrations. Teams that have one can upgrade models in an afternoon with confidence. Teams that don't spend weeks manually validating and still miss regressions. The EU AI Act [22] now mandates ongoing testing and monitoring for high-risk AI systems — model migration without regression testing is not just risky engineering, it is increasingly a compliance liability.

### 7. Treat Prompt Engineering as Software Engineering

The teams that ship AI to production are the teams that apply software engineering discipline to prompt development. They review prompts in pull requests. They write tests. They track regressions. They refactor. They don't treat prompts as magic incantations — they treat them as code that happens to be written in natural language. Reynolds and McDonell's early work on prompt programming [23] laid the conceptual foundation for this approach, framing prompt design as a form of programming rather than an art.

## Closing

The AI industry has a completion problem, not a capability problem. The models are powerful enough. The tooling is mature enough. What is missing is the engineering discipline to make AI systems production-grade.

If you would not ship code without tests, do not ship prompts without them. If you would not deploy a function without observability, do not deploy an agent without it. If you would not merge a code change without regression checks, do not merge a prompt change without them.

The test suite your AI project is missing is the one that tests the AI itself. Build it, and you build the bridge from demo to production.

---

*Testing AI is not a new discipline — it is the old discipline of software testing, applied to a new kind of system. The teams that recognise this will ship. The rest will keep building impressive demos that never leave the lab.*

---

## References

[1] Gartner, "Gartner Predicts: AI and the Future of Work," Gartner Research, 2019.

[2] VentureBeat, "Why do 87% of data science projects never make it into production?" VentureBeat, July 2019.

[3] McKinsey & Company, "The state of AI in 2023: Generative AI's breakout year," McKinsey Global Institute, 2023.

[4] D. Sculley, G. Holt, D. Golovin, E. Davydov, T. Phillips, et al., "Hidden Technical Debt in Machine Learning Systems," *NeurIPS*, 2015.

[5] E. Breck, S. Cai, E. Nielsen, M. Salib, and D. Sculley, "The ML Test Score: A Rubric for ML Production Readiness and Technical Debt," *IEEE International Conference on Big Data*, 2017.

[6] S. Amershi, A. Begel, C. Bird, R. DeLine, H. Gall, E. Kamar, N. Nagappan, B. Nushi, and T. Zimmermann, "Software Engineering for Machine Learning: A Case Study," *ICSE*, 2019.

[7] M. T. Ribeiro, T. Wu, C. Guestrin, and S. Singh, "Beyond Accuracy: Behavioral Testing of NLP Models with CheckList," *ACL*, 2020. (Best Paper Award).

[8] E. Perez, S. Ringer, K. Lukosiute, K. Nguyen, E. Chen, et al., "Red Teaming Language Models with Language Models," *EMNLP*, 2022.

[9] National Institute of Standards and Technology, "Artificial Intelligence Risk Management Framework (AI RMF 1.0)," NIST AI 100-1, January 2023.

[10] International Organization for Standardization, "ISO/IEC 29119: Software and systems engineering — Software testing," ISO/IEC, 2013-2022.

[11] International Organization for Standardization, "ISO/IEC TR 29119-11:2020: Software testing — Part 11: Guidelines on the testing of AI-based systems," ISO/IEC, 2020.

[12] L. Zheng, W.-L. Chiang, Y. Sheng, et al., "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena," *NeurIPS*, 2023.

[13] S. Shankar, J. D. Zamfirescu-Pereira, B. Hartmann, A. Parameswaran, and I. Arawjo, "Who Validates the Validators? Aligning LLM-Assisted Evaluation of LLM Outputs with Human Preferences," 2024.

[14] P. Liang, R. Bommasani, T. Lee, et al., "Holistic Evaluation of Language Models (HELM)," *Transactions on Machine Learning Research*, 2022.

[15] OpenAI, "Evals: A framework for evaluating LLMs and LLM systems," GitHub, 2023.

[16] Confident AI, "DeepEval: The open-source LLM evaluation framework," GitHub, 2023.

[17] Google Cloud, "MLOps: Continuous delivery and automation pipelines in machine learning," Google Cloud Architecture Center, 2023.

[18] J. White, Q. Fu, S. Hays, et al., "A Prompt Pattern Catalog to Enhance Prompt Engineering with ChatGPT," arXiv:2302.11382, 2023.

[19] D. Kreuzberger, N. Kuhl, and S. Hirschl, "Machine Learning Operations (MLOps): Overview, Definition, and Architecture," *IEEE Access*, vol. 11, 2023.

[20] J. Klaise, A. Van Looveren, G. Vacanti, and A. Coca, "Monitoring Machine Learning Models in Production," arXiv:2007.06299, 2021.

[21] E. Mosqueira-Rey, E. Hernandez-Pereira, D. Alonso-Rios, J. Bobes-Bascaran, and A. Fernandez-Leal, "Human-in-the-loop machine learning: a state of the art," *Artificial Intelligence Review*, Springer, 2023.

[22] European Parliament, "Regulation (EU) 2024/1689 — Artificial Intelligence Act," *Official Journal of the European Union*, 2024.

[23] L. Reynolds and K. McDonell, "Prompt Programming for Large Language Models: Beyond the Few-Shot Paradigm," *CHI 2021 Extended Abstracts*, 2021.
