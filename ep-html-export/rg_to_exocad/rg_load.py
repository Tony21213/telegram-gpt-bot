import json
import struct


def load_rg_scene(scene_bin_path):
    with open(scene_bin_path, "rb") as f:
        data = f.read()
    assert data[0:4] == b"D3DS"
    jlen = struct.unpack_from("<I", data, 8)[0]
    header = json.loads(data[12:12 + jlen].decode("utf-8"))
    blob_off = 12 + jlen
    blob_off = (blob_off + 3) & ~3
    blob = data[blob_off:]

    geoms = []
    for g in header.get("geoms", []):
        pos_bytes = blob[g["pos_off"]:g["pos_off"] + g["pos_len"]]
        q = struct.unpack("<%dh" % (g["v"] * 3), pos_bytes)
        ox, oy, oz, s = g["origin"][0], g["origin"][1], g["origin"][2], g["scale"]
        verts = []
        for i in range(0, len(q), 3):
            verts.append((ox + q[i] * s, oy + q[i + 1] * s, oz + q[i + 2] * s))
        idx_bytes = blob[g["idx_off"]:g["idx_off"] + g["idx_len"]]
        if g.get("idx16"):
            raw_idx = struct.unpack("<%dH" % (g["t"] * 3), idx_bytes)
        else:
            raw_idx = struct.unpack("<%dI" % (g["t"] * 3), idx_bytes)
        tris = [tuple(raw_idx[i:i + 3]) for i in range(0, len(raw_idx), 3)]
        geoms.append({"vertices": verts, "indices": tris})

    meshes = []
    for m in header.get("meshes", []):
        g = geoms[m["geom"]]
        meshes.append({
            "id": m["id"],
            "name": m.get("name", m["id"]),
            "kind": m.get("kind", "other"),
            "visible": m.get("visible", True),
            "opacity": m.get("opacity", 1.0),
            "mesh_color": m.get("mesh_color", "#c8c8c8"),
            "transform_rowmajor": m["transform"],
            "vertices": g["vertices"],
            "indices": g["indices"],
        })

    return {"title": header.get("title", ""), "sites": header.get("sites", []), "meshes": meshes}


def hex_to_rgb(hexstr):
    hexstr = hexstr.lstrip("#")
    return tuple(int(hexstr[i:i + 2], 16) for i in (0, 2, 4))


def rowmajor4x4_to_colmajor16(rm):
    # rm: 16 floats, row-major [r0c0,r0c1,r0c2,r0c3, r1c0,...]
    # THREE.Matrix4.elements is column-major: elements[0..3]=col0, etc.
    m = [rm[0:4], rm[4:8], rm[8:12], rm[12:16]]
    col = []
    for c in range(4):
        for r in range(4):
            col.append(m[r][c])
    return col
