"""Build a wheel and verify the runtime lock in a disposable Python environment."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import venv
from pathlib import Path

from tests.test_reviewed_planning import snapshot


def main():
    with tempfile.TemporaryDirectory(prefix="pharmshift-clean-") as temporary:
        root = Path(temporary)
        environment = root / "venv"
        venv.EnvBuilder(with_pip=True).create(environment)
        python = str(environment / "bin/python")
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "--python",
                python,
                "install",
                "--require-hashes",
                "-r",
                "requirements.lock",
            ],
            check=True,
        )
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "wheel",
                "--no-build-isolation",
                "--no-deps",
                "--wheel-dir",
                str(root),
                ".",
            ],
            check=True,
        )
        wheel = next(root.glob("shift_scheduler-*.whl"))
        subprocess.run(
            [python, "-m", "pip", "install", "--no-deps", str(wheel)], check=True
        )
        subprocess.run([python, "-m", "pip", "check"], check=True)
        fixture = root / "input.json"
        fixture.write_text(snapshot().model_dump_json())
        env = os.environ.copy()
        env.update(
            DATABASE_URL="sqlite:///" + str(root / "isolated.db"),
            SHIFT_SCHEDULER_DB_URL="sqlite:///" + str(root / "isolated.db"),
            PHARMSHIFT_ENV="development",
            AUTH_MODE="mock",
        )
        subprocess.run(
            [
                python,
                "-c",
                "from pathlib import Path; from shift_scheduler.api.main import app; from shift_scheduler.domain.planning import SolverSnapshot; from shift_scheduler.optimizer.planning import solve; import sys; result=solve(SolverSnapshot.model_validate_json(Path(sys.argv[1]).read_text()),5); assert result.status == 'OPTIMAL' and result.validation.publishable; print('CLEAN_RUNTIME_AND_SOLVER_OK')",
                str(fixture),
            ],
            check=True,
            env=env,
            cwd=root,
        )


if __name__ == "__main__":
    main()
