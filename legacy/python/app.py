"""Streamlit entry point: python -m streamlit run app.py."""

import sys
from pathlib import Path

# Make the src-layout package importable when this repository has not been
# installed into the active Python environment.
SRC = Path(__file__).resolve().parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from cluster_indicator.ui import run


run()
