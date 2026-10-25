# HDU 资源接力

这是杭州电子科技大学第二届 AIGC 应用创新大赛的项目基线。项目由一个校园资源发布原型逐步改造为“AI 校园资源需求匹配与接力工具”。

## 当前基线

当前基线来自用户提供的部署 ZIP，包含静态 HTML 页面和 Cloudflare Pages `_worker.js`。现阶段可以看到的功能包括资源发布、浏览、详情、举报、管理后台，以及 AI 文案润色和图片识别接口。

后续产品方向是：用户用自然语言描述校园需求，系统提取校区、预算、时间和资源类别，生成可调整的匹配方案；资源不足时，用户可以继续发布结构化需求。

## AI 需求解析接口

`POST /api/ai` 新增 `action: "parse_need"`（同时兼容 `parseNeed` 和 `need_parse`）。它只负责把需求文本整理成结构化字段，不查询 Supabase，也不承诺平台中存在匹配资源。

请求示例：

```json
{
  "action": "parse_need",
  "needText": "想找一份高等数学期末复习资料，最好是下沙校区，预算 20 元以内，本周内需要"
}
```

成功时返回固定字段：

```json
{
  "needType": "course_material",
  "title": "高等数学期末复习资料",
  "keywords": ["高等数学", "期末复习"],
  "category": "课程资料",
  "audience": null,
  "budgetMax": 20,
  "campus": "下沙",
  "timeRequirement": "本周内",
  "specialRequirements": null,
  "buddyType": null,
  "activityFrequency": null,
  "peopleCount": null,
  "interest": null,
  "preference": null,
  "organizer": null,
  "recruitmentCount": null,
  "registrationDeadline": null,
  "serviceHours": null,
  "serviceCertificateRequired": null,
  "registrationUrl": null,
  "source": null,
  "sourceVerificationStatus": null,
  "needsConfirmation": false,
  "parseStatus": "ok",
  "warnings": [],
  "version": "..."
}
```

字段约定：`needType` 为 `course_material`、`textbook`、`used_item`、`buddy`、`volunteer_activity`、`learning_experience`、`other` 之一；`category` 为 `课程资料`、`教材`、`闲置物品`、`找搭子`、`志愿活动`、`学习经验`、`其他` 之一；`campus` 为 `下沙`、`东岳`、`滨江`、`不限` 之一。无法从原文确认的字段为 `null` 或 `[]`，不会由后端擅自补全。`budgetMax` 只接受有限的非负数字，最高 100000；关键词最多 8 个，每个最多 30 字。输入需求文本最多 1000 字，标题、对象、时间和特殊要求也有后端长度上限。

找搭子需求使用以下字段：`buddyType` 为 `study`、`sports`、`activity`，分别表示学习搭子、运动搭子、活动搭子；`activityFrequency` 表示频率；`peopleCount` 为明确提到的人数；`interest` 表示兴趣/主题；`preference` 表示明确说出的偏好。缺少地点、时间、人数、搭子类型或兴趣时，`needsConfirmation` 会被强制设为 `true`。

志愿活动需求使用以下字段：`organizer`、`recruitmentCount`、`registrationDeadline`、`serviceHours`、`serviceCertificateRequired`、`registrationUrl`、`source` 和 `sourceVerificationStatus`。其中 `sourceVerificationStatus` 只允许 `user_submitted`（用户提交）或 `pending_verification`（来源待核验），本 action 不允许输出官方认证状态。没有官方授权或人工核验的活动不能标记为官方活动；缺少地点、时间、招募人数、报名截止时间或来源核验状态时必须人工确认。

`registrationUrl` 只接受 `http`/`https` URL；人数和服务时长只接受非负数字并有上限。后端会过滤手机号、微信号、电话、住址等敏感联系方式，相关字段会回退为 `null` 并加入 `SENSITIVE_CONTACT_REMOVED` warning。找搭子流程不得通过该接口公开手机号、微信号或住址。

`needsConfirmation` 在模型明确要求确认、关键字段缺失，或后端发现类型/枚举/长度问题时会被强制设为 `true`。`parseStatus: "degraded"` 与 `warnings` 表示模型结果经过降级处理，例如模型返回非 JSON、字段类型不正确或值超出允许范围；这类结果只能进入人工确认，不能直接作为事实或匹配结论。

错误边界：缺少 `needText`、类型错误或超过长度限制返回 `400`；Workers AI 调用失败返回 `503`，并附带全空字段的 `fallback`；模型返回非 JSON 时返回 `200`，但字段为空、`parseStatus` 为 `degraded`，并要求人工确认。现有 `polish`、`audit`、`search`、`recognize` action 的接口路径和行为保持不变。

本地测试可以验证路由、字段校验、降级和既有 action 的 stub 兼容性；只有部署环境提供真实的 Cloudflare Workers AI `AI` binding 后，才能验证模型实际输出质量。当前 action 尚未实现 Supabase 资源匹配、排序或缺口需求入库，也尚未实现无结果后的需求接力保存。

## 后端匹配与需求接力接口

## 前后端统一资源对象

后端接口和未来前端统一使用 camelCase 资源对象。旧 CSV、旧 `items` 表或 `description` 内部 JSON 只能由后端适配层转换，前端不得直接读取旧字段。

```json
{
  "id": "seed-item-001",
  "type": "used_item",
  "title": "华为降噪耳机",
  "description": "九成新，原装配件齐全",
  "category": "闲置物品",
  "keywords": ["耳机", "降噪耳机"],
  "campus": "下沙",
  "timeRequirement": null,
  "status": "active",
  "source": "collaborator_csv_sanitized",
  "sourceVerificationStatus": "pending_verification",
  "auditStatus": "pending_review",
  "createdAt": "2026-08-26T02:34:52.208Z",
  "price": 99,
  "isNegotiable": true,
  "images": [],
  "buddyType": null,
  "activityFrequency": null,
  "peopleCount": null,
  "interest": null,
  "preference": null,
  "organizer": null,
  "recruitmentCount": null,
  "registrationDeadline": null,
  "serviceHours": null,
  "serviceCertificateRequired": null,
  "registrationUrl": null
}
```

前端统一规则：缺失值使用 `null`，多值使用 `[]`；前端先处理 `status`、`warnings`、`needsConfirmation`，再渲染资源；不得直接读取 `contact`、`user_id`、IP、设备指纹或旧描述 JSON。资源卡片、详情页、匹配结果和接力预览必须复用同一套字段名称。

当前新增两个不依赖数据集的后端接口，供后续前端对接：

### `POST /api/resource-match`

请求体为 `{ need, resources? }`。`need` 是 `parse_need` 的规范化结果；`resources` 为空、省略或为 `null` 时，接口返回：

```json
{
  "status": "dataset_not_connected",
  "matches": [],
  "canRelay": true,
  "warnings": ["DATASET_NOT_CONNECTED"],
  "version": "..."
}
```

这表示尚未接入资源数据集，不表示平台没有资源。只有测试或前端显式传入脱敏 `resources` 时，Worker 才进行本地纯规则匹配。返回的每个 `match` 包含 `resource`、`score` 和 `reasons`；分数来源包括类型、分类、标题/关键词、校区、时间、预算，以及找搭子和志愿活动专属字段。没有正分匹配时返回 `status: "no_matches"`、`canRelay: true` 和 `NO_MATCHES`。

### `POST /api/relay/preview`

请求体为 `{ need }`。接口返回 `status: "preview"` 的需求接力草稿，包含 `relay.title`、`relay.content`、`relay.type`、`relay.missingFields` 和 `relay.privacyNotice`，并始终返回 `needsConfirmation: true`。它只生成预览，不生成 ID、不写 Supabase、不公开手机号/微信号/电话/住址，也不会把志愿活动标记为官方活动。

两个接口都返回 `version`，非法 JSON、字段类型/枚举/长度/范围/URL 错误返回 `400`。当前只完成本地 Worker 规则和契约测试，未接入真实资源数据集、Supabase 查询或需求接力入库，前端页面尚未调用这两个接口。

## 运行与部署边界

## DeepSeek 接入窗口

当前默认仍是 Cloudflare Workers AI。前端只调用 `/api/ai`，不关心后端使用哪个模型。后续可以在 Worker 内增加 DeepSeek provider 作为可切换主模型或备用模型，但必须保持现有输入输出格式不变。DeepSeek API Key 只能配置为服务端 Secret，不能写入前端、仓库或日志。正式切换前，需要使用同一组中文测试案例比较解析准确率、虚构字段、JSON 稳定性、响应时间和异常降级；本项目当前没有接入 DeepSeek，也没有使用用户提供的 API Key。

该基线不是一个带本地构建脚本的完整 Node.js 项目。它依赖外部服务配置：

- Supabase 项目和 RLS/Storage 配置
- Cloudflare Pages Advanced Mode
- Cloudflare Workers AI binding，变量名为 `AI`
- Worker Secret：`TOKEN_SECRET`
- Worker Secret：`SUPABASE_SERVICE_KEY`
- Worker Secret：`SUPABASE_ADMIN_PASSWORD`

这些 Secret 不得写入仓库、前端页面、日志或截图。部署前必须在平台 Secret 管理中配置，并替换 Worker 中的开发占位实现；当前基线不应被视为已经完成生产安全加固。

## 公开仓库数据边界

公开基线不随附原始课程评价、新生资料和其他未经授权或脱敏的第三方文件。相关资料若要重新接入，必须先确认来源、授权、时效、隐私和公开范围。

演示阶段优先使用自制或明确标注的模拟数据。不得把校园集市或其他平台的真实帖子、图片、联系方式批量复制到本项目数据库。

## 分支规则

- `main`：经过总控审查的基线或已验收版本。
- `codex/<功能简称>`：单一功能或单一阶段的开发分支。
- 合并前必须完成本地运行、核心案例、边界案例、敏感信息和浏览器可见性检查。

## 比赛材料

比赛要求的项目文档、PPT、演示视频和 AI 使用记录应与实际功能一致，尤其要说明模拟数据、AI 生成内容、人工核查和当前限制。
