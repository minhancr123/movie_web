# Cineon Release and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy đúng release bất biến, bảo vệ dữ liệu hiện có và rollback tất cả service khi bất kỳ gate thất bại.

**Architecture:** Python standard library điều phối Docker/Caddy trên host qua argv, Bash làm entry point. Một manifest và một lock dùng chung deploy/rollback/backup; con trỏ release chỉ được commit sau verify.

**Tech Stack:** Python 3, Bash, Docker Compose, Caddy, GitHub Actions, unittest, JSON.

**Spec:** [Thiết kế đã duyệt](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/specs/2026-09-24-cineon-production-devops-design.md).

## Global Constraints

- Root production `/opt/movieweb`; Ubuntu 24.04; một VPS, không hứa zero-downtime.
- “Giữ tối thiểu 6 GB disk trống.” Giữ image current/previous và volume dữ liệu.
- “Không rollback MongoDB bằng cách ghi đè dump tự động; không phục hồi secret đã bị thu hồi.”
- Chạy sau F1–F4 và đọc [master](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/plans/2026-09-24-cineon-devops-implementation.md), đặc biệt manifest schema và resource limits.

## Review Focus

1. Tar member `../`, symlink/hardlink hoặc digest giả — D1 từ chối trước extraction/exec.
2. Máy có website hoặc volume cũ — D2 chỉ adopt đúng inventory, giữ cấu hình khác.
3. Pull/disk lỗi trước switch — D3 không restart ứng dụng đang khỏe.
4. Frontend/FFmpeg/post-check lỗi sau API xanh — D3 rollback cả nhóm và báo failed.
5. Hai workflow/manual deploy cùng lúc hoặc frontend 200 sai release — D3/D4 serialize và so release marker.

## File Structure

`deploy/lib/manifest.py` chỉ validate; `preflight.py` kiểm tra môi trường; `transaction.py` state machine thuần; `system.py` adapter side effects; `deploy/ops.py` CLI. Shell wrappers gọi module sau khi xác định thư mục script. `deploy/tests/support.py` tạo release/bundle fixture bằng tempdir, không dùng production config. `deploy/provision/` tách packages, services và SSH hardening.

### Task D1: Manifest, bundle validation và preflight

**Files:** Create `deploy/__init__.py`, `deploy/lib/__init__.py`, `deploy/lib/manifest.py`, `deploy/lib/preflight.py`, `deploy/ops.py`, `deploy/tests/__init__.py`, `deploy/tests/support.py`, `deploy/tests/test_manifest.py`, `deploy/tests/test_preflight.py`; create `deploy/release.schema.json` và `tools/build-release.mjs`.

**Interfaces:** `validate_manifest(data:dict)->dict`, `verify_bundle(bundle:Path,staging:Path)->dict`, `preflight(root:Path,release:dict,host)->None`. `make_release(seed='a')->dict` và `make_bundle(tmp_path)->Path` là test helpers. CLI `python3 -m deploy.ops preflight --root ... --bundle ...`; lỗi cấu hình exit 2, lỗi vận hành exit 1.

- [ ] **1. Test đỏ traversal/digest/secret.** `make_release` tạo đầy đủ schema master: SHA `seed*40`, backend digest `seed*64`, frontend digest `'b'*64`, config version 1, backward-compatible, UTC createdAt, tests passed. Hash `files` được tính từ fixture files thật trong `make_bundle`, không hardcode thành công.

```python
import unittest
from deploy.lib.manifest import validate_manifest
from deploy.tests.support import make_release
class ManifestTest(unittest.TestCase):
    def test_rejects_escape_before_extract(self):
        r = make_release()
        r['files']['../shared/app.env'] = 'c' * 64
        with self.assertRaises(ValueError): validate_manifest(r)
    def test_requires_digest(self):
        r = make_release(); r['images']['backend'] = 'example/app:latest'
        with self.assertRaises(ValueError): validate_manifest(r)
```

- [ ] **2. Chạy** `python -m unittest discover -s deploy/tests -p test_manifest.py -v`; expected module missing hoặc validation chưa đúng.
- [ ] **3. Implement validation trước mọi extraction.** Core path validator:

```python
from pathlib import PurePosixPath
import re
def validate_member(name):
    p = PurePosixPath(name)
    if not name or '\\' in name or ':' in name or p.is_absolute() or '..' in p.parts:
        raise ValueError('invalid bundle member')
    if name != str(p) or name.startswith('./'):
        raise ValueError('noncanonical bundle member')
    if any(x in {'.env','app.env','.git','id_rsa','id_ed25519'} for x in p.parts):
        raise ValueError('forbidden bundle member')
    return p
```

Manifest schema reject unknown fields, mismatch commit/release, digest không đủ 64 hex, test khác passed, schema/config version lạ. `verify_bundle` xét toàn bộ tar member trước ghi; reject symlink/hardlink/device, duplicate names, member không có trong manifest (trừ manifest/directory đã kiểm tra), file size/tổng size vượt ngân sách; giải nén file thường vào tempdir có quyền riêng và kiểm SHA256. Chỉ rename staging thành release dir khi tất cả checks pass. JSON không được eval; env không được source.

`preflight`: root đúng marker Cineon, không phải `/` hoặc symlink; Python/Docker/Compose/Caddy có version đã ghi; volume map đã adopt; secrets bắt buộc chỉ kiểm tên/tính hợp lệ; free space đủ 6 GB + ước lượng image mới + staging trước pull và kiểm lại sau pull; backup age theo policy, ngoại lệ first-empty-install phải được ghi là bootstrap chưa có dữ liệu. Root mount/file permission sai thì fail. Không ghi `docker compose config` có env values vào report public.
- [ ] **4. Test thêm** archive symlink, Windows backslash/drive path, file checksum sai, unknown schema, thiếu env, root symlink, disk thiếu trước pull, backup stale và first install. `python -m unittest discover -s deploy/tests -p 'test_*flight.py' -v` cùng manifest tests phải xanh; fake host ghi không có side effect trước validation.
- [ ] **5. Commit** `feat: validate immutable release bundles before deployment`.

### Task D2: Provision idempotent và adopt existing volumes

**Files:** Create `deploy/provision.sh`, `deploy/provision/packages.sh`, `services.sh`, `ssh-hardening.sh`, `deploy/lib/adopt.py`, `deploy/tests/test_provision.py`; modify `deploy/Caddyfile` thành import layout giữ site khác; create `deploy/systemd/cineon-ops.env.example`.

**Interfaces:** `deploy/provision.sh --phase packages|services|ssh-hardening`; `adopt_inventory(docker_inspect:list)->{redisVolume:str,transcodesVolume:str}` ghi mapping sau kiểm tra. SSH hardening là phase tách, chỉ chạy sau xác minh session key thứ hai và console.

- [ ] **1. Test đỏ** chạy provision services hai lần với fake filesystem/runner; checksum app.env, authorized_keys và Caddy site khác không đổi. Inventory có hai Redis volume ứng viên phải fail chứ không chọn ngẫu nhiên.

```python
import unittest
from deploy.lib.adopt import adopt_inventory
class AdoptTest(unittest.TestCase):
    def test_ambiguous_redis_volume_is_rejected(self):
        rows=[{'Config':{'Labels':{'com.docker.compose.service':'redis'}},
               'Mounts':[{'Type':'volume','Name':name,'Destination':'/data'}]}
              for name in ['redis-old','redis-new']]
        with self.assertRaises(ValueError): adopt_inventory(rows)
```
- [ ] **2. Chạy** `python -m unittest discover -s deploy/tests -p test_provision.py -v`.
- [ ] **3. Implement guard và cài có kiểm soát.** Guard shell:

```bash
set -euo pipefail
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { echo 'Ubuntu 24.04 required' >&2; exit 2; }
install -d -m 0750 /opt/movieweb/releases /opt/movieweb/incoming
install -d -m 0700 /opt/movieweb/shared
```

`packages.sh` cài Python3, CA certificates, curl, GnuPG, jq, Docker/Compose từ Docker apt repository và Caddy từ repository chính thức có signed-by riêng; kiểm tra fingerprint/key source và ghi dpkg versions vào inventory. Package đã cài thì không tự major-upgrade khi rerun. Giữ `apt` updates/security policy tách với rollout app. Restic/Mongo tools/Alloy được thêm ở B1/O2 bằng version đã kiểm chứng.

`services.sh` tạo deploy user nếu thiếu; không thay password/account có sẵn; app.env tạo chỉ khi chưa có và chmod 600. Host Caddy import fragment Cineon; backup config trước thay, validate rồi reload, giữ mọi block khác. Caddy cert dữ liệu có persistence trên host. Firewall cho SSH port hiện tại và 80/443; kiểm cả IPv4/IPv6, giữ kết nối quản trị; kiểm bằng probe ngoài host. Docker API/Redis/3000/5001 không public. Không khóa toàn port 443 về Cloudflare vì media DNS-only cùng máy.

Ở D2, web profile ban đầu dùng DNS-only và routing từ kit đã kiểm tra, thêm `/api/health` tới frontend và `/ready` tới backend, chặn public `/metrics`/diagnostic. Như vậy smoke D3 hoạt động trước C2; C2 chỉ bổ sung profile Cloudflare trust và media hostname. Integration D2/D3 có thể dùng Caddy internal CA trên hostname fixture với CA được tin cậy rõ ràng; không dùng `curl -k` để coi TLS production đã được kiểm chứng.

Adopt đọc `docker inspect` mounts của service cũ; xác minh label, data và tên volume, lưu `REDIS_VOLUME/TRANSCODES_VOLUME`. Không dùng Compose project name mới rồi tạo volume rỗng. Nếu máy trống, provision tạo volume mới có label Cineon và ghi inventory. Kiểm UID/GID writer trước đổi non-root container.

`ssh-hardening.sh` giữ bản config có thể phục hồi, `sshd -t` trước reload; cài đúng public key, sau đó mới tắt password/root login theo policy. Hướng dẫn console rollback nằm trong runbook của task, không tự chặn session chưa kiểm chứng.
- [ ] **4. Verify Linux VM hai lượt:** diff chỉ timestamp inventory; app data/secrets/site khác còn nguyên; test SSH mới, TLS, firewall và non-root volume writes. Fail test nếu provision reload config invalid.
- [ ] **5. Commit** `ops: provision Ubuntu host without replacing existing data`.

### Task D3: Transaction deploy và full-stack rollback

**Files:** Create `deploy/lib/transaction.py`, `system.py`, `deploy/deploy.sh`, `rollback.sh`, `smoke.sh`, `deploy/tests/test_transaction.py`, `test_system.py`; extend `deploy/ops.py`; migrate root `deploy.sh` thành wrapper tới entry mới sau khi bảo toàn giao diện được dùng.

**Interfaces:** `deploy_release(release:dict,io:DeployIO)->None`; `DeployIO` cung cấp `lock()` context manager, `current()`, `maintenance_state()->bool`, `preflight(release)`, `pull(release)`, `journal_begin(release,previous,was_maintenance)`, `journal_phase(phase)`, `maintenance(bool)`, `apply(release)`, `verify(release)`, `commit(release,previous)`, `restore_current(previous)`, `stop_candidate()`, `notify(event)`. `current()` giữ snapshot metadata trước transaction trong adapter; `restore_current` dùng snapshot đó để khôi phục cả pointers/journal, không đặt release thất bại thành previous. `journal_begin` ghi atomic/durable trạng thái trước mutation đầu tiên; `journal_phase('applying')` được ghi trước khi đổi app. `DeploymentFailed`, `RollbackFailed` là exception riêng; CLI map cả hai sang exit 1 và event phân biệt.

- [ ] **1. Test đỏ fault injection** fake IO ghi event list; `apply`/`verify` có failpoint chỉ cho candidate. Test frontend 200 sai release, FFmpeg missing, queue smoke lỗi, pull lỗi trước switch, rollback lỗi và first install không có previous. Thêm failpoint bật maintenance đã đổi proxy rồi mới timeout: giữ app cũ, khôi phục trạng thái maintenance ban đầu cả true/false, phát event lỗi và giữ exit nonzero; không gọi apply khi app chưa bị đổi. Journal phải đứng trước mutation; lỗi ghi journal chưa được đụng proxy. RF3 test tối thiểu phải assert chuỗi `apply(new), verify(new), apply(old), verify(old)` và exception `DeploymentFailed`.

```python
import unittest
from contextlib import nullcontext
from deploy.lib.transaction import deploy_release, DeploymentFailed
from deploy.tests.support import make_release
class TransactionTest(unittest.TestCase):
    def test_bad_frontend_restores_whole_release(self):
        old,new=make_release('a'),make_release('b'); events=[]
        class IO:
            def lock(self): return nullcontext()
            def current(self): return old
            def maintenance_state(self): return False
            def preflight(self,r): return None
            def pull(self,r): return None
            def journal_begin(self,r,p,m): events.append(('journal_begin',r['releaseId']))
            def journal_phase(self,p): events.append(('phase',p))
            def maintenance(self,on): events.append(('maintenance',on))
            def apply(self,r): events.append(('apply',r['releaseId']))
            def verify(self,r):
                if r==new: raise RuntimeError('frontend release mismatch')
            def restore_current(self,r): events.append(('restored',r['releaseId']))
            def commit(self,r,p): events.append(('commit',r['releaseId']))
            def notify(self,event): events.append(('notify',event))
        with self.assertRaises(DeploymentFailed): deploy_release(new,IO())
        self.assertIn(('apply',old['releaseId']),events)
        self.assertNotIn(('commit',new['releaseId']),events)
```
- [ ] **2. Run** `python -m unittest discover -s deploy/tests -p test_transaction.py -v`.
- [ ] **3. Implement state machine** (core dưới là code dùng trong module; định nghĩa hai exception cùng module):

```python
class DeploymentFailed(RuntimeError): pass
class RollbackFailed(RuntimeError): pass
def deploy_release(release, io):
    with io.lock():
        previous = io.current()
        was_maintenance = io.maintenance_state()
        io.preflight(release)
        io.pull(release)
        io.journal_begin(release, previous, was_maintenance)
        apply_started = False
        try:
            io.maintenance(True)
            io.journal_phase('applying')
            apply_started = True
            io.apply(release)
            io.verify(release)
            io.maintenance(False)
            io.commit(release, previous)
        except Exception as original:
            try:
                if not apply_started:
                    io.maintenance(was_maintenance)
                    io.restore_current(previous)
                else:
                    io.maintenance(True)
                    if previous is None:
                        io.stop_candidate()
                        io.restore_current(None)
                    else:
                        io.apply(previous)
                        io.verify(previous)
                        io.restore_current(previous)
                        io.maintenance(was_maintenance)
            except Exception as rollback_error:
                io.notify('rollback_failed')
                raise RollbackFailed('rollback_failed') from rollback_error
            io.notify('deploy_failed')
            raise DeploymentFailed('deploy_failed') from original
        io.notify('deploy_succeeded')
```

Adapter must make `commit` pointer updates atomic/recoverable; if interrupted while committing metadata, startup reconciles journal and validates service release before trusting current. `journal_begin` persists previous proxy/maintenance state before enabling maintenance; failure leaves proxy/app untouched. A journal still in preparation restores the old proxy state without restarting unchanged app services. Persist phase `applying` before app mutation; restart recovery in that phase keeps maintenance until either candidate verified or previous restored. Recovery restores the recorded prior maintenance state, not unconditional false; first install with a failed candidate and no previous release stays in maintenance. Notifications are best-effort and must not replace original errors; maintenance disable failure is a deployment failure requiring alert/recovery, not a success. Add tests for partial maintenance activation, journal write failure and these adapter branches beyond the core flow.

`system.py` uses `fcntl.flock(LOCK_EX|LOCK_NB)` shared ops.lock; no nested lock reacquisition from rollback. Subprocess argv arrays with timeout, sanitized stderr. `apply` does Compose up for frontend/backend/worker/scheduler with stable project/env/volumes; does not use `down -v`, prune all, reset git or retag latest. Redis version unchanged in app rollout. Caddy changes validate/backup/reload then restore correct fragment on rollback.

`verify` checks backend `/ready`, frontend `/api/health`, both RELEASE_ID, auth route status contracts, ffmpeg/ffprobe, worker/scheduler heartbeats and queue nonce; checks public HTTPS with no-store release endpoint. Retry to a deadline, never unbounded loops. `commit` writes journal/manifest hashes and atomic symlinks; retains previous images. Manual rollback uses same validation/apply/verify logic but does not roll back DB or revoked secrets.

Previous release phải có manifest hợp lệ và đã qua hardening F2; không tự coi image legacy chứa seed mặc định là rollback target an toàn. Lần migrate hệ thống cũ phải ghi rõ previous có được chấp nhận hay first hardened release chưa có target, giữ maintenance khi rollback target chưa hợp lệ. D3 fixture dùng hai release đã hardened để kiểm transaction.

Wrapper determines its own source root then invokes `python3 -m deploy.ops deploy|rollback`; validates production root before filesystem moves. Fault tests use temp roots injected into adapters, not production CLI bypass flags.
- [ ] **4. Verify** fixture CLI exit codes, then two real small Linux release images: fail only frontend while backend healthy; prove all four services use previous digests, data persists, maintenance recovers, failed rollout stays nonzero. Kill orchestrator after apply to exercise journal recovery. Test two processes share the same lock.
- [ ] **5. Commit** `feat: deploy and roll back complete application releases`.

### Task D4: CI/build/publish/deploy gates

**Files:** Modify `.github/workflows/ci.yml`, `deploy.yml`; create `.github/dependabot.yml`, `tools/pin-actions.mjs`, `deploy/actions.lock.json`, `deploy/tests/test_workflow_contract.py`; extend `tools/build-release.mjs` from D1.

**Interfaces:** CI emits release bundle + checksums + backend/frontend digests; deploy consumes the exact artifact from the same successful run/commit. `pin-actions.mjs` resolves allowed action repository/tag through git and records commit SHA, never executes fetched code locally. `build-release.mjs` reads toolchain/action locks, image outputs and gate evidence, emits schema D1.

- [ ] **1. Test đỏ** parse YAML with pinned test dependency: reject production mutable tags, missing needs/concurrency, shell secret interpolation, unpinned `uses`, `git reset --hard`, backend-only rollback or source-map auth token build ARG. Test main/master guards and that fork PR has no production secrets.

```python
import unittest,re
from pathlib import Path
class WorkflowTest(unittest.TestCase):
    def test_remote_actions_are_pinned_to_commit(self):
        s=Path('.github/workflows/deploy.yml').read_text(encoding='utf-8')
        refs=re.findall(r'^\s*(?:-\s*)?uses:\s*([^\s#]+)',s,re.M)
        for ref in refs:
            if not ref.startswith('./'): self.assertRegex(ref,r'^[\w./-]+@[0-9a-f]{40}$')
        self.assertNotIn('git reset --quiet --hard',s)
```

Unit source checks này bổ sung YAML parser/actionlint, không thay thế parse/actual CI run. Pin test parser trong `tools/requirements-dev.txt`, cài vào môi trường dev/CI, không cần trên host deployment.
- [ ] **2. Run** `python -m unittest discover -s deploy/tests -p test_workflow_contract.py -v`; expected current workflow violates several invariants.
- [ ] **3. Implement workflow semantics**:

```yaml
permissions:
  contents: read
concurrency:
  group: cineon-production
  cancel-in-progress: false
# Production job giữ environment hiện có: Production Environments.
# Build và deploy chỉ nhận artifact sau needs: test thành công.
```

CI: checkout exact SHA; Node24; FFmpeg verify; npm ci; F1 test runner một lượt; lint/typecheck/build; ops tests; Docker build/scan; generate SBOM and retain reports. Fail high/critical runtime vulnerability chưa có ngoại lệ rõ owner/lý do/expiry; không tự force dependency fixes. Build frontend public config/RELEASE_ID tại build time; SENTRY_AUTH_TOKEN qua BuildKit secret nếu bật O1, không vào runtime. Push tags SHA để truy vết nhưng manifest dùng digest output thật.

Action pin tool dùng `git ls-remote <allowlisted repo> refs/tags/<tag> refs/tags/<tag>^{}`; ưu tiên peeled commit nếu annotated, validate 40 hex rồi thay `uses` bằng SHA và giữ version comment. Review diff trước commit; Dependabot cập nhật có CI. Hạn chế token registry vào job publish, pull-only trên VPS.

Giữ manual `workflow_dispatch` và main/master release policy; dùng environment approval khi tài khoản GitHub hỗ trợ và đã cấu hình. Nếu approval không có, production chỉ manual dispatch trên nhánh release đã bảo vệ, không tự fallback thành auto-deploy. SSH `StrictHostKeyChecking=yes` và known_hosts fingerprint được xác minh ngoài CI; upload bundle bằng argv/SSH file transfer, remote command chỉ gọi script D3 với release ID đã validate. Không dùng `ssh-keyscan` đơn độc làm nguồn tin cậy.

D4 thử CI trên branch trước, không kết nối production trong PR. Thêm health gate tất cả subsystem trước lần public đầu; workflow không biến placeholder/missing cloud config thành passed.
- [ ] **4. Verify** actual CI run và artifact provenance; dùng VPS staging/VM cùng Ubuntu để rollout, fail post-check để quan sát rollback D3, chứng minh job thất bại ngay cả khi rollback thành công. Xác minh hai trigger không chồng nhau.
- [ ] **5. Commit** `ci: publish verified digests and serialize production releases`.
