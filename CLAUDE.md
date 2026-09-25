# CLAUDE.md — Stack: Router + Superpowers + Skills + Graft/Serena + Playwright

> Repo: `movie_web` — frontend Next.js 14 (`frontend/`) + backend Express + MongoDB (`backend-node/`).
> Đọc file này trước mọi task. Nó là **router duy nhất** để Graft và Serena không overlap.

## 1. Pipeline bắt buộc (theo sơ đồ của bạn)

```
User request
  → agent-router (chọn chuyên gia)
  → Superpowers workflow (/brainstorming → plan → /execute-plan → TDD → review)
  → Skills domain (frontend-design | backend-security)
  → Coding task
    → Graft TRƯỚC (map / ask / grep / callers / skeleton) — chỉ ĐỌC, tìm file:line
    → Serena SAU (symbol / LSP / rename / refactor) — chỉ SỬA trên file:line đã có
    → source (Edit/Write)
  → Playwright (UI) + tests/build (API)
  → verification (graft callers --depth 2 + chạy test thật)
```

## 2. Luật CHỐNG OVERLAP Graft vs Serena (quan trọng nhất)

| Câu hỏi | Dùng | Cấm |
|---|---|---|
| Codebase này có gì? Kiến trúc ra sao? | `graft map` / `graft ask --source` | Cấm `serena list_dir / getSymbolsOverview` để onboard |
| Code X nằm ở đâu? Flow auth/playback chạy thế nào? | `graft ask "<flow>" --source` | Cấm `serena findSymbol` khi chưa có file:line |
| Mọi chỗ dùng symbol Y? | `graft grep "Y"` (exhaustive) | Cấm `serena findReferencingSymbols` để tìm diện rộng |
| Đổi tên / xóa / đổi signature có vỡ gì? | `graft callers <sym> --depth all` TRƯỚC | Rồi mới `serena rename` — không làm ngược |
| File này có API gì? | `graft skeleton <file>` | Cấm `serena getSymbolsOverview` khi skeleton đủ |
| Đã có file:line từ Graft, cần sửa chính xác / rename / xem diagnostics LSP | `serena` (read / replace / rename / diagnostics) | Cấm quay lại `graft ask` cùng câu hỏi |
| Span bị truncate `+N more lines` | Mở file đúng range đó | Không re-ask |

**Nguyên tắc 1 task = 1 Graft (locate) → 1 Serena scope (edit):**
1. Graft cho `file:line` chính xác.
2. Serena chỉ làm việc trên `file:line` đó (không search lại từ đầu).
3. Không bao giờ chạy cả 2 cho cùng 1 câu hỏi "symbol này ở đâu".

**Cấu hình đã khóa overlap:**
- Serena chạy với `--context claude-code` → tự tắt tool thừa trùng với Claude native (theo docs Serena).
- `.mcp.json` dùng chung 2 server: `graft` (static graph, $0) + `serena` (LSP live, ghim `--python 3.12` vì Python hệ thống 3.14 không build được `pyyaml 6.0.2`). Playwright lấy từ plugin official `playwright@claude-plugins-official` (đã enable) để khỏi duplicate 2 nguồn — tool prefix vẫn là `mcp__playwright__*`.
- Skill `graft` mô tả "WHEN to use"; skill `serena-routing` mô tả "WHEN NOT to use graft-task" — Claude tự route theo description.

## 3. agent-router (chọn chuyên gia)

- UI/component/Tailwind/player → `@frontend-design` (`.claude/agents/frontend-design.md`)
- API/auth/Redis/Mongo/queue/security → `@backend-security` (`.claude/agents/backend-security.md`)
- Không rõ / multi-domain → router tự tách 2 hướng, mỗi hướng vẫn tuân thủ Graft→Serena.
- Xong code → `@reviewer` kiểm blast radius + test.

## 4. Superpowers (workflow, không phải search)

Cài 1 lần trong Claude Code (không commit được, chạy tay):
```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
# hoặc official: /plugin install superpowers@claude-plugins-official
```
Dùng: `/brainstorming` → plan → `/execute-plan` → TDD (`test-driven-development`) → `/requesting-code-review`.
Superpowers KHÔNG thay Graft/Serena — nó chỉ điều phối thứ tự.

## 5. Lệnh verify chuẩn repo này (bắt buộc chạy thật)

```bash
# orientation rẻ nhất, luôn chạy đầu khi task mới
npx -y @nanonets/graft map
# backend
npm test --prefix backend-node
# frontend
npm test --prefix frontend
npm run build --prefix frontend
# playwright (đã có MCP playwright, cần `npx playwright install` 1 lần)
npx playwright test
```

Sau sửa code lớn: `npx -y @nanonets/graft build` để refresh graph.

## 6. Ví dụ đúng / sai

✅ Đúng: `graft ask "playback auth flow" --source` → được `backend-node/middleware/auth.js:3-25` → `serena replace` đúng range → `npm test --prefix backend-node` → `graft callers authMiddleware --depth 2`.
❌ Sai: `serena findSymbol authMiddleware` từ đầu → chậm, tốn token → lại `graft grep authMiddleware` → double search = overlap.
