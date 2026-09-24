# Cineon Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo nền ứng dụng production có test, runtime được hỗ trợ, auth bootstrap an toàn và readiness thật.

**Architecture:** Giữ Express/Next.js hiện hữu; tách helper nhỏ có dependency injection để test không chạm database production. Thay cấu hình Docker chính bằng nguồn chuẩn, không duy trì một stack mẫu khác.

**Tech Stack:** Node 24, Next.js 16, React 19, MongoDB driver, ioredis/BullMQ, Docker Compose, node:test.

**Spec:** [Thiết kế đã duyệt](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/specs/2026-09-24-cineon-production-devops-design.md).

## Global Constraints

- Ubuntu 24.04 LTS, 1 vCPU, RAM 4 GB, NVMe 30 GB; MongoDB ngoài VPS.
- `VIDEO_TRANSCODE_FALLBACK=never`, `REMUX_MAX_WRITERS=1`; cache 3 GB mỗi nhóm; giữ tối thiểu 6 GB disk trống.
- Backend/frontend/Redis/worker/scheduler: 1280/768/512/256/192 MiB. Redis `noeviction`, AOF.
- Dùng toàn bộ hợp đồng, bảo toàn working tree và evidence rules trong [master](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/plans/2026-09-24-cineon-devops-implementation.md).

## Review Focus

1. Dependency peer range hợp lệ nhưng production build/typecheck vẫn lỗi — F1 phải build thật, không bỏ qua lỗi.
2. Test media bị skip tạo kết quả xanh giả — F1 ghi inventory và fail khi thiếu FFmpeg.
3. Bootstrap chạy hai lần hoặc trùng account thường — F2 giữ nguyên document đã có, không tự nâng quyền.
4. Database name restore bị cấu hình sai — F2 fail trước connect trong chế độ drill.
5. Redis/MongoDB treo và SIGTERM lúc job chạy — F3 deadline hữu hạn, worker drain, API không đợi vô hạn.

## File Structure

| File | Trách nhiệm |
| --- | --- |
| `tools/verify-project.mjs`, `tools/tests/verify-project.test.mjs` | Chạy gate một lượt và ghi evidence đúng exit status |
| `backend-node/config/runtime.js` | Validate env và DB name, không mở kết nối khi import |
| `backend-node/services/adminBootstrap.js`, `scripts/bootstrap-admin.mjs` | Bootstrap một lần và CLI đọc password file |
| `backend-node/services/health/readiness.js`, `lifecycle.js`, `heartbeat.js` | Kiểm tra dependency, drain, worker heartbeat |
| `backend-node/tests/production-*.test.mjs` | Regression unit/integration cho chức năng mới |
| `frontend/tests/production-config.test.mjs`, `src/app/api/health/route.ts` | Gate cấu hình và release marker của frontend |
| Dockerfiles, `.dockerignore`, Compose và `.env.prod.example` | Runtime production và contract cấu hình |

### Task F1: Baseline, runtime upgrade và test gate thật

**Files:** Modify `backend-node/package.json`, `frontend/package.json`, hai lockfiles, `frontend/next.config.js`, `frontend/tsconfig.json`, `.github/workflows/ci.yml`; create `frontend/eslint.config.mjs`, `tools/verify-project.mjs`, `tools/tests/verify-project.test.mjs`, `frontend/tests/production-config.test.mjs`.

**Interfaces:** `runGate({command,args,cwd,outputFile,env}) -> Promise<{exitCode:number,skippedMedia:boolean}>`; nhận command/argv riêng, không shell interpolation. CLI `node tools/verify-project.mjs --phase baseline|modified` ghi evidence trong `.codex-artifacts/cineon-devops/F1/` và trả nonzero nếu bất kỳ gate lỗi.

- [ ] **1. Chụp baseline trước sửa.** Lưu `git diff --binary`, danh sách file untracked liên quan (loại secrets/cache/video), SHA256 file sắp sửa và phiên bản Node/npm/FFmpeg. Chạy các lệnh sau bằng runtime hiện tại; lưu cả stdout/stderr và exit code ngay sau mỗi lệnh. Trên Windows dùng `npm.cmd`, không nối lệnh khiến exit cuối che lỗi trước.

Tạo checkout/baseline snapshot riêng theo master trước implementation; không để CI dùng HEAD cũ mà bỏ mất helper/test chưa commit của người dùng. Chạy tests với cấu hình fixture, kiểm tra suite không mở DB/provider production trước chạy; cài dependency mới chỉ trong checkout thực thi.

```bash
npm test --prefix backend-node
npm test --prefix frontend
npm run build --prefix frontend
npm run test:routes --prefix frontend
```

- [ ] **2. Viết test đỏ và chạy.** Runner test dùng child `node -e` trả 7, xác minh exit được giữ; một child in chuỗi skip media phải làm gate fail. Production-config test:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
test('production does not suppress TypeScript errors', () => {
  const cfg = require('../next.config.js');
  assert.notEqual(cfg.typescript?.ignoreBuildErrors, true);
  assert.equal(require('../package.json').dependencies.next.split('.')[0], '16');
});
```

Run `node --test frontend/tests/production-config.test.mjs`. Expected trước sửa: assertion fail do cấu hình hiện tại bỏ qua TypeScript errors.

- [ ] **3. Nâng runtime/dependencies theo lockfile.** Kiểm tra advisory trước khi chọn patch; ứng viên đã kiểm tra metadata là Next 16.3.6, NextAuth 4.24.13 tương thích Next 16/React 19. Cài và lưu exact versions; không dùng force/legacy-peer-deps.

```bash
npm install --prefix frontend --save-exact next@16.3.6 react@19 react-dom@19
npm install --prefix frontend --save-dev --save-exact eslint@9 eslint-config-next@16.3.6 @types/node@24 @types/react@19 @types/react-dom@19
```

Scripts đích: `build: next build --webpack`, `lint: eslint .`, `typecheck: tsc --noEmit`. Bỏ `eslint.ignoreDuringBuilds` và `typescript.ignoreBuildErrors`; giữ `output:'standalone'`, images hiện tại và PWA đang disabled. Flat ESLint config dùng `eslint-config-next/core-web-vitals` và `eslint-config-next/typescript`, bỏ qua output `.next*`, generated `public/sw.js`/workbox; không bỏ qua mã app. Dùng async `cookies/headers/params` theo lỗi compiler, chỉ sửa callsite cần thiết. Với trang/route phát sinh lỗi, thêm case regression sở hữu hành vi đó thay vì tắt rule cả repo. Backend/CI/Docker cùng Node 24 sau F4.

Runner implementation dùng `spawn(command,args,{cwd,env,shell:false})`, ghi streams vào file, bắt `error` thành exit 127; khi `close` trả exit thực. Tìm skip marker trên log đã đóng; không chạy lại test lần hai. Inventory mọi `*.test.mjs`, phân loại unit/media/network/e2e và đảm bảo không bỏ quên test nằm ngoài npm script.

- [ ] **4. Chạy lại gate và UI smoke.** `node --test tools/tests/verify-project.test.mjs`, config test, `npm run lint --prefix frontend`, `npm run typecheck --prefix frontend`, cả bốn lệnh baseline trên Node 24. Test standalone image và UI đăng nhập/catalog/player sẽ được lặp ở F4/V1. Ghi rõ baseline failures chưa sửa; không gọi green nếu vẫn có test được miễn trừ không giải thích.
- [ ] **5. Commit đúng hunk.** Commit message `build: adopt tested Node 24 and Next 16 production baseline`. Package file đang dirty: chỉ stage phần mới bằng hunk sau review, không thu luôn thay đổi người dùng.

### Task F2: Runtime config, database name và admin bootstrap

**Files:** Create `backend-node/config/runtime.js`, `backend-node/services/adminBootstrap.js`, `backend-node/scripts/bootstrap-admin.mjs`, `backend-node/tests/production-config.test.mjs`, `backend-node/tests/production-bootstrap.test.mjs`; modify `backend-node/config/database.js:11-25`, `backend-node/controllers/authController.js:393-420`, `backend-node/server.js:238-266`, `.env.prod.example`.

**Interfaces:** `readAppConfig(env) -> {databaseName:string,releaseId:string,mediaOrigin:string|null}`; `bootstrapAdmin({users,email,password,hashPassword,now}) -> Promise<'created'|'exists'>`. `users` là Mongo collection hoặc fake có `findOne/updateOne`; không tự connect. `MONGODB_DB_NAME` default `movieweb`; drill chỉ chấp nhận `movieweb_restore_` + suffix `[a-z0-9_-]+` khác DB production.

- [ ] **1. Test đỏ cho startup không seed, DB drill và bootstrap hai lần.** Test fake collection ghi lịch sử update; account thường có email trùng phải giữ nguyên role/password. Test runtime:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {readAppConfig} from '../config/runtime.js';
test('restore refuses production database', () => {
  assert.throws(() => readAppConfig({NODE_ENV:'test',RESTORE_DRILL:'true',MONGODB_DB_NAME:'movieweb'}), /restore target/);
});
test('database name is explicit and stable', () => {
  assert.equal(readAppConfig({NODE_ENV:'test'}).databaseName, 'movieweb');
});
```

- [ ] **2. Chạy** `node --test backend-node/tests/production-config.test.mjs backend-node/tests/production-bootstrap.test.mjs`; expected red trước module mới.
- [ ] **3. Implement helper và wire.** Validator kiểm tra tên DB bằng `/^[a-zA-Z0-9_-]+$/`, env bắt buộc ở production, secret length, numeric token-key versions, SHA release và HTTPS media origin. Error chỉ ghi tên biến sai. Core bootstrap:

```js
export async function bootstrapAdmin({users,email,password,hashPassword,now}) {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@') || password.length < 16) throw new Error('invalid bootstrap input');
  if (await users.findOne({email: normalized})) return 'exists';
  const at = now();
  const result = await users.updateOne({email: normalized}, {$setOnInsert: {
    email: normalized, username: normalized.split('@')[0], fullName: 'Administrator',
    password: await hashPassword(password), role:'admin', createdAt:at, updatedAt:at,
  }}, {upsert:true});
  return result.upsertedCount === 1 ? 'created' : 'exists';
}
```

Giữ unique email index; xử lý duplicate-key race bằng đọc lại và trả `exists`, không update role. CLI đọc `--email` và `--password-file` quyền riêng tư, không echo password, đóng DB trong `finally`. Database connection dùng `readAppConfig(...).databaseName`; bỏ import/call `createDefaultAdmin` khỏi startup và xóa seed implementation sau khi xác minh callers. Legacy admin được đổi mật khẩu bằng quy trình có xác nhận account; xoay JWT/NextAuth secrets có kiểm soát để thu hồi session cũ trước public, không tự đưa key cũ trở lại khi rollback.
- [ ] **4. Test integration trên Mongo tạm:** hai bootstrap đồng thời chỉ có một account, account thường không được nâng quyền, DB drill tách biệt, server restart không tái tạo seed. Chạy backend suite.
- [ ] **5. Commit** `fix: replace startup admin seed with explicit bootstrap`; cập nhật env reference cùng commit, không commit password file.

### Task F3: Readiness, queue recovery, heartbeat và graceful shutdown

**Files:** Create `backend-node/services/health/readiness.js`, `backend-node/services/health/lifecycle.js`, `backend-node/services/health/heartbeat.js`, `backend-node/scripts/queue-smoke.mjs`, `backend-node/tests/production-health.test.mjs`, `backend-node/tests/production-queue.test.mjs`; modify `backend-node/server.js:71-87,238-266`, `backend-node/config/database.js`, `backend-node/config/queue.js`, `backend-node/config/redis.js`, `backend-node/workers/queueWorker.js:96-125`, `backend-node/workers/scheduler.js:8-41`, `backend-node/services/playback/remuxService.js` tại symbol quản lý writer được Graft xác định khi thực thi.

**Interfaces:** `getReadiness` theo master; `createShutdown({stopAccepting,closeJobs,closeMedia,closeStores,deadlineMs}) -> async function shutdown(signal)` idempotent. `startHeartbeat({redis,service,releaseId,intervalMs=20000,ttlSeconds=90}) -> stop()`. Thêm `JOBS.SYSTEM_HEALTHCHECK`, handler trả `{nonce,release}`; thêm `stopAllRemux()` gọi cơ chế dừng writer hiện hữu, không viết lại remux.

- [ ] **1. Test đỏ cho dependency treo:**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {getReadiness} from '../services/health/readiness.js';
test('hung dependency has a bounded result', async () => {
  const t = Date.now();
  const r = await getReadiness({mongoPing:()=>new Promise(()=>{}),redisPing:async()=>{},timeoutMs:30});
  assert.equal(r.ready,false);
  assert.ok(Date.now()-t < 500);
});
```

Thêm readiness true/false, không lộ exception URI; shutdown gọi hai lần chỉ đóng một lần; queue smoke không chạy business handler.
- [ ] **2. Chạy** `node --test backend-node/tests/production-health.test.mjs backend-node/tests/production-queue.test.mjs`; expected red trước implementation.
- [ ] **3. Implement core deadline:**

```js
export async function getReadiness({mongoPing,redisPing,timeoutMs=1500}) {
  let timer;
  try {
    const timeout = new Promise(resolve => { timer=setTimeout(()=>resolve({ready:false}),timeoutMs); });
    const probes = Promise.all([Promise.resolve().then(mongoPing),Promise.resolve().then(redisPing)])
      .then(()=>({ready:true}),()=>({ready:false}));
    return await Promise.race([probes,timeout]);
  } finally { clearTimeout(timer); }
}
```

Adapter Mongo ping có `maxTimeMS` và connection/socket timeout hữu hạn; Redis producer có `commandTimeout`, `maxRetriesPerRequest:1`, `enableOfflineQueue:false`. Worker connection tách khỏi producer, `maxRetriesPerRequest:null`, reconnect backoff có cap nhưng không dừng vĩnh viễn sau 5 lần. Readiness gộp concurrent probes, cache kết quả tối đa 2 giây; không tạo connection mới mỗi probe. `/ready` no-store trả theo master, thêm frontend health route tương tự ở F4.

`mongoPing` chỉ resolve thành công khi `ok===1`, `redisPing` khi reply là `PONG`; phản hồi bất thường phải reject. Thêm hai adapter tests này để Promise fulfilled không tự được coi là dependency khỏe. Driver deadlines phải thực sự kết thúc operation treo, không chỉ có Promise.race ở lớp HTTP.

Worker concurrency default 1 trên VPS này; giữ job retention. Scheduler giữ handle cron, await iteration khi shutdown; heartbeat chỉ cập nhật khi vòng lặp/connection khỏe. Đăng ký SIGTERM/SIGINT: ngừng HTTP/Socket.IO/cron, close worker, stop writers, quit Redis/close Mongo, deadline 30 giây và exit lỗi nếu drain thất bại. Dùng `stop_grace_period:40s` ở Compose.
- [ ] **4. Test Redis/Mongo thật trên Linux tạm:** stop/start Redis, enqueue fail nhanh khi mất mạng, worker reconnect rồi xử lý nonce, heartbeat stale khi worker chết, SIGTERM không còn FFmpeg con. Chạy backend media suite để chứng minh shutdown helper không đổi seek/remux.
- [ ] **5. Commit** `feat: add bounded readiness and recoverable background workers`.

### Task F4: Images và Compose production chuẩn

**Files:** Modify `backend-node/Dockerfile`, `frontend/Dockerfile`, hai `.dockerignore`, `docker-compose.prod.yml`, `.env.prod.example`; create `deploy/toolchain.lock.json`, `deploy/tests/test_compose_contract.py`, `frontend/src/app/api/health/route.ts`; update `docs/cineon-deployment/kit/` bằng generator ở V2, không sửa tay ngay task này.

**Interfaces:** Image nhận `RELEASE_ID`, frontend health no-store. `BACKEND_IMAGE`/`FRONTEND_IMAGE` bắt buộc digest ở deploy; `REDIS_VOLUME`/`TRANSCODES_VOLUME` là tên volume đã inventory. Toolchain lock chứa image ref có digest và phiên bản công cụ đã xác minh; D1/D4 đọc cùng file.

- [ ] **1. Test đỏ:** Python test chạy `docker compose --env-file` với fixture env không bí mật và `config --format json`, assert port HostIp là `127.0.0.1`, memory/log rotation, queue không eviction, mọi app image đúng ref, env thiếu báo tên biến. Không in full rendered config. Test hai image bằng `docker inspect` để xác minh non-root và health command tồn tại.

```python
import unittest, subprocess, json, os, tempfile, base64
from pathlib import Path
class ComposeTest(unittest.TestCase):
    def test_backend_is_local_only(self):
        env=os.environ.copy()
        env.update(MONGODB_URI='mongodb://fixture:27017/movieweb',JWT_SECRET='x'*40,
          NEXTAUTH_SECRET='y'*40,TOKEN_ENCRYPTION_KEYS='1:'+base64.b64encode(b'x'*32).decode('ascii'),
          BACKEND_IMAGE='example/backend@sha256:'+'a'*64,
          FRONTEND_IMAGE='example/frontend@sha256:'+'b'*64,
          REDIS_VOLUME='cineon-test-redis',TRANSCODES_VOLUME='cineon-test-media',RELEASE_ID='a'*40)
        with tempfile.TemporaryDirectory(prefix='cineon-compose-') as d:
            f=Path(d)/'fixture.env'; f.write_text('',encoding='utf-8')
            p=subprocess.run(['docker','compose','--env-file',str(f),'-f','docker-compose.prod.yml',
              'config','--format','json'],env=env,capture_output=True,text=True,check=True)
        service=json.loads(p.stdout)['services']['backend-node']
        self.assertTrue(all(port['host_ip']=='127.0.0.1' for port in service['ports']))
```

Key ở đây là dữ liệu thử cố định 32 bytes, chỉ dùng trong fixture; production key được sinh riêng và không ghi vào repo.
- [ ] **2. Run** `python -m unittest discover -s deploy/tests -p test_compose_contract.py -v`; expected đỏ với Compose hiện tại.
- [ ] **3. Implement resource contract**, giữ cùng Redis/transcodes volume đã adopt:

```yaml
x-logging: &logging
  driver: json-file
  options: {max-size: '10m', max-file: '3'}
services:
  backend-node:
    image: ${BACKEND_IMAGE:?BACKEND_IMAGE required}
    mem_limit: 1280m
    ports: ['127.0.0.1:5001:5001']
    pids_limit: 256
    stop_grace_period: 40s
    logging: *logging
```

Lấy cấu trúc service đầy đủ từ kit đã có, đồng bộ tất cả env hiện hữu trước thay thế. Redis command `redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy noeviction`; frontend 768m, Redis 512m, worker 256m, scheduler 192m, memory backend như trên. `NODE_OPTIONS` heap nhỏ hơn container cap; cache 3/3 GB, writer 1, transcode never. Host ports chỉ frontend/backend localhost; metrics dùng cùng backend nội bộ.

Docker backend dùng Node 24 Debian slim có digest đã ghi lock, `apt-get` FFmpeg/tini, `npm ci --omit=dev`, ownership volume đúng UID non-root. Frontend multi-stage dùng cùng Node major, standalone, `HOSTNAME=0.0.0.0`, bỏ heap build 192 MB; runtime non-root. Build base digest được lấy/kiểm chứng bằng `docker buildx imagetools inspect`, lưu ref cụ thể trong lock rồi CI đọc; release không dùng tag trôi. `.dockerignore` chặn `.env*` trừ example, `.next*`, cache, private keys, logs, `init.mp4` và fixtures media lớn; không chặn source/runtime asset cần dùng.

```ts
// frontend/src/app/api/health/route.ts
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({status:'ready',release:process.env.RELEASE_ID ?? 'development'},
    {headers:{'Cache-Control':'no-store'}});
}
```

- [ ] **4. Build và run Linux fixtures:** ffmpeg/ffprobe tồn tại; UID không root; ghi transcodes được; Redis persistence qua restart; frontend health trả đúng release; container không chứa secret canary đặt ngoài build context allowlist. Restart stack giữ dữ liệu volume. Chạy lại A01 và ghi actual peak RAM/disk.
- [ ] **5. Commit** `build: enforce small-VPS production container contract`. Rollback dùng image/Compose trước task trên bản sao dữ liệu; không downgrade Redis datastore hoặc xóa volume để test.
