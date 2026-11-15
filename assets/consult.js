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

  var insetRaf = 0;
  var insetTimers = [];
  var lastInset = 0;
  var keyboardWasOpen = false;

  function isIOS() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }

  function keyboardIsOpen() {
    return Boolean(
      window.visualViewport && window.visualViewport.height < window.innerHeight - 120
    );
  }

  /* 手机键盘：面板本身固定不动，只把输入区按键盘高度顶起来。
     页眉永远不参与位移，快速开合也不会累积 top / height 误差。 */
  function updateKeyboardInset() {
    if (!panel.classList.contains("open") || !isMobile()) return;
    var vv = window.visualViewport;
    if (!vv) return;
    var inset = window.innerHeight - vv.height - (vv.offsetTop || 0);
    inset = Math.round(Math.min(Math.max(0, inset), window.innerHeight));
    if (inset < 40) inset = 0; // 地址栏 / 工具栏的小变化不算键盘
    if (inset === lastInset) return;
    lastInset = inset;
    /* 先记录改高度之前是否在底部；改完 composer 高度后 body 变矮，
       再判断 nearBottom() 会误判为“不在底部”，导致最新消息被顶出视野。 */
    var stick = nearBottom();
    panel.style.setProperty("--keyboard-inset", inset + "px");
    if (stick) scrollToBottom(false);
  }

  function scheduleKeyboardInset() {
    if (!isMobile() || !panel.classList.contains("open")) return;
    if (insetRaf) cancelAnimationFrame(insetRaf);
    insetRaf = requestAnimationFrame(function () {
      insetRaf = 0;
      updateKeyboardInset();
    });
    /* iOS 26 偶尔 offsetTop / height 不刷新：落定后补测两次 */
    insetTimers.forEach(function (timer) {
      clearTimeout(timer);
    });
    insetTimers = [320, 900].map(function (delay) {
      return setTimeout(function () {
        updateKeyboardInset();
        if (window.scrollY !== 0) window.scrollTo(0, 0);
      }, delay);
    });
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
    scheduleKeyboardInset();
  }

  function unlockPage() {
    if (insetRaf) {
      cancelAnimationFrame(insetRaf);
      insetRaf = 0;
    }
    insetTimers.forEach(function (timer) { clearTimeout(timer); });
    insetTimers = [];
    lastInset = 0;
    keyboardWasOpen = false;
    panel.style.removeProperty("--keyboard-inset");
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
    var nodes = body.querySelectorAll(".xlp-consult-hint, .xlp-consult-empty");
    for (var i = 0; i < nodes.length; i += 1) nodes[i].remove();
  }

  function showHint(text) {
    clearHint();
    var p = document.createElement("p");
    p.className = "xlp-consult-hint";
    p.textContent = text;
    body.appendChild(p);
  }

  function nearBottom() {
    return body.scrollHeight - body.scrollTop - body.clientHeight < 96;
  }

  function scrollToBottom(smooth) {
    if (smooth && body.scrollTo) {
      body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
    } else {
      body.scrollTop = body.scrollHeight;
    }
  }

  var lastDay = "";

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  /* 新接口带 ISO 时间戳（含时区），按浏览器本地时区显示；
     老接口只有 at_text / day（站点时区），原样兜底。 */
  function messageDate(message) {
    if (!message.at) return null;
    var date = new Date(message.at);
    return isNaN(date.getTime()) ? null : date;
  }

  function messageDay(message) {
    var date = messageDate(message);
    if (date) {
      return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
    }
    return message.day || "";
  }

  function timeLabel(message) {
    var date = messageDate(message);
    if (date) return pad(date.getHours()) + ":" + pad(date.getMinutes());
    return message.at_text || "";
  }

  function dayLabel(iso) {
    if (!iso) return "";
    var parts = iso.split("-");
    if (parts.length !== 3) return iso;
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((today - date) / 86400000);
    if (diff === 0) return "今天";
    if (diff === 1) return "昨天";
    return (date.getMonth() + 1) + "月" + date.getDate() + "日";
  }

  function makeRow(message) {
    var row = document.createElement("div");
    row.className = "xlp-msg-row" + (message.mine ? " mine" : "");

    var avatar = document.createElement("span");
    avatar.className = "xlp-msg-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = message.mine ? "我" : "龙";

    var main = document.createElement("div");
    main.className = "xlp-msg-main";

    var meta = document.createElement("div");
    meta.className = "xlp-msg-meta";
    var who = document.createElement("span");
    who.textContent = message.mine ? "我" : "作者";
    var time = document.createElement("time");
    time.textContent = timeLabel(message);
    meta.appendChild(who);
    meta.appendChild(time);
    main.appendChild(meta);

    var bubble = document.createElement("div");
    bubble.className = "xlp-msg";
    if (message.kind === "image" && message.image_url) {
      bubble.className += " is-image";
      var link = document.createElement("a");
      link.className = "xlp-msg-image";
      link.href = asset(message.image_url);
      link.target = "_blank";
      link.rel = "noopener";
      var img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "咨询图片";
      img.src = asset(message.thumb_url || message.image_url);
      link.appendChild(img);
      bubble.appendChild(link);
    } else {
      var span = document.createElement("span");
      span.textContent = message.body || "";
      bubble.appendChild(span);
    }
    main.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(main);
    return row;
  }

  function render(messages) {
    if (!messages || !messages.length) return;
    var firstLoad = lastId === 0;
    var stick = nearBottom() || firstLoad;
    clearHint();
    var hasMine = false;
    messages.forEach(function (message) {
      if (!message || !message.id || message.id <= lastId) return;
      if (message.mine) hasMine = true;
      var day = messageDay(message);
      if (day && day !== lastDay) {
        var sep = document.createElement("div");
        sep.className = "xlp-day";
        sep.textContent = dayLabel(day);
        body.appendChild(sep);
        lastDay = day;
      }
      body.appendChild(makeRow(message));
      lastId = message.id;
    });
    if (stick || hasMine) scrollToBottom(!firstLoad);
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
    if (open) {
      panel.style.transition = "";
      lockPage();
    } else {
      panel.style.transition = "";
      panel.style.transform = "";
      unlockPage();
      if (timer) { clearInterval(timer); timer = null; }
    }
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
    requestAnimationFrame(function () { scrollToBottom(false); });
    if (!isMobile()) {
      setTimeout(function () { input.focus(); }, 140);
    }
  }

  function closePanel() {
    // 先收键盘，再解锁页面；顺序反了会让 iOS 在解锁后自己滚一下。
    if (input) input.blur();
    setOpen(false);
    if (!isMobile()) {
      try {
        openBtn.focus({ preventScroll: true });
      } catch (e) {
        openBtn.focus();
      }
    }
  }

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 112) + "px";
  }

  function resetInput() {
    input.value = "";
    input.style.height = "";
  }

  function setSending(state) {
    sending = state;
    form.classList.toggle("is-sending", state);
    var submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = state;
    if (imageBtn) imageBtn.disabled = state;
  }

  function sendText(text) {
    if (sending) return;
    setSending(true);
    resetInput();
    var sent = false;
    ready().then(function () {
      return fetch(BASE + "/api/v1/contact/messages", {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ text: text, clientId: uuid() })
      });
    }).then(function (r) {
      if (r.status === 429) throw new Error("slow");
      if (!r.ok) throw new Error("send " + r.status);
      sent = true;
      return poll(false).catch(function () {});
    }).catch(function (err) {
      if (!sent) {
        if (!input.value.trim()) {
          input.value = text;
          autoGrow();
        }
        showHint(err && err.message === "slow" ? "发送太频繁，稍后再试。" : "发送失败，请稍后再试。");
      }
    }).then(function () {
      setSending(false);
    });
  }

  function sendImage(file) {
    if (!file || sending) return;
    if (file.size > 2 * 1024 * 1024) {
      showHint("图片不能超过 2 MB。");
      return;
    }
    setSending(true);
    var data = new FormData();
    data.append("image", file);
    ready().then(function () {
      return fetch(BASE + "/api/v1/contact/images", {
        method: "POST", headers: headers(), body: data
      });
    }).then(function (r) {
      if (!r.ok) throw new Error("image " + r.status);
      return poll(false).catch(function () {});
    }).catch(function () {
      showHint("图片发送失败，请稍后再试。");
    }).then(function () {
      setSending(false);
    });
  }

  openBtn.addEventListener("click", openPanel);
  panel.querySelector("[data-close]").addEventListener("click", closePanel);
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (text) sendText(text);
  });
  var sendBtn = form.querySelector('button[type="submit"]');
  if (sendBtn) {
    /* 桌面：mousedown 默认会把焦点移到按钮，输入框失焦 */
    sendBtn.addEventListener("mousedown", function (event) {
      event.preventDefault();
    });
    /* 手机：touchstart 默认同样会让输入框失焦、键盘收起。
       阻止默认后手动提交，焦点和键盘都留在输入框里。 */
    sendBtn.addEventListener("touchstart", function (event) {
      if (!isMobile()) return;
      event.preventDefault();
    }, { passive: false });
    sendBtn.addEventListener("touchend", function (event) {
      if (!isMobile()) return;
      event.preventDefault();
      if (form.requestSubmit) {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    }, { passive: false });
  }
  imageBtn.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (file) sendImage(file);
  });
  input.addEventListener("input", autoGrow);
  input.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!input.value.trim()) return;
    if (form.requestSubmit) {
      form.requestSubmit();
    } else {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
  });
  input.addEventListener("focus", function () { scheduleKeyboardInset(); });
  /* iOS 默认会滚动 / 平移整页去露出输入框；手动 preventScroll 聚焦，
     再靠 --keyboard-inset 把输入区顶起来，页眉就不会被带着跑。 */
  input.addEventListener("touchend", function (event) {
    if (!isIOS() || document.activeElement === input) return;
    event.preventDefault();
    try {
      input.focus({ preventScroll: true });
    } catch (e) {
      input.focus();
    }
    scheduleKeyboardInset();
  }, { passive: false });

  /* 图片加载后会撑高，若本来就在底部则跟着贴底 */
  body.addEventListener("load", function (event) {
    if (event.target && event.target.tagName === "IMG" && nearBottom()) {
      scrollToBottom(false);
    }
  }, true);

  /* 电脑端点击面板外关闭；手机端是全屏，不适用 */
  document.addEventListener("click", function (event) {
    if (!panel.classList.contains("open") || isMobile()) return;
    if (panel.contains(event.target) || openBtn.contains(event.target)) return;
    closePanel();
  });

  /* 手机端在页眉下滑关闭；跟手位移，松手超过阈值才关 */
  var head = panel.querySelector(".xlp-consult-head");
  if (head) {
    var dragStart = null;
    var dragY = 0;
    head.addEventListener("touchstart", function (event) {
      if (!isMobile() || event.touches.length !== 1) return;
      dragStart = event.touches[0].clientY;
      dragY = 0;
      panel.style.transition = "none";
    }, { passive: true });
    head.addEventListener("touchmove", function (event) {
      if (dragStart === null || event.touches.length !== 1) return;
      dragY = Math.max(0, event.touches[0].clientY - dragStart);
      if (dragY > 0) panel.style.transform = "translateY(" + dragY + "px)";
    }, { passive: true });
    var endDrag = function () {
      if (dragStart === null) return;
      dragStart = null;
      panel.style.transition = "";
      panel.style.transform = "";
      if (dragY > 96) closePanel();
      dragY = 0;
    };
    head.addEventListener("touchend", endDrag, { passive: true });
    head.addEventListener("touchcancel", endDrag, { passive: true });
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () {
      if (isIOS() && panel.classList.contains("open") && isMobile()) {
        var open = keyboardIsOpen();
        if (keyboardWasOpen && !open && document.activeElement === input) {
          /* 键盘收起了但焦点还在输入框，下一次点击会命中"已聚焦"分支，
             iOS 就自己去滚页面 —— 主动 blur 掉。 */
          input.blur();
        }
        keyboardWasOpen = open;
      }
      scheduleKeyboardInset();
    });
    window.visualViewport.addEventListener("scroll", function () {
      /* ⚠️ 只有聊天面板打开时才归零：否则页面正常下滑也会被强行拉回顶部 */
      if (!panel.classList.contains("open") || !isMobile()) return;
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      scheduleKeyboardInset();
    });
  }
  window.addEventListener("resize", scheduleKeyboardInset);
  window.addEventListener("focus", scheduleKeyboardInset);
  window.addEventListener("blur", function () { setTimeout(scheduleKeyboardInset, 50); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && panel.classList.contains("open")) closePanel();
  });
})();
