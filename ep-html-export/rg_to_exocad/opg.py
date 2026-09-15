import os

_JS_PATH = os.path.join(os.path.dirname(__file__), "opg.js")


def inject_opg_panel(html):
    """Adds panoramic (OPG-style) reconstruction from the CT volume: a
    curved-MPR "unwrap" along an arch curve (auto-guessed from implant
    sites or the volume bounding box, then draggable), reusing the same
    D3DV volume ct_panel.js already decoded (window.__EP_CT__.getVolume/
    sampleHu). Requires CT data, so only injected alongside ct_panel.py.
    """
    with open(_JS_PATH, "r", encoding="utf-8") as f:
        js = f.read()
    block = "\n<script>\n" + js + "\n</script>\n"
    idx = html.rfind("</body>")
    if idx == -1:
        return html + block
    return html[:idx] + block + html[idx:]
