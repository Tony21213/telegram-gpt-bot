import os
import re

_JS_PATH = os.path.join(os.path.dirname(__file__), "ct_panel.js")


def extract_vol_b64_from_rg_html(rg_html_path):
    """Pulls the raw gzip+base64 #d3d-vol-payload text straight out of a
    RealGUIDE HTML export, unmodified (no re-encoding needed - the exocad
    CT panel decodes it client-side the same way RealGUIDE's own viewer does).
    """
    with open(rg_html_path, "r", encoding="utf-8", errors="replace") as f:
        html = f.read()
    m = re.search(r'<script[^>]*id="d3d-vol-payload"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        raise RuntimeError(f"no #d3d-vol-payload script found in {rg_html_path}")
    return m.group(1).strip()


def inject_ct_panel(html, vol_b64):
    """Adds a floating CT (axial/coronal/sagittal) viewer window to an
    exocad webview HTML, wired to the real 3D view via raycasting: clicking
    a picked point on the model re-centers the CT slices there.

    Purely additive - does not touch exocad's own (plain-text but minified)
    engine code, only appends new DOM/CSS/JS before </body>. The volume data
    is embedded as a separate non-JS <script> block (its base64 text has
    line breaks that would be invalid inside a JS string literal), read via
    .textContent, exactly like RealGUIDE's own viewer does it.
    """
    with open(_JS_PATH, "r", encoding="utf-8") as f:
        js = f.read()
    block = (
        '\n<script type="application/octet-stream" id="ep-ct-vol-b64">'
        + vol_b64
        + "</script>\n<script>\n" + js + "\n</script>\n"
    )
    idx = html.rfind("</body>")
    if idx == -1:
        return html + block
    return html[:idx] + block + html[idx:]
