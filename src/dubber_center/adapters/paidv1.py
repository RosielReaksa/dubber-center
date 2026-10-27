"""paidv1 — the paid-API pipeline, wrapped as an HTTP runner."""

from __future__ import annotations

from dubber_center.adapters.http_runner import HttpRunnerAdapter


class PaidV1Adapter(HttpRunnerAdapter):
    """Configured entirely from models/paidv1.yaml (`runner.http`)."""

    def __init__(self, workdir: str = ".", **kwargs) -> None:
        super().__init__(workdir, **kwargs)