"""
Prompts added by the CDC extension. DocLens' own prompts are reused unchanged;
the correction path only appends a degradation-aware section to them.
"""

DEGRADATION_AWARE_SAMPLER_ADDENDUM = """
## Degraded-evidence protocol (Confidence and Degradation Check)
A preceding quality-control stage inspected every provided page for degradation (blur, noise, compression, low contrast, corrupted OCR). Pages it could not trust are marked with an "[EVIDENCE RELIABILITY NOTE]" and may be followed by a "Restored screenshot" (an enhanced copy of the same page).
- For flagged pages, the Markdown/OCR text is NOT reliable. Re-read every number, name, unit and label you use directly from the page image (original and restored copy). If the text and the image disagree, trust the image.
- Watch for typical recognition errors: 0/O/D, 1/l/I/7, 5/S, 8/B/3, 6/G, rn/m, dropped decimal points, dropped minus signs or percent signs, merged table columns.
- Pages without a reliability note passed the quality check; use them normally.
- If, after careful inspection, a value needed for the answer is genuinely illegible on every page that contains it, say so in the analysis and give your best reading rather than inventing a value from elsewhere.
"""

DEGRADATION_AWARE_ADJUDICATOR_ADDENDUM = """
## Degraded-evidence protocol (Confidence and Degradation Check)
Some evidence pages were flagged as degraded (see the evidence reliability summary below the question). When agents disagree on a value that comes from a flagged page, prefer the agent whose analysis explicitly verified that value against the page image over an agent that copied it from extracted text. Do not prefer an answer only because more agents gave it.
"""

CONFIDENCE_JUDGE_SYSTEM_PROMPT = """
## ROLE
You are a document quality inspector. You will see a few page screenshots that a retrieval agent selected as evidence for a question. You must NOT answer the question. Judge only whether the evidence is legible and sufficient.

## Output Format
Your entire response MUST be a single, valid JSON object and nothing else, with exactly these fields:
- analysis (string): one or two sentences on legibility and sufficiency.
- legibility (number in [0, 1]): how reliably the text, numbers and charts needed for the question can be read (1 = perfectly legible, 0 = unreadable).
- sufficiency (number in [0, 1]): how likely the shown pages contain everything needed to answer.
"""


def insert_before_output_format(system_prompt: str, addendum: str) -> str:
    marker = "## Output Format"
    if marker in system_prompt:
        head, tail = system_prompt.split(marker, 1)
        return f"{head.rstrip()}\n{addendum}\n{marker}{tail}"
    return f"{system_prompt.rstrip()}\n{addendum}"
