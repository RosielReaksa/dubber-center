"""Model registry."""

from dubber_center.registry.manifest import (
    ManifestError,
    ModelManifest,
    load_manifest_file,
    load_manifests,
    parse_manifest,
)
from dubber_center.registry.service import (
    ensure_request_ok,
    ensure_usable,
    estimate_cost,
    get_manifest,
    get_model,
    list_models,
    row_to_manifest,
    supports,
    sync_manifests,
)

__all__ = [
    "ManifestError",
    "ModelManifest",
    "ensure_request_ok",
    "ensure_usable",
    "estimate_cost",
    "get_manifest",
    "get_model",
    "list_models",
    "load_manifest_file",
    "load_manifests",
    "parse_manifest",
    "row_to_manifest",
    "supports",
    "sync_manifests",
]