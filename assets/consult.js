// ── 咨询面板：注册设备 → 发文字/图片 → 轮询；不引入外部依赖 ──
(function () {
  "use strict";

  var BASE = "https://" + "xunlongjue.68110923.xyz";
  var KEY = "xlp-pro-contact-2026";
  var TOKEN_KEY = "xlp-pro-consult-token";
  var INSTALL_KEY = "xlp-pro-install-id";

  var panel = document.getElementById("xlp-consult");
  var openBtn = document.getElementById("xlp-consult-open");
  var body = document.getElementById("xlp-consult-body");
  var form = document.getElementById("xlp-consult-form");
  var input = document.getElementById("xlp-consult-input");
  var fileInput = document.getElementById("xlp-consult-file");
  var imageBtn = document.getElementById("xlp-consult-img");
  if (!panel || !openBtn || !body || !form || !input) return;

  var lastId = 0;
  var timer = null;
  var sending = false;
  var pageScroll = 0;

  function isMobile() {
    return window.matchMedia && window.matchMedia("(max-width: 840px)").matches;
  }

  var viewportTimer = null;
  var lastViewportHeight = 0;
  var lastViewportTop = -1;

  function syncViewport() {
    if (!panel.classList.contains("open") || !isMobile()) return;
    var vv = window.visualViewport;
    if (!vv) return;
    // fixed 元素相对布局视口定位；iOS 键盘弹起时视觉视口会整体位移，
    // 必须同时补 height 和 offsetTop，否则页眉被顶出屏幕。
    var height = Math.floor(vv.height);
    var top = Math.round(vv.offsetTop || 0);
    if (Math.abs(height - lastViewportHeight) < 2 && Math.abs(top - lastViewportTop) < 2) {
      return;
    }
    lastViewportHeight = height;
    lastViewportTop = top;
    panel.style.height = height + "px";
    panel.style.top = (top > 0 ? top : 0) + "px";
    panel.style.bottom = "auto";
  }

  function scheduleViewport(delay) {
    if (viewportTimer) clearTimeout(viewportTimer);
    viewportTimer = setTimeout(function () {
      syncViewport();
      // 键盘动画收尾时再补一次；只在去抖后更新，避免页眉逐帧抖。
      viewportTimer = setTimeout(syncViewport, 220);
    }, delay || 100);
  }

  function lockPage() {
    if (!isMobile()) return;
    pageScroll = window.scrollY || window.pageYOffset || 0;
    document.documentElement.classList.add("xlp-consult-open");
    document.body.classList.add("xlp-consult-open");
    // 把 body 钉死，iOS 才没法为了露出输入框去滚文档；
    // 用负 top 保持打开前的页面位置，关闭时再恢复。
    document.body.style.position = "fixed";
    document.body.style.top = "-" + pageScroll + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.bottom = "0";
    document.body.style.width = "100%";
    lastViewportHeight = 0;
    scheduleViewport(0);
  }

  function unlockPage() {
    if (viewportTimer) { clearTimeout(viewportTimer); viewportTimer = null; }
    document.documentElement.classList.remove("xlp-consult-open");
    document.body.classList.remove("xlp-consult-open");
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.bottom = "";
    document.body.style.width = "";
    panel.style.top = "";
    panel.style.height = "";
    panel.style.bottom = "";
    lastViewportHeight = 0;
    if (pageScroll) {
      var root = document.documentElement;
      var previous = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(0, pageScroll);
      root.style.scrollBehavior = previous;
    }
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function installId() {
    var id = localStorage.getItem(INSTALL_KEY);
    if (!id) { id = uuid(); localStorage.setItem(INSTALL_KEY, id); }
    return id;
  }

  function token() { return localStorage.getItem(TOKEN_KEY) || ""; }

  function headers(extra) {
    var h = Object.assign({ Accept: "application/json" }, extra || {});
    if (token()) h["X-Contact-Device"] = token();
    return h;
  }

  function register() {
    return fetch(BASE + "/api/v1/contact/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Contact-Key": KEY },
      body: JSON.stringify({ installId: installId(), label: "PRO", source: "pro" })
    }).then(function (r) {
      if (!r.ok) throw new Error("register " + r.status);
      return r.json();
    }).then(function (data) {
      if (!data || !data.token) throw new Error("register empty");
      localStorage.setItem(TOKEN_KEY, data.token);
      return data.token;
    });
  }

  function ready() {
    return token() ? Promise.resolve() : register();
  }

  function asset(url) {
    if (!url) return "";
    return /^https?:\/\//i.test(url) ? url : BASE + url;
  }

  function clearHint() {
    var hint = body.querySelector(".xlp-consult-hint");
    if (hint) hint.remove();
  }

  function showHint(text) {
    clearHint();
    var p = document.createElement("p");
    p.className = "xlp-consult-hint";
    p.textContent = text;
    body.appendChild(p);
  }

  function render(messages) {
    if (!messages || !messages.length) return;
    clearHint();
    messages.forEach(function (message) {
      if (!message || !message.id || message.id <= lastId) return;
      var row = document.createElement("div");
      row.className = "xlp-msg" + (message.mine ? " mine" : "");
      if (message.kind === "image" && message.image_url) {
        var link = document.createElement("a");
        link.href = asset(message.image_url);
        link.target = "_blank";
        link.rel = "noopener";
        var img = document.createElement("img");
        img.loading = "lazy";
        img.alt = "咨询图片";
        img.src = asset(message.thumb_url || message.image_url);
        link.appendChild(img);
        row.appendChild(link);
      } else {
        var span = document.createElement("span");
        span.textContent = message.body || "";
        row.appendChild(span);
      }
      var time = document.createElement("time");
      time.textContent = message.at_text || "";
      row.appendChild(time);
      body.appendChild(row);
      lastId = message.id;
    });
    body.scrollTop = body.scrollHeight;
  }

  function poll(showError) {
    return fetch(BASE + "/api/v1/contact/messages?since=" + encodeURIComponent(lastId), {
      headers: headers()
    }).then(function (r) {
      if (!r.ok) throw new Error("poll " + r.status);
      return r.json();
    }).then(function (data) {
      render(data.messages || []);
    }).catch(function (err) {
      if (showError) showHint("暂时连不上，请稍后再试。");
      throw err;
    });
  }

  function setOpen(open) {
    panel.classList.toggle("open", open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    openBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) lockPage(); else unlockPage();
    if (!open && timer) { clearInterval(timer); timer = null; }
  }

  function openPanel() {
    setOpen(true);
    ready().then(function () {
      return poll(true);
    }).catch(function () {
      showHint("暂时连不上，请稍后再试。");
    });
    if (timer) clearInterval(timer);
    timer = setInterval(function () { poll(false).catch(function () {}); }, 5000);
    setTimeout(function () { input.focus(); }, 80);
  }

  function closePanel() {
    // 先收键盘，再解锁页面；顺序反了会让 iOS 在解锁后自己滚一下。
    if (input) input.blur();
    setOpen(false);
  }

  function sendText(text) {
    if (sending) return;
    sending = true;
    var submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    ready().then(function () {
      return fetch(BASE + "/api/v1/contact/messages", {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ text: text, clientId: uuid() })
      });
    }).then(function (r) {
      if (r.status === 429) throw new Error("slow");
      if (!r.ok) throw new Error("send " + r.status);
      input.value = "";
      return poll(false);
    }).catch(function (err) {
      showHint(err && err.message === "slow" ? "发送太频繁，稍后再试。" : "发送失败，请稍后再试。");
    }).then(function () {
      sending = false;
      if (submit) submit.disabled = false;
    });
  }

  function sendImage(file) {
    if (!file || sending) return;
    if (file.size > 2 * 1024 * 1024) {
      showHint("图片不能超过 2 MB。");
      return;
    }
    sending = true;
    var data = new FormData();
    data.append("image", file);
    ready().then(function () {
      return fetch(BASE + "/api/v1/contact/images", {
        method: "POST", headers: headers(), body: data
      });
    }).then(function (r) {
      if (!r.ok) throw new Error("image " + r.status);
      return poll(false);
    }).catch(function () {
      showHint("图片发送失败，请稍后再试。");
    }).then(function () {
      sending = false;
    });
  }

  openBtn.addEventListener("click", openPanel);
  panel.querySelector("[data-close]").addEventListener("click", closePanel);
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (text) sendText(text);
  });
  imageBtn.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (file) sendImage(file);
  });
  input.addEventListener("focus", function () { scheduleViewport(80); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () { scheduleViewport(120); });
    window.visualViewport.addEventListener("scroll", function () { scheduleViewport(120); });
  }
  window.addEventListener("resize", function () { scheduleViewport(120); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && panel.classList.contains("open")) closePanel();
  });
})();
