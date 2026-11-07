"""Build an .ipynb from a percent-format .py file ('# %%' code cells, '# %% [markdown]' text cells)."""
import json, sys

src, out = sys.argv[1], sys.argv[2]
cells, kind, buf = [], None, []

def flush():
    if kind is None:
        return
    text = "\n".join(buf).strip("\n")
    if kind == "markdown":
        text = "\n".join(l[2:] if l.startswith("# ") else l.lstrip("#") for l in text.splitlines())
        cells.append({"cell_type": "markdown", "metadata": {}, "source": text})
    else:
        cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": text})

for line in open(src, encoding="utf-8").read().splitlines():
    if line.startswith("# %% [markdown]"):
        flush(); kind, buf = "markdown", []
    elif line.startswith("# %%"):
        flush(); kind, buf = "code", []
    else:
        buf.append(line)
flush()
for i, c in enumerate(cells):
    c["id"] = f"cell-{i:02d}"
nb = {"cells": cells,
      "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                   "language_info": {"name": "python"}},
      "nbformat": 4, "nbformat_minor": 5}
json.dump(nb, open(out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"{out}: {len(cells)} cells")
