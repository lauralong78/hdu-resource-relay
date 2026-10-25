# 寻应 UI/UX 开发交接说明

更新日期：2026-10-25
项目目录：C:\Users\Lenovo\Documents\ChatGPT\aigc
交付内容：本目录的 UI 开发交接包；同级 ZIP 包
Preview 参考：<https://ai-parse-verify.hd2-6pi.pages.dev>

## 1. 交接目标

本交接包供 UI/UX 开发者基于当前本地最新前端页面开展界面改造。产品主线是“寻应：用自然语言寻找杭电校园资源”，当前优先完成二手商品与教材的买家流程，并为卖家帖子 AI 提取新增界面。

本交接只界定现状、接口和前端写入边界。包内文件是当前本地工作区快照的副本；项目源码未因本次交接而改动。交接包中为避免携带数据库访问凭据，前端页面副本里的 SUPABASE_KEY 值已替换为占位字符串。该副本不具备真实数据库读写能力。

## 2. 当前 Git 与本地改动状态

已检查当前本地状态：

- 分支：codex/listing-quality-c10-2
- 本地 HEAD：9701995d020b518551951df78debd49a21bbc7ec（chore: establish public campus resource project baseline）
- 当前分支未配置 upstream；远程没有同名 codex/listing-quality-c10-2 分支。
- 本次只读查询时，远程 origin/main 公布的 HEAD 为 82170d9b8ec833b115fafcdadfd563af65e70156，与本地 HEAD 不同。未 fetch，也未推送，因此这里不推断两者的完整提交祖先关系。
- 当前工作区有未提交修改；全部修改仍是本地工作区内容，尚未包含在当前 HEAD 中。

重要的已修改跟踪文件：

- _worker.js：服务端代码当前有 parse_listing 接口实现及版本标记。
- index.html：买家首页与自然语言需求闭环有大量本地修改。
- item.html：详情页和演示资源读取有本地修改。
- publish.html：旧发布表单及相关前端流程有本地修改。
- README.md、AGENTS.md、outputs/总控协作与GitHub基线计划.md：项目说明与协作记录有本地修改。

重要的未跟踪本地文件：

- public-demo-resources.json：当前 UI 演示读取的 17 条自制演示资源。
- outputs/AI接口交接说明-UI接入.md：本包附带的 AI 接口说明。
- outputs/C10-2-parse_listing质量优化报告.md：内部质量记录，不放入交接包。
- 多个 Supabase SQL、安全核查材料和测试结果文件：不放入交接包。

以上信息是本次读取时的快照。未提交、未跟踪文件不能通过 Git commit 记录证明已推送；当前分支没有远程跟踪分支，远程 main 与本地 HEAD 也不同。交接包只取 UI 开发必需的允许文件，不包含其他未跟踪材料。

## 3. 页面入口、样式脚本与跳转

项目没有独立 CSS/JS 构建目录。各页面将主要 CSS 放在 HTML 内的 style 标签，将主要交互脚本放在 HTML 内的 script 标签。UI 修改通常直接发生在交接包 src 目录下的 HTML 文件中。

- index.html：静态站点首页入口。包含自然语言需求输入、条件确认、推荐结果、旧资源浏览列表、顶部导航和状态提示。它调用同源 API，并从 public-demo-resources.json 读取规则匹配所用演示资源。
- item.html：商品详情入口，使用查询参数读取商品 ID；从首页推荐卡或普通资源卡进入。页面还保留旧商品详情、收藏、举报及发布者操作界面。管理页面可用 ref=admin 方式打开详情。
- publish.html：旧商品发布/编辑入口。普通发布、编辑、图片识别和文案润色属于既有功能；当前没有接入 parse_listing。
- guide.html：新生指南；可以返回首页或进入发布页。
- disclaimer.html：免责声明；可从发布确认流程或页面页脚打开，返回首页。
- admin.html：管理页面。随包仅作为现有页面/视觉上下文参考，不属于本次 UI 主任务的默认修改范围。
- 静态图片资源：zhixin-xuefu-icon.png、icon-512.png、icon-512-v2.png、icon-512-v3.png。
- item.html 和 publish.html 引用了外部 CDN 脚本。该交接包不下载或重打包第三方库。

主要跳转关系：

首页 index.html → 商品详情 item.html?id=…
首页导航/空状态 → 商品发布 publish.html
商品详情 → 返回首页；发布者编辑 → publish.html?id=…
发布页 → 免责声明 disclaimer.html；成功后的结果页可返回首页或打开商品详情
新生指南 guide.html → 首页或发布页
管理页 admin.html → item.html?id=…&ref=admin

当前页面的品牌文字仍有“杭电信息资源共享平台”“智信学府”等旧名称。UI 开发者需要统一为“寻应”时，可在允许的前端页面内处理品牌与导航文案。

## 4. UI 页面与功能清单

### 买家首页：自然语言搜索

当前代码已有自然语言输入区、示例句、解析状态和开始找商品按钮。调用 POST /api/ai，action 为 parse_need。页面会将解析结果转成可确认条件表单，不应把模型结果直接当作已确认需求。

### AI 条件确认

现有条件编辑区允许用户检查并修改关键词、预算、校区、时间等条件，之后再主动点击确认条件并查找资源。缺失字段与解析警告应以待确认方式展示。缺失值仍按接口合同的 null 处理，不由 UI 猜测补齐。UI 可重构表单布局与说明，但应维持原字段值、枚举和类型。

### 推荐卡片与商品详情

首页现有规则匹配结果卡，展示资源标题、价格、类别/类型、校区、交易时间、描述、图片占位、来源/审核状态和规则理由；结果操作可进入详情页。当前商品候选为演示 JSON，不是 Supabase 实时查询结果。

### 无结果与接力预览

当前代码区分 matched、no_matches 与 dataset_not_connected。无匹配时可以修改条件或由用户主动选择生成接力预览。POST /api/relay/preview 只生成待确认预览，不发布、不落库、不代表有人响应。

### 卖家 AI 帖子提取界面（准备新增）

当前 publish.html 尚未调用 parse_listing，也没有 AI 帖子提取结果编辑界面。建议由 UI 开发者在现有发布体验中设计一条独立的草稿整理路径：

1. 用户粘贴帖子原文。
2. UI 调用 parse_listing 并显示原文、总体摘要、出售项和求购项。
3. 每个提取字段可编辑；证据原文、待补字段、不确定字段和 warning 应清楚展示。
4. 用户只能在界面本地检查、修改、复制草稿或返回，不显示“服务端已确认”“审核通过”或“已发布”。

这条路径只是对已有解析接口的 UI 接入设计。AI 草稿不能自动发布；当前接口没有帖子确认、保存、商品写入或发布 API。原有 publish.html 表单的旧发布功能与 parse_listing 草稿解析是两回事，不能把旧发布成功状态用于表示 AI 草稿已发布。

## 5. AI 与匹配接口

完整接口字段、枚举、响应示例与错误状态以随包的 AI接口交接说明-UI接入.md 为准。该文件来自当前工作区 outputs/AI接口交接说明-UI接入.md，本次作为原文副本附入交接包；不要从本说明猜测接口字段。

接口清单：

- 买家需求解析：POST /api/ai，body 为 action=parse_need、needText。
- 卖家帖子提取：POST /api/ai，body 为 action=parse_listing、rawText。
- 规则匹配：POST /api/resource-match，body 为 need、resources。
- 接力预览：POST /api/relay/preview，body 为经用户核对的 need。

UI 必须处理 HTTP 状态码、业务 status、warnings 与 needsConfirmation。特别是 dataset_not_connected 表示候选数据集未接入，不表示校园中没有资源；no_matches 表示此次候选数据没有正分匹配。接口使用统一 camelCase 字段；null、数组、status、warnings、version、枚举和类型都必须依交接文档。

parse_listing 的商品草稿字段与证据字段必须照接口说明展示。接口会固定返回待人工审核、未确认、不可发布标记。warning 为空也不代表草稿可发布。10 条留出调用中曾观察到解析质量问题，用户仍须逐项人工核对。

## 6. 已有能力与边界

当前源码与接口说明共同支持以下判断：

- 买家自然语言解析、条件确认、显式演示候选的规则匹配、匹配理由与接力预览已接入前端代码。
- 匹配和排序由 Worker 中普通 JavaScript 规则完成，不由 AI 推分或生成商品。
- 演示数据为 17 条自制资源，source 标记为 synthetic_demo_seed，核验状态为 pending_verification；它们不是 Supabase 实时数据，也不应称为真实已核验校园商品。
- parse_listing 已存在于当前工作区 Worker 接口说明范围内，但卖家 UI 尚未接入。
- AI 帖子草稿没有服务端人工确认、持久化或发布接口。
- 本次没有调用模型、访问 Preview 页面或重新运行历史测试；Preview 网址作为用户提供的参考入口保留，当前线上页面与 Worker 是否仍一致未在本轮验证。
- 本说明描述的是当前 checkout 静态代码和随附接口文档，不构成 Production/Preview 的在线可用性证明。

## 7. 视觉设计参考

设计方向由 UI 开发者具体决定，建议遵循以下约束：

- 明亮白底；
- 蓝色与青绿色作为主色方向；
- 页面主体居中；
- 信息密度适中，优先突出搜索、确认和推荐；
- 视觉克制、精致，贴近校园生活服务平台；
- 保留清晰的来源/核验、待确认、无结果和隐私提示；
- 桌面与窄屏都保证主要闭环易读易操作。

不要求照搬现有视觉，也不预设具体组件库、字体、卡片形状或动效。

## 8. UI 开发者的文件边界

### 建议可修改

交接包中的以下前端文件可按 UI 任务需要修改：

- src/index.html：买家首页、自然语言搜索、条件确认、推荐卡和接力预览。
- src/item.html：商品详情视觉与信息层次。
- src/publish.html：卖家帖子提取 UI 的承载页面；原有发布流程只能在保持行为契约的范围内调整。
- src/guide.html、src/disclaimer.html：如需统一导航、品牌和辅助页面样式。
- assets/ 中现有图片可被页面引用；新增纯 UI 图片可放在 assets/。
- README.md 与本说明用于理解边界；不要把临时测试数据放进交接目录。

src/admin.html 仅供理解当前页面结构和视觉，不默认纳入本次交付的修改范围。

### 不应修改或接管

- 不修改 _worker.js、AI Prompt、模型/provider、AI 解析规则或接口响应合同。
- 不修改 resource-match 的过滤、评分、排序与 reasons 规则。
- 不实现前端自造的商品字段或第二套统一资源对象。
- 不把本地 UI 确认伪装成服务端审核确认。
- 不将 AI 草稿自动写入数据库或自动发布。
- 不修改 Supabase schema、RLS、SQL、Storage、数据库配置或 Secret。
- 不改动服务端身份、token、写入授权和管理员安全逻辑。
- 不部署、不提交、不推送；如开发者处于其他授权上下文，仍按其任务授权执行。

如 UI 任务确实需要上述边界外的改动，应先单独提出文件、原因、接口影响及验收方式，等待技术负责人明确分派。

## 9. 交接包清单与安全处理

交接目录包含：

- README.md
- UI开发交接说明.md
- AI接口交接说明-UI接入.md
- src/ 下的首页、详情、发布、管理、指南和免责声明 HTML 源码副本
- assets/ 下现有公开 PNG 图标
- data/public-demo-resources.json

排除：

- .env、.dev.vars、.wrangler/、node_modules/、本地缓存、数据库文件、凭据和 Secret 文件；
- _worker.js 与部署配置，避免把服务端 AI、匹配、数据库代理逻辑作为 UI 可修改文件交付；
- 内部测试留出集、逐条模型结果、质量报告、内部交接记录和 SQL/数据库安全脚本；
- 当前不需要的旧 CSV、压缩包和原始帖子材料。

前端 HTML 副本里的 SUPABASE_KEY 配置已替换为 __REDACTED_SUPABASE_KEY__。这不是可用 key。交接包不含服务端密钥；不得把本地凭据复制给 UI 开发者。

演示数据已检查为 17 条记录，未发现联系方式、用户 ID、IP、token、secret、cookie、住址等字段名；不含图片 URL。所有记录属于自制演示数据，且标记为待核验。

## 10. 推荐交接顺序

1. 先读 README.md 与本说明，再读 AI接口交接说明-UI接入.md。
2. 以 src/index.html、src/item.html、src/publish.html 为主要改造范围。
3. 先完成买家搜索→条件确认→推荐/无结果预览的视觉与交互，再新增卖家 parse_listing 草稿界面。
4. 保留接口请求、字段名、状态语义与人工审核边界。
5. 交付 UI diff 和页面截图/人工走查记录；不要用本交接包的脱敏 key 副本进行真实数据库写入。

本次交接只提供当前本地 UI 源码快照及边界说明；未修改项目业务源码、AI 接口、数据库或部署状态。
