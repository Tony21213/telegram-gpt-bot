(function () {
  // Self-healing DOM watchdog: the dedicated "exocad webview" native app
  // wraps the same engine in its own mobile/Cordova UI shell, which may
  // rebuild parts of document.body after our scripts have already run
  // (e.g. hamburger-menu mode) - silently detaching our panels. Every
  // module registers its own root element(s) here once, right after first
  // appending them to <body>; a single shared MutationObserver plus a
  // low-frequency interval fallback (for the rarer case of document.body
  // being replaced wholesale, which would leave the old observer watching
  // a dead node) re-appends anything found missing.
  window.epKeepAlive = window.epKeepAlive || (function () {
    var registered = [];
    var watching = false;

    function reattachAll() {
      for (var i = 0; i < registered.length; i++) {
        var el = registered[i];
        if (el && !document.body.contains(el)) {
          document.body.appendChild(el);
        }
      }
    }

    function ensureWatching() {
      if (watching) return;
      watching = true;
      try {
        new MutationObserver(reattachAll).observe(document.body, { childList: true });
      } catch (e) { /* ignore */ }
      setInterval(reattachAll, 1000);
    }

    return function (el) {
      if (!el || registered.indexOf(el) !== -1) return;
      registered.push(el);
      ensureWatching();
    };
  })();

  // Coordinate helper for the mobile 90deg-rotation mode (mobile_rotate.py):
  // that mode rotates <body> as a whole via CSS transform, so any
  // document-space read like getBoundingClientRect() or a pointer event's
  // clientX/clientY comes back in the POST-rotation VISUAL space (e.g. a
  // portrait 390x844 box), while exocad's own camera/renderer - and any
  // NDC (project()/raycaster) math done against it - works in the
  // PRE-rotation LOCAL space (the landscape 844x390 box matching
  // GUI.getDeviceWidth()/getDeviceHeight()). Elements drawn *inside* the
  // rotated body (our SVG overlays) don't need this - the browser applies
  // the same rotation to them automatically, exactly like it does to the
  // canvas's own rendered pixels - but converting a raw click position, or
  // the canvas's own visual rect, into LOCAL coordinates for NDC math does.
  // Reads the live computed transform (matrix(a,b,c,d,e,f)) instead of
  // assuming a fixed 90deg angle, so it's a no-op (identity) whenever no
  // rotation is active (desktop, or mobile landscape orientation).
  window.epScreenToLocal = window.epScreenToLocal || function (sx, sy) {
    var t = getComputedStyle(document.body).transform;
    if (!t || t === "none") return { x: sx, y: sy };
    var m = t.match(/matrix\(([^)]+)\)/);
    if (!m) return { x: sx, y: sy };
    var v = m[1].split(",").map(Number);
    var a = v[0], b = v[1], c = v[2], d = v[3], e = v[4], f = v[5];
    var det = a * d - b * c;
    if (!det) return { x: sx, y: sy };
    var dx = sx - e, dy = sy - f;
    return { x: (d * dx - c * dy) / det, y: (-b * dx + a * dy) / det };
  };

  // An element's own bounding rect, expressed in that same LOCAL space
  // (see epScreenToLocal above) instead of the visual space
  // getBoundingClientRect() normally returns.
  window.epGetLocalRect = window.epGetLocalRect || function (el) {
    var r = el.getBoundingClientRect();
    var c1 = window.epScreenToLocal(r.left, r.top);
    var c2 = window.epScreenToLocal(r.right, r.bottom);
    return {
      left: Math.min(c1.x, c2.x), top: Math.min(c1.y, c2.y),
      width: Math.abs(c2.x - c1.x), height: Math.abs(c2.y - c1.y),
    };
  };

  // Shared right-side vertical icon dock (idempotent lazy singleton), so
  // ct_panel.js/ruler.js/implants.js each contribute their own buttons
  // instead of scattering separate flat buttons around the screen.
  // Layout modeled after the real ExoPlan desktop app's right-side tool
  // dock (Save/Tools/Implant Control/Show-Hide Groups/DICOM Control...).
  window.epGetToolDock = window.epGetToolDock || function () {
    var dock = document.getElementById("ep-tool-dock");
    if (dock) return dock;

    var css = ""
      + "#ep-tool-dock{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:20;"
      + "display:flex;flex-direction:column;gap:1px;align-items:stretch;"
      + "background:var(--p7,#17151e);border:1px solid rgba(255,255,255,.08);border-radius:4px 0 0 4px;"
      + "overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.4);}"
      + "#ep-tool-dock button{width:56px;height:50px;border-radius:0;cursor:pointer;"
      + "background:transparent;color:var(--exo-purple-light2,#c4c7d6);border:0;border-bottom:1px solid rgba(255,255,255,.06);"
      + "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;"
      + "font:400 9px/1.1 var(--exo-font-family,Verdana,Arial,sans-serif);letter-spacing:.01em;text-align:center;}"
      + "#ep-tool-dock button:last-of-type{border-bottom:0;}"
      + "#ep-tool-dock button:hover{background:var(--exo-purple,#473a6d);color:#fff;}"
      + "#ep-tool-dock button.on{background:var(--exo-orange,#ef895f);color:#2b2341;}"
      + "#ep-tool-dock button svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.6;}"
      + "#ep-tool-dock .ep-dock-sep{height:8px;background:transparent;}";
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    dock = document.createElement("div");
    dock.id = "ep-tool-dock";
    document.body.appendChild(dock);
    window.epKeepAlive(dock);
    return dock;
  };

  window.epAddDockButton = window.epAddDockButton || function (opts) {
    var dock = window.epGetToolDock();
    var b = document.createElement("button");
    b.type = "button";
    b.id = opts.id;
    b.innerHTML = (opts.svg || "") + "<span>" + opts.label + "</span>";
    if (opts.title) b.title = opts.title;
    dock.appendChild(b);
    if (opts.afterSeparator) {
      var sep = document.createElement("div");
      sep.className = "ep-dock-sep";
      dock.appendChild(sep);
    }
    return b;
  };
})();
