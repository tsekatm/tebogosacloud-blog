---
title: "Beyond Text: How We Built an Evaluation Framework for Multi-File AI Outputs"
description: "Most LLM benchmarks evaluate text. We needed to evaluate entire websites. Here's the 4-layer evaluation framework we built to score AI-generated multi-file artifacts using a violation-deduction model."
pubDate: 2026-03-30
category: "GenAI & AI Engineering"
tags: ["ai", "evaluation", "llm", "testing", "software-architecture"]
draft: false
---

Most LLM benchmarks evaluate text. HumanEval checks if a function passes unit tests. SWE-bench measures whether a model can patch a repository. MBPP scores single-function completions.

None of these work when your AI agent generates an entire website.

I run a site builder agent that takes a template, a set of business requirements (brand colours, fonts, content, images, layout), and produces a deployable multi-file artifact: `index.html`, `css/styles.css`, `js/main.js`, and an `assets/` directory. The output isn't a string. It's a folder. And a correct `index.html` paired with broken `styles.css` produces a broken site — even though each file might look reasonable in isolation.

I needed an evaluation framework that could score these outputs the way a QA engineer would: structurally, visually, semantically, and at the code level. Over six days, I built one. It evaluated 467 actions across 5 models, and the results changed how I think about AI code generation.

This article explains the framework.

## Why Existing Benchmarks Don't Work Here

The gap between LLM benchmarks and real-world code generation is wider than it appears.

**HumanEval** tests single functions with pass/fail assertions. There's no partial credit for CSS that's 90% right but produces invisible text on a dark background. **SWE-bench** measures diffs against existing repositories — our agents generate from scratch, not patch. And **MBPP** evaluates isolated snippets with no concept of inter-file dependencies.

What I actually needed to measure fell into five categories: structural integrity (are the right files present?), visual fidelity (does it look correct?), content accuracy (is the business name right in all six locations?), code quality (is the CSS valid and responsive?), and accessibility (can users actually read the text?).

No existing benchmark covers all five for multi-file outputs. So I built a four-layer evaluation stack.

## The 4-Layer Evaluation Stack

Each layer catches a different class of defect. They run in sequence, and their results feed into a unified scoring model.

### Layer 1: Structural Checks

The `FolderComparer` validates the generated file tree against the gold standard. Does `index.html` exist? Is `css/styles.css` present? Are there unexpected files that shouldn't be there?

This layer catches the most fundamental failures. A missing `index.html` is an instant -5.0 deduction — the site literally cannot load. An extra file nobody asked for is a minor -0.25. The structural layer answers one question: did the agent produce the right artifacts?

### Layer 2: Content Checks

The `ContentComparer` parses the generated HTML and validates text content, meta tags, heading hierarchy, alt text, and viewport configuration. It answers: does the content match what was requested?

This layer caught a failure pattern I didn't anticipate. Models paraphrase user-provided content roughly 30% of the time. The requirement says "Farm-fresh flavours, crafted with care" and the model writes "Fresh ingredients from local farms, prepared with dedication." Semantically similar. Functionally wrong. The client gave you exact copy — use it.

### Layer 3: Visual Checks

The `HTMLVisualChecker` analyses HTML and CSS without rendering, catching issues that code review alone misses. It detects broken images (where the `src` attribute contains a description instead of a URL), empty sections, dark text on dark backgrounds, broken navigation layouts, and missing interactivity.

This layer exists because of a specific failure. Early in testing, our LLM judge gave a 9/10 to a page where the hero text was completely invisible — dark grey text (`#333`) on a dark background image. The CSS was syntactically valid. The HTML was well-structured. But the page was unusable. The visual checker now catches contrast violations by analysing CSS colour values against background declarations:

```python
def check_dark_text_on_dark_bg(self) -> list[Violation]:
    """Detect potential dark-on-dark contrast issues from CSS."""
    root_match = re.search(r':root\s*\{([^}]+)\}', self.css)
    if not root_match:
        return violations

    # Extract CSS variables
    vars_dict = {}
    for match in re.finditer(r'(--[\w-]+)\s*:\s*([^;]+);', root_block):
        vars_dict[match.group(1)] = match.group(2).strip()

    text_color = vars_dict.get("--text-color", "").lower()
    has_bg_images = bool(re.search(
        r'background(-image)?\s*:\s*url\(', self.css
    ))

    if has_bg_images and self._is_dark_color(text_color):
        violations.append(Violation(
            id="A11Y-DARK-TEXT-ON-DARK-BG",
            severity=Severity.CRITICAL,
            deduction=-3.0,
            description="Dark text with background images — unreadable",
        ))
```

It also catches image hallucination — a universal failure across all five models we tested. Every model, at some point, writes image descriptions as `src` attributes:

```html
<!-- What the model generates -->
<img src="a modern office building with glass facade and blue sky">

<!-- What it should generate -->
<img src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab">
```

The checker flags any `src` attribute longer than 30 characters containing spaces that doesn't start with `http` — a simple heuristic that catches this pattern reliably.

### Layer 4: LLM Judge

The final layer is a Claude Opus multimodal judge. It receives the source code, the scoring rubric, and the violation catalogue, then returns a structured JSON response identifying every violation it finds.

The judge prompt is specific and constrained:

```
Your job: identify every violation in the agent output by
comparing it against the gold standard and requirements.

Return ONLY a JSON object with this structure:
{
  "violations": [{
    "id": "VIOLATION-ID-FROM-CATALOGUE",
    "severity": "critical|major|moderate|minor",
    "deduction": -N.N,
    "description": "What is wrong",
    "evidence": "Specific line showing the issue"
  }]
}

Rules:
- Use EXACT deduction amounts from the violation catalogue
- Do NOT invent violation IDs
- Do NOT report violations that don't exist
```

Three design decisions matter here. First, the judge identifies violations — it doesn't assign scores. The scoring engine applies fixed deductions. This separation prevents the judge from inflating or deflating scores arbitrarily. Second, the violation IDs are constrained to a catalogue of 22 known types. The judge can't invent new categories. Third, deduction amounts are fixed per violation type. The judge classifies; the scorer calculates.

## The Violation-Deduction Scoring Model

Traditional AI evaluation uses additive scoring: start at 0, add points for what's correct. Our model inverts this.

**Score = 10 - sum(deductions)**

Every action starts at 10 (perfect). Each violation subtracts its fixed deduction. Scores can go negative — and they do. The layout transformation action averages -0.8/10 across all models, meaning models consistently make the page worse than the starting template.

Why deductive scoring? Because a page that's 90% correct but has invisible text is not a 9/10. It's broken. Additive scoring rewards partial completion. Deductive scoring penalises defects proportionally to their impact on the user.

The 22 violation types span seven categories:

| Category | Example Violation | Severity | Deduction |
|----------|------------------|----------|-----------|
| Structural | Missing index.html | Critical | -5.0 |
| Structural | Empty section (no visible content) | Critical | -3.0 |
| Visual | Layout completely broken | Critical | -3.0 |
| Visual | Broken image (description as src) | Critical | -2.5 |
| Content | Missing text from requirements | Critical | -2.0 |
| Content | Content paraphrased, not verbatim | Moderate | -0.5 |
| Code Quality | Local file path instead of URL | Critical | -2.0 |
| Code Quality | No responsive breakpoints | Major | -1.5 |
| Accessibility | Dark text on dark background | Critical | -3.0 |
| Accessibility | Missing alt text | Moderate | -0.5 |
| Interactivity | No mobile menu toggle | Critical | -2.5 |
| Performance | No lazy loading | Minor | -0.25 |

The severity tiers reflect real-world impact. A critical violation (-5.0 to -2.0) makes the site unusable or unprofessional. A major violation (-2.0 to -1.0) degrades the experience noticeably. Minor violations (-0.25) are polish issues that most users won't notice.

## Gold Standards: The Ground Truth Problem

Every evaluation needs ground truth. Ours comes from 21 hand-verified reference templates covering landing pages, SaaS products, corporate sites, event pages, safari lodges, training portals, and more.

Each gold standard includes three stages:

```
gold-standards/
  template-ai-page-builder/
    requirements.md              # Business customisation spec
    stage-1-customise-template/  # Skeleton with spec applied
    stage-2-site-generation/     # Optimised and validated
    stage-3-deployment/          # Deploy config and manifest
```

The `requirements.md` file defines every customisation the agent must apply — brand colours, typography, logo paths, hero text, about section copy, contact details, layout patterns, SEO requirements. Here's a real excerpt:

```markdown
## Brand Amendments

### Colours
- **Primary**: #B85C38
- **Secondary**: #5C3D2E
- **Accent**: #E8D5B7

### Typography
- **Heading Font**: Fraunces
- **Body Font**: Lato

## Content Amendments

### Hero Section
- **Headline**: Seasonal Menus. Local Ingredients.
              Unforgettable Meals.
- **CTA Button**: View Our Menu
```

These references are git-committed, versioned, and human-reviewed. They're not generated — they're hand-built by applying the requirements to each template and verifying every change visually. This matters because the judge compares agent output against these references. If the ground truth is wrong, every score is wrong.

## The Evaluation Pipeline

Putting all four layers together, the orchestrator runs a 16-action pipeline per model per template:

1. Copy the template skeleton to the run directory (baseline)
2. Screenshot the baseline
3. For each of the 16 actions:
   - Send the action instruction to the model
   - Write modified files to the action directory
   - Run the HTMLVisualChecker (Layer 3)
   - Run the Opus judge against the gold standard (Layer 4)
   - Record the ActionScore (10 minus deductions)
4. Aggregate all 16 action scores into a template score (max 160)

The 16 actions cover six categories: brand (colours, fonts, logos, favicon), images (hero background, section backgrounds), content (hero text, about text, contact info), layout (hero layout, sections layout), technical (SEO meta, structured data, accessibility), and quality (contrast verification).

Actions are sequential — each builds on the previous output. This is deliberate. Real agent workflows apply changes incrementally. A colour change affects subsequent image overlay decisions. A font change affects layout spacing. Sequential evaluation captures the compounding effect of errors, which is exactly what happens in production.

## What This Framework Revealed

Over six days, this pipeline processed 467 actions across five models and six templates. The results were clear in some places and surprising in others.

What was clear: structured, well-defined tasks (SEO meta tags, accessibility attributes) score consistently high across all models (8.7-9.4/10 average). These are token-native tasks — key-value pairs and attribute additions that align with how language models process text.

What was surprising: layout transformation — applying CSS grid or flexbox changes to restructure page sections — scored negative on average. Every model, including the best one, made pages worse when asked to transform layouts. This isn't a prompt engineering problem. It's a spatial reasoning gap in current language model architectures.

What was most useful: the violation data drove targeted improvements. Instead of vaguely knowing "the agent sometimes produces bad output," I now know that 60% of font management failures come from a single issue (updating CSS `font-family` but not the Google Fonts `<link>` tag), and that 30% of content failures are verbatim violations (paraphrasing instead of using exact text). These specific failure patterns led to 1,191 lines of skill improvements across six production modules.

## Applicability Beyond Websites

The framework's architecture — structural checks, content checks, visual checks, LLM judge, violation-deduction scoring — isn't website-specific. Any AI system that generates multi-file artifacts can be evaluated this way.

Document generation (reports, presentations, proposals) has the same inter-file dependency problem. Infrastructure-as-code (Terraform modules, CloudFormation templates) has structural requirements and validation rules. Even multi-file code generation (microservice scaffolding, API implementations) benefits from checking whether all the files work together, not just whether each file compiles.

The key insight: evaluating AI-generated artifacts requires evaluating the artifact as a whole, not its parts in isolation. A syntactically valid CSS file paired with an HTML file that references different class names is a broken website. The evaluation framework must understand that relationship.

---

*This is part 1 of a 7-part series documenting how we built an evaluation framework for AI code generators, tested 5 models across 467 real code generation tasks, and turned the results into production improvements.*

*Next: [5 Models, 467 Actions, 1 Winner — What We Learned Comparing LLMs on Real Code Generation](/blog/comparing-llms-real-code-generation)*

*Originally published on [tebogo.cloud](https://tebogo.cloud/blog/beyond-text-evaluating-multi-file-ai-outputs)*
