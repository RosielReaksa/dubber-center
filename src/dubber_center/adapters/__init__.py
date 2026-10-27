"""Adapter factory: manifest -> adapter instance.

Adding a model = a manifest file. Only a model with no matching runner kind needs
a new class (registered in `_extras` or referenced by `runner.python.class_path`).
"""

from __future__ import annotations

import importlib
from pathlib import Path

from dubber_center.adapters.base import DubberAdapter
from dubber_center.core.errors import AppError
from dubber_center.registry.manifest import ModelManifest

# Explicitly wrapped systems, keyed by model id. These take precedence over the
# generic runners so a system can customise behavior without touching core code.
_EXTRAS: dict[str, str] = {
    "paidv1": "dubber_center.adapters.paidv1:PaidV1Adapter",
    "localv1": "dubber_center.adapters.localv1:LocalV1Adapter",
}


def _import_class(path: str) -> type[DubberAdapter]:
    module_path, _, class_name = path.partition(":")
    if not class_name:
        raise AppError(f"Invalid adapter path '{path}' (expected 'module:Class').")
    module = importlib.import_module(module_path)
    cls = getattr(module, class_name)
    if not issubclass(cls, DubberAdapter):
        raise AppError(f"'{path}' is not a DubberAdapter.")
    return cls


def build_adapter(manifest: ModelManifest, workdir: str | Path = ".") -> DubberAdapter:
    runner = manifest.runner

    extra = _EXTRAS.get(manifest.id)
    if extra:
        cls = _import_class(extra)
        return _instantiate(cls, manifest, runner, workdir)

    if runner.kind == "python":
        assert runner.python is not None
        cls = _import_class(runner.python.class_path)
        return _instantiate(cls, manifest, runner, workdir)

    if runner.kind == "http":
        from dubber_center.adapters.http_runner import HttpRunnerAdapter

        adapter = HttpRunnerAdapter(str(workdir), config=runner.http)
        return _bind(adapter, manifest)

    if runner.kind == "cli":
        from dubber_center.adapters.cli_runner import CliRunnerAdapter

        adapter = CliRunnerAdapter(str(workdir), config=runner.cli)
        return _bind(adapter, manifest)

    raise AppError(f"Unknown runner kind '{runner.kind}'.")


def _instantiate(
    cls: type[DubberAdapter], manifest: ModelManifest, runner, workdir: str | Path
) -> DubberAdapter:
    kwargs: dict = {}
    if runner.kind == "http":
        kwargs["config"] = runner.http
    elif runner.kind == "cli":
        kwargs["config"] = runner.cli
    try:
        adapter = cls(str(workdir), **kwargs)
    except TypeError:
        # A custom class may take only the workdir.
        adapter = cls(str(workdir))
    return _bind(adapter, manifest)


def _bind(adapter: DubberAdapter, manifest: ModelManifest) -> DubberAdapter:
    adapter.model_id = manifest.id
    adapter.manifest = manifest
    return adapter