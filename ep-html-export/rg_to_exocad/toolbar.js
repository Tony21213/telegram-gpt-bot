(function () {
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
