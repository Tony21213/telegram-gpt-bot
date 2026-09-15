from ctm_raw import write_ctm_raw


def write_mesh_record(w, vertices, indices, normals, transform_colmajor,
                       color_rgb, opacity, tree_paths, visible=True):
    w.write_bool(False)          # FlatShadingOnly
    w.write_bool(False)          # HasVertexColor
    w.write_bool(False)          # HasTexture
    w.write_color(color_rgb)     # ambient (discarded by reader, but must be present)
    w.write_color(color_rgb)     # diffuse
    w.write_color((191, 191, 191))  # specular
    w.write_color((0, 0, 0))        # emissive
    w.write_float(opacity)       # "o" fallback opacity
    w.write_float(1.0)           # shininess
    w.write_float(0.0)           # discarded float
    w.write_color((255, 255, 0))    # SelectColor (highlight color)
    w.write_float(0.0)           # polygonOffset raw
    w.write_matrix_colmajor(transform_colmajor)
    ctm_bytes = write_ctm_raw(vertices, indices, normals)
    w.write_ctm(ctm_bytes)
    w.write_image_none()         # HasTexture=False -> readImage(null) just reads int(0)
    w.write_float(opacity)       # actual opacity value used by createMaterial
    w.write_tree_paths(tree_paths)
    w.write_bool(visible)        # version > 2
    w.write_bool(False)          # wireframe activated (version > 4)
    w.write_bool(False)          # point cloud activated (version > 4)
