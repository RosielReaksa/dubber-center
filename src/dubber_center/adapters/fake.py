"""Fake adapter: deterministic, instant, used by tests and demos.

It copies the input file to the output and reports a few progress steps.
"""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path

from dubber_center.adapters.base import (
    AdapterError,
    AdapterStatus,
    DubberAdapter,
    JobInput,
    JobOutput,
)

_STAGES = ["Preparing", "Transcribing", "Translating", "Generating voice", "Finishing"]


class FakeAdapter(DubberAdapter):
    def __init__(
        self,
        workdir: str | Path = ".",
        *,
        step_delay: float = 0.02,
        fail_after: float | None = None,
        error_code: str = "unknown",
        silent: bool = False,
        unhealthy: bool = False,
    ) -> None:
        super().__init__(workdir)
        self.step_delay = step_delay
        self.fail_after = fail_after  # second into the run, for timeout/testing
        self.error_code = error_code
        self.silent = silent
        self.unhealthy = unhealthy
        self._runs: dict[str, dict] = {}

    async def submit(self, job: JobInput) -> str:
        external_id = f"fake_{job.job_id}"
        run_dir = Path(job.workdir) / external_id
        run_dir.mkdir(parents=True, exist_ok=True)

        source = Path(job.input_path_or_url)
        target = run_dir / "dubbed.mp4"
        if await asyncio.to_thread(source.exists):
            await asyncio.to_thread(shutil.copyfile, source, target)
        else:
            # A URL or a missing path: still produce a plausible artifact.
            await asyncio.to_thread(target.write_bytes, b"fake-dubbed-video")

        subs = run_dir / "subs.srt"
        if job.options.get("subtitles", True):
            await asyncio.to_thread(
                subs.write_text,
                "1\n00:00:00,000 --> 00:00:02,000\nHello from the fake model.\n",
                encoding="utf-8",
            )
            subs_path = str(subs)
        else:
            subs_path = None

        timing = run_dir / "timing.json"
        await asyncio.to_thread(timing.write_text, '{"segments": []}', encoding="utf-8")

        self._runs[external_id] = {
            "started": asyncio.get_running_loop().time(),
            "done": False,
            "output": JobOutput(
                video_path=str(target),
                subtitles_path=subs_path,
                timing_json_path=str(timing),
                minutes=job.minutes or 0.5,
            ),
        }
        return external_id

    async def status(self, external_id: str) -> AdapterStatus:
        run = self._runs.get(external_id)
        if run is None:
            raise AdapterError("Unknown external id", error_code="provider_unavailable")

        elapsed = asyncio.get_running_loop().time() - run["started"]
        if self.fail_after is not None and elapsed >= self.fail_after:
            raise AdapterError("The fake model was told to fail.", error_code=self.error_code)

        total = self.step_delay * len(_STAGES)
        progress = min(elapsed / total, 1.0) if total else 1.0
        index = min(int(progress * len(_STAGES)), len(_STAGES) - 1)

        if progress >= 1.0:
            run["done"] = True
            return AdapterStatus(state="done", progress=1.0, stage="Finishing")

        return AdapterStatus(
            state="running", progress=round(progress, 3), stage=_STAGES[index]
        )

    async def result(self, external_id: str) -> JobOutput:
        run = self._runs.get(external_id)
        if run is None:
            raise AdapterError("Unknown external id", error_code="provider_unavailable")
        return run["output"]

    async def cancel(self, external_id: str) -> None:
        self._runs.pop(external_id, None)

    async def health(self) -> bool:
        return not self.unhealthy