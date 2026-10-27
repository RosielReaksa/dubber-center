"""localv1 — the local GPU pipeline, wrapped as a CLI runner."""

from __future__ import annotations

from dubber_center.adapters.cli_runner import CliRunnerAdapter


class LocalV1Adapter(CliRunnerAdapter):
    """Configured entirely from models/localv1.yaml (`runner.cli`)."""

    def __init__(self, workdir: str = ".", **kwargs) -> None:
        super().__init__(workdir, **kwargs)