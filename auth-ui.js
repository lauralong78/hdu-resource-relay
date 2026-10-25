(function () {
  'use strict';
  var api = window.XunyingAuth;
  var form = document.getElementById('auth-form');
  var nav = document.getElementById('auth-nav');
  var status = document.getElementById('auth-status');
  var account = document.getElementById('auth-account');
  var logout = document.getElementById('auth-logout');
  var register = document.getElementById('auth-register');
  var login = document.getElementById('auth-login');
  var registering = false;
  var busy = false;
  var revision = 0;
  var latestSession = null;
  var restoring = true;

  function message(text, error) {
    if (!status) return;
    status.textContent = text;
    status.style.color = error ? '#a12622' : '#246342';
  }

  function render(session) {
    var user = session && session.access_token && session.user;
    if (nav) nav.textContent = user ? '账号 / 退出' : '登录 / 注册';
    if (!form) return;
    form.hidden = !!user;
    account.hidden = !user;
    document.getElementById('auth-modes').hidden = !!user;
    if (user) {
      var match = /^cn86(1[3-9]\d{9})@account\.xunying\.invalid$/.exec(String(user.email || ''));
      var accountNumber = match && match[1];
      document.getElementById('auth-identity').textContent = accountNumber
        ? '已登录：' + accountNumber.slice(0, 3) + '****' + accountNumber.slice(-4) : '已登录';
    }
  }

  function setBusy(value) {
    busy = value;
    if (form) Array.from(form.elements).forEach(function (element) { element.disabled = value; });
    [login, register, logout].forEach(function (element) { if (element) element.disabled = value; });
  }

  function mode(value) {
    if (busy) return;
    registering = value;
    document.getElementById('auth-confirm-field').hidden = !value;
    document.getElementById('auth-confirm').required = value;
    document.getElementById('auth-password').autocomplete = value ? 'new-password' : 'current-password';
    document.getElementById('auth-password').value = '';
    document.getElementById('auth-confirm').value = '';
    document.getElementById('auth-submit').textContent = value ? '注册' : '登录';
    login.setAttribute('aria-pressed', String(!value));
    register.setAttribute('aria-pressed', String(value));
    message(value ? '注册后应直接登录，无需验证码。' : '请输入账号号码和密码。', false);
  }

  async function init() {
    if (form) {
      login.addEventListener('click', function () { mode(false); });
      register.addEventListener('click', function () { mode(true); });
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        message(registering ? '正在检查配置并注册…' : '正在登录…', false);
        try {
          var session = await api.signInOrUp(
            document.getElementById('auth-phone').value,
            document.getElementById('auth-password').value,
            document.getElementById('auth-confirm').value,
            registering
          );
          render(session);
          message(registering ? '注册成功，已登录。' : '登录成功。', false);
        } catch (error) { message(error.message, true); }
        finally {
          document.getElementById('auth-password').value = '';
          document.getElementById('auth-confirm').value = '';
          setBusy(false);
        }
      });
      logout.addEventListener('click', async function () {
        if (busy) return;
        setBusy(true);
        try {
          await api.signOut();
          render(null);
          message('已退出当前浏览器的登录。', false);
        } catch (error) { message(error.message, true); }
        finally { setBusy(false); }
      });
    }
    setBusy(true);
    message('正在检查会话…', false);
    try {
      var subscription = api.onChange(function (event, session) {
        if (event === 'INITIAL_SESSION') return; // 初始持久化会话还需 getUser 核验。
        revision++;
        latestSession = session;
        if (restoring) return;
        render(session);
        if (form && !busy) message(session ? '登录状态已更新。' : '已退出登录，请重新登录。', false);
      });
      window.addEventListener('pagehide', function (event) {
        if (!event.persisted) subscription.data.subscription.unsubscribe();
      });
      var before = revision;
      var session = await api.restoreSession();
      if (before !== revision) session = latestSession;
      render(session);
      message(session ? '会话已恢复。' : '请输入账号号码和密码。', false);
    } catch (error) {
      render(null);
      message(error.message, true);
      if (nav) nav.textContent = '账号（会话待检查）';
    } finally { restoring = false; setBusy(false); }
  }
  init();
})();
