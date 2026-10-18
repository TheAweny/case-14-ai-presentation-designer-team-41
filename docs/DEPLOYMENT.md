# Production delivery

Production: <https://lct.aweny.link>, MWS `vm-kerweb`, static IP `111.88.131.31`.
Delivery source: **GitHub TheAweny/case-14-ai-presentation-designer-team-41, main**.
SourceCraft remains a separate remote and does not trigger production.

## Team workflow

Push or merge changes into GitHub main. The author does not matter: CI runs for every push.
`CI` checks lint, TypeScript/Python types, boundaries, code generation, fixtures, tests, builds
and licenses. Only its successful completion starts `Production CD`. No path filter skips a
teammate's application changes. PR runs cannot deploy. `workflow_dispatch` retries delivery of
main only, and still requires successful CI for the exact SHA. Old superseded commits are refused.

`Production CD` builds amd64 engine/API/web images on the GitHub runner, pushes private GHCR
packages, and passes immutable digests to the receiver. A single job-scoped GITHUB_TOKEN permits
pulling images; the server erases its temporary registry configuration afterward. No long-lived
GitHub token is installed on the server. Actions used by CD are pinned to commit SHA.

The production SSH private key is in repository secret `LCT_DEPLOY_KEY`; the verified server host
key is in `LCT_DEPLOY_KNOWN_HOSTS`. The key grants only a root-owned, argument-free release
receiver. It cannot open a shell, forward ports, replace Compose or execute repository scripts.
The receiver validates repository/image prefixes, commit and digests, and checks image revision
labels. It checks GitHub main again after image pulls. The host lock and workflow concurrency
serialize releases. A new main arriving after the final check is delivered by the next run.
Treat write access to main and editing Actions/secrets as production authority.

## Runtime and storage

The reviewed host infrastructure is in `infra/deploy/`; it is installed under
`/usr/local/lib/lct`. Local `compose.yaml` is unchanged. Production Compose pulls prebuilt images;
only web port 3000 is bound, on **127.0.0.1**. Nginx terminates HTTPS, preserves the request host,
sets forwarding headers itself and streams SSE/uploads without proxy buffering. Database, engine,
API and search have no published ports. App processes use UID 1000, read-only root filesystems,
dropped capabilities and no-new-privileges. PostgreSQL and search also have no-new-privileges.
Memory/CPU and log limits prevent an unbounded service from exhausting the host.

- `/etc/lct/production.env`: root-only secrets, unique database/service/session/encryption keys.
- `/srv/lct/postgres`: persistent database, UID 999.
- `/srv/lct/data`, `/srv/lct/runs`: persistent uploads, exports and workflow state, UID 1000.
- `/srv/lct/fonts`: optional licensed template fonts, mounted read-only.
- `/srv/lct/state/current.json`, `previous.json`: successful release digests, no credentials.
- `/srv/lct/state/release.env`: active image selection.
- `/srv/lct/backups`: up to seven pre-deployment backups; database dump, data/runs, environment,
  previous release. Root-only; these files contain user data and secrets.

Never regenerate MODEL_KEYS_SECRET or AUTH_SECRET during deployments. Do not run `down -v`,
change PostgreSQL major versions in place or copy `.env` into an image. Administrator accounts and
model settings live in the database. New users are created in the UI by an administrator.

## Health and rollback

Images are pulled before replacing application services. Before upgrade, application writers are
paused for a matching PostgreSQL/files snapshot and resumed even if the snapshot fails.
Docker readiness waits for engine/API/database/web, followed by
protected `/health/database` and `/health/engine` checks and public HTTPS. Failure restores the
previous images and checks readiness again; the successful-release manifest is updated only after
all checks pass. A first-install failure stops application containers and fails the job.

Manual image rollback, over the operator's existing SSH access:

```sh
ssh mws-web 'sudo -n /usr/local/lib/lct/deploy.py --rollback'
```

Rollback is for application images. Migrations run at API start and **must be backward compatible**
with the previous application (expand/contract). Never automatically restore a live database:
that would destroy writes made after a backup. For destructive schema recovery, stop the apps,
select a verified backup, restore PostgreSQL using pg_restore and restore matching files with an
operator-approved maintenance plan. Daily backups are live and their files can include writes
concurrent with the database snapshot; pre-deployment snapshots pause application writers.

This is a single host: replacement can briefly interrupt requests and in-flight generation.
It does not provide zero downtime or high availability. Same-disk snapshots are not disaster
recovery: configure off-host encrypted backup storage before relying on recovery from disk loss.
There is a 5 GiB free-disk guard; successful deployments remove obsolete application images while
retaining current and previous digests. Registry build caches and release images also need a
retention policy for long-term use.

`lct-backup.timer` also runs a daily live backup at 03:00 UTC with up to 15 minutes of jitter;
the deployment lock prevents simultaneous backups and releases. Check failures with
`journalctl -u lct-backup.service`. Seven successful backup directories are retained.

## Operations

```sh
ssh mws-web 'sudo -n cat /srv/lct/state/current.json'
ssh mws-web 'sudo -n docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"'
gh run list --repo TheAweny/case-14-ai-presentation-designer-team-41 --workflow cd.yml
gh workflow run cd.yml --repo TheAweny/case-14-ai-presentation-designer-team-41 --ref main
curl -fsSI https://lct.aweny.link/login
```

To update host infrastructure, review the change, copy `infra/deploy` and `infra/searxng` through
operator SSH and run `sudo bash infra/deploy/install.sh /path/to/cd-public-key`.
CI cannot perform that administrative operation. Nginx TLS config and certbot remain host-managed;
`infra/deploy/nginx-location.conf` documents the HTTPS server's proxy location. Certbot automatic
renewal stays enabled. Rotate the CD key by installing its new public key and replacing the
repository secret, then verify a release before deleting the old local key.

Initial admin credentials are delivered in a local owner-only file, never Actions output or Git.
Model availability is a separate dependency: deployment health does not prove a paid model call or
a complete presentation export. Production is configured from the operator's existing model
endpoints without selecting the fake provider.
