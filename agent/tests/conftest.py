"""
pytest puts the *test* directory on sys.path, not the package root, so the
modules under test (workspace, questions, progress) would not be importable
without this.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
