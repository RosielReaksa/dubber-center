"""Reusable adapter for models that are already web services.

URLs and placeholders come from the manifest's `runner.http` block:

    submit_url:   http://paid-system.internal/dub
    status_url:   http://paid-system.internal/jobs/{external_id}
    result_url:   http://paid-system.internal/jobs/{external_id}/result
"""

from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import urljoin

import httpx

from dubber_center.adapters.base import (
    AdapterError,
    AdapterStatus,
    DubberAdapter,
    JobInput,
    JobOutput,
)
from dubber_center.registry.manifest import HttpRunner

_STATE_MAP = {
    "queued": "running",
    "pending": "running",
    "processing": "running",
    "running": "running",
    "in_progress": "running",
    "done": "done",
    "succeeded": "done",
    "success": "done",
    "completed": "done",
    "failed": "failed",
    "error": "failed",
    "canceled": "canceled",
    "cancelled": "canceled",
}


class HttpRunnerAdapter(DubberAdapter):
    def __init__(
        self,
        workdir: str = ".",
        *,
        config: HttpRunner | None = None,
        headers: dict[str, str] | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(workdir)
        if config is None:
            raise ValueError("HttpRunnerAdapter needs runner.http config from the manifest")
        self.config = config
        self.headers = {**(config.headers or {}), **(headers or {})}
        self._client = client
        self._external_ids: list[str] = []

    def _client_for(self, timeout: float) -> httpx.AsyncClient:
        if self._client is not None:
            return self._client
        return httpx.AsyncClient(timeout=timeout, headers=self.headers)

    def _url(self, template: str, external_id: str = "") -> str:
        return template.format(external_id=external_id)

    def _map_error(self, response: httpx.Response) -> AdapterError:
        if response.status_code in (401, 403):
            code = "provider_auth"
        elif response.status_code == 429:
            code = "provider_rate_limited"
        elif response.status_code >= 500:
            code = "provider_unavailable"
        else:
            code = "provider_unavailable"
        return AdapterError(
            f"Upstream returned {response.status_code}: {response.text[:200]}", error_code=code
        )

    async def submit(self, job: JobInput) -> str:
        body: dict[str, Any] = {
            "job_id": job.job_id,
            "video_url": job.input_path_or_url,
            "source_lang": job.source_lang,
            "target_lang": job.target_lang,
            "options": job.options,
        }
        client = self._client_for(self.config.timeout_sec)
        try:
            response = await client.post(self._url(self.config.submit_url), json=body)
        except httpx.HTTPError as exc:
            raise AdapterError(str(exc), error_code="service_unreachable") from exc
        finally:
            if self._client is None:
                await client.aclose()

        if response.status_code >= 400:
            raise self._map_error(response)
        data = response.json()
        external_id = str(data.get("id") or data.get("job_id") or data.get("external_id") or "")
        if not external_id:
            raise AdapterError("Upstream did not return an id.", error_code="provider_unavailable")
        self._external_ids.append(external_id)
        return external_id

    async def status(self, external_id: str) -> AdapterStatus:
        client = self._client_for(self.config.timeout_sec)
        try:
            response = await client.get(self._url(self.config.status_url, external_id))
        except httpx.HTTPError as exc:
            raise AdapterError(str(exc), error_code="service_unreachable") from exc
        finally:
            if self._client is None:
                await client.aclose()

        if response.status_code >= 400:
            raise self._map_error(response)

        data = response.json()
        raw_state = str(data.get("status") or data.get("state") or "running").lower()
        state = _STATE_MAP.get(raw_state, "running")
        progress = data.get("progress", 0.0)
        if isinstance(progress, int | float) and progress > 1:
            progress = progress / 100.0
        return AdapterStatus(
            state=state,
            progress=max(0.0, min(float(progress or 0.0), 1.0)),
            message=str(data.get("message") or ""),
            stage=data.get("stage"),
            error_code=data.get("error_code"),
        )

    async def result(self, external_id: str) -> JobOutput:
        client = self._client_for(self.config.timeout_sec)
        try:
            response = await client.get(self._url(self.config.result_url, external_id))
        except httpx.HTTPError as exc:
            raise AdapterError(str(exc), error_code="service_unreachable") from exc
        finally:
            if self._client is None:
                await client.aclose()

        if response.status_code >= 400:
            raise self._map_error(response)

        data = response.json()
        output = data.get("output", data)
        video = output.get("video_url") or output.get("video_path") or output.get("video")
        if not video:
            raise AdapterError(
                "Upstream result has no video.", error_code="output_invalid"
            )
        return JobOutput(
            video_path=str(video),
            audio_path=output.get("audio_url") or output.get("audio_path"),
            subtitles_path=output.get("subtitles_url") or output.get("subtitles_path"),
            timing_json_path=output.get("timing_json_url") or output.get("timing_json_path"),
            minutes=float(output.get("minutes") or 0.0),
        )

    async def cancel(self, external_id: str) -> None:
        if not self.config.cancel_url:
            return
        client = self._client_for(self.config.timeout_sec)
        try:
            await client.post(self._url(self.config.cancel_url, external_id))
        except httpx.HTTPError:
            return  # cancel is best-effort
        finally:
            if self._client is None:
                await client.aclose()

    async def health(self) -> bool:
        url = self.config.health_url or urljoin(self.config.submit_url, "/health")
        client = self._client_for(min(self.config.timeout_sec, 5.0))
        try:
            response = await asyncio.wait_for(client.get(url), timeout=5.0)
            return response.status_code < 400
        except (TimeoutError, httpx.HTTPError):
            return False
        finally:
            if self._client is None:
                await client.aclose()