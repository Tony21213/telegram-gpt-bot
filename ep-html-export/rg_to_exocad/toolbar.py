import os

_JS_PATH = os.path.join(os.path.dirname(__file__), "toolbar.js")


def inject_toolbar(html):
    """Adds the shared right-side vertical icon dock (window.epGetToolDock /
    epAddDockButton) that ct_panel.js and ruler.js hang their buttons off
    of. Must be injected before those so the dock singleton exists (though
    both lazily create it too, so order isn't actually load-bearing - this
    just keeps the dock's own CSS/markup defined in one place).
    """
    with open(_JS_PATH, "r", encoding="utf-8") as f:
        js = f.read()
    block = "\n<script>\n" + js + "\n</script>\n"
    idx = html.rfind("</body>")
    if idx == -1:
        return html + block
    return html[:idx] + block + html[idx:]
