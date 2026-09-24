# Cineon Acceptance and Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chứng minh A01–A17 bằng test thật và bàn giao bộ hướng dẫn đồng bộ với code đã triển khai.

**Architecture:** Test local/mocked, Linux integration, staging external services và production được ghi riêng. Runbook/kit được sinh từ source chuẩn và release manifest, không giữ cấu hình mẫu khác hành vi đã test.

**Tech Stack:** node:test, Python unittest, Docker Compose, FFmpeg, browser tích hợp Codex, k6, Markdown, python-docx và Word/PDF render.

**Spec:** [Thiết kế đã duyệt](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/specs/2026-09-24-cineon-production-devops-design.md).

## Global Constraints

- Lệnh repo bắt buộc: `npm test --prefix backend-node`, `npm test --prefix frontend`, `npm run build --prefix frontend`.
- Load web “5 → 10 → 20 người dùng đồng thời, think time 2–5 giây, giữ 20 phút ở mỗi mức”.
- “Mục tiêu ban đầu cho API nội bộ đã warm: p95 <1 giây, 5xx <1%”. Video bitrate/buffering được đo riêng.
- “RPO dữ liệu tối đa 24 giờ; RTO mục tiêu tối đa 2 giờ khi đã có VPS thay thế, quyền truy cập và khóa giải mã.”
- Dùng [master](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/plans/2026-09-24-cineon-devops-implementation.md); đọc cả năm kế hoạch con trước nghiệm thu cuối.

## Review Focus

1. Tests bị skipped hoặc dependency chưa chạy — V1 để gate failed/unverified, không tô xanh.
2. Chromium pass nhưng Safari native HLS lỗi — V1 có device gate riêng.
3. CDN cache khiến smoke thấy release cũ — V1 so marker, quyền user và host bytes thực tế.
4. Test fixture vô tình nối DB/provider production — V1 fixture allowlist và chặn egress không cần thiết.
5. Word/ZIP lỗi hoặc kit stale dù source đúng — V2 mở lại, render, checksum và đối chiếu source.

## File Structure

`deploy/compose.test.yml` sở hữu stack test riêng; `deploy/tests/integration/` sở hữu fault/release/restore tests. `deploy/load/web.js` chỉ workload web, `media.js` workload fixture video riêng. `tools/build_deploy_package.py` đóng gói whitelist từ nguồn chuẩn. `docs/cineon-deployment/ACCEPTANCE.md` ghi bằng chứng và trạng thái, không thay thế raw reports đã lọc.

### Task V1: Integration, fault injection, capacity và production gates

**Files:** Create `deploy/compose.test.yml`, `deploy/tests/integration/test_acceptance.py`, `deploy/load/web.js`, `media.js`, `deploy/load/README.md`, `docs/cineon-deployment/ACCEPTANCE.md`; extend CLI verify/report command và GitHub CI integration job.

**Interfaces:** `AcceptanceResult={id,environment,status,command,evidencePath,observedAt}` với status `passed|failed|unverified`; environment `local|linux-fixture|staging|production`. `assert_complete(results,required_environment)->None` chỉ pass khi mọi A01–A17 có evidence môi trường tương ứng theo matrix, không nâng local mock thành production.

- [ ] **1. Test đỏ reporting:**

```python
import unittest
from deploy.lib.acceptance import assert_complete
class AcceptanceReportTest(unittest.TestCase):
    def test_mock_cannot_satisfy_live_cdn(self):
        rows=[{'id':'A07','environment':'local','status':'passed','evidencePath':'fixture.txt'}]
        with self.assertRaises(ValueError): assert_complete(rows,{'A07':'production'})
```

Create `deploy/lib/acceptance.py` trong task này; thêm missing IDs, nonexistent evidence, stale release và skipped media cases. Report phải chỉ rõ acceptance level yêu cầu: cấu hình có unit test; CDN/alert/backup offsite phải có external evidence.
- [ ] **2. Run** `python -m unittest discover -s deploy/tests/integration -p test_acceptance.py -v` và toàn bộ tests F/D/C/O/B; expected report test đỏ trước implementation.
- [ ] **3. Implement report gate và test matrix.** `assert_complete` index theo ID/environment, verify status/evidence existence/release; không suy từ command exit 0 nếu required cases skipped. Integration project dùng tên `cineon-verify-<id>`, new labeled volumes và fixture env; root/namespace guard trước cleanup, không mount production volumes. Fixture Mongo+Redis và upstream mock có HLS/Range/subtitle data do FFmpeg sinh; network egress bị giới hạn, không dùng provider credential thật.

Thực hiện A01–A17: baseline/regression; image secrets/non-root; provision hai lần; routing/TLS; IP spoof; dependency outage; cache auth; direct/HLS/native/seek/audio/subtitle; full rollback và journal crash recovery; duplicate deploy; Sentry/metrics/email; redaction; backup/restore; quota/disk/OOM/cloud outage; capacity; package integrity. Mỗi fault có inject và cleanup theo label, kiểm restored status sau cleanup. Các lệnh được lưu raw output/exit và input fixture, không chỉ đánh dấu checklist.

Workload web khởi đầu:

```js
import http from 'k6/http';
import {check,sleep} from 'k6';
export const options={
  stages:[{duration:'1m',target:5},{duration:'20m',target:5},
    {duration:'1m',target:10},{duration:'20m',target:10},
    {duration:'1m',target:20},{duration:'20m',target:20}],
  thresholds:{'http_req_duration{kind:warm_api}':['p(95)<1000'],
    'http_req_failed{kind:warm_api}':['rate<0.01']},
};
export default function(){
  if (!__ENV.BASE_URL || __ENV.ALLOW_LOAD_TEST!=='yes') throw new Error('explicit load-test target required');
  const r=http.get(`${__ENV.BASE_URL}/api/catalog/home`,{tags:{kind:'warm_api'}});
  check(r,{'API returns 200':x=>x.status===200});
  sleep(2+Math.random()*3);
}
```

Warm route trước đo; kiểm JSON content đúng để 200 trang lỗi không pass. Tách custom 5xx counter khỏi mọi HTTP failures khi phân tích, không che 429/timeouts. Thêm workload web pages/auth fixture riêng, không gộp latency external resolve vào warm API. `media.js` dùng URL fixture do test cấp, không hardcode phim hoặc token; đo bitrate/buffering, direct và remux separately, network quốc tế riêng. Thử trên staging trước, production chỉ cửa sổ và target đã xác định. Dừng khi error/OOM/disk vượt ngưỡng để bảo toàn dịch vụ, ghi failed stage thay vì giảm target rồi vẫn gọi đạt 20 VU.

UI QA dùng browser tích hợp để đăng nhập, logout, favorites/history, premiere nếu còn tính năng, player/seek/subtitle/mobile. Native Safari cần máy thật hoặc môi trường Safari hợp lệ. Kiểm OAuth callback với tài khoản thử của người dùng khi integration đã bật; không coi route 401 của anonymous probe là đã test login.
- [ ] **4. Run full gates và review:** Linux test suite, production images, native media, CI artifact, external integrations; tổng hợp A01–A17. Nếu thiếu tài khoản/VPS/device thì giữ row unverified và nêu đúng input cần có. Review độc lập theo cách thực thi người dùng chọn; sửa phát hiện rồi chạy lại tests liên quan và smoke cuối.
- [ ] **5. Commit** `test: verify production failure recovery and capacity gates`; reports public đã lọc, dump/secrets/raw sensitive logs ở ngoài Git.

### Task V2: Đồng bộ A–Z, render Word và đóng gói đã kiểm chứng

**Files:** Modify `docs/cineon-deployment/CINEON_DEPLOY_A_Z.md`, `docs/cineon-deployment/CINEON_DEPLOY_A_Z.docx`, `docs/cineon-deployment/PACKAGE_README.txt`, `docs/cineon-deployment/SHA256SUMS.txt`, `docs/cineon-deployment/kit/`; create `tools/__init__.py`, `tools/build_deploy_package.py`, `tools/tests/test_deploy_package.py`, `docs/cineon-deployment/OPERATIONS.md`; reuse `docs/cineon-deployment/qa/build_doc.py`, `docs/cineon-deployment/qa/render_word.ps1`, `docs/cineon-deployment/qa/verify_kit.py` sau khi cập nhật theo source mới.

**Interfaces:** `build_package(repo_root:Path,output_dir:Path,release_id:str)->Path` tạo zip từ whitelist source; `verify_package(zip_path,expected:dict)->None` kiểm mỗi entry/hash và reject secrets/unexpected members. SHA256SUMS không tự hash chính nó; manifest trong ZIP ghi đúng file versions/release.

- [ ] **1. Test đỏ package stale/secret:**

```python
import unittest, zipfile, tempfile
from pathlib import Path
from tools.build_deploy_package import verify_package
class PackageTest(unittest.TestCase):
    def test_env_secret_entry_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix='cineon-package-') as d:
            p=Path(d)/'bad.zip'
            with zipfile.ZipFile(p,'w') as z: z.writestr('kit/.env','TOKEN=fixture')
            with self.assertRaises(ValueError): verify_package(p,{})
```

Thêm wrong checksum, duplicate ZIP entry, path traversal, missing main document, kit khác source; parser không coi tên `env.example` là secret thật nhưng vẫn scan canary secrets.
- [ ] **2. Run** `python -m unittest discover -s tools/tests -p test_deploy_package.py -v`.
- [ ] **3. Implement whitelist và cập nhật tài liệu theo evidence.** Kit lấy Compose/Caddy/scripts/env examples đã test từ source chuẩn; không copy cả repo hoặc thư mục qa chứa binary. Artifact files có stable relative paths và LF shell scripts. README ghi Ubuntu/domain, runtime/service versions, required accounts, secret setup, đầu vào nào chưa kích hoạt và acceptance report.

Runbook đủ chuỗi: tài khoản/chi phí → DNS/TLS → provision → adopt volumes → secrets/bootstrap → build/release → deploy/smoke → CDN/media → Sentry/Grafana/alerts → backup/restore → release/rollback → bảo trì/sự cố → nâng cấu hình. Bỏ hướng dẫn seed cũ và các cấu hình mẫu bị thay; mọi lệnh mới đã syntax-check và test ở đúng môi trường. Phân biệt lệnh chạy trên PowerShell máy cá nhân, CI Linux và VPS. Hướng dẫn rollback app khác restore database; khóa/token thu hồi không được đưa lại.

Đọc skill documents và load_workspace_dependencies khi tạo Word. Tái sử dụng layout/generator hiện có, thêm links/caption code không tràn bảng. Render `.docx` thành PDF/page images qua workflow tài liệu; nếu Word COM dùng ở Windows thì chạy ẩn, không ghi đè file người dùng đang mở mà chưa kiểm tra trạng thái. Mở và xem mọi trang, sửa bảng/ngắt trang/code overflow rồi render lại; không chỉ kiểm XML.

```python
# Core integrity check sau khi đã kiểm member names bằng allowlist:
import hashlib, zipfile
def verify_hashes(path, expected):
    with zipfile.ZipFile(path) as z:
        if z.testzip() is not None: raise ValueError('corrupt zip')
        names=z.namelist()
        if len(names)!=len(set(names)) or set(names)!=set(expected): raise ValueError('unexpected entries')
        for name in names:
            if hashlib.sha256(z.read(name)).hexdigest()!=expected[name]: raise ValueError('checksum mismatch')
```

- [ ] **4. Verify/reopen** Markdown, Word, ZIP, checksum file, runbook và acceptance report. So release ID với source commit và image manifest; link local là absolute path trong câu trả lời bàn giao. Chạy command block syntax checks, kit/source diff và ZIP integrity tests; lưu literal evidence trong QA report, không giả lập kết quả VPS.
- [ ] **5. Commit** `docs: publish verified Cineon deployment and operations package`; trả link Word/Markdown/ZIP cùng trạng thái production thực tế và phần input còn cần, nếu có.
