(function () {
  window.epSetActiveTool = window.epSetActiveTool || function (name) {
    window.__EP_ACTIVE_TOOL__ = name;
    document.dispatchEvent(new CustomEvent("ep-tool-changed", { detail: name }));
  };

  var COLORS = ["#ef895f", "#e0483e", "#4caf6b", "#4a90d9", "#e0c23e", "#9b6bd9"];

  var css = ""
    + "#ep-mark-panel{position:fixed;left:12px;top:12px;width:280px;max-height:70vh;z-index:30;display:none;"
    + "background:var(--p6,#2b2341);border:1px solid rgba(255,255,255,.1);border-radius:4px;box-shadow:0 12px 40px rgba(0,0,0,.5);"
    + "color:#fff;font:12px/1.4 var(--exo-font-family,Verdana,Arial,sans-serif);flex-direction:column;overflow:hidden;}"
    + "#ep-mark-panel.on{display:flex;}"
    + "#ep-mark-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--exo-purple-dark,#362b56);"
    + "border-bottom:1px solid rgba(255,255,255,.1);}"
    + "#ep-mark-head b{flex:1;font-weight:700;letter-spacing:.02em;font-size:12px;}"
    + "#ep-mark-add{height:24px;padding:0 10px;border-radius:4px;background:var(--exo-purple,#473a6d);color:#fff;"
    + "border:1px solid rgba(255,255,255,.15);cursor:pointer;font-size:11px;font-family:inherit;white-space:nowrap;}"
    + "#ep-mark-add.on{background:var(--exo-orange,#ef895f);color:#2b2341;border-color:transparent;}"
    + "#ep-mark-close{width:24px;height:24px;border-radius:4px;background:var(--exo-purple,#473a6d);color:#fff;"
    + "border:1px solid rgba(255,255,255,.15);cursor:pointer;}"
    + "#ep-mark-hint{display:none;padding:6px 10px;font-size:11px;color:var(--exo-purple-light2,#c4c7d6);"
    + "background:rgba(239,137,95,.12);border-bottom:1px solid rgba(255,255,255,.08);}"
    + "#ep-mark-panel.placing #ep-mark-hint{display:block;}"
    + "#ep-mark-list{flex:1;overflow:auto;padding:6px;}"
    + "#ep-mark-empty{color:var(--exo-purple-light,#9da1ba);font-size:12px;padding:14px 6px;text-align:center;}"
    + ".ep-mark-row{display:flex;align-items:center;gap:6px;padding:5px 4px;border-radius:3px;}"
    + ".ep-mark-row:hover{background:rgba(255,255,255,.05);}"
    + ".ep-mark-row.hl{background:rgba(239,137,95,.18);}"
    + ".ep-mark-dot{width:16px;height:16px;border-radius:50%;flex:0 0 auto;cursor:pointer;border:2px solid rgba(255,255,255,.5);}"
    + ".ep-mark-text{flex:1;min-width:0;background:transparent;border:0;border-bottom:1px solid rgba(255,255,255,.15);"
    + "color:#fff;font:12px var(--exo-font-family,Verdana,Arial,sans-serif);padding:3px 2px;}"
    + ".ep-mark-text:focus{outline:0;border-bottom-color:var(--exo-orange,#ef895f);}"
    + ".ep-mark-del{width:22px;height:22px;flex:0 0 auto;border-radius:4px;background:transparent;color:var(--exo-purple-light2,#c4c7d6);"
    + "border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;}"
    + ".ep-mark-del:hover{background:rgba(224,72,62,.25);color:#fff;}"
    + ".ep-mark-del svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.6;}"
    + ".ep-mark-palette{position:absolute;z-index:31;display:flex;gap:4px;padding:5px;background:var(--p7,#17151e);"
    + "border:1px solid rgba(255,255,255,.15);border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,.5);}"
    + ".ep-mark-swatch{width:18px;height:18px;border-radius:50%;cursor:pointer;border:2px solid transparent;padding:0;}"
    + ".ep-mark-swatch:hover{border-color:#fff;}"
    + "#ep-mark-svg{position:fixed;inset:0;z-index:16;pointer-events:none;width:100%;height:100%;}"
    + ".ep-mark-pin{cursor:pointer;pointer-events:auto;}"
    + ".ep-mark-pin circle{stroke:#fff;stroke-width:1.5;}"
    + ".ep-mark-pin text{font:700 10px var(--exo-font-family,Verdana,Arial,sans-serif);fill:#2b2341;"
    + "text-anchor:middle;dominant-baseline:central;pointer-events:none;}";
  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var toggleBtn = window.epAddDockButton({
    id: "ep-mark-toggle", label: "Метки", title: "Комментарии/метки на модели",
    svg: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-5.2-7-11a7 7 0 0114 0c0 5.8-7 11-7 11z"></path><circle cx="12" cy="10" r="2.3"></circle></svg>',
  });

  var panel = document.createElement("div");
  panel.id = "ep-mark-panel";
  panel.innerHTML = ""
    + '<div id="ep-mark-head"><b>Комментарии</b>'
    + '<button id="ep-mark-add" type="button">+ Добавить</button>'
    + '<button id="ep-mark-close" type="button">×</button></div>'
    + '<div id="ep-mark-hint">Клик по модели, чтобы поставить метку</div>'
    + '<div id="ep-mark-list"></div>';
  document.body.appendChild(panel);
  window.epKeepAlive(panel);

  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "ep-mark-svg";
  document.body.appendChild(svg);
  window.epKeepAlive(svg);

  var listEl = document.getElementById("ep-mark-list");
  var addBtn = document.getElementById("ep-mark-add");

  var markers = []; // {id, point:{x,y,z}, color, text}
  var nextId = 1;
  var placing = false;
  var highlightId = null;

  function closePalette() {
    var p = document.querySelector(".ep-mark-palette");
    if (p) p.remove();
  }

  function renderList() {
    closePalette();
    listEl.innerHTML = "";
    if (!markers.length) {
      listEl.innerHTML = '<div id="ep-mark-empty">Меток пока нет.<br>Нажмите «Добавить» и кликните по модели.</div>';
      return;
    }
    markers.forEach(function (m) {
      var row = document.createElement("div");
      row.className = "ep-mark-row" + (m.id === highlightId ? " hl" : "");
      row.dataset.id = m.id;

      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "ep-mark-dot";
      dot.style.background = m.color;
      dot.title = "Изменить цвет";
      dot.addEventListener("click", function (ev) {
        ev.stopPropagation();
        openPalette(dot, m);
      });

      var text = document.createElement("input");
      text.type = "text";
      text.className = "ep-mark-text";
      text.placeholder = "Текст комментария...";
      text.value = m.text || "";
      text.addEventListener("input", function () { m.text = text.value; });
      text.addEventListener("click", function (ev) { ev.stopPropagation(); });

      var del = document.createElement("button");
      del.type = "button";
      del.className = "ep-mark-del";
      del.title = "Удалить метку";
      del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13"></path></svg>';
      del.addEventListener("click", function (ev) {
        ev.stopPropagation();
        markers = markers.filter(function (x) { return x.id !== m.id; });
        renderList();
      });

      row.appendChild(dot);
      row.appendChild(text);
      row.appendChild(del);
      row.addEventListener("click", function () {
        highlightId = m.id;
        renderList();
        setTimeout(function () { text.focus(); }, 0);
      });
      listEl.appendChild(row);
    });
  }

  function openPalette(anchorEl, m) {
    closePalette();
    var pal = document.createElement("div");
    pal.className = "ep-mark-palette";
    var r = anchorEl.getBoundingClientRect();
    pal.style.left = r.left + "px";
    pal.style.top = (r.bottom + 4) + "px";
    COLORS.forEach(function (c) {
      var sw = document.createElement("button");
      sw.type = "button";
      sw.className = "ep-mark-swatch";
      sw.style.background = c;
      sw.addEventListener("click", function (ev) {
        ev.stopPropagation();
        m.color = c;
        renderList();
      });
      pal.appendChild(sw);
    });
    document.body.appendChild(pal);
    setTimeout(function () {
      document.addEventListener("click", function onDoc(ev) {
        if (!pal.contains(ev.target)) { pal.remove(); document.removeEventListener("click", onDoc); }
      });
    }, 0);
  }

  function setPlacing(on) {
    placing = on;
    panel.classList.toggle("placing", placing);
    addBtn.classList.toggle("on", placing);
    epSetActiveTool(placing ? "marker-add" : null);
  }

  toggleBtn.addEventListener("click", function () {
    panel.classList.toggle("on");
  });
  document.getElementById("ep-mark-close").addEventListener("click", function () {
    panel.classList.remove("on");
    setPlacing(false);
  });
  addBtn.addEventListener("click", function () { setPlacing(!placing); });
  document.addEventListener("ep-tool-changed", function (ev) {
    if (ev.detail !== "marker-add" && placing) setPlacing(false);
  });

  // ---------- 3D wiring: click-to-place + per-frame pin projection ----------
  // Reuses window.epScreenToLocal/epGetLocalRect (toolbar.js) to correctly
  // account for the mobile 90deg-rotation mode: exocad's camera/renderer
  // and any NDC math against it works in the pre-rotation LOCAL space
  // (matching GUI.getDeviceWidth/Height), while raw click coordinates and
  // getBoundingClientRect() come back in the post-rotation VISUAL space.
  // Elements drawn *inside* the rotated <body> (this SVG) don't need that
  // conversion for rendering - the browser rotates them along with
  // everything else, same as it does the canvas's own pixels - so pins are
  // drawn directly in LOCAL coordinates.
  function projectToLocalPixel(camera, localRect, point) {
    var p = new THREE.Vector3(point.x, point.y, point.z).project(camera);
    return {
      x: localRect.left + (p.x * 0.5 + 0.5) * localRect.width,
      y: localRect.top + (-p.y * 0.5 + 0.5) * localRect.height,
    };
  }

  function redrawPins() {
    var d = window.DentalWebGL;
    if (!d || !d.m_SceneManager || !markers.length) { svg.innerHTML = ""; return; }
    var camera, overlay;
    try {
      camera = d.m_SceneManager.getCamera();
      overlay = d.m_SceneManager.getOverlayCanvas().getCanvas();
    } catch (e) { return; }
    var localRect = window.epGetLocalRect(overlay);
    svg.innerHTML = "";
    markers.forEach(function (m, idx) {
      var pos = projectToLocalPixel(camera, localRect, m.point);
      var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "ep-mark-pin");
      var c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", pos.x); c.setAttribute("cy", pos.y); c.setAttribute("r", m.id === highlightId ? 11 : 9);
      c.setAttribute("fill", m.color);
      var t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", pos.x); t.setAttribute("y", pos.y);
      t.textContent = String(idx + 1);
      g.appendChild(c); g.appendChild(t);
      g.addEventListener("click", function () {
        panel.classList.add("on");
        highlightId = m.id;
        renderList();
        var row = listEl.querySelector('[data-id="' + m.id + '"]');
        if (row) row.scrollIntoView({ block: "nearest" });
      });
      svg.appendChild(g);
    });
  }

  function loop() {
    redrawPins();
    requestAnimationFrame(loop);
  }

  function trySetupPicking() {
    var d = window.DentalWebGL;
    if (!d || !d.m_SceneManager || !d.m_SceneManager.getOverlayCanvas) { setTimeout(trySetupPicking, 300); return; }
    var overlay;
    try { overlay = d.m_SceneManager.getOverlayCanvas().getCanvas(); } catch (e) { setTimeout(trySetupPicking, 300); return; }
    var raycaster = new THREE.Raycaster();
    overlay.addEventListener("click", function (ev) {
      if (!placing) return;
      try {
        var rect = window.epGetLocalRect(overlay);
        var local = window.epScreenToLocal(ev.clientX, ev.clientY);
        var mouse = new THREE.Vector2(
          ((local.x - rect.left) / rect.width) * 2 - 1,
          -((local.y - rect.top) / rect.height) * 2 + 1
        );
        var cam = d.m_SceneManager.getCamera();
        var scene = d.m_SceneManager.getScene();
        raycaster.setFromCamera(mouse, cam);
        var hits = raycaster.intersectObjects(scene.children, true);
        if (!hits.length) return;
        var pt = hits[0].point;
        var m = {
          id: nextId++,
          point: { x: pt.x, y: pt.y, z: pt.z },
          color: COLORS[markers.length % COLORS.length],
          text: "",
        };
        markers.push(m);
        highlightId = m.id;
        panel.classList.add("on");
        renderList();
        var row = listEl.querySelector('[data-id="' + m.id + '"]');
        if (row) {
          var input = row.querySelector(".ep-mark-text");
          if (input) input.focus();
        }
      } catch (e) { console.error("EP marker pick failed", e); }
    });
    requestAnimationFrame(loop);
  }
  trySetupPicking();

  renderList();
  window.__EP_MARKERS__ = { getAll: function () { return markers.slice(); } };
})();
