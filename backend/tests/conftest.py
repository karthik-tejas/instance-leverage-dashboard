import sys
from pathlib import Path

# Tests import `db`, `parser`, `main` as top-level modules (matching how the
# Vercel Python service resolves them: backend/ is the service root).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
