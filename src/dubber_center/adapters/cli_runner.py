"""Reusable adapter for scripts and containers (manifest `runner.cli`).

Starts a subprocess in a per-job folder, reads progress from a JSON file (or from
stdout lines like `progress: 42%`), and returns the configured output file.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
from typing import Any

from dubber_center.adapters.base import (
    AdapterError,
    AdapterStatus,
    DubberAdapter,
    JobInput,
    JobOutput,
)
from dubber_center.registry.manifest import CliRunner

_PROGRESS_RE = re.compile(r"progress[:=]\s*(\d{1,3}(?:\.\d+)?)\s*%?", re.IGNORECASE)
_STAGE_RE = re.compile(r"stage[:=]\s*(.+)$", re.IGNORECASE)


class CliRunnerAdapter(DubberAdapter):
    def __init__(self, workdir: str = ".", *, config: CliRunner | None = None) -> None:
        super().__init__(workdir)
        if config is None:
            raise ValueError("CliRunnerAdapter needs runner.cli config from the manifest")
        self.config = config
        self._procs: dict[str, asyncio.subprocess.Process] = {}
        self._meta: dict[str, dict[str, Any]] = {}

    # --- command building -------------------------------------------------

    def _render(self, template: str, values: dict[str, str]) -> str:
        try:
            return template.format(**values)
        except KeyError as exc:
            raise AdapterError(
                f"Manifest command placeholder {exc} is unknown.", error_code="output_invalid"
            ) from exc

    def _build_values(self, job: JobInput, outdir: Path) -> dict[str, str]:
        return {
            "input": job.input_path_or_url,
            "outdir": str(outdir),
            "source_lang": job.source_lang,
            "target_lang": job.target_lang,
            "job_id": job.job_id,
        }

    async def submit(self, job: JobInput) -> str:
        external_id = f"cli_{job.job_id}"
        outdir = Path(job.workdir) / external_id
        outdir.mkdir(parents=True, exist_ok=True)
        values = self._build_values(job, outdir)
        command = self._render(self.config.command, values)

        env = {**os.environ, **self.config.env, "DC_JOB_ID": job.job_id}
        process = await asyncio.create_subprocess_shell(
            command,
            cwd=str(outdir),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        self._procs[external_id] = process
        self._meta[external_id] = {"outdir": outdir, "values": values, "stdout": b""}
        return external_id

    # --- progress ---------------------------------------------------------

    def _progress_path(self, external_id: str) -> Path | None:
        if not self.config.progress_file:
            return None
        values = self._meta[external_id]["values"]
        return Path(self._render(self.config.progress_file, values))

    def _read_progress_file(self, external_id: str) -> AdapterStatus | None:
        path = self._progress_path(external_id)
        if path is None or not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

        progress = data.get("progress", 0.0)
        if isinstance(progress, int | float) and progress > 1:
            progress = progress / 100.0
        state = str(data.get("state", "running")).lower()
        if state not in {"running", "done", "failed", "canceled"}:
            state = "running"
        return AdapterStatus(
            state=state,
            progress=max(0.0, min(float(progress or 0.0), 1.0)),
            message=str(data.get("message") or ""),
            stage=data.get("stage"),
            error_code=data.get("error_code"),
        )

    async def status(self, external_id: str) -> AdapterStatus:
        process = self._procs.get(external_id)
        if process is None:
            raise AdapterError("Unknown process", error_code="provider_unavailable")

        if process.returncode is None:
            from_file = self._read_progress_file(external_id)
            if from_file is not None:
                return from_file
            return AdapterStatus(state="running", progress=0.0, stage="Running")

        # Process exited: decide by exit code, then let `result` check the file.
        if process.returncode != 0:
            return AdapterStatus(
                state="failed",
                progress=1.0,
                message=f"Command exited with code {process.returncode}",
                error_code="unknown",
            )
        return AdapterStatus(state="done", progress=1.0, stage="Finishing")

    # --- result -----------------------------------------------------------

    def _output_path(self, template: str, external_id: str) -> Path:
        values = self._meta[external_id]["values"]
        return Path(self._render(template, values))

    async def result(self, external_id: str) -> JobOutput:
        if external_id not in self._meta:
            raise AdapterError("Unknown process", error_code="provider_unavailable")

        video = self._output_path(self.config.output_file, external_id)
        if not video.exists() or video.stat().st_size == 0:
            raise AdapterError(
                f"Expected output was not created: {video.name}", error_code="output_missing"
            )

        audio = (
            self._output_path(self.config.audio_file, external_id)
            if self.config.audio_file
            else None
        )
        subs = (
            self._output_path(self.config.subtitles_file, external_id)
            if self.config.subtitles_file
            else None
        )
        timing = (
            self._output_path(self.config.timing_json_file, external_id)
            if self.config.timing_json_file
            else None
        )

        return JobOutput(
            video_path=str(video),
            audio_path=str(audio) if audio and audio.exists() else None,
            subtitles_path=str(subs) if subs and subs.exists() else None,
            timing_json_path=str(timing) if timing and timing.exists() else None,
        )

    async def cancel(self, external_id: str) -> None:
        process = self._procs.get(external_id)
        if process is not None and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=10)
            except TimeoutError:
                process.kill()

    async def health(self) -> bool:
        if not self.config.health_command:
            return True
        try:
            process = await asyncio.create_subprocess_shell(
                self.config.health_command,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(process.wait(), timeout=5)
            return process.returncode == 0
        except (TimeoutError, OSError):
            return False