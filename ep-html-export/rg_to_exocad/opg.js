(function () {
  var css = ""
    + "#ep-opg-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:35;display:none;"
    + "width:min(700px,90vw);height:min(440px,80vh);"
    + "background:var(--p6,#2b2341);border:1px solid rgba(255,255,255,.1);border-radius:4px;box-shadow:0 20px 60px rgba(0,0,0,.55);"
    + "color:#fff;font:12px/1.4 var(--exo-font-family,Verdana,Arial,sans-serif);flex-direction:column;overflow:hidden;}"
    + "#ep-opg-panel.on{display:flex;}"
    + "#ep-opg-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--exo-purple-dark,#362b56);"
    + "border-bottom:1px solid rgba(255,255,255,.1);}"
    + "#ep-opg-head b{flex:1;font-weight:700;letter-spacing:.02em;font-size:12px;}"
    + "#ep-opg-head button{height:24px;padding:0 10px;border-radius:4px;background:var(--exo-purple,#473a6d);color:#fff;"
    + "border:1px solid rgba(255,255,255,.15);cursor:pointer;font-size:11px;font-family:inherit;white-space:nowrap;}"
    + "#ep-opg-close{width:24px !important;padding:0 !important;}"
    + "#ep-opg-body{flex:1;min-height:0;display:flex;gap:1px;background:rgba(255,255,255,.1);}"
    + ".ep-opg-col{flex:0 0 auto;display:flex;flex-direction:column;background:var(--p6,#2b2341);min-width:0;}"
    + ".ep-opg-col-wide{flex:1;}"
    + ".ep-opg-lab{font-size:10px;font-weight:700;color:var(--exo-purple-light2,#c4c7d6);padding:4px 6px;}"
    + "#ep-opg-editor{background:#000;cursor:grab;touch-action:none;align-self:center;}"
    + "#ep-opg-pano-wrap{flex:1;min-height:0;overflow:auto;background:#000;display:flex;align-items:center;justify-content:center;}"
    + "#ep-opg-pano{background:#000;max-width:100%;}"
    + "#ep-opg-controls{display:flex;flex-wrap:wrap;gap:10px;padding:8px 10px;background:var(--exo-purple-dark,#362b56);"
    + "border-top:1px solid rgba(255,255,255,.1);}"
    + "#ep-opg-controls label{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--exo-purple-light2,#c4c7d6);}"
    + "#ep-opg-controls input[type=range]{width:90px;accent-color:var(--exo-orange,#ef895f);}"
    + "#ep-opg-controls .val{min-width:44px;color:#fff;font-weight:700;}";
  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var toggleBtn = window.epAddDockButton({
    id: "ep-opg-toggle", label: "ОПТГ", title: "Панорамная реконструкция (ОПТГ) из КТ",
    svg: '<svg viewBox="0 0 24 24"><path d="M3 16c2-6 6-9 9-9s7 3 9 9"></path><path d="M3 16h18"></path></svg>',
  });

  var panel = document.createElement("div");
  panel.id = "ep-opg-panel";
  panel.innerHTML = ""
    + '<div id="ep-opg-head"><b>ОПТГ (панорама)</b>'
    + '<button id="ep-opg-reset" type="button">Сбросить дугу</button>'
    + '<button id="ep-opg-close" type="button">×</button></div>'
    + '<div id="ep-opg-body">'
    + '<div class="ep-opg-col"><span class="ep-opg-lab">Контур дуги (перетащите точки)</span>'
    + '<canvas id="ep-opg-editor" width="300" height="240"></canvas></div>'
    + '<div class="ep-opg-col ep-opg-col-wide"><span class="ep-opg-lab">Панорама</span>'
    + '<div id="ep-opg-pano-wrap"><canvas id="ep-opg-pano"></canvas></div></div>'
    + "</div>"
    + '<div id="ep-opg-controls">'
    + '<label>Толщина среза <input id="ep-opg-slab" type="range" min="1" max="20" step="1" value="6"><span class="val" id="ep-opg-slab-val">6 мм</span></label>'
    + '<label>Window <input id="ep-opg-window" type="range" min="50" max="6000" value="3500"><span class="val" id="ep-opg-window-val">3500</span></label>'
    + '<label>Level <input id="ep-opg-level" type="range" min="-1000" max="3000" value="500"><span class="val" id="ep-opg-level-val">500</span></label>'
    + "</div>";
  document.body.appendChild(panel);
  window.epKeepAlive(panel);

  var editor = document.getElementById("ep-opg-editor");
  var pano = document.getElementById("ep-opg-pano");
  var slabInput = document.getElementById("ep-opg-slab");
  var windowInput = document.getElementById("ep-opg-window");
  var levelInput = document.getElementById("ep-opg-level");

  var vol = null;
  var mip = null; // Int16Array(nx*ny), max HU along Z - reference image for the arch editor
  var controlPts = null; // [{x,y} world coords]
  var archSamples = null;
  var dragIdx = -1;

  function huToGray(hu, windowW, level) {
    var lo = level - windowW / 2;
    var g = ((hu - lo) / windowW) * 255;
    return g < 0 ? 0 : g > 255 ? 255 : g | 0;
  }

  function computeMip(v) {
    var n = v.nx * v.ny;
    var out = new Int16Array(n).fill(-1000);
    for (var z = 0; z < v.nz; z++) {
      var zoff = z * n;
      for (var i = 0; i < n; i++) {
        var h = v.hu[zoff + i];
        if (h > out[i]) out[i] = h;
      }
    }
    return out;
  }

  function worldToEditorPx(wx, wy) {
    var fx = (wx - vol.origin[0]) / (vol.nx * vol.spacing[0]);
    var fy = (wy - vol.origin[1]) / (vol.ny * vol.spacing[1]);
    return { x: fx * editor.width, y: fy * editor.height };
  }
  function editorPxToWorld(px, py) {
    var fx = px / editor.width, fy = py / editor.height;
    return { x: vol.origin[0] + fx * vol.nx * vol.spacing[0], y: vol.origin[1] + fy * vol.ny * vol.spacing[1] };
  }

  // ---------- default arch (implant sites if available, else a generic
  // parabola guessed from the volume's bounding box) - always adjustable
  // afterwards by dragging the control points on the editor canvas. ----------
  function sitesControlPoints() {
    var el = document.getElementById("ep-sites-json");
    if (!el) return null;
    var sites;
    try { sites = JSON.parse(el.textContent).filter(function (s) { return s.origin; }); } catch (e) { return null; }
    if (sites.length < 2) return null;
    var pts = sites.map(function (s) { return { x: s.origin[0], y: s.origin[1] }; });
    var mx = pts.reduce(function (a, p) { return a + p.x; }, 0) / pts.length;
    var my = pts.reduce(function (a, p) { return a + p.y; }, 0) / pts.length;
    var varX = pts.reduce(function (a, p) { return a + (p.x - mx) * (p.x - mx); }, 0);
    var varY = pts.reduce(function (a, p) { return a + (p.y - my) * (p.y - my); }, 0);
    pts.sort(function (a, b) { return varX >= varY ? a.x - b.x : a.y - b.y; });
    return pts;
  }

  function bboxControlPoints() {
    var x0 = vol.origin[0], x1 = vol.origin[0] + vol.nx * vol.spacing[0];
    var y0 = vol.origin[1], y1 = vol.origin[1] + vol.ny * vol.spacing[1];
    var wide = (x1 - x0) >= (y1 - y0);
    var a0 = wide ? x0 : y0, a1 = wide ? x1 : y1;
    var bMid = wide ? (y0 + y1) / 2 : (x0 + x1) / 2;
    var bulge = (wide ? (y1 - y0) : (x1 - x0)) * 0.28;
    var pts = [];
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      var a = a0 + (a1 - a0) * t;
      var b = bMid - bulge * Math.sin(Math.PI * t); // parabola-ish arch
      pts.push(wide ? { x: a, y: b } : { x: b, y: a });
    });
    return pts;
  }

  function resetControlPoints() {
    controlPts = sitesControlPoints() || bboxControlPoints();
  }

  // ---------- Catmull-Rom spline through control points, resampled to even
  // arc-length spacing with a tangent/normal frame at each output column. ----------
  function catmullRomSegment(pts, i, t) {
    var n = pts.length;
    var p0 = pts[Math.max(0, i - 1)], p1 = pts[i];
    var p2 = pts[Math.min(n - 1, i + 1)], p3 = pts[Math.min(n - 1, i + 2)];
    var t2 = t * t, t3 = t2 * t;
    function c(a, b, cc, d) { return 0.5 * ((2 * b) + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3); }
    return { x: c(p0.x, p1.x, p2.x, p3.x), y: c(p0.y, p1.y, p2.y, p3.y) };
  }

  function denseCurve(pts, samplesPerSeg) {
    var out = [];
    for (var i = 0; i < pts.length - 1; i++) {
      for (var s = 0; s < samplesPerSeg; s++) out.push(catmullRomSegment(pts, i, s / samplesPerSeg));
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function buildArchSamples(pts, numOut) {
    var dense = denseCurve(pts, 40);
    var cum = [0];
    for (var i = 1; i < dense.length; i++) {
      var dx = dense[i].x - dense[i - 1].x, dy = dense[i].y - dense[i - 1].y;
      cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    var total = cum[cum.length - 1];
    var out = [], di = 0;
    for (var k = 0; k < numOut; k++) {
      var target = total * k / (numOut - 1);
      while (di < cum.length - 2 && cum[di + 1] < target) di++;
      var segLen = cum[di + 1] - cum[di];
      var lt = segLen > 1e-9 ? (target - cum[di]) / segLen : 0;
      var x = dense[di].x + (dense[di + 1].x - dense[di].x) * lt;
      var y = dense[di].y + (dense[di + 1].y - dense[di].y) * lt;
      var t0 = Math.max(0, di - 1), t1 = Math.min(dense.length - 1, di + 2);
      var tx = dense[t1].x - dense[t0].x, ty = dense[t1].y - dense[t0].y;
      var tl = Math.sqrt(tx * tx + ty * ty) || 1;
      tx /= tl; ty /= tl;
      out.push({ x: x, y: y, normal: { x: -ty, y: tx } });
    }
    return out;
  }

  // ---------- rendering ----------
  function renderEditor() {
    var ctx = editor.getContext("2d");
    var img = ctx.createImageData(editor.width, editor.height);
    var w = +windowInput.value, l = +levelInput.value;
    for (var py = 0; py < editor.height; py++) {
      var iy = Math.min(vol.ny - 1, (py / editor.height * vol.ny) | 0);
      for (var px = 0; px < editor.width; px++) {
        var ix = Math.min(vol.nx - 1, (px / editor.width * vol.nx) | 0);
        var g = huToGray(mip[iy * vol.nx + ix], w, l);
        var idx = (py * editor.width + px) * 4;
        img.data[idx] = g * 0.6; img.data[idx + 1] = g * 0.75; img.data[idx + 2] = g; img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    var dense = denseCurve(controlPts, 20);
    ctx.strokeStyle = "#ef895f"; ctx.lineWidth = 2; ctx.beginPath();
    dense.forEach(function (p, i) {
      var sp = worldToEditorPx(p.x, p.y);
      if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
    });
    ctx.stroke();
    controlPts.forEach(function (p) {
      var sp = worldToEditorPx(p.x, p.y);
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#ef895f"; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
    });
  }

  function renderPanorama() {
    var outW = 640;
    var zMin = vol.origin[2], zMax = vol.origin[2] + vol.nz * vol.spacing[2];
    var outH = Math.max(120, Math.min(420, Math.round(((zMax - zMin) / (vol.nx * vol.spacing[0])) * outW * 0.5)));
    pano.width = outW; pano.height = outH;
    archSamples = buildArchSamples(controlPts, outW);
    var ctx = pano.getContext("2d");
    var img = ctx.createImageData(outW, outH);
    var slabMm = +slabInput.value, w = +windowInput.value, l = +levelInput.value;
    var steps = Math.max(1, Math.min(9, Math.round(slabMm / 2)));
    var sampleHu = window.__EP_CT__.sampleHu;
    for (var col = 0; col < outW; col++) {
      var s = archSamples[col];
      for (var row = 0; row < outH; row++) {
        var z = zMax - (row / (outH - 1)) * (zMax - zMin);
        var best = -1000;
        for (var k = 0; k < steps; k++) {
          var off = steps === 1 ? 0 : (-slabMm / 2 + (k / (steps - 1)) * slabMm);
          var hu = sampleHu(vol, s.x + s.normal.x * off, s.y + s.normal.y * off, z);
          if (hu > best) best = hu;
        }
        var g = huToGray(best, w, l);
        var idx = (row * outW + col) * 4;
        img.data[idx] = g; img.data[idx + 1] = g; img.data[idx + 2] = g; img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function renderAll() {
    if (!vol) return;
    renderEditor();
    renderPanorama();
  }

  // ---------- dragging control points on the editor canvas ----------
  editor.addEventListener("pointerdown", function (ev) {
    if (!vol) return;
    var rect = editor.getBoundingClientRect();
    var px = (ev.clientX - rect.left) * (editor.width / rect.width);
    var py = (ev.clientY - rect.top) * (editor.height / rect.height);
    var best = -1, bestD = 18 * 18;
    controlPts.forEach(function (p, i) {
      var sp = worldToEditorPx(p.x, p.y);
      var d = (sp.x - px) * (sp.x - px) + (sp.y - py) * (sp.y - py);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best !== -1) {
      dragIdx = best;
      editor.setPointerCapture(ev.pointerId);
      editor.style.cursor = "grabbing";
    }
  });
  editor.addEventListener("pointermove", function (ev) {
    if (dragIdx === -1) return;
    var rect = editor.getBoundingClientRect();
    var px = (ev.clientX - rect.left) * (editor.width / rect.width);
    var py = (ev.clientY - rect.top) * (editor.height / rect.height);
    controlPts[dragIdx] = editorPxToWorld(px, py);
    renderAll();
  });
  function endDrag(ev) {
    if (dragIdx === -1) return;
    dragIdx = -1;
    editor.style.cursor = "grab";
    try { editor.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  }
  editor.addEventListener("pointerup", endDrag);
  editor.addEventListener("pointercancel", endDrag);

  document.getElementById("ep-opg-reset").addEventListener("click", function () {
    resetControlPoints();
    renderAll();
  });
  [slabInput, windowInput, levelInput].forEach(function (inp) {
    inp.addEventListener("input", function () {
      document.getElementById("ep-opg-slab-val").textContent = slabInput.value + " мм";
      document.getElementById("ep-opg-window-val").textContent = windowInput.value;
      document.getElementById("ep-opg-level-val").textContent = levelInput.value;
      renderAll();
    });
  });

  toggleBtn.addEventListener("click", function () {
    panel.classList.toggle("on");
    if (panel.classList.contains("on") && vol) renderAll();
  });
  document.getElementById("ep-opg-close").addEventListener("click", function () {
    panel.classList.remove("on");
  });

  function trySetupVolume() {
    if (!window.__EP_CT__ || typeof window.__EP_CT__.getVolume !== "function") { setTimeout(trySetupVolume, 300); return; }
    var v = window.__EP_CT__.getVolume();
    if (!v) { setTimeout(trySetupVolume, 300); return; }
    vol = v;
    mip = computeMip(vol);
    resetControlPoints();
    if (panel.classList.contains("on")) renderAll();
  }
  trySetupVolume();
})();
