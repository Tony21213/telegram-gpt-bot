(function () {
  window.epSetActiveTool = window.epSetActiveTool || function (name) {
    window.__EP_ACTIVE_TOOL__ = name;
    document.dispatchEvent(new CustomEvent("ep-tool-changed", { detail: name }));
  };

  var css = ""
    + "#ep-ruler-toggle{position:absolute;left:104px;bottom:8px;z-index:20;height:40px;padding:0 12px;border-radius:20px;"
    + "background:#1e3044;color:#fff;border:1px solid #2a3f55;cursor:pointer;font:600 11px system-ui,sans-serif;}"
    + "#ep-ruler-toggle.on{background:#3a8f3a;border-color:#7dff6a;}"
    + "#ep-ruler-clear{position:absolute;left:200px;bottom:8px;z-index:20;height:40px;padding:0 12px;border-radius:20px;"
    + "background:#1e3044;color:#fff;border:1px solid #2a3f55;cursor:pointer;font:600 11px system-ui,sans-serif;display:none;}"
    + "#ep-ruler-svg{position:fixed;inset:0;z-index:15;pointer-events:none;width:100%;height:100%;}"
    + ".ep-ruler-line{stroke:#00f6ff;stroke-width:2.5;stroke-linecap:round;}"
    + ".ep-ruler-dot{fill:#00f6ff;stroke:#000;stroke-width:1;}"
    + ".ep-ruler-lab{font:700 12px system-ui,sans-serif;fill:#fff;paint-order:stroke;stroke:#000;stroke-width:3;"
    + "pointer-events:auto;cursor:pointer;}";
  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var toggleBtn = document.createElement("button");
  toggleBtn.id = "ep-ruler-toggle";
  toggleBtn.type = "button";
  toggleBtn.textContent = "Линейка";
  toggleBtn.title = "Измерить расстояние: два клика по модели";
  document.body.appendChild(toggleBtn);

  var clearBtn = document.createElement("button");
  clearBtn.id = "ep-ruler-clear";
  clearBtn.type = "button";
  clearBtn.textContent = "Очистить линейки";
  document.body.appendChild(clearBtn);

  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "ep-ruler-svg";
  document.body.appendChild(svg);

  var active = false;
  var draftStart = null; // THREE.Vector3 of first click, awaiting second
  var measurements = []; // {a: Vector3, b: Vector3}

  function updateButtons() {
    clearBtn.style.display = measurements.length ? "block" : "none";
  }

  function projectToScreen(camera, canvasRect, worldPoint) {
    var p = worldPoint.clone().project(camera);
    return {
      x: canvasRect.left + (p.x * 0.5 + 0.5) * canvasRect.width,
      y: canvasRect.top + (-p.y * 0.5 + 0.5) * canvasRect.height,
    };
  }

  function redrawSvg() {
    var d = window.DentalWebGL;
    if (!d || !d.m_SceneManager) return;
    var camera, overlay;
    try {
      camera = d.m_SceneManager.getCamera();
      overlay = d.m_SceneManager.getOverlayCanvas().getCanvas();
    } catch (e) { return; }
    var rect = overlay.getBoundingClientRect();
    svg.innerHTML = "";
    measurements.forEach(function (m, idx) {
      drawSegment(camera, rect, m.a, m.b, idx);
    });
    if (draftStart) {
      // no live end point without a mousemove tracker; just show the start dot
      var sp = projectToScreen(camera, rect, draftStart);
      addDot(sp.x, sp.y);
    }
  }

  function addDot(x, y) {
    var c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 5);
    c.setAttribute("class", "ep-ruler-dot");
    svg.appendChild(c);
  }

  function drawSegment(camera, rect, a, b, idx) {
    var pa = projectToScreen(camera, rect, a);
    var pb = projectToScreen(camera, rect, b);
    var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", pa.x); line.setAttribute("y1", pa.y);
    line.setAttribute("x2", pb.x); line.setAttribute("y2", pb.y);
    line.setAttribute("class", "ep-ruler-line");
    svg.appendChild(line);
    addDot(pa.x, pa.y);
    addDot(pb.x, pb.y);
    var dist = a.distanceTo(b);
    var mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    var text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", mx); text.setAttribute("y", my - 6);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "ep-ruler-lab");
    text.textContent = dist.toFixed(2) + " мм";
    text.title = "Двойной клик - удалить";
    text.addEventListener("dblclick", function () {
      measurements.splice(idx, 1);
      updateButtons();
      redrawSvg();
    });
    svg.appendChild(text);
  }

  function loop() {
    redrawSvg();
    requestAnimationFrame(loop);
  }

  toggleBtn.addEventListener("click", function () {
    active = !active;
    toggleBtn.classList.toggle("on", active);
    draftStart = null;
    epSetActiveTool(active ? "ruler" : null);
  });
  document.addEventListener("ep-tool-changed", function (ev) {
    if (ev.detail !== "ruler" && active) {
      active = false;
      toggleBtn.classList.remove("on");
      draftStart = null;
    }
  });
  clearBtn.addEventListener("click", function () {
    measurements = [];
    updateButtons();
    redrawSvg();
  });

  function trySetupPicking() {
    var d = window.DentalWebGL;
    if (!d || !d.m_SceneManager || !d.m_SceneManager.getOverlayCanvas) { setTimeout(trySetupPicking, 300); return; }
    var overlay;
    try { overlay = d.m_SceneManager.getOverlayCanvas().getCanvas(); } catch (e) { setTimeout(trySetupPicking, 300); return; }
    var raycaster = new THREE.Raycaster();
    overlay.addEventListener("click", function (ev) {
      if (!active) return;
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
        if (!hits.length) return;
        var pt = hits[0].point.clone();
        if (!draftStart) {
          draftStart = pt;
        } else {
          measurements.push({ a: draftStart, b: pt });
          draftStart = null;
          updateButtons();
        }
        redrawSvg();
      } catch (e) { console.error("EP ruler pick failed", e); }
    });
    requestAnimationFrame(loop);
  }
  trySetupPicking();
})();
