(function () {
  var css = ""
    + "#ep-ct-toggle{position:absolute;left:8px;bottom:8px;z-index:20;width:40px;height:40px;border-radius:50%;"
    + "background:#296eb3;color:#fff;border:1px solid #1e3044;cursor:pointer;font:600 11px system-ui,sans-serif;}"
    + "#ep-ct-toggle:hover{background:#3a82c9;}"
    + "#ep-ct-pick{position:absolute;left:56px;bottom:8px;z-index:20;height:40px;padding:0 12px;border-radius:20px;"
    + "background:#1e3044;color:#fff;border:1px solid #2a3f55;cursor:pointer;font:600 11px system-ui,sans-serif;}"
    + "#ep-ct-pick.on{background:#d9822b;border-color:#ffb86a;}"
    + "#ep-ct-panel{position:fixed;right:12px;top:12px;bottom:12px;width:min(46vw,720px);z-index:30;display:none;"
    + "background:#0b1622;border:1px solid #2a3f55;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.5);"
    + "color:#fff;font:12px/1.4 system-ui,sans-serif;flex-direction:column;overflow:hidden;}"
    + "#ep-ct-panel.on{display:flex;}"
    + "#ep-ct-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#122134;border-bottom:1px solid #2a3f55;}"
    + "#ep-ct-head b{flex:1;font-weight:650;letter-spacing:.02em;}"
    + "#ep-ct-close{width:26px;height:26px;border-radius:6px;background:#1e3044;color:#fff;border:1px solid #2a3f55;cursor:pointer;}"
    + "#ep-ct-views{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:1px;background:#2a3f55;}"
    + ".ep-ct-view{position:relative;background:#000;overflow:hidden;min-height:0;min-width:0;}"
    + ".ep-ct-view canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;cursor:ns-resize;}"
    + ".ep-ct-lab{position:absolute;left:4px;top:3px;font-size:10px;font-weight:700;color:#9ab0c7;background:rgba(0,0,0,.5);"
    + "padding:1px 5px;border-radius:3px;pointer-events:none;z-index:2;}"
    + "#ep-ct-info{position:relative;padding:8px;font-size:11px;color:#9ab0c7;white-space:pre-line;overflow:auto;}"
    + "#ep-ct-controls{display:flex;flex-wrap:wrap;gap:10px;padding:8px 10px;background:#122134;border-top:1px solid #2a3f55;}"
    + "#ep-ct-controls label{display:flex;align-items:center;gap:6px;font-size:10px;color:#9ab0c7;}"
    + "#ep-ct-controls input[type=range]{width:90px;accent-color:#3a82c9;}"
    + "#ep-ct-controls .val{min-width:36px;color:#fff;font-weight:600;}";
  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var toggleBtn = document.createElement("button");
  toggleBtn.id = "ep-ct-toggle";
  toggleBtn.type = "button";
  toggleBtn.textContent = "KT";
  toggleBtn.title = "Показать/скрыть окно КТ (данные из RealGUIDE)";
  document.body.appendChild(toggleBtn);

  var pickBtn = document.createElement("button");
  pickBtn.id = "ep-ct-pick";
  pickBtn.type = "button";
  pickBtn.textContent = "Указать точку в 3D";
  document.body.appendChild(pickBtn);

  var panel = document.createElement("div");
  panel.id = "ep-ct-panel";
  panel.innerHTML = ""
    + "<div id=\"ep-ct-head\"><b>КТ (RealGUIDE)</b><button id=\"ep-ct-close\" type=\"button\">×</button></div>"
    + "<div id=\"ep-ct-views\">"
    + "<div class=\"ep-ct-view\"><span class=\"ep-ct-lab\">AXIAL (Z)</span><canvas id=\"ep-cv-ax\" width=\"360\" height=\"360\"></canvas></div>"
    + "<div class=\"ep-ct-view\"><span class=\"ep-ct-lab\">CORONAL (Y)</span><canvas id=\"ep-cv-cor\" width=\"360\" height=\"360\"></canvas></div>"
    + "<div class=\"ep-ct-view\"><span class=\"ep-ct-lab\">SAGITTAL (X)</span><canvas id=\"ep-cv-sag\" width=\"360\" height=\"360\"></canvas></div>"
    + "<div id=\"ep-ct-info\"></div>"
    + "</div>"
    + "<div id=\"ep-ct-controls\">"
    + "<label>Window <input id=\"ep-ct-window\" type=\"range\" min=\"50\" max=\"6000\" value=\"2800\"><span class=\"val\" id=\"ep-ct-window-val\">2800</span></label>"
    + "<label>Level <input id=\"ep-ct-level\" type=\"range\" min=\"-1000\" max=\"3000\" value=\"600\"><span class=\"val\" id=\"ep-ct-level-val\">600</span></label>"
    + "<label>Zoom <input id=\"ep-ct-zoom\" type=\"range\" min=\"0.3\" max=\"4\" step=\"0.1\" value=\"1\"><span class=\"val\" id=\"ep-ct-zoom-val\">1.0×</span></label>"
    + "</div>";
  document.body.appendChild(panel);

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
    center: null, // THREE.Vector3-like {x,y,z} in world/volume coords
    windowW: 2800,
    level: 600,
    zoom: 1,
  };

  function huToGray(hu) {
    var lo = state.level - state.windowW / 2;
    var g = ((hu - lo) / state.windowW) * 255;
    return g < 0 ? 0 : g > 255 ? 255 : g | 0;
  }

  // axisU/axisV: which world axes map to canvas X/Y for this plane.
  // fixedAxis: the axis held constant (0=x,1=y,2=z).
  function renderPlane(canvas, axisU, axisV, fixedAxis, center) {
    var vol = state.vol;
    if (!vol) return;
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height;
    var img = ctx.createImageData(w, h);
    var pixSize = Math.min(vol.spacing[0], vol.spacing[1], vol.spacing[2]) / state.zoom;
    var origin = [center.x, center.y, center.z];
    var fixedVal = origin[fixedAxis];
    for (var py = 0; py < h; py++) {
      var v = origin[axisV] + (py - h / 2) * pixSize;
      for (var px = 0; px < w; px++) {
        var u = origin[axisU] + (px - w / 2) * pixSize;
        var p = [0, 0, 0];
        p[axisU] = u; p[axisV] = v; p[fixedAxis] = fixedVal;
        var hu = sampleHu(vol, p[0], p[1], p[2]);
        var g = huToGray(hu);
        var idx = (py * w + px) * 4;
        img.data[idx] = g; img.data[idx + 1] = g; img.data[idx + 2] = g; img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function renderAll() {
    if (!state.vol || !state.center) return;
    renderPlane(document.getElementById("ep-cv-ax"), 0, 1, 2, state.center);   // axial: X/Y, fixed Z
    renderPlane(document.getElementById("ep-cv-cor"), 0, 2, 1, state.center);  // coronal: X/Z, fixed Y
    renderPlane(document.getElementById("ep-cv-sag"), 1, 2, 0, state.center);  // sagittal: Y/Z, fixed X
    document.getElementById("ep-ct-info").textContent =
      "Точка (мм):\nX " + state.center.x.toFixed(2) +
      "\nY " + state.center.y.toFixed(2) +
      "\nZ " + state.center.z.toFixed(2) +
      "\n\nКолесо мыши над срезом - двигаться вдоль его нормали.\n" +
      "Кнопка \"Указать точку в 3D\" - клик по модели ставит точку среза.";
  }

  ["ep-cv-ax", "ep-cv-cor", "ep-cv-sag"].forEach(function (id, i) {
    var axisNames = [2, 1, 0]; // fixed axis per view, matches renderPlane calls above
    document.getElementById(id).addEventListener("wheel", function (ev) {
      ev.preventDefault();
      if (!state.vol || !state.center) return;
      var axis = axisNames[i];
      var spacing = state.vol.spacing[axis];
      var dir = ev.deltaY > 0 ? 1 : -1;
      var axisKey = axis === 0 ? "x" : axis === 1 ? "y" : "z";
      state.center[axisKey] += dir * spacing;
      renderAll();
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

  toggleBtn.addEventListener("click", function () {
    panel.classList.toggle("on");
  });
  document.getElementById("ep-ct-close").addEventListener("click", function () {
    panel.classList.remove("on");
  });

  var picking = false;
  pickBtn.addEventListener("click", function () {
    picking = !picking;
    pickBtn.classList.toggle("on", picking);
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
          renderAll();
        }
      } catch (e) { console.error("EP CT pick failed", e); }
    });
  }
  trySetupPicking();

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
