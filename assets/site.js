(function () {
  "use strict";

  var root = document.documentElement;
  var toggle = document.getElementById("themeToggle");
  function theme() {
    if (toggle) toggle.textContent = root.getAttribute("data-theme") === "dark" ? "☀️" : "🌙";
  }
  if (toggle) {
    toggle.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("xlp-theme", next); } catch (e) {}
      theme();
    });
  }
  theme();

  var menu = document.getElementById("menuToggle");
  var side = document.getElementById("docsSide");
  var overlay = document.getElementById("menuOverlay");
  function closeMenu() {
    if (side) side.classList.remove("open");
    if (overlay) overlay.classList.remove("open");
    if (menu) menu.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-open");
  }
  if (menu && side) {
    menu.addEventListener("click", function () {
      var open = side.classList.toggle("open");
      if (overlay) overlay.classList.toggle("open", open);
      menu.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.classList.toggle("menu-open", open);
    });
  }
  if (overlay) overlay.addEventListener("click", closeMenu);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMenu();
  });
  document.querySelectorAll(".docs-side a").forEach(function (a) {
    a.addEventListener("click", closeMenu);
  });

  // 公告关闭（当前会话记住）
  var announce = document.getElementById("announcement");
  var announceClose = document.getElementById("announcementClose");
  try { if (localStorage.getItem("xlp-announce-closed") === "1" && announce) announce.hidden = true; } catch (e) {}
  if (announceClose && announce) {
    announceClose.addEventListener("click", function () {
      announce.hidden = true;
      try { localStorage.setItem("xlp-announce-closed", "1"); } catch (e) {}
    });
  }

  // 咨询弹窗
  var consult = document.getElementById("consultDialog");
  var consultOpen = document.getElementById("consultOpen");
  if (consult && consultOpen) {
    function closeConsult() {
      document.body.classList.remove("consult-open");
      if (consult.open) consult.close();
    }
    consultOpen.addEventListener("click", function () {
      document.body.classList.add("consult-open");
      if (typeof consult.showModal === "function") consult.showModal();
      else consult.hidden = false;
    });
    var consultClose = consult.querySelector("[data-consult-close]");
    if (consultClose) consultClose.addEventListener("click", closeConsult);
    consult.addEventListener("click", function (e) {
      if (e.target === consult) closeConsult();
    });
    consult.addEventListener("close", function () {
      document.body.classList.remove("consult-open");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && consult.open) closeConsult();
    });
  }

  // FAQ 导航：点问题目录后，右侧对应 details 自动展开
  document.querySelectorAll('a[href^="#faq-"]').forEach(function (a) {
    a.addEventListener("click", function () {
      var id = a.getAttribute("href").slice(1);
      var target = document.getElementById(id);
      if (target && target.tagName === "DETAILS") target.open = true;
    });
  });
})();
