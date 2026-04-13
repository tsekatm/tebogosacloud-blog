---
title: "5 Models, 467 Actions, 1 Winner — What We Learned Comparing LLMs on Real Code Generation"
description: "We tested Claude Sonnet, Kimi K2.5, Claude Haiku, DeepSeek V3.2, and DeepSeek R1 on the same 16-action website generation pipeline. The results weren't what we expected."
pubDate: 2026-03-30
category: "GenAI & AI Engineering"
tags: ["ai", "llm", "claude", "deepseek", "benchmarks"]
draft: false
---

We tested five AI models on the same task 467 times. Each run produced a complete deployable website — not a code snippet, not a function, not a patch. A real site with HTML, CSS, JavaScript, and assets.

The question: can cheaper models match Claude Sonnet for production code generation?

The short answer is no. The longer answer is more interesting.

## The Models

Five models, spanning a 15x cost range:

| Model | Provider | Input/1M Tokens | Output/1M Tokens | Why We Tested It |
|-------|----------|----------------|-----------------|-----------------|
| Claude Sonnet 4.6 | OpenRouter | $3.00 | $15.00 | Assumed gold standard |
| Claude Haiku 4.5 | OpenRouter/CLI | $1.00 | $5.00 | Same family, lower tier |
| Kimi K2.5 | OpenRouter | $0.42 | $2.20 | Moonshot AI's latest |
| DeepSeek V3.2 | OpenRouter | $0.26 | $0.38 | Budget option |
| DeepSeek R1 | OpenRouter | $0.70 | $2.50 | Reasoning-focused |

These five represent distinct price tiers and architectural approaches. Sonnet and Haiku share a lineage. Kimi is multimodal. DeepSeek V3.2 optimises for cost. R1 optimises for step-by-step reasoning.

## The 16-Action Pipeline

Each model received the same template skeleton and business requirements, then applied 16 sequential actions:

| # | Action | Category |
|---|--------|----------|
| 1 | apply-colours | Brand |
| 2 | swap-fonts | Brand |
| 3 | replace-header-logo | Brand |
| 4 | replace-footer-logo | Brand |
| 5 | replace-favicon | Brand |
| 6 | replace-hero-bg | Images |
| 7 | replace-section-bgs | Images |
| 8 | update-hero-text | Content |
| 9 | update-about-text | Content |
| 10 | update-contact | Content |
| 11 | apply-hero-layout | Layout |
| 12 | apply-sections-layout | Layout |
| 13 | add-seo-meta | Technical |
| 14 | add-structured-data | Technical |
| 15 | add-accessibility | Technical |
| 16 | verify-contrast | Quality |

Same requirements spec, same gold standard, same judge for all models. Each action scored 0–10 using a violation-deduction model (see [Part 1](/blog/beyond-text-evaluating-multi-file-ai-outputs)). Maximum possible: 160 points.

Actions are sequential — each builds on the previous output. Errors compound. This is deliberate: it mirrors how agents work in production.

## The Results

| Model | Avg Score | 95% CI | % of Max | Std Dev | Runs |
|-------|-----------|--------|----------|---------|------|
| **Claude Sonnet 4.6** | **149.5** | N/A† | **93.4%** | 0.0† | 21 |
| Kimi K2.5 | 108.2 | [92.7, 123.7] | 67.6% | 20.1 | 9 |
| Claude Haiku 4.5 | 107.7 | [91.0, 124.4] | 67.3% | 13.4 | 5 |
| DeepSeek V3.2 | 94.0 | [78.0, 110.0] | 58.8% | 28.9 | 15 |
| DeepSeek R1 | 41.9 | N/A (n=2) | 26.2% | 3.3 | 2 |

```
Sonnet 4.6:    ████████████████████████████████████████████████████████ 149.5 (93%)
Kimi K2.5:     ████████████████████████████████████████                108.2 (68%)  ±15.5
Claude Haiku:  ████████████████████████████████████████                107.7 (67%)  ±16.7
DeepSeek V3.2: ██████████████████████████████████                       94.0 (59%)  ±16.0
DeepSeek R1:   ███████████████                                          41.9 (26%)  n=2
               |---------|---------|---------|---------|---------|
               0        30        60        90       120       150
```

### The Honesty Moment

Before interpreting these rankings, three caveats:

**Sonnet was measured differently.** Its 149.5 score comes from gold standard evaluation (automated quality signals against 21 templates), not the same 16-action pipeline as the alternatives. The 41-point gap between Sonnet and the field may be partly methodological. We're fixing this in Round 2.

**Rankings 2–4 are noise.** Kimi's confidence interval is [93, 124]. Haiku's is [91, 124]. DeepSeek V3.2's is [78, 110]. These overlap heavily. With current sample sizes, we cannot say which of these three is genuinely better. What we CAN say: all three cluster around 59–68% of max, well below Sonnet's 93%.

**Sample sizes are small.** 2–15 runs per model. We need n≥16 for 80% statistical power to detect a 20-point difference. The rankings are directionally useful but not statistically conclusive for the middle tier.

## Per-Template Performance

| Template | Sonnet | Kimi | Haiku | DeepSeek V3.2 | Best Alt % of Sonnet |
|----------|--------|------|-------|---------------|---------------------|
| AI Page Builder (SaaS) | 149.5 | 134.8 | 124.2 | 99.5 | 90.2% |
| Association Corporate | 149.5 | 126.0 | 120.2 | 105.5 | 84.3% |
| Safari Lodge | 149.5 | — | 108.2 | 120.5 | 80.6% |
| SaaS Product | 149.5 | 112.0 | 89.5 | 112.0 | 74.9% |
| Gala Event | 149.5 | 98.8 | 96.0 | 86.8 | 66.1% |

The AI Page Builder template is the closest contest — Kimi reaches 90.2% of Sonnet's quality. The Gala Event template is the widest gap at 66.1%. Template complexity matters: simpler structures with fewer sections are easier for all models.

## Action Difficulty: What's Easy and What's Impossible

This is where the data gets interesting. Not all 16 actions are created equal:

| Rank | Action | Avg Score | Category |
|------|--------|-----------|----------|
| 1 | add-accessibility | 9.4/10 | Technical |
| 2 | add-seo-meta | 9.2/10 | Technical |
| 3 | update-about-text | 8.8/10 | Content |
| 4 | replace-favicon | 8.6/10 | Content |
| ... | ... | ... | ... |
| 14 | apply-colours | 5.2/10 | Brand |
| 15 | apply-hero-layout | 2.8/10 | Layout |
| **16** | **apply-sections-layout** | **-0.8/10** | **Layout** |

The pattern is clear when you group by category:

| Category | Avg Score | Observation |
|----------|-----------|-------------|
| Technical (SEO, a11y, schema) | 8.7/10 | Models follow structured specs reliably |
| Content (text updates) | 7.7/10 | Good when verbatim rules enforced |
| Brand (colours, fonts, logos) | 6.8/10 | Moderate — CSS variable application is fragile |
| Images (hero, section bgs) | 6.2/10 | All models hallucinate descriptions as src |
| Layout (hero, sections) | 1.0/10 | Consistently catastrophic |

Structured, well-defined tasks score high. Spatial, visual tasks score low. Same models, wildly different results depending on task type.

## The Gap Analysis: Where Alternatives Fall Behind

Comparing each action against Sonnet reveals where the quality gap actually lives:

| Action | Sonnet | Kimi | Haiku | DS-V3 | Avg Gap |
|--------|--------|------|-------|-------|---------|
| add-accessibility | 9.5 | 9.6 | 9.8 | 9.2 | **+0.0** |
| replace-favicon | 9.0 | 9.0 | 8.8 | 8.4 | **-0.3** |
| add-seo-meta | 10.0 | 9.4 | 9.6 | 9.0 | **-0.7** |
| ... | | | | | |
| apply-colours | 9.5 | 6.2 | 5.8 | 6.5 | **-3.3** |
| apply-hero-layout | 9.0 | 4.7 | 3.2 | 2.8 | **-5.4** |
| apply-sections-layout | 9.0 | 1.6 | -3.8 | -1.5 | **-10.2** |

Three actions account for most of the quality gap:

1. **apply-sections-layout** (-10.2 point gap) — alternatives actively break layouts. Haiku scores -3.8 on average, meaning it makes pages significantly worse.
2. **apply-hero-layout** (-5.4 point gap) — layout transformation is fundamentally hard for all models below Sonnet.
3. **apply-colours** (-3.3 point gap) — CSS variable propagation is inconsistent. Models update some variables but miss gradients, overlays, and header tints.

Three actions show essentially zero gap:

1. **add-accessibility** (+0.0) — every model follows accessibility specs equally well.
2. **replace-favicon** (-0.3) — simple file replacement.
3. **add-seo-meta** (-0.7) — structured metadata is a universal strength.

This has a practical implication: if you could route easy tasks to cheap models and hard tasks to Sonnet, you could potentially cut costs without cutting quality on the tasks that matter. More on this in [Part 4](/blog/cost-quality-tradeoffs-ai-code-generation).

## The Action Heatmap

Here's every model scored on every action — the full picture:

```
                    Kimi  Haiku  DS-V3  DS-R1
add-accessibility   9.6   9.8    9.2    8.1
add-seo-meta        9.4   9.6    9.0    6.8
update-about-text   9.2   8.8    8.6    0.6
replace-favicon     9.0   8.8    8.4    6.0
replace-header-logo 8.2   9.2    7.4    4.8
add-structured-data 7.8   8.8    7.0    5.1
update-hero-text    7.6   7.7    7.2    1.6
update-contact      7.4   7.6    7.0   -1.2
swap-fonts          7.6   7.0    6.8    2.1
replace-hero-bg     7.3   6.2    6.5    2.8
verify-contrast     6.4   7.8    5.8    4.8
replace-section-bgs 7.6   2.4    5.5    3.0
replace-footer-logo 6.0   8.6    4.8    2.0
apply-colours       6.2   5.8    6.5    0.2
apply-hero-layout   4.7   3.2    2.8   -3.9
apply-sections-lyt  1.6  -3.8   -1.5   -2.5
```

Notice DeepSeek R1's column. It scores -1.2 on contact updates and -3.9 on hero layout. These aren't just bad scores — they mean the model made the page actively worse than the starting template on basic tasks.

## The Reasoning Model Trap

DeepSeek R1 scored 26.2% — worse than any other model by a wide margin. On two runs, it averaged 41.9/160. For context, a score of 41.9 means the model successfully completed roughly 4 of 16 actions and actively damaged several others.

Why? R1 is a reasoning model. It's optimised for step-by-step logical deduction — mathematical proofs, multi-hop reasoning, chain-of-thought problem solving. Code generation is not reasoning. It's pattern completion with spatial awareness.

R1 spent tokens "thinking" about CSS instead of writing it. Its chain-of-thought preambles consumed context window without producing better output. On layout tasks, it reasoned its way into worse solutions than models that simply pattern-matched from training data.

The lesson: match the model architecture to the task type. Reasoning models are the wrong tool for code generation. This seems obvious in hindsight, but R1's pricing ($0.70/$2.50) sits between Haiku and Sonnet — it looks like a mid-tier option until you run the evaluation.

## The Variance Problem

Average scores tell half the story. The other half is variance.

| Model | Avg Score | Std Dev | Best Run | Worst Run | Range |
|-------|-----------|---------|----------|-----------|-------|
| Claude Haiku | 107.7 | 13.4 | ~121 | ~94 | 27 |
| Kimi K2.5 | 108.2 | 20.1 | ~128 | ~88 | 40 |
| DeepSeek V3.2 | 94.0 | 28.9 | 120.5 | 25.8 | 95 |

Haiku is the most consistent model — you know what you're getting. Its standard deviation (13.4) is half of Kimi's and less than half of DeepSeek V3.2's.

DeepSeek V3.2's variance is remarkable. Its best run (120.5) approaches Haiku's average. Its worst run (25.8) is catastrophic — worse than R1's average. Same model, same template, same requirements, 95-point swing.

For production systems, unpredictable quality is worse than consistently mediocre quality. A restaurant that's amazing 50% of the time and terrible 50% isn't a good restaurant. Haiku's consistency is a genuine advantage that doesn't show up in averages.

## What We'd Do Differently

This was an exploratory evaluation — designed to identify patterns, not prove rankings. For Round 2, we're addressing three issues:

**Run Sonnet through the same pipeline.** The gold standard scoring method makes Sonnet's score non-comparable. In Round 2, Sonnet runs the same 16-action pipeline as every other model. Same judge, same conditions, same denominator.

**Increase sample sizes.** Minimum 15 runs per model across the same template set. That gives us 80% statistical power to detect a 20-point difference at alpha=0.05. No more overlapping confidence intervals for the middle tier.

**Calibrate the judge.** Our Claude Opus judge scores Claude models. There's an obvious bias risk. Round 2 will score a subset with a second judge model and compute inter-rater agreement. We'll also blind the judge by stripping model-identifying patterns from outputs.

## Key Takeaways

**No model matches Sonnet.** The gap is directionally clear even with measurement caveats. For client-facing output where quality is non-negotiable, Sonnet remains the production choice.

**The middle tier is a tie.** Kimi, Haiku, and DeepSeek V3.2 are statistically indistinguishable. Pick based on secondary factors: Haiku for consistency, Kimi for peak performance, DeepSeek for cost.

**Task type matters more than model choice.** The difference between the easiest action (9.4/10) and the hardest (-0.8/10) is larger than the difference between any two models on the same action. If you optimise which tasks you give to AI rather than which AI you use, you'll see bigger quality gains.

**Reasoning models don't generate code well.** R1's architecture is wrong for this task. Don't pick a model based on its benchmark scores on reasoning tasks if your workload is code generation.

**Variance is a feature, not noise.** DeepSeek V3.2 is the cheapest option but the least predictable. Haiku costs 5x more but delivers consistent results. The reliability premium is real.

---

*This is part 2 of a 7-part series documenting how we built an evaluation framework for AI code generators, tested 5 models across 467 real code generation tasks, and turned the results into production improvements.*

*Previous: [Beyond Text: How We Built an Evaluation Framework for Multi-File AI Outputs](/blog/beyond-text-evaluating-multi-file-ai-outputs)*
*Next: [Building an LLM Judge That Doesn't Lie to You](/blog/building-llm-judge-that-doesnt-lie)*

*Originally published on [tebogo.cloud](https://tebogo.cloud/blog/comparing-llms-real-code-generation)*
