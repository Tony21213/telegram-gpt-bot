import os

_JS_PATH = os.path.join(os.path.dirname(__file__), "ruler.js")


def inject_ruler(html):
    """Adds a distance-measurement tool to an exocad webview HTML: raycasts
    two clicks on the 3D model and draws a line + distance label as an SVG
    overlay, kept in sync with the camera every frame via camera.project().
    Purely additive, same pattern as ct_panel.py/implants.py.
    """
    with open(_JS_PATH, "r", encoding="utf-8") as f:
        js = f.read()
    block = "\n<script>\n" + js + "\n</script>\n"
    idx = html.rfind("</body>")
    if idx == -1:
        return html + block
    return html[:idx] + block + html[idx:]
