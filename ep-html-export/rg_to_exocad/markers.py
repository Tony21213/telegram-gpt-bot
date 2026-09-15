import os

_JS_PATH = os.path.join(os.path.dirname(__file__), "markers.js")


def inject_markers_panel(html):
    """Adds click-to-place colored comment markers on the 3D model (a
    floating list panel + SVG pin overlay). Independent of any per-case
    data (unlike the implant/CT panels), so it's always injected.
    """
    with open(_JS_PATH, "r", encoding="utf-8") as f:
        js = f.read()
    block = "\n<script>\n" + js + "\n</script>\n"
    idx = html.rfind("</body>")
    if idx == -1:
        return html + block
    return html[:idx] + block + html[idx:]
