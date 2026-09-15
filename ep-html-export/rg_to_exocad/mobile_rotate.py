import os

_JS_PATH = os.path.join(os.path.dirname(__file__), "mobile_rotate.js")

MOBILE_ROTATE_CSS = """
@media screen and (max-width: 900px) and (orientation: portrait) {
  html { overflow: hidden; }
  body {
    width: 100vh !important;
    height: 100vw !important;
    overflow: hidden !important;
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    transform-origin: top left !important;
    transform: rotate(90deg) translateY(-100%) !important;
  }

  /* Our floating panels (ct_panel.js/toolbar.js/implants.js/markers.js) are
     inside the rotated <body>, so their own left/right/top/bottom are
     resolved in that LOCAL (pre-rotation) box before the whole thing gets
     rotated for painting - and that LOCAL box is exactly the landscape
     frame the user ends up perceiving once they physically tilt the phone
     90deg to match the rotation, so position/size intent ("spans most of
     the width", "sits just under the dock") should be authored directly in
     LOCAL terms, same as on an ordinary unrotated landscape page. Only
     RAYCASTING and on-screen pixel math (ct_panel.js/markers.js picking +
     pin projection) need the LOCAL<->real-screen conversion
     (epScreenToLocal/epGetLocalRect in toolbar.js), because those compare
     against actual click coordinates and getBoundingClientRect(), which
     the browser reports in the real (post-rotation) screen frame
     regardless of how anyone is holding the phone.

     The one thing that DOES need re-deriving here is which local EDGE a
     panel should pin to: for this 90deg clockwise rotation, local-top ends
     up on screen at the RIGHT, local-right at the BOTTOM, local-bottom at
     the LEFT, local-left at the TOP - so e.g. the dock (pinned to local
     "right" for a normal desktop layout) was landing on the screen's
     bottom edge instead of its right edge without this override. */
  #ep-tool-dock {
    top: 8px !important; right: auto !important; bottom: auto !important;
    left: 50% !important; transform: translateX(-50%) !important;
    flex-direction: row !important;
  }
  #ep-tool-dock button { border-bottom: 0 !important; border-right: 1px solid rgba(255,255,255,.06) !important; }
  #ep-tool-dock button:last-of-type { border-right: 0 !important; }
  #ep-tool-dock .ep-dock-sep { height: auto !important; width: 8px !important; }

  #ep-ct-panel, #ep-mark-panel {
    top: 64px !important; right: 12px !important; left: 12px !important; bottom: auto !important;
    width: auto !important; height: min(38vw, 340px) !important;
  }

  #ep-imp-bar {
    bottom: 8px !important; right: 8px !important; top: auto !important; left: auto !important;
  }
}
"""


def inject_mobile_rotate(html):
    """Forces a landscape-oriented layout on narrow/portrait mobile screens
    by rotating the whole page 90deg via CSS, so the viewer is usable
    holding the phone naturally (portrait) while the UI itself reads as
    landscape - useful because this viewer's layout (side panel + 3D view +
    CT column) really wants landscape space.

    exocad's own GUI.getDeviceWidth()/getDeviceHeight() (used everywhere
    internally for canvas/layout sizing) are monkey-patched to return the
    swapped dimensions while rotated, and a synthetic 'resize' event is
    dispatched so their own resize() handlers - the WebGL renderer, camera
    aspect, sidebar, toolbars - all recompute against the correct (rotated)
    size. This is the only touch point; nothing else in exocad's code is
    modified, only these two already-overridable functions.
    """
    with open(_JS_PATH, "r", encoding="utf-8") as f:
        js = f.read()
    block = "\n<style>" + MOBILE_ROTATE_CSS + "</style>\n<script>\n" + js + "\n</script>\n"
    idx = html.rfind("</body>")
    if idx == -1:
        return html + block
    return html[:idx] + block + html[idx:]
