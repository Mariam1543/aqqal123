"""
Every row of the DocLens paper that can be re-run with the released code, mapped to run_cdc.py
settings. Paper settings (Appendix D.1): Te = Ta = 8 samples, temperature 0.7, MinerU parsing,
200-DPI screenshots; the Page Navigator uses the same backbone as the Reasoning Module in the main
results (Table 3: "Page Navigator w/ Gemini-2.5-Pro ... 67.6"; Sec. 5.5 swaps it for cheaper models).

NOT re-runnable here (cite the paper instead): the Claude-4-Sonnet rows (the released Claude code
path does not return token counts and crashes), SimpleDoc / MACT / M3DocRAG / MDocAgent, GPT-4o and
o4-mini, the human-expert score, Figure 4 (block-level bounding boxes need prompts that are not
released), and latency (Tables 5-6), which depends on hardware and API load.
"""

PRO, FLASH, FLASHLITE, QWEN = "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "qwen3-vl-8b-instruct"


def _exp(mode, model, navigator=None, k1=8, k2=8, nav_input="use_ocr", tier=1, note=""):
    return {
        "mode": mode, "model": model, "navigator": navigator or model, "k1": k1, "k2": k2,
        "nav_input": nav_input, "tier": tier, "note": note,
    }


EXPERIMENTS = {
    # Tier 1: Table 1, Gemini-2.5-Pro (the headline result and its two baselines)
    "pro_vanilla": _exp("vanilla", PRO, tier=1, note="Table 1, Vanilla VLM"),
    "pro_ocr": _exp("vanilla_ocr", PRO, tier=1, note="Table 1, VLM augmented with OCR"),
    "pro_doclens": _exp("doclens", PRO, tier=1, note="Table 1, DocLens w/ Gemini-2.5-Pro"),
    # Tier 2: Table 1, Gemini-2.5-Flash
    "flash_vanilla": _exp("vanilla", FLASH, tier=2, note="Table 1"),
    "flash_ocr": _exp("vanilla_ocr", FLASH, tier=2, note="Table 1"),
    "flash_doclens": _exp("doclens", FLASH, tier=2, note="Table 1"),
    # Tier 3: ablations with Gemini-2.5-Pro (Tables 2-4, 6)
    "pro_no_lens": _exp("no_lens", PRO, tier=3, note="Table 2, w/o Lens Module"),
    "pro_no_reasoning": _exp("no_reasoning", PRO, tier=3, note="Table 2, w/o Reasoning Module"),
    "pro_no_sampling": _exp("doclens", PRO, k1=1, tier=3, note="Table 4, Page Navigator w/o sampling (Te=1)"),
    "pro_no_ocr": _exp("doclens", PRO, nav_input="vanilla", tier=3, note="Table 4, Page Navigator w/o OCR"),
    "pro_nav_flash": _exp("doclens", PRO, navigator=FLASH, tier=3, note="Table 3, Flash as Page Navigator"),
    "pro_nav_flashlite": _exp("doclens", PRO, navigator=FLASHLITE, tier=3, note="Table 3, Flash-Lite as Page Navigator"),
    "pro_oracle": _exp("oracle", PRO, tier=3, note="Table 3, annotated evidence pages"),
    "pro_k2": _exp("doclens", PRO, k1=2, k2=2, tier=3, note="Table 6, K=2 (assumed for both samplers)"),
    # Tier 4: ablations with Gemini-2.5-Flash and Flash-Lite (Tables 2, 4, 11)
    "flash_no_lens": _exp("no_lens", FLASH, tier=4, note="Table 2"),
    "flash_no_reasoning": _exp("no_reasoning", FLASH, tier=4, note="Table 2"),
    "flash_no_sampling": _exp("doclens", FLASH, k1=1, tier=4, note="Table 4"),
    "flash_no_ocr": _exp("doclens", FLASH, nav_input="vanilla", tier=4, note="Table 4"),
    "flashlite_doclens": _exp("doclens", FLASHLITE, tier=4, note="Table 11"),
    "flashlite_no_reasoning": _exp("no_reasoning", FLASHLITE, tier=4, note="Table 11"),
}


def substitute(exp: dict, model_map: dict) -> dict:
    """Swap retired models for available ones (e.g. {"gemini-2.5-pro": "gemini-3.8-pro"})."""
    out = dict(exp)
    out["model"] = model_map.get(exp["model"], exp["model"])
    out["navigator"] = model_map.get(exp["navigator"], exp["navigator"])
    return out


def run_args(exp: dict) -> str:
    return (
        f"--mode {exp['mode']} --model_name {exp['model']} --navigator_model {exp['navigator']} "
        f"--phase1_candidate_num {exp['k1']} --phase2_candidate_num {exp['k2']} "
        f"--phase1_input_mode {exp['nav_input']}"
    )
