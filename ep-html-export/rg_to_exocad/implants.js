(function () {
  var css = ""
    + "#ep-imp-bar{position:absolute;left:8px;right:66px;bottom:8px;z-index:20;"
    + "display:flex;gap:1px;flex-wrap:wrap;justify-content:flex-start;"
    + "background:var(--p7,#17151e);border:1px solid rgba(255,255,255,.08);border-radius:4px;overflow:hidden;width:max-content;}"
    + "#ep-imp-bar button{min-width:34px;height:34px;padding:0 8px;border-radius:0;cursor:pointer;"
    + "background:transparent;color:var(--exo-purple-light2,#c4c7d6);border:0;"
    + "font:700 12px var(--exo-font-family,Verdana,Arial,sans-serif);}"
    + "#ep-imp-bar button:hover{background:var(--exo-purple,#473a6d);color:#fff;}"
    + "#ep-imp-bar button.on{background:var(--exo-orange,#ef895f);color:#2b2341;}"
    + "#ep-imp-modal{position:fixed;inset:0;z-index:40;display:none;align-items:center;justify-content:center;padding:18px;"
    + "font-family:var(--exo-font-family,Verdana,Arial,sans-serif);}"
    + "#ep-imp-modal.on{display:flex;}"
    + "#ep-imp-dim{position:absolute;inset:0;background:rgba(10,8,16,.6);backdrop-filter:blur(4px);}"
    + "#ep-imp-card{position:relative;z-index:1;width:min(420px,100%);max-height:88vh;overflow:auto;"
    + "background:var(--p6,#2b2341);border:1px solid rgba(255,255,255,.1);border-radius:4px;box-shadow:0 20px 60px rgba(0,0,0,.5);}"
    + "#ep-imp-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--exo-purple-dark,#362b56);color:#fff;"
    + "border-bottom:1px solid rgba(255,255,255,.1);}"
    + "#ep-imp-head b{flex:1;font-size:14px;letter-spacing:.02em;}"
    + "#ep-imp-head button{width:24px;height:24px;border-radius:4px;background:var(--exo-purple,#473a6d);"
    + "color:#fff;border:1px solid rgba(255,255,255,.15);cursor:pointer;}"
    + "#ep-imp-tabs{display:flex;gap:1px;padding:0;background:rgba(255,255,255,.08);}"
    + "#ep-imp-tabs button{flex:1;height:30px;padding:0 10px;border-radius:0;cursor:pointer;font-size:11px;font-weight:700;"
    + "background:var(--p6,#2b2341);color:var(--exo-purple-light2,#c4c7d6);border:0;"
    + "font-family:var(--exo-font-family,Verdana,Arial,sans-serif);}"
    + "#ep-imp-tabs button.on{background:var(--exo-orange,#ef895f);color:#2b2341;}"
    + "#ep-imp-body{padding:10px 14px 16px;}"
    + "#ep-imp-body .row{display:flex;gap:10px;padding:6px 0;font-size:13px;border-top:1px solid rgba(255,255,255,.08);}"
    + "#ep-imp-body .row:first-child{border-top:0;}"
    + "#ep-imp-body .lab{flex:0 0 110px;color:var(--exo-purple-light2,#c4c7d6);font-weight:700;}"
    + "#ep-imp-body .val{flex:1;color:#fff;}"
    + "#ep-imp-body .empty{color:var(--exo-purple-light,#9da1ba);font-size:13px;padding:12px 0;}";
  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var bar = document.createElement("div");
  bar.id = "ep-imp-bar";
  document.body.appendChild(bar);
  window.epKeepAlive(bar);

  var infoBtn = window.epAddDockButton({
    id: "ep-imp-info-btn", label: "Инфо", title: "Информация об имплантах",
    svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8v.01"></path></svg>',
    afterSeparator: true,
  });

  var modal = document.createElement("div");
  modal.id = "ep-imp-modal";
  modal.innerHTML = ""
    + '<div id="ep-imp-dim"></div>'
    + '<div id="ep-imp-card">'
    + '<div id="ep-imp-head"><b id="ep-imp-title">Имплант</b><button id="ep-imp-close" type="button">×</button></div>'
    + '<div id="ep-imp-tabs">'
    + '<button type="button" data-tab="implant" class="on">Имплант</button>'
    + '<button type="button" data-tab="abutment">Абатмент</button>'
    + '<button type="button" data-tab="sleeve">Гильза</button>'
    + "</div>"
    + '<div id="ep-imp-body"></div>'
    + "</div>";
  document.body.appendChild(modal);
  window.epKeepAlive(modal);

  var sites = [];
  var currentSite = null;
  var currentTab = "implant";

  function row(lab, val) {
    if (val === null || val === undefined || val === "") return "";
    return '<div class="row"><div class="lab">' + lab + '</div><div class="val">' + val + "</div></div>";
  }

  function renderBody() {
    var body = document.getElementById("ep-imp-body");
    if (!currentSite) { body.innerHTML = '<div class="empty">Нет данных</div>'; return; }
    var info = currentSite.info || {};
    var html = "";
    if (currentTab === "implant") {
      html += row("Зуб", currentSite.tooth || currentSite.id);
      html += row("Производитель", info.manufacturer);
      html += row("Модель", info.model || info.originalName);
      html += row("Артикул", info.article);
      html += row("Диаметр", info.diameter != null ? info.diameter + " мм" : null);
      html += row("Длина", info.length != null ? info.length + " мм" : null);
    } else if (currentTab === "abutment") {
      var a = info.abutment || {};
      html += row("Производитель", a.manufacturer);
      html += row("Модель", a.model);
      html += row("Размер", a.size);
      html += row("Артикул", a.article);
    } else if (currentTab === "sleeve") {
      var s = info.sleeve || {};
      html += row("Производитель", s.manufacturer);
      html += row("Модель", s.model);
      html += row("Артикул", s.article);
      html += row("Отступ от платформы", s.distance != null ? s.distance + " мм" : null);
      html += row("Диаметр", s.diameter != null ? s.diameter + " мм" : null);
      html += row("Высота", s.height != null ? s.height + " мм" : null);
    }
    body.innerHTML = html || '<div class="empty">Нет данных по этой вкладке</div>';
  }

  function selectSite(site) {
    currentSite = site;
    document.getElementById("ep-imp-title").textContent =
      (site.kind === "pin" ? "Пин " : "Имплант ") + (site.tooth || site.id);
    document.querySelectorAll("#ep-imp-bar button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.siteId === site.id);
    });
    renderBody();
    if (window.__EP_CT__ && typeof window.__EP_CT__.focusSite === "function") {
      window.__EP_CT__.focusSite(site);
    }
  }

  function buildBar() {
    bar.innerHTML = "";
    sites.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.dataset.siteId = s.id;
      b.textContent = s.tooth || (s.kind === "pin" ? "Pin" : "?");
      b.title = (s.kind === "pin" ? "Пин " : "Имплант ") + (s.tooth || s.id);
      b.addEventListener("click", function () { selectSite(s); });
      bar.appendChild(b);
    });
  }

  document.querySelectorAll("#ep-imp-tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      currentTab = b.dataset.tab;
      document.querySelectorAll("#ep-imp-tabs button").forEach(function (x) { x.classList.toggle("on", x === b); });
      renderBody();
    });
  });

  infoBtn.addEventListener("click", function () {
    if (!currentSite && sites.length) currentSite = sites[0];
    if (currentSite) selectSite(currentSite);
    modal.classList.add("on");
  });
  document.getElementById("ep-imp-close").addEventListener("click", function () { modal.classList.remove("on"); });
  document.getElementById("ep-imp-dim").addEventListener("click", function () { modal.classList.remove("on"); });

  function boot() {
    var el = document.getElementById("ep-sites-json");
    if (!el) return;
    try {
      sites = JSON.parse(el.textContent).filter(function (s) { return s.kind === "implant" || s.kind === "pin"; });
    } catch (e) {
      console.error("EP implants: bad sites JSON", e);
      return;
    }
    buildBar();
  }

  window.__EP_IMPLANTS__ = { getSites: function () { return sites; }, selectSite: selectSite };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
