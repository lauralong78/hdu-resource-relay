(function (root) {
  'use strict';

  var SUPABASE_URL = 'https://laqliecldqfjfhsooyey.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_qi2Q0YL4AttETlna_wXqRA_aNovSxCG';
  var client;

  function authClient() {
    if (!root.supabase || !root.supabase.createClient) {
      throw new Error('认证组件未加载，请检查网络后刷新页面。');
    }
    if (!client) {
      client = root.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
    }
    return client;
  }

  // 号码仅作账号名；注册和登录共用映射，不使用 Supabase Phone Provider。
  function normalizeAccount(value) {
    var account = String(value || '').trim();
    if (!/^1[3-9]\d{9}$/.test(account)) {
      throw new Error('请输入 11 位账号号码，例如 13800138000。');
    }
    return account;
  }

  function accountEmail(value) {
    // .invalid 是保留域名，不用于收发邮件或密码找回。
    return 'cn86' + normalizeAccount(value) + '@account.xunying.invalid';
  }

  function validatePassword(password, confirmation, registering) {
    if (typeof password !== 'string' || password.length < 6) {
      throw new Error('密码至少需要 6 位；如项目配置要求更长，请以服务端提示为准。');
    }
    if (registering && password !== confirmation) throw new Error('两次输入的密码不一致。');
  }

  function errorMessage(error) {
    var messages = {
      invalid_credentials: '账号号码或密码错误，请检查后重试。',
      email_not_confirmed: '内部邮箱尚未确认。请联系项目维护者检查 Confirm Email 配置。',
      email_provider_disabled: '内部邮箱认证未启用，请联系项目维护者启用 Email Provider。',
      email_address_invalid: 'Supabase 拒绝内部账号标识地址；此方案尚不能实际注册，请将错误代码告知项目维护者。',
      signup_disabled: '当前项目暂未开放注册，请联系项目维护者。',
      user_already_exists: '该账号号码已注册，请切换到登录。',
      email_exists: '该账号号码已注册，请切换到登录。',
      weak_password: '密码不符合服务端强度要求，请使用更长且包含多种字符的密码。',
      over_request_rate_limit: '操作过于频繁，请稍后重试。',
      captcha_failed: '当前项目启用了验证码要求，本轮界面尚未接入，请联系项目维护者。',
      session_not_found: '会话已失效，请重新登录。',
      refresh_token_not_found: '会话已失效，请重新登录。',
      refresh_token_already_used: '会话已失效，请重新登录。'
    };
    if (messages[error && error.code]) return messages[error.code];
    if (error && error.status === 429) return '操作过于频繁，请稍后重试。';
    if (error && error.name === 'AuthWeakPasswordError') return messages.weak_password;
    if (error && error.name === 'AuthSessionMissingError') return messages.session_not_found;
    // 不直接展示服务端原始错误，避免回显账号号码或其他敏感信息。
    return '认证请求失败，请检查网络；如持续失败，请由项目维护者核对 Auth 配置和错误代码。';
  }

  async function signInOrUp(account, password, confirmation, registering) {
    var email = accountEmail(account);
    validatePassword(password, confirmation, registering);
    var auth = authClient().auth;
    if (registering) {
      // 禁止 Confirm Email 开启时向内部保留域名发送验证邮件。
      var response;
      try {
        response = await root.fetch(SUPABASE_URL + '/auth/v1/settings', {
          headers: { apikey: SUPABASE_KEY }, cache: 'no-store'
        });
      } catch (_) { throw new Error('无法检查注册配置，请检查网络后重试。'); }
      if (!response.ok) throw new Error('无法检查注册配置，请联系项目维护者。');
      var settings = await response.json();
      if (!settings.external || settings.external.email !== true) {
        throw new Error('内部邮箱认证尚未启用，请在 Supabase 控制台启用 Email Provider。');
      }
      if (settings.mailer_autoconfirm !== true) {
        throw new Error('请先在 Supabase 控制台关闭 Confirm Email。本页面不发送验证邮件。');
      }
      if (settings.disable_signup) throw new Error('当前项目暂未开放注册，请联系项目维护者。');
    }
    var result = registering
      ? await auth.signUp({ email: email, password: password })
      : await auth.signInWithPassword({ email: email, password: password });
    if (result.error) throw new Error(errorMessage(result.error));
    var session = result.data && result.data.session;
    if (!session || !session.access_token || !session.user || !session.user.id) {
      throw new Error(registering
        ? '注册未返回有效会话，当前未登录。请核对 Email Provider、Confirm Email 和 Auth 日志；不要重复注册或伪造登录状态。'
        : '登录未返回有效会话，请检查 Auth 配置后重试。');
    }
    return session;
  }

  async function restoreSession() {
    var auth = authClient().auth;
    var result = await auth.getSession();
    if (result.error) throw new Error(errorMessage(result.error));
    if (!result.data.session) return null;
    // 向 Auth 核验持久化会话；本地 UI 状态不能作为任何业务授权依据。
    var verified = await auth.getUser();
    if (verified.error) throw new Error(errorMessage(verified.error));
    if (!verified.data.user || !verified.data.user.id) throw new Error('会话无效，请重新登录。');
    return Object.assign({}, result.data.session, { user: verified.data.user });
  }

  async function signOut() {
    var result = await authClient().auth.signOut({ scope: 'local' });
    if (result.error) throw new Error(errorMessage(result.error));
  }

  root.XunyingAuth = {
    normalizeAccount: normalizeAccount,
    accountEmail: accountEmail,
    validatePassword: validatePassword,
    signInOrUp: signInOrUp,
    restoreSession: restoreSession,
    signOut: signOut,
    onChange: function (callback) { return authClient().auth.onAuthStateChange(callback); }
  };
})(window);
