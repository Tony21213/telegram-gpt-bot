(function () {
  window.epSetActiveTool = window.epSetActiveTool || function (name) {
    window.__EP_ACTIVE_TOOL__ = name;
    document.dispatchEvent(new CustomEvent("ep-tool-changed", { detail: name }));
  };

  var css = ""
    + "#ep-ct-panel{position:fixed;right:58px;top:12px;bottom:12px;width:min(30vw,440px);z-index:30;display:none;"
    + "background:var(--p6,#2b2341);border:1px solid rgba(255,255,255,.1);border-radius:4px;box-shadow:0 12px 40px rgba(0,0,0,.5);"
    + "color:#fff;font:12px/1.4 var(--exo-font-family,Verdana,Arial,sans-serif);flex-direction:column;overflow:hidden;}"
    + "#ep-ct-panel.on{display:flex;}"
    + "#ep-ct-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--exo-purple-dark,#362b56);"
    + "border-bottom:1px solid rgba(255,255,255,.1);}"
    + "#ep-ct-head b{flex:1;font-weight:700;letter-spacing:.02em;font-size:12px;}"
    + "#ep-ct-free{height:24px;padding:0 10px;border-radius:4px;background:var(--exo-purple,#473a6d);color:#fff;"
    + "border:1px solid rgba(255,255,255,.15);cursor:pointer;font-size:11px;font-family:inherit;}"
    + "#ep-ct-panel:not(.implant-mode) #ep-ct-free{display:none;}"
    + "#ep-ct-close{width:24px;height:24px;border-radius:4px;background:var(--exo-purple,#473a6d);color:#fff;"
    + "border:1px solid rgba(255,255,255,.15);cursor:pointer;}"
    // Vertical stack of views (like the real ExoPlan desktop app's right-hand
    // DICOM column), not a 2x2 grid.
    + "#ep-ct-views{flex:1;min-height:0;display:grid;grid-template-columns:1fr;grid-template-rows:repeat(3,1fr);gap:1px;"
    + "background:rgba(255,255,255,.1);}"
    + "#ep-ct-panel.implant-mode #ep-ct-views{grid-template-rows:repeat(2,1fr);}"
    + "#ep-ct-panel.implant-mode .ep-ct-view.only-free{display:none;}"
    + ".ep-ct-view{position:relative;background:#000;overflow:hidden;min-height:0;min-width:0;}"
    + ".ep-ct-view canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;cursor:ns-resize;}"
    + ".ep-ct-lab{position:absolute;left:4px;top:3px;font-size:10px;font-weight:700;color:var(--exo-purple-light2,#c4c7d6);"
    + "background:rgba(0,0,0,.55);padding:1px 5px;border-radius:3px;pointer-events:none;z-index:2;}"
    + "#ep-ct-info{display:none;}"
    + "#ep-ct-controls{display:flex;flex-wrap:wrap;gap:10px;padding:8px 10px;background:var(--exo-purple-dark,#362b56);"
    + "border-top:1px solid rgba(255,255,255,.1);}"
    + "#ep-ct-controls label{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--exo-purple-light2,#c4c7d6);}"
    + "#ep-ct-controls input[type=range]{width:90px;accent-color:var(--exo-orange,#ef895f);}"
    + "#ep-ct-controls .val{min-width:36px;color:#fff;font-weight:700;}"
    + "#ep-ct-rot-row{display:none;}"
    + "#ep-ct-panel.implant-mode #ep-ct-rot-row{display:flex;}";
  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var toggleBtn = window.epAddDockButton({
    id: "ep-ct-toggle", label: "КТ", title: "Показать/скрыть окно КТ (данные из RealGUIDE)",
    svg: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18M9 4v16"></path></svg>',
  });
  var pickBtn = window.epAddDockButton({
    id: "ep-ct-pick", label: "Точка", title: "Указать точку среза КТ: клик по модели",
    svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v4M12 18v4M2 12h4M18 12h4"></path></svg>',
  });

  var panel = document.createElement("div");
  panel.id = "ep-ct-panel";
  panel.innerHTML = ""
    + '<div id="ep-ct-head"><b id="ep-ct-title">КТ (RealGUIDE)</b>'
    + '<button id="ep-ct-free" type="button">Свободная точка</button>'
    + '<button id="ep-ct-close" type="button">×</button></div>'
    + '<div id="ep-ct-views">'
    + '<div class="ep-ct-view"><span class="ep-ct-lab" id="ep-lab-1">AXIAL (Z)</span><canvas id="ep-cv-1" width="360" height="360"></canvas></div>'
    + '<div class="ep-ct-view"><span class="ep-ct-lab" id="ep-lab-2">CORONAL (Y)</span><canvas id="ep-cv-2" width="360" height="360"></canvas></div>'
    + '<div class="ep-ct-view only-free"><span class="ep-ct-lab">SAGITTAL (X)</span><canvas id="ep-cv-3" width="360" height="360"></canvas></div>'
    + '<div id="ep-ct-info" class="only-free"></div>'
    + "</div>"
    + '<div id="ep-ct-controls">'
    + '<label>Window <input id="ep-ct-window" type="range" min="50" max="6000" value="2800"><span class="val" id="ep-ct-window-val">2800</span></label>'
    + '<label>Level <input id="ep-ct-level" type="range" min="-1000" max="3000" value="600"><span class="val" id="ep-ct-level-val">600</span></label>'
    + '<label>Zoom <input id="ep-ct-zoom" type="range" min="0.3" max="4" step="0.1" value="1"><span class="val" id="ep-ct-zoom-val">1.0×</span></label>'
    + '<label id="ep-ct-rot-row">Поворот <input id="ep-ct-rot" type="range" min="0" max="359" value="0"><span class="val" id="ep-ct-rot-val">0°</span></label>'
    + "</div>";
  document.body.appendChild(panel);
  window.epKeepAlive(panel);

  // ---------- vector helpers ----------
  function v(x, y, z) { return { x: x, y: y, z: z }; }
  function vsub(a, b) { return v(a.x - b.x, a.y - b.y, a.z - b.z); }
  function vadd(a, b) { return v(a.x + b.x, a.y + b.y, a.z + b.z); }
  function vscale(a, s) { return v(a.x * s, a.y * s, a.z * s); }
  function vdot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function vcross(a, b) { return v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
  function vlen(a) { return Math.sqrt(vdot(a, a)); }
  function vnorm(a) { var l = vlen(a); return l < 1e-9 ? v(0, 0, 1) : vscale(a, 1 / l); }

  function b64ToBytes(b64) {
    var bin = atob(b64.replace(/\s+/g, ""));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function gunzipBytes(bytes) {
    var ds = new DecompressionStream("gzip");
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function unpackZvar(bytes, count) {
    var out = new Int16Array(count);
    var i = 0;
    for (var o = 0; o < count; o++) {
      var zig = 0, shift = 0, b;
      do { b = bytes[i++]; zig |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
      out[o] = (zig >>> 1) ^ -(zig & 1);
    }
    return out;
  }

  // D3DV decoder: same format the RealGUIDE viewer uses (magic "D3DV",
  // occupancy bitmap + zigzag-varint residuals with a simple
  // left/up/diagonal predictor). See ep-html-export/README.md.
  function decodeD3DV(raw) {
    var magic = String.fromCharCode(raw[0], raw[1], raw[2], raw[3]);
    if (magic !== "D3DV") throw new Error("Неверный формат D3DV: " + magic);
    var dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    var headerLen = dv.getInt32(8, true);
    var header = JSON.parse(new TextDecoder().decode(raw.subarray(12, 12 + headerLen)));
    var nx = header.dims[0], ny = header.dims[1], nz = header.dims[2];
    var n = nx * ny * nz;
    var plane = nx * ny;
    var occLen = Math.ceil(n / 8);
    var pos = 12 + headerLen;
    var occ = raw.subarray(pos, pos + occLen);
    pos += occLen;
    var residuals = unpackZvar(raw.subarray(pos), header.occupied | 0);
    var hu = new Int16Array(n);
    hu.fill(-1000);
    var oi = 0;
    function occAt(idx) { return ((occ[idx >> 3] >> (idx & 7)) & 1) === 1; }
    for (var i = 0; i < n; i++) {
      if (!occAt(i)) continue;
      var z = (i / plane) | 0, rem = i - z * plane, y = (rem / nx) | 0, x = rem - y * nx;
      var pred = 0;
      var hasW = x > 0, hasN = y > 0;
      if (hasW && hasN) {
        var w = occAt(i - 1) ? hu[i - 1] : -1000;
        var nv = occAt(i - nx) ? hu[i - nx] : -1000;
        var nw = occAt(i - nx - 1) ? hu[i - nx - 1] : -1000;
        pred = w + nv - nw;
      } else if (hasW) pred = occAt(i - 1) ? hu[i - 1] : -1000;
      else if (hasN) pred = occAt(i - nx) ? hu[i - nx] : -1000;
      else if (z > 0) { var p = i - plane; pred = occAt(p) ? hu[p] : -1000; }
      hu[i] = pred + residuals[oi++];
    }
    return { nx: nx, ny: ny, nz: nz, hu: hu, spacing: header.spacing, origin: header.origin };
  }

  function sampleHu(vol, wx, wy, wz) {
    var ix = Math.round((wx - vol.origin[0]) / vol.spacing[0]);
    var iy = Math.round((wy - vol.origin[1]) / vol.spacing[1]);
    var iz = Math.round((wz - vol.origin[2]) / vol.spacing[2]);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= vol.nx || iy >= vol.ny || iz >= vol.nz) return -1000;
    return vol.hu[iz * vol.nx * vol.ny + iy * vol.nx + ix];
  }

  var state = {
    vol: null,
    mode: "free", // "free" | "implant"
    center: null, // free-mode point, {x,y,z}
    site: null,   // implant-mode: {origin, axis, mesial, perp, tooth}
    rotationDeg: 0,
    alongOffset: 0,
    crossOffset: 0,
    windowW: 2800,
    level: 600,
    zoom: 1,
  };

  function huToGray(hu) {
    var lo = state.level - state.windowW / 2;
    var g = ((hu - lo) / state.windowW) * 255;
    return g < 0 ? 0 : g > 255 ? 255 : g | 0;
  }

  // General oblique-plane renderer: center + two orthonormal in-plane
  // basis vectors (rightVec = canvas +X, upVec = canvas +Y).
  function renderPlaneVec(canvas, center, rightVec, upVec) {
    var vol = state.vol;
    if (!vol) return;
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height;
    var img = ctx.createImageData(w, h);
    var pixSize = Math.min(vol.spacing[0], vol.spacing[1], vol.spacing[2]) / state.zoom;
    for (var py = 0; py < h; py++) {
      var dv = (py - h / 2) * pixSize;
      var by = center.y + upVec.y * dv, bx0 = center.x + upVec.x * dv, bz0 = center.z + upVec.z * dv;
      for (var px = 0; px < w; px++) {
        var du = (px - w / 2) * pixSize;
        var wx = bx0 + rightVec.x * du, wy = by + rightVec.y * du, wz = bz0 + rightVec.z * du;
        var hu = sampleHu(vol, wx, wy, wz);
        var g = huToGray(hu);
        var idx = (py * w + px) * 4;
        img.data[idx] = g; img.data[idx + 1] = g; img.data[idx + 2] = g; img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function axisUnit(axis) {
    return axis === 0 ? v(1, 0, 0) : axis === 1 ? v(0, 1, 0) : v(0, 0, 1);
  }

  function renderFree() {
    var c = state.center;
    renderPlaneVec(document.getElementById("ep-cv-1"), c, axisUnit(0), axisUnit(1)); // axial
    renderPlaneVec(document.getElementById("ep-cv-2"), c, axisUnit(0), axisUnit(2)); // coronal
    renderPlaneVec(document.getElementById("ep-cv-3"), c, axisUnit(1), axisUnit(2)); // sagittal
    document.getElementById("ep-ct-info").textContent =
      "Точка (мм):\nX " + c.x.toFixed(2) + "\nY " + c.y.toFixed(2) + "\nZ " + c.z.toFixed(2) +
      "\n\nКолесо мыши над срезом - двигаться вдоль его нормали.\n" +
      'Кнопка "Указать точку в 3D" - клик по модели ставит точку среза.';
  }

  // "Вдоль" (long-axis) view: horizontal = rotated mesial/perp direction,
  // vertical = implant axis. "Поперёк" (cross-section): both axes rotate
  // in the plane perpendicular to the implant axis - this is what the
  // rotation slider spins.
  function renderImplant() {
    var s = state.site;
    if (!s) return;
    var rad = state.rotationDeg * Math.PI / 180;
    var h = vadd(vscale(s.mesial, Math.cos(rad)), vscale(s.perp, Math.sin(rad)));
    var h2 = vadd(vscale(s.perp, Math.cos(rad)), vscale(s.mesial, -Math.sin(rad)));

    var alongCenter = vadd(s.origin, vscale(h2, state.alongOffset));
    renderPlaneVec(document.getElementById("ep-cv-1"), alongCenter, h, s.axis);

    var crossCenter = vadd(s.origin, vscale(s.axis, state.crossOffset));
    renderPlaneVec(document.getElementById("ep-cv-2"), crossCenter, h, h2);

    document.getElementById("ep-ct-title").textContent =
      "КТ - " + (s.kind === "pin" ? "пин " : "имплант ") + (s.tooth || "");
  }

  function renderAll() {
    if (!state.vol) return;
    if (state.mode === "implant" && state.site) renderImplant();
    else if (state.center) renderFree();
  }

  function setLabelsForMode() {
    if (state.mode === "implant") {
      document.getElementById("ep-lab-1").textContent = "ВДОЛЬ";
      document.getElementById("ep-lab-2").textContent = "ПОПЕРЁК";
    } else {
      document.getElementById("ep-lab-1").textContent = "AXIAL (Z)";
      document.getElementById("ep-lab-2").textContent = "CORONAL (Y)";
      document.getElementById("ep-ct-title").textContent = "КТ (RealGUIDE)";
    }
  }

  function setMode(mode) {
    state.mode = mode;
    panel.classList.toggle("implant-mode", mode === "implant");
    setLabelsForMode();
    renderAll();
  }

  [1, 2, 3].forEach(function (n) {
    document.getElementById("ep-cv-" + n).addEventListener("wheel", function (ev) {
      ev.preventDefault();
      if (!state.vol) return;
      var dir = ev.deltaY > 0 ? 1 : -1;
      if (state.mode === "implant") {
        if (!state.site) return;
        var step = state.site.spacingApprox || 0.2;
        if (n === 1) state.alongOffset += dir * step;
        else if (n === 2) state.crossOffset += dir * step;
        renderImplant();
      } else {
        if (!state.center) return;
        var axisIdx = n === 1 ? 2 : n === 2 ? 1 : 0; // fixed axis per free view
        var spacing = state.vol.spacing[axisIdx];
        var axisKey = axisIdx === 0 ? "x" : axisIdx === 1 ? "y" : "z";
        state.center[axisKey] += dir * spacing;
        renderFree();
      }
    }, { passive: false });
  });

  document.getElementById("ep-ct-window").addEventListener("input", function (e) {
    state.windowW = +e.target.value;
    document.getElementById("ep-ct-window-val").textContent = state.windowW;
    renderAll();
  });
  document.getElementById("ep-ct-level").addEventListener("input", function (e) {
    state.level = +e.target.value;
    document.getElementById("ep-ct-level-val").textContent = state.level;
    renderAll();
  });
  document.getElementById("ep-ct-zoom").addEventListener("input", function (e) {
    state.zoom = +e.target.value;
    document.getElementById("ep-ct-zoom-val").textContent = state.zoom.toFixed(1) + "×";
    renderAll();
  });
  document.getElementById("ep-ct-rot").addEventListener("input", function (e) {
    state.rotationDeg = +e.target.value;
    document.getElementById("ep-ct-rot-val").textContent = state.rotationDeg + "°";
    if (state.mode === "implant") renderImplant();
  });

  toggleBtn.addEventListener("click", function () {
    panel.classList.toggle("on");
  });
  document.getElementById("ep-ct-close").addEventListener("click", function () {
    panel.classList.remove("on");
  });
  document.getElementById("ep-ct-free").addEventListener("click", function () {
    if (state.site) state.center = vadd(state.site.origin, v(0, 0, 0));
    setMode("free");
  });

  var picking = false;
  pickBtn.addEventListener("click", function () {
    picking = !picking;
    pickBtn.classList.toggle("on", picking);
    epSetActiveTool(picking ? "ct-pick" : null);
  });
  document.addEventListener("ep-tool-changed", function (ev) {
    if (ev.detail !== "ct-pick" && picking) {
      picking = false;
      pickBtn.classList.remove("on");
    }
  });

  function trySetupPicking() {
    var d = window.DentalWebGL;
    if (!d || !d.m_SceneManager || !d.m_SceneManager.getOverlayCanvas) { setTimeout(trySetupPicking, 300); return; }
    var overlay;
    try { overlay = d.m_SceneManager.getOverlayCanvas().getCanvas(); } catch (e) { setTimeout(trySetupPicking, 300); return; }
    var raycaster = new THREE.Raycaster();
    overlay.addEventListener("click", function (ev) {
      if (!picking) return;
      try {
        var rect = overlay.getBoundingClientRect();
        var mouse = new THREE.Vector2(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1
        );
        var cam = d.m_SceneManager.getCamera();
        var scene = d.m_SceneManager.getScene();
        raycaster.setFromCamera(mouse, cam);
        var hits = raycaster.intersectObjects(scene.children, true);
        if (hits.length) {
          state.center = { x: hits[0].point.x, y: hits[0].point.y, z: hits[0].point.z };
          panel.classList.add("on");
          setMode("free");
        }
      } catch (e) { console.error("EP CT pick failed", e); }
    });
  }
  trySetupPicking();

  // Public API used by implants.js: focus the CT panel on a given implant
  // site (from the RealGUIDE sites[] list - has origin/axis/mesial in the
  // same world coordinates as the CT volume, since both came from the
  // same case).
  function focusSite(site) {
    if (!state.vol || !site.origin || !site.axis) return;
    var axis = vnorm(v(site.axis[0], site.axis[1], site.axis[2]));
    var mesialRaw = site.mesial ? v(site.mesial[0], site.mesial[1], site.mesial[2]) : v(1, 0, 0);
    // Gram-Schmidt: make sure "mesial" is actually perpendicular to axis.
    var mesial = vnorm(vsub(mesialRaw, vscale(axis, vdot(mesialRaw, axis))));
    var perp = vnorm(vcross(axis, mesial));
    state.site = {
      origin: v(site.origin[0], site.origin[1], site.origin[2]),
      axis: axis, mesial: mesial, perp: perp,
      tooth: site.tooth, kind: site.kind,
      spacingApprox: state.vol ? Math.min(state.vol.spacing[0], state.vol.spacing[1], state.vol.spacing[2]) : 0.2,
    };
    state.rotationDeg = 0; state.alongOffset = 0; state.crossOffset = 0;
    document.getElementById("ep-ct-rot").value = 0;
    document.getElementById("ep-ct-rot-val").textContent = "0°";
    panel.classList.add("on");
    setMode("implant");
  }
  window.__EP_CT__ = { focusSite: focusSite };

  async function boot() {
    try {
      var volEl = document.getElementById("ep-ct-vol-b64");
      if (!volEl) throw new Error("нет блока с данными КТ (ep-ct-vol-b64)");
      var gz = b64ToBytes(volEl.textContent);
      var raw = await gunzipBytes(gz);
      state.vol = decodeD3DV(raw);
      state.center = {
        x: state.vol.origin[0] + state.vol.nx * state.vol.spacing[0] / 2,
        y: state.vol.origin[1] + state.vol.ny * state.vol.spacing[1] / 2,
        z: state.vol.origin[2] + state.vol.nz * state.vol.spacing[2] / 2,
      };
      renderAll();
    } catch (e) {
      console.error("EP CT boot failed", e);
      document.getElementById("ep-ct-info").textContent = "Ошибка загрузки КТ: " + (e && e.message || e);
    }
  }
  boot();
})();
