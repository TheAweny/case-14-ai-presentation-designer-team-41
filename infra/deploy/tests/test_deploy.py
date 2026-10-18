"""Exercise release transitions with no registry, SSH or Docker dependency."""

import importlib.util
import json
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).parents[1] / "deploy.py"
SPEC = importlib.util.spec_from_file_location("production_deploy", MODULE_PATH)
assert SPEC and SPEC.loader
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)

SHA = "a" * 40
OLD_SHA = "b" * 40
PREFIX = "ghcr.io/theaweny/case-14-ai-presentation-designer-team-41"


def request(sha=SHA):
    return {
        "sha": sha,
        "actor": "teammate",
        "token": "short-lived-token",
        "images": {name: f"{PREFIX}/{name}@sha256:{'c' * 64}" for name in deploy.SERVICES},
    }


class Harness(deploy.Deployment):
    def __init__(self, root, fail=None):
        super().__init__(root)
        self.calls = []
        self.fail = fail

    def check_main(self, _request):
        if self.fail == "stale":
            raise RuntimeError("Superseded commit")

    def pull(self, _request):
        self.calls.append("pull")
        if self.fail == "pull":
            raise RuntimeError("Pull failed")

    def backup(self, _sha):
        self.calls.append("backup")
        if self.fail == "backup":
            raise RuntimeError("Backup failed")

    def start(self, release):
        self.calls.append(("start", release["sha"]))

    def ready(self):
        self.calls.append("ready")
        if self.fail == "ready":
            self.fail = None
            raise RuntimeError("Readiness failed")

    def stop_apps(self):
        self.calls.append("stop")

    def check_disk(self):
        pass

    def prune_images(self):
        self.calls.append("prune")


def prepare(tmp_path, fail=None, previous=True):
    instance = Harness(tmp_path, fail)
    instance.state.mkdir(parents=True)
    if previous:
        instance.write_json(instance.state / "current.json", deploy.release(request(OLD_SHA)))
    return instance


@pytest.mark.parametrize(
    ("field", "value"),
    [("sha", "main;id"), ("actor", "-bad"), ("token", ""), ("images", {"web": "bad"})],
)
def test_rejects_invalid_requests(field, value):
    payload = request()
    payload[field] = value
    with pytest.raises(ValueError):
        deploy.validate(payload)


@pytest.mark.parametrize("image", ["evil.io/web@sha256:" + "c" * 64, PREFIX + "/web:latest"])
def test_rejects_untrusted_or_mutable_image(image):
    payload = request()
    payload["images"]["web"] = image
    with pytest.raises(ValueError):
        deploy.validate(payload)


@pytest.mark.parametrize("failure", ["stale", "pull", "backup"])
def test_preflight_failure_preserves_release(tmp_path, failure):
    instance = prepare(tmp_path, failure)
    before = (instance.state / "current.json").read_bytes()
    with pytest.raises(RuntimeError):
        instance.deploy(request())
    assert (instance.state / "current.json").read_bytes() == before
    assert not any(isinstance(call, tuple) for call in instance.calls)


def test_failed_readiness_rolls_back_without_committing(tmp_path):
    instance = prepare(tmp_path, "ready")
    with pytest.raises(RuntimeError, match="Readiness"):
        instance.deploy(request())
    assert ("start", OLD_SHA) in instance.calls
    assert json.loads((instance.state / "current.json").read_text())["sha"] == OLD_SHA


def test_success_records_release_and_previous_without_token(tmp_path):
    instance = prepare(tmp_path)
    instance.deploy(request())
    assert json.loads((instance.state / "current.json").read_text())["sha"] == SHA
    assert json.loads((instance.state / "previous.json").read_text())["sha"] == OLD_SHA
    assert "short-lived-token" not in "".join(path.read_text() for path in instance.state.iterdir())
    assert instance.calls.index("backup") < instance.calls.index(("start", SHA))


def test_first_release_failure_stops_apps(tmp_path):
    instance = prepare(tmp_path, "ready", previous=False)
    with pytest.raises(RuntimeError):
        instance.deploy(request())
    assert instance.calls[-1] == "stop"
    assert not (instance.state / "current.json").exists()


def test_lock_rejects_concurrent_receiver(tmp_path):
    with (
        deploy.deployment_lock(tmp_path / "deploy.lock"),
        pytest.raises(RuntimeError, match="already running"),
        deploy.deployment_lock(tmp_path / "deploy.lock"),
    ):
        pytest.fail("Second deployment acquired the lock")


def test_runtime_compose_is_private_and_persistent():
    import yaml

    config = yaml.safe_load((MODULE_PATH.parent / "compose.yaml").read_text())
    services = config["services"]
    assert services["web"]["ports"] == ["127.0.0.1:3000:3000"]
    assert all("ports" not in services[name] for name in ("api", "engine", "postgres", "search"))
    assert services["postgres"]["volumes"] == ["/srv/lct/postgres:/var/lib/postgresql/data"]
    assert all("no-new-privileges:true" in service["security_opt"] for service in services.values())
    for name in ("api", "web", "engine"):
        assert "build" not in services[name]
        assert "@sha256" not in services[name]["image"]  # I supply digests in the release env.


def test_consistent_backup_resumes_current_release_on_snapshot_failure(tmp_path):
    instance = prepare(tmp_path)

    def fail_snapshot(_sha):
        instance.calls.append("snapshot")
        raise RuntimeError("Disk full")

    instance.backup_files = fail_snapshot
    with pytest.raises(RuntimeError, match="Disk full"):
        deploy.Deployment.backup(instance, SHA)
    assert instance.calls == ["stop", "snapshot", ("start", OLD_SHA), "ready"]


def test_daily_backup_does_not_interrupt_the_application(tmp_path):
    instance = prepare(tmp_path)
    instance.backup_files = lambda _sha: instance.calls.append("snapshot")
    deploy.Deployment.backup(instance, SHA, quiesce=False)
    assert instance.calls == ["snapshot"]


def test_readiness_requires_a_real_active_account(tmp_path):
    from types import SimpleNamespace

    instance = deploy.Deployment(tmp_path)
    instance.compose = lambda *_args, **_kwargs: SimpleNamespace(stdout="")
    with pytest.raises(RuntimeError, match="active administrator"):
        instance.ready()
