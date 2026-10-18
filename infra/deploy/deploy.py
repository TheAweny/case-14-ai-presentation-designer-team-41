#!/usr/bin/python3
"""Receive a fixed-repository release through a forced SSH command."""

import contextlib
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

REPOSITORY = "TheAweny/case-14-ai-presentation-designer-team-41"
PREFIX = f"ghcr.io/{REPOSITORY.lower()}"
SERVICES = ("api", "web", "engine")
INSTALL = Path("/usr/local/lib/lct")


def validate(payload):
    if not isinstance(payload, dict) or set(payload) != {"sha", "actor", "token", "images"}:
        raise ValueError("Invalid release fields")
    if not isinstance(payload["sha"], str) or not re.fullmatch(r"[a-f0-9]{40}", payload["sha"]):
        raise ValueError("A full commit SHA is required")
    if not isinstance(payload["actor"], str) or not re.fullmatch(
        r"[a-zA-Z0-9][a-zA-Z0-9-]{0,38}(?:\[bot\])?", payload["actor"]
    ):
        raise ValueError("Invalid registry actor")
    if not isinstance(payload["token"], str) or not 1 <= len(payload["token"]) <= 4096:
        raise ValueError("A temporary registry token is required")
    if not isinstance(payload["images"], dict) or set(payload["images"]) != set(SERVICES):
        raise ValueError("Exactly three application images are required")
    for service in SERVICES:
        image = payload["images"][service]
        if not isinstance(image, str) or not re.fullmatch(
            re.escape(f"{PREFIX}/{service}@sha256:") + r"[a-f0-9]{64}", image
        ):
            raise ValueError("Only immutable images from the application registry are accepted")
    return payload


def release(payload):
    return {"sha": payload["sha"], "images": payload["images"]}


@contextlib.contextmanager
def deployment_lock(path):
    with path.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("A deployment is already running") from error
        yield


class Deployment:
    def __init__(self, root=Path("/srv/lct")):
        self.root = root
        self.state = root / "state"

    @staticmethod
    def run(args, **kwargs):
        return subprocess.run(args, check=True, timeout=600, **kwargs)

    @staticmethod
    def write_json(path, value):
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, indent=2) + "\n")
        temporary.chmod(0o600)
        temporary.replace(path)

    def compose(self, *args, **kwargs):
        return self.run(
            [
                "docker",
                "compose",
                "--project-name",
                "lct-production",
                "--env-file",
                "/etc/lct/production.env",
                "--env-file",
                str(self.state / "release.env"),
                "-f",
                str(INSTALL / "compose.yaml"),
                *args,
            ],
            **kwargs,
        )

    @staticmethod
    def check_main(payload):
        request = urllib.request.Request(
            f"https://api.github.com/repos/{REPOSITORY}/commits/main",
            headers={
                "Authorization": f"Bearer {payload['token']}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            latest = json.load(response)["sha"]
        if latest != payload["sha"]:
            raise RuntimeError("Superseded commit: only the current GitHub main may deploy")

    def check_disk(self):
        if shutil.disk_usage(self.root).free < 5 * 1024**3:
            raise RuntimeError("Less than 5 GiB free; deployment stopped before changing services")

    def pull(self, payload):
        with tempfile.TemporaryDirectory(prefix="lct-registry-") as directory:
            env = {**os.environ, "DOCKER_CONFIG": directory}
            self.run(
                ["docker", "login", "ghcr.io", "--username", payload["actor"], "--password-stdin"],
                input=payload["token"].encode(),
                env=env,
                stdout=subprocess.DEVNULL,
            )
            for image in payload["images"].values():
                self.run(["docker", "pull", image], env=env)
                result = self.run(
                    [
                        "docker",
                        "image",
                        "inspect",
                        "--format",
                        '{{index .Config.Labels "org.opencontainers.image.revision"}}',
                        image,
                    ],
                    capture_output=True,
                    text=True,
                )
                if result.stdout.strip() != payload["sha"]:
                    raise RuntimeError("Image revision does not match the requested commit")

    def backup(self, sha):
        if not (self.state / "current.json").exists():
            return
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        directory = self.root / "backups" / f"{stamp}-{sha[:12]}"
        directory.mkdir(mode=0o700, parents=True)
        with (directory / "database.dump").open("wb") as output:
            self.compose(
                "exec",
                "-T",
                "postgres",
                "sh",
                "-ec",
                'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc',
                stdout=output,
            )
        # I keep file backups independent from the application image lifecycle.
        self.run(
            ["tar", "-czf", str(directory / "files.tar.gz"), "-C", str(self.root), "data", "runs"]
        )
        shutil.copy2("/etc/lct/production.env", directory / "production.env")
        shutil.copy2(self.state / "current.json", directory / "release.json")
        for expired in sorted((self.root / "backups").iterdir())[:-7]:
            if expired.is_dir():
                shutil.rmtree(expired)

    def start(self, manifest):
        temporary = self.state / "release.env.tmp"
        temporary.write_text(
            "".join(f"{name.upper()}_IMAGE={manifest['images'][name]}\n" for name in SERVICES)
        )
        temporary.chmod(0o600)
        temporary.replace(self.state / "release.env")
        self.compose("up", "-d", "--remove-orphans", "--wait", "--wait-timeout", "240")

    def ready(self):
        # I test protected dependencies from inside API so the service token never leaves it.
        self.compose(
            "exec",
            "-T",
            "api",
            "node",
            "-e",
            "(async()=>{for(const p of ['/health','/health/database','/health/engine']){"
            "const r=await fetch('http://127.0.0.1:3001'+p,{headers:{"
            "'x-lct-service-token':process.env.API_SERVICE_TOKEN}});"
            "if(!r.ok||(await r.json()).status!=='ok')process.exit(1)}})()"
            ".catch(()=>process.exit(1))",
        )
        self.run(
            [
                "curl",
                "--fail",
                "--silent",
                "--show-error",
                "--max-time",
                "30",
                "https://lct.aweny.link/login",
            ],
            stdout=subprocess.DEVNULL,
        )

    def stop_apps(self):
        self.compose("stop", "web", "api", "engine")

    def prune_images(self):
        keep = set()
        for name in ("current.json", "previous.json"):
            path = self.state / name
            if path.exists():
                for image in json.loads(path.read_text())["images"].values():
                    result = self.run(
                        ["docker", "image", "inspect", "--format", "{{.Id}}", image],
                        capture_output=True,
                        text=True,
                    )
                    keep.add(result.stdout.strip())
        result = self.run(
            ["docker", "image", "ls", "--no-trunc", "--quiet", "--filter", f"reference={PREFIX}/*"],
            capture_output=True,
            text=True,
        )
        for image_id in set(result.stdout.split()) - keep:
            # I never force removal, so running containers remain protected by Docker too.
            self.run(["docker", "image", "rm", image_id])

    def deploy(self, payload):
        validate(payload)
        self.check_main(payload)
        self.check_disk()
        self.pull(payload)
        # I check again after pulls to avoid deploying a commit superseded during a slow pull.
        self.check_main(payload)
        current_path = self.state / "current.json"
        current = json.loads(current_path.read_text()) if current_path.exists() else None
        candidate = release(payload)
        if current == candidate:
            self.ready()
            print(f"Release {payload['sha']} is already healthy", flush=True)
            return
        self.backup(payload["sha"])
        try:
            self.start(candidate)
            self.ready()
        except Exception:
            print("Readiness failed; restoring previous application images", file=sys.stderr)
            if current:
                self.start(current)
                self.ready()
            else:
                self.stop_apps()
            raise
        if current:
            self.write_json(self.state / "previous.json", current)
        self.write_json(current_path, candidate)
        print(f"Deployed {payload['sha']}", flush=True)
        try:
            self.prune_images()
        except subprocess.CalledProcessError:
            print("Release is healthy; image cleanup needs operator attention", file=sys.stderr)


def main():
    os.umask(0o077)
    instance = Deployment()
    with deployment_lock(instance.state / "deploy.lock"):
        if sys.argv[1:] == ["--backup"]:
            current = json.loads((instance.state / "current.json").read_text())
            instance.backup(current["sha"])
            print(f"Backed up {current['sha']}")
        elif sys.argv[1:] == ["--rollback"]:
            previous = json.loads((instance.state / "previous.json").read_text())
            current = json.loads((instance.state / "current.json").read_text())
            instance.backup(previous["sha"])
            try:
                instance.start(previous)
                instance.ready()
            except Exception:
                instance.start(current)
                instance.ready()
                raise
            instance.write_json(instance.state / "previous.json", current)
            instance.write_json(instance.state / "current.json", previous)
            print(f"Rolled back to {previous['sha']}")
        elif sys.argv[1:]:
            raise ValueError("Unexpected arguments")
        else:
            body = sys.stdin.buffer.read(16385)
            if len(body) > 16384:
                raise ValueError("Release request is too large")
            instance.deploy(json.loads(body))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # I avoid echoing the request or subprocess stdin because they can contain credentials.
        print(f"Deployment failed: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
