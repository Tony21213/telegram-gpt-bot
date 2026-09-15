import json
import os

_JS_PATH = os.path.join(os.path.dirname(__file__), "implants.js")


def inject_implants_panel(html, sites):
    """Adds a per-tooth switcher bar + implant info modal (manufacturer,
    model, diameter/length, abutment, sleeve) to an exocad webview HTML.

    exocad's own m_Data format has no field for this kind of metadata at
    all (see ../README.md) - it only carries what the 3D renderer needs
    (geometry, color, transform). So this is entirely our own addition:
    the sites[] list (straight from the RealGUIDE scene JSON) is embedded
    as a plain JSON <script> block, and implants.js reads it and builds
    its own UI - purely additive, same pattern as ct_panel.py.
    """
    with open(_JS_PATH, "r", encoding="utf-8") as f:
        js = f.read()
    sites_json = json.dumps(sites, ensure_ascii=False).replace("</", "<\\/")
    block = (
        '\n<script type="application/json" id="ep-sites-json">' + sites_json + "</script>\n"
        "<script>\n" + js + "\n</script>\n"
    )
    idx = html.rfind("</body>")
    if idx == -1:
        return html + block
    return html[:idx] + block + html[idx:]
