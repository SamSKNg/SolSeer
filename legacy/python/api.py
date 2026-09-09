"""Backward-compatible console launcher."""

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from cluster_indicator.cli import main


if __name__ == "__main__":
    main()
