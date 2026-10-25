# 寻应 AI 接口交接说明（UI 接入）

供后续 UI 开发直接对接。所有 API 均为 JSON；先处理 HTTP 状态码与响应 `status`，再读取业务字段。成功响应有顶层 `version` 与 `warnings`；字段缺失使用 `null`，列表使用 `[]`。不要从旧 `items`、description 内部 JSON 或 contact 推导这些接口字段。

## 环境与现状

- 当前 Preview：[https://ai-parse-verify.hd2-6pi.pages.dev](https://ai-parse-verify.hd2-6pi.pages.dev)。接口地址按同源路径调用。`/api/ai` 使用当前 Cloudflare Workers AI Binding，模型为 `@cf/qwen/qwen3-30b-a3b-fp8`。
- `parse_listing` 的本阶段 v6 已在此 Preview 用真实 Qwen3 调用。`parse_need` 曾在前一阶段用真实 Qwen3 验证；本次交接没有重跑模型。资源匹配是 Worker 内普通 JavaScript 规则，没有 AI 推分。
- Production 没有同步本阶段的 v6 Worker。演示 UI 的候选资源是 `public-demo-resources.json` 中标记的 17 条自制演示资源，不是 Supabase 实时查询结果。
- 买家侧首页已有 `parse_need → resource-match → relay/preview` 交互。卖家侧 `parse_listing` 尚未接入发布页，接口目前只产生待审核草稿；没有把草稿确认、写入数据库或公开发布的对应 API。

## 1. 买家需求解析：`parse_need`

请求 `POST /api/ai`：

```json
{"action":"parse_need","needText":"想找下沙校区100元以内的降噪耳机，周末面交"}
```

成功时字段直接位于响应顶层（没有额外的 `need` 包装）：

```json
{
  "needType":"used_item", "title":"降噪耳机", "keywords":["降噪耳机"],
  "category":"闲置物品", "audience":null, "budgetMax":100,
  "campus":"下沙", "timeRequirement":"周末面交", "specialRequirements":null,
  "buddyType":null, "activityFrequency":null, "peopleCount":null,
  "interest":null, "preference":null,
  "organizer":null, "recruitmentCount":null, "registrationDeadline":null,
  "serviceHours":null, "serviceCertificateRequired":null, "registrationUrl":null,
  "source":null, "sourceVerificationStatus":null,
  "needsConfirmation":true, "parseStatus":"ok", "warnings":[], "version":"…"
}
```

响应值由 Worker 校验与规范化；`needType` 可能是 `course_material`、`textbook`、`used_item`、`buddy`、`volunteer_activity`、`learning_experience`、`other` 或缺失的 `null`。`keywords` 是数组。搭子字段为 `buddyType`（`study` / `sports` / `activity`）、`activityFrequency`、`peopleCount`、`interest`、`preference`；志愿字段包括 `organizer`、`recruitmentCount`、`registrationDeadline`、`serviceHours`、`serviceCertificateRequired`、`registrationUrl`、`source`、`sourceVerificationStatus`。志愿来源只允许 `user_submitted`、`pending_verification`，不能当作官方核验。

主要状态：`parseStatus: "ok"` 表示结构可用；`parseStatus: "degraded"` 表示模型非 JSON 或字段校验警告，错误字段会变为 `null`/`[]`。降级结果仍返回 HTTP 200，应提示用户核对字段。模型调用失败返回 HTTP 503，响应含 `fallback`（其中 `needsConfirmation: true`）；输入无效或超过 1000 字符返回 HTTP 400。

前端展示候选条件编辑表单，让用户核对标题、类型、关键词、预算、校区、时间和专属字段。`needsConfirmation: true` 或非空 `warnings` 时突出“请核对”；用户修改后提交修改后的字段给下一步。不要把模型输出直接当作已经确认的需求。

## 2. 卖家帖子解析：`parse_listing`

请求 `POST /api/ai`：

```json
{"action":"parse_listing","rawText":"出无线鼠标25元，能正常用，下沙周六下午可取。"}
```

输入最多 5000 字符。正常返回顶层字段：`status`、`postIntent`、`products`、`wantedItems`、`summary`、`needsConfirmation`、`review`、`warnings`、`listingParserVersion`、`version`。

`postIntent` 为 `sale` / `wanted` / `mixed` / `unclear`。每个 `products[]` 商品字段为：

```text
title, type, name, category, price, campus, condition, tradeTime,
availability, notes, summary, evidence, missingFields, uncertainFields,
reviewStatus, humanConfirmed, publishable
```

`type` 允许 `used_item`、`textbook`、`course_material`、`other`；`availability` 为 `available`、`sold`、`unknown`。`evidence` 含 `title`、`price`、`campus`、`condition`、`tradeTime`、`availability` 的原文片段或 `null`。求购项放 `wantedItems[]`，字段为 `name`、`category`、`budgetMax`、`campus`、`notes`、`evidence`；求购价格字段是预算 `budgetMax`，出售商品价格字段是 `price`。

接口固定要求人工审核：`review.required: true`、`review.status: "pending_human_review"`、`review.humanConfirmed: false`、`review.publishable: false`。每个商品也固定 `reviewStatus: "pending_human_review"`、`humanConfirmed: false`、`publishable: false`。模型输出不能解除这些标记。

主要状态：`status: "pending_review"` 表示当前规范化没有 warning，但仍待人工审核；`status: "needs_review"` 表示有 warning，应展示 warning 并人工检查；模型无法解析或返回结构无效时仍是 HTTP 200，返回 `postIntent: "unclear"`、空商品列表及 `MODEL_NON_JSON`。输入无效返回 HTTP 400。即使 `warnings` 为空，商品仍不可直接发布。

建议卖家 UI：先显示原帖和整体摘要；每件商品单独显示可编辑字段，并在字段旁显示 `evidence` 原文；`missingFields`、`uncertainFields`、`needsConfirmation` 和 `warnings` 用待补充/待核实标签提示。把 `sold` 明确标为已售、`unknown` 标为状态待确认。用户编辑并点击“我已核对”只能作为 UI 本地确认步骤；当前解析接口没有确认/保存/发布接口，不要伪造服务端确认成功，也不要显示“已发布”。可以先提供返回修改和复制草稿等不写入服务端的体验。

## 3. 规则匹配：`resource-match`

请求 `POST /api/resource-match`：

```json
{
  "need": {"needType":"used_item","title":"降噪耳机","keywords":["降噪耳机"],"category":"闲置物品","campus":"下沙","budgetMax":100,"needsConfirmation":false},
  "resources": [{"id":"demo-item-001","type":"used_item","title":"示例耳机","category":"闲置物品","keywords":["降噪耳机"],"campus":"下沙","price":80,"status":"available"}]
}
```

`need` 是经用户检查后的结构化需求，至少要有有效 `needType` 和 `title`。`resources` 是显式传入的候选资源数组，每项须有 `id`、`title`、`type` 或 `needType`；常用字段为 `description`、`category`、`keywords`、`campus`、`timeRequirement`、`price`、`status`，以及搭子/志愿活动专属字段。最多 100 项。资源用统一 camelCase 字段；使用 `price`，不要把 `budgetMax` 当资源售价。敏感联系方式会导致 HTTP 400。

返回顶层含 `status`、`matches`、`canRelay`、`warnings`、`need`、`version`。`matched` 时 `matches[]` 每项含 `resource`、`score`、`reasons`；`score` 是规则分，`reasons` 是规则命中理由。无正分结果返回 `no_matches`、空 `matches`、`canRelay: true`、`NO_MATCHES` warning。未传资源、null 或空数组返回 `dataset_not_connected` 与 `DATASET_NOT_CONNECTED`；这表示本次没有接入候选数据，不表示校园里没有资源。其他资源集校验失败返回 HTTP 400。

买家 UI 遇到 `matched` 显示候选与 reasons；遇到 `no_matches` 显示“暂时没有符合条件的结果”，允许修改条件或进入预览；遇到 `dataset_not_connected` 明确告诉用户数据集未接入，不要说“没有资源”。只有用户主动选择后才调用接力预览：`POST /api/relay/preview`，请求 `{ "need": <经用户确认的结构化需求> }`；其 `status` 为 `preview`，`needsConfirmation: true`，结果不落库、不公开。

## 已知局限与交接边界

- `parse_listing` 是原型级草稿整理工具，不是自动审核器。10 条独立 synthetic 留出调用中，已观察到混合出售/求购意图误判、跨句成色被误清空、旧在售状态覆盖后续退单更新，以及在售商品遗漏等情况。不能只看 `warnings: []` 就略过人工检查。
- 所有商品当前都标 `publishable: false`；这份接口没有服务端人工确认、草稿持久化或发布路由。UI 确认按钮目前只能代表本地交互状态，不能声称后端已审核或发布。
- `parse_need` 提供候选字段，用户确认后才适合用于匹配；缺失条件仍为 `null`，不能由前端补猜。
- Buyer 首页已调用三项接口，并使用脱敏自制 demo 候选。真实 Supabase 检索/写入、卖家解析 UI 与管理员审核工作流不属于这三个接口当前已交付的闭环。

本说明按当前 `_worker.js`、首页调用代码及 `outputs/后端接口合同与验收清单.md` 整理。字段以返回 JSON 为准；部署或接口版本变化后需重新核对。本轮没有执行模型调用或测试。
