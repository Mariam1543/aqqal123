import os
import sys
from pathlib import Path

import pytest

PKG_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PKG_ROOT))

DOCLENS_ROOT = os.environ.get("DOCLENS_ROOT")
if DOCLENS_ROOT:
    sys.path.insert(0, str(Path(DOCLENS_ROOT).resolve()))

requires_doclens = pytest.mark.skipif(
    not DOCLENS_ROOT or not (Path(DOCLENS_ROOT) / "agents").exists(),
    reason="set DOCLENS_ROOT to a clone of https://github.com/dwzhu-pku/DocLens",
)
