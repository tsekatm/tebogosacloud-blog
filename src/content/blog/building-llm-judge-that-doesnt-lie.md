---
title: "Building an LLM Judge That Doesn't Lie to You"
description: "Our first LLM judge gave a 9/10 to a page with invisible text. Here's how we fixed it with structural guardrails, multimodal inputs, and a fixed-weight violation catalogue."
pubDate: 2026-03-31
category: "GenAI & AI Engineering"
tags: ["ai", "evaluation", "llm-as-judge", "testing", "quality"]
draft: false
---

Our first LLM judge gave a 9/10 to a page where the hero text was completely invisible.

Dark grey text on a dark background image. The CSS was syntactically valid. The HTML was well-structured. Every tag was correct. The page was unusable. And our judge — Claude Opus, one of the most capable models available — scored it nearly perfect.

That was the moment I realised LLM-as-judge doesn't work out of the box. It requires engineering. This article explains what we built to make it trustworthy.

## The Inflation Problem

The first implementation was simple: send the generated code to Claude Opus, ask it to rate 0–10. The results looked great. Average scores of 8–9/10 across the board. We nearly shipped those numbers.

Then we opened the generated sites in a browser.

Pages with broken images — where the model had written `<img src="a serene mountain landscape with morning fog">` instead of a URL — scored 8/10. Pages with empty sections — where entire content blocks were missing — scored 7/10. Pages where navigation rendered as a bulleted list because `list-style: none` was missing from the CSS — scored 8.5/10.

The judge was systematically generous. Not because it was broken, but because of how LLMs process code.

### Why Judges Inflate

**Positivity bias from RLHF training.** Language models are trained to be helpful, which creates a default toward positive assessment. When asked to evaluate code, the model focuses on what's present rather than what's wrong. Fifteen correct CSS properties and one devastating contrast failure? The judge sees the fifteen.

**Code-level evaluation misses visual defects.** Syntactically valid CSS can produce invisible text. `color: #333` on `background-image: url(dark-photo.jpg)` is perfectly valid CSS and completely unreadable content. A judge that reads code without "seeing" the rendered result can't catch this category of defect.

**Vague rubrics invite generous interpretation.** "Rate the quality of this HTML/CSS from 0–10" gives the judge too much latitude. What does 7 mean? What separates a 6 from an 8? Without concrete criteria, the judge fills in the gaps with optimistic interpretation.

**No calibration anchors.** The judge has no reference for what a 5/10 page looks like versus a 9/10 page. Without anchors, scores cluster at the top of the range because the model has no incentive to be harsh.

## Fix 1: Structural Guardrails

The first mitigation was the `HTMLVisualChecker` — an automated pre-judge validator that catches defects the LLM judge consistently misses.

It runs six checks:

**Broken images.** Scans every `<img>` tag's `src` attribute. If the src contains spaces and doesn't start with `http`, it's flagged — the model wrote a description instead of a URL. Also checks CSS `background-image` declarations for the same pattern.

```python
# Catches: <img src="a modern office with glass facade">
if len(src) > 30 and " " in src and not src.startswith("http"):
    violations.append(Violation(
        id="VIS-BROKEN-IMAGE",
        severity=Severity.CRITICAL,
        deduction=-2.5,
        description=f"Image src contains text instead of URL: '{src[:60]}'",
    ))
```

**Empty sections.** Finds `<section>` and `<div>` elements with IDs or classes that contain no visible text content. An empty hero section means the page loads with a blank area where the headline should be.

**Dark text on dark backgrounds.** Extracts CSS variables from `:root`, identifies the text colour, checks whether background images are present, and flags when dark text is used without a light alternative. This is the check that caught the 9/10 invisible text page.

**Broken navigation.** Detects when a `<nav>` element contains `<ul>/<li>` markup but the CSS doesn't include `list-style: none` or flexbox layout — meaning the navigation renders as a bulleted list instead of a horizontal menu.

**Missing interactivity.** Checks for the presence of JavaScript, mobile menu toggles, smooth scrolling, and hover states. A page with interactive HTML elements but no JavaScript to make them work is functionally broken.

**Local file paths.** Flags `src` attributes pointing to filesystem paths (`/Users/...`, `C:\...`, relative paths without extensions) that won't work in a browser.

These checks don't replace the judge — they constrain it. If the HTMLVisualChecker finds a critical violation (broken images, empty sections, invisible text), that violation is recorded regardless of what the judge thinks. The judge can still evaluate the nuances of code quality and content accuracy, but it can't override a structural failure.

The analogy: unit tests don't replace code review, but they catch the obvious regressions before a human ever looks at the code.

## Fix 2: Multimodal Judging

The second fix was sending the judge more than just code.

Code-only judging fails because CSS is a spatial language encoded as text. `grid-template-columns: 1fr 2fr 1fr` creates a three-column layout, but you can't verify it's correct without rendering it. `rgba(0, 0, 0, 0.7)` overlay on a hero image makes text readable, but the judge can't know the overlay is sufficient without seeing the result.

Our judge input bundle now includes:

- Full HTML source code
- Full CSS source code
- The scoring rubric with violation catalogue
- Gold standard HTML/CSS for comparison

The judge compares agent output against the gold standard at both the code level and the structural level. It can see whether the agent's CSS variables match the requirements AND whether the agent's HTML structure preserves all sections from the template.

In future rounds, we plan to add desktop and mobile screenshots to the bundle, making the judge truly multimodal — evaluating the rendered visual output alongside the source code.

## Fix 3: The Violation Catalogue as Rubric

The third fix was the most impactful. Instead of asking the judge for a score, we ask it to identify specific violations from a fixed catalogue.

The catalogue defines 22 violation types, each with a unique ID, severity level, and fixed deduction amount:

```yaml
- id: A11Y-DARK-TEXT-ON-DARK-BG
  description: Dark text on dark background (unreadable)
  severity: critical
  deduction: -3.0

- id: VIS-BROKEN-IMAGE
  description: Image shows alt text or broken placeholder
  severity: critical
  deduction: -2.5

- id: CONTENT-PARAPHRASED
  description: Content paraphrased instead of exact text
  severity: moderate
  deduction: -0.5
```

The judge prompt is explicit about what's expected:

```
Your job: identify every violation in the agent output by
comparing it against the gold standard and requirements.

Return ONLY a JSON object with violations from the catalogue.

Rules:
- Use EXACT deduction amounts from the violation catalogue
- Do NOT invent violation IDs — use only IDs from the catalogue
- Do NOT report violations that don't exist
- Focus ONLY on the specific action being evaluated
```

The judge returns structured JSON — not prose, not a score:

```json
{
  "violations": [
    {
      "id": "VIS-BROKEN-IMAGE",
      "severity": "critical",
      "deduction": -2.5,
      "description": "Hero image src contains description, not URL",
      "evidence": "<img src=\"a serene landscape with mountains\">"
    },
    {
      "id": "CONTENT-PARAPHRASED",
      "severity": "moderate",
      "deduction": -0.5,
      "description": "About section text reworded from requirements",
      "evidence": "Requirements: 'Farm-fresh flavours' → Output: 'Fresh local ingredients'"
    }
  ],
  "summary": "Hero image broken, about text paraphrased",
  "strengths": ["Correct colour variables", "All sections present"],
  "critical_issues": ["Unusable hero — no visible image"]
}
```

This separation of concerns is the key design decision. The judge does **classification** — which violations are present? The scoring engine does **arithmetic** — sum the deductions, subtract from 10. The judge cannot inflate scores because it never assigns scores. It identifies problems. The math is deterministic.

## How the Three Fixes Work Together

The evaluation pipeline runs in sequence:

```
1. HTMLVisualChecker    → catches structural/visual defects
2. Opus Judge           → identifies violations from catalogue
3. Scoring Engine       → 10 minus sum(all deductions)
```

The HTMLVisualChecker catches what the judge misses (broken images, contrast issues, empty sections). The judge catches what the checker can't evaluate (content accuracy, code quality nuances, whether the business name appears in all six required locations). The scoring engine applies fixed deductions from both sources.

Before these fixes, the same page with invisible text scored 9/10. After: the HTMLVisualChecker flags `A11Y-DARK-TEXT-ON-DARK-BG` (-3.0), the judge identifies `VIS-BROKEN-IMAGE` on the hero (-2.5) and `CONTENT-PARAPHRASED` on the about section (-0.5). Final score: 4.0/10.

That 4.0 is honest. The page has serious problems. The old 9.0 was a lie.

## What We Learned About Judge Design

### Constrain the output format

Free-text evaluation ("rate this code 0–10") produces inflated, inconsistent scores. Structured output with predefined violation types produces consistent, auditable results. The judge's job is classification, not scoring.

### Separate detection from scoring

When the judge both finds problems and assigns scores, it conflates two tasks and does both poorly. When the judge only identifies violations and a deterministic engine applies fixed deductions, scores are reproducible and explainable.

### Use structural checks as guardrails

LLM judges have blind spots. They read code as text and miss spatial defects. Automated structural checks catch the class of defects that LLMs consistently miss — and they run in milliseconds, not minutes.

### Fixed-weight violations beat subjective assessment

Is a purple gradient better than a blue solid? The judge has opinions, but they're not universal. But a missing mobile menu toggle (-2.5) is objectively a defect. Fixed weights for objective violations eliminate the subjectivity that causes score inflation.

## Known Limitations

We fixed inflation, but the judge isn't perfect. Here's what remains:

**Single judge bias.** Only Claude Opus evaluates. It may favour Claude-generated code — similar patterns, similar token distributions. We haven't tested with a second judge model. Round 2 will score a subset with an independent judge and compute Cohen's kappa for inter-rater agreement.

**No inter-rater calibration.** We don't know whether our scores are "right" in an absolute sense. We know they're consistent and that they correlate with visible defects. But a human QA review of a random sample would establish whether our 4/10 matches a human's assessment of quality.

**Aesthetic subjectivity.** The violation catalogue covers functional defects (broken images, missing content, contrast failures) but not aesthetic quality. Two pages can score identically — both have correct structure, content, and accessibility — while one looks significantly more professional. We don't measure that.

**Measurement asymmetry from Round 1.** Sonnet's gold standard scores (93.4%) were measured differently from alternative models' pipeline scores (59–68%). This doesn't affect the judge's per-action scoring, but it affects the aggregate comparison. Round 2 fixes this by running all models through the same pipeline.

## Principles for LLM-as-Judge

If you're building an LLM judge for any evaluation task — not just code generation — three principles apply:

**1. Structural guardrails before LLM evaluation.** Catch the obvious defects with deterministic checks before the LLM judge runs. This prevents the judge from rationalising broken output.

**2. Constrained violation catalogues over open-ended scoring.** Define the defects you care about, assign fixed weights, and ask the judge to classify — not score. You get consistent, auditable, explainable results.

**3. The judge is only as good as its rubric.** Invest in the rubric. A 22-violation catalogue with severity tiers and fixed deductions took more design effort than the judge prompt itself. The catalogue IS the evaluation — the judge is just the executor.

LLM judges are powerful. They're also unreliable by default. The engineering isn't in the model — it's in the constraints you build around it.

---

*This is part 3 of a 7-part series documenting how we built an evaluation framework for AI code generators, tested 5 models across 467 real code generation tasks, and turned the results into production improvements.*

*Previous: [5 Models, 467 Actions, 1 Winner](/blog/comparing-llms-real-code-generation)*
*Next: [The $0.07 vs $1.05 Question — Cost-Quality Tradeoffs](/blog/cost-quality-tradeoffs-ai-code-generation)*

*Originally published on [tebogo.cloud](https://tebogo.cloud/blog/building-llm-judge-that-doesnt-lie)*
