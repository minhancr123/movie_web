# Cineon Observability and Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phát hiện lỗi thật, gửi cảnh báo, tạo backup ngoài VPS và chứng minh phục hồi dữ liệu.

**Architecture:** Sentry và Grafana ở cloud; Alloy thu chọn lọc trên host. Backup dùng cùng lock triển khai, quiesce writers rồi dump/snapshot, resume và mã hóa offsite bằng restic. Restore ở stack/máy biệt lập.

**Tech Stack:** Sentry SDK 11 ứng viên, prom-client 15.1.3 ứng viên, Grafana Alloy/Cloud, restic, MongoDB Database Tools, Redis, Python unittest, node:test.

**Spec:** [Thiết kế đã duyệt](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/specs/2026-09-24-cineon-production-devops-design.md).

## Global Constraints

- “Ban đầu thu lỗi; tracing, profiling và Session Replay tắt.”
- “Scrape ban đầu 60 giây”; Alloy ngân sách RAM 256 MiB; log/sampling có giới hạn.
- “RPO dữ liệu tối đa 24 giờ; RTO mục tiêu tối đa 2 giờ khi đã có VPS thay thế, quyền truy cập và khóa giải mã.”
- Backup 03:15 Asia/Ho_Chi_Minh; retention 7 ngày, 4 tuần, 3 tháng; cảnh báo snapshot quá 26 giờ.
- “Không rollback MongoDB bằng cách ghi đè dump tự động; không phục hồi secret đã bị thu hồi.”
- Contracts và root/lock dùng [master](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/plans/2026-09-24-cineon-devops-implementation.md), F2/F3, D1/D3.

## Review Focus

1. Token nằm trong path subtitle, nested exception hoặc breadcrumb chứ không chỉ query — O1 dùng whitelist/redaction trước gửi.
2. Cloud monitoring mất mạng hoặc không có số liệu — O2 buffer hữu hạn và dead-man/no-data alert.
3. Metric labels chứa session/user ID gây bùng cardinality — O2 label route template và test 1000 URL khác nhau.
4. Dump/restic thất bại, SIGTERM sau stop writers — B1 khôi phục trạng thái service trước đó và không cập nhật success marker.
5. Restore vào production hoặc Redis bật AOF bỏ qua RDB mới — B2 validate target trước ghi và kiểm restart sau restore.

## File Structure

`backend-node/services/observability/` gồm `redact.js`, `logger.js`, `metrics.js`; frontend có redactor tương ứng được kiểm bằng cùng fixture contract vì Docker context hai app tách biệt. `deploy/observability/` chứa Alloy/dashboard/alerts/probes. `deploy/lib/backup.py` và `restore.py` là state machines, `backup_system.py`/`restore_system.py` là adapters. Shell/systemd gọi CLI chung `deploy.ops`.

### Task O1: Redaction-first logging và Sentry

**Files:** Create `backend-node/instrument.mjs`, `backend-node/services/observability/redact.js`, `logger.js`, `backend-node/tests/production-redaction.test.mjs`, `production-sentry.test.mjs`, `frontend/src/lib/observability/redact.ts`, `frontend/src/instrumentation.ts`, `frontend/src/instrumentation-client.ts`, `frontend/sentry.server.config.ts`, `frontend/sentry.edge.config.ts`, `frontend/src/app/global-error.tsx`, `frontend/tests/production-sentry.test.mjs`; modify package/lockfiles, `frontend/next.config.js`, Dockerfiles, `backend-node/server.js:71-87`, worker/scheduler logs.

**Interfaces:** `redactEvent(event)->event|null` theo kiểu SDK, `safeRequestLog({method,route,status,durationMs,release}) -> JSON-compatible object`, `initObservability(env,transport?)` no-op nếu integration disabled. Test transport nhận event đã scrub mà không gọi Sentry thật. Backend preload dùng `node --import ./instrument.mjs ...` cho cả API/worker/scheduler.

- [ ] **1. Test đỏ canary secret**:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {redactEvent} from '../services/observability/redact.js';
test('secrets in paths and nested event data are removed', () => {
  const secret='CANARY_PRIVATE_TOKEN_42';
  const event={release:'a'.repeat(40),request:{url:'/api/playback/subtitles/vtt/'+secret},
    user:{email:secret},extra:{password:secret},breadcrumbs:[{message:secret}],
    exception:{values:[{type:'Error',value:secret}]}};
  assert.equal(JSON.stringify(redactEvent(event)).includes(secret),false);
});
```

Thêm Authorization/Cookie, URL query, URI Mongo, circular/non-JSON values ở logger, oversized message, nested stack frame vars; disabled/missing DSN không đổi response app.
- [ ] **2. Run** `node --test backend-node/tests/production-redaction.test.mjs backend-node/tests/production-sentry.test.mjs`; expected đỏ trước module.
- [ ] **3. Implement allowlist output.** Giữ event_id/timestamp/level/platform, release/environment đã validate, exception type và stack frames đã lọc; mặc định bỏ user/request/extra/breadcrumbs/arbitrary contexts. Không đưa raw exception message vào production event nếu chưa scrub được; thay bằng code lỗi kiểm soát, giữ stack hữu ích. Frames bỏ vars/source context chứa dữ liệu; URL filename bỏ query/fragment, capability paths được thay route template. Logger chỉ nhận fields allowlist, route từ registered template hoặc `unmatched`, không `req.path` cho subtitle tokens.

```js
// instrument.mjs: module SDK được nạp trước Express và business imports.
import * as Sentry from '@sentry/node';
import {redactEvent} from './services/observability/redact.js';
if (process.env.OBSERVABILITY_ENABLED === 'true' && process.env.SENTRY_DSN) {
  Sentry.init({dsn:process.env.SENTRY_DSN,environment:process.env.NODE_ENV,
    release:process.env.RELEASE_ID,sendDefaultPii:false,tracesSampleRate:0,
    beforeSend: redacted => redactEvent(redacted)});
}
```

Capture Express errors trước error response handler, giữ status không đổi; worker failures qua captureException và safe logger. Frontend instrument client/server/edge theo SDK chính thức, global error vẫn render trang lỗi hợp lý. Replay/profiling không được thêm, traces 0. DSN public build config tách token CI; quota/error rate limit và release project mapping được ghi.

Frontend registration contract:

```ts
// frontend/src/instrumentation.ts
import * as Sentry from '@sentry/nextjs';
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('../sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('../sentry.edge.config');
}
export const onRequestError = Sentry.captureRequestError;
```

Client config gọi `Sentry.init` với `NEXT_PUBLIC_SENTRY_DSN`, release build-time, tracesSampleRate 0, sendDefaultPii false, redactor và enabled flag; export `onRouterTransitionStart=Sentry.captureRouterTransitionStart`. Server/edge config dùng cùng event policy và runtime DSN. `global-error.tsx` là client component, useEffect captureException(error), render html/body và thông báo lỗi không chứa error.message/token. `withSentryConfig` chỉ upload source maps khi token CI mount có sẵn; typecheck xác nhận các SDK exports trên version đã lock.

Source map upload bằng CI secret mount trong build step, cùng RELEASE_ID; source maps không phát public khi policy đã chọn. Docker layer/history và bundle scan phải không có `SENTRY_AUTH_TOKEN`. Tích hợp SDK trước khi sửa config phải đọc docs chính thức tương ứng version 11, kiểm type API bằng build; không chép API đã deprecated từ version khác.
- [ ] **4. Verify** fake transport + console capture canaries frontend/backend; actual staging event phải có đúng release/stack và không có dữ liệu cấm. Cắt mạng Sentry, app vẫn chạy, buffer hữu hạn. Không thêm route cố tình throw public ở production; dùng script/fixture staging.
- [ ] **5. Commit** `feat: capture sanitized production errors by release`.

### Task O2: Metrics, Alloy, dashboard và cảnh báo ngoài VPS

**Files:** Create `backend-node/services/observability/metrics.js`, `backend-node/tests/production-metrics.test.mjs`, `deploy/observability/config.alloy`, `deploy/observability/collect-host.py`, `deploy/observability/dashboard.json`, `deploy/observability/alerts.yaml`, `deploy/observability/probes.json`, `deploy/tests/test_observability.py`, `deploy/systemd/cineon-alloy.service.d/limits.conf`; modify server, worker/scheduler heartbeat adapters và provision services.

**Interfaces:** `createMetrics({registry,releaseId}) -> {middleware,render,recordQueue}`; `render()->Promise<string>`. App metrics: `cineon_http_requests_total`, `cineon_http_request_duration_seconds`, `cineon_queue_waiting`, `cineon_queue_oldest_age_seconds`, `cineon_redis_memory_ratio`, `cineon_build_info`. Host helper xuất `cineon_backup_last_success_timestamp_seconds` và counters restart/OOM qua textfile collector, không đọc secret vào app metrics.

- [ ] **1. Test đỏ** 1000 request URLs khác session ID chỉ tạo route label template, không có raw ID/query. Clock fake tạo histogram quan sát 0.2/0.8/2 giây; metrics parser kiểm count/buckets. `/metrics` qua Caddy public trả 404, localhost trả valid exposition.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Registry} from 'prom-client';
import {createMetrics} from '../services/observability/metrics.js';
test('session values are absent from metric labels', async()=>{
  const metrics=createMetrics({registry:new Registry(),releaseId:'a'.repeat(40)});
  for(let i=0;i<1000;i++){
    const res=new EventEmitter(); res.statusCode=200;
    metrics.middleware({method:'GET',baseUrl:'/api',route:{path:'/items/:id'},
      path:'/api/items/private-session-'+i},res,()=>{});
    res.emit('finish');
  }
  assert.equal((await metrics.render()).includes('private-session-'),false);
});
```
- [ ] **2. Run** `node --test backend-node/tests/production-metrics.test.mjs`; `python -m unittest discover -s deploy/tests -p test_observability.py -v`.
- [ ] **3. Implement prom-client và host pipeline.** Core histogram:

```js
import {Histogram,Counter} from 'prom-client';
export function createHttpMetrics(registry) {
  return {
    duration:new Histogram({name:'cineon_http_request_duration_seconds',help:'HTTP latency',
      labelNames:['method','route','status_class'],buckets:[0.05,0.1,0.25,0.5,1,2,5],registers:[registry]}),
    requests:new Counter({name:'cineon_http_requests_total',help:'HTTP requests',
      labelNames:['method','route','status_class'],registers:[registry]}),
  };
}
```

`createMetrics` sở hữu một registry, attach middleware một lần, dùng `res.once('finish')`, methods allowlist hoặc OTHER, status class, route template hoặc unmatched. Release chỉ nằm trong build_info, không nhân label cho mọi time series. Health/metrics không làm méo latency app. Queue/Redis poll mỗi 60 giây, timeout hữu hạn; backup timestamp đọc atomic status file qua exporter host, không giả lập thành công trong app.

Alloy host exporter thu CPU/steal/mem/swap/disk/inode/network; app scrape localhost. Container restart/OOM lấy qua exporter read-only giới hạn service allowlist hoặc helper host chỉ đọc `docker inspect` định kỳ, không cho Alloy raw writable Docker socket. Logs chỉ sanitized structured events; storage/WAL tối đa theo ngân sách disk đã đo, retry backoff; systemd MemoryMax ban đầu 256M và theo dõi OOM. Validate syntax bằng version Alloy đã pin trước cài.

Chọn helper `collect-host.py` thuộc root chạy định kỳ: service allowlist cố định, đọc Docker inspect/events với argv cố định và event cursor được persist, ghi textfile `.prom` atomic, chmod 644 chỉ chứa số liệu. OOM event counter không dựa duy nhất vào State.OOMKilled tại lúc poll vì có thể bỏ sót sau restart. Alloy chỉ đọc metrics files, không có Docker socket. Test events lặp lại không double-count và thay container ID vẫn giữ label service ổn định.

Dashboard và alerts dùng metric names trên; điều kiện: web/readiness 3 probe lỗi liên tiếp; API5xx >5%/5m với ít nhất 20 requests; disk >80%, inode >85%; MemAvailable <15%/5m; OOM mới; Redis memory >80%; queue oldest >300s; backup age >26h; deploy/rollback failures. Dead-man/no-data alert không coi missing series là khỏe. External probes mỗi phút từ địa điểm đã chọn; response JSON `/ready` đúng status, certificate expiry và page identity. Email contact point phải nhận cả firing/resolved; maintenance silence có expiry.
- [ ] **4. Verify** unit + Alloy validate + promtool rule tests; tạo lỗi fixture đẩy metric đủ để fire từng alert, kiểm email thật. Ngắt cloud 10 phút trong staging đo buffer/disk/RAM, nối lại không leak token. Ghi series count/quota, không bật mọi integration mặc định.
- [ ] **5. Commit** `ops: add bounded telemetry and tested external alerts`.

### Task B1: Backup nhất quán, mã hóa và service recovery

**Files:** Create `deploy/lib/backup.py`, `backup_system.py`, `deploy/backup.sh`, `deploy/tests/test_backup.py`, `deploy/systemd/cineon-backup.service`, `cineon-backup.timer`, `deploy/backup.env.example`; extend `deploy/ops.py`, toolchain lock, provision packages/services và backup runbook.

**Interfaces:** `run_backup(io:BackupIO)->str` trả snapshot ID chỉ sau verify. `BackupIO` methods: `lock`, `preflight`, `running_services`, `maintenance_state`, `maintenance`, `stop_writers`, `capture`, `resume`, `publish`, `verify_snapshot`, `mark_success`, `notify`. Capture trả private staging path, publish dùng restic encrypted repository. `validate_database_name(value)->str` và `mongo_dump_argv(database_name,config_file,archive)->list[str]` nằm trong `backup_system.py`; database name lấy từ effective app config theo F2, không tự áp default thứ hai. Snapshot metadata bắt buộc có `databaseName` cùng counts/indexes; marker chứa timestamp/snapshot ID, không secret.

- [ ] **1. Test đỏ** fake IO fail tại stop/dump/Redis snapshot/restic/verify và interrupt; mọi nhánh resume đúng danh sách service ban đầu, không start service vốn đã stop. Không mark_success khi bất kỳ bước backup hỏng; failure notification không chứa URI. Fake runner kiểm argv mongodump không có password. Thêm fixture app DB `cineon_prod` có sentinel và DB mồi `movieweb` có dữ liệu khác: dump/restore phải lấy sentinel của `cineon_prod`, metadata ghi đúng namespace; thiếu namespace phải fail thay vì đoán default.

```python
import unittest
from types import SimpleNamespace
from contextlib import nullcontext
from deploy.lib.backup import run_backup
class BackupTest(unittest.TestCase):
    def test_dump_failure_resumes_original_services(self):
        events=[]
        def fail(): raise RuntimeError('dump failed')
        io=SimpleNamespace(lock=nullcontext,preflight=lambda:None,
          running_services=lambda:['backend-node'],maintenance_state=lambda:False,
          maintenance=lambda on:events.append(('maintenance',on)),
          stop_writers=lambda s:events.append(('stop',s)),capture=fail,
          resume=lambda s:events.append(('resume',s)))
        with self.assertRaisesRegex(RuntimeError,'dump failed'): run_backup(io)
        self.assertIn(('resume',['backend-node']),events)
        self.assertEqual(events[-1],('maintenance',False))
```
- [ ] **2. Run** `python -m unittest discover -s deploy/tests -p test_backup.py -v`.
- [ ] **3. Implement recovery-first flow:**

```python
def run_backup(io):
    with io.lock():
        io.preflight()
        running = io.running_services()
        was_maintenance = io.maintenance_state()
        try:
            io.maintenance(True)
            io.stop_writers(running)
            staging = io.capture()
        finally:
            io.resume(running)
            io.maintenance(was_maintenance)
        snapshot = io.publish(staging)
        io.verify_snapshot(snapshot)
        io.mark_success(snapshot)
        return snapshot
```

Adapter giữ journal operation và catches signal để đi qua finally; SIGKILL/power loss được phục hồi khi service/host lên bằng kiểm journal + readiness trước bỏ maintenance. `resume` xác minh readiness, lỗi resume giữ maintenance và alert ưu tiên, không mở trang khi app chưa lên. Capture error và recovery error ghi hai trạng thái riêng. Secrets staging chmod 700/600; cleanup chỉ thư mục tạm đã resolve thuộc spool, chạy sau publish/verify hoặc lưu theo retention sự cố có hạn, không xóa dữ liệu nguồn.

Preflight bảo đảm single writer domain, lock D3, đủ temp/disk/RAM, correct Mongo tools version, latest release/schema, S3 endpoint private credentials và restic key có bản bên ngoài. Host resolve `MONGODB_DB_NAME` từ cùng effective env mà Compose cấp cho app, giữ default/validator tương thích F2 bằng contract tests; không source `.env` bằng shell. Chốt `databaseName` một lần cho toàn snapshot, đối chiếu tên DB với app config rồi lưu metadata trước capture. Drain/stop tất cả app writers, ghi trạng thái trước đó; không stop Redis. Chạy argv dưới đây khi writers đã dừng; không `--oplog` với `--db`.

```python
import re
def validate_database_name(value):
    if not isinstance(value,str) or not re.fullmatch(r'[a-zA-Z0-9_-]+',value):
        raise ValueError('invalid database name')
    return value

def mongo_dump_argv(database_name, config_file, archive):
    name = validate_database_name(database_name)
    return ['mongodump', '--config='+str(config_file), '--db='+name,
            '--archive='+str(archive), '--gzip']
```

Private Mongo config chứa URI/credential; không đưa chúng vào argv/log. `redis-cli SAVE` rồi copy RDB hoàn chỉnh vào spool, không copy live AOF. Include config/current manifest/keyring/secrets cần restore, exclude video cache/layers. Resume app ngay sau capture; upload encrypted offsite sau đó nhưng vẫn giữ ops lock để không chồng thao tác.

Timer `OnCalendar=*-*-* 03:15:00 Asia/Ho_Chi_Minh`, Persistent=true; deadline toàn operation được đặt theo baseline. Retention `--keep-daily 7 --keep-weekly 4 --keep-monthly 3`; prune job riêng sau snapshot thành công, không chạy tự động nếu repo check lỗi. S3 encryption bằng restic trước upload; repository password không nằm duy nhất trong backup; secret mount/env không xuất vào log. Restic/Mongo tools binary/version/checksum ghi toolchain inventory; snapshot metadata chứa compatible Mongo/Redis versions.
- [ ] **4. Verify Linux** với Mongo/Redis fixture và writes trước/during maintenance: dump restore nhất quán, restic repository trên S3-compatible test service tách filesystem hoặc bucket thử; cố tình invalid credential rồi chứng minh website resumed và marker không đổi. Sau đó backup bucket thật, đọc/verify snapshot thật và gửi heartbeat.
- [ ] **5. Commit** `ops: create recoverable encrypted offsite backups`.

### Task B2: Restore drill và disaster-recovery runbook

**Files:** Create `deploy/lib/restore.py`, `restore_system.py`, `deploy/restore-drill.sh`, `deploy/tests/test_restore.py`, `deploy/compose.restore.yml`, `docs/cineon-deployment/RESTORE_RUNBOOK.md`; extend runtime drill config và ops CLI.

**Interfaces:** `validate_restore_target(target:str,production_db:str)->str`; `restore_drill(snapshot,target,io)->dict` báo counts/indexes/key-decrypt/health/queue/elapsed. `mongo_restore_argv(metadata,target,production_db,config_file,archive)->list[str]` nằm trong `restore_system.py`, import `validate_database_name` từ B1 và `validate_restore_target` từ `restore.py`. IO target chỉ stack biệt lập, không có credential production-write. `RESTORE_DRILL=true`, DB name từ F2, JOB_QUEUE_NAME riêng, external notifications/provider requests disabled.

- [ ] **1. Test đỏ target guard:**

```python
import unittest
from deploy.lib.restore import validate_restore_target
class RestoreTest(unittest.TestCase):
    def test_production_or_path_is_rejected(self):
        for name in ['movieweb','../movieweb','movieweb_restore_','admin']:
            with self.assertRaises(ValueError): validate_restore_target(name,'movieweb')
```

Thêm snapshot/key sai, old Redis data dir tồn tại, cross-version restore incompatibility, external notification attempt, archive partial failure; fake IO khẳng định target invalid chưa gọi subprocess nào.
- [ ] **2. Run** `python -m unittest discover -s deploy/tests -p test_restore.py -v`.
- [ ] **3. Implement guard và restore tuần tự:**

```python
import re
def validate_restore_target(target, production_db):
    if target == production_db or not re.fullmatch(r'movieweb_restore_[a-z0-9_-]+',target):
        raise ValueError('invalid restore target')
    return target
```

Runner/máy thử lấy snapshot đã verify, giữ file permissions; Mongo temporary instance/version tương thích, restore archive với namespace lấy từ `metadata.databaseName` đã ghi khi backup, không lấy default hoặc tên DB đang cấu hình trên máy restore. Thiếu/malformed metadata bị từ chối trước subprocess; snapshot cũ cần inventory/metadata xác minh riêng trước khi dùng. `production_db` là tên DB production hiệu lực để chặn nhầm target, không quyết định source namespace.

```python
# Helpers import từ backup_system.py và restore.py như contract phía trên.
def mongo_restore_argv(metadata, target, production_db, config_file, archive):
    source = validate_database_name(metadata.get('databaseName'))
    destination = validate_restore_target(target, production_db)
    return ['mongorestore', '--config='+str(config_file), '--archive='+str(archive),
            '--gzip', '--nsInclude='+source+'.*', '--nsFrom='+source+'.*',
            '--nsTo='+destination+'.*']
```

Không dùng URI production user; không dùng drop trên DB khác. So counts, index và mẫu user/history/favorite với metadata snapshot; DB name app phải target thật, không chỉ URI khác. Test B1/B2 cùng fixture `cineon_prod` và DB mồi `movieweb`, thêm case cấu hình máy restore khác source snapshot nhưng mapping vẫn đúng.

Redis restore vào volume mới riêng: load RDB với AOF tắt, verify dataset, bật AOF và đợi rewrite, restart rồi verify lại. Không copy RDB vào instance AOF đang chạy rồi giả định dữ liệu được nạp. Giữ queue gốc dưới quarantine để kiểm tra; smoke job dùng queue riêng, worker notification/business side effects không tự chạy. Runbook production recovery phải có bước reconciliation/dedup trước mở worker; không hứa exactly-once.

Offline decrypt fixture provider token bằng keyring đã restore để chứng minh recoverability, không gọi provider thật. Khởi động app images đúng manifest, probe health/auth bằng account fixture, ghi elapsed; block external SMTP/webhooks ở network thử. Cleanup chỉ stack/volume có label drill-ID đã kiểm tra, không xóa root/volume production. Disaster recovery document đi từ máy trống → provision → secrets → data → image → verify → mở traffic, có kiểm ngày backup và secret rotation.
- [ ] **4. Verify snapshot ngoài VPS thật** trong drill host, đo RPO/RTO theo master; chạy lại sau schema change và hằng tháng. Lưu report JSON đã lọc, snapshot ID và các check, không đưa bản dump chứa dữ liệu vào repo. Hỏng một file/key phải làm drill fail rõ, không báo partial restore là pass.
- [ ] **5. Commit** `ops: prove isolated restoration and document disaster recovery`.
