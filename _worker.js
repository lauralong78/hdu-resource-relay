/**
 * Cloudflare Pages Advanced Mode (高级模式) — _worker.js
 *
 * 说明：Cloudflare Pages 拖拽上传（dashboard drag-and-drop）不编译 /functions 目录，
 * 但支持根目录的 _worker.js（高级模式单文件 Worker）。本文件在 Pages 上以
 * env.ASSETS 托管静态资源，同时接管 /api/* 的 Supabase 代理与 /api/ai 的 Workers AI。
 *
 * VUL-005 修复：收紧 CORS 策略，不允许任意来源访问。
 * VUL-P0 修复：device_token 必须经过服务端 HMAC 签名，客户端无法伪造身份。
 * 生产环境部署前，将 TOKEN_SECRET 替换为 64+ 字符随机串。
 */

// ⚠️ 部署前替换为随机生成的长字符串（建议 64+ 字符）
const TOKEN_SECRET = 'campus-market-dev-secret-replace-in-production-2026';

// 版本指纹：用于线上自检是否部署了最新后端（GET /api/ai 可见 / 所有 /api/ai 响应带 version 字段）
const VERSION = '20260827-rls-write-proxy-fix';

// Supabase 上游（由 catch-all 代理转发）
const SUPABASE_HOST = 'laqliecldqfjfhsooyey.supabase.co';

async function hmacSign(data, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacVerify(data, signatureBase64, secret) {
  const expected = await hmacSign(data, secret);
  return expected === signatureBase64;
}

// 管理端会话 token：格式 "A.<签名>"，随小时桶滚动签发，验证仅认服务端 HMAC
async function makeAdminToken(hourBucket) {
  return 'A.' + await hmacSign('admin:' + hourBucket, TOKEN_SECRET);
}
async function verifyAdminToken(tok) {
  if (typeof tok !== 'string' || !/^A\./.test(tok)) return false;
  const bucket = Math.floor(Date.now() / 3600000);
  for (let i = 0; i < 2; i++) {
    if (tok === await makeAdminToken(bucket - i)) return true;
  }
  return false;
}

function setCorsHeaders(headers, origin) {
  const ALLOWED_ORIGINS = [
    'https://campus-market.pages.dev',
    'https://hd2-6pi.pages.dev',
    'http://localhost:8788',
    'http://127.0.0.1:8788'
  ];
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  } else {
    headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, Prefer, x-device-token');
  headers.set('Access-Control-Max-Age', '86400');
}

function setSecurityHeaders(headers) {
  headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
}

// ==================== AI 助手（/api/ai） ====================
const TEXT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
// 视觉模型备用链（主模型容量繁忙3040/3099或不可用时自动切换）：
//   format 'messages' = OpenAI 风格 messages+image_url（llama-3.2-vision / qwen-vl）
//   format 'image'    = Cloudflare 原生 image:[]+prompt（llava-1.5-7b，免费，中文细字较弱仅作兜底）
const VISION_FALLBACK_MODELS = [
  { model: '@cf/llava-hf/llava-1.5-7b-hf', format: 'image' }
];

function aiJson(headers, obj, status) {
  headers.set('Content-Type', 'application/json');
  if (obj && typeof obj === 'object') { try { obj.version = VERSION; } catch (_) {} }
  return new Response(JSON.stringify(obj), { status: status || 200, headers });
}

// 将模型返回的任意字段安全转成字符串，避免出现 "[object Object]"
function toStr(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v.map(toStr).filter(Boolean).join('、');
  }
  if (typeof v === 'object') {
    var pick = v.value !== undefined ? v.value
      : (v.name !== undefined ? v.name
      : (v.title !== undefined ? v.title
      : (v.text !== undefined ? v.text : undefined)));
    if (pick !== undefined) return toStr(pick);
    try {
      var vals = Object.values(v);
      if (vals.length) return toStr(vals);
      return '';
    } catch (_) { return JSON.stringify(v); }
  }
  return String(v);
}

// 最终消毒：把 [object Object] 等机器文本剔除；仅对单个字段值使用，不整段删除
function cleanStr(v) {
  return String(toStr(v)).replace(/\s*\[object[^\]]*\]\s*/gi, '').trim();
}

// 识别结果兜底：任何情况下 name/description 都不能同时为空；模型输出原文作为 debug 透传，便于定位
function finalizeRecog(headers, name, description, debug) {
  const n = cleanStr(name);
  let d = cleanStr(description);
  if (!n && !d) {
    // 名字与描述都为空：把模型原始输出放进来，绝不返回空 JSON
    d = String(debug || '').trim() || '未识别到有效内容，请手动填写';
    return aiJson(headers, { name: n, description: d.slice(0, 200), _empty: true });
  }
  return aiJson(headers, { name: n, description: d, _empty: false });
}

// 从模型输出中提取 JSON（容错：模型可能带 ```json 包裹或前后杂字）
function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/```json/gi, '').replace(/```/g, '');
  try { return JSON.parse(s); } catch (_) {}
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

// base64（可能带 data:image 前缀）转 Uint8Array
function base64ToBytes(base64) {
  const clean = String(base64).replace(/^data:image\/[a-zA-Z+.-]+;base64,/, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// 处理 POST /api/ai（polish / audit / search / recognize）
async function handleAI(request, env, headers) {
  if (request.method !== 'POST') {
    return aiJson(headers, { error: 'Method not allowed' }, 405);
  }
  if (!env || !env.AI) {
    return aiJson(headers, { error: 'AI 未绑定：请在 Cloudflare 后台给该项目添加 Workers AI binding（变量名 AI）' }, 500);
  }
  try {
    const body = await request.json();
    const action = body.action || 'polish';

    // ---- 文本模型：polish / audit / search ----
    if (action === 'polish' || action === 'audit' || action === 'search') {
      if (action === 'search') {
        const query = String(body.query || '').trim();
        if (!query) return aiJson(headers, { error: '缺少搜索词' }, 400);
        const prompt =
          '你是校园二手交易平台的搜索助手。把用户的自然语言搜索词解析成结构化关键词，用于匹配商品名称/描述/分类。\n' +
          '只输出 JSON（不要输出任何其他文字）：{"keywords":["关键词1","关键词2"],"priceHint":"cheap或expensive或null","category":"分类名或null"}\n' +
          '分类只能是：书籍、电子产品、日用品、交通工具、卡类、学习用品、其他。\n' +
          'priceHint 规则：用户提到"便宜/低价/性价比/省钱"填 cheap；提到"贵/高端/好一点"填 expensive；否则填 null。\n' +
          'keywords 要提炼出能命中商品名称/描述/分类的具体名词，1-3 个即可，不要保留"便宜/适合/推荐"这类修饰词。\n' +
          '示例：\n' +
          '"便宜的电竞椅" → {"keywords":["电竞椅","椅子"],"priceHint":"cheap","category":null}\n' +
          '"适合新生的台灯" → {"keywords":["台灯","新生","宿舍"],"priceHint":null,"category":null}\n' +
          '"考研的二手教材" → {"keywords":["教材","考研","二手"],"priceHint":null,"category":"书籍"}\n\n' +
          '用户搜索：' + query;
        const output = await env.AI.run(TEXT_MODEL, {
          messages: [
            { role: 'system', content: '你是校园二手交易平台的搜索助手，只输出合法 JSON，不要解释。' },
            { role: 'user', content: prompt }
          ]
        });
        const reply = (output && output.response) ? output.response : '';
        const parsed = extractJson(reply);
        if (parsed && Array.isArray(parsed.keywords)) {
          return aiJson(headers, {
            keywords: parsed.keywords.map(function (k) { return String(k).trim(); }).filter(Boolean),
            priceHint: parsed.priceHint || null,
            category: parsed.category || null
          });
        }
        return aiJson(headers, { keywords: [query], priceHint: null, category: null });
      }

      // polish / audit
      const text = String(body.text || '').trim();
      if (!text) return aiJson(headers, { error: '缺少待处理文本' }, 400);
      const prompt = action === 'audit'
        ? '你是校园二手交易平台的合规审核员。判断下面商品描述是否含违禁内容（违禁品、管制刀具、药品烟草、色情赌博、联系方式广告、刷单代购等）。只回复"合规"，或"违规：一句话原因"。\n\n商品描述：\n' + text
        : '你是校园二手交易平台的文案助手。把下面商品描述润色得更通顺、更有吸引力：保留原意和所有关键信息（品牌型号、成色、配件、价格、出售原因等），语气自然口语化，不虚构信息，控制在150字以内。直接输出润色后文本，不要解释。\n\n原文：\n' + text;
      const output = await env.AI.run(TEXT_MODEL, {
        messages: [
          { role: 'system', content: '你是校园二手交易平台的智能助手，回答简洁、口语化、中文。' },
          { role: 'user', content: prompt }
        ]
      });
      const reply = (output && output.response !== undefined) ? output.response : '';
      // 后端消毒：确保 result 永远是字符串，杜绝前端出现 "[object Object]"
      return aiJson(headers, { result: toStr(reply) });
    }

    // ---- 视觉模型：recognize ----
    if (action === 'recognize') {
      const image = body.image;
      if (!image) return aiJson(headers, { error: '缺少图片数据' }, 400);
      // 前端压缩后为裸 JPEG base64，拼回 data URI 供视觉模型使用
      const dataUri =
        'data:image/jpeg;base64,' + String(image).replace(/^data:image\/[a-zA-Z+.-]+;base64,/, '');
      const prompt =
        '识别图片中的物品，用于校园二手交易平台发布商品。' +
        '请严格只输出一个 JSON 对象（不要输出任何解释、注释或其他文字）。' +
        '若图片是单个物品，输出：{"name":"商品名称","description":"商品描述"}。' +
        '若图片是多个同类物品（例如一排书脊、多本书、多个相同物品），输出：' +
        '{"books":[{"name":"物品1名称","description":"物品1描述"},{"name":"物品2名称","description":"物品2描述"}]}，最多列出图中清晰可见的前5个。' +
        '【最重要的规则——禁止瞎编】name 和 description 只能写图中真实可见的内容：' +
        '书名、品牌、型号必须以图中能看到的具体文字为准，逐字照抄，绝不能凭想象或联想补充；' +
        '若书名或品牌文字看不清，name 写"书名看不清"或"品牌看不清"，description 只描述可见特征（如"书脊文字模糊""封面色调偏蓝"），禁止虚构具体书名或品牌；' +
        '多本书时逐本列出，不要把几本书的名都堆在第一个 name 里；' +
        'name 不超过15字，description 不超过30字，用简体中文。' +
        'name 和 description 必须是字符串，严禁输出 null、空字符串、空对象或省略字段；' +
        '若实在看不出任何内容，name 写"识别不出"，description 写"请手动填写"。';
      let output;
      // 多模型 fallback + 容量过载退避重试：
      // 3040/3099 = 模型容量过载（临时繁忙），退避重试；5016 = Community License 未确认，先 agree 再试；
      // 其它异常（模型不可用/输入非法等）自动切换下一个备用模型。
      const MODELS = [{ model: VISION_MODEL, format: 'messages' }].concat(VISION_FALLBACK_MODELS);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const isBusy = (msg) => msg.indexOf('3040') !== -1 || msg.indexOf('3099') !== -1;
      const buildRun = (spec) => () => {
        if (spec.format === 'image') {
          // llava 等原生格式：image 需传字节数组（剥离 data:...;base64, 前缀）
          const b64 = dataUri.indexOf(',') !== -1 ? dataUri.substring(dataUri.indexOf(',') + 1) : dataUri;
          const bin = atob(b64);
          const ab = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) ab[i] = bin.charCodeAt(i);
          return env.AI.run(spec.model, { prompt: prompt, image: ab });
        }
        return env.AI.run(spec.model, {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: dataUri } }
              ]
            }
          ]
        });
      };
      let busyErr = null;
      for (const spec of MODELS) {
        const run = buildRun(spec);
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            output = await run();
            break;
          } catch (e) {
            const msg = e && e.message ? String(e.message) : '';
            if (msg.indexOf('5016') !== -1) {
              // Community License 未确认：先 agree 再试一次
              try { await env.AI.run(spec.model, { prompt: 'agree' }); } catch (_) {}
              try { output = await run(); break; } catch (e2) {
                const m2 = e2 && e2.message ? String(e2.message) : '';
                if (isBusy(m2)) busyErr = e2;
              }
            } else if (isBusy(msg)) {
              busyErr = e;
              await sleep(1500 * Math.pow(2, attempt) + 500 * attempt);
            } else {
              // 其它异常：视为该模型不可用，切换下一个备用模型
              break;
            }
          }
        }
        if (output) break;
      }
      if (!output) {
        if (busyErr) {
          return aiJson(headers, { error: 'AI 识别服务暂时繁忙，请稍等几秒后重试，也可直接手动填写' }, 503);
        }
        const emsg = busyErr && busyErr.message ? String(busyErr.message) : '';
        return aiJson(headers, { error: 'AI 识别调用失败' + (emsg ? '：' + emsg : '') }, 500);
      }
      // llama-3.2-vision 返回 output.response；llava-1.5-7b 返回 output.description，二者兼容
      // 注意：部分模型会返回对象结构，直接 String() 会变成 "[object Object]"，故对象一律转 JSON 字符串交给 extractJson 解析
      const _recRaw = output ? (output.response || output.description || '') : '';
      const desc = (_recRaw === null || _recRaw === undefined) ? '' : (typeof _recRaw === 'string' ? _recRaw : JSON.stringify(_recRaw));
      const parsed = extractJson(desc);
      if (parsed) {
        // 多本书 / 多个同类物品：books 数组
        const books = Array.isArray(parsed.books) ? parsed.books : null;
        if (books && books.length) {
          const names = books.map(function (b) { return cleanStr(b && b.name); }).filter(Boolean);
          const descs = books.map(function (b) { return cleanStr(b && b.description); }).filter(Boolean);
          if (names.length || descs.length) {
            return aiJson(headers, {
              name: names.join('、'),
              description: descs.join('\n'),
              count: books.length
            });
          }
          // books 里全部为空字段：把模型原文回退给用户填写
          return finalizeRecog(headers, '', '', desc);
        }
        // 单个物品
        return finalizeRecog(headers, parsed.name, parsed.description, desc);
      }
      // JSON 解析失败：把模型原始输出作为描述返回，绝不返回空 JSON
      return finalizeRecog(headers, '', '', desc);
    }

    return aiJson(headers, { error: '未知 action：' + action }, 400);
  } catch (e) {
    return aiJson(headers, { error: 'AI 调用失败：' + (e && e.message ? e.message : '未知错误') }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const method = request.method;

    // OPTIONS 预检直接放行
    if (method === 'OPTIONS') {
      const headers = new Headers();
      setCorsHeaders(headers, origin);
      return new Response(null, { status: 204, headers });
    }

    // ---- /api/device-token：生成签名 token ----
    if (url.pathname === '/api/device-token') {
      // 优先复用客户端现有 uuid（?uuid=xxx），避免升级签名时设备身份漂移导致"我的发布"不同步
      const reqUuid = url.searchParams.get('uuid') || '';
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reqUuid) ? reqUuid : crypto.randomUUID();
      const sig = await hmacSign(uuid, TOKEN_SECRET);
      const signedToken = uuid + '.' + sig;
      const headers = new Headers({ 'Content-Type': 'application/json' });
      setCorsHeaders(headers, origin);
      return new Response(JSON.stringify({ token: signedToken }), { status: 200, headers });
    }

    // ---- /api/ai：AI 助手（无需 device_token，走 Workers AI binding）----
    if (url.pathname === '/api/ai') {
      if (method !== 'POST') {
        // GET 诊断接口：浏览器直接访问即可确认当前部署的后端版本
        const h = new Headers({ 'Content-Type': 'application/json' });
        setCorsHeaders(h, origin);
        return new Response(JSON.stringify({
          status: 'ok',
          name: 'campus-market',
          version: VERSION,
          aiBinding: !!(env && env.AI),
          textModel: TEXT_MODEL,
          visionModel: VISION_MODEL,
          visionModels: [VISION_MODEL].concat(VISION_FALLBACK_MODELS.map(function (m) { return m.model; })),
          note: '这是新版 _worker.js 的响应，若你看到本 JSON 说明最新后端已生效'
        }), { status: 200, headers: h });
      }
      const headers = new Headers();
      setCorsHeaders(headers, origin);
      return await handleAI(request, env, headers);
    }

    // ---- /admin-login：管理端登录（密码存于服务端 env，签发小时级会话 token）----
    if (url.pathname === '/admin-login') {
      const jh = new Headers({ 'Content-Type': 'application/json' });
      setCorsHeaders(jh, origin);
      if (method !== 'POST') {
        return new Response(JSON.stringify({ valid: false, error: '仅支持 POST' }), { status: 405, headers: jh });
      }
      let body = {};
      try { body = await request.json(); } catch (_) {}
      if (url.searchParams.get('action') === 'verify') {
        const valid = await verifyAdminToken(body.token);
        return new Response(JSON.stringify({ valid: valid }), { status: 200, headers: jh });
      }
      const adminPwd = (env && env.SUPABASE_ADMIN_PASSWORD) || '';
      const ok = adminPwd !== '' && typeof body.password === 'string' && body.password === adminPwd;
      if (!ok) {
        return new Response(JSON.stringify({ valid: false, error: '密码错误' }), { status: 401, headers: jh });
      }
      const bucket = Math.floor(Date.now() / 3600000);
      const token = await makeAdminToken(bucket);
      return new Response(JSON.stringify({ token: token, valid: true }), { status: 200, headers: jh });
    }

    // ---- /api/*：Supabase 代理（写操作需验证 device_token 签名，管理端需 x-admin-key）----
    if (url.pathname.startsWith('/api/')) {
      const isAdminRequest = await verifyAdminToken(request.headers.get('x-admin-key') || '');
      let reqUuid = '';
      if (!isAdminRequest && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        const tokenHeader = request.headers.get('x-device-token');
        if (!tokenHeader) {
          return new Response(JSON.stringify({ error: '缺少 x-device-token，请刷新页面后重试' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin || '*' }
          });
        }
        const dotIndex = tokenHeader.lastIndexOf('.');
        if (dotIndex <= 0) {
          return new Response(JSON.stringify({ error: 'device_token 格式无效，请刷新页面后重试' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin || '*' }
          });
        }
        reqUuid = tokenHeader.substring(0, dotIndex);
        const sig = tokenHeader.substring(dotIndex + 1);
        const valid = await hmacVerify(reqUuid, sig, TOKEN_SECRET);
        if (!valid) {
          return new Response(JSON.stringify({ error: 'device_token 签名无效，请刷新页面后重试' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin || '*' }
          });
        }
      }

      // ---- VUL-RLS 修复（B 档）：DB 写表权限收敛到 service_role，仅经本 Worker 放行 ----
      // 功能说明：启用 RLS 后 anon 仅可 SELECT，写（INSERT/PATCH/DELETE）经本代理用
      // SUPABASE_SERVICE_KEY（service_role，绕过 RLS）执行，并在代理层做商品归属校验。
      const svcKey = (env && env.SUPABASE_SERVICE_KEY) || '';
      const isAdmin = isAdminRequest;
      let newBody;
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        if (!svcKey) {
          return new Response(JSON.stringify({ error: '服务端未配置 SUPABASE_SERVICE_KEY，写操作不可用' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin || '*' }
          });
        }
        // 管理表写：blacklist/audit_logs 全部、reports 的 PATCH/DELETE（改状态）须管理员；
        // reports 的 INSERT（举报提交）属普通用户行为，放行并注入 reporter_user_id
        if (/\/rest\/v1\/(blacklist|audit_logs)$/.test(url.pathname)
            || ((method === 'PATCH' || method === 'DELETE') && /\/rest\/v1\/reports$/.test(url.pathname))) {
          if (!isAdmin) {
            return new Response(JSON.stringify({ error: '无权操作，该接口需要管理员凭证' }), {
              status: 403,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin || '*' }
            });
          }
        }
        // PATCH/DELETE items：先查归属，仅发布者本人（或管理员）可编辑/删除
        if (!isAdmin && (method === 'PATCH' || method === 'DELETE') && /\/rest\/v1\/items$/.test(url.pathname)) {
          const idParam = url.searchParams.get('id') || '';
          const idMatch = /^eq\.(\d+)$/.exec(idParam);
          if (!idMatch) {
            return new Response(JSON.stringify({ error: '缺少有效的商品 id 参数' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin || '*' }
            });
          }
          const chkUrl = 'https://' + SUPABASE_HOST + '/rest/v1/items?id=eq.' + idMatch[1] + '&select=user_id';
          const chkRes = await fetch(chkUrl, {
            headers: { apikey: svcKey, Authorization: 'Bearer ' + svcKey }
          });
          if (!chkRes.ok) {
            return new Response(JSON.stringify({ error: '无法校验商品归属，请稍后重试' }), {
              status: 502,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin || '*' }
            });
          }
          const rows = await chkRes.json();
          const owner = Array.isArray(rows) && rows[0] ? rows[0].user_id : null;
          if (!owner) {
            return new Response(JSON.stringify({ error: '商品不存在或已删除' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin || '*' }
            });
          }
          if (owner !== reqUuid) {
            return new Response(JSON.stringify({ error: '无权操作该商品，仅发布者本人可编辑/删除' }), {
              status: 403,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin || '*' }
            });
          }
        }
        // POST items/reports：强制注入归属字段（防止请求方伪造身份归属）
        if (!isAdmin && method === 'POST' && (/\/rest\/v1\/items$/.test(url.pathname) || /\/rest\/v1\/reports$/.test(url.pathname))) {
          const raw = await request.arrayBuffer();
          let payload = {};
          try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch (_) {}
          if (/\/rest\/v1\/items$/.test(url.pathname)) {
            payload.user_id = reqUuid;
          } else {
            payload.reporter_user_id = reqUuid;
          }
          newBody = JSON.stringify(payload);
        }
      }

      // 修复：前端统一请求 /api/rest/v1/...，转发前剥离 /api 前缀再拼到 supabase.co，
      // 否则 Supabase 收到 /api/rest/v1/... 返回 404（所有写操作与后台读写曾因此失效）
      url.pathname = url.pathname.replace(/^\/api(?=\/)/, '');
      url.hostname = SUPABASE_HOST;
      const fwdHeaders = new Headers(request.headers);
      if ((isAdmin || ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) && svcKey && !request.headers.get('authorization')) {
        // 写操作或管理员请求：以 service_role 身份执行（旁路 RLS）；归属/管理鉴权已在上面完成
        fwdHeaders.set('apikey', svcKey);
        fwdHeaders.set('Authorization', 'Bearer ' + svcKey);
      }
      const newRequest = new Request(url.toString(), {
        method: method,
        headers: fwdHeaders,
        body: newBody !== undefined ? newBody : (method !== 'GET' && method !== 'HEAD' ? await request.arrayBuffer() : undefined),
        redirect: 'follow'
      });
      const response = await fetch(newRequest);
      const modifiedHeaders = new Headers(response.headers);
      setCorsHeaders(modifiedHeaders, origin);
      setSecurityHeaders(modifiedHeaders);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: modifiedHeaders
      });
    }

    // ---- 其余请求：交给 Pages 托管静态资源 ----
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not Found', { status: 404 });
  }
};
