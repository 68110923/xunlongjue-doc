(function () {
  "use strict";

  var root = document.documentElement;

  /* ── 主题 ─────────────────────────────────────────────────────────── */
  var themeToggle = document.getElementById("themeToggle");

  function paintTheme() {
    if (!themeToggle) return;
    var dark = root.getAttribute("data-theme") === "dark";
    themeToggle.textContent = dark ? "☀️" : "🌙";
    themeToggle.setAttribute("aria-label", dark ? "切换到明色主题" : "切换到暗色主题");
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("xlp-theme", next); } catch (e) {}
      paintTheme();
    });
  }
  paintTheme();

  /* ── 手机抽屉 ─────────────────────────────────────────────────────── */
  var menuToggle = document.getElementById("menuToggle");
  var drawer = document.getElementById("navDrawer");
  var overlay = document.getElementById("navOverlay");
  var lastFocus = null;

  function focusables() {
    if (!drawer) return [];
    return Array.prototype.slice
      .call(
        drawer.querySelectorAll(
          'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'
        )
      )
      .filter(function (el) { return el.getClientRects().length > 0; });
  }

  function openDrawer() {
    if (!drawer || !menuToggle) return;
    lastFocus = document.activeElement;
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    if (overlay) overlay.classList.add("open");
    menuToggle.setAttribute("aria-expanded", "true");
    document.body.classList.add("nav-open");
    var first = focusables()[0];
    if (first) first.focus();
  }

  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    if (overlay) overlay.classList.remove("open");
    if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("nav-open");
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  if (menuToggle && drawer) {
    menuToggle.addEventListener("click", function () {
      if (drawer.classList.contains("open")) closeDrawer();
      else openDrawer();
    });
  }
  if (overlay) overlay.addEventListener("click", closeDrawer);
  if (drawer) {
    drawer.querySelectorAll("[data-drawer-close]").forEach(function (button) {
      button.addEventListener("click", closeDrawer);
    });
    drawer.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        if (window.matchMedia("(max-width: 840px)").matches) closeDrawer();
      });
    });
    drawer.addEventListener("keydown", function (event) {
      if (event.key !== "Tab") return;
      var items = focusables();
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }
  window.addEventListener("resize", function () {
    if (window.matchMedia("(min-width: 841px)").matches && drawer && drawer.classList.contains("open")) {
      closeDrawer();
    }
  });

  /* ── 公告 ─────────────────────────────────────────────────────────── */
  var announcement = document.getElementById("announcement");
  var announcementClose = document.getElementById("announcementClose");
  try {
    if (localStorage.getItem("xlp-announce-closed") === "1" && announcement) {
      announcement.hidden = true;
    }
  } catch (e) {}
  if (announcementClose && announcement) {
    announcementClose.addEventListener("click", function () {
      announcement.hidden = true;
      try { localStorage.setItem("xlp-announce-closed", "1"); } catch (e) {}
    });
  }

  var notice = document.getElementById("noticeDialog");
  var noticeOpen = document.getElementById("announcementOpen");

  function closeNotice() {
    if (!notice) return;
    if (notice.open && typeof notice.close === "function") notice.close();
    else notice.hidden = true;
  }

  if (notice && noticeOpen) {
    noticeOpen.addEventListener("click", function () {
      if (typeof notice.showModal === "function") notice.showModal();
      else notice.hidden = false;
    });
    var noticeClose = notice.querySelector("[data-notice-close]");
    if (noticeClose) noticeClose.addEventListener("click", closeNotice);
    notice.addEventListener("click", function (event) {
      if (event.target === notice) closeNotice();
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (drawer && drawer.classList.contains("open")) closeDrawer();
    if (notice && notice.open) closeNotice();
  });

  /* ── 页脚出现时收起咨询按钮 ─────────────────────────────────────── */
  var siteFooter = document.querySelector(".site-footer");
  if (siteFooter && "IntersectionObserver" in window) {
    var footerObserver = new IntersectionObserver(
      function (entries) {
        document.body.classList.toggle("footer-visible", entries[0].isIntersecting);
      },
      { threshold: 0.02 }
    );
    footerObserver.observe(siteFooter);
  }

  /* ── 收款码放大 ───────────────────────────────────────────────────── */
  var qrDialog = document.getElementById("qrDialog");
  var qrDialogImg = document.getElementById("qrDialogImg");
  var qrDialogTitle = document.getElementById("qrDialogTitle");
  var qrDialogCaption = document.getElementById("qrDialogCaption");

  function closeQrDialog() {
    if (!qrDialog) return;
    if (qrDialog.open && typeof qrDialog.close === "function") qrDialog.close();
    else qrDialog.hidden = true;
  }

  if (qrDialog && qrDialogImg) {
    document.querySelectorAll(".qr-button").forEach(function (button) {
      button.addEventListener("click", function () {
        qrDialogImg.src = button.getAttribute("data-qr-src") || "";
        qrDialogImg.alt = button.getAttribute("data-qr-alt") || "";
        if (qrDialogTitle) {
          qrDialogTitle.textContent = button.getAttribute("data-qr-title") || "二维码";
        }
        if (qrDialogCaption) {
          qrDialogCaption.textContent = button.getAttribute("data-qr-caption") || "";
        }
        if (typeof qrDialog.showModal === "function") qrDialog.showModal();
        else qrDialog.hidden = false;
      });
    });
    var qrClose = qrDialog.querySelector("[data-qr-close]");
    if (qrClose) qrClose.addEventListener("click", closeQrDialog);
    qrDialog.addEventListener("click", function (event) {
      if (event.target === qrDialog) closeQrDialog();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && qrDialog.open) closeQrDialog();
    });
  }

  /* ── FAQ 锚点自动展开 ─────────────────────────────────────────────── */
  function openFaqFromHash() {
    var id = location.hash.slice(1);
    if (!id) return;
    var target = document.getElementById(id);
    if (target && target.tagName === "DETAILS") target.open = true;
  }
  document.querySelectorAll('a[href^="#faq-"]').forEach(function (link) {
    link.addEventListener("click", function () {
      var target = document.getElementById(link.getAttribute("href").slice(1));
      if (target && target.tagName === "DETAILS") target.open = true;
    });
  });
  openFaqFromHash();
  window.addEventListener("hashchange", openFaqFromHash);

  /* ── 本页目录滚动高亮 ─────────────────────────────────────────────── */
  var tocLinks = Array.prototype.slice.call(
    document.querySelectorAll('.docs-toc a[href^="#"], .docs-toc-inline a[href^="#"]')
  );
  if (tocLinks.length && "IntersectionObserver" in window) {
    var byId = {};
    tocLinks.forEach(function (link) {
      byId[link.getAttribute("href").slice(1)] = link;
    });
    var headings = Object.keys(byId)
      .map(function (id) { return document.getElementById(id); })
      .filter(Boolean);
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          tocLinks.forEach(function (link) { link.classList.remove("active"); });
          var link = byId[entry.target.id];
          if (link) link.classList.add("active");
        });
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );
    headings.forEach(function (heading) { observer.observe(heading); });
  }

  /* ── 代码复制 ─────────────────────────────────────────────────────── */
  document.querySelectorAll(".prose pre").forEach(function (pre) {
    var wrap = document.createElement("div");
    wrap.className = "code-wrap";
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy-btn";
    button.textContent = "复制";
    button.addEventListener("click", function () {
      var text = pre.textContent || "";
      function done() {
        button.textContent = "已复制";
        window.setTimeout(function () { button.textContent = "复制"; }, 1600);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {});
      } else {
        var area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        try { document.execCommand("copy"); done(); } catch (e) {}
        document.body.removeChild(area);
      }
    });
    wrap.appendChild(button);
  });
})();
