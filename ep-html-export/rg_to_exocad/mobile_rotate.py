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

  /* Our floating panels (ct_panel.js/toolbar.js/implants.js) are inside
     the rotated <body>, so their own left/right/top/bottom are resolved
     in that LOCAL (pre-rotation) box before the whole thing gets rotated
     for painting. For a 90deg clockwise rotation: local-top ends up on
     screen at the RIGHT, local-right ends up at the BOTTOM, local-bottom
     ends up at the LEFT, local-left ends up at the TOP. A panel pinned to
     local "right" (as written for a normal, unrotated desktop page) was
     therefore landing on the screen's bottom edge instead of its right
     edge. These rules re-derive each panel's LOCAL position from where it
     should actually end up on screen.

     right (dock): local-top -> visual-right, centered along that edge.
     right (ct panel): local-top -> visual-right, spanning local-left..right
     (-> spans the full visual height once rotated).
     bottom-left (implant bar): local-right -> visual-bottom,
     local-bottom -> visual-left. */
  #ep-tool-dock {
    top: 8px !important; right: auto !important; bottom: auto !important;
    left: 50% !important; transform: translateX(-50%) !important;
    flex-direction: row !important;
  }
  #ep-tool-dock button { border-bottom: 0 !important; border-right: 1px solid rgba(255,255,255,.06) !important; }
  #ep-tool-dock button:last-of-type { border-right: 0 !important; }
  #ep-tool-dock .ep-dock-sep { height: auto !important; width: 8px !important; }

  #ep-ct-panel {
    top: 64px !important; right: 12px !important; left: 12px !important; bottom: auto !important;
    width: auto !important; height: min(38vw, 340px) !important;
  }

  #ep-imp-bar {
    bottom: 8px !important; right: 8px !important; top: auto !important; left: auto !important;
  }

  /* Same footprint as the CT panel above - the two are unlikely to be open
     at once on a screen this small, and if they are, either can just be
     closed; not worth a bespoke non-overlapping layout for that. */
  #ep-mark-panel {
    top: 64px !important; right: 12px !important; left: 12px !important; bottom: auto !important;
    width: auto !important; height: min(38vw, 340px) !important;
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
