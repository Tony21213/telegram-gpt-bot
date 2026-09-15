import struct

def write_ctm_raw(vertices, indices, normals=None):
    """vertices: list of (x,y,z) floats. indices: list of (i,j,k) ints. normals: optional list of (x,y,z)."""
    vcount = len(vertices)
    tcount = len(indices)
    flags = 1 if normals is not None else 0
    out = bytearray()
    out += b"OCTM"
    out += struct.pack("<i", 5)            # fileFormat
    out += struct.pack("<i", 5718354)      # compressionMethod RAW
    out += struct.pack("<i", vcount)
    out += struct.pack("<i", tcount)
    out += struct.pack("<i", 0)            # uvMapCount
    out += struct.pack("<i", 0)            # attrMapCount
    out += struct.pack("<i", flags)
    out += struct.pack("<i", 0)            # comment length = 0

    out += b"INDX"
    for tri in indices:
        out += struct.pack("<3i", tri[0], tri[1], tri[2])

    out += b"VERT"
    for v in vertices:
        out += struct.pack("<3f", v[0], v[1], v[2])

    if normals is not None:
        out += b"NORM"
        for nvec in normals:
            out += struct.pack("<3f", nvec[0], nvec[1], nvec[2])

    return bytes(out)


if __name__ == "__main__":
    # simple tetrahedron test
    verts = [(0,0,0), (1,0,0), (0,1,0), (0,0,1)]
    tris = [(0,1,2), (0,1,3), (0,2,3), (1,2,3)]
    data = write_ctm_raw(verts, tris)
    with open("/tmp/test_raw.ctm", "wb") as f:
        f.write(data)
    print("wrote", len(data), "bytes")

    import openctm
    with open("/tmp/test_raw.ctm", "rb") as f:
        result = openctm.load_ctm(f)
    print(result["vertices"])
    print(result["faces"])
