"""
Run DocLens (baseline) or DocLens + Confidence and Degradation Check.

Example (Kaggle):
    python run_cdc.py --doclens_root /kaggle/working/DocLens \
        --data_root /kaggle/working/variants/blur_s2 \
        --samples /kaggle/working/variants/samples_subset.json \
        --mode analyze --model_name gemini-2.5-flash --rpm 8 \
        --output /kaggle/working/results/blur_s2_analyze.jsonl
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--doclens_root", default=os.environ.get("DOCLENS_ROOT", "DocLens"),
                   help="Path to a clone of https://github.com/dwzhu-pku/DocLens")
    p.add_argument("--data_root", required=True,
                   help="Directory containing data/<dataset>/documents (one per degradation variant)")
    p.add_argument("--dataset_name", default="MMLongBenchDoc")
    p.add_argument("--samples", required=True, help="JSON list of questions (DocLens samples format)")
    p.add_argument("--variant", default=None, help="Label stored with every result (e.g. blur_s2)")
    p.add_argument("--mode", choices=["doclens", "cdc", "analyze"], default="cdc")
    p.add_argument("--output", required=True, help="JSONL output; re-running resumes from it")
    p.add_argument("--limit", type=int, default=0, help="Only the first N questions")

    g = p.add_argument_group("models")
    g.add_argument("--model_name", default="gemini-2.5-flash")
    g.add_argument("--navigator_model", default="gemini-2.5-flash-lite",
                   help="DocLens hard-codes flash-lite for the Page Navigator")
    g.add_argument("--eval_model", default="gemini-2.5-flash",
                   help="Model DocLens' evaluation uses for answer extraction / judging")
    g.add_argument("--api_key_env", default="GEMINI_API_KEY",
                   help="Env var / Kaggle secret holding a Google AI Studio key")
    g.add_argument("--use_vertex", action="store_true",
                   help="Use DocLens' original Vertex AI client (GOOGLE_CLOUD_PROJECT) instead of an API key")
    g.add_argument("--rpm", type=float, default=0, help="Max Gemini requests per minute (0 = unlimited)")
    g.add_argument("--max_concurrent", type=int, default=4)

    g = p.add_argument_group("DocLens settings (defaults = scripts/run_doclens_end2end.sh)")
    g.add_argument("--phase1_input_mode", default="use_ocr")
    g.add_argument("--phase1_candidate_num", type=int, default=2)
    g.add_argument("--phase2_input_pages", default="pgnav_all_located_pages")
    g.add_argument("--phase2_input_mode", default="use_element_localizer")
    g.add_argument("--phase2_candidate_num", type=int, default=2)

    g = p.add_argument_group("Confidence and Degradation Check")
    g.add_argument("--tau_case", type=float, default=0.70, help="case confidence >= tau -> abstain")
    g.add_argument("--tau_evidence", type=float, default=0.50, help="page reliability < tau -> correct that page")
    g.add_argument("--w_evidence", type=float, default=0.70)
    g.add_argument("--w_consistency", type=float, default=0.30)
    g.add_argument("--w_verbal", type=float, default=0.0)
    g.add_argument("--use_confidence_judge", action="store_true",
                   help="Add an LLM verbalized-confidence signal (one extra call per question)")
    g.add_argument("--abstain_policy", choices=["single_pass", "lens_answer"], default="single_pass")
    g.add_argument("--abstain_temperature", type=float, default=0.0)
    g.add_argument("--replace_restored", action="store_true",
                   help="Show only the restored screenshot of flagged pages (default: original + restored)")
    g.add_argument("--calibration", default=None, help="JSON from scripts/calibrate_cdc.py")
    g.add_argument("--no_eval", action="store_true")
    return p.parse_args()


async def main():
    args = parse_args()
    doclens_root = Path(args.doclens_root).resolve()
    if not (doclens_root / "agents" / "page_navigator_agent.py").exists():
        sys.exit(f"DocLens not found at {doclens_root}. Clone https://github.com/dwzhu-pku/DocLens first.")
    sys.path.insert(0, str(doclens_root))
    sys.path.insert(0, str(Path(__file__).resolve().parent))

    from agents import adjudicator_agent, answer_sampler_agent, page_navigator_agent, vanilla_agent
    from prompts.agent_prompts import (
        ADJUDICATOR_ALL_ANSWERABLE_SYSTEM_PROMPT,
        ADJUDICATOR_SYSTEM_PROMPT,
        ANSWER_SAMPLER_ALL_ANSWERABLE_SYSTEM_PROMPT,
        ANSWER_SAMPLER_SYSTEM_PROMPT,
        PAGE_NAVIGATOR_SYSTEM_PROMPT,
        VANILLA_READER_SYSTEM_PROMPT,
    )
    from utils import config

    from cdc.confidence import CDCConfig, load_calibration
    from cdc.llm_setup import configure_gemini, get_secret
    from cdc.processor import CDCDocLensProcessor

    if not args.use_vertex:
        key = get_secret(args.api_key_env)
        if not key:
            sys.exit(f"Set {args.api_key_env} (env var or Kaggle secret) or pass --use_vertex.")
        configure_gemini(key, rpm=args.rpm, eval_model=args.eval_model)

    data_root = Path(args.data_root).resolve()
    exp_config = config.ExpConfig(
        phase1_input_pages="all",
        phase1_candidate_num=args.phase1_candidate_num,
        phase1_input_mode=args.phase1_input_mode,
        phase2_input_pages=args.phase2_input_pages,
        phase2_input_mode=args.phase2_input_mode,
        phase2_candidate_num=args.phase2_candidate_num,
        phase_name="end2end",
        dataset_name=args.dataset_name,
        split_name=Path(args.samples).stem,
        model_name=args.model_name,
        exp_name=f"cdc_{args.mode}",
        work_dir=data_root,
    )

    # Same prompt selection as DocLens' main.py
    if args.dataset_name == "MMLongBenchDoc":
        sampler_prompt, adjudicator_prompt = ANSWER_SAMPLER_SYSTEM_PROMPT, ADJUDICATOR_SYSTEM_PROMPT
    else:
        sampler_prompt = ANSWER_SAMPLER_ALL_ANSWERABLE_SYSTEM_PROMPT
        adjudicator_prompt = ADJUDICATOR_ALL_ANSWERABLE_SYSTEM_PROMPT

    agents = dict(
        page_navigator=page_navigator_agent.PageNavigator(
            model_name=args.navigator_model, system_prompt=PAGE_NAVIGATOR_SYSTEM_PROMPT, exp_config=exp_config),
        answer_sampler=answer_sampler_agent.AnswerSampler(
            model_name=args.model_name, system_prompt=sampler_prompt, exp_config=exp_config),
        adjudicator=adjudicator_agent.Adjudicator(
            model_name=args.model_name, system_prompt=adjudicator_prompt, exp_config=exp_config),
        vanilla_reader=vanilla_agent.VanillaAgent(
            model_name=args.model_name, system_prompt=VANILLA_READER_SYSTEM_PROMPT, exp_config=exp_config),
    )

    cdc_config = load_calibration(args.calibration, CDCConfig(
        tau_case=args.tau_case,
        tau_evidence=args.tau_evidence,
        w_evidence=args.w_evidence,
        w_consistency=args.w_consistency,
        w_verbal=args.w_verbal if args.use_confidence_judge else 0.0,
    ))

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    processor = CDCDocLensProcessor(
        exp_config=exp_config,
        **agents,
        cdc_config=cdc_config,
        mode=args.mode,
        abstain_policy=args.abstain_policy,
        abstain_temperature=args.abstain_temperature,
        use_confidence_judge=args.use_confidence_judge,
        keep_original_on_restore=not args.replace_restored,
        output_jsonl=output,
        evaluate=not args.no_eval,
    )

    data_list = json.loads(Path(args.samples).read_text(encoding="utf-8"))
    if args.limit:
        data_list = data_list[: args.limit]
    variant = args.variant or data_root.name
    for d in data_list:
        d["variant"] = variant
        d["model_name"] = args.model_name
    print(f"{len(data_list)} questions | variant={variant} | mode={args.mode} | output={output}")

    results = await processor.process_documents_batch(data_list, max_concurrent=args.max_concurrent)
    scored = [r for r in results if "final_score" in r]
    if scored:
        acc = sum(r["final_score"] for r in scored) / len(scored)
        print(f"Final accuracy ({len(scored)} scored): {acc:.4f}")
    errors = [r for r in results if "cdc_error" in r]
    if errors:
        print(f"{len(errors)} questions failed; re-run the same command to retry them.")


if __name__ == "__main__":
    asyncio.run(main())
