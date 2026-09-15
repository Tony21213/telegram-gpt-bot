(function () {
  var mq = window.matchMedia("(max-width: 900px) and (orientation: portrait)");

  function patchDeviceSize() {
    var d = window.DentalWebGL;
    if (!d || !d.GUI || d.GUI.__epRotatePatched) { return !!(d && d.GUI && d.GUI.__epRotatePatched); }
    var origW = d.GUI.getDeviceWidth.bind(d.GUI);
    var origH = d.GUI.getDeviceHeight.bind(d.GUI);
    d.GUI.getDeviceWidth = function () { return mq.matches ? origH() : origW(); };
    d.GUI.getDeviceHeight = function () { return mq.matches ? origW() : origH(); };
    d.GUI.__epRotatePatched = true;
    return true;
  }

  function fireResize() {
    window.dispatchEvent(new Event("resize"));
  }

  function tryPatch() {
    if (patchDeviceSize()) {
      fireResize();
    } else {
      setTimeout(tryPatch, 300);
    }
  }
  tryPatch();

  mq.addEventListener("change", function () {
    // A couple of frames: exocad's own resize() reads layout metrics that
    // need the CSS rotation transform to have actually applied first.
    fireResize();
    requestAnimationFrame(fireResize);
    setTimeout(fireResize, 300);
  });
  window.addEventListener("orientationchange", function () {
    setTimeout(fireResize, 300);
  });
})();
