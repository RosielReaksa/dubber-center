"""Unit tests: manifests, language checks, cost, key hashing, health rules."""

from __future__ import annotations

import pytest

from dubber_center.core.security import (
    generate_api_key,
    hash_api_key,
    hash_password,
    key_prefix,
    sign_payload,
    verify_password,
)
from dubber_center.registry.manifest import ManifestError, load_manifests, parse_manifest

# --- manifest -------------------------------------------------------------

GOOD = {
    "id": "testv1",
    "name": "Test V1",
    "languages": {"source": ["EN"], "target": ["km"]},
    "price_per_minute": 0.5,
    "runner": {
        "kind": "python",
        "python": {"class_path": "dubber_center.adapters.fake:FakeAdapter"},
    },
}


def test_parse_manifest_normalizes_languages():
    manifest = parse_manifest(GOOD)
    assert manifest.id == "testv1"
    assert manifest.languages.source == ["en"]  # lowercased
    assert manifest.supports("EN", "KM")
    assert not manifest.supports("km", "en")


def test_parse_manifest_rejects_bad_id():
    with pytest.raises(ManifestError):
        parse_manifest({**GOOD, "id": "has space"})


def test_runner_block_must_match_kind():
    with pytest.raises(ManifestError):
        parse_manifest({**GOOD, "runner": {"kind": "http"}})


def test_parse_manifest_rejects_negative_timeout():
    with pytest.raises(ManifestError):
        parse_manifest({**GOOD, "timeout_minutes": -1})


def test_cost_estimate():
    manifest = parse_manifest(GOOD)
    assert manifest.estimate_cost(12) == 6.0
    assert manifest.estimate_cost(0) == 0.0
    assert manifest.estimate_cost(-5) == 0.0


def test_public_dict_hides_runner():
    manifest = parse_manifest(GOOD)
    public = manifest.public_dict()
    assert "runner" not in public
    assert public["id"] == "testv1"


def test_load_shipped_manifests():
    from dubber_center.config import settings

    manifests, errors = load_manifests(settings.models_dir)
    ids = {m.id for m in manifests}
    assert {"paidv1", "localv1"}.issubset(ids)
    assert errors == []


def test_duplicate_manifest_ids_reported(tmp_path):
    (tmp_path / "a.yaml").write_text(
        "id: dup\nname: A\nrunner: {kind: python, python: {class_path: 'x:Y'}}"
    )
    (tmp_path / "b.yaml").write_text(
        "id: dup\nname: B\nrunner: {kind: python, python: {class_path: 'x:Y'}}"
    )
    manifests, errors = load_manifests(tmp_path)
    assert len(manifests) == 1
    assert any("duplicate" in e for e in errors)


# --- security -------------------------------------------------------------


def test_api_key_shape_and_hash():
    key = generate_api_key()
    assert key.startswith("dk_live_")
    assert len(key) > 20
    assert hash_api_key(key) == hash_api_key(key)
    assert hash_api_key(key) != hash_api_key(generate_api_key())
    assert key_prefix(key).startswith("dk_live_")
    assert len(key_prefix(key)) < len(key)


def test_password_roundtrip():
    stored = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", stored)
    assert not verify_password("wrong", stored)
    assert not verify_password("x", None)


def test_webhook_signature():
    payload = b'{"a":1}'
    signature = sign_payload("secret", payload)
    assert signature.startswith("sha256=")
    assert signature == sign_payload("secret", payload)
    assert signature != sign_payload("other", payload)


# --- health evaluator -----------------------------------------------------


def test_evaluator_unknown_without_data():
    from dubber_center.worker.health_tasks import (
        Evaluation,
        ModelSignals,
        Thresholds,
        evaluate_rules,
    )

    result = evaluate_rules(ModelSignals(), Thresholds())
    assert result == Evaluation("unknown", "No checks yet")


def test_evaluator_down_on_ping_failures():
    from datetime import UTC, datetime

    from dubber_center.worker.health_tasks import ModelSignals, Thresholds, evaluate_rules

    signals = ModelSignals(consecutive_ping_failures=3, checked_at=datetime.now(UTC))
    assert evaluate_rules(signals, Thresholds()).state == "down"


def test_evaluator_down_on_success_rate_with_enough_jobs():
    from datetime import UTC, datetime

    from dubber_center.worker.health_tasks import ModelSignals, Thresholds, evaluate_rules

    signals = ModelSignals(
        recent_jobs=25, recent_success_rate=0.4, checked_at=datetime.now(UTC)
    )
    assert evaluate_rules(signals, Thresholds()).state == "down"


def test_evaluator_ignores_success_rate_with_few_jobs():
    from datetime import UTC, datetime

    from dubber_center.worker.health_tasks import ModelSignals, Thresholds, evaluate_rules

    signals = ModelSignals(
        recent_jobs=5, recent_success_rate=0.2, checked_at=datetime.now(UTC)
    )
    assert evaluate_rules(signals, Thresholds()).state == "healthy"


def test_evaluator_degraded_on_success_rate():
    from datetime import UTC, datetime

    from dubber_center.worker.health_tasks import ModelSignals, Thresholds, evaluate_rules

    signals = ModelSignals(
        recent_jobs=12, recent_success_rate=0.8, checked_at=datetime.now(UTC)
    )
    assert evaluate_rules(signals, Thresholds()).state == "degraded"


def test_evaluator_degraded_on_p95_multiplier():
    from datetime import UTC, datetime

    from dubber_center.worker.health_tasks import ModelSignals, Thresholds, evaluate_rules

    signals = ModelSignals(
        p95_duration_sec=900, baseline_p95_sec=300, checked_at=datetime.now(UTC)
    )
    assert evaluate_rules(signals, Thresholds()).state == "degraded"


def test_evaluator_degraded_on_queue_wait():
    from datetime import UTC, datetime

    from dubber_center.worker.health_tasks import ModelSignals, Thresholds, evaluate_rules

    signals = ModelSignals(oldest_queue_wait_minutes=40, checked_at=datetime.now(UTC))
    assert evaluate_rules(signals, Thresholds()).state == "degraded"


def test_evaluator_degraded_on_last_canary_failed():
    from datetime import UTC, datetime

    from dubber_center.worker.health_tasks import ModelSignals, Thresholds, evaluate_rules

    signals = ModelSignals(last_canary_failed=True, checked_at=datetime.now(UTC))
    assert evaluate_rules(signals, Thresholds()).state == "degraded"


def test_recovery_rule_needs_two_passes():
    from dubber_center.worker.health_tasks import apply_recovery_rule

    # down -> healthy needs 2 passes
    state, passes = apply_recovery_rule("down", "healthy", 0, 2)
    assert (state, passes) == ("down", 1)
    state, passes = apply_recovery_rule("down", "healthy", 1, 2)
    assert (state, passes) == ("healthy", 0)


def test_recovery_rule_worsening_is_immediate():
    from dubber_center.worker.health_tasks import apply_recovery_rule

    state, passes = apply_recovery_rule("healthy", "down", 0, 2)
    assert (state, passes) == ("down", 0)


def test_recovery_rule_no_change_resets_passes():
    from dubber_center.worker.health_tasks import apply_recovery_rule

    state, passes = apply_recovery_rule("degraded", "degraded", 1, 2)
    assert (state, passes) == ("degraded", 0)