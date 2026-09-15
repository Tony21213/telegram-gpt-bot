import struct


class BinaryWriter:
    """Mirrors DentalWebGL's BinaryFileParser (read methods), but for writing.
    All ints/floats are little-endian 4 bytes. Strings are length-prefixed
    (int32 byte length) then raw bytes, padded so the field consumes a
    multiple of 4 bytes total (matches: this.m_Offset += 4*Math.ceil(e/4)).
    """

    def __init__(self):
        self.buf = bytearray()

    def write_bool(self, v):
        self.buf += struct.pack("<i", 1 if v else 0)

    def write_int(self, v):
        self.buf += struct.pack("<i", int(v))

    def write_float(self, v):
        self.buf += struct.pack("<f", float(v))

    def write_string(self, s):
        b = s.encode("utf-8")
        n = len(b)
        self.buf += struct.pack("<i", n)
        self.buf += b
        pad = (4 * ((n + 3) // 4)) - n
        if pad:
            self.buf += b"\x00" * pad

    def write_vector3(self, xyz):
        self.buf += struct.pack("<3f", xyz[0], xyz[1], xyz[2])

    def write_color(self, rgb):
        # 3 bytes RGB (0-255) + 1 padding byte (read as alpha by nobody, but
        # real files use 0xff there - matches RGBA storage).
        r, g, b = (int(round(c)) & 0xFF for c in rgb)
        self.buf += bytes([r, g, b, 0xFF])

    def write_matrix_colmajor(self, elements16):
        self.buf += struct.pack("<16f", *elements16)

    def write_ctm(self, ctm_bytes):
        n = len(ctm_bytes)
        self.buf += struct.pack("<i", n)
        self.buf += ctm_bytes
        pad = (4 * ((n + 3) // 4)) - n
        if pad:
            self.buf += b"\x00" * pad

    def write_image_none(self):
        # readImage(): readInt() length; if 0, no further reads.
        self.write_int(0)

    def write_tree_paths(self, paths):
        # paths: list of (name, (r,g,b))
        self.write_int(len(paths))
        for name, color in paths:
            self.write_string(name)
            self.write_color(color)

    def write_light_default(self):
        self.write_float(1.0)   # AttenuationConstant
        self.write_float(0.0)   # AttenuationLinear
        self.write_float(0.0)   # AttenuationQuadratic
        self.write_vector3((0, 0, 1))  # Direction
        self.write_bool(True)   # Enabled
        self.write_vector3((0, 0, 0))  # Position
        self.write_int(0)       # LightType
        self.write_color((12, 12, 12))     # Ambient
        self.write_color((191, 191, 191))  # Diffuse
        self.write_color((191, 191, 191))  # Specular
        self.write_color((0, 0, 0))        # Emission
        self.write_float(0.6)   # BackSideColorScaling
        self.write_float(1.0)   # Shininess
        self.write_float(1.0)   # WhiteWithVertexColoring

    def write_views(self, views):
        # views: list of (name, elements16_colmajor)
        self.write_int(len(views))
        for name, elements in views:
            self.write_string(name)
            self.write_matrix_colmajor(elements)

    def getvalue(self):
        return bytes(self.buf)
