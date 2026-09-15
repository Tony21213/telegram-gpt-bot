import base64
import re
import sys

from binfmt import BinaryWriter
from rg_load import load_rg_scene, hex_to_rgb, rowmajor4x4_to_colmajor16
from mesh_record import write_mesh_record
from ct_panel import extract_vol_b64_from_rg_html, inject_ct_panel
from implants import inject_implants_panel
from toolbar import inject_toolbar
from mobile_rotate import inject_mobile_rotate

KIND_GROUP_RU = {
    "scan": "Сканы челюстей",
    "teeth": "Зубы",
    "implant": "Импланты",
    "abutment": "Абатменты",
    "sleeve": "Втулки",
    "guide": "Хирургический шаблон",
    "antagonist": "Антагонисты",
    "soft": "Мягкие ткани",
    "bone": "Анатомия",
    "anatomy": "Анатомия",
    "bar": "Балка",
    "waxup": "Воск",
    "pin": "Пины",
    "nerve": "Нерв",
}


def apply_transform(vertex, rm):
    x, y, z = vertex
    return (
        rm[0] * x + rm[1] * y + rm[2] * z + rm[3],
        rm[4] * x + rm[5] * y + rm[6] * z + rm[7],
        rm[8] * x + rm[9] * y + rm[10] * z + rm[11],
    )


def build_m_data(scene, language="russian"):
    w = BinaryWriter()
    version = 6

    w.write_int(version)
    w.write_string(language)
    w.write_bool(False)
    w.write_string("11111111-1111-4111-8111-111111111111")
    w.write_string("22222222-2222-4222-8222-222222222222")
    w.write_string("")  # password check field -> non-encrypted path
    w.write_string("DentalCAD-Version 3.3 Chemnitz Engine build 9512 (2026-01-16)")
    w.write_string("v3.3-9512/64")
    w.write_light_default()
    w.write_image_none()  # no background image
    w.write_views([])     # no custom views

    # Compute bounding sphere center from all mesh world-space vertices.
    minx = miny = minz = float("inf")
    maxx = maxy = maxz = float("-inf")
    for m in scene["meshes"]:
        rm = m["transform_rowmajor"]
        for v in m["vertices"]:
            wx, wy, wz = apply_transform(v, rm)
            minx = min(minx, wx); maxx = max(maxx, wx)
            miny = min(miny, wy); maxy = max(maxy, wy)
            minz = min(minz, wz); maxz = max(maxz, wz)
    cx, cy, cz = (minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2
    radius = max(maxx - minx, maxy - miny, maxz - minz, 10.0)

    # Camera position offset from center. This initial placement is just a
    # starting point - the injected fit_script in inject_into_shell() calls
    # exocad's own CameraManager.setViewMatrix(matrix, CUBE) once the scene
    # has finished loading, which recomputes a properly-framed camera from
    # the real scene bounding box (their own createScene() unconditionally
    # forces camera.fov=1 at the end, and the distance math for that
    # convention lives entirely in their own code, not ours).
    dist = radius * 3
    cam_pos = (cx, cy - dist * 0.6, cz + dist * 0.8)
    up = (0.0, 0.0, 1.0)
    right = (1.0, 0.0, 0.0)
    # IMPORTANT: column 2 (elements[8..10]) is NOT an absolute lookAt point.
    # createScene()'s one-time initial setup treats it as one (via
    # camera.lookAt(a)), but CameraManager.computeEndParameter() - used by
    # every view-switch/zoom-to-fit path (createView, zoomToSphere,
    # setViewMatrix) - reads the exact same field as a *unit direction*
    # vector and multiplies it directly by a computed distance. Writing an
    # absolute scene-center point there (large magnitude) blew the computed
    # camera position up by orders of magnitude. Must be a normalized
    # direction, matching exocad's own convention (e.g. its default views
    # store things like (0,-0.7071,-0.7071) here, not a coordinate).
    dx, dy, dz = (cx - cam_pos[0], cy - cam_pos[1], cz - cam_pos[2])
    dlen = (dx * dx + dy * dy + dz * dz) ** 0.5
    direction = (dx / dlen, dy / dlen, dz / dlen) if dlen > 1e-9 else (0.0, 0.0, -1.0)
    default_view_elems = [
        right[0], right[1], right[2], 0.0,
        up[0], up[1], up[2], 0.0,
        direction[0], direction[1], direction[2], 0.0,
        cam_pos[0], cam_pos[1], cam_pos[2], 1.0,
    ]
    w.write_views([("Default view", default_view_elems)])

    w.write_int(0)  # annotation count

    meshes = scene["meshes"]
    w.write_int(len(meshes))
    for m in meshes:
        # No normals written: exocad's own CTMLoader.createModel() already
        # calls geometry.computeVertexNormals() whenever the CTM file has no
        # "normal" attribute (confirmed by reading their code), so shipping
        # our own is pure redundancy - it roughly doubles the vertex data
        # for identical resulting shading. Dropping it cuts file size a lot.
        colmajor = rowmajor4x4_to_colmajor16(m["transform_rowmajor"])
        color_rgb = hex_to_rgb(m["mesh_color"])
        group = KIND_GROUP_RU.get(m["kind"], "Прочее")
        tree_paths = [(group, (170, 170, 170)), (m["name"], color_rgb)]
        write_mesh_record(
            w,
            vertices=m["vertices"],
            indices=m["indices"],
            normals=None,
            transform_colmajor=colmajor,
            color_rgb=color_rgb,
            opacity=float(m.get("opacity", 1.0)),
            tree_paths=tree_paths,
            visible=bool(m.get("visible", True)),
        )

    return w.getvalue(), (cx, cy, cz, radius)


def inject_into_shell(shell_html_path, m_data_bytes):
    with open(shell_html_path, "r", encoding="utf-8", errors="replace") as f:
        html = f.read()

    b64 = base64.b64encode(m_data_bytes).decode("ascii")
    # NOTE: the source also contains a JS regex literal
    # (/DentalWebGL.m_Data = {"data": "..."}/g inside parseHTMLData) that
    # matches this same textual pattern - it must NOT be touched. The real
    # assignment statement is the LAST occurrence in the file (defined near
    # the end of the script, after all function bodies).
    pattern = re.compile(r'DentalWebGL\.m_Data\s*=\s*\{"data":\s*"(?:[^"\\]|\\.)*"\}')
    matches = list(pattern.finditer(html))
    if len(matches) < 2:
        raise RuntimeError(f"expected at least 2 occurrences (regex literal + real assignment), found {len(matches)}")
    real = matches[-1]
    replacement = 'DentalWebGL.m_Data = {"data": "' + b64 + '"}'
    new_html = html[:real.start()] + replacement + html[real.end():]

    fit_script = """
<script>
(function(){
  function tryFit(){
    var d = window.DentalWebGL;
    if (!d || !d.m_SceneManager) { setTimeout(tryFit, 200); return; }
    var si;
    try { si = d.m_SceneManager.getSceneImport(); } catch(e) { si = null; }
    if (!si || !d.m_DefaultViewImport || typeof si.NumberOfMeshs !== 'number' ||
        si.NumberOfMeshs === 0 || si.NumberOfMeshsLoaded !== si.NumberOfMeshs) { setTimeout(tryFit, 200); return; }
    try {
      // Mutating camera.position directly doesn't stick, and even the
      // animated createView()/startCameraAnimation() path leaves the
      // trackball controls' own internal distance state stale on desktop
      // (that resync only happens in a mobile/tablet-only branch elsewhere).
      // CameraManager.setViewMatrix(matrix, zoomMode) is the one call that
      // also does m_pTrackballControls.setTarget(...) + .update() so the
      // controls' internal state matches the camera we just placed.
      var cmgr = d.m_SceneManager.getCameraManager();
      cmgr.setViewMatrix(d.m_DefaultViewImport.Matrix, 2 /* BOUNDING_ZOOM.CUBE */);
    } catch(e) { console.error('EP fit view failed', e); }
  }
  setTimeout(tryFit, 500);
})();
</script>
"""

    insert_at = real.start() + len(replacement)
    tail = new_html[insert_at:]
    close_tag = tail.find("</script>")
    if close_tag == -1:
        raise RuntimeError("could not find closing </script> after m_Data assignment")
    insert_at = insert_at + close_tag + len("</script>")
    new_html = new_html[:insert_at] + fit_script + new_html[insert_at:]

    return new_html


if __name__ == "__main__":
    # Usage: build_exocad.py <scene.bin> <exocad_shell.html> <output.html> [<realguide_export.html>]
    # The optional 4th argument is a RealGUIDE HTML export to pull the real
    # CT volume (#d3d-vol-payload) from, wiring up a floating CT window in
    # the output that's linked to the exocad 3D view (click a point on the
    # model -> axial/coronal/sagittal slices recenter there).
    scene_bin = sys.argv[1]
    shell_html = sys.argv[2]
    out_path = sys.argv[3]
    rg_html_for_ct = sys.argv[4] if len(sys.argv) > 4 else None

    scene = load_rg_scene(scene_bin)
    print("loaded", len(scene["meshes"]), "meshes from RealGUIDE scene:", scene["title"])
    m_data, bounds = build_m_data(scene)
    print("built m_Data blob:", len(m_data), "bytes; bounds:", bounds)
    html = inject_into_shell(shell_html, m_data)
    html = inject_toolbar(html)

    if scene["sites"]:
        html = inject_implants_panel(html, scene["sites"])
        print("added implant info panel for", len(scene["sites"]), "sites")

    if rg_html_for_ct:
        vol_b64 = extract_vol_b64_from_rg_html(rg_html_for_ct)
        print("extracted CT volume payload:", len(vol_b64), "base64 chars")
        html = inject_ct_panel(html, vol_b64)

    html = inject_mobile_rotate(html)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    print("wrote", out_path)
