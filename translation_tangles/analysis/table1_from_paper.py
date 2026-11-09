"""Can the paper's Table 1 be recomputed from its own per-direction BLEU (Fig. 7)?

Groups the 13 models by size (Sec. 5.1: small <= 7B, medium 7-30B, large > 30B) and the 24
directions by intra- vs cross-family, then prints mean BLEU per cell next to Table 1.
Two readings of "intra-family" are tried (both languages Indo-European, or same sub-family per
Fig. 26), and Mixtral is placed by total (47B, large) or active (13B, medium) parameters.

    python analysis/table1_from_paper.py
"""
import statistics as st

from paper_values import FIG7_BLEU

TABLE1_BLEU = {"small": (10.369, 6.178), "medium": (20.993, 15.001), "large": (29.105, 25.127)}
IE = {"en", "de", "cs", "fr", "ru", "lt", "gu", "bn"}
SUBFAMILY = {"en": "germanic", "de": "germanic", "cs": "slavic", "ru": "slavic", "fr": "romance",
             "lt": "baltic", "gu": "indic", "bn": "indic", "fi": "finno-ugric", "et": "finno-ugric",
             "kk": "turkic", "tr": "turkic", "zh": "sinitic"}
INTRA = {"family (IE-IE)": lambda a, b: a in IE and b in IE,
         "sub-family": lambda a, b: SUBFAMILY[a] == SUBFAMILY[b]}
SMALL = ["olmo-1b", "phi-3.5-mini", "qwen2.5-0.5b", "qwen2.5-1.5b", "qwen2.5-3b", "gemma-7b"]
MEDIUM = ["gemma2-9b", "llama3-8b", "llama-3.1-8b"]
LARGE = ["llama3-70b", "llama-3.1-70b", "llama-3.2-90b-vision"]
GROUPINGS = {
    "Mixtral large (47B total)": {"small": SMALL, "medium": MEDIUM, "large": LARGE + ["mixtral-8x7b"]},
    "Mixtral medium (13B active)": {"small": SMALL, "medium": MEDIUM + ["mixtral-8x7b"], "large": LARGE},
}


def cell_means(bleu, groups, is_intra):
    out = {}
    for size, models in groups.items():
        intra = [bleu[m][d] for m in models for d in bleu[m] if is_intra(*d.split("-"))]
        cross = [bleu[m][d] for m in models for d in bleu[m] if not is_intra(*d.split("-"))]
        out[size] = (st.mean(intra), st.mean(cross))
    return out


if __name__ == "__main__":
    print(f"{'grouping':28s} {'intra =':16s} " + "  ".join(f"{s:>22s}" for s in TABLE1_BLEU))
    for gname, groups in GROUPINGS.items():
        for iname, fn in INTRA.items():
            cells = cell_means(FIG7_BLEU, groups, fn)
            print(f"{gname:28s} {iname:16s} " + "  ".join(
                f"{i:5.2f}/{c:5.2f} gap {i - c:5.2f}" for i, c in (cells[s] for s in TABLE1_BLEU)))
    print(f"{'paper Table 1':28s} {'':16s} " + "  ".join(
        f"{i:5.2f}/{c:5.2f} gap {i - c:5.2f}" for i, c in TABLE1_BLEU.values()))
