(function () {
  const boot = document.getElementById("boot");
  const app = document.getElementById("app");
  const state = {
    scene: null,
    vol: null,
    site: null,
    jaw: "upper",
    tab: "implant",
    rotLong: 0,
    rotAx: 0,
    off: 0,
    zoomLong: 1,
    zoomAx: 1,
    zoomOpg: 1.25,
    panLong: [0, 0],
    panAx: [0, 0],
    contrastLong: 1,
    contrastAx: 1,
    contrastOpg: 1,
    tool: null,
    markerColor: "#ff2d55",
    markerWidth: 6,
    comments: [],
    layers: { ct: true, scan: true, implant: true, pin: true, bone: true, anatomy: true, sleeve: true, shaft: false, abutment: true, analog: true, security: true, thickness: true, teeth: true, nerve: true, guide: true, bar: true, waxup: true, soft: true, antagonist: true, ruler: true, marker: true, comment: true },
    opacity: { scan: 1, bone: 1, anatomy: 1, sleeve: 0.95, shaft: 0.55, security: 0.28, thickness: 0.22, abutment: 0.9, analog: 0.7, teeth: 1, implant: 1, pin: 1, waxup: 0.85, antagonist: 0.4, bar: 1 },
    measurements: [],
    selRuler: null,
    markers: [],
    draft: null,
    drag: null,
    gl: { long: null, ax: null },
    paneMain: "3d",
    paneCt: "cross",
    showRest: true,
    showEdit: true,
    poseLead: "rest",
    editMode: false
  };

  function yieldUi() {
    return new Promise(r => setTimeout(r, 0));
  }

  function setBoot(text) {
    if (boot) boot.textContent = text;
  }

  function b64ToBytesSync(b64) {
    const bin = atob((b64 || "").replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function b64ToBytes(b64, label) {
    const clean = (b64 || "").replace(/\s+/g, "");
    if (!clean) return new Uint8Array(0);
    const chunks = [];
    let total = 0;
    const step = 524288;
    for (let i = 0; i < clean.length; i += step) {
      const bin = atob(clean.slice(i, i + step));
      const part = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) part[j] = bin.charCodeAt(j);
      chunks.push(part);
      total += part.length;
      if (label) setBoot(label + " " + Math.min(99, ((i + step) / clean.length * 100) | 0) + "%");
      await yieldUi();
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const part of chunks) {
      out.set(part, o);
      o += part.length;
    }
    return out;
  }

  function buildHuffTable(lengths) {
    const maxBits = Math.max(0, ...lengths);
    const blCount = new Array(maxBits + 1).fill(0);
    for (const l of lengths) if (l > 0) blCount[l]++;
    const nextCode = new Array(maxBits + 1).fill(0);
    let code = 0;
    for (let bits = 1; bits <= maxBits; bits++) {
      code = (code + blCount[bits - 1]) << 1;
      nextCode[bits] = code;
    }
    const byLen = new Map();
    for (let i = 0; i < lengths.length; i++) {
      const len = lengths[i];
      if (len === 0) continue;
      const c = nextCode[len]++;
      if (!byLen.has(len)) byLen.set(len, new Map());
      byLen.get(len).set(c, i);
    }
    return { byLen, maxBits };
  }
  function InfBitReader(bytes) {
    this.bytes = bytes;
    this.pos = 0;
    this.bitBuf = 0;
    this.bitCnt = 0;
  }
  InfBitReader.prototype.bits = function (n) {
    while (this.bitCnt < n) {
      this.bitBuf |= (this.bytes[this.pos++] | 0) << this.bitCnt;
      this.bitCnt += 8;
    }
    const v = this.bitBuf & ((1 << n) - 1);
    this.bitBuf >>>= n;
    this.bitCnt -= n;
    return v;
  };
  InfBitReader.prototype.align = function () { this.bitBuf = 0; this.bitCnt = 0; };
  function infDecodeSym(br, table) {
    let code = 0, len = 0;
    for (;;) {
      code = (code << 1) | br.bits(1);
      len++;
      const m = table.byLen.get(len);
      if (m) {
        const s = m.get(code);
        if (s !== undefined) return s;
      }
      if (len > table.maxBits) throw new Error("bad huffman code");
    }
  }
  const INF_LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const INF_LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const INF_DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const INF_DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const INF_CLC_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  let INF_FIXED_LIT = null, INF_FIXED_DIST = null;
  function infFixedTables() {
    if (INF_FIXED_LIT) return [INF_FIXED_LIT, INF_FIXED_DIST];
    const litLens = new Array(288);
    for (let i = 0; i < 144; i++) litLens[i] = 8;
    for (let i = 144; i < 256; i++) litLens[i] = 9;
    for (let i = 256; i < 280; i++) litLens[i] = 7;
    for (let i = 280; i < 288; i++) litLens[i] = 8;
    const distLens = new Array(30).fill(5);
    INF_FIXED_LIT = buildHuffTable(litLens);
    INF_FIXED_DIST = buildHuffTable(distLens);
    return [INF_FIXED_LIT, INF_FIXED_DIST];
  }
  function InfOutBuf(sizeHint) {
    this.buf = new Uint8Array(Math.max(64, sizeHint || 65536));
    this.pos = 0;
  }
  InfOutBuf.prototype.ensure = function (extra) {
    const need = this.pos + extra;
    if (need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  };
  InfOutBuf.prototype.push = function (byte) {
    this.ensure(1);
    this.buf[this.pos++] = byte;
  };
  InfOutBuf.prototype.copyBack = function (dist, len) {
    this.ensure(len);
    const b = this.buf;
    const src = this.pos - dist, dst = this.pos;
    for (let k = 0; k < len; k++) b[dst + k] = b[src + k];
    this.pos += len;
  };
  InfOutBuf.prototype.result = function () { return this.buf.subarray(0, this.pos); };

  async function inflateBlockAsync(br, out, litTable, distTable, ys) {
    for (;;) {
      const sym = infDecodeSym(br, litTable);
      if (sym < 256) {
        out.push(sym);
      } else if (sym === 256) {
        return;
      } else {
        const li = sym - 257;
        if (li >= INF_LEN_BASE.length) throw new Error("bad length code");
        const len = INF_LEN_BASE[li] + br.bits(INF_LEN_EXTRA[li]);
        const dsym = infDecodeSym(br, distTable);
        if (dsym >= INF_DIST_BASE.length) throw new Error("bad distance code");
        const dist = INF_DIST_BASE[dsym] + br.bits(INF_DIST_EXTRA[dsym]);
        if (dist > out.pos) throw new Error("bad distance");
        out.copyBack(dist, len);
      }
      if (++ys.n >= 400000) {
        ys.n = 0;
        setBoot(ys.label + " " + Math.min(99, (out.pos / (ys.total || out.pos) * 100) | 0) + "%");
        await yieldUi();
      }
    }
  }
  function infReadDynamicTables(br) {
    const hlit = br.bits(5) + 257;
    const hdist = br.bits(5) + 1;
    const hclen = br.bits(4) + 4;
    const clcLens = new Array(19).fill(0);
    for (let i = 0; i < hclen; i++) clcLens[INF_CLC_ORDER[i]] = br.bits(3);
    const clcTable = buildHuffTable(clcLens);
    const allLens = new Array(hlit + hdist);
    let n = 0;
    while (n < hlit + hdist) {
      const sym = infDecodeSym(br, clcTable);
      if (sym < 16) {
        allLens[n++] = sym;
      } else if (sym === 16) {
        const rep = br.bits(2) + 3;
        const prev = n > 0 ? allLens[n - 1] : 0;
        for (let k = 0; k < rep; k++) allLens[n++] = prev;
      } else if (sym === 17) {
        const rep = br.bits(3) + 3;
        for (let k = 0; k < rep; k++) allLens[n++] = 0;
      } else if (sym === 18) {
        const rep = br.bits(7) + 11;
        for (let k = 0; k < rep; k++) allLens[n++] = 0;
      } else {
        throw new Error("bad code-length symbol");
      }
    }
    return [buildHuffTable(allLens.slice(0, hlit)), buildHuffTable(allLens.slice(hlit, hlit + hdist))];
  }
  async function inflateRawAsync(bytes, sizeHint, label) {
    const br = new InfBitReader(bytes);
    const out = new InfOutBuf(sizeHint);
    const ys = { n: 0, label: label || "Распаковка…", total: sizeHint };
    for (;;) {
      const bfinal = br.bits(1);
      const btype = br.bits(2);
      if (btype === 0) {
        br.align();
        const len = bytes[br.pos] | (bytes[br.pos + 1] << 8);
        br.pos += 4;
        out.ensure(len);
        out.buf.set(bytes.subarray(br.pos, br.pos + len), out.pos);
        out.pos += len;
        br.pos += len;
      } else if (btype === 1) {
        const [lit, dist] = infFixedTables();
        await inflateBlockAsync(br, out, lit, dist, ys);
      } else if (btype === 2) {
        const [lit, dist] = infReadDynamicTables(br);
        await inflateBlockAsync(br, out, lit, dist, ys);
      } else {
        throw new Error("bad block type");
      }
      if (bfinal) break;
    }
    return out.result();
  }
  // Чистый JS-декодер gzip (RFC1951/1952) — fallback для WebView без
  // DecompressionStream (Safari/WKWebView до 16.4, т.е. iOS < 16.4, и
  // некоторые старые сборки Android System WebView). Используется только
  // когда нативный путь недоступен или падает — на современных браузерах
  // всегда идёт быстрый нативный DecompressionStream.
  async function gunzipSyncJs(bytes, label) {
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error("не gzip");
    if (bytes[2] !== 8) throw new Error("неподдерживаемый метод gzip");
    const flg = bytes[3];
    let pos = 10;
    if (flg & 0x04) { const xlen = bytes[pos] | (bytes[pos + 1] << 8); pos += 2 + xlen; }
    if (flg & 0x08) { while (bytes[pos] !== 0) pos++; pos++; }
    if (flg & 0x10) { while (bytes[pos] !== 0) pos++; pos++; }
    if (flg & 0x02) pos += 2;
    const n = bytes.length;
    const isize = (bytes[n - 4] | (bytes[n - 3] << 8) | (bytes[n - 2] << 16) | (bytes[n - 1] << 24)) >>> 0;
    return inflateRawAsync(bytes.subarray(pos, n - 8), isize, label);
  }

  async function gunzipBytes(bytes, label) {
    if (typeof DecompressionStream === "function") {
      try {
        const ds = new DecompressionStream("gzip");
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) { /* нет нативной поддержки в этом WebView — идём в JS-фоллбек */ }
    }
    return gunzipSyncJs(bytes, label);
  }

  function readF32(arr, n) {
    const o = [];
    for (let i = 0; i < n; i++) o.push(arr[i] || 0);
    return o;
  }

  function readI16(raw, pos, count) {
    const bytes = count * 2;
    if (pos + bytes > raw.byteLength) throw new Error("D3D-VOL обрезан");
    if (((raw.byteOffset + pos) & 1) === 0)
      return new Int16Array(raw.buffer, raw.byteOffset + pos, count);
    const copy = new Uint8Array(bytes);
    copy.set(raw.subarray(pos, pos + bytes));
    return new Int16Array(copy.buffer);
  }

  function volFromParts(header, hu) {
    return {
      nx: header.dims[0], ny: header.dims[1], nz: header.dims[2], hu,
      spacing: readF32(header.spacing, 3),
      origin: readF32(header.origin, 3),
      direction: readF32(header.direction, 9),
      window: 2800, level: 600
    };
  }

  function decodeVolumeSlice(header, occ, residuals, hu, start, end, oi) {
    const nx = header.dims[0], ny = header.dims[1];
    const n = hu.length;
    const plane = nx * ny;
    for (let i = start; i < end && i < n; i++) {
      if (((occ[i >> 3] >> (i & 7)) & 1) === 0) continue;
      const z = (i / plane) | 0;
      const rem = i - z * plane;
      const y = (rem / nx) | 0;
      const x = rem - y * nx;
      let pred = 0;
      const hasW = x > 0, hasN = y > 0;
      if (hasW && hasN) {
        const w = ((occ[(i - 1) >> 3] >> ((i - 1) & 7)) & 1) ? hu[i - 1] : -1000;
        const nv = ((occ[(i - nx) >> 3] >> ((i - nx) & 7)) & 1) ? hu[i - nx] : -1000;
        const nw = ((occ[(i - nx - 1) >> 3] >> ((i - nx - 1) & 7)) & 1) ? hu[i - nx - 1] : -1000;
        pred = w + nv - nw;
      } else if (hasW) pred = ((occ[(i - 1) >> 3] >> ((i - 1) & 7)) & 1) ? hu[i - 1] : -1000;
      else if (hasN) pred = ((occ[(i - nx) >> 3] >> ((i - nx) & 7)) & 1) ? hu[i - nx] : -1000;
      else if (z > 0) {
        const p = i - plane;
        pred = ((occ[p >> 3] >> (p & 7)) & 1) ? hu[p] : -1000;
      }
      hu[i] = pred + residuals[oi++];
    }
    return oi;
  }

  function unpackZvar(bytes, count) {
    const out = new Int16Array(count);
    let i = 0;
    for (let o = 0; o < count; o++) {
      let zig = 0, shift = 0, b;
      do {
        b = bytes[i++];
        zig |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80);
      out[o] = (zig >>> 1) ^ -(zig & 1);
    }
    return out;
  }

  function parseVolumeRaw(raw) {
    const magic = String.fromCharCode(raw[0], raw[1], raw[2], raw[3]);
    if (magic !== "D3DV") throw new Error("Неверный D3D-VOL");
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const ver = dv.getInt32(4, true);
    const headerLen = dv.getInt32(8, true);
    const header = JSON.parse(new TextDecoder().decode(raw.subarray(12, 12 + headerLen)));
    const n = header.dims[0] * header.dims[1] * header.dims[2];
    const occLen = Math.ceil(n / 8);
    const pos = 12 + headerLen;
    const occ = raw.subarray(pos, pos + occLen);
    const packed = ver >= 2 || header.res === "zvar";
    const residuals = packed
      ? unpackZvar(raw.subarray(pos + occLen), header.occupied | 0)
      : readI16(raw, pos + occLen, header.occupied | 0);
    const hu = new Int16Array(n);
    hu.fill(-1000);
    return { header, occ, residuals, hu };
  }

  async function decodeVolumeFixed(raw) {
    const parsed = parseVolumeRaw(raw);
    const n = parsed.hu.length;
    const slice = Math.max(1, (n / 32) | 0);
    let oi = 0;
    for (let start = 0; start < n; start += slice) {
      oi = decodeVolumeSlice(parsed.header, parsed.occ, parsed.residuals, parsed.hu, start, start + slice, oi);
      setBoot("Сборка КТ… " + Math.min(99, ((start + slice) / n * 100) | 0) + "%");
      await yieldUi();
    }
    return volFromParts(parsed.header, parsed.hu);
  }

  async function decodeVolumeInWorker(bytes) {
    const src = `
      self.onmessage = async (ev) => {
        try {
          const bytes = new Uint8Array(ev.data);
          const ds = new DecompressionStream("gzip");
          const raw = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
          const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
          const ver = dv.getInt32(4, true);
          const headerLen = dv.getInt32(8, true);
          const header = JSON.parse(new TextDecoder().decode(raw.subarray(12, 12 + headerLen)));
          const nx = header.dims[0], ny = header.dims[1], nz = header.dims[2];
          const n = nx * ny * nz;
          const plane = nx * ny;
          const occLen = (n + 7) >> 3;
          let pos = 12 + headerLen;
          const occ = raw.subarray(pos, pos + occLen);
          pos += occLen;
          const occCount = header.occupied | 0;
          let residuals;
          if (ver >= 2 || header.res === "zvar") {
            residuals = new Int16Array(occCount);
            let i = pos;
            for (let o = 0; o < occCount; o++) {
              let zig = 0, shift = 0, b;
              do { b = raw[i++]; zig |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
              residuals[o] = (zig >>> 1) ^ -(zig & 1);
            }
          } else if (((raw.byteOffset + pos) & 1) === 0) residuals = new Int16Array(raw.buffer, raw.byteOffset + pos, occCount);
          else {
            const copy = new Uint8Array(occCount * 2);
            copy.set(raw.subarray(pos, pos + occCount * 2));
            residuals = new Int16Array(copy.buffer);
          }
          const hu = new Int16Array(n);
          hu.fill(-1000);
          let oi = 0;
          const reportEvery = Math.max(plane, (n / 20) | 0);
          for (let i = 0; i < n; i++) {
            if (((occ[i >> 3] >> (i & 7)) & 1) === 0) continue;
            const z = (i / plane) | 0;
            const rem = i - z * plane;
            const y = (rem / nx) | 0;
            const x = rem - y * nx;
            let pred = 0;
            if (x > 0 && y > 0) {
              const a = i - 1, b = i - nx, c = i - nx - 1;
              const w = ((occ[a >> 3] >> (a & 7)) & 1) ? hu[a] : -1000;
              const nv = ((occ[b >> 3] >> (b & 7)) & 1) ? hu[b] : -1000;
              const nw = ((occ[c >> 3] >> (c & 7)) & 1) ? hu[c] : -1000;
              pred = w + nv - nw;
            } else if (x > 0) pred = ((occ[(i - 1) >> 3] >> ((i - 1) & 7)) & 1) ? hu[i - 1] : -1000;
            else if (y > 0) pred = ((occ[(i - nx) >> 3] >> ((i - nx) & 7)) & 1) ? hu[i - nx] : -1000;
            else if (z > 0) {
              const p = i - plane;
              pred = ((occ[p >> 3] >> (p & 7)) & 1) ? hu[p] : -1000;
            }
            hu[i] = pred + residuals[oi++];
            if ((i % reportEvery) === 0) self.postMessage({ p: i / n });
          }
          self.postMessage({ header, hu: hu.buffer }, [hu.buffer]);
        } catch (err) {
          self.postMessage({ error: String(err && err.message ? err.message : err) });
        }
      };
    `;
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error("timeout"));
      }, 180000);
      worker.onmessage = ev => {
        if (ev.data && ev.data.p != null) {
          setBoot("Распаковка КТ… " + ((ev.data.p * 100) | 0) + "%");
          return;
        }
        clearTimeout(timer);
        worker.terminate();
        if (ev.data && ev.data.error) {
          reject(new Error(ev.data.error));
          return;
        }
        resolve(volFromParts(ev.data.header, new Int16Array(ev.data.hu)));
      };
      worker.onerror = e => {
        clearTimeout(timer);
        worker.terminate();
        reject(e);
      };
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      worker.postMessage(copy, [copy]);
    });
  }

  function decodeMeshes(scene) {
    for (const m of scene.meshes || []) {
      const b = m.buffers || {};
      if (!b.positions_b64) continue;
      const pb = b64ToBytesSync(b.positions_b64);
      const ib = b.indices_b64 ? b64ToBytesSync(b.indices_b64) : null;
      m._pos = new Float32Array(pb.buffer, pb.byteOffset, pb.byteLength / 4);
      m._idx = ib ? new Int32Array(ib.buffer, ib.byteOffset, ib.byteLength / 4) : null;
      if (b.marker_colors_b64) {
        const cb = b64ToBytesSync(b.marker_colors_b64);
        m._mark = new Uint8Array(cb.buffer, cb.byteOffset, cb.byteLength);
      }
    }
  }

  function typedCopy(Ctor, bytes, count, elem) {
    if (((bytes.byteOffset) & (elem - 1)) === 0)
      return new Ctor(bytes.buffer, bytes.byteOffset, count);
    const copy = new Uint8Array(count * elem);
    copy.set(bytes.subarray(0, count * elem));
    return new Ctor(copy.buffer);
  }

  // D3D-SCENE-PACK
  function attachPackedGeoms(scene, blob) {
    const cache = [];
    for (const g of scene.geoms || []) {
      const posBytes = blob.subarray(g.pos_off, g.pos_off + g.pos_len);
      const q = typedCopy(Int16Array, posBytes, g.v * 3, 2);
      const pos = new Float32Array(g.v * 3);
      const ox = g.origin[0], oy = g.origin[1], oz = g.origin[2], s = g.scale;
      for (let i = 0; i < q.length; i += 3) {
        pos[i] = ox + q[i] * s;
        pos[i + 1] = oy + q[i + 1] * s;
        pos[i + 2] = oz + q[i + 2] * s;
      }
      const idxBytes = blob.subarray(g.idx_off, g.idx_off + g.idx_len);
      let idx;
      if (g.idx16) {
        const u = typedCopy(Uint16Array, idxBytes, g.t * 3, 2);
        idx = new Int32Array(u.length);
        idx.set(u);
      } else {
        idx = typedCopy(Int32Array, idxBytes, g.t * 3, 4);
      }
      cache.push({ pos, idx });
    }
    for (const m of scene.meshes || []) {
      const g = cache[m.geom];
      if (!g) continue;
      m._pos = g.pos;
      m._idx = g.idx;
    }
  }

  function parseSceneBytes(bytes) {
    if (bytes.length >= 12 && bytes[0] === 0x44 && bytes[1] === 0x33 && bytes[2] === 0x44 && bytes[3] === 0x53) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const jsonLen = dv.getUint32(8, true);
      const scene = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + jsonLen)));
      let blobOff = 12 + jsonLen;
      blobOff = (blobOff + 3) & ~3;
      attachPackedGeoms(scene, bytes.subarray(blobOff));
      applyJawOpaqueDefault(scene);
      return scene;
    }
    const scene = JSON.parse(new TextDecoder().decode(bytes));
    decodeMeshes(scene);
    applyJawOpaqueDefault(scene);
    return scene;
  }

  function applyJawOpaqueDefault(scene) {
    for (const m of scene.meshes || []) {
      if (m.kind === "anatomy" || m.kind === "scan" || m.kind === "bone" || m.kind === "teeth")
        m.opacity = 1;
    }
  }

  function xfm(m, x, y, z) {
    if (!m || m.length < 16) return [x, y, z];
    return [
      m[0] * x + m[1] * y + m[2] * z + m[3],
      m[4] * x + m[5] * y + m[6] * z + m[7],
      m[8] * x + m[9] * y + m[10] * z + m[11]
    ];
  }

  function drawRulerHandle(ctx, x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#00f6ff";
    ctx.fill();
  }

  function drawRulerSeg(ctx, pa, pb, label, selected) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pa[0], pa[1]);
    ctx.lineTo(pb[0], pb[1]);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = selected ? 8 : 6;
    ctx.stroke();
    ctx.strokeStyle = selected ? "#fff200" : "#00f6ff";
    ctx.lineWidth = selected ? 3.4 : 2.8;
    ctx.stroke();
    drawRulerHandle(ctx, pa[0], pa[1]);
    drawRulerHandle(ctx, pb[0], pb[1]);
    if (!label) return;
    const mx = (pa[0] + pb[0]) / 2;
    const my = (pa[1] + pb[1]) / 2;
    ctx.font = "700 13px system-ui, Segoe UI, sans-serif";
    const tw = ctx.measureText(label).width;
    const pad = 5;
    ctx.fillStyle = "rgba(0,0,0,0.82)";
    ctx.fillRect(mx - tw / 2 - pad, my - 18, tw + pad * 2, 18);
    ctx.fillStyle = "#fff200";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, mx, my - 9);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  function markerPts(k) {
    if (k.pts && k.pts.length) return k.pts;
    if (k.x != null) return [[k.x, k.y, k.z]];
    return null;
  }

  function drawMarkerStrokes(ctx, plane, w, h) {
    const maxDist = 1.4;
    for (const k of state.markers) {
      const pts = markerPts(k);
      if (!pts) continue;
      if (distToPlane(plane, pts[0]) > maxDist) continue;
      const color = k.color || state.markerColor || "#ff2d55";
      const width = k.width || state.markerWidth || 6;
      const on = pts.map(p => worldToCanvas(plane, w, h, p));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (on.length === 1) {
        ctx.beginPath();
        ctx.arc(on[0][0], on[0][1], width * 0.55 + 2, 0, Math.PI * 2);
        ctx.fillStyle = "#000";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(on[0][0], on[0][1], width * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(on[0][0], on[0][1]);
      for (let i = 1; i < on.length; i++) ctx.lineTo(on[i][0], on[i][1]);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = width + 3;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }

  function worldToIjk(vol, x, y, z) {
    const dx = x - vol.origin[0], dy = y - vol.origin[1], dz = z - vol.origin[2];
    const d = vol.direction;
    return [
      (dx * d[0] + dy * d[1] + dz * d[2]) / vol.spacing[0],
      (dx * d[3] + dy * d[4] + dz * d[5]) / vol.spacing[1],
      (dx * d[6] + dy * d[7] + dz * d[8]) / vol.spacing[2]
    ];
  }

  function norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function add(a, b, s) { return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]; }
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function rotAround(axis, angle, vec) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const ax = norm(axis);
    const d = ax[0] * vec[0] + ax[1] * vec[1] + ax[2] * vec[2];
    const cr = cross(ax, vec);
    return [
      vec[0] * c + cr[0] * s + ax[0] * d * (1 - c),
      vec[1] * c + cr[1] * s + ax[1] * d * (1 - c),
      vec[2] * c + cr[2] * s + ax[2] * d * (1 - c)
    ];
  }

  function rotPoint(p, axis, ang, pivot) {
    const d = sub3(p, pivot);
    const r = rotAround(axis, ang, d);
    return [r[0] + pivot[0], r[1] + pivot[1], r[2] + pivot[2]];
  }

  function rotateTransform(m, axis, ang, pivot) {
    if (!m || m.length < 16) return m;
    const u = rotAround(axis, ang, [m[0], m[4], m[8]]);
    const t = rotAround(axis, ang, [m[1], m[5], m[9]]);
    const n = rotAround(axis, ang, [m[2], m[6], m[10]]);
    const w = rotPoint([m[3], m[7], m[11]], axis, ang, pivot);
    return [
      u[0], t[0], n[0], w[0],
      u[1], t[1], n[1], w[1],
      u[2], t[2], n[2], w[2],
      0, 0, 0, 1
    ];
  }

  function snapshotEdits() {
    for (const s of (state.scene && state.scene.sites) || []) {
      if (s.kind !== "implant" && s.kind !== "pin") continue;
      s._rest = {
        origin: (s.origin || [0, 0, 0]).slice(),
        axis: (s.axis || [0, 0, 1]).slice(),
        mesial: (s.mesial || [1, 0, 0]).slice(),
        mu_origin: s.mu_origin ? s.mu_origin.slice() : null,
        mu_axis: s.mu_axis ? s.mu_axis.slice() : null
      };
    }
    for (const m of (state.scene && state.scene.meshes) || []) {
      if (m.transform) m._restT = m.transform.slice();
    }
    syncSaveBtn();
  }

  function siteIsEdited(s) {
    const r = s && s._rest;
    if (!r || !s.origin || !s.axis) return false;
    const d = Math.hypot(s.origin[0] - r.origin[0], s.origin[1] - r.origin[1], s.origin[2] - r.origin[2]);
    const c = Math.max(-1, Math.min(1, dot3(norm(s.axis), norm(r.axis))));
    if (d > 0.05 || Math.acos(c) * 180 / Math.PI > 0.05) return true;
    if (r.mesial && s.mesial) {
      const mc = Math.max(-1, Math.min(1, dot3(norm(s.mesial), norm(r.mesial))));
      if (Math.acos(mc) * 180 / Math.PI > 0.15) return true;
    }
    const mesh = primarySiteMesh(s);
    if (mesh && mesh.transform && mesh._restT) {
      const t0 = [mesh._restT[0], mesh._restT[4], mesh._restT[8]];
      const t1 = [mesh.transform[0], mesh.transform[4], mesh.transform[8]];
      const tc = Math.max(-1, Math.min(1, dot3(norm(t0), norm(t1))));
      if (Math.acos(tc) * 180 / Math.PI > 0.15) return true;
    }
    return false;
  }

  function editedSites() {
    return ((state.scene && state.scene.sites) || []).filter(s =>
      (s.kind === "implant" || s.kind === "pin") && siteIsEdited(s));
  }

  function restoreSite(site) {
    const r = site && site._rest;
    if (!r) return;
    site.origin = r.origin.slice();
    site.axis = (r.axis || [0, 0, 1]).slice();
    if (r.mesial) site.mesial = r.mesial.slice();
    site.mu_origin = r.mu_origin ? r.mu_origin.slice() : site.mu_origin;
    site.mu_axis = r.mu_axis ? r.mu_axis.slice() : site.mu_axis;
    for (const m of siteChildren(site)) {
      if (!m._restT) continue;
      m.transform = m._restT.slice();
      dirtyMesh(m);
    }
    site._viewFrame = frameFromSite(site);
  }

  function afterReset(msg) {
    syncSaveBtn();
    toastEdit(msg);
    renderMpr();
    renderOpg();
    render3d();
  }

  function resetSelected() {
    const s = state.site;
    if (!s || (s.kind !== "implant" && s.kind !== "pin")) {
      toastEdit("Не выбран имплант/пин");
      return;
    }
    if (!siteIsEdited(s)) {
      toastEdit("Нет правок у выбранного");
      return;
    }
    restoreSite(s);
    afterReset("Сброшен выбранный");
  }

  function resetEdits() {
    const sites = editedSites();
    if (!sites.length) {
      toastEdit("Нет правок");
      return;
    }
    for (const s of sites) restoreSite(s);
    state._hadEdits = false;
    state.poseLead = "rest";
    state.showEdit = true;
    afterReset("Сброшено всё");
  }

  const POSE_REST_RGB = [80, 170, 255];
  const POSE_EDIT_RGB = [255, 90, 40];

  function canEditPose() {
    return !!state.editMode && (poseView().edit || !poseView().has);
  }

  function setEditMode(on) {
    state.editMode = !!on;
    if (app) app.classList.toggle("edit-on", state.editMode);
    if (state.editMode && editedSites().length)
      state.poseLead = state.poseLead === "rest" && state.showRest !== false ? state.poseLead : "edit";
    syncPoseBtns();
    renderMpr();
    renderOpg();
    render3d();
  }

  function poseView() {
    const has = editedSites().length > 0;
    const rest = state.showRest !== false;
    const edit = has && state.showEdit !== false;
    let lead = state.poseLead === "rest" ? "rest" : "edit";
    if (rest && !edit) lead = "rest";
    if (edit && !rest) lead = "edit";
    if (!rest && !edit) lead = "rest";
    return { has, rest, edit, both: rest && edit, lead };
  }

  function leadPoseOf(site) {
    if (!site) return null;
    const pv = poseView();
    if (pv.lead === "rest" && site._rest && site._rest.origin && site._rest.axis)
      return {
        origin: site._rest.origin.slice(),
        axis: site._rest.axis.slice(),
        mesial: (site._rest.mesial || site.mesial || [1, 0, 0]).slice()
      };
    if (site.origin && site.axis)
      return {
        origin: site.origin.slice(),
        axis: site.axis.slice(),
        mesial: (site.mesial || [1, 0, 0]).slice()
      };
    return frameFromSite(site);
  }

  function isSitePart(m) {
    return !!m && (m.kind === "implant" || m.kind === "pin" || m.kind === "sleeve" || m.kind === "shaft" || m.kind === "abutment");
  }

  function planningPasses(m) {
    if (!isSitePart(m)) return [{ tr: m.transform, rgb: null, rest: false }];
    const pv = poseView();
    const site = siteOfMesh(m);
    const edited = !!(site && siteIsEdited(site));
    if (pv.both && edited) {
      return [
        { tr: m._restT || m.transform, rgb: POSE_REST_RGB, rest: true },
        { tr: m.transform, rgb: POSE_EDIT_RGB, rest: false }
      ];
    }
    if (pv.has && pv.rest && !pv.edit)
      return [{ tr: (edited && m._restT) ? m._restT : m.transform, rgb: null, rest: true }];
    return [{ tr: m.transform, rgb: null, rest: false }];
  }

  function siteChildren(site) {
    return ((state.scene && state.scene.meshes) || []).filter(m => meshBelongsToSite(m, site));
  }

  function primarySiteMesh(site) {
    const kids = siteChildren(site);
    return kids.find(m => m.kind === site.kind) || kids.find(m => m.kind === "implant" || m.kind === "pin") || kids[0] || null;
  }

  function dirtyMesh(m) {
    m._box = null;
    m._gl = null;
    m._glOpg = null;
  }

  function applySitePose(site, origin, axis, mesial, xforms) {
    site.origin = origin.slice();
    site.axis = norm(axis);
    if (mesial) site.mesial = norm(mesial);
    for (const row of xforms) {
      row.m.transform = row.t.slice();
      dirtyMesh(row.m);
    }
  }

  function captureSitePose(site) {
    return {
      origin: site.origin.slice(),
      axis: (site.axis || [0, 0, 1]).slice(),
      mesial: (site.mesial || [1, 0, 0]).slice(),
      xforms: siteChildren(site).filter(m => m.transform).map(m => ({ m, t: m.transform.slice() }))
    };
  }

  function translateSite(site, delta) {
    site.origin = add(site.origin, delta, 1);
    if (site.mu_origin) site.mu_origin = add(site.mu_origin, delta, 1);
    for (const m of siteChildren(site)) {
      if (!m.transform) continue;
      m.transform[3] += delta[0];
      m.transform[7] += delta[1];
      m.transform[11] += delta[2];
      dirtyMesh(m);
    }
  }

  function rotateSite(site, axis, ang, pivot) {
    if (Math.abs(ang) < 1e-8) return;
    site.origin = rotPoint(site.origin, axis, ang, pivot);
    site.axis = rotAround(axis, ang, site.axis);
    if (site.mesial) site.mesial = rotAround(axis, ang, site.mesial);
    if (site.mu_origin) site.mu_origin = rotPoint(site.mu_origin, axis, ang, pivot);
    if (site.mu_axis) site.mu_axis = rotAround(axis, ang, site.mu_axis);
    for (const m of siteChildren(site)) {
      if (!m.transform) continue;
      m.transform = rotateTransform(m.transform, axis, ang, pivot);
      dirtyMesh(m);
    }
  }

  function siteAxisSpan(site) {
    const mesh = primarySiteMesh(site);
    const ax = norm(site.axis || [0, 0, 1]);
    const o = site.origin;
    let t0 = -8, t1 = 8, haveMesh = false;
    if (mesh && mesh._pos) {
      const src = mesh._pos, tr = mesh.transform;
      const n = src.length / 3;
      const step = Math.max(1, Math.floor(n / 5000));
      t0 = 1e9;
      t1 = -1e9;
      for (let i = 0; i < n; i += step) {
        const p = xfm(tr, src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
        const t = (p[0] - o[0]) * ax[0] + (p[1] - o[1]) * ax[1] + (p[2] - o[2]) * ax[2];
        if (t < t0) t0 = t;
        if (t > t1) t1 = t;
      }
      if (t0 > t1) { t0 = -8; t1 = 8; } else { haveMesh = true; }
    }
    // site.origin — коронковая (платформенная) точка импланта: mesh.transform
    // помещает локальный (0,0,0) сетки импланта именно туда, поэтому один из
    // проекционных экстремумов всегда лежит у t≈0. Знак site.axis при этом не
    // стандартизован (зависит от библиотеки импланта/челюсти), так что нельзя
    // жёстко считать t0=apex/t1=crown — берём ближний к 0 конец как crown,
    // дальний как apex.
    let apexT = t0, crownT = t1;
    if (haveMesh) {
      if (Math.abs(t1) < Math.abs(t0)) { apexT = t0; crownT = t1; }
      else { apexT = t1; crownT = t0; }
    }
    return { t0, t1, apex: add(o, ax, apexT), crown: add(o, ax, crownT), mid: o.slice(), axis: ax };
  }

  function muAxisUp(s) {
    let mu = norm(s.mu_axis || s.axis || [0, 0, 1]);
    const ax = norm(s.axis || mu);
    if (dot3(mu, ax) < 0) mu = [-mu[0], -mu[1], -mu[2]];
    return mu;
  }

  function siteMesial(site) {
    const axis = norm(site.axis || [0, 0, 1]);
    let mes = site.mesial && Math.hypot(site.mesial[0], site.mesial[1], site.mesial[2]) > 1e-5
      ? site.mesial : cross(axis, [0, 0, 1]);
    mes = add(mes, axis, -dot3(mes, axis));
    if (Math.hypot(mes[0], mes[1], mes[2]) < 1e-5) mes = cross(axis, [1, 0, 0]);
    return norm(mes);
  }

  function rejectAxis(v, axis) {
    const a = norm(axis);
    return add(v, a, -dot3(v, a));
  }

  function gizmoPoints(site) {
    const span = siteAxisSpan(site);
    const mes = siteMesial(site);
    const padApex = 7.2;
    const padCrown = 5.5;
    // Направление "апекс → коронка" по реальной геометрии (не сырой
    // span.axis — знак site.axis не стандартизован, см. фикс красной
    // трубки) — выносим хендлы за пределы импланта вдоль него.
    const outX = span.crown[0] - span.apex[0], outY = span.crown[1] - span.apex[1], outZ = span.crown[2] - span.apex[2];
    const outLen = Math.hypot(outX, outY, outZ);
    const outDir = outLen > 1e-6 ? [outX / outLen, outY / outLen, outZ / outLen] : span.axis;
    // Хендл tiltApex тянет апекс — пивот в короне (шейка/коронка остаётся
    // на месте); tiltCrown тянет коронку — пивот в апексе (апекс остаётся
    // на месте). Раньше оба крутили вокруг середины (span.mid) — двигались
    // ОБА конца сразу, а не один при зафиксированном другом.
    return [
      { kind: "move", p: span.mid },
      { kind: "tiltApex", p: add(span.apex, outDir, -padApex), pivot: span.crown.slice() },
      { kind: "tiltCrown", p: add(span.crown, outDir, padCrown), pivot: span.apex.slice() },
      { kind: "spin", p: add(span.mid, mes, 8), pivot: span.mid.slice(), axis: span.axis.slice() }
    ];
  }

  function projectOnPlane(p, origin, right, up) {
    const d = sub3(p, origin);
    return add(add(origin, right, dot3(d, right)), up, dot3(d, up));
  }

  function signedAngle(a, b, n) {
    const ax = norm(a), bx = norm(b);
    const c = Math.max(-1, Math.min(1, dot3(ax, bx)));
    const cr = cross(ax, bx);
    return Math.atan2(dot3(cr, n), c);
  }

  function drawGizmoKnob(ctx, x, y, kind, hot) {
    const r = (kind === "move" ? 11 : 10) + (isMobileLayout() ? 3 : 0);
    const spin = kind === "spin";
    ctx.beginPath();
    ctx.arc(x, y, r + 1.2, 0, Math.PI * 2);
    ctx.fillStyle = "#111";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = kind === "move" ? (hot ? "#fff" : "#f2f2f2")
      : spin ? (hot ? "#ffd36a" : "#f0b429")
      : (hot ? "#7dff6a" : "#3dcf3a");
    ctx.fill();
    ctx.strokeStyle = kind === "move" ? "#333" : spin ? "#7a5a10" : "#145c14";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.strokeStyle = kind === "move" ? "#222" : spin ? "#5a4208" : "#0d3d0d";
    ctx.fillStyle = kind === "move" ? "#222" : spin ? "#5a4208" : "#0d3d0d";
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    if (kind === "move") {
      ctx.beginPath();
      ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y);
      ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
      ctx.stroke();
    } else if (spin) {
      ctx.beginPath();
      ctx.arc(x, y, 3.8, 0.15, Math.PI * 1.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 3.8, Math.PI + 0.15, Math.PI * 2.1);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0.4, Math.PI * 1.55);
      ctx.stroke();
    }
  }

  function drawSiteGizmos(ctx, w, h, plane, kinds) {
    const s = state.site;
    if (!s || !s.origin || !s.axis) return;
    if ((s.kind === "implant" && state.layers.implant === false) || (s.kind === "pin" && state.layers.pin === false))
      return;
    const pts = gizmoPoints(s).filter(g => !kinds || kinds.indexOf(g.kind) >= 0);
    const span = siteAxisSpan(s);
    const a = worldToCanvas(plane, w, h, span.apex);
    const b = worldToCanvas(plane, w, h, span.crown);
    const c = worldToCanvas(plane, w, h, span.mid);
    const side = add(span.mid, plane.right, 10);
    const d = worldToCanvas(plane, w, h, side);
    ctx.strokeStyle = "rgba(220,40,40,0.95)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c[0] - (d[0] - c[0]), c[1] - (d[1] - c[1]));
    ctx.lineTo(d[0], d[1]);
    ctx.stroke();
    const spin = pts.find(g => g.kind === "spin");
    if (spin) {
      const sp = worldToCanvas(plane, w, h, spin.p);
      const rr = Math.hypot(sp[0] - c[0], sp[1] - c[1]);
      if (rr > 6) {
        ctx.beginPath();
        ctx.arc(c[0], c[1], rr, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(240,180,41,0.7)";
        ctx.lineWidth = 1.3;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    const hot = state.drag && state.drag.gizmo ? state.drag.kind : null;
    // Иконки move/tilt/spin на срезах "Вдоль"/"Поперёк" — полупрозрачные
    // (30% от прежней непрозрачности), как раньше было сделано для 3D-вида
    // (там теперь убраны совсем — см. drawGizmos3d) — меньше перекрывают КТ.
    ctx.save();
    ctx.globalAlpha = (ctx.globalAlpha || 1) * 0.3;
    for (const g of pts)
      drawGizmoKnob(ctx, ...worldToCanvas(plane, w, h, g.p), g.kind, hot === g.kind);
    ctx.restore();
  }

  function hitGizmoOnPlane(plane, w, h, x, y, kinds) {
    const s = state.site;
    if (!s || !s.origin) return null;
    let best = null, bestD = isMobileLayout() ? 28 : 14;
    for (const g of gizmoPoints(s)) {
      if (kinds && kinds.indexOf(g.kind) < 0) continue;
      const c = worldToCanvas(plane, w, h, g.p);
      const d = Math.hypot(c[0] - x, c[1] - y);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best ? { ...best, site: s } : null;
  }

  function frameFromSite(site) {
    if (!site || !site.origin || !site.axis) return null;
    const axis = norm(site.axis);
    const mes0 = site.mesial && Math.hypot(site.mesial[0], site.mesial[1], site.mesial[2]) > 1e-5
      ? norm(site.mesial) : norm(cross(axis, [0, 0, 1]));
    return { origin: site.origin.slice(), axis: axis.slice(), mesial: mes0.slice() };
  }

  function siteViewFrame(site) {
    if (!site) return null;
    if (!site._viewFrame) site._viewFrame = frameFromSite(site);
    return site._viewFrame;
  }

  function mesialOnAxis(mes, axis) {
    const a = norm(axis);
    let m = mes && Math.hypot(mes[0], mes[1], mes[2]) > 1e-5 ? mes : cross(a, [0, 0, 1]);
    m = add(m, a, -dot3(m, a));
    if (Math.hypot(m[0], m[1], m[2]) < 1e-5) m = cross(a, [0, 0, 1]);
    if (Math.hypot(m[0], m[1], m[2]) < 1e-5) m = cross(a, [1, 0, 0]);
    return norm(m);
  }

  function lockMprView(site) {
    const p = siteViewFrame(site) || leadPoseOf(site);
    if (!p) return;
    const axis = norm(p.axis);
    state._viewLock = {
      origin: p.origin.slice(),
      axis: axis.slice(),
      mesial: mesialOnAxis(p.mesial, axis),
      rotLong: state.rotLong,
      off: state.off,
      zoomLong: state.zoomLong || 1,
      zoomAx: state.zoomAx || 1,
      panLong: (state.panLong || [0, 0]).slice(),
      panAx: (state.panAx || [0, 0]).slice()
    };
  }

  function beginGizmoDrag(hit, which, startWorld, planeN) {
    const pose = captureSitePose(hit.site);
    lockMprView(hit.site);
    const planes = sitePlanes();
    const frozen = which === "ax" ? planes.axial : which === "long" ? planes.long : null;
    state.drag = {
      gizmo: true,
      which,
      kind: hit.kind,
      site: hit.site,
      pose,
      pivot: hit.pivot ? hit.pivot.slice() : null,
      handle: hit.p.slice(),
      startWorld: startWorld.slice(),
      planeN: planeN ? planeN.slice() : (frozen && frozen.normal.slice()),
      plane: frozen ? {
        origin: frozen.origin.slice(),
        right: frozen.right.slice(),
        up: frozen.up.slice(),
        normal: frozen.normal.slice(),
        width: frozen.width,
        height: frozen.height
      } : null
    };
    state._live = true;
    state._skipClick = true;
  }

  function applyGizmoDrag(world, plane) {
    const d = state.drag;
    if (!d || !d.gizmo) return;
    applySitePose(d.site, d.pose.origin, d.pose.axis, d.pose.mesial, d.pose.xforms);
    const pl = d.plane || plane;
    if (d.kind === "move") {
      let delta = sub3(world, d.startWorld);
      if (pl) {
        const r = pl.right, u = pl.up;
        delta = add(add([0, 0, 0], r, dot3(delta, r)), u, dot3(delta, u));
      } else if (state3d.view) {
        const r = state3d.view.right, u = state3d.view.up;
        delta = add(add([0, 0, 0], r, dot3(delta, r)), u, dot3(delta, u));
      }
      translateSite(d.site, delta);
      return;
    }
    if (d.kind === "spin") {
      const axis = d.pose.axis;
      const pivot = d.pivot || d.pose.origin;
      const a = rejectAxis(sub3(d.handle, pivot), axis);
      const raw = pl
        ? projectOnPlane(world, pivot, pl.right, pl.up)
        : (state3d.view
          ? projectOnPlane(world, pivot, state3d.view.right, state3d.view.up)
          : world);
      const b = rejectAxis(sub3(raw, pivot), axis);
      if (Math.hypot(a[0], a[1], a[2]) < 0.2 || Math.hypot(b[0], b[1], b[2]) < 0.2) return;
      rotateSite(d.site, axis, signedAngle(a, b, axis), pivot);
      return;
    }
    const pivot = d.pivot;
    if (!pivot) return;
    const n = d.planeN || (pl && pl.normal) || (state3d.view && state3d.view.back);
    if (!n) return;
    const a = sub3(d.handle, pivot);
    const b = sub3(projectOnPlane(world, pivot, 
      pl ? pl.right : state3d.view.right,
      pl ? pl.up : state3d.view.up), pivot);
    if (Math.hypot(a[0], a[1], a[2]) < 0.2 || Math.hypot(b[0], b[1], b[2]) < 0.2) return;
    rotateSite(d.site, n, signedAngle(a, b, n), pivot);
  }

  function endGizmoDrag() {
    if (state.drag && state.drag.gizmo) {
      const site = state.drag.site;
      if (state.drag.kind === "move" && site && site.origin) {
        const f = siteViewFrame(site);
        if (f) f.origin = site.origin.slice();
      }
      state._live = false;
      state._viewLock = null;
      syncSaveBtn();
    }
  }

  function worldToScreen3d(p, w, h) {
    const v = state3d.view;
    if (!v) return [w * 0.5, h * 0.5];
    const dx = p[0] - v.eye[0], dy = p[1] - v.eye[1], dz = p[2] - v.eye[2];
    const x = dx * v.right[0] + dy * v.right[1] + dz * v.right[2];
    const y = dx * v.up[0] + dy * v.up[1] + dz * v.up[2];
    return [
      ((x - v.panX) / v.halfW + 1) * 0.5 * w,
      (1 - (y - v.panY) / v.halfH) * 0.5 * h
    ];
  }

  function screenToWorld3d(x, y, w, h, depthP) {
    const v = state3d.view;
    if (!v) return [0, 0, 0];
    const camX = ((x / w) * 2 - 1) * v.halfW + v.panX;
    const camY = (1 - (y / h) * 2) * v.halfH + v.panY;
    const ref = depthP || v.target;
    const dx = ref[0] - v.eye[0], dy = ref[1] - v.eye[1], dz = ref[2] - v.eye[2];
    const z = dx * v.back[0] + dy * v.back[1] + dz * v.back[2];
    return [
      v.eye[0] + v.right[0] * camX + v.up[0] * camY + v.back[0] * z,
      v.eye[1] + v.right[1] * camX + v.up[1] * camY + v.back[1] * z,
      v.eye[2] + v.right[2] * camX + v.up[2] * camY + v.back[2] * z
    ];
  }

  function hitGizmo3d(w, h, x, y) {
    const s = state.site;
    if (!s || !s.origin || !state3d.view) return null;
    if (!canEditPose()) return null;
    // w,h — физические пиксели canvas.width/height (см. render3d): порог
    // попадания должен расти вместе с DPR, иначе на мобильных (2-3×) зона
    // захвата гизмо визуально ужимается втрое.
    const dpr3d = Math.min(2, window.devicePixelRatio || 1);
    let best = null, bestD = 16 * dpr3d;
    for (const g of gizmoPoints(s)) {
      const c = worldToScreen3d(g.p, w, h);
      const d = Math.hypot(c[0] - x, c[1] - y);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best ? { ...best, site: s } : null;
  }

  function drawGizmos3d() {
    const cv = document.getElementById("cv-3d-gizmo");
    const host = document.getElementById("cv-3d");
    if (!cv || !host || !state3d.view) {
      if (cv) {
        const c = cv.getContext("2d");
        if (c) c.clearRect(0, 0, cv.width, cv.height);
      }
      return;
    }
    const w = host.width, h = host.height;
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    if (!canEditPose() || !state.site) return;
    const s = state.site;
    if ((s.kind === "implant" && state.layers.implant === false) || (s.kind === "pin" && state.layers.pin === false))
      return;
    // host.width теперь физические пиксели (см. render3d) — рисуем в
    // CSS-эквивалентных координатах и один раз масштабируем контекст,
    // чтобы гизмо-иконки не «усохли» вместе с ростом буфера.
    const dpr3d = w / Math.max(host.clientWidth || 1, 1);
    const wCss = w / dpr3d, hCss = h / dpr3d;
    ctx.save();
    ctx.scale(dpr3d, dpr3d);
    const span = siteAxisSpan(s);
    const c = worldToScreen3d(span.mid, wCss, hCss);
    const side = worldToScreen3d(add(span.mid, state3d.view.right, 10), wCss, hCss);
    ctx.strokeStyle = "rgba(220,40,40,0.95)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(c[0] * 2 - side[0], c[1] * 2 - side[1]);
    ctx.lineTo(side[0], side[1]);
    ctx.stroke();
    const spin = gizmoPoints(s).find(g => g.kind === "spin");
    if (spin) {
      const sp = worldToScreen3d(spin.p, wCss, hCss);
      const rr = Math.hypot(sp[0] - c[0], sp[1] - c[1]);
      if (rr > 8) {
        ctx.beginPath();
        ctx.arc(c[0], c[1], rr, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(240,180,41,0.65)";
        ctx.lineWidth = 1.3;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // Иконки move/tilt/spin в 3D-виде убраны совсем (по просьбе
    // пользователя — перекрывали сам имплант и КТ вокруг него); линия оси
    // и пунктирный круг спина выше остаются как визуальный ориентир, а
    // тащить гизмо в 3D всё ещё можно — hitGizmo3d/onDown работают по тем
    // же координатам gizmoPoints() независимо от того, рисуем мы их или
    // нет. Управлять положением с явными хендлами — теперь через
    // Вдоль/Поперёк (drawSiteGizmos), там иконки полупрозрачные (30%).
    ctx.restore();
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zipStore(files) {
    const enc = new TextEncoder();
    const locals = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const head = new Uint8Array(30 + name.length + data.length);
      const v = new DataView(head.buffer);
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 0, true);
      v.setUint16(8, 0, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, data.length, true);
      v.setUint32(22, data.length, true);
      v.setUint16(26, name.length, true);
      head.set(name, 30);
      head.set(data, 30 + name.length);
      locals.push({ head, name, data, crc, offset });
      offset += head.length;
    }
    const central = [];
    let csize = 0;
    for (const L of locals) {
      const rec = new Uint8Array(46 + L.name.length);
      const v = new DataView(rec.buffer);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 20, true);
      v.setUint32(16, L.crc, true);
      v.setUint32(20, L.data.length, true);
      v.setUint32(24, L.data.length, true);
      v.setUint16(28, L.name.length, true);
      v.setUint32(42, L.offset, true);
      rec.set(L.name, 46);
      central.push(rec);
      csize += rec.length;
    }
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, csize, true);
    ev.setUint32(16, offset, true);
    const out = new Uint8Array(offset + csize + 22);
    let o = 0;
    for (const L of locals) { out.set(L.head, o); o += L.head.length; }
    for (const c of central) { out.set(c, o); o += c.length; }
    out.set(end, o);
    return out;
  }

  function meshTriCount(mesh) {
    if (!mesh || !mesh._pos) return 0;
    return mesh._idx ? mesh._idx.length / 3 : mesh._pos.length / 9;
  }

  function writeMeshTris(view, o, mesh) {
    const src = mesh._pos, idx = mesh._idx, tr = mesh.transform;
    const tris = meshTriCount(mesh);
    for (let t = 0; t < tris; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const p0 = xfm(tr, src[i0 * 3], src[i0 * 3 + 1], src[i0 * 3 + 2]);
      const p1 = xfm(tr, src[i1 * 3], src[i1 * 3 + 1], src[i1 * 3 + 2]);
      const p2 = xfm(tr, src[i2 * 3], src[i2 * 3 + 1], src[i2 * 3 + 2]);
      let nx = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]);
      let ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
      let nz = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
      const L = Math.hypot(nx, ny, nz) || 1;
      view.setFloat32(o, nx / L, true); view.setFloat32(o + 4, ny / L, true); view.setFloat32(o + 8, nz / L, true);
      view.setFloat32(o + 12, p0[0], true); view.setFloat32(o + 16, p0[1], true); view.setFloat32(o + 20, p0[2], true);
      view.setFloat32(o + 24, p1[0], true); view.setFloat32(o + 28, p1[1], true); view.setFloat32(o + 32, p1[2], true);
      view.setFloat32(o + 36, p2[0], true); view.setFloat32(o + 40, p2[1], true); view.setFloat32(o + 44, p2[2], true);
      view.setUint16(o + 48, 0, true);
      o += 50;
    }
    return o;
  }

  function meshesToWorldStl(meshes) {
    const list = (meshes || []).filter(m => meshTriCount(m) > 0);
    let tris = 0;
    for (const m of list) tris += meshTriCount(m);
    if (!tris) return null;
    const buf = new ArrayBuffer(84 + tris * 50);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);
    const title = "D3D CAD edit";
    for (let i = 0; i < title.length; i++) u8[i] = title.charCodeAt(i);
    view.setUint32(80, tris, true);
    let o = 84;
    for (const m of list) o = writeMeshTris(view, o, m);
    return u8;
  }

  function meshToWorldStl(mesh) {
    return meshesToWorldStl(mesh ? [mesh] : []);
  }

  function siteExportMeshes(site) {
    const want = { implant: 1, pin: 1, abutment: 1, sleeve: 1 };
    return siteChildren(site).filter(m => want[m.kind]);
  }

  function safeFilePart(s) {
    return String(s || "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "export";
  }

  function htmlExportStem() {
    try {
      const path = decodeURIComponent(String(location.pathname || "").replace(/\\/g, "/"));
      const base = path.split("/").pop() || "";
      const stem = base.replace(/\.html?$/i, "").trim();
      if (stem) return safeFilePart(stem);
    } catch (_) { /* ok */ }
    return safeFilePart(document.title);
  }

  function siteFileName(site) {
    const raw = String(site.tooth || site.id || site.kind || "edit").replace(/[^\w.\-]+/g, "_");
    return (site.kind === "pin" && !/^pin/i.test(raw) ? "Pin_" : "") + raw + ".stl";
  }

  function prefixedStlName(name) {
    const stem = htmlExportStem();
    const file = String(name || "implants_edit.stl");
    if (!stem) return file;
    if (file.toLowerCase().indexOf(stem.toLowerCase() + "_") === 0) return file;
    return stem + "_" + file;
  }

  function downloadBlob(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function toastEdit(text) {
    const btn = document.getElementById("tool-save-edits");
    if (btn) {
      btn.title = text;
      btn.classList.toggle("has-edits", editedSites().length > 0);
    }
    const chip = document.getElementById("edit-toast");
    if (chip) {
      chip.textContent = text;
      chip.hidden = false;
      clearTimeout(toastEdit._t);
      toastEdit._t = setTimeout(() => { chip.hidden = true; }, 2200);
    }
  }

  function syncPoseBtns() {
    const pv = poseView();
    const restBtn = document.getElementById("tool-show-rest");
    const editBtn = document.getElementById("tool-show-edit");
    if (editBtn) {
      editBtn.disabled = !pv.has;
      editBtn.classList.toggle("on", pv.edit);
      editBtn.classList.toggle("lead", pv.edit && pv.lead === "edit");
      editBtn.title = !pv.has ? "Нет правок"
        : !pv.edit ? "Коррекция: выкл"
        : pv.lead === "edit" ? "Коррекция: преимущество — обзор вокруг правки"
        : "Коррекция: выбрана";
    }
    if (restBtn) {
      restBtn.classList.toggle("on", pv.rest);
      restBtn.classList.toggle("lead", pv.rest && pv.lead === "rest");
      restBtn.title = !pv.rest ? "Исходный: выкл"
        : pv.lead === "rest" ? "Исходный: преимущество — обзор вокруг исходного"
        : "Исходный: выбран";
    }
  }

  function togglePose(which) {
    const has = editedSites().length > 0;
    if (which === "edit" && !has) return;
    const on = which === "rest" ? state.showRest !== false : state.showEdit !== false;
    const otherOn = which === "rest" ? (has && state.showEdit !== false) : state.showRest !== false;
    const isLead = on && poseView().lead === which;
    if (!on) {
      if (which === "rest") state.showRest = true;
      else state.showEdit = true;
      if (!otherOn) state.poseLead = which;
    } else if (!isLead) {
      state.poseLead = which;
    } else {
      if (!otherOn) return;
      if (which === "rest") state.showRest = false;
      else state.showEdit = false;
      state.poseLead = which === "rest" ? "edit" : "rest";
    }
    syncPoseBtns();
    renderMpr();
    renderOpg();
    render3d();
  }

  function syncSaveBtn() {
    // Кнопка "Сохранить правки (STL)" (tool-save-edits) убрана из UI —
    // экспорт правок только через "Сохранить копию HTML" (tool-save-html).
    // Вся синхронизация раньше была вложена в if(btn-STL) и с её удалением
    // просто перестала бы выполняться — теперь ничего не зависит от неё.
    const htmlBtn = document.getElementById("tool-save-html");
    const resetBtn = document.getElementById("tool-reset-edits");
    const n = editedSites().length;
    if (htmlBtn) {
      htmlBtn.disabled = n === 0;
      htmlBtn.classList.toggle("has-edits", n > 0);
      htmlBtn.title = n ? "Сохранить копию HTML с новыми позициями (" + n + ")" : "Нет правок";
    }
    if (resetBtn) {
      const sel = !!(state.site && siteIsEdited(state.site));
      resetBtn.disabled = !sel;
      resetBtn.title = sel ? "Сбросить выбранный" : "Нет правок у выбранного";
    }
    const resetAll = document.getElementById("tool-reset-all");
    if (resetAll) {
      resetAll.disabled = n === 0;
      resetAll.title = n ? "Сбросить все правки" : "Нет правок";
    }
    if (n > 0 && !state._hadEdits) {
      state._hadEdits = true;
      state.showEdit = true;
      state.poseLead = "edit";
    }
    if (n === 0) {
      state._hadEdits = false;
      state.poseLead = "rest";
    }
    syncPoseBtns();
  }


  function saveEditedStls() {
    const sites = editedSites();
    if (!sites.length) {
      toastEdit("Нет правок");
      return;
    }
    const meshes = [];
    for (const s of sites) meshes.push(...siteExportMeshes(s));
    const stl = meshesToWorldStl(meshes);
    if (!stl) {
      toastEdit("Нет мешей для выгрузки");
      return;
    }
    const name = prefixedStlName(sites.length === 1 ? siteFileName(sites[0]) : "implants_edit.stl");
    downloadBlob(name, new Blob([stl], { type: "application/sla" }));
    toastEdit("Сохранено: " + name);
  }

  // Пересобирает JSON сцены из ТЕКУЩЕГО (возможно, изменённого правками)
  // state.scene — только известные поля исходного формата, без служебных
  // рантайм-полей (_pos/_idx/_gl/_restT/_rest/_viewFrame и т.п.), которые
  // decodeMeshes/attachPackedGeoms/редактор навешивают прямо на объекты
  // mesh/site. state.scene.geoms при этом НЕ трогается вообще — геометрия
  // (позиции/индексы) не меняется при переносе импланта, меняется только
  // transform, поэтому geoms остаётся тем же, что было в исходном файле.
  function cleanSceneForSave() {
    const src = state.scene;
    if (!src) return null;
    const meshes = (src.meshes || []).map(m => {
      const out = {
        id: m.id, name: m.name, kind: m.kind, visible: m.visible !== false,
        opacity: typeof m.opacity === "number" ? m.opacity : 1,
        flat_shading: !!m.flat_shading, mesh_color: m.mesh_color,
        transform: m.transform, geom: m.geom
      };
      if (m.buffers) out.buffers = { vertex_count: m.buffers.vertex_count, triangle_count: m.buffers.triangle_count };
      return out;
    });
    const sites = (src.sites || []).map(s => ({
      id: s.id, name: s.name, kind: s.kind, tooth: s.tooth != null ? s.tooth : null,
      origin: s.origin, axis: s.axis, mesial: s.mesial || null,
      mu_origin: s.mu_origin || null, mu_axis: s.mu_axis || null,
      mesh: s.mesh || null, r: s.r, length: s.length,
      visible: s.visible !== false, color: s.color, info: s.info || null
    }));
    return {
      version: src.version || 3,
      mode: src.mode || "full",
      title: src.title,
      exported_at: new Date().toISOString(),
      volume: src.volume,
      cpr_arch: src.cpr_arch || [],
      cpr_up: src.cpr_up || [0, 0, 1],
      comments: state.comments || [],
      measurements: state.measurements || [],
      slice_markers: state.markers || [],
      viewer_defaults: src.viewer_defaults,
      sites,
      meshes,
      geoms: src.geoms || []
    };
  }

  // Собирает новый d3d-scene-payload (сжатый gzip + base64), переиспользуя
  // БИНАРНЫЙ БЛОБ геометрии из уже загруженного исходного payload байт-в-байт
  // (см. cleanSceneForSave) — меняется только JSON-заголовок сцены.
  async function buildEditedScenePayload() {
    const sceneEl = document.getElementById("d3d-scene-payload");
    if (!sceneEl) throw new Error("Нет сцены");
    const origBytes = await gunzipBytes(await b64ToBytes(sceneEl.textContent));
    if (!(origBytes.length >= 12 && origBytes[0] === 0x44 && origBytes[1] === 0x33 && origBytes[2] === 0x44 && origBytes[3] === 0x53))
      throw new Error("Неверный формат сцены (не D3DS)");
    const dv0 = new DataView(origBytes.buffer, origBytes.byteOffset, origBytes.byteLength);
    const jsonLen0 = dv0.getUint32(8, true);
    let blobOff = 12 + jsonLen0;
    blobOff = (blobOff + 3) & ~3;
    const blob = origBytes.subarray(blobOff);

    const cleanJson = cleanSceneForSave();
    if (!cleanJson) throw new Error("Сцена не загружена");
    const jsonBuf = new TextEncoder().encode(JSON.stringify(cleanJson));
    const head = new Uint8Array(12);
    head[0] = 0x44; head[1] = 0x33; head[2] = 0x44; head[3] = 0x53; // "D3DS"
    head[4] = 1; // version
    new DataView(head.buffer).setUint32(8, jsonBuf.length, true);
    const leadPad = (4 - ((12 + jsonBuf.length) % 4)) % 4;
    const total = new Uint8Array(12 + jsonBuf.length + leadPad + blob.length);
    total.set(head, 0);
    total.set(jsonBuf, 12);
    total.set(blob, 12 + jsonBuf.length + leadPad);

    if (typeof CompressionStream !== "function")
      throw new Error("Нужен более новый браузер (нет CompressionStream) — откройте файл в свежем Chrome/Edge/Safari для сохранения");
    const gz = new Uint8Array(await new Response(new Blob([total]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    let bin = "";
    const step = 32768;
    for (let i = 0; i < gz.length; i += step) bin += String.fromCharCode.apply(null, gz.subarray(i, i + step));
    return btoa(bin).replace(/(.{76})/g, "$1\n");
  }

  // Сохраняет НОВУЮ копию всего HTML-файла с изменёнными позициями
  // имплантов (и текущими линейками/комментариями/маркерами) — вместо
  // просто STL геометрии, как это делает tool-save-edits. КТ-объём и сам
  // движок вьювера копируются как есть, меняется только сцена. DOM берётся
  // "как в первую секунду загрузки": временно сбрасываем то, что успело
  // намутировать рантайм (#boot, #app, #layers), снимаем HTML, возвращаем
  // обратно — без постоянного хранения копии всей страницы в памяти
  // (страница может быть 100+ МБ, это важно на слабых/мобильных браузерах).
  async function saveEditedHtml() {
    if (typeof CompressionStream !== "function") {
      toastEdit("Нужен более новый браузер для сохранения");
      return;
    }
    if (!editedSites().length) {
      toastEdit("Нет правок");
      return;
    }
    toastEdit("Сохранение…");
    try {
      const newB64 = await buildEditedScenePayload();
      const boot = document.getElementById("boot");
      const app = document.getElementById("app");
      const layers = document.getElementById("layers");
      const bootStyle = boot ? boot.getAttribute("style") : null;
      const bootText = boot ? boot.textContent : null;
      const appClass = app ? app.className : null;
      const layersHtml = layers ? layers.innerHTML : null;
      let html;
      try {
        if (boot) { boot.removeAttribute("style"); boot.textContent = "Загрузка КТ…"; }
        if (app) app.className = "";
        if (layers) layers.innerHTML = "";
        html = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
      } finally {
        if (boot) {
          if (bootStyle == null) boot.removeAttribute("style"); else boot.setAttribute("style", bootStyle);
          boot.textContent = bootText;
        }
        if (app) app.className = appClass;
        if (layers) layers.innerHTML = layersHtml;
      }
      html = html.replace(
        /(<script[^>]*id="d3d-scene-payload"[^>]*>)([\s\S]*?)(<\/script>)/,
        (_, a, b, c) => a + "\n" + newB64 + "\n" + c
      );
      const stem = htmlExportStem() || "case";
      const name = stem + "_edited.html";
      downloadBlob(name, new Blob([html], { type: "text/html;charset=utf-8" }));
      toastEdit("Сохранено: " + name);
    } catch (e) {
      console.error(e);
      toastEdit("Ошибка сохранения: " + (e && e.message ? e.message : e));
    }
  }

  function ctWinLev(kind) {
    const c = Math.max(0.45,
      kind === "opg" ? (state.contrastOpg || 1)
        : kind === "ax" ? (state.contrastAx || 1)
          : (state.contrastLong || 1));
    if (kind === "opg") return { win: 4000 / c, lev: 1000 };
    const baseW = (state.scene && state.scene.viewer_defaults && state.scene.viewer_defaults.window) || 2800;
    const baseL = (state.scene && state.scene.viewer_defaults && state.scene.viewer_defaults.level) || 600;
    return { win: baseW / c, lev: baseL };
  }

  function sampleHu(vol, x, y, z) {
    const ijk = worldToIjk(vol, x, y, z);
    const x0 = Math.floor(ijk[0]), y0 = Math.floor(ijk[1]), z0 = Math.floor(ijk[2]);
    if (x0 < 0 || y0 < 0 || z0 < 0 || x0 + 1 >= vol.nx || y0 + 1 >= vol.ny || z0 + 1 >= vol.nz) {
      const i = Math.round(ijk[0]), j = Math.round(ijk[1]), k = Math.round(ijk[2]);
      if (i < 0 || j < 0 || k < 0 || i >= vol.nx || j >= vol.ny || k >= vol.nz) return -1000;
      return vol.hu[k * vol.nx * vol.ny + j * vol.nx + i];
    }
    const fx = ijk[0] - x0, fy = ijk[1] - y0, fz = ijk[2] - z0;
    const nxy = vol.nx * vol.ny;
    function at(i, j, k) { return vol.hu[k * nxy + j * vol.nx + i]; }
    const c00 = at(x0, y0, z0) * (1 - fx) + at(x0 + 1, y0, z0) * fx;
    const c10 = at(x0, y0 + 1, z0) * (1 - fx) + at(x0 + 1, y0 + 1, z0) * fx;
    const c01 = at(x0, y0, z0 + 1) * (1 - fx) + at(x0 + 1, y0, z0 + 1) * fx;
    const c11 = at(x0, y0 + 1, z0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1, z0 + 1) * fx;
    return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
  }

  function downsampleVol(vol) {
    const nx = Math.max(8, vol.nx >> 1), ny = Math.max(8, vol.ny >> 1), nz = Math.max(8, vol.nz >> 1);
    const hu = new Int16Array(nx * ny * nz);
    const nxy = vol.nx * vol.ny;
    for (let k = 0; k < nz; k++) {
      const z0 = k * 2, z1 = Math.min(vol.nz, z0 + 2);
      for (let j = 0; j < ny; j++) {
        const y0 = j * 2, y1 = Math.min(vol.ny, y0 + 2);
        for (let i = 0; i < nx; i++) {
          const x0 = i * 2, x1 = Math.min(vol.nx, x0 + 2);
          let sum = 0, n = 0;
          for (let zz = z0; zz < z1; zz++)
            for (let yy = y0; yy < y1; yy++)
              for (let xx = x0; xx < x1; xx++) {
                sum += vol.hu[zz * nxy + yy * vol.nx + xx];
                n++;
              }
          hu[k * nx * ny + j * nx + i] = (sum / n) | 0;
        }
      }
    }
    return {
      nx, ny, nz, hu,
      spacing: [vol.spacing[0] * (vol.nx / nx), vol.spacing[1] * (vol.ny / ny), vol.spacing[2] * (vol.nz / nz)],
      origin: vol.origin, direction: vol.direction, window: vol.window, level: vol.level
    };
  }

  const VS = `#version 300 es
    in vec2 aPos;
    out vec2 vUv;
    void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const FS_I = `#version 300 es
    precision highp float;
    precision highp isampler3D;
    uniform isampler3D uVol;
    uniform vec3 uOrigin, uRight, uUp, uVolOrigin, uSpacing, uDims, uDir0, uDir1, uDir2;
    uniform vec2 uPlaneSize;
    uniform float uWindow, uLevel;
    in vec2 vUv;
    out vec4 fragColor;
    float huAt(ivec3 ijk){
      ivec3 d = ivec3(uDims);
      ijk = clamp(ijk, ivec3(0), d - 1);
      return float(texelFetch(uVol, ijk, 0).r);
    }
    float sampleHu(vec3 ijk){
      vec3 i0 = floor(ijk);
      vec3 f = ijk - i0;
      ivec3 p = ivec3(i0);
      float c00 = mix(huAt(p), huAt(p + ivec3(1,0,0)), f.x);
      float c10 = mix(huAt(p + ivec3(0,1,0)), huAt(p + ivec3(1,1,0)), f.x);
      float c01 = mix(huAt(p + ivec3(0,0,1)), huAt(p + ivec3(1,0,1)), f.x);
      float c11 = mix(huAt(p + ivec3(0,1,1)), huAt(p + ivec3(1,1,1)), f.x);
      return mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
    }
    void main(){
      vec3 p = uOrigin + (vUv.x - 0.5) * uPlaneSize.x * uRight + (vUv.y - 0.5) * uPlaneSize.y * uUp;
      vec3 d = p - uVolOrigin;
      vec3 ijk = vec3(dot(d,uDir0), dot(d,uDir1), dot(d,uDir2)) / uSpacing;
      if (any(lessThan(ijk, vec3(-0.5))) || any(greaterThanEqual(ijk, uDims - vec3(0.5)))) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      float hu = sampleHu(ijk);
      float g = clamp((hu - uLevel) / uWindow + 0.5, 0.0, 1.0);
      fragColor = vec4(g, g, g, 1.0);
    }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function makeProgram(gl, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  function uploadTex(gl, vol) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16I, vol.nx, vol.ny, vol.nz, 0, gl.RED_INTEGER, gl.SHORT, vol.hu);
    return gl.getError() === gl.NO_ERROR ? tex : null;
  }

  function fitVolToTex(gl, vol) {
    const maxN = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) || 2048;
    let v = vol;
    while (v.nx > maxN || v.ny > maxN || v.nz > maxN)
      v = downsampleVol(v);
    return v;
  }

  function initGl(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    let vol = fitVolToTex(gl, state.vol);
    let prog = null, tex = null;
    try {
      prog = makeProgram(gl, FS_I);
      tex = uploadTex(gl, vol);
      if (!tex) {
        vol = downsampleVol(vol);
        tex = uploadTex(gl, vol);
      }
    } catch (e) {
      return null;
    }
    if (!tex || !prog) return null;
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    return { gl, prog, tex, vol, integer: true };
  }

  function paneShows(mode) {
    if (!isMobileLayout()) return true;
    return state.paneMain === mode || state.paneCt === mode;
  }

  function canvasBox(canvas) {
    if (!canvas) return [0, 0];
    let w = canvas.clientWidth || 0, h = canvas.clientHeight || 0;
    if (w < 8 || h < 8) {
      const host = canvas.parentElement;
      if (host) {
        w = host.clientWidth || w;
        h = host.clientHeight || h;
      }
    }
    return [w, h];
  }

  function drawGl(slot, plane) {
    const ctx = state.gl[slot];
    if (!ctx) return false;
    const canvas = document.getElementById(slot === "long" ? "cv-long-gl" : "cv-ax-gl");
    const visible = paneShows(slot === "long" ? "cross" : "axial");
    const [w0, h0] = canvasBox(canvas);
    if (!canvas || w0 < 8 || h0 < 8)
      return !visible;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(w0 * dpr));
    const h = Math.max(2, Math.round(h0 * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const gl = ctx.gl, vol = ctx.vol;
    const fit = planeView(plane, w0, h0);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, w, h);
    gl.clearColor(42 / 255, 42 / 255, 48 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(ctx.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, ctx.tex);
    const U = (n) => gl.getUniformLocation(ctx.prog, n);
    gl.uniform1i(U("uVol"), 0);
    gl.uniform3fv(U("uOrigin"), plane.origin);
    gl.uniform3fv(U("uRight"), plane.right);
    gl.uniform3fv(U("uUp"), plane.up);
    gl.uniform3fv(U("uVolOrigin"), vol.origin);
    gl.uniform3fv(U("uSpacing"), vol.spacing);
    gl.uniform3fv(U("uDims"), [vol.nx, vol.ny, vol.nz]);
    gl.uniform3fv(U("uDir0"), vol.direction.slice(0, 3));
    gl.uniform3fv(U("uDir1"), vol.direction.slice(3, 6));
    gl.uniform3fv(U("uDir2"), vol.direction.slice(6, 9));
    gl.uniform2f(U("uPlaneSize"), fit.mmW, fit.mmH);
    const wl = ctWinLev(slot === "ax" ? "ax" : "long");
    gl.uniform1f(U("uWindow"), wl.win);
    gl.uniform1f(U("uLevel"), wl.lev);
    if (!state.layers.ct) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);
      return true;
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.SCISSOR_TEST);
    return true;
  }

  function drawSliceCpu(canvas, plane, kind) {
    const w = canvas.clientWidth || 400, h = canvas.clientHeight || 220;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(w, h);
    const vol = state.vol;
    const wl = ctWinLev(kind === "ax" ? "ax" : "long");
    const win = wl.win, lev = wl.lev;
    const fit = planeView(plane, w, h);
    if (state.layers.ct) {
      const nrm = plane.normal;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          if (x < fit.x0 || y < fit.y0 || x >= fit.x0 + fit.dw || y >= fit.y0 + fit.dh) {
            img.data[o] = 42; img.data[o + 1] = 42; img.data[o + 2] = 48; img.data[o + 3] = 255;
            continue;
          }
          const u = ((x - fit.x0) / fit.dw - 0.5) * fit.mmW;
          const v = (0.5 - (y - fit.y0) / fit.dh) * fit.mmH;
          const p = add(add(plane.origin, plane.right, u), plane.up, v);
          const b = 0.38;
          let hu = sampleHu(vol, p[0], p[1], p[2]);
          const pr = add(p, plane.right, b), pl = add(p, plane.right, -b);
          const pu = add(p, plane.up, b), pd = add(p, plane.up, -b);
          const pn = add(p, nrm, b * 0.55), pm = add(p, nrm, -b * 0.55);
          hu = (hu + sampleHu(vol, pr[0], pr[1], pr[2]) + sampleHu(vol, pl[0], pl[1], pl[2])
            + sampleHu(vol, pu[0], pu[1], pu[2]) + sampleHu(vol, pd[0], pd[1], pd[2])
            + sampleHu(vol, pn[0], pn[1], pn[2]) + sampleHu(vol, pm[0], pm[1], pm[2])) / 7;
          let g = (hu - lev) / win + 0.5;
          if (g < 0) g = 0; if (g > 1) g = 1;
          const c = g * 255;
          img.data[o] = c; img.data[o + 1] = c; img.data[o + 2] = c; img.data[o + 3] = 255;
        }
      }
    } else {
      img.data.fill(0);
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function volCorners(vol) {
    const o = vol.origin, s = vol.spacing, d = vol.direction;
    const ex = [vol.nx * s[0], vol.ny * s[1], vol.nz * s[2]];
    const out = [];
    for (let i = 0; i < 8; i++) {
      const a = i & 1 ? ex[0] : 0, b = i & 2 ? ex[1] : 0, c = i & 4 ? ex[2] : 0;
      out.push([
        o[0] + a * d[0] + b * d[3] + c * d[6],
        o[1] + a * d[1] + b * d[4] + c * d[7],
        o[2] + a * d[2] + b * d[5] + c * d[8]
      ]);
    }
    return out;
  }

  function volSliceBounds(vol, origin, right, up, normal) {
    const c = volCorners(vol);
    const edges = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9, n = 0;
    const hit = p => {
      const dx = p[0] - origin[0], dy = p[1] - origin[1], dz = p[2] - origin[2];
      const u = dx * right[0] + dy * right[1] + dz * right[2];
      const v = dx * up[0] + dy * up[1] + dz * up[2];
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
      n++;
    };
    for (let i = 0; i < edges.length; i++) {
      const a = c[edges[i][0]], b = c[edges[i][1]];
      const da = (a[0] - origin[0]) * normal[0] + (a[1] - origin[1]) * normal[1] + (a[2] - origin[2]) * normal[2];
      const db = (b[0] - origin[0]) * normal[0] + (b[1] - origin[1]) * normal[1] + (b[2] - origin[2]) * normal[2];
      if (Math.abs(da) < 1e-4) hit(a);
      if (Math.abs(db) < 1e-4) hit(b);
      if (da * db < 0) {
        const t = da / (da - db);
        hit([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    return n >= 3 ? { u0, u1, v0, v1 } : null;
  }

  function tissueSliceBounds(vol, origin, right, up) {
    if (!vol) return null;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9, n = 0;
    const reach = 72, step = 2.4;
    for (let u = -reach; u <= reach; u += step) {
      for (let v = -reach; v <= reach; v += step) {
        const p = add(add(origin, right, u), up, v);
        if (sampleHu(vol, p[0], p[1], p[2]) < 160) continue;
        if (u < u0) u0 = u;
        if (u > u1) u1 = u;
        if (v < v0) v0 = v;
        if (v > v1) v1 = v;
        n++;
      }
    }
    if (n < 10) return null;
    const pad = 3;
    return { u0: u0 - pad, u1: u1 + pad, v0: v0 - pad, v1: v1 + pad };
  }

  function clampPanKeepSite(pan, mmW, mmH) {
    if (!pan) return;
    const mx = Math.max(6, mmW * 0.28);
    const my = Math.max(6, mmH * 0.28);
    pan[0] = Math.max(-mmW * 0.5 + mx, Math.min(mmW * 0.5 - mx, pan[0]));
    pan[1] = Math.max(-mmH * 0.5 + my, Math.min(mmH * 0.5 - my, pan[1]));
  }

  function clampPanToSlice(pan, bounds, mmW, mmH) {
    if (!pan) return;
    clampPanKeepSite(pan, mmW, mmH);
  }

  function planeView(plane, w, h) {
    w = Math.max(2, w || 2);
    h = Math.max(2, h || 2);
    const aspect = w / h;
    const zoom = Math.max(1, plane.zoom || 1);
    const base = Math.max(plane.width || 56, plane.height || 56);
    let mmW = aspect >= 1 ? base * aspect : base;
    let mmH = aspect >= 1 ? base : base / aspect;
    mmW /= zoom;
    mmH /= zoom;
    return { mm: base, mmW, mmH, x0: 0, y0: 0, dw: w, dh: h, side: Math.min(w, h) };
  }

  function worldToCanvas(plane, w, h, p) {
    const f = planeView(plane, w, h);
    const dx = p[0] - plane.origin[0], dy = p[1] - plane.origin[1], dz = p[2] - plane.origin[2];
    const u = dx * plane.right[0] + dy * plane.right[1] + dz * plane.right[2];
    const v = dx * plane.up[0] + dy * plane.up[1] + dz * plane.up[2];
    return [f.x0 + (u / f.mmW + 0.5) * f.dw, f.y0 + (0.5 - v / f.mmH) * f.dh];
  }

  function canvasToWorld(plane, w, h, x, y) {
    const f = planeView(plane, w, h);
    const u = ((x - f.x0) / f.dw - 0.5) * f.mmW;
    const v = (0.5 - (y - f.y0) / f.dh) * f.mmH;
    return add(add(plane.origin, plane.right, u), plane.up, v);
  }

  function distToPlane(plane, p) {
    const n = plane.normal;
    return Math.abs((p[0] - plane.origin[0]) * n[0] + (p[1] - plane.origin[1]) * n[1] + (p[2] - plane.origin[2]) * n[2]);
  }

  function isCadContour(kind) {
    return kind === "bone" || kind === "anatomy" || kind === "scan"
      || kind === "nerve" || kind === "antagonist" || kind === "waxup" || kind === "soft";
  }

  function cutRgb(kind) {
    return kind === "scan" ? [244, 162, 97]
      : kind === "implant" ? [226, 36, 36]
      : kind === "pin" ? [134, 239, 172]
      : kind === "nerve" ? [36, 36, 40]
      : kind === "teeth" ? [226, 232, 240]
      : kind === "anatomy" ? [237, 140, 122]
      : kind === "bone" ? [210, 48, 48]
      : kind === "antagonist" ? [196, 168, 214]
      : kind === "sleeve" ? [60, 196, 214]
      : kind === "abutment" ? [240, 192, 64]
      : kind === "security" ? [245, 197, 66]
      : kind === "thickness" ? [94, 234, 212]
      : kind === "bar" ? [179, 209, 242]
      : kind === "waxup" ? [250, 220, 140]
      : [148, 163, 184];
  }

  function cutStroke(kind, hot, mesh) {
    const hex = parseHexColor(mesh && mesh.mesh_color);
    const rgb = hex
      ? [Math.round(hex[0] * 255), Math.round(hex[1] * 255), Math.round(hex[2] * 255)]
      : cutRgb(kind);
    const contour = isCadContour(kind);
    const k = contour || hot ? 1 : 0.34;
    const a = contour || hot ? 1 : 0.5;
    return "rgba(" + Math.round(rgb[0] * k) + "," + Math.round(rgb[1] * k) + "," + Math.round(rgb[2] * k) + "," + a + ")";
  }

  function meshOpacityOf(m) {
    const o = typeof m.opacity === "number" ? m.opacity : state.opacity[m.kind];
    return o == null ? 1 : Math.max(0.05, Math.min(1, o));
  }

  function stitchContour(ctx, segs) {
    if (!segs.length) return;
    const used = new Uint8Array(segs.length);
    const q = 0.8;
    const key = (x, y) => Math.round(x / q) + ":" + Math.round(y / q);
    const at = new Map();
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const a = key(s[0], s[1]), b = key(s[2], s[3]);
      if (!at.has(a)) at.set(a, []);
      if (!at.has(b)) at.set(b, []);
      at.get(a).push(i);
      at.get(b).push(i);
    }
    ctx.beginPath();
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      let x = segs[i][0], y = segs[i][1];
      ctx.moveTo(x, y);
      let cur = i;
      while (cur >= 0 && !used[cur]) {
        used[cur] = 1;
        const s = segs[cur];
        const d0 = Math.hypot(s[0] - x, s[1] - y);
        const nx = d0 <= Math.hypot(s[2] - x, s[3] - y) ? s[2] : s[0];
        const ny = d0 <= Math.hypot(s[2] - x, s[3] - y) ? s[3] : s[1];
        ctx.lineTo(nx, ny);
        x = nx;
        y = ny;
        const cand = at.get(key(x, y)) || [];
        cur = -1;
        for (let k = 0; k < cand.length; k++) {
          if (!used[cand[k]]) { cur = cand[k]; break; }
        }
      }
    }
    ctx.stroke();
  }

  function drawMeshCuts(ctx, w, h, plane, kind) {
    const live = !!state._live;
    const meshes = (state.scene.meshes || []).filter(m => m.kind === kind && m.visible !== false && m._pos);
    const contour = isCadContour(kind);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash([]);
    for (const m of meshes) {
      const passes = planningPasses(m);
      for (const pass of passes)
        drawMeshCutPass(ctx, w, h, plane, kind, m, pass, contour, live);
    }
    ctx.globalAlpha = 1;
  }

  function drawMeshCutPass(ctx, w, h, plane, kind, m, pass, contour, live) {
      const hot = meshBelongsToSite(m, state.site);
      const plan = kind === "implant" || kind === "pin" || kind === "sleeve" || kind === "abutment";
      const zoomK = plan ? Math.min(2, 1 + (Math.max(1, plane.zoom || 1) - 1) * 0.5) : 1;
      ctx.globalAlpha = contour ? 1 : meshOpacityOf(m);
      ctx.strokeStyle = pass.rgb
        ? "rgba(" + pass.rgb[0] + "," + pass.rgb[1] + "," + pass.rgb[2] + "," + (hot ? 1 : 0.88) + ")"
        : cutStroke(kind, hot, m);
      ctx.lineWidth = (contour
        ? 1.25
        : hot
          ? (kind === "implant" || kind === "pin" ? 1.5 : 1.2)
          : (kind === "implant" || kind === "pin" ? 0.6 : 0.5)) * zoomK;
      const pos = m._pos, idx = m._idx, tr = pass.tr;
      const tris = idx ? idx.length / 3 : pos.length / 9;
      const max = live
        ? (contour || plan ? Math.min(tris, 160000) : Math.min(tris, 28000))
        : (contour ? Math.min(tris, 220000) : Math.min(tris, 80000));
      const step = Math.max(1, Math.floor(tris / max));
      const segs = contour || plan ? [] : null;
      if (!segs) ctx.beginPath();
      for (let t = 0; t < tris; t += step) {
        const pts = [];
        for (let v = 0; v < 3; v++) {
          const vi = idx ? idx[t * 3 + v] : t * 3 + v;
          pts.push(xfm(tr, pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]));
        }
        const hits = [];
        for (let a = 0; a < 3; a++) {
          const b = (a + 1) % 3;
          const da = (pts[a][0] - plane.origin[0]) * plane.normal[0] + (pts[a][1] - plane.origin[1]) * plane.normal[1] + (pts[a][2] - plane.origin[2]) * plane.normal[2];
          const db = (pts[b][0] - plane.origin[0]) * plane.normal[0] + (pts[b][1] - plane.origin[1]) * plane.normal[1] + (pts[b][2] - plane.origin[2]) * plane.normal[2];
          if (da * db > 0) continue;
          const t0 = da / ((da - db) || 1e-6);
          hits.push([
            pts[a][0] + (pts[b][0] - pts[a][0]) * t0,
            pts[a][1] + (pts[b][1] - pts[a][1]) * t0,
            pts[a][2] + (pts[b][2] - pts[a][2]) * t0
          ]);
        }
        if (hits.length < 2) continue;
        const c0 = worldToCanvas(plane, w, h, hits[0]);
        const c1 = worldToCanvas(plane, w, h, hits[1]);
        if (segs) segs.push([c0[0], c0[1], c1[0], c1[1]]);
        else {
          ctx.moveTo(c0[0], c0[1]);
          ctx.lineTo(c1[0], c1[1]);
        }
      }
      ctx.setLineDash([]);
      if (segs) stitchContour(ctx, segs);
      else ctx.stroke();
      if (!live && state.layers.marker && m._mark) {
        const n = pos.length / 3;
        for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 8000))) {
          const r = m._mark[i * 3], g = m._mark[i * 3 + 1], b = m._mark[i * 3 + 2];
          if (r < 20 && g < 20 && b < 20) continue;
          const q = xfm(tr, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
          if (distToPlane(plane, q) > 0.8) continue;
          const c = worldToCanvas(plane, w, h, q);
          ctx.fillStyle = "rgb(" + r + "," + g + "," + b + ")";
          ctx.fillRect(c[0] - 1, c[1] - 1, 2, 2);
        }
      }
    ctx.globalAlpha = 1;
  }

  function jawAnterior(axis) {
    const a = norm(axis);
    const cpr = cprPoints();
    if (cpr && cpr.length >= 3) {
      const front = cpr[cpr.length >> 1];
      const back = [
        (cpr[0][0] + cpr[cpr.length - 1][0]) * 0.5,
        (cpr[0][1] + cpr[cpr.length - 1][1]) * 0.5,
        (cpr[0][2] + cpr[cpr.length - 1][2]) * 0.5
      ];
      return mesialOnAxis([front[0] - back[0], front[1] - back[1], front[2] - back[2]], a);
    }
    const sites = ((state.scene && state.scene.sites) || []).filter(s => s && s.origin);
    if (sites.length >= 2) {
      let cx = 0, cy = 0, cz = 0;
      for (const s of sites) { cx += s.origin[0]; cy += s.origin[1]; cz += s.origin[2]; }
      const inv = 1 / sites.length;
      cx *= inv; cy *= inv; cz *= inv;
      const ants = sites.filter(s => {
        const t = +s.tooth;
        return (t >= 11 && t <= 13) || (t >= 21 && t <= 23)
          || (t >= 31 && t <= 33) || (t >= 41 && t <= 43);
      });
      const use = ants.length ? ants : sites;
      let dx = 0, dy = 0, dz = 0;
      for (const s of use) { dx += s.origin[0] - cx; dy += s.origin[1] - cy; dz += s.origin[2] - cz; }
      if (Math.hypot(dx, dy, dz) > 1e-5)
        return mesialOnAxis([dx, dy, dz], a);
    }
    return mesialOnAxis(cross(a, archUp()), a);
  }

  function axialInPlane(axis) {
    const ant = jawAnterior(axis);
    let up = [-ant[0], -ant[1], -ant[2]];
    let right = cross(up, axis);
    if (Math.hypot(right[0], right[1], right[2]) < 1e-5) {
      right = mesialOnAxis([1, 0, 0], axis);
      up = cross(axis, right);
    }
    right = norm(right);
    up = norm(up);
    // Один фиксированный поворот для всех КТ: клюв строго вниз.
    const rot = (25 + ((state._viewLock && state._viewLock.rotAx) || state.rotAx || 0)) * Math.PI / 180;
    right = rotAround(axis, rot, right);
    up = rotAround(axis, rot, up);
    return { right, up };
  }

  function sitePlanes() {
    const s = state.site;
    const lock = state._viewLock;
    const lead = leadPoseOf(s);
    const frame = siteViewFrame(s);
    const base = lock || frame || lead;
    const axis = norm(base ? base.axis : s.axis);
    const moving = !!(state.drag && state.drag.gizmo && state.drag.kind === "move" && s.origin);
    const origin0 = moving ? s.origin : (base ? base.origin : s.origin);
    const mes0 = mesialOnAxis(base && base.mesial, axis);
    const rotLong = lock ? lock.rotLong : state.rotLong;
    const off = lock ? lock.off : state.off;
    const rightL = rotAround(axis, rotLong * Math.PI / 180, mes0);
    const zL = Math.max(1, lock ? lock.zoomLong : (state.zoomLong || 1));
    const zA = Math.max(1, lock ? lock.zoomAx : (state.zoomAx || 1));
    const pL = lock ? lock.panLong : (state.panLong || (state.panLong = [0, 0]));
    const pA = lock ? lock.panAx : (state.panAx || (state.panAx = [0, 0]));
    const long = {
      origin: origin0.slice(),
      right: [-rightL[0], -rightL[1], -rightL[2]],
      up: [-axis[0], -axis[1], -axis[2]],
      normal: norm(cross(rightL, axis)),
      width: 56,
      height: 56,
      zoom: zL
    };
    const ax = axialInPlane(axis);
    const axial = {
      origin: add(origin0, axis, off),
      right: ax.right,
      up: ax.up,
      normal: axis,
      width: 56,
      height: 56,
      zoom: zA
    };
    if (state.vol) {
      const longCv = document.getElementById("cv-long") || document.getElementById("cv-long-gl");
      const axCv = document.getElementById("cv-ax") || document.getElementById("cv-ax-gl");
      const [lw, lh] = canvasBox(longCv);
      const [aw, ah] = canvasBox(axCv);
      const bL = tissueSliceBounds(state.vol, long.origin, long.right, long.up)
        || volSliceBounds(state.vol, long.origin, long.right, long.up, long.normal);
      const bA = tissueSliceBounds(state.vol, axial.origin, axial.right, axial.up)
        || volSliceBounds(state.vol, axial.origin, axial.right, axial.up, axial.normal);
      long.slice = bL;
      axial.slice = bA;
      if (!lock) {
        const fitL = planeView(long, lw, lh);
        const fitA = planeView(axial, aw, ah);
        pL[0] = 0;
        clampPanToSlice(pL, bL, fitL.mmW, fitL.mmH);
        pL[0] = 0;
        clampPanToSlice(pA, bA, fitA.mmW, fitA.mmH);
      }
    }
    pL[0] = 0;
    long.origin = add(add(long.origin, long.right, pL[0]), long.up, pL[1]);
    axial.origin = add(add(axial.origin, axial.right, pA[0]), axial.up, pA[1]);
    if (long.slice) {
      long.slice = {
        u0: long.slice.u0 - pL[0], u1: long.slice.u1 - pL[0],
        v0: long.slice.v0 - pL[1], v1: long.slice.v1 - pL[1]
      };
    }
    if (axial.slice) {
      axial.slice = {
        u0: axial.slice.u0 - pA[0], u1: axial.slice.u1 - pA[0],
        v0: axial.slice.v0 - pA[1], v1: axial.slice.v1 - pA[1]
      };
    }
    return { long, axial };
  }

  function jawImplants() {
    return sitesOf("implant");
  }

  function archUp() {
    const u = state.scene && state.scene.cpr_up;
    if (u && u.length >= 3 && Math.hypot(u[0], u[1], u[2]) > 1e-5) {
      const n = norm(u);
      return n[2] < 0 ? [-n[0], -n[1], -n[2]] : n;
    }
    return [0, 0, 1];
  }

  function polylineToArch(raw, up, sites) {
    if (!raw || raw.length < 2) return null;
    const segs = [];
    let len = 0;
    for (let i = 0; i < raw.length - 1; i++) {
      const a = raw[i], b = raw[i + 1];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-6;
      segs.push({ a, b, d, s0: len });
      len += d;
    }
    if (len < 8) return null;
    const n = 320;
    const samples = [];
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1)) * len;
      let seg = segs[segs.length - 1];
      for (const g of segs) if (u <= g.s0 + g.d) { seg = g; break; }
      const t = (u - seg.s0) / seg.d;
      const p = [seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t, seg.a[2] + (seg.b[2] - seg.a[2]) * t];
      const tang = norm([seg.b[0] - seg.a[0], seg.b[1] - seg.a[1], seg.b[2] - seg.a[2]]);
      samples.push({ p, t: tang, u });
    }
    return { samples, length: len, up, height: 100, slab: 1.0, sites };
  }

  function cprPoints() {
    const src = state.scene && state.scene.cpr_arch;
    if (!src || src.length < 9) return null;
    const pts = [];
    for (let i = 0; i + 2 < src.length; i += 3)
      pts.push([src[i], src[i + 1], src[i + 2]]);
    return pts.length >= 3 ? pts : null;
  }

  function buildArch() {
    const implants = jawImplants();
    const pins = sitesOf("pin");
    const curve = implants.length ? implants : pins;
    const marks = implants.concat(pins);
    const up = archUp();
    const cpr = cprPoints();
    if (cpr && cpr.length >= 3) {
      const arch = polylineToArch(cpr, up, marks);
      if (arch) return arch;
    }
    if (!curve.length) return null;
    let cx = 0, cy = 0;
    for (const s of curve) { cx += s.origin[0]; cy += s.origin[1]; }
    const c = [cx / curve.length, cy / curve.length];
    const ordered = curve.map(s => {
      const ang = Math.atan2(s.origin[1] - c[1], s.origin[0] - c[0]);
      return { s, ang };
    }).sort((a, b) => a.ang - b.ang);
    const raw = ordered.map(it => [it.s.origin[0], it.s.origin[1], it.s.origin[2]]);
    if (raw.length === 1) {
      raw.unshift([raw[0][0] - 18, raw[0][1], raw[0][2]]);
      raw.push([raw[0][0] + 18, raw[0][1], raw[0][2]]);
    } else {
      const t0 = norm([raw[1][0] - raw[0][0], raw[1][1] - raw[0][1], 0]);
      const last = raw.length - 1;
      const t1 = norm([raw[last][0] - raw[last - 1][0], raw[last][1] - raw[last - 1][1], 0]);
      raw.unshift(add(raw[0], t0, -16));
      raw.push(add(raw[last], t1, 16));
    }
    return polylineToArch(raw, up, marks);
  }

  function archFromDentalHull(marks) {
    const zRef = marks.length
      ? marks.reduce((s, m) => s + m.origin[2], 0) / marks.length
      : null;
    let cx = 0, cy = 0, n = 0;
    if (marks.length) {
      for (const s of marks) { cx += s.origin[0]; cy += s.origin[1]; n++; }
      cx /= n; cy /= n;
    }
    const r0 = marks.length
      ? marks.reduce((s, m) => s + Math.hypot(m.origin[0] - cx, m.origin[1] - cy), 0) / marks.length
      : null;
    const pts = [];
    for (const m of state.scene.meshes || []) {
      if (m.kind !== "scan" && m.kind !== "bone" && m.kind !== "teeth") continue;
      if (!m._pos) continue;
      const src = m._pos, tr = m.transform;
      const count = src.length / 3;
      const step = Math.max(1, Math.floor(count / 5000));
      for (let i = 0; i < count; i += step) {
        const p = xfm(tr, src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
        if (zRef != null && Math.abs(p[2] - zRef) > 16) continue;
        if (r0 != null) {
          const r = Math.hypot(p[0] - cx, p[1] - cy);
          if (Math.abs(r - r0) > 14) continue;
        }
        pts.push(p);
      }
    }
    if (pts.length < 24) return null;
    if (!n) {
      cx = 0; cy = 0;
      for (const p of pts) { cx += p[0]; cy += p[1]; }
      cx /= pts.length; cy /= pts.length;
    }
    const bins = Array.from({ length: 48 }, () => null);
    for (const p of pts) {
      let i = Math.floor((Math.atan2(p[1] - cy, p[0] - cx) + Math.PI) / (2 * Math.PI) * 48);
      i = Math.max(0, Math.min(47, i));
      const r = Math.hypot(p[0] - cx, p[1] - cy);
      if (!bins[i] || r > bins[i].r) bins[i] = { p, r };
    }
    const raw = bins.filter(Boolean).map(b => b.p);
    if (raw.length < 8) return null;
    raw.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    return polylineToArch(raw, archUp(), marks);
  }

  function projectOnArch(arch, p) {
    let best = 0, bestD = 1e12;
    for (let i = 0; i < arch.samples.length; i++) {
      const q = arch.samples[i].p;
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const s = arch.samples[best];
    const v = (p[0] - s.p[0]) * arch.up[0] + (p[1] - s.p[1]) * arch.up[1] + (p[2] - s.p[2]) * arch.up[2];
    return { i: best, u: s.u, v };
  }

  function workingJawV(arch) {
    const vs = [];
    for (const s of arch.sites || [])
      vs.push(projectOnArch(arch, s.origin).v);
    if (!vs.length) return 0;
    vs.sort((a, b) => a - b);
    return vs[Math.floor(vs.length / 2)];
  }

  function fitArchFrame(arch, w, h) {
    const cached = state._opgBand;
    if (cached && Math.abs(cached.len - arch.length) < 0.05) {
      arch.v0 = cached.v0;
      arch.v1 = cached.v1;
      arch.height = cached.height;
    } else {
      const mid = workingJawV(arch);
      const band = 22;
      let vmin = 1e9, vmax = -1e9, any = false;
      const step = Math.max(1, Math.floor(arch.samples.length / 72));
      for (let i = 0; i < arch.samples.length; i += step) {
        const samp = arch.samples[i];
        const buccal = norm(cross(arch.up, samp.t));
        for (let v = mid - band; v <= mid + band; v += 1.2) {
          const p = add(add(samp.p, arch.up, v), buccal, 0);
          if (sampleHu(state.vol, p[0], p[1], p[2]) < 220) continue;
          vmin = Math.min(vmin, v);
          vmax = Math.max(vmax, v);
          any = true;
        }
      }
      for (const s of arch.sites || []) {
        for (const t of [-14, 8]) {
          const p = projectOnArch(arch, add(s.origin, s.axis, t));
          vmin = Math.min(vmin, p.v);
          vmax = Math.max(vmax, p.v);
          any = true;
        }
      }
      if (!any || vmax - vmin < 10) {
        vmin = mid - 16;
        vmax = mid + 16;
      }
      vmin = Math.max(vmin, mid - band);
      vmax = Math.min(vmax, mid + band);
      const pad = Math.max(2.5, (vmax - vmin) * 0.06);
      arch.v0 = vmin - pad;
      arch.v1 = vmax + pad;
      arch.height = Math.max(22, arch.v1 - arch.v0);
      state._opgBand = { len: arch.length, v0: arch.v0, v1: arch.v1, height: arch.height };
    }
    const z = Math.max(1, state.zoomOpg || 1);
    const scale = Math.min(w / Math.max(arch.length, 1), h / arch.height) * z;
    const pw = arch.length * scale;
    const ph = arch.height * scale;
    arch.map = { x0: (w - pw) * 0.5, y0: (h - ph) * 0.5, pw, ph };
  }

  function opgHuKey(arch) {
    return [arch.length.toFixed(2), arch.v0.toFixed(2), arch.v1.toFixed(2), state.layers.ct ? 1 : 0].join("|");
  }

  function getOpgHu(arch) {
    const key = opgHuKey(arch);
    if (state._opgHu && state._opgHu.key === key) return state._opgHu;
    const rw = 1280, rh = 360;
    const hu = new Int16Array(rw * rh);
    hu.fill(-1000);
    if (state.layers.ct) {
      const slab = 1.0;
      for (let x = 0; x < rw; x++) {
        const u = (x / (rw - 1)) * arch.length;
        const samp = arch.samples[Math.min(arch.samples.length - 1, Math.round(u / arch.length * (arch.samples.length - 1)))];
        const buccal = norm(cross(arch.up, samp.t));
        for (let y = 0; y < rh; y++) {
          const v = arch.v0 + (1 - y / (rh - 1)) * arch.height;
          let s = 0, n = 0;
          for (let t = -slab * 0.5; t <= slab * 0.5; t += 0.5) {
            const p = add(add(samp.p, arch.up, v), buccal, t);
            s += sampleHu(state.vol, p[0], p[1], p[2]);
            n++;
          }
          hu[y * rw + x] = n ? (s / n) : -1000;
        }
      }
    }
    const pack = { key, hu, rw, rh };
    state._opgHu = pack;
    state._opgRay = null;
    return pack;
  }

  function getOpgRay(arch, wl) {
    const pack = getOpgHu(arch);
    const wlk = wl.win.toFixed(1) + "/" + wl.lev.toFixed(1);
    if (state._opgRay && state._opgRay.huKey === pack.key && state._opgRay.wlk === wlk)
      return state._opgRay.cv;
    const rw = pack.rw, rh = pack.rh, hu = pack.hu;
    const cv = document.createElement("canvas");
    cv.width = rw;
    cv.height = rh;
    const img = new ImageData(rw, rh);
    const win = wl.win, lev = wl.lev;
    for (let i = 0; i < hu.length; i++) {
      let g = (hu[i] - lev) / win + 0.5;
      if (g < 0) g = 0; if (g > 1) g = 1;
      const o = i * 4, c = g * 255;
      img.data[o] = c; img.data[o + 1] = c; img.data[o + 2] = c; img.data[o + 3] = 255;
    }
    cv.getContext("2d").putImageData(img, 0, 0);
    state._opgRay = { huKey: pack.key, wlk, cv };
    return cv;
  }

  function opgMeshKey(arch) {
    const L = state.layers || {};
    const parts = [arch.length.toFixed(2), arch.v0.toFixed(2), arch.v1.toFixed(2), arch.samples.length, state.site && state.site.id || "",
      state.showRest === false ? 0 : 1, state.showEdit === false ? 0 : 1, state.poseLead || "",
      L.implant === false ? 0 : 1, L.abutment === false ? 0 : 1, L.sleeve === false ? 0 : 1, L.pin === false ? 0 : 1];
    for (const m of state.scene.meshes || []) {
      if (m.kind !== "sleeve" && m.kind !== "shaft" && m.kind !== "pin" && m.kind !== "abutment" && m.kind !== "implant") continue;
      parts.push(m.id || m.name || "", m.visible === false ? 0 : 1, meshOpacityOf(m).toFixed(2),
        (m.transform || []).join(","), (m._restT || []).join(","));
    }
    return parts.join("|");
  }

  function getOpgMeshes(arch) {
    const key = opgMeshKey(arch);
    if (state._opgMesh && state._opgMesh.key === key) return state._opgMesh;
    if (ensureOpgGl()) {
      try {
        const sprites = buildOpgSprites(arch);
        if (sprites.length) {
          state._opgMesh = { key, mode: "gl", sprites };
          return state._opgMesh;
        }
      } catch (e) { /* fall back to 2D */ }
    }
    const rw = 1920, rh = 540;
    const cv = document.createElement("canvas");
    cv.width = rw;
    cv.height = rh;
    const saved = arch.map;
    arch.map = { x0: 0, y0: 0, pw: rw, ph: rh };
    const boxes = drawMeshesOnOpg2d(cv.getContext("2d"), rw, rh, arch) || [];
    arch.map = saved;
    state._opgMesh = { key, mode: "2d", cv, boxes, rw, rh };
    return state._opgMesh;
  }

  function paintOpgMeshes(ctx, arch, pack) {
    ctx.setLineDash([]);
    let boxes = [];
    if (pack && pack.mode === "gl" && pack.sprites) {
      ctx.imageSmoothingEnabled = true;
      if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = "high";
      for (const s of pack.sprites) {
        const p0 = archToXy(arch, s.u0, s.v1);
        const p1 = archToXy(arch, s.u1, s.v0);
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
        if (dx < 1 || dy < 1) continue;
        ctx.drawImage(s.cv, p0[0], p0[1], dx, dy);
        if (s.site)
          boxes.push({ site: s.site, kind: s.kind, minx: p0[0], miny: p0[1], maxx: p1[0], maxy: p1[1] });
      }
    } else if (pack && pack.cv) {
      ctx.drawImage(pack.cv, arch.map.x0, arch.map.y0, arch.map.pw, arch.map.ph);
      const kx = arch.map.pw / pack.rw, ky = arch.map.ph / pack.rh;
      boxes = (pack.boxes || []).map(b => ({
        site: b.site, kind: b.kind,
        minx: arch.map.x0 + b.minx * kx, miny: arch.map.y0 + b.miny * ky,
        maxx: arch.map.x0 + b.maxx * kx, maxy: arch.map.y0 + b.maxy * ky
      }));
    }
    const mid = archToXy(arch, 0, 0);
    ctx.strokeStyle = "#e11";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(arch.map.x0, mid[1]);
    ctx.lineTo(arch.map.x0 + arch.map.pw, mid[1]);
    ctx.stroke();
    return boxes;
  }

  function opgOrthoFrame(arch, site, mesh, xform) {
    const anchor = (site && site.origin) || meshAnchor(mesh);
    const hit = projectOnArchFast(arch, anchor);
    const samp = arch.samples[Math.max(0, Math.min(arch.samples.length - 1, hit.i))];
    const up = norm(arch.up);
    let tan = norm(samp.t);
    tan = norm(add(tan, up, -dot3(tan, up)));
    if (Math.hypot(tan[0], tan[1], tan[2]) < 1e-5) tan = norm(samp.t);
    const view = norm(cross(up, tan));
    return { u0: hit.u, v0: hit.v, o: anchor, tan, up, view };
  }

  function projectOpgMesh(m, arch, xform, site) {
    const pos = m._pos, idx = m._idx, tr = xform || m.transform;
    if (!pos || !pos.length) return { tris: [] };
    const f = opgOrthoFrame(arch, site, m, tr);
    const cache = [];
    const vert = i => {
      if (cache[i]) return cache[i];
      const p = xfm(tr, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      const dx = p[0] - f.o[0], dy = p[1] - f.o[1], dz = p[2] - f.o[2];
      const u = f.u0 + dx * f.tan[0] + dy * f.tan[1] + dz * f.tan[2];
      const v = f.v0 + dx * f.up[0] + dy * f.up[1] + dz * f.up[2];
      const b = dx * f.view[0] + dy * f.view[1] + dz * f.view[2];
      const xy = archToXy(arch, u, v);
      return cache[i] = { x: xy[0], y: xy[1], b, p };
    };
    const tris = idx ? idx.length / 3 : pos.length / 9;
    const step = 1;
    const out = [];
    for (let t = 0; t < tris; t += step) {
      const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const a = vert(i0), b = vert(i1), c = vert(i2);
      const e1x = b.p[0] - a.p[0], e1y = b.p[1] - a.p[1], e1z = b.p[2] - a.p[2];
      const e2x = c.p[0] - a.p[0], e2y = c.p[1] - a.p[1], e2z = c.p[2] - a.p[2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const nd = Math.abs((nx * f.view[0] + ny * f.view[1] + nz * f.view[2]) / nl);
      out.push({
        a: [a.x, a.y], b: [b.x, b.y], c: [c.x, c.y],
        shade: 0.42 + 0.58 * nd,
        depth: (a.b + b.b + c.b) / 3
      });
    }
    out.sort((x, y) => x.depth - y.depth);
    return { tris: out };
  }

  function archToXy(arch, u, v) {
    const m = arch.map;
    return [
      m.x0 + (u / arch.length) * m.pw,
      m.y0 + (1 - (v - arch.v0) / arch.height) * m.ph
    ];
  }

  function opgXy(arch, w, h, p) {
    const q = projectOnArch(arch, p);
    const xy = archToXy(arch, q.u, q.v);
    return [xy[0], xy[1], q];
  }

  function buccalOf(arch, p) {
    const hit = projectOnArch(arch, p);
    const samp = arch.samples[hit.i];
    const b = norm(cross(arch.up, samp.t));
    const d = [p[0] - samp.p[0], p[1] - samp.p[1], p[2] - samp.p[2]];
    return { u: hit.u, v: hit.v, b: d[0] * b[0] + d[1] * b[1] + d[2] * b[2] };
  }

  function projectOnArchFast(arch, p) {
    const s = arch.samples;
    let best = 0, bestD = 1e12;
    for (let i = 0; i < s.length; i += 4) {
      const q = s[i].p;
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const lo = Math.max(0, best - 4), hi = Math.min(s.length - 1, best + 4);
    for (let i = lo; i <= hi; i++) {
      const q = s[i].p;
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const samp = s[best];
    const v = (p[0] - samp.p[0]) * arch.up[0] + (p[1] - samp.p[1]) * arch.up[1] + (p[2] - samp.p[2]) * arch.up[2];
    const bvec = norm(cross(arch.up, samp.t));
    const dlt = [p[0] - samp.p[0], p[1] - samp.p[1], p[2] - samp.p[2]];
    return { i: best, u: samp.u, v, b: dlt[0] * bvec[0] + dlt[1] * bvec[1] + dlt[2] * bvec[2] };
  }

  function meshAnchor(m) {
    const sites = (state.scene && state.scene.sites) || [];
    for (const s of sites) {
      if (meshBelongsToSite(m, s)) return s.origin;
    }
    if (m.transform) return [m.transform[3], m.transform[7], m.transform[11]];
    return [0, 0, 0];
  }

  function siteOfMesh(m) {
    const sites = (state.scene && state.scene.sites) || [];
    for (const s of sites) {
      if (meshBelongsToSite(m, s)) return s;
    }
    return null;
  }

  function opgPlanningMeshes() {
    return (state.scene.meshes || []).filter(m =>
      m._pos && m.visible !== false && m.kind !== "shaft" && state.layers[m.kind] !== false
      && (m.kind === "implant" || m.kind === "abutment" || m.kind === "sleeve" || m.kind === "pin"));
  }

  function opgSiteMeshes(site) {
    return opgPlanningMeshes().filter(m => meshBelongsToSite(m, site));
  }

  function ensureOpgGl() {
    if (state._opgGl && state._opgGl.gl && !state._opgGl.gl.isContextLost()) return state._opgGl;
    const cv = document.createElement("canvas");
    cv.width = 768;
    cv.height = 768;
    const gl = cv.getContext("webgl", {
      antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, depth: true
    });
    if (!gl) return null;
    const vs = "attribute vec3 a;attribute vec3 n;uniform mat4 mvp;uniform mat4 view;varying vec3 vN;void main(){vN=mat3(view)*n;gl_Position=mvp*vec4(a,1.0);}";
    const fs = [
      "precision mediump float;varying vec3 vN;uniform vec3 col;uniform float op;",
      "uniform vec3 keyDir;uniform vec3 fillDir;uniform vec3 hemiDir;",
      "vec3 s2l(vec3 c){return pow(max(c,0.0),vec3(2.2));}",
      "vec3 l2s(vec3 c){return pow(clamp(c,0.0,1.0),vec3(0.45454545));}",
      "vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}",
      "void main(){vec3 N=normalize(vN);if(!gl_FrontFacing)N=-N;vec3 V=vec3(0.0,0.0,1.0);",
      "vec3 albedo=s2l(col);vec3 amb=vec3(0.36);",
      "vec3 sky=s2l(vec3(0.9490196,0.9338882,0.9098039));",
      "vec3 gnd=s2l(vec3(0.2901961,0.2509804,0.2352941));",
      "float hw=0.5*dot(N,normalize(hemiDir))+0.5;vec3 hemi=mix(gnd,sky,hw)*0.05;",
      "vec3 K=normalize(keyDir);vec3 F=normalize(fillDir);",
      "vec3 fillC=s2l(vec3(0.9098039,0.8627451,0.7843137))*0.18;",
      "float ndk=max(dot(N,K),0.0);float ndf=max(dot(N,F),0.0);",
      "vec3 spec=s2l(vec3(0.018));",
      "float sk=pow(max(dot(reflect(-K,N),V),0.0),36.0);",
      "float sf=pow(max(dot(reflect(-F,N),V),0.0),36.0);",
      "vec3 lit=albedo*(amb+hemi+vec3(0.50)*ndk+fillC*ndf)+spec*(vec3(0.50)*sk+fillC*sf);",
      "gl_FragColor=vec4(l2s(aces(lit)),op);}"
    ].join("");
    const p = gl.createProgram();
    try {
      gl.attachShader(p, compileChecked(gl, gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compileChecked(gl, gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
    } catch (e) {
      return null;
    }
    state._opgGl = {
      gl, cv, p, loc: {
        a: gl.getAttribLocation(p, "a"), n: gl.getAttribLocation(p, "n"),
        mvp: gl.getUniformLocation(p, "mvp"), view: gl.getUniformLocation(p, "view"),
        keyDir: gl.getUniformLocation(p, "keyDir"), fillDir: gl.getUniformLocation(p, "fillDir"),
        hemiDir: gl.getUniformLocation(p, "hemiDir"), col: gl.getUniformLocation(p, "col"),
        op: gl.getUniformLocation(p, "op")
      }
    };
    return state._opgGl;
  }

  // D3D-OPG-ORTHO — одна ортокамера на сайт: взгляд строго буккально, без перспективы и без проекции на дугу.
  function renderOpgSiteSprite(arch, site, meshes) {
    const pack = ensureOpgGl();
    if (!pack || !meshes || !meshes.length) return null;
    const f = opgOrthoFrame(arch, site, meshes[0], meshes[0].transform);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (const m of meshes) {
      const pos = m._pos, tr = m.transform, n = pos.length / 3;
      const step = n > 24000 ? Math.floor(n / 12000) : 1;
      for (let i = 0; i < n; i += step) {
        const p = xfm(tr, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        const dx = p[0] - f.o[0], dy = p[1] - f.o[1], dz = p[2] - f.o[2];
        const u = dx * f.tan[0] + dy * f.tan[1] + dz * f.tan[2];
        const v = dx * f.up[0] + dy * f.up[1] + dz * f.up[2];
        const b = dx * f.view[0] + dy * f.view[1] + dz * f.view[2];
        if (u < u0) u0 = u; if (u > u1) u1 = u;
        if (v < v0) v0 = v; if (v > v1) v1 = v;
        if (b < b0) b0 = b; if (b > b1) b1 = b;
      }
    }
    if (!(u1 > u0) || !(v1 > v0)) return null;
    const pad = 0.45;
    u0 -= pad; u1 += pad; v0 -= pad; v1 += pad;
    const mmW = u1 - u0, mmH = v1 - v0;
    const tw = 768, th = 768;
    const gl = pack.gl, cv = pack.cv;
    gl.viewport(0, 0, tw, th);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const midU = (u0 + u1) * 0.5, midV = (v0 + v1) * 0.5;
    const target = add(add(f.o, f.tan, midU), f.up, midV);
    const dist = Math.max(14, (b1 - b0) * 0.5 + 10);
    const eye = add(target, f.view, dist);
    const right = f.tan, up = f.up, back = f.view;
    const proj = ortho(-mmW * 0.5, mmW * 0.5, -mmH * 0.5, mmH * 0.5, 0.4, dist * 2 + 50);
    const view = new Float32Array([
      right[0], up[0], back[0], 0,
      right[1], up[1], back[1], 0,
      right[2], up[2], back[2], 0,
      -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]),
      -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]),
      -(back[0] * eye[0] + back[1] * eye[1] + back[2] * eye[2]),
      1
    ]);
    const mvp = mul4(proj, view);
    gl.useProgram(pack.p);
    gl.uniformMatrix4fv(pack.loc.mvp, false, mvp);
    gl.uniformMatrix4fv(pack.loc.view, false, view);
    gl.uniform3f(pack.loc.keyDir, 42, 58, dist + 18);
    gl.uniform3f(pack.loc.fillDir, -48, 28, dist + 35);
    gl.uniform3f(pack.loc.hemiDir, right[1], up[1], back[1]);
    const rgbOf = {
      implant: [0.886, 0.141, 0.141],
      abutment: [0.604, 0.894, 0.216],
      sleeve: [0.784, 0.800, 0.816],
      pin: [0.494, 0.863, 0.941]
    };
    const rank = { sleeve: 0, abutment: 1, implant: 2, pin: 2 };
    const ordered = meshes.slice().sort((a, b) => (rank[a.kind] || 0) - (rank[b.kind] || 0));
    for (const m of ordered) {
      if (!m._glOpg) {
        try { uploadMesh3d(gl, m, m.transform, "_glOpg"); }
        catch (e) { m._glOpg = { pb: null, nb: null, count: 0 }; }
      }
      const buf = m._glOpg;
      if (!buf || !buf.count) continue;
      gl.uniform3fv(pack.loc.col, rgbOf[m.kind] || [0.7, 0.7, 0.7]);
      gl.uniform1f(pack.loc.op, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.pb);
      gl.enableVertexAttribArray(pack.loc.a);
      gl.vertexAttribPointer(pack.loc.a, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.nb);
      gl.enableVertexAttribArray(pack.loc.n);
      gl.vertexAttribPointer(pack.loc.n, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, buf.count);
    }
    const snap = document.createElement("canvas");
    snap.width = tw;
    snap.height = th;
    snap.getContext("2d").drawImage(cv, 0, 0);
    return {
      cv: snap, site, kind: (site && site.kind) || meshes[0].kind, meshes,
      u0: f.u0 + u0, u1: f.u0 + u1, v0: f.v0 + v0, v1: f.v0 + v1
    };
  }

  function buildOpgSprites(arch) {
    const sprites = [], used = new Set();
    for (const s of (state.scene.sites || [])) {
      if (!s || !s.origin) continue;
      const meshes = opgSiteMeshes(s);
      if (!meshes.length) continue;
      const spr = renderOpgSiteSprite(arch, s, meshes);
      if (!spr) continue;
      sprites.push(spr);
      for (const m of meshes) used.add(m);
    }
    for (const m of opgPlanningMeshes()) {
      if (used.has(m)) continue;
      const spr = renderOpgSiteSprite(arch, { origin: meshAnchor(m), kind: m.kind, id: m.id }, [m]);
      if (spr) sprites.push(spr);
    }
    return sprites;
  }

  function drawMeshesOnOpg2d(ctx, w, h, arch) {
    ctx.setLineDash([]);
    const rgbOf = {
      implant: [226, 36, 36], pin: [126, 220, 240],
      sleeve: [200, 204, 208], shaft: [138, 150, 158], abutment: [154, 228, 55]
    };
    const boxes = [];
    try {
      const kinds = ["sleeve", "pin", "abutment", "implant"];
      const layers = [];
      for (const kind of kinds) {
        if (state.layers[kind] === false) continue;
        const meshes = (state.scene.meshes || []).filter(m => m.kind === kind && m.visible !== false && m._pos);
        const base = rgbOf[kind] || [200, 200, 200];
        for (const m of meshes) {
          const pack = projectOpgMesh(m, arch, m.transform, siteOfMesh(m));
          if (!pack.tris.length) continue;
          const hot = meshBelongsToSite(m, state.site);
          layers.push({
            pack, base, a: meshOpacityOf(m), boost: hot ? 1.08 : 0.95,
            hot, site: siteOfMesh(m), kind
          });
        }
      }
      layers.sort((x, y) => (x.hot === y.hot ? 0 : x.hot ? 1 : -1));
      for (const it of layers) {
        let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
        for (const tri of it.pack.tris) {
          const s = Math.min(1.2, tri.shade * it.boost);
          ctx.fillStyle = "rgba(" +
            Math.round(Math.min(255, it.base[0] * s)) + "," +
            Math.round(Math.min(255, it.base[1] * s)) + "," +
            Math.round(Math.min(255, it.base[2] * s)) + "," + (0.92 * it.a) + ")";
          ctx.beginPath();
          ctx.moveTo(tri.a[0], tri.a[1]);
          ctx.lineTo(tri.b[0], tri.b[1]);
          ctx.lineTo(tri.c[0], tri.c[1]);
          ctx.closePath();
          ctx.fill();
          minx = Math.min(minx, tri.a[0], tri.b[0], tri.c[0]);
          miny = Math.min(miny, tri.a[1], tri.b[1], tri.c[1]);
          maxx = Math.max(maxx, tri.a[0], tri.b[0], tri.c[0]);
          maxy = Math.max(maxy, tri.a[1], tri.b[1], tri.c[1]);
        }
        if (it.site && maxx > minx)
          boxes.push({ site: it.site, kind: it.kind, minx, miny, maxx, maxy });
      }
    } catch (e) { /* keep RAY even if overlay fails */ }
    return boxes;
  }

  function renderOpg() {
    const canvas = document.getElementById("cv-opg");
    if (!canvas || !state.vol) return;
    const w = Math.max(2, canvas.clientWidth || 640), h = Math.max(2, canvas.clientHeight || 160);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    const arch = buildArch();
    ctx.fillStyle = "#2a2a30";
    ctx.fillRect(0, 0, w, h);
    if (!arch) {
      document.getElementById("meta-opg").textContent = "RAY";
      state._opg = null;
      return;
    }
    fitArchFrame(arch, w, h);
    const wl = ctWinLev("opg");
    const map = arch.map;
    const ray = getOpgRay(arch, wl);
    const mesh = getOpgMeshes(arch);
    ctx.drawImage(ray, map.x0, map.y0, map.pw, map.ph);
    const boxes = paintOpgMeshes(ctx, arch, mesh);
    const hits = [];
    for (const s of arch.sites) {
      const a = opgXy(arch, w, h, add(s.origin, s.axis, s.kind === "pin" ? -18 : -8));
      const b = opgXy(arch, w, h, add(s.origin, s.axis, s.kind === "pin" ? 18 : 12));
      const mid = projectOnArch(arch, s.origin);
      const plat = projectOnArch(arch, add(s.origin, s.axis, 0));
      const xy = archToXy(arch, mid.u, plat.v);
      const sel = state.site && state.site.id === s.id;
      if (s.kind !== "implant") {
        ctx.strokeStyle = sel ? "rgba(226,36,36,0.95)" : "rgba(226,36,36,0.8)";
        ctx.lineWidth = sel ? 4 : 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      if (state.layers.abutment !== false && s.mu_origin && s.mu_axis) {
        const up = muAxisUp(s);
        const ma = opgXy(arch, w, h, add(s.mu_origin, up, -10));
        const mb = opgXy(arch, w, h, add(s.mu_origin, up, 24));
        ctx.strokeStyle = sel ? "rgba(232,196,72,0.95)" : "rgba(232,196,72,0.8)";
        ctx.lineWidth = sel ? 3.4 : 2.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ma[0], ma[1]); ctx.lineTo(mb[0], mb[1]);
        ctx.stroke();
      }
      ctx.fillStyle = sel ? "#fff" : "rgba(226,232,240,0.85)";
      ctx.font = "bold 14px system-ui";
      ctx.textAlign = "center";
      const lab = s.tooth || s.id || "";
      const labText = /pin/i.test(lab) ? lab : ((s.kind === "pin" ? "Pin " : "") + lab);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.lineJoin = "round";
      ctx.strokeText(labText, xy[0], xy[1] - 10);
      ctx.fillText(labText, xy[0], xy[1] - 10);
      hits.push({ site: s, x: xy[0], y: xy[1], x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
    }
    document.getElementById("meta-opg").textContent = "RAY  Th: 1.0 mm  W/L: 4000 / 1000  " +
      (state.zoomOpg || 1).toFixed(2) + "×";
    state._opg = { arch, hits, boxes, w, h };
  }

  function distToSeg2(x, y, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const L2 = dx * dx + dy * dy || 1;
    let t = ((x - x0) * dx + (y - y0) * dy) / L2;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t));
  }

  function hitOpgSite(x, y) {
    const opg = state._opg;
    if (!opg) return null;
    const rank = { implant: 0, pin: 1, abutment: 2, sleeve: 3, shaft: 4 };
    let best = null, bestR = 99, bestArea = 1e12;
    const pad = 6;
    for (const b of opg.boxes || []) {
      if (x < b.minx - pad || x > b.maxx + pad || y < b.miny - pad || y > b.maxy + pad)
        continue;
      const r = rank[b.kind] ?? 5;
      const area = Math.max(1, (b.maxx - b.minx) * (b.maxy - b.miny));
      if (r < bestR || (r === bestR && area < bestArea)) {
        best = b.site;
        bestR = r;
        bestArea = area;
      }
    }
    if (best) return best;
    let axisBest = null, axisD = 16;
    for (const h of opg.hits || []) {
      if (h.x0 == null) continue;
      const d = distToSeg2(x, y, h.x0, h.y0, h.x1, h.y1);
      if (d < axisD) { axisD = d; axisBest = h.site; }
    }
    if (axisBest) return axisBest;
    let labBest = null, labD = 14;
    for (const h of opg.hits || []) {
      const d = Math.hypot(h.x - x, h.y - 10 - y);
      if (d < labD) { labD = d; labBest = h.site; }
    }
    return labBest;
  }

  function drawOverlays(ctx, w, h, plane, clear) {
    if (clear) ctx.clearRect(0, 0, w, h);
    const strokeRgba = (rgb, k, a) =>
      "rgba(" + Math.round(rgb[0] * k) + "," + Math.round(rgb[1] * k) + "," +
      Math.round(rgb[2] * k) + "," + a + ")";
    const drawAxisSeg = (p0, p1, rgb, sel, along) => {
      const k = sel ? 1 : 0.82;
      const a = sel ? 1 : 0.8;
      ctx.strokeStyle = strokeRgba(rgb, k, a);
      ctx.fillStyle = strokeRgba(rgb, k, a);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (along > 0.72) {
        const x = (p0[0] + p1[0]) * 0.5, y = (p0[1] + p1[1]) * 0.5;
        const r = sel ? 6.2 : 5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = sel ? 2.6 : 2;
        ctx.stroke();
        return;
      }
      ctx.lineWidth = sel ? 4.6 : 3.4;
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.stroke();
    };
    const drawSiteAxes = selOnly => {
      for (const s of state.scene.sites || []) {
        if (s.kind === "implant" || (s.kind === "pin" && !state.layers.pin)) continue;
        const sel = !!(state.site && state.site.id === s.id);
        if (sel !== selOnly) continue;
        const rgb = s.kind === "pin" ? [134, 239, 172] : [226, 36, 36];
        const along = Math.abs(dot3(norm(plane.normal), norm(s.axis || [0, 0, 1])));
        const a = worldToCanvas(plane, w, h, add(s.origin, s.axis, -16));
        const b = worldToCanvas(plane, w, h, add(s.origin, s.axis, 16));
        drawAxisSeg(a, b, rgb, sel, along);
        if (state.layers.abutment && s.mu_origin && s.mu_axis) {
          const up = muAxisUp(s);
          const muAlong = Math.abs(dot3(norm(plane.normal), up));
          const ma = worldToCanvas(plane, w, h, add(s.mu_origin, up, -14));
          const mb = worldToCanvas(plane, w, h, add(s.mu_origin, up, 26));
          drawAxisSeg(ma, mb, [232, 196, 72], sel, muAlong);
        }
      }
    };
    drawSiteAxes(false);
    if (state.layers.scan) drawMeshCuts(ctx, w, h, plane, "scan");
    if (state.layers.bone) drawMeshCuts(ctx, w, h, plane, "bone");
    if (state.layers.anatomy) drawMeshCuts(ctx, w, h, plane, "anatomy");
    if (state.layers.teeth) drawMeshCuts(ctx, w, h, plane, "teeth");
    if (state.layers.nerve) drawMeshCuts(ctx, w, h, plane, "nerve");
    if (state.layers.guide) drawMeshCuts(ctx, w, h, plane, "guide");
    if (state.layers.bar) drawMeshCuts(ctx, w, h, plane, "bar");
    if (state.layers.waxup) drawMeshCuts(ctx, w, h, plane, "waxup");
    if (state.layers.soft) drawMeshCuts(ctx, w, h, plane, "soft");
    if (state.layers.sleeve) drawMeshCuts(ctx, w, h, plane, "sleeve");
    if (state.layers.shaft) drawMeshCuts(ctx, w, h, plane, "shaft");
    if (state.layers.security) drawMeshCuts(ctx, w, h, plane, "security");
    if (state.layers.thickness) drawMeshCuts(ctx, w, h, plane, "thickness");
    if (state.layers.abutment) drawMeshCuts(ctx, w, h, plane, "abutment");
    if (state.layers.analog) drawMeshCuts(ctx, w, h, plane, "analog");
    if (state.layers.implant) drawMeshCuts(ctx, w, h, plane, "implant");
    if (state.layers.pin) drawMeshCuts(ctx, w, h, plane, "pin");
    drawSiteAxes(true);
    if (state.site && canEditPose()) {
      const along = Math.abs(dot3(norm(plane.normal), norm(state.site.axis || [0, 0, 1])));
      drawSiteGizmos(ctx, w, h, plane, along > 0.85 ? ["move", "spin"] : ["move", "tiltApex", "tiltCrown"]);
    }
    if (state.layers.ruler && !state._live) {
      for (const m of state.measurements) {
        const pa = worldToCanvas(plane, w, h, [m.ax, m.ay, m.az]);
        const pb = worldToCanvas(plane, w, h, [m.bx, m.by, m.bz]);
        drawRulerSeg(ctx, pa, pb, (m.distance_mm).toFixed(2) + " mm", m === state.selRuler);
      }
      if (state.draft) {
        const p = worldToCanvas(plane, w, h, state.draft.a);
        if (state.draft.b) {
          const q = worldToCanvas(plane, w, h, state.draft.b);
          const d = Math.hypot(
            state.draft.b[0] - state.draft.a[0],
            state.draft.b[1] - state.draft.a[1],
            state.draft.b[2] - state.draft.a[2]);
          drawRulerSeg(ctx, p, q, d.toFixed(2) + " mm");
        } else {
          drawRulerHandle(ctx, p[0], p[1]);
        }
      }
    }
    if (state.layers.marker) drawMarkerStrokes(ctx, plane, w, h);
    if (state.layers.comment) drawComments(ctx, plane, w, h);
  }

  function drawComments(ctx, plane, w, h) {
    ctx.font = "600 12px system-ui, Segoe UI, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const c of state.comments) {
      if (!c || !c.text) continue;
      if (distToPlane(plane, [c.x, c.y, c.z]) > 1.6) continue;
      const p = worldToCanvas(plane, w, h, [c.x, c.y, c.z]);
      const pad = 5;
      const tw = ctx.measureText(c.text).width;
      const bx = p[0] + 8, by = p[1] - 16;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p[0], p[1], 3.4, 0, Math.PI * 2);
      ctx.fillStyle = "#ff88b4";
      ctx.fill();
      ctx.fillStyle = "rgba(40, 28, 48, 0.92)";
      ctx.fillRect(bx - pad, by - 9, tw + pad * 2, 18);
      ctx.strokeStyle = "rgba(255, 120, 160, 0.55)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - pad, by - 9, tw + pad * 2, 18);
      ctx.fillStyle = "#ffe8f0";
      ctx.fillText(c.text, bx, by);
    }
  }

  function beginCommentEdit(host, sx, sy, initial, done) {
    const old = host.querySelector(".comment-edit");
    if (old) old.remove();
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "comment-edit";
    inp.value = initial || "";
    inp.placeholder = "Комментарий…";
    inp.style.left = Math.max(8, sx) + "px";
    inp.style.top = Math.max(8, sy) + "px";
    host.appendChild(inp);
    inp.focus();
    inp.select();
    let doneOnce = false;
    const finish = ok => {
      if (doneOnce) return;
      doneOnce = true;
      const t = inp.value.trim();
      inp.remove();
      done(ok ? t : null);
    };
    inp.onkeydown = ev => {
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    };
    inp.onblur = () => finish(true);
  }

  function hitComment(plane, w, h, x, y) {
    let best = null, bestD = 16;
    for (const c of state.comments) {
      if (!c) continue;
      if (distToPlane(plane, [c.x, c.y, c.z]) > 1.6) continue;
      const p = worldToCanvas(plane, w, h, [c.x, c.y, c.z]);
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  function mprSlotOn(slot) {
    if (!isMobileLayout()) return true;
    return paneShows(slot === "long" ? "cross" : "axial");
  }

  function paintMprMeta() {
    if (!state.vol) return;
    const wlL = ctWinLev("long");
    const wlA = ctWinLev("ax");
    const a = document.getElementById("meta-long");
    const b = document.getElementById("meta-ax");
    if (a) a.textContent = "Вдоль  Th: " + state.vol.spacing[2].toFixed(2) + " mm  W/L: " +
      Math.round(wlL.win) + "/" + Math.round(wlL.lev) +
      "  " + state.rotLong.toFixed(0) + "°  " + (state.zoomLong || 1).toFixed(1) + "×";
    if (b) b.textContent = "Поперёк  Z: " + state.off.toFixed(1) + " mm  W/L: " +
      Math.round(wlA.win) + "/" + Math.round(wlA.lev) + "  " + (state.zoomAx || 1).toFixed(1) + "×";
  }

  function renderMpr(which) {
    if (!state.site || !state.vol) return;
    const planes = sitePlanes();
    const doLong = (!which || which === "long") && mprSlotOn("long");
    const doAx = (!which || which === "ax") && mprSlotOn("ax");
    const long = document.getElementById("cv-long");
    const ax = document.getElementById("cv-ax");
    const glLong = doLong ? !!drawGl("long", planes.long) : true;
    const glAx = doAx ? !!drawGl("ax", planes.axial) : true;
    const fit = (c) => {
      const w = c.clientWidth || 400, h = c.clientHeight || 220;
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      return [w, h];
    };
    if (doLong && !glLong) drawSliceCpu(long, planes.long, "long");
    if (doAx && !glAx) drawSliceCpu(ax, planes.axial, "ax");
    if (doLong) {
      const [lw, lh] = fit(long);
      drawOverlays(long.getContext("2d"), lw, lh, planes.long, glLong);
    }
    if (doAx) {
      const [aw, ah] = fit(ax);
      drawOverlays(ax.getContext("2d"), aw, ah, planes.axial, glAx);
    }
    paintMprMeta();
    state._planes = planes;
  }

  function renderMprCt(which) {
    if (!state.site || !state.vol) return;
    const planes = sitePlanes();
    if ((!which || which === "long") && mprSlotOn("long")) drawGl("long", planes.long);
    if ((!which || which === "ax") && mprSlotOn("ax")) drawGl("ax", planes.axial);
    paintMprMeta();
    state._planes = planes;
  }

  function hitSiteOnPlane(plane, w, h, x, y) {
    let best = null, bestD = 14;
    for (const s of state.scene.sites || []) {
      const a = worldToCanvas(plane, w, h, add(s.origin, s.axis, -16));
      const b = worldToCanvas(plane, w, h, add(s.origin, s.axis, 16));
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy || 1;
      let t = ((x - a[0]) * dx + (y - a[1]) * dy) / L2;
      if (t < 0) t = 0; if (t > 1) t = 1;
      const px = a[0] + dx * t, py = a[1] + dy * t;
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  function hitHandle(plane, w, h, x, y, slop) {
    let best = null, bestD = slop || 10;
    for (const m of state.measurements) {
      for (const end of ["a", "b"]) {
        const p = end === "a" ? [m.ax, m.ay, m.az] : [m.bx, m.by, m.bz];
        const c = worldToCanvas(plane, w, h, p);
        const d = Math.hypot(c[0] - x, c[1] - y);
        if (d < bestD) { bestD = d; best = { m, end }; }
      }
    }
    return best;
  }

  function hitRuler(plane, w, h, x, y, slop) {
    const handle = hitHandle(plane, w, h, x, y, slop);
    if (handle) return handle.m;
    let best = null, bestD = slop || 8;
    for (const m of state.measurements) {
      const a = worldToCanvas(plane, w, h, [m.ax, m.ay, m.az]);
      const b = worldToCanvas(plane, w, h, [m.bx, m.by, m.bz]);
      const d = distToSeg2(x, y, a[0], a[1], b[0], b[1]);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  function deleteSelRuler() {
    if (state.draft) {
      state.draft = null;
      renderMpr();
      return true;
    }
    if (!state.selRuler) return false;
    state.measurements = state.measurements.filter(m => m !== state.selRuler);
    state.selRuler = null;
    renderMpr();
    return true;
  }

  function clearRulers() {
    state.measurements = [];
    state.selRuler = null;
    state.draft = null;
    renderMpr();
  }

  function bindCanvas(id, which) {
    const cv = document.getElementById(id);
    cv.style.cursor = "grab";
    cv.style.touchAction = "none";
    let panRaf = 0;
    const fingers = new Map();
    let lastRulerTap = { t: 0, m: null };
    const paintPan = () => {
      panRaf = 0;
      renderMpr(which);
      if (state.drag && state.drag.gizmo) render3d();
    };
    const fingerMid = () => {
      let x = 0, y = 0, n = 0;
      fingers.forEach(p => { x += p.x; y += p.y; n++; });
      return n ? { x: x / n, y: y / n } : null;
    };
    const applySwipeZoom = (dy, zKey, slId, zMin, zMax) => {
      const z = Math.max(zMin, Math.min(zMax, (state[zKey] || 1) * Math.exp(-dy * 0.007)));
      state[zKey] = z;
      syncSlider(slId, z);
    };
    const onDown = ev => {
      if (ev.pointerType === "mouse" && ev.button !== 0 && ev.button !== 1) return;
      if (!state._planes) return;
      const r = cv.getBoundingClientRect();
      const plane = which === "long" ? state._planes.long : state._planes.axial;
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (ev.pointerType === "touch")
        fingers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (ev.button === 0 && state.site && !state.tool && canEditPose()) {
        const kinds = which === "ax" ? ["move", "spin"] : ["move", "tiltApex", "tiltCrown"];
        const giz = hitGizmoOnPlane(plane, cv.width, cv.height, x, y, kinds);
        if (giz) {
          beginGizmoDrag(giz, which, canvasToWorld(plane, cv.width, cv.height, x, y), plane.normal);
          ev.preventDefault();
          try { cv.setPointerCapture(ev.pointerId); } catch (_) { /* ok */ }
          renderMpr(which);
          render3d();
          return;
        }
      }
      if (state.layers.ruler && ev.button === 0) {
        const slop = ev.pointerType === "touch" ? 20 : 10;
        const hit = hitHandle(plane, cv.width, cv.height, x, y, slop);
        const rul = hit ? hit.m : hitRuler(plane, cv.width, cv.height, x, y, slop);
        if (rul) {
          if (ev.pointerType === "touch") {
            const now = performance.now();
            if (lastRulerTap.m === rul && now - lastRulerTap.t < 320) {
              state.selRuler = rul;
              state.draft = null;
              deleteSelRuler();
              lastRulerTap = { t: 0, m: null };
              state._skipClick = true;
              ev.preventDefault();
              return;
            }
            lastRulerTap = { t: now, m: rul };
          }
          state.selRuler = rul;
          state._skipClick = true;
          if (hit) state.drag = { ...hit, which };
          ev.preventDefault();
          renderMpr(which);
          return;
        }
      }
      if (state.tool === "marker" && state.layers.marker && ev.button === 0) {
        const p = canvasToWorld(plane, cv.width, cv.height, x, y);
        const stroke = {
          id: "k" + state.markers.length,
          color: state.markerColor,
          width: state.markerWidth,
          pts: [p]
        };
        state.markers.push(stroke);
        state.drag = { ink: true, which, stroke };
        cv.style.cursor = "crosshair";
        ev.preventDefault();
        renderMpr(which);
        return;
      }
      const wantPan = ev.pointerType === "touch" || ev.button === 1 || ev.button === 0 && (!state.tool || ev.shiftKey);
      if (wantPan) {
        const mid = fingerMid();
        const two = ev.pointerType === "touch" && fingers.size >= 2;
        const slice = !two && !state.tool && ev.button !== 1 && !ev.shiftKey;
        state.drag = {
          pan: !slice,
          slice: !!slice,
          which,
          x: two && mid ? mid.x : ev.clientX,
          y: two && mid ? mid.y : ev.clientY,
          axis: null,
          moved: false
        };
        state._live = true;
        cv.style.cursor = "grabbing";
        ev.preventDefault();
        try { cv.setPointerCapture(ev.pointerId); } catch (_) { /* ok */ }
      }
    };
    cv.addEventListener("pointerdown", onDown);
    const onMove = ev => {
      if (ev.pointerType === "touch" && fingers.has(ev.pointerId))
        fingers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (!state.drag || state.drag.which !== which || !state._planes) return;
      const r = cv.getBoundingClientRect();
      const plane = which === "long" ? state._planes.long : state._planes.axial;
      if (state.drag.slice && ev.pointerType === "touch" && fingers.size >= 2) {
        const mid = fingerMid();
        state.drag.pan = true;
        state.drag.slice = false;
        state.drag.axis = null;
        if (mid) { state.drag.x = mid.x; state.drag.y = mid.y; }
      }
      if (state.drag.gizmo) {
        const gizmoPlane = state.drag.plane || plane;
        const p = canvasToWorld(gizmoPlane, cv.width, cv.height, ev.clientX - r.left, ev.clientY - r.top);
        applyGizmoDrag(p, gizmoPlane);
        if (!panRaf) panRaf = requestAnimationFrame(paintPan);
        return;
      }
      if (state.drag.ink) {
        const p = canvasToWorld(plane, cv.width, cv.height, ev.clientX - r.left, ev.clientY - r.top);
        const pts = state.drag.stroke.pts;
        const last = pts[pts.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) >= 0.28)
          pts.push(p);
        renderMpr(which);
        return;
      }
      if (state.drag.slice) {
        const dx = ev.clientX - state.drag.x;
        const dy = ev.clientY - state.drag.y;
        if (Math.hypot(dx, dy) > 2) state.drag.moved = true;
        if (!state.drag.axis) {
          if (Math.hypot(dx, dy) < 8) return;
          state.drag.axis = Math.abs(dy) >= Math.abs(dx) ? "v" : "h";
        }
        if (state.drag.axis === "v") {
          applySwipeZoom(dy, which === "long" ? "zoomLong" : "zoomAx",
            which === "long" ? "sl-zoom-long" : "sl-zoom-ax", 1, 3);
        } else if (which === "ax") {
          state.off = Math.max(-40, Math.min(40, state.off + dx * 0.05));
          syncSlider("sl-off", state.off);
        } else {
          state.rotLong = (state.rotLong + dx * 0.35 + 360) % 360;
          syncSlider("sl-rot-long", state.rotLong);
        }
        state.drag.x = ev.clientX;
        state.drag.y = ev.clientY;
        if (!panRaf) panRaf = requestAnimationFrame(() => {
          panRaf = 0;
          renderMpr();
          if (state.drag && state.drag.gizmo) render3d();
        });
        return;
      }
      if (state.drag.pan) {
        const mid = ev.pointerType === "touch" && fingers.size >= 2 ? fingerMid() : null;
        const cx = mid ? mid.x : ev.clientX, cy = mid ? mid.y : ev.clientY;
        const dx = cx - state.drag.x;
        const dy = cy - state.drag.y;
        if (Math.hypot(dx, dy) > 2) state.drag.moved = true;
        const key = which === "long" ? "panLong" : "panAx";
        const p = state[key];
        const fit = planeView(plane, cv.clientWidth || cv.width, cv.clientHeight || cv.height);
        p[0] -= (dx / fit.dw) * fit.mmW;
        p[1] += (dy / fit.dh) * fit.mmH;
        state.drag.x = cx;
        state.drag.y = cy;
        if (!panRaf) panRaf = requestAnimationFrame(paintPan);
        return;
      }
      if (!state.drag.m) return;
      const p = canvasToWorld(plane, cv.width, cv.height, ev.clientX - r.left, ev.clientY - r.top);
      const m = state.drag.m;
      if (state.drag.end === "a") { m.ax = p[0]; m.ay = p[1]; m.az = p[2]; }
      else { m.bx = p[0]; m.by = p[1]; m.bz = p[2]; }
      m.distance_mm = Math.hypot(m.bx - m.ax, m.by - m.ay, m.bz - m.az);
      if (!panRaf) panRaf = requestAnimationFrame(paintPan);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("mousemove", ev => {
      if (ev.pointerType && ev.pointerType !== "mouse") return;
      onMove(ev);
    });
    const onUp = ev => {
      if (ev && ev.pointerType === "touch") fingers.delete(ev.pointerId);
      if (state.drag && state.drag.which === which) {
        if (ev && ev.pointerType === "touch" && fingers.size) return;
        cv.style.cursor = (state.tool === "marker" || state.tool === "comment") ? "crosshair" : "grab";
        if ((state.drag.pan || state.drag.slice) && state.drag.moved) state._skipClick = true;
        if (state.drag.ink) state._skipClick = true;
        if (state.drag.gizmo) { state._skipClick = true; endGizmoDrag(); }
        state.drag = null;
        state._live = false;
        if (panRaf) { cancelAnimationFrame(panRaf); panRaf = 0; }
        renderMpr();
        renderOpg();
        render3d();
      }
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("mouseup", onUp);
    cv.addEventListener("auxclick", ev => ev.preventDefault());
    let wheelRaf = 0, wheelEnd = 0;
    cv.addEventListener("wheel", ev => {
      ev.preventDefault();
      if (state.drag && state.drag.gizmo) return;
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
      const dy = ev.deltaY * unit;
      if (which === "long") {
        state.rotLong = (state.rotLong + dy * 0.003 + 360) % 360;
        syncSlider("sl-rot-long", state.rotLong);
      } else {
        state.off = Math.max(-40, Math.min(40, state.off + dy * 0.0007));
        syncSlider("sl-off", state.off);
      }
      state._live = true;
      if (!wheelRaf) wheelRaf = requestAnimationFrame(() => {
        wheelRaf = 0;
        renderMpr(which);
      });
      clearTimeout(wheelEnd);
      wheelEnd = setTimeout(() => {
        state._live = false;
        renderMpr(which);
      }, 90);
    }, { passive: false });
    cv.addEventListener("click", ev => {
      if (state.drag || state._skipClick) { state._skipClick = false; return; }
      const r = cv.getBoundingClientRect();
      const plane = which === "long" ? state._planes.long : state._planes.axial;
      if (!state.tool && state._planes) {
        const hit = hitSiteOnPlane(plane, cv.width, cv.height, ev.clientX - r.left, ev.clientY - r.top);
        if (hit) { openSite(hit); return; }
      }
      if (!state.tool || !state._planes) return;
      const p = canvasToWorld(plane, cv.width, cv.height, ev.clientX - r.left, ev.clientY - r.top);
      if (state.tool === "ruler") {
        if (!state.draft) {
          state.measurements = [];
          state.selRuler = null;
          state.draft = { a: p };
        } else {
          const a = state.draft.a;
          const d = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
          const added = { id: "r0", kind: "ruler", ax: a[0], ay: a[1], az: a[2], bx: p[0], by: p[1], bz: p[2], distance_mm: d };
          state.measurements = [added];
          state.selRuler = added;
          state.draft = null;
        }
        renderMpr();
      } else if (state.tool === "marker") {
        return;
      } else if (state.tool === "comment") {
        const host = cv.parentElement;
        const exist = hitComment(plane, cv.width, cv.height, ev.clientX - r.left, ev.clientY - r.top);
        beginCommentEdit(host, ev.clientX - r.left, ev.clientY - r.top, exist ? exist.text : "", text => {
          if (exist) {
            if (!text) state.comments = state.comments.filter(c => c !== exist);
            else exist.text = text;
          } else if (text) {
            state.comments.push({ id: "c" + state.comments.length, x: p[0], y: p[1], z: p[2], text });
          }
          renderMpr();
        });
      }
    });
    cv.addEventListener("mousemove", ev => {
      if (state.tool !== "ruler" || !state.draft || !state._planes) return;
      const r = cv.getBoundingClientRect();
      const plane = which === "long" ? state._planes.long : state._planes.axial;
      state.draft.b = canvasToWorld(plane, cv.width, cv.height, ev.clientX - r.left, ev.clientY - r.top);
      renderMpr();
    });
  }

  function syncSliderVal(id) {
    const sl = document.getElementById(id);
    const lab = document.getElementById(id + "-val");
    if (!sl || !lab) return;
    if (id.indexOf("zoom") >= 0) lab.textContent = (+sl.value).toFixed(1) + "×";
    else if (id.indexOf("contrast") >= 0) lab.textContent = "K " + (+sl.value).toFixed(2);
    else if (id === "sl-off") lab.textContent = (+sl.value).toFixed(1) + " mm";
    else lab.textContent = Math.round(+sl.value) + "°";
  }

  function syncSlider(id, value) {
    const sl = document.getElementById(id);
    if (sl) sl.value = String(value);
    syncSliderVal(id);
  }

  function sitesOf(kind) {
    return (state.scene.sites || []).filter(s => s.kind === kind);
  }

  function isMobileLayout() {
    return window.matchMedia && window.matchMedia("(max-width: 820px)").matches;
  }

  function screenOf(mode) {
    return mode === "3d" ? document.getElementById("screen-3d")
      : mode === "cross" ? document.getElementById("view-long")
      : document.getElementById("view-ax");
  }

  function reviveGl() {
    const long = document.getElementById("cv-long-gl");
    const ax = document.getElementById("cv-ax-gl");
    if (long && (!state.gl.long || state.gl.long.gl.isContextLost()))
      state.gl.long = initGl(long);
    if (ax && (!state.gl.ax || state.gl.ax.gl.isContextLost()))
      state.gl.ax = initGl(ax);
  }

  function applyViewModes() {
    const main = document.getElementById("view3d");
    const ct = document.getElementById("ctcol");
    const s3 = document.getElementById("screen-3d");
    const sl = document.getElementById("view-long");
    const sa = document.getElementById("view-ax");
    if (!main || !ct || !s3 || !sl || !sa) return;
    if (!isMobileLayout()) {
      if (s3.parentElement !== main) main.appendChild(s3);
      if (sl.parentElement !== ct) ct.appendChild(sl);
      if (sa.parentElement !== ct) ct.appendChild(sa);
      s3.classList.add("is-on");
      sl.classList.add("is-on");
      sa.classList.add("is-on");
    } else {
      const a = screenOf(state.paneMain);
      const b = screenOf(state.paneCt);
      if (a && a.parentElement !== main) main.appendChild(a);
      if (b && b.parentElement !== ct) ct.appendChild(b);
      [s3, sl, sa].forEach(el => {
        const on = el === a || el === b;
        el.classList.toggle("is-on", on);
        if (!on && el.parentElement !== main) main.appendChild(el);
      });
    }
    document.querySelectorAll(".view-swap").forEach(bar => {
      const pane = bar.getAttribute("data-pane");
      const mode = pane === "ct" ? state.paneCt : state.paneMain;
      bar.querySelectorAll("button").forEach(btn => btn.classList.toggle("on", btn.getAttribute("data-mode") === mode));
    });
    const mainCt = isMobileLayout() && state.paneMain !== "3d";
    const ctIs3d = isMobileLayout() && state.paneCt === "3d";
    main.classList.toggle("host-ct", mainCt);
    main.classList.toggle("host-3d", !mainCt);
    ct.classList.toggle("host-ct", !ctIs3d);
    ct.classList.toggle("host-3d", ctIs3d);
    app.classList.toggle("main-is-ct", mainCt);
    app.classList.toggle("ct-is-3d", ctIs3d);
    if (main) void main.offsetWidth;
    if (ct) void ct.offsetWidth;
    reviveGl();
  }

  function setPaneMode(pane, mode) {
    if (!mode || (mode !== "3d" && mode !== "axial" && mode !== "cross")) return;
    const key = pane === "ct" ? "paneCt" : "paneMain";
    const other = pane === "ct" ? "paneMain" : "paneCt";
    if (state[key] === mode) return;
    if (state[other] === mode) state[other] = state[key];
    state[key] = mode;
    applyViewModes();
    schedulePaint(24);
  }

  function placeSideToggle() {
    const btn = document.getElementById("side-toggle");
    const head = document.getElementById("side-head");
    const view = document.getElementById("view3d");
    if (!btn || !head || !view) return;
    if (!isMobileLayout()) {
      app.classList.remove("side-off");
      head.appendChild(btn);
      btn.title = "Свернуть меню";
      return;
    }
    const off = app.classList.contains("side-off");
    if (off) view.appendChild(btn);
    else head.appendChild(btn);
    btn.title = off ? "Показать меню" : "Свернуть меню";
  }

  function placeTools() {
    const tools = document.querySelector(".view3d-tools");
    const side = document.getElementById("side");
    const root = document.getElementById("app");
    if (!tools || !side || !root) return;
    if (isMobileLayout()) {
      if (tools.parentElement !== root) root.appendChild(tools);
    } else if (tools.parentElement !== side) {
      side.insertBefore(tools, side.firstChild);
    }
  }

  function canvasReady(id) {
    const el = document.getElementById(id);
    const [w, h] = canvasBox(el);
    return !!(el && w > 8 && h > 8);
  }

  function viewportsReady() {
    if (!isMobileLayout())
      return canvasReady("cv-3d") && canvasReady("cv-long");
    const ids = [];
    const add = mode => {
      ids.push(mode === "3d" ? "cv-3d" : mode === "cross" ? "cv-long" : "cv-ax");
    };
    add(state.paneMain);
    add(state.paneCt);
    return ids.every(canvasReady);
  }

  function paintAll() {
    if (!state.site) {
      const sites = (state.scene && state.scene.sites) || [];
      const first = sites.find(s => s && s.origin && s.axis);
      if (first) state.site = first;
    }
    const run = (fn) => { try { fn(); } catch (e) { console.error(e); } };
    run(() => { if (state.site) renderMpr(); });
    run(renderOpg);
    run(render3d);
  }

  function paintWhenReady(tries) {
    const n = tries == null ? 20 : tries;
    if (viewportsReady() || n <= 0) {
      paintAll();
      return;
    }
    requestAnimationFrame(() => paintWhenReady(n - 1));
  }

  function schedulePaint(tries) {
    requestAnimationFrame(() => {
      const main = document.getElementById("view3d");
      const ct = document.getElementById("ctcol");
      if (main) void main.offsetHeight;
      if (ct) void ct.offsetHeight;
      paintWhenReady(tries == null ? 24 : tries);
    });
  }

  function openSite(site) {
    if (!site || !site.origin || !site.axis) return;
    site._viewFrame = frameFromSite(site);
    state.site = site;
    state.rotLong = 0;
    state.rotAx = 0;
    state.off = 0;
    state.panLong = [0, 0];
    state.panAx = [0, 0];
    syncSlider("sl-rot-long", 0);
    syncSlider("sl-off", 0);
    const label = (site.kind === "pin" ? "Pin " : "Implant ") + (site.tooth || site.id);
    const chip = document.getElementById("site-chip");
    if (chip) chip.textContent = label;
    const floating = document.getElementById("site-label");
    if (floating) floating.textContent = "";
    if (!state.gl.long) state.gl.long = initGl(document.getElementById("cv-long-gl"));
    if (!state.gl.ax) state.gl.ax = initGl(document.getElementById("cv-ax-gl"));
    syncSaveBtn();
    updateImplantSwitchActive();
    paintWhenReady(20);
  }

  function shadeHex(hex, k) {
    const n = parseInt((hex || "#888").slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * k);
    const g = Math.round(((n >> 8) & 255) * k);
    const b = Math.round((n & 255) * k);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function siteToken(s) {
    return String(s.tooth || s.mesh || s.id || "").toLowerCase().trim();
  }

  function meshWorldPos(m) {
    if (m && m.transform && m.transform.length >= 12)
      return [m.transform[3], m.transform[7], m.transform[11]];
    return null;
  }

  function nearestSiteForMesh(m) {
    const p = meshWorldPos(m);
    if (!p) return null;
    const sites = (state.scene && state.scene.sites) || [];
    let best = null, bd = 1e9;
    for (const s of sites) {
      if (!s.origin) continue;
      if ((m.kind === "abutment" || m.kind === "analog") && s.kind !== "implant")
        continue;
      if (m.kind === "sleeve" && s.kind !== "implant" && s.kind !== "pin")
        continue;
      const dx = p[0] - s.origin[0], dy = p[1] - s.origin[1], dz = p[2] - s.origin[2];
      let d = Math.hypot(dx, dy, dz);
      if (s.axis && s.axis.length >= 3) {
        const t = dx * s.axis[0] + dy * s.axis[1] + dz * s.axis[2];
        const rx = dx - s.axis[0] * t, ry = dy - s.axis[1] * t, rz = dz - s.axis[2] * t;
        d = Math.min(d, Math.hypot(rx, ry, rz));
      }
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return bd <= 14 ? best : null;
  }

  function meshBelongsToSite(m, site) {
    if (!m || !site) return false;
    // Совпадение по имени (токену зуба) годится ТОЛЬКО для implant/pin —
    // сам меш импланта называется тем же номером зуба, что и site. Меш
    // "Зуб" (kind:'teeth') в .stlinfo/сцене часто носит ИДЕНТИЧНОЕ имя
    // (тот же номер зуба) — это спроектированная заранее анатомия
    // (планируемая коронка/поверхность), которая должна оставаться
    // неподвижной при правке позиции импланта, а не двигаться вместе с
    // ним только из-за совпадения имени.
    if (m.kind === "implant" || m.kind === "pin") {
      const n = String(m.name || "").toLowerCase();
      const tok = siteToken(site);
      if (tok) {
        const pinTok = "pin " + tok;
        if (n === tok || n.startsWith(tok + " ") || n === pinTok || n.startsWith(pinTok + " "))
          return true;
      }
    }
    if (m.kind === "abutment" || m.kind === "analog" || m.kind === "sleeve" || m.kind === "shaft")
      return nearestSiteForMesh(m) === site;
    return false;
  }

  function jawOfMesh(m) {
    const n = String(m.name || "").toLowerCase();
    if (/mandib|lower|нижн/.test(n)) return "lower";
    if (m.kind === "antagonist") return "lower";
    return "upper";
  }

  function fillLayers() {
    const host = document.getElementById("layers");
    host.innerHTML = "";
    const meshes = ((state.scene && state.scene.meshes) || []).filter(m => m && m.kind !== "cpr" && m.kind !== "shaft");
    const kindRu = { scan: "скан", bone: "кость", anatomy: "анатомия", implant: "имплант", sleeve: "втулка", shaft: "шахт", security: "зона", thickness: "толщина", abutment: "абатмент", analog: "аналог", pin: "пин", teeth: "зубы", bar: "балка", waxup: "воск", antagonist: "антагонист", nerve: "нерв" };
    const sites = (state.scene && state.scene.sites) || [];
    const used = new Set();
    const refreshers = [];
    const refreshAll = () => refreshers.forEach(fn => fn());
    const syncGroupHead = (head, items) => {
      const on = items.filter(m => m.visible !== false).length;
      head.checked = on === items.length;
      head.indeterminate = on > 0 && on < items.length;
    };
    const meshOpacity = meshOpacityOf;
    const addOpSlider = (parent, getVal, setVal) => {
      const sl = document.createElement("input");
      sl.type = "range";
      sl.className = "mesh-op";
      sl.min = "0.05";
      sl.max = "1";
      sl.step = "0.05";
      sl.value = String(getVal());
      sl.title = "Прозрачность";
      sl.onclick = ev => ev.stopPropagation();
      sl.onpointerdown = ev => ev.stopPropagation();
      let paint = 0;
      const preview3d = () => {
        paint = 0;
        render3d();
      };
      sl.oninput = ev => {
        ev.stopPropagation();
        setVal(+ev.target.value);
        if (!paint) paint = requestAnimationFrame(preview3d);
      };
      sl.onchange = ev => {
        ev.stopPropagation();
        if (paint) { cancelAnimationFrame(paint); paint = 0; }
        setVal(+ev.target.value);
        renderMpr();
        renderOpg();
        render3d();
      };
      parent.appendChild(sl);
      return sl;
    };
    const addRow = (parent, m) => {
      const row = document.createElement("div");
      row.className = "mesh-panel__item";
      const on = m.visible !== false;
      if (typeof m.opacity !== "number") m.opacity = meshOpacity(m);
      row.innerHTML = "<label class='mesh-panel__lab'><input type='checkbox'" + (on ? " checked" : "") +
        " /><span class='mesh-panel__name'>" + (m.name || m.id) +
        "<span class='mesh-panel__kind'> · " + (kindRu[m.kind] || m.kind) + "</span></span></label>";
      row.querySelector("input").onchange = ev => {
        m.visible = ev.target.checked;
        if (m._gl) m._box = null;
        renderMpr();
        renderOpg();
        render3d();
        refreshAll();
      };
      addOpSlider(row, () => meshOpacity(m), v => { m.opacity = v; });
      parent.appendChild(row);
    };
    const addGroup = (title, items, open, parent) => {
      if (!items.length) return;
      const box = document.createElement("details");
      box.className = "mesh-group";
      box.open = !!open;
      const sum = document.createElement("summary");
      sum.innerHTML = "<input type='checkbox' /><span>" + title + "</span>";
      const head = sum.querySelector("input");
      const refresh = () => {
        syncGroupHead(head, items);
        const cbs = box.querySelectorAll(".mesh-panel__item input[type=checkbox]");
        items.forEach((m, i) => { if (cbs[i]) cbs[i].checked = m.visible !== false; });
      };
      head.onchange = ev => {
        ev.stopPropagation();
        items.forEach(m => { m.visible = head.checked; if (m._gl) m._box = null; });
        renderMpr();
        renderOpg();
        render3d();
        refreshAll();
      };
      head.onclick = ev => ev.stopPropagation();
      box.appendChild(sum);
      items.forEach(m => addRow(box, m));
      refresh();
      refreshers.push(refresh);
      (parent || host).appendChild(box);
      return { box, items, refresh };
    };
    const addKindWrap = (title, groups, target) => {
      const ready = groups.filter(g => g.items.length);
      if (!ready.length) return;
      const all = ready.flatMap(g => g.items);
      const box = document.createElement("details");
      box.className = "mesh-group mesh-group--kind";
      box.open = true;
      const sum = document.createElement("summary");
      sum.innerHTML = "<input type='checkbox' /><span>" + title + "</span>";
      const head = sum.querySelector("input");
      const kids = [];
      const refresh = () => {
        syncGroupHead(head, all);
        kids.forEach(k => k.refresh());
      };
      head.onchange = ev => {
        ev.stopPropagation();
        all.forEach(m => { m.visible = head.checked; if (m._gl) m._box = null; });
        renderMpr();
        renderOpg();
        render3d();
        refreshAll();
      };
      head.onclick = ev => ev.stopPropagation();
      box.appendChild(sum);
      const cols = document.createElement("div");
      cols.className = "mesh-cols";
      ready.forEach(g => {
        const kid = addGroup(g.title, g.items, false, cols);
        if (kid) kids.push(kid);
      });
      box.appendChild(cols);
      refresh();
      refreshers.push(refresh);
      (target || host).appendChild(box);
    };

    // ── таб-бар категорий (Импланты/Пины/STL файлы/DICOM) — ближе к
    // структуре referenceного RealGUIDE-приложения (Object list: Implants |
    // Pins | STL files | DICOM). Вкладки — display:contents (см. CSS), их
    // .mesh-group остаются прямыми потомками .meshes для существующей
    // 3-колоночной сетки и селекторов.
    const TAB_DEFS = [
      { key: "implants", label: "Импланты" },
      { key: "pins", label: "Пины" },
      { key: "stl", label: "STL файлы" },
      { key: "dicom", label: "DICOM" }
    ];
    const tabsBar = document.createElement("div");
    tabsBar.className = "layer-tabs";
    const panes = {};
    TAB_DEFS.forEach(t => {
      const p = document.createElement("div");
      p.className = "layer-pane";
      p.dataset.tab = t.key;
      panes[t.key] = p;
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.tab = t.key;
      b.textContent = t.label;
      b.onclick = () => setLayerTab(t.key);
      tabsBar.appendChild(b);
    });
    function setLayerTab(key) {
      TAB_DEFS.forEach(t => { panes[t.key].hidden = t.key !== key; });
      tabsBar.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.tab === key));
    }
    host.appendChild(tabsBar);
    TAB_DEFS.forEach(t => host.appendChild(panes[t.key]));

    const implantSites = sites.filter(x => x.kind === "implant");
    addKindWrap("Импланты", implantSites.map(s => {
      const items = meshes.filter(m => meshBelongsToSite(m, s));
      items.forEach(m => used.add(m));
      return { title: s.tooth || s.id, items };
    }), panes.implants);
    addGroup("Все втулки", meshes.filter(m => m.kind === "sleeve" && implantSites.some(s => meshBelongsToSite(m, s))), false, panes.implants);
    addGroup("Все абатменты", meshes.filter(m => m.kind === "abutment" && implantSites.some(s => meshBelongsToSite(m, s))), false, panes.implants);
    addKindWrap("Пины", sites.filter(x => x.kind === "pin").map(s => {
      const items = meshes.filter(m => meshBelongsToSite(m, s));
      items.forEach(m => used.add(m));
      return { title: s.tooth || ("Pin " + (s.id || "")), items };
    }), panes.pins);
    const rest = meshes.filter(m => !used.has(m));
    const jaws = document.createElement("div");
    jaws.className = "mesh-col-rest";
    addGroup("Верхняя челюсть", rest.filter(m => jawOfMesh(m) === "upper"), !isMobileLayout(), jaws);
    addGroup("Нижняя челюсть", rest.filter(m => jawOfMesh(m) === "lower"), !isMobileLayout(), jaws);
    if (jaws.childElementCount) panes.stl.appendChild(jaws);

    // DICOM: тумблер КТ-объёма (state.layers.ct раньше нигде не переключался из UI)
    const ctRow = document.createElement("div");
    ctRow.className = "mesh-panel__item";
    const ctOn = state.layers.ct !== false;
    ctRow.innerHTML = "<label class='mesh-panel__lab'><input type='checkbox'" + (ctOn ? " checked" : "") +
      " /><span class='mesh-panel__name'>КТ-объём<span class='mesh-panel__kind'> · срезы</span></span></label>";
    ctRow.querySelector("input").onchange = ev => {
      state.layers.ct = ev.target.checked;
      renderMpr();
      renderOpg();
    };
    panes.dicom.appendChild(ctRow);

    const defaultTab = panes.implants.childElementCount
      ? "implants"
      : (TAB_DEFS.find(t => panes[t.key].childElementCount) || TAB_DEFS[0]).key;
    TAB_DEFS.forEach(t => {
      if (t.key === "dicom" || panes[t.key].childElementCount) return;
      const empty = document.createElement("div");
      empty.className = "layer-pane__empty";
      empty.textContent = "Нет объектов";
      panes[t.key].appendChild(empty);
    });
    setLayerTab(defaultTab);
  }
  // Кнопки переключения имплантов — заняли место убранной панорамы ОПТГ
  // (#opg, было #cv-opg). Список статичен на время сессии (импланты не
  // добавляются/удаляются на лету), поэтому полностью перестраивается один
  // раз при старте; активная кнопка обновляется отдельно, из openSite().
  function fillImplantSwitch() {
    const host = document.getElementById("implant-switch");
    if (!host) return;
    host.innerHTML = "";
    const sites = [...sitesOf("implant"), ...sitesOf("pin")];
    if (!sites.length) {
      const empty = document.createElement("div");
      empty.className = "implant-switch__empty";
      empty.textContent = "Нет имплантов";
      host.appendChild(empty);
      return;
    }
    for (const s of sites) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "implant-switch__btn";
      b.textContent = s.tooth || (s.kind === "pin" ? "Pin" : "Imp");
      b.title = (s.kind === "pin" ? "Пин " : "Имплант ") + (s.tooth || s.id);
      b.dataset.siteId = s.id;
      b.onclick = () => openSite(s);
      host.appendChild(b);
    }
    updateImplantSwitchActive();
  }

  function updateImplantSwitchActive() {
    const host = document.getElementById("implant-switch");
    if (!host) return;
    const activeId = state.site && state.site.id;
    host.querySelectorAll(".implant-switch__btn").forEach(b => {
      b.classList.toggle("on", !!activeId && b.dataset.siteId === activeId);
    });
  }

  const ORBIT_SPEED = 0.005;
  const ORBIT_MAX = 0.22;
  function qMul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
  }
  function qNorm(q) {
    const L = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / L, q[1] / L, q[2] / L, q[3] / L];
  }
  function qAxisAngle(ax, ay, az, ang) {
    const L = Math.hypot(ax, ay, az) || 1;
    const s = Math.sin(ang * 0.5);
    return [ax / L * s, ay / L * s, az / L * s, Math.cos(ang * 0.5)];
  }
  function qRot(q, v) {
    const ux = q[0], uy = q[1], uz = q[2], uw = q[3];
    const tx = 2 * (uy * v[2] - uz * v[1]);
    const ty = 2 * (uz * v[0] - ux * v[2]);
    const tz = 2 * (ux * v[1] - uy * v[0]);
    return [v[0] + uw * tx + uy * tz - uz * ty, v[1] + uw * ty + uz * tx - ux * tz, v[2] + uw * tz + ux * ty - uy * tx];
  }
  function qFromYawPitch(yaw, pitch) {
    return qNorm(qMul(qAxisAngle(0, 1, 0, yaw), qAxisAngle(1, 0, 0, pitch)));
  }
  const state3d = {
    rot: qFromYawPitch(0.8, 0.45),
    zoom: 1,
    panX: 0,
    panY: 0,
    halfH: 40,
    dist: 0,
    target: [0, 0, 0],
    drag: null,
    gl: null
  };

  function parseHexColor(hex) {
    if (!hex || typeof hex !== "string") return null;
    const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function kindColor(kind) {
    return kind === "implant" ? [0.89, 0.14, 0.14]
      : kind === "pin" ? [0.53, 0.94, 0.67]
      : kind === "scan" ? [0.82, 0.62, 0.42]
      : kind === "bone" ? [0.93, 0.62, 0.55]
      : kind === "teeth" ? [0.93, 0.93, 0.9]
      : kind === "nerve" ? [0.97, 0.44, 0.44]
      : kind === "bar" ? [0.7, 0.82, 0.95]
      : kind === "waxup" ? [0.98, 0.86, 0.55]
      : kind === "antagonist" ? [0.75, 0.7, 0.85]
      : kind === "anatomy" ? [0.93, 0.55, 0.48]
      : kind === "sleeve" ? [0.72, 0.74, 0.76]
      : kind === "shaft" ? [0.54, 0.59, 0.62]
      : kind === "security" ? [0.96, 0.77, 0.26]
      : kind === "thickness" ? [0.37, 0.92, 0.83]
      : kind === "abutment" ? [0.85, 0.85, 0.88]
      : kind === "analog" ? [0.55, 0.6, 0.7]
      : [0.7, 0.75, 0.8];
  }

  function compileChecked(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  }

  function init3d() {
    const canvas = document.getElementById("cv-3d");
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
    if (!gl) return;
    // D3D-MESH-LIGHT — mesh-профиль, чуть темнее: ambient 0.36, key 0.50, fill 0.18,
    // spec слабее, чтобы белый воск не выбивал. ACES + sRGB.
    const vs = "attribute vec3 a;attribute vec3 n;uniform mat4 mvp;uniform mat4 view;varying vec3 vN;void main(){vN=mat3(view)*n;gl_Position=mvp*vec4(a,1.0);}";
    const fs = [
      "precision mediump float;varying vec3 vN;uniform vec3 col;uniform float op;",
      "uniform vec3 keyDir;uniform vec3 fillDir;uniform vec3 hemiDir;",
      "vec3 s2l(vec3 c){return pow(max(c,0.0),vec3(2.2));}",
      "vec3 l2s(vec3 c){return pow(clamp(c,0.0,1.0),vec3(0.45454545));}",
      "vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}",
      "void main(){vec3 N=normalize(vN);if(!gl_FrontFacing)N=-N;vec3 V=vec3(0.0,0.0,1.0);",
      "vec3 albedo=s2l(col);vec3 amb=vec3(0.36);",
      "vec3 sky=s2l(vec3(0.9490196,0.9338882,0.9098039));",
      "vec3 gnd=s2l(vec3(0.2901961,0.2509804,0.2352941));",
      "float hw=0.5*dot(N,normalize(hemiDir))+0.5;vec3 hemi=mix(gnd,sky,hw)*0.05;",
      "vec3 K=normalize(keyDir);vec3 F=normalize(fillDir);",
      "vec3 fillC=s2l(vec3(0.9098039,0.8627451,0.7843137))*0.18;",
      "float ndk=max(dot(N,K),0.0);float ndf=max(dot(N,F),0.0);",
      "vec3 spec=s2l(vec3(0.018));",
      "float sk=pow(max(dot(reflect(-K,N),V),0.0),36.0);",
      "float sf=pow(max(dot(reflect(-F,N),V),0.0),36.0);",
      "vec3 lit=albedo*(amb+hemi+vec3(0.50)*ndk+fillC*ndf)+spec*(vec3(0.50)*sk+fillC*sf);",
      "gl_FragColor=vec4(l2s(aces(lit)),op);}"
    ].join("");
    const p = gl.createProgram();
    try {
      gl.attachShader(p, compileChecked(gl, gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compileChecked(gl, gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(p) || "link");
    } catch (e) {
      return;
    }
    state3d.gl = { gl, p, loc: {
      a: gl.getAttribLocation(p, "a"), n: gl.getAttribLocation(p, "n"),
      mvp: gl.getUniformLocation(p, "mvp"),
      view: gl.getUniformLocation(p, "view"),
      keyDir: gl.getUniformLocation(p, "keyDir"),
      fillDir: gl.getUniformLocation(p, "fillDir"),
      hemiDir: gl.getUniformLocation(p, "hemiDir"),
      col: gl.getUniformLocation(p, "col"), op: gl.getUniformLocation(p, "op")
    }};
    bindLockedCamera(canvas, document.getElementById("screen-3d") || document.getElementById("view3d"));
    bindGizmo3d(canvas, document.getElementById("screen-3d") || document.getElementById("view3d"));
  }

  function bindGizmo3d(canvas, host) {
    const root = host || canvas;
    let raf = 0;
    const paint = () => {
      raf = 0;
      renderMpr();
      render3d();
    };
    const onDown = ev => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      if ((ev.buttons & 2) || (ev.buttons & 4)) return;
      if (!state.site || state.tool) return;
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      const w = canvas.width, h = canvas.height;
      const hit = hitGizmo3d(w, h, x * (w / Math.max(r.width, 1)), y * (h / Math.max(r.height, 1)));
      if (!hit) return;
      const sx = x * (w / Math.max(r.width, 1)), sy = y * (h / Math.max(r.height, 1));
      const world = screenToWorld3d(sx, sy, w, h, hit.p);
      state3d.drag = null;
      beginGizmoDrag(hit, "3d", world, state3d.view && state3d.view.back);
      ev.preventDefault();
      ev.stopPropagation();
      try { canvas.setPointerCapture(ev.pointerId); } catch (_) { /* ok */ }
      render3d();
    };
    const onMove = ev => {
      if (!state.drag || !state.drag.gizmo || state.drag.which !== "3d") return;
      const r = canvas.getBoundingClientRect();
      const w = canvas.width, h = canvas.height;
      const x = (ev.clientX - r.left) * (w / Math.max(r.width, 1));
      const y = (ev.clientY - r.top) * (h / Math.max(r.height, 1));
      const world = screenToWorld3d(x, y, w, h, state.drag.handle);
      applyGizmoDrag(world, null);
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const onUp = ev => {
      if (!state.drag || !state.drag.gizmo || state.drag.which !== "3d") return;
      endGizmoDrag();
      state.drag = null;
      state._live = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      renderMpr();
      renderOpg();
      render3d();
      ev.preventDefault();
    };
    root.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  // D3D-CAM-LOCK — не переписывать и не «упрощать».
  // ПКМ = орбита, СКМ / ЛКМ+ПКМ = пан, колесо = зум. ЛКМ один не крутит.
  function bindLockedCamera(canvas, host) {
    const root = host || canvas;
    canvas.style.touchAction = "none";
    if (host) host.style.touchAction = "none";
    const blockMenu = ev => ev.preventDefault();
    root.addEventListener("contextmenu", blockMenu, true);
    canvas.addEventListener("contextmenu", blockMenu, true);
    const applyPan = (dx, dy) => {
      const w = Math.max(canvas.clientWidth || 400, 1);
      const h = Math.max(canvas.clientHeight || 400, 1);
      const z = Math.max(state3d.zoom, 1e-6);
      const halfH = state3d.halfH / z;
      const halfW = halfH * (w / h);
      state3d.panX -= dx * (2 * halfW / w);
      state3d.panY += dy * (2 * halfH / h);
    };
    const applyOrbit = (dx, dy) => {
      if (dx) {
        const ang = Math.min(Math.abs(dx) * ORBIT_SPEED, ORBIT_MAX) * -Math.sign(dx);
        const axis = qRot(state3d.rot, [0, 1, 0]);
        state3d.rot = qNorm(qMul(qAxisAngle(axis[0], axis[1], axis[2], ang), state3d.rot));
      }
      if (dy) {
        const ang = Math.min(Math.abs(dy) * ORBIT_SPEED, ORBIT_MAX) * -Math.sign(dy);
        const axis = qRot(state3d.rot, [1, 0, 0]);
        state3d.rot = qNorm(qMul(qAxisAngle(axis[0], axis[1], axis[2], ang), state3d.rot));
      }
    };
    const bitsOf = ev => {
      if (ev.buttons) return ev.buttons;
      if (ev.button === 1) return 4;
      if (ev.button === 2) return 2;
      if (ev.button === 0) return 1;
      return 0;
    };
    const modeOf = (bits, ev) => {
      if ((bits & 4) || ((bits & 1) && (bits & 2))) return "pan";
      if (bits & 2) return "orbit";
      if (ev && ev.pointerType === "touch") return "orbit";
      return null;
    };
    const pts = new Map();
    const midOf = () => {
      let x = 0, y = 0, n = 0;
      pts.forEach(p => { x += p.x; y += p.y; n++; });
      return n ? { x: x / n, y: y / n, n } : null;
    };
    const distOf = () => {
      const arr = [...pts.values()];
      if (arr.length < 2) return null;
      return Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
    };
    const hitTouchGizmo = ev => {
      if (!state.site || state.tool || !state3d.view) return false;
      const r = canvas.getBoundingClientRect();
      const w = canvas.width, h = canvas.height;
      const x = (ev.clientX - r.left) * (w / Math.max(r.width, 1));
      const y = (ev.clientY - r.top) * (h / Math.max(r.height, 1));
      return !!hitGizmo3d(w, h, x, y);
    };
    const onDown = ev => {
      if (ev.pointerType === "touch") {
        if (pts.size === 0 && hitTouchGizmo(ev)) return;
        pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        const m = midOf();
        state3d.drag = { x: m.x, y: m.y, mode: pts.size >= 2 ? "pan" : "orbit", pinch: pts.size >= 2 ? distOf() : 0 };
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      const bits = bitsOf(ev);
      const mode = modeOf(bits, ev);
      if (!mode) return;
      ev.preventDefault();
      ev.stopPropagation();
      state3d.drag = { x: ev.clientX, y: ev.clientY, mode };
      if (ev.pointerId != null) {
        try { canvas.setPointerCapture(ev.pointerId); } catch (_) { /* keep window move */ }
      }
    };
    const onMove = ev => {
      if (ev.pointerType === "touch") {
        if (!pts.has(ev.pointerId)) return;
        pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (!state3d.drag) return;
        const m = midOf();
        if (!m) return;
        const dx = m.x - state3d.drag.x;
        const dy = m.y - state3d.drag.y;
        if (pts.size >= 2) {
          const d = distOf();
          if (d && state3d.drag.pinch > 4) {
            state3d.zoom = Math.max(0.12, Math.min(16, state3d.zoom * (d / state3d.drag.pinch)));
          }
          applyPan(dx, dy);
          state3d.drag = { x: m.x, y: m.y, mode: "pan", pinch: d || 0 };
        } else {
          applyOrbit(dx, dy);
          state3d.drag = { x: m.x, y: m.y, mode: "orbit", pinch: 0 };
        }
        render3d();
        return;
      }
      if (!state3d.drag) return;
      const mode = modeOf(ev.buttons || bitsOf(ev), ev) || state3d.drag.mode;
      const dx = ev.clientX - state3d.drag.x;
      const dy = ev.clientY - state3d.drag.y;
      state3d.drag = { x: ev.clientX, y: ev.clientY, mode };
      if (mode === "pan") applyPan(dx, dy);
      else applyOrbit(dx, dy);
      render3d();
    };
    const onUp = ev => {
      if (ev.pointerType === "touch") {
        pts.delete(ev.pointerId);
        if (!pts.size) state3d.drag = null;
        else {
          const m = midOf();
          state3d.drag = { x: m.x, y: m.y, mode: pts.size >= 2 ? "pan" : "orbit", pinch: pts.size >= 2 ? distOf() : 0 };
        }
        return;
      }
      if (ev.buttons === 0) state3d.drag = null;
      else if (state3d.drag) state3d.drag.mode = modeOf(ev.buttons, ev) || state3d.drag.mode;
    };
    root.addEventListener("pointerdown", onDown, true);
    root.addEventListener("mousedown", ev => { if (!state3d.drag) onDown(ev); }, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("pointercancel", onUp);
    const onZoomWheel = ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? canvas.clientHeight || 400 : 1;
      const dx = ev.deltaX * unit;
      const dy = ev.deltaY * unit;
      const pan = !ev.ctrlKey && !ev.metaKey && Math.abs(dx) > Math.abs(dy) + 2;
      if (pan) {
        applyPan(-dx, -dy);
      } else {
        const step = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
        state3d.zoom = Math.max(0.12, Math.min(16, state3d.zoom * Math.exp(-step * 0.00045)));
      }
      render3d();
    };
    root.addEventListener("wheel", onZoomWheel, { passive: false });
    if (host && host !== canvas)
      canvas.addEventListener("wheel", onZoomWheel, { passive: false });
  }

  function mul4(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++)
        o[c * 4 + r] = a[0 * 4 + r] * b[c * 4 + 0] + a[1 * 4 + r] * b[c * 4 + 1] + a[2 * 4 + r] * b[c * 4 + 2] + a[3 * 4 + r] * b[c * 4 + 3];
    return o;
  }

  function lookAt(ex, ey, ez, cx, cy, cz) {
    let zx = ex - cx, zy = ey - cy, zz = ez - cz;
    let zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
    let xx = zy * 0 - zz * 1, xy = zz * 0 - zx * 0, xz = zx * 1 - zy * 0;
    if (Math.hypot(xx, xy, xz) < 1e-6) { xx = zy * 1 - zz * 0; xy = zz * 0 - zx * 1; xz = zx * 0 - zy * 0; }
    let xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * ex + xy * ey + xz * ez), -(yx * ex + yy * ey + yz * ez), -(zx * ex + zy * ey + zz * ez), 1
    ]);
  }

  function ortho(l, r, b, t, n, f) {
    return new Float32Array([
      2 / (r - l), 0, 0, 0,
      0, 2 / (t - b), 0, 0,
      0, 0, -2 / (f - n), 0,
      -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1
    ]);
  }

  function meshWorldBox(m) {
    if (m._box) return m._box;
    const src = m._pos, idx = m._idx, tr = m.transform;
    let minx = 1e9, miny = 1e9, minz = 1e9, maxx = -1e9, maxy = -1e9, maxz = -1e9;
    const n = src.length / 3;
    const step = n > 80000 ? Math.floor(n / 40000) : 1;
    for (let i = 0; i < n; i += step) {
      const p = xfm(tr, src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
      if (p[0] < minx) minx = p[0]; if (p[1] < miny) miny = p[1]; if (p[2] < minz) minz = p[2];
      if (p[0] > maxx) maxx = p[0]; if (p[1] > maxy) maxy = p[1]; if (p[2] > maxz) maxz = p[2];
    }
    m._box = { minx, miny, minz, maxx, maxy, maxz };
    return m._box;
  }

  function frame3d() {
    let minx = 1e9, miny = 1e9, minz = 1e9, maxx = -1e9, maxy = -1e9, maxz = -1e9;
    let any = false;
    const boxes = [];
    for (const m of state.scene.meshes || []) {
      if (!m._pos || m.visible === false || state.layers[m.kind] === false) continue;
      const b = meshWorldBox(m);
      if (b.minx > b.maxx) continue;
      boxes.push(b);
    }
    if (boxes.length) {
      const sites = state.scene.sites || [];
      let cx, cy, cz;
      if (state.site) {
        cx = state.site.origin[0]; cy = state.site.origin[1]; cz = state.site.origin[2];
      } else if (sites.length) {
        cx = sites.reduce((s, x) => s + x.origin[0], 0) / sites.length;
        cy = sites.reduce((s, x) => s + x.origin[1], 0) / sites.length;
        cz = sites.reduce((s, x) => s + x.origin[2], 0) / sites.length;
      } else {
        cx = boxes.reduce((s, b) => s + (b.minx + b.maxx) * 0.5, 0) / boxes.length;
        cy = boxes.reduce((s, b) => s + (b.miny + b.maxy) * 0.5, 0) / boxes.length;
        cz = boxes.reduce((s, b) => s + (b.minz + b.maxz) * 0.5, 0) / boxes.length;
      }
      for (const b of boxes) {
        const mx = (b.minx + b.maxx) * 0.5, my = (b.miny + b.maxy) * 0.5, mz = (b.minz + b.maxz) * 0.5;
        if ((mx - cx) ** 2 + (my - cy) ** 2 + (mz - cz) ** 2 > 220 * 220) continue;
        minx = Math.min(minx, b.minx); miny = Math.min(miny, b.miny); minz = Math.min(minz, b.minz);
        maxx = Math.max(maxx, b.maxx); maxy = Math.max(maxy, b.maxy); maxz = Math.max(maxz, b.maxz);
        any = true;
      }
    }
    if (state.site) {
      minx = Math.min(minx, state.site.origin[0]); miny = Math.min(miny, state.site.origin[1]); minz = Math.min(minz, state.site.origin[2]);
      maxx = Math.max(maxx, state.site.origin[0]); maxy = Math.max(maxy, state.site.origin[1]); maxz = Math.max(maxz, state.site.origin[2]);
      any = true;
    }
    if (!any) {
      state3d.target = [0, 0, 0];
      if (!state3d.dist) { state3d.dist = 160; state3d.halfH = 50; }
      return;
    }
    state3d.target = [(minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2];
    const span = Math.max(maxx - minx, maxy - miny, maxz - minz, 20);
    if (!state3d.dist) {
      state3d.dist = span * 2.2;
      state3d.halfH = span * 0.55;
      state3d.zoom = 1;
      state3d.panX = 0;
      state3d.panY = 0;
    }
  }

  function uploadMesh3d(gl, m, tr, slot) {
    const src = m._pos, idx = m._idx;
    tr = tr || m.transform;
    slot = slot || "_gl";
    const tris = idx ? idx.length / 3 : src.length / 9;
    const cap = Math.min(tris, 600000);
    const step = Math.max(1, Math.floor(tris / cap));
    const keep = Math.ceil(tris / step);
    const pos = new Float32Array(keep * 9);
    const nrmA = new Float32Array(keep * 9);
    let o = 0;
    for (let t = 0; t < tris; t += step) {
      const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const p0 = xfm(tr, src[i0 * 3], src[i0 * 3 + 1], src[i0 * 3 + 2]);
      const p1 = xfm(tr, src[i1 * 3], src[i1 * 3 + 1], src[i1 * 3 + 2]);
      const p2 = xfm(tr, src[i2 * 3], src[i2 * 3 + 1], src[i2 * 3 + 2]);
      const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
      const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      const dst = o * 9;
      pos[dst] = p0[0]; pos[dst + 1] = p0[1]; pos[dst + 2] = p0[2];
      pos[dst + 3] = p1[0]; pos[dst + 4] = p1[1]; pos[dst + 5] = p1[2];
      pos[dst + 6] = p2[0]; pos[dst + 7] = p2[1]; pos[dst + 8] = p2[2];
      for (let k = 0; k < 3; k++) { nrmA[dst + k * 3] = nx; nrmA[dst + k * 3 + 1] = ny; nrmA[dst + k * 3 + 2] = nz; }
      o++;
    }
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, nrmA, gl.STATIC_DRAW);
    m[slot] = { pb, nb, count: o * 3 };
  }

  function drawPlanningAxes3d(gl, ctx) {
    const sites = (state.scene && state.scene.sites) || [];
    if (!sites.length) return;
    const red = { pos: [], nrm: [] }, gold = { pos: [], nrm: [] };
    const pushTube = (pack, a, b, r) => {
      const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len = Math.hypot(axis[0], axis[1], axis[2]);
      if (len < 0.2) return;
      axis[0] /= len; axis[1] /= len; axis[2] /= len;
      let u = cross(axis, [0, 0, 1]);
      if (Math.hypot(u[0], u[1], u[2]) < 1e-5) u = cross(axis, [1, 0, 0]);
      u = norm(u);
      const v = norm(cross(axis, u));
      const seg = 10;
      const ring = (p, i) => {
        const ang = i * Math.PI * 2 / seg;
        const c = Math.cos(ang), s = Math.sin(ang);
        const nx = u[0] * c + v[0] * s, ny = u[1] * c + v[1] * s, nz = u[2] * c + v[2] * s;
        return [p[0] + nx * r, p[1] + ny * r, p[2] + nz * r, nx, ny, nz];
      };
      for (let i = 0; i < seg; i++) {
        const q0 = ring(a, i), q1 = ring(a, i + 1), q2 = ring(b, i), q3 = ring(b, i + 1);
        const tri = [q0, q2, q1, q1, q2, q3];
        for (const q of tri) {
          pack.pos.push(q[0], q[1], q[2]);
          pack.nrm.push(q[3], q[4], q[5]);
        }
      }
    };
    for (const s of sites) {
      if (!s.origin || !s.axis) continue;
      if ((s.kind === "implant" && state.layers.implant === false) || (s.kind === "pin" && state.layers.pin === false))
        continue;
      const sel = !!(state.site && state.site.id === s.id);
      const span = siteAxisSpan(s);
      const outX = span.crown[0] - span.apex[0], outY = span.crown[1] - span.apex[1], outZ = span.crown[2] - span.apex[2];
      const outLen = Math.hypot(outX, outY, outZ);
      const outDir = outLen > 1e-6 ? [outX / outLen, outY / outLen, outZ / outLen] : span.axis;
      pushTube(red, span.crown, add(span.crown, outDir, 20), sel ? 0.76 : 0.60);
      if (state.layers.abutment !== false && s.mu_origin && s.mu_axis) {
        const up = muAxisUp(s);
        pushTube(gold, add(s.mu_origin, up, -12), add(s.mu_origin, up, 28), sel ? 0.64 : 0.52);
      }
    }
    const drawPack = (pack, rgb) => {
      if (!pack.pos.length) return;
      const pb = gl.createBuffer(), nb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pack.pos), gl.STREAM_DRAW);
      gl.enableVertexAttribArray(ctx.loc.a);
      gl.vertexAttribPointer(ctx.loc.a, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, nb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pack.nrm), gl.STREAM_DRAW);
      gl.enableVertexAttribArray(ctx.loc.n);
      gl.vertexAttribPointer(ctx.loc.n, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(ctx.loc.col, rgb);
      gl.uniform1f(ctx.loc.op, 1);
      gl.drawArrays(gl.TRIANGLES, 0, pack.pos.length / 3);
      gl.deleteBuffer(pb);
      gl.deleteBuffer(nb);
    };
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    drawPack(red, [0.89, 0.14, 0.14]);
    drawPack(gold, [0.91, 0.77, 0.28]);
  }

  function render3d() {
    const ctx = state3d.gl;
    const canvas = document.getElementById("cv-3d");
    if (!ctx || !canvas || !state.scene) return;
    const gl = ctx.gl;
    const [bw, bh] = canvasBox(canvas);
    // Буфер WebGL раньше всегда был в 1 CSS-пиксель = 1 физический пиксель —
    // на мобильных (devicePixelRatio 2-3×) браузер растягивал маленький
    // буфер на весь физический экран, из-за чего 3D-объекты выглядели
    // «мыльными». Тот же приём (капнутый в 2×) уже используется для КТ-срезов
    // в drawGl() — переносим его и на основной 3D-вид.
    const dpr3d = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round((bw || 400) * dpr3d)), h = Math.max(2, Math.round((bh || 400) * dpr3d));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    if (!state3d.dist) frame3d();
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(42 / 255, 42 / 255, 48 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const target = state3d.target;
    const right = qRot(state3d.rot, [1, 0, 0]);
    const up = qRot(state3d.rot, [0, 1, 0]);
    const back = qRot(state3d.rot, [0, 0, 1]);
    const eye = [
      target[0] + back[0] * state3d.dist,
      target[1] + back[1] * state3d.dist,
      target[2] + back[2] * state3d.dist
    ];
    const z = Math.max(state3d.zoom, 1e-6);
    const halfH = state3d.halfH / z;
    const halfW = halfH * (w / h);
    const near = Math.max(0.5, state3d.dist / 40);
    const far = Math.max(400, state3d.dist * 8);
    const proj = ortho(-halfW + state3d.panX, halfW + state3d.panX, -halfH + state3d.panY, halfH + state3d.panY, near, far);
    const view = new Float32Array([
      right[0], up[0], back[0], 0,
      right[1], up[1], back[1], 0,
      right[2], up[2], back[2], 0,
      -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]),
      -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]),
      -(back[0] * eye[0] + back[1] * eye[1] + back[2] * eye[2]),
      1
    ]);
    const mvp = mul4(proj, view);
    gl.useProgram(ctx.p);
    gl.uniformMatrix4fv(ctx.loc.mvp, false, mvp);
    gl.uniformMatrix4fv(ctx.loc.view, false, view);
    const dist = Math.max(state3d.dist, 1);
    gl.uniform3f(ctx.loc.keyDir, 42, 58, dist + 18);
    gl.uniform3f(ctx.loc.fillDir, -48, 28, dist + 35);
    gl.uniform3f(ctx.loc.hemiDir, right[1], up[1], back[1]);
    const drawOne = (m, pass) => {
      const slot = pass && pass.rest ? "_glRest" : "_gl";
      if (!m[slot]) {
        try { uploadMesh3d(gl, m, pass && pass.tr, slot); }
        catch (e) { m[slot] = { pb: null, nb: null, count: 0 }; return; }
      }
      const buf = m[slot];
      if (!buf || !buf.count) return;
      const col = pass && pass.rgb
        ? [pass.rgb[0] / 255, pass.rgb[1] / 255, pass.rgb[2] / 255]
        : (m.kind === "implant" ? kindColor("implant") : (parseHexColor(m.mesh_color) || kindColor(m.kind)));
      const op = meshOpacityOf(m);
      gl.uniform3fv(ctx.loc.col, col);
      gl.uniform1f(ctx.loc.op, op);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.pb);
      gl.enableVertexAttribArray(ctx.loc.a);
      gl.vertexAttribPointer(ctx.loc.a, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.nb);
      gl.enableVertexAttribArray(ctx.loc.n);
      gl.vertexAttribPointer(ctx.loc.n, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, buf.count);
    };
    const jawSolid = [], restSolid = [], glass = [];
    const isJaw = k => k === "bone" || k === "scan" || k === "anatomy" || k === "teeth" || k === "waxup" || k === "soft";
    for (const m of state.scene.meshes || []) {
      if (!m._pos || m.visible === false || m.kind === "shaft" || state.layers[m.kind] === false) continue;
      const passes = planningPasses(m);
      if (!passes.length) continue;
      const bucket = meshOpacityOf(m) >= 0.98 ? (isJaw(m.kind) ? jawSolid : restSolid) : glass;
      for (const pass of passes) bucket.push({ m, pass });
    }
    glass.sort((a, b) => {
      const pa = meshAnchor(a.m), pb = meshAnchor(b.m);
      const da = (pa[0] - eye[0]) ** 2 + (pa[1] - eye[1]) ** 2 + (pa[2] - eye[2]) ** 2;
      const db = (pb[0] - eye[0]) ** 2 + (pb[1] - eye[1]) ** 2 + (pb[2] - eye[2]) ** 2;
      return db - da;
    });
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    for (const it of jawSolid) drawOne(it.m, it.pass);
    drawPlanningAxes3d(gl, ctx);
    for (const it of restSolid) drawOne(it.m, it.pass);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const it of glass) drawOne(it.m, it.pass);
    gl.depthMask(true);
    state3d.view = { right, up, back, eye, target, halfW, halfH, panX: state3d.panX, panY: state3d.panY, w, h };
    try { drawGizmos3d(); } catch (e) { /* gizmo overlay must not blank 3D */ }
  }

  function helpArt(tab, mobile) {
    helpArt.n = (helpArt.n || 0) + 1;
    const uid = "h" + helpArt.n;
    const grid = `<g class="help-grid" fill="none"><path d="M0 55h360M0 110h360M0 165h360M90 0v220M180 0v220M270 0v220"/></g>`;
    const cursor = () => `<path class="help-cursor" d="M3 1.5l.3 18.2 5.4-4.4 4 8.6 2.4-1.1-4-8.5 6.6-.3z"/>`;
    const finger = () => `<g class="help-press">
      <circle class="help-press-halo" cx="0" cy="0" r="15" fill="none" stroke="rgba(240,240,244,.7)" stroke-width="1.6"/>
      <circle class="help-press-dot" cx="0" cy="0" r="6.5" fill="#f2f2f6"/>
    </g>`;
    const twoFingers = () => `<g>${finger()}<g transform="translate(18,0)">${finger()}</g></g>`;
    const jaw = `<g>
      <ellipse cx="168" cy="168" rx="86" ry="12" fill="#0a0a0e" opacity=".55"/>
      <path fill="#2c2c36" d="M64 158C76 74 118 46 168 46s92 28 104 112c-42-34-74-40-104-40S104 124 64 158z"/>
      <path fill="#3f3f4c" d="M84 150C96 88 128 68 168 68s72 20 84 82c-34-26-60-32-84-32s-50 6-84 32z"/>
      <rect x="118" y="78" width="6" height="20" rx="1.6" fill="#c8bca8"/>
      <rect x="165" y="64" width="6" height="20" rx="1.6" fill="#c8bca8"/>
      <rect x="212" y="78" width="6" height="20" rx="1.6" fill="#c8bca8"/>
    </g>`;
    const cube = `<g>
      <ellipse cx="180" cy="186" rx="54" ry="10" fill="#0a0a0e" opacity=".5"/>
      <path fill="#6a6a76" d="M180 70l50 29-50 29-50-29z"/>
      <path fill="#3a3a44" d="M130 99v56l50 29v-56z"/>
      <path fill="#52525e" d="M180 128v56l50-29v-56z"/>
      <path fill="none" stroke="#d0d0d8" stroke-width="1.3" d="M180 70l50 29v56l-50 29-50-29v-56zM180 70v58M130 99l50 29 50-29"/>
    </g>`;
    const barrel = `<g transform="translate(180,112)">
      <ellipse cx="0" cy="50" rx="36" ry="12" fill="#1a2026"/>
      <rect x="-36" y="-44" width="72" height="94" fill="#3a4a54"/>
      <ellipse cx="0" cy="50" rx="36" ry="12" fill="#2a343c"/>
      <ellipse cx="0" cy="-44" rx="36" ry="12" fill="#6a7c88"/>
      <ellipse cx="0" cy="-44" rx="36" ry="12" fill="none" stroke="#b4c4cc" stroke-width="1.3"/>
      <line x1="0" y1="-58" x2="0" y2="58" stroke="rgba(232,232,236,.35)" stroke-width="1.2" stroke-dasharray="3 4"/>
    </g>`;
    const arch = `<g fill="none" stroke="#8a8a96" stroke-width="10" stroke-linecap="round">
      <path d="M48 168C64 78 112 44 180 44s116 34 132 124" opacity=".28"/>
    </g>
    <g fill="none" stroke="#c8c8d2" stroke-width="2.2">
      <path d="M48 168C64 78 112 44 180 44s116 34 132 124"/>
      <path d="M72 166C86 96 124 72 180 72s94 24 108 94" opacity=".45"/>
    </g>
    <g>
      <rect x="114" y="82" width="7" height="22" rx="1.6" fill="#c8bca8"/>
      <rect x="176" y="66" width="7" height="22" rx="1.6" fill="#c8bca8"/>
      <rect x="238" y="82" width="7" height="22" rx="1.6" fill="#c8bca8"/>
      <rect class="help-site-on" x="174" y="64" width="11" height="26" rx="2" fill="#ffe7b0"/>
    </g>`;
    const mouseAt = (x, y, mode) => {
      const rmb = mode === "rmb";
      const scm = mode === "scm";
      const whl = mode === "wheel";
      return `<g transform="translate(${x},${y})">
        ${scm ? `<circle class="help-scm-glow" cx="20" cy="16" r="16"/>` : ""}
        <rect x="0" y="0" width="40" height="56" rx="16" fill="#1a1a22" stroke="#e8e8ec" stroke-width="1.6"/>
        <path d="M20 3v16" stroke="#5a5a64"/>
        <rect x="5" y="5" width="14" height="14" rx="5" fill="${rmb ? "#2a2a32" : "#2a2a32"}"/>
        <rect x="21" y="5" width="14" height="14" rx="5" fill="${rmb ? "#e8c070" : "#2a2a32"}"/>
        <rect x="17" y="8" width="6" height="14" rx="2" fill="${scm || whl ? "#4aa8ff" : "#3a3a44"}"/>
        <rect class="${whl ? "help-wheel-notch" : ""}" x="18" y="10" width="4" height="6" rx="1" fill="#f0f0f4"/>
        ${scm ? `<text x="20" y="50" text-anchor="middle" fill="#7eb6ff" font-size="9" font-weight="700" font-family="system-ui">СКМ</text>` : ""}
        ${rmb ? `<text x="20" y="50" text-anchor="middle" fill="#e8c070" font-size="9" font-weight="700" font-family="system-ui">ПКМ</text>` : ""}
        ${whl ? `<text x="20" y="50" text-anchor="middle" fill="#9aa0c8" font-size="9" font-weight="700" font-family="system-ui">колесо</text>` : ""}
      </g>`;
    };
    const knob = (cx, cy, kind) => {
      const fill = kind === "move" ? "#f2f2f2" : kind === "spin" ? "#f0b429" : "#3dcf3a";
      const stroke = kind === "move" ? "#333" : kind === "spin" ? "#7a5a10" : "#145c14";
      const icon = kind === "move"
        ? `<path d="M${cx - 4} ${cy}h8M${cx} ${cy - 4}v8" fill="none" stroke="#222" stroke-width="1.5"/>`
        : kind === "spin"
          ? `<path d="M${cx - 3.2},${cy} a3.2,3.2 0 1 1 3.2,3.2" fill="none" stroke="#5a4208" stroke-width="1.4"/>`
          : `<path d="M${cx - 2.6},${cy + 1} a3.2,3.2 0 1 1 4,-2" fill="none" stroke="#0d3d0d" stroke-width="1.4"/>`;
      return `<g><circle cx="${cx}" cy="${cy}" r="8" fill="#111"/><circle cx="${cx}" cy="${cy}" r="6.6" fill="${fill}" stroke="${stroke}" stroke-width="1.1"/>${icon}</g>`;
    };
    const bar = t => `<rect class="help-bar" x="0" y="196" width="360" height="24"/><text class="help-cap" x="180" y="212" text-anchor="middle">${t}</text>`;
    const defs = `<defs><radialGradient id="${uid}" cx="50%" cy="40%" r="70%"><stop offset="0%" stop-color="#1c1c24"/><stop offset="100%" stop-color="#0c0c10"/></radialGradient></defs>`;
    const frame = (cls, inner) =>
      `<svg class="help-svg ${cls || ""}" viewBox="0 0 360 220" aria-hidden="true">${defs}<rect width="360" height="220" fill="#101016"/><rect width="360" height="220" fill="url(#${uid})"/>${grid}${inner}</svg>`;
    if (tab === "views") {
      return frame("", `
        <rect x="40" y="22" width="280" height="158" rx="14" fill="#141418" stroke="#5a5a64"/>
        <g transform="translate(56,34)">
          <rect class="help-views-a" x="0" y="0" width="54" height="24" rx="12" fill="#4a4a54" stroke="#c8c8d0"/>
          <text x="27" y="16" text-anchor="middle" fill="#f2f2f6" font-size="10" font-family="system-ui">3D</text>
          <rect class="help-views-b" x="62" y="0" width="72" height="24" rx="12" fill="#2a2a32" stroke="#6a6a74"/>
          <text x="98" y="16" text-anchor="middle" fill="#d0d0d6" font-size="10" font-family="system-ui">AXIAL</text>
          <rect class="help-views-c" x="142" y="0" width="72" height="24" rx="12" fill="#2a2a32" stroke="#6a6a74"/>
          <text x="178" y="16" text-anchor="middle" fill="#d0d0d6" font-size="10" font-family="system-ui">CROSS</text>
        </g>
        <g class="help-views-a" transform="translate(70,58) scale(.62)">${cube}</g>
        <g class="help-views-b" transform="translate(180,118)">
          <path d="M-64,18 L64,18 L44,-30 L-44,-30 Z" fill="rgba(255,122,58,0.35)" stroke="#ff7a3a" stroke-width="2"/>
        </g>
        <g class="help-views-c" transform="translate(180,118)">
          <rect x="-50" y="-52" width="100" height="104" fill="rgba(142,196,216,0.32)" stroke="#8ec4d8" stroke-width="2"/>
        </g>
        <g class="help-views-a" transform="translate(83,46)">${finger()}</g>
        <g class="help-views-b" transform="translate(154,46)">${finger()}</g>
        <g class="help-views-c" transform="translate(234,46)">${finger()}</g>
        ${bar("3D · AXIAL · CROSS")}`);
    }
    if (tab === "3d") {
      if (!mobile) {
        return frame("help-seq-orbit", `
          <g class="help-cube-one">${cube}</g>
          <g class="help-ph-orbit">${mouseAt(292, 108, "rmb")}${bar("ПКМ — орбита")}</g>
          <g class="help-ph-pan">${mouseAt(292, 108, "scm")}${bar("СКМ — сдвиг")}</g>
          <g class="help-ph-zoom">${mouseAt(292, 108, "wheel")}${bar("Колесо — масштаб")}</g>`);
      }
      return frame("help-seq-touch", `
        <g class="help-cube-one">${cube}</g>
        <g class="help-ph-1"><g transform="translate(168,52)">${finger()}</g>${bar("Один палец — вращение")}</g>
        <g class="help-ph-2"><g transform="translate(210,124)">${twoFingers()}</g>${bar("Два пальца — сдвиг")}</g>`);
    }
    if (tab === "ct") {
      const planes = `
        ${barrel}
        <g class="help-cross-z">
          <rect x="128" y="46" width="104" height="132" fill="rgba(142,196,216,0.30)" stroke="#8ec4d8" stroke-width="1.6"/>
        </g>
        <g transform="translate(180,112)">
          <g class="help-plane-lift">
            <path d="M-70,22 L70,22 L48,-36 L-48,-36 Z" fill="rgba(255,122,58,0.30)" stroke="#ff7a3a" stroke-width="1.6"/>
            <path d="M-70,22 L70,22 L70,28 L-70,28 Z" fill="rgba(255,122,58,0.4)"/>
          </g>
        </g>`;
      if (!mobile) {
        return frame("", `${planes}${mouseAt(304, 132, "wheel")}${bar("CROSS крутит · AXIAL едет")}`);
      }
      return frame("help-seq-touch", `
        <g class="help-ph-1">${planes}
          <g transform="translate(150,168)"><g class="help-drag-h">${finger()}</g></g>
          ${bar("Влево-вправо — Обзор")}</g>
        <g class="help-ph-2"><g class="help-ct-zoom">${planes}</g>
          <g transform="translate(250,90)"><g class="help-drag-v">${finger()}</g></g>
          ${bar("Вверх-вниз — масштаб")}</g>`);
    }
    if (tab === "implants") {
      const pointer = `<g class="help-opg-cursor">${mobile ? finger() : cursor()}</g>`;
      const switchRow = `<g>
        <rect x="60" y="40" width="46" height="32" rx="16" fill="#2d6ca8" stroke="#8cbef0" stroke-width="1.4"/>
        <text x="83" y="60" text-anchor="middle" fill="#f0f6ff" font-size="12" font-family="system-ui" font-weight="700">35</text>
        <rect x="149" y="40" width="46" height="32" rx="16" fill="#d9822b" stroke="#ffb86a" stroke-width="1.4"/>
        <text x="172" y="60" text-anchor="middle" fill="#fff" font-size="12" font-family="system-ui" font-weight="700">36</text>
        <rect x="238" y="40" width="46" height="32" rx="16" fill="#2d6ca8" stroke="#8cbef0" stroke-width="1.4"/>
        <text x="261" y="60" text-anchor="middle" fill="#f0f6ff" font-size="12" font-family="system-ui" font-weight="700">37</text>
      </g>`;
      return frame("", `${switchRow}${pointer}${bar(mobile ? "Тап по кнопке — выбор импланта" : "Клик по кнопке — выбор импланта")}`);
    }
    if (tab === "tools") {
      const line = `<g class="help-fade-line">
        <path class="help-draw" d="M88 152 L246 80" fill="none" stroke="#f0f0f4" stroke-width="2"/>
        <circle cx="88" cy="152" r="4" fill="#f0f0f4"/>
        <circle cx="246" cy="80" r="4" fill="#f0f0f4"/>
        <rect x="140" y="96" width="58" height="16" rx="3" fill="#1c1c24" stroke="#8a8a94"/>
        <text x="169" y="108" text-anchor="middle" fill="#e8e8ec" font-size="9" font-family="system-ui">12.4 mm</text>
      </g>`;
      if (!mobile) {
        return frame("", `${jaw}${line}
          <g transform="translate(268,148)"><g class="help-key-press"><rect width="58" height="22" rx="4" fill="#2a2a32" stroke="#c4c4cc"/><text x="29" y="15" text-anchor="middle" fill="#e8e8ec" font-size="9" font-family="system-ui">Delete</text></g></g>
          ${bar("Два клика — одна линейка")}`);
      }
      return frame("", `${jaw}${line}
        <circle class="help-tap-ring" cx="168" cy="116" r="12" fill="none" stroke="rgba(220,230,255,.75)" stroke-width="1.4"/>
        <g transform="translate(150,100)"><g class="help-dtap-hand">${finger()}</g></g>
        ${bar("Двойной тап по линейке — удалить")}`);
    }
    if (tab === "edit") {
      return frame("", `
        ${barrel}
        <g class="help-edit-tilt">
          <rect x="140" y="72" width="80" height="80" fill="rgba(255,122,58,0.16)" stroke="#e04a3a" stroke-width="1.4"/>
          <line x1="180" y1="46" x2="180" y2="178" stroke="rgba(220,40,40,0.95)" stroke-width="1.7"/>
          <line x1="152" y1="112" x2="216" y2="112" stroke="rgba(220,40,40,0.95)" stroke-width="1.5"/>
          <circle cx="180" cy="112" r="22" fill="none" stroke="rgba(240,180,41,0.7)" stroke-width="1.2" stroke-dasharray="4 4"/>
          ${knob(180, 112, "move")}
          ${knob(180, 48, "tilt")}
          ${knob(180, 176, "tilt")}
          ${knob(210, 112, "spin")}
          <g transform="translate(198,36)"><g class="help-gizmo-drag">${mobile ? finger() : cursor()}</g></g>
        </g>
        ${bar("Ручки: сдвиг, наклон, поворот")}`);
    }
    return frame("", `
      <g transform="translate(-70,8)"><g class="help-obj-cube">${cube}</g></g>
      <g transform="translate(168,36)">
        <rect width="176" height="136" rx="10" fill="#1a1a22" stroke="rgba(255,255,255,.1)"/>
        <text x="16" y="28" fill="#a8a8b0" font-size="10" font-family="system-ui">Прозрачность</text>
        <line x1="16" y1="48" x2="156" y2="48" stroke="#6a6a74" stroke-width="2"/>
        <circle class="help-thumb" cx="58" cy="48" r="6" fill="#c4c4cc"/>
        <rect class="help-box-on" x="16" y="78" width="16" height="16" rx="3" fill="#8a8a94" stroke="#a0a0a8" stroke-width="1.6"/>
        <path class="help-check" d="M19 86l4.2 4.2 8-8.4" fill="none" stroke="#fff" stroke-width="1.7"/>
        <text x="42" y="91" fill="#e8e8ec" font-size="13" font-family="system-ui">Waxup</text>
      </g>`);
  }

  function bindHelp() {
    const openBtn = document.getElementById("help-open");
    const modal = document.getElementById("help-modal");
    const tabsEl = document.getElementById("help-tabs");
    const artEl = document.getElementById("help-art");
    const titleEl = document.getElementById("help-title");
    const textEl = document.getElementById("help-text");
    const tourRoot = document.getElementById("help-tour-root");
    const hole = document.getElementById("help-tour-hole");
    const tourCard = document.getElementById("help-tour-card");
    const tourArt = document.getElementById("help-tour-art");
    const tourTitle = document.getElementById("help-tour-title");
    const tourText = document.getElementById("help-tour-text");
    if (!openBtn || !modal || !tabsEl) return;
    const copy = {
      desk: {
        views: { title: "Виды", text: "На широком экране 3D, CROSS и AXIAL видны сразу. Кнопки 3D / AXIAL / CROSS нужны на телефоне." },
        "3d": { title: "3D", text: "ПКМ вращает сцену. СКМ или ЛКМ+ПКМ сдвигают. Колесо — масштаб. Один ЛКМ камеру не крутит: так можно жать ручки коррекции." },
        ct: { title: "КТ", text: "Колесо листает Обзор: CROSS крутит срез вокруг оси, AXIAL едет вдоль неё. Shift или СКМ — пан. Ползунки Обзор, Масштаб и Контраст всегда на срезе." },
        implants: { title: "Импланты", text: "Кнопки под 3D-видом переключают текущий имплант: ось, КТ и 3D подстраиваются под выбранный." },
        tools: { title: "Инструменты", text: "Линейка — два клика на CROSS или аксиале. На экране одна: новая заменяет предыдущую. Delete или Backspace снимает её, кнопка корзины тоже. Маркер, цвет, кисть и комментарий — рядом." },
        edit: { title: "Коррекция", text: "Вход — кнопка в панели под 3D. Ручки на CROSS, аксиале и в 3D двигают, наклоняют и крутят. Исходный / Коррекция и сброс — там же." },
        objects: { title: "Объекты", text: "Галочки и ползунки прозрачности в списке под 3D. Текущий объект выбирается кнопками переключения имплантов; строка в списке только повторяет выбор." }
      },
      mobile: {
        views: { title: "Виды", text: "В углу экрана кнопки 3D, AXIAL и CROSS. Тап меняет, что показано в этой клетке: модель, аксиальный срез или CROSS." },
        "3d": { title: "3D", text: "Один палец вращает модель. Два пальца сдвигают кадр." },
        ct: { title: "КТ", text: "Свайп влево-вправо листает Обзор. Свайп вверх-вниз меняет масштаб. Два пальца сдвигают срез. Ползунки — кнопка на срезе." },
        implants: { title: "Импланты", text: "Кнопки под экраном переключают текущий имплант." },
        tools: { title: "Инструменты", text: "Панель снизу. Линейка — две точки, на экране одна. Двойной тап по линейке удаляет. Маркер и комментарий рядом." },
        edit: { title: "Коррекция", text: "Вход — кнопка в нижней панели. Тяните цветные ручки пальцем. Исходный / Коррекция и сброс — там же." },
        objects: { title: "Объекты", text: "Список сверху. Ползунок — прозрачность, галочка — показать или скрыть. Выбор объекта — кнопки переключения имплантов." }
      }
    };
    const tabList = () => {
      const all = [
        { id: "views", label: "Виды" },
        { id: "3d", label: "3D" },
        { id: "ct", label: "КТ" },
        { id: "implants", label: "Импланты" },
        { id: "tools", label: "Инструменты" },
        { id: "edit", label: "Коррекция" },
        { id: "objects", label: "Объекты" }
      ];
      return isMobileLayout() ? all : all.filter(t => t.id !== "views");
    };
    let tab = "3d";
    let tourI = -1;
    let mqMobile = isMobileLayout();
    const stopPulse = () => openBtn.classList.remove("help-open--pulse");
    const setOpen = on => {
      modal.classList.toggle("is-on", on);
      modal.setAttribute("aria-hidden", on ? "false" : "true");
      if (on) stopPulse();
    };
    const pack = () => (isMobileLayout() ? "mobile" : "desk");
    const renderPanel = () => {
      const p = copy[pack()][tab];
      titleEl.textContent = p.title;
      textEl.textContent = p.text;
      artEl.innerHTML = helpArt(tab, pack() === "mobile");
      tabsEl.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.getAttribute("data-help-tab") === tab));
    };
    const fillTabs = () => {
      const list = tabList();
      if (!list.some(t => t.id === tab)) tab = list[0].id;
      tabsEl.innerHTML = "";
      list.forEach(t => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = t.label;
        b.setAttribute("data-help-tab", t.id);
        b.onclick = ev => { ev.preventDefault(); tab = t.id; renderPanel(); };
        tabsEl.appendChild(b);
      });
    };
    fillTabs();
    const tourSteps = () => {
      const mobile = isMobileLayout();
      const src = copy[mobile ? "mobile" : "desk"];
      const steps = [
        { sel: "#screen-3d", tab: "3d" },
        { sel: "#view-long", tab: "ct" },
        { sel: "#view-ax", tab: "ct" },
        { sel: "#implant-switch", tab: "implants" },
        { sel: "#tool-ruler", tab: "tools" },
        { sel: "#tool-marker", tab: "tools" },
        { sel: "#tool-enter-edit", tab: "edit" },
        { sel: "#layers", tab: "objects" }
      ];
      if (!mobile) {
        steps.push({ sel: "#sl-rot-long", tab: "ct" }, { sel: "#sl-off", tab: "ct" });
      } else {
        steps.unshift({ sel: "#view3d .view-swap", tab: "views" });
        steps.push({ sel: "#ctcol .view-swap", tab: "views" });
        steps.push({ sel: "#view-long .sliders-toggle", tab: "ct" });
      }
      return steps.map(s => {
        const p = src[s.tab];
        return { sel: s.sel, tab: s.tab, title: p.title, text: p.text };
      }).filter(s => {
        const el = document.querySelector(s.sel);
        return el && el.getBoundingClientRect().width > 2;
      });
    };
    const placeTour = () => {
      const steps = tourSteps();
      if (tourI < 0 || !steps.length) return;
      if (tourI >= steps.length) tourI = steps.length - 1;
      const step = steps[tourI];
      if (step.tab === "objects" && app.classList.contains("side-off")) {
        app.classList.remove("side-off");
        placeSideToggle();
      }
      const el = document.querySelector(step.sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const pad = 6;
      hole.style.left = Math.max(4, r.left - pad) + "px";
      hole.style.top = Math.max(4, r.top - pad) + "px";
      hole.style.width = Math.max(8, r.width + pad * 2) + "px";
      hole.style.height = Math.max(8, r.height + pad * 2) + "px";
      tourTitle.textContent = step.title;
      tourText.textContent = step.text;
      tourArt.innerHTML = helpArt(step.tab, isMobileLayout());
      const cardW = Math.min(360, window.innerWidth - 24);
      const cardH = tourCard.offsetHeight || 220;
      const mobile = isMobileLayout();
      let left = r.right + 14;
      let top = r.top;
      if (mobile) {
        if (r.top > window.innerHeight * 0.55) {
          top = Math.max(10, r.top - cardH - 16);
          left = Math.max(12, (window.innerWidth - cardW) / 2);
        } else {
          top = Math.min(window.innerHeight - cardH - 12, r.bottom + 14);
          left = Math.max(12, (window.innerWidth - cardW) / 2);
        }
      } else if (left + cardW > window.innerWidth - 12) {
        left = Math.max(12, r.left - cardW - 14);
        if (left + cardW > window.innerWidth - 12) left = 12;
      }
      if (top + cardH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - cardH - 8);
      if (top < 8) top = 8;
      tourCard.style.left = left + "px";
      tourCard.style.top = top + "px";
      const back = document.getElementById("help-tour-back");
      const next = document.getElementById("help-tour-next");
      if (back) back.disabled = tourI <= 0;
      if (next) next.textContent = tourI >= steps.length - 1 ? "Готово" : "Далее";
    };
    const closeTour = () => {
      tourI = -1;
      tourRoot.classList.remove("is-on");
      tourRoot.setAttribute("aria-hidden", "true");
    };
    const openTour = () => {
      setOpen(false);
      tourI = 0;
      tourRoot.classList.add("is-on");
      tourRoot.setAttribute("aria-hidden", "false");
      requestAnimationFrame(placeTour);
    };
    openBtn.onclick = ev => {
      ev.preventDefault();
      ev.stopPropagation();
      stopPulse();
      closeTour();
      setOpen(true);
      renderPanel();
    };
    const dim = document.getElementById("help-dim");
    const closeBtn = document.getElementById("help-close");
    const closeModal = () => setOpen(false);
    if (dim) dim.onclick = closeModal;
    if (closeBtn) closeBtn.onclick = ev => { ev.preventDefault(); closeModal(); };
    const tourStart = document.getElementById("help-tour-start");
    if (tourStart) tourStart.onclick = ev => { ev.preventDefault(); openTour(); };
    const tourBack = document.getElementById("help-tour-back");
    const tourNext = document.getElementById("help-tour-next");
    const tourEnd = document.getElementById("help-tour-end");
    if (tourBack) tourBack.onclick = ev => { ev.preventDefault(); if (tourI > 0) { tourI -= 1; placeTour(); } };
    if (tourNext) tourNext.onclick = ev => {
      ev.preventDefault();
      const n = tourSteps().length;
      if (tourI >= n - 1) closeTour();
      else { tourI += 1; placeTour(); }
    };
    if (tourEnd) tourEnd.onclick = ev => { ev.preventDefault(); closeTour(); };
    window.addEventListener("keydown", ev => {
      if (ev.key !== "Escape") return;
      if (tourI >= 0) { closeTour(); ev.preventDefault(); ev.stopPropagation(); return; }
      if (modal.classList.contains("is-on")) { closeModal(); ev.preventDefault(); ev.stopPropagation(); }
    }, true);
    const mq = window.matchMedia("(max-width: 820px)");
    const onLayout = () => {
      const now = isMobileLayout();
      if (now !== mqMobile) {
        mqMobile = now;
        fillTabs();
        if (modal.classList.contains("is-on")) renderPanel();
        if (tourI >= 0) placeTour();
      } else if (tourI >= 0) placeTour();
    };
    if (mq.addEventListener) mq.addEventListener("change", onLayout);
    else if (mq.addListener) mq.addListener(onLayout);
    window.addEventListener("resize", () => { if (tourI >= 0) placeTour(); });
    openBtn.addEventListener("animationend", ev => {
      if (ev.animationName === "help-pulse") stopPulse();
    });
    setTimeout(stopPulse, 10000);
    renderPanel();
  }

  function implantInfoField(info, tab) {
    if (tab === "abutment") {
      if (!info.abutment) return null;
      const a = info.abutment;
      const bits = [];
      if (a.size) bits.push(a.size);
      if (a.article) bits.push("арт. " + a.article);
      return { title: [a.manufacturer, a.model].filter(Boolean).join(" ") || "—", sub: bits.join(" · ") };
    }
    if (tab === "sleeve") {
      if (!info.sleeve) return null;
      const s = info.sleeve;
      const bits = [];
      if (s.diameter) bits.push("⌀" + s.diameter.toFixed(1) + " мм");
      if (s.height) bits.push("h " + s.height.toFixed(1) + " мм");
      if (s.article) bits.push("арт. " + s.article);
      if (s.distance != null) bits.push("офсет " + s.distance.toFixed(1) + " мм от платформы");
      return { title: [s.manufacturer, s.model].filter(Boolean).join(" ") || "—", sub: bits.join(" · ") };
    }
    const bits = [];
    if (info.diameter) bits.push("⌀" + info.diameter.toFixed(1) + " × " + (info.length || 0).toFixed(1) + " мм");
    if (info.article) bits.push("арт. " + info.article);
    return { title: [info.manufacturer, info.model].filter(Boolean).join(" ") || "—", sub: bits.join(" · ") };
  }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  // Направление импланта "апекс → коронка" по реальной геометрии (та же
  // логика, что уже исправляла красную трубку/рычаг гизмо) — используется
  // как устойчивый общий ориентир для измерения углов МЕЖДУ имплантами:
  // сырой site.axis нельзя сравнивать напрямую между разными имплантами —
  // знак не стандартизован между библиотеками (см. фикс красной трубки),
  // из-за чего два физически почти параллельных импланта из разных
  // библиотек могли бы дать угол ~180° вместо ~0°.
  function siteOutDir(site) {
    const span = siteAxisSpan(site);
    const dx = span.crown[0] - span.apex[0], dy = span.crown[1] - span.apex[1], dz = span.crown[2] - span.apex[2];
    const len = Math.hypot(dx, dy, dz);
    return len > 1e-6 ? [dx / len, dy / len, dz / len] : norm(site.axis || [0, 0, 1]);
  }

  // Вкладка "Углы": угол каждого импланта относительно выбранного
  // "мастер"-импланта (state._angleMasterId) — 0° у самого мастера.
  function renderImplantAngles(body, sites) {
    if (sites.length < 2) {
      body.innerHTML = '<div class="implant-info__empty">Для сравнения углов нужно хотя бы два импланта с данными.</div>';
      return;
    }
    if (!state._angleMasterId || !sites.some(s => s.id === state._angleMasterId)) {
      state._angleMasterId = sites[0].id;
    }
    const master = sites.find(s => s.id === state._angleMasterId);
    const masterDir = siteOutDir(master);
    const items = sites.map(s => {
      const isMaster = s.id === state._angleMasterId;
      const ctrlHtml = isMaster
        ? '<span class="implant-info__master-tag">★ Мастер</span>'
        : '<button type="button" class="implant-info__master-btn" data-master-id="' + escHtml(s.id) + '">Сделать мастером</button>';
      const angleVal = isMaster ? "0.0°"
        : (Math.acos(Math.max(-1, Math.min(1, dot3(masterDir, siteOutDir(s))))) * 180 / Math.PI).toFixed(1) + "°";
      return '<div class="implant-info__item"><div class="implant-info__tooth">Зуб ' + escHtml(s.tooth || s.id) + "</div>" +
        '<div class="implant-info__row implant-info__row--angle">' + ctrlHtml +
        '<span class="implant-info__row-val"><b>' + angleVal + "</b></span></div></div>";
    }).join("");
    body.innerHTML = items;
  }

  function renderImplantInfo() {
    const body = document.getElementById("implant-info-body");
    if (!body) return;
    const sites = ((state.scene && state.scene.sites) || []).filter(s => s.kind === "implant" && s.info);
    if (!sites.length) {
      body.innerHTML = '<div class="implant-info__empty">В проекте нет каталожных данных об имплантах.</div>';
      return;
    }
    const tab = state._implantInfoTab || "implant";
    if (tab === "angles") { renderImplantAngles(body, sites); return; }
    const items = sites.map(s => {
      const f = implantInfoField(s.info, tab);
      if (!f) return "";
      return '<div class="implant-info__item"><div class="implant-info__tooth">Зуб ' + escHtml(s.tooth || s.id) + "</div>" +
        '<div class="implant-info__row"><span class="implant-info__row-val"><b>' + escHtml(f.title) + "</b>" + (f.sub ? "<br>" + escHtml(f.sub) : "") + "</span></div></div>";
    }).join("");
    body.innerHTML = items || '<div class="implant-info__empty">Для этой части нет данных ни у одного импланта.</div>';
  }

  function bindImplantInfo() {
    const openBtn = document.getElementById("implant-info-open");
    const modal = document.getElementById("implant-info-modal");
    if (!openBtn || !modal) return;
    const tabsBar = document.getElementById("implant-info-tabs");
    if (tabsBar) {
      tabsBar.querySelectorAll("button").forEach(b => {
        b.onclick = () => {
          state._implantInfoTab = b.dataset.tab;
          tabsBar.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
          renderImplantInfo();
        };
      });
    }
    const body = document.getElementById("implant-info-body");
    if (body) {
      body.addEventListener("click", ev => {
        const btn = ev.target.closest(".implant-info__master-btn");
        if (!btn) return;
        state._angleMasterId = btn.dataset.masterId;
        renderImplantInfo();
      });
    }
    const setOpen = on => {
      modal.classList.toggle("is-on", on);
      modal.setAttribute("aria-hidden", on ? "false" : "true");
    };
    openBtn.onclick = ev => {
      ev.preventDefault();
      ev.stopPropagation();
      renderImplantInfo();
      setOpen(true);
    };
    const dim = document.getElementById("implant-info-dim");
    const closeBtn = document.getElementById("implant-info-close");
    const closeModal = () => setOpen(false);
    if (dim) dim.onclick = closeModal;
    if (closeBtn) closeBtn.onclick = ev => { ev.preventDefault(); closeModal(); };
    window.addEventListener("keydown", ev => {
      if (ev.key !== "Escape") return;
      if (modal.classList.contains("is-on")) { closeModal(); ev.preventDefault(); ev.stopPropagation(); }
    }, true);
  }

  async function start() {
    try {
      const sceneEl = document.getElementById("d3d-scene-payload");
      const volEl = document.getElementById("d3d-vol-payload");
      if (!sceneEl || !volEl) throw new Error("В файле нет сцены или КТ");
      setBoot("Распаковка сцены…");
      await yieldUi();
      const sceneBytes = await gunzipBytes(await b64ToBytes(sceneEl.textContent, "Распаковка сцены…"), "Распаковка сцены…");
      state.scene = parseSceneBytes(sceneBytes);
      setBoot("Распаковка КТ…");
      await yieldUi();
      const packed = await b64ToBytes(volEl.textContent, "Распаковка КТ…");
      try {
        state.vol = await decodeVolumeInWorker(packed);
      } catch (e) {
        setBoot("Сборка КТ…");
        const raw = await gunzipBytes(packed, "Сборка КТ…");
        state.vol = await decodeVolumeFixed(raw);
      }
      const loadedRulers = state.scene.measurements || [];
      state.measurements = loadedRulers.length ? [loadedRulers[loadedRulers.length - 1]] : [];
      state.markers = state.scene.slice_markers || [];
      state.comments = state.scene.comments || [];
      snapshotEdits();
      app.classList.add("ready");
      if (isMobileLayout()) app.classList.add("side-off");
      boot.style.display = "none";
      fillLayers();
      fillImplantSwitch();
      applyViewModes();
      placeSideToggle();
      placeTools();
      bindHelp();
      bindImplantInfo();
      document.querySelectorAll(".view-swap button").forEach(btn => {
        btn.onclick = ev => {
          ev.preventDefault();
          ev.stopPropagation();
          const bar = btn.closest(".view-swap");
          setPaneMode(bar && bar.getAttribute("data-pane"), btn.getAttribute("data-mode"));
        };
      });
      document.querySelectorAll(".sliders-toggle").forEach(btn => {
        btn.addEventListener("pointerdown", ev => ev.stopPropagation());
        btn.addEventListener("click", ev => {
          ev.preventDefault();
          ev.stopPropagation();
          const host = btn.closest(".view, #opg");
          if (!host) return;
          const on = host.classList.toggle("sliders-on");
          btn.classList.toggle("on", on);
          btn.setAttribute("aria-pressed", on ? "true" : "false");
        });
      });
      const sideBtn = document.getElementById("side-toggle");
      if (sideBtn) {
        sideBtn.onclick = ev => {
          ev.preventDefault();
          ev.stopPropagation();
          app.classList.toggle("side-off");
          placeSideToggle();
          schedulePaint(16);
        };
      }
      const tools = document.querySelector(".view3d-tools");
      if (tools) {
        const stop = ev => ev.stopPropagation();
        tools.addEventListener("pointerdown", stop, true);
        tools.addEventListener("mousedown", stop, true);
        tools.addEventListener("wheel", stop, true);
      }
      if (sideBtn) {
        const stop = ev => ev.stopPropagation();
        sideBtn.addEventListener("pointerdown", stop, true);
        sideBtn.addEventListener("mousedown", stop, true);
      }
      init3d();
      const slLong = document.getElementById("sl-rot-long");
      const slOff = document.getElementById("sl-off");
      const slZLong = document.getElementById("sl-zoom-long");
      const slZAx = document.getElementById("sl-zoom-ax");
      const slCLong = document.getElementById("sl-contrast-long");
      const slCAx = document.getElementById("sl-contrast-ax");
      const bindLive = (el, apply, paint, endPaint) => {
        if (!el) return;
        let raf = 0;
        const tick = () => { raf = 0; paint(); };
        const end = () => {
          if (!state._live && !raf) return;
          state._live = false;
          if (raf) { cancelAnimationFrame(raf); raf = 0; }
          (endPaint || paint)();
        };
        el.addEventListener("pointerdown", () => { state._live = true; });
        el.addEventListener("pointerup", end);
        el.addEventListener("pointercancel", end);
        window.addEventListener("pointerup", end);
        el.addEventListener("change", end);
        el.oninput = ev => {
          apply(+ev.target.value);
          if (!raf) raf = requestAnimationFrame(tick);
        };
      };
      bindLive(slLong, v => { state.rotLong = v; syncSliderVal("sl-rot-long"); }, () => renderMpr("long"), () => renderMpr("long"));
      bindLive(slOff, v => { state.off = v; syncSliderVal("sl-off"); }, () => renderMpr("ax"), () => renderMpr("ax"));
      bindLive(slZLong, v => { state.zoomLong = v; syncSliderVal("sl-zoom-long"); }, () => renderMpr("long"), () => renderMpr("long"));
      bindLive(slZAx, v => { state.zoomAx = v; syncSliderVal("sl-zoom-ax"); }, () => renderMpr("ax"), () => renderMpr("ax"));
      bindLive(slCLong, v => { state.contrastLong = v; syncSliderVal("sl-contrast-long"); }, () => renderMprCt("long"), () => renderMprCt("long"));
      bindLive(slCAx, v => { state.contrastAx = v; syncSliderVal("sl-contrast-ax"); }, () => renderMprCt("ax"), () => renderMprCt("ax"));
      const slZOpg = document.getElementById("sl-zoom-opg");
      if (slZOpg) {
        slZOpg.value = String(state.zoomOpg || 1.25);
        syncSliderVal("sl-zoom-opg");
      }
      bindLive(slZOpg, v => { state.zoomOpg = v; syncSliderVal("sl-zoom-opg"); }, renderOpg);
      const ruler = document.getElementById("tool-ruler");
      const rulerClear = document.getElementById("tool-ruler-clear");
      const marker = document.getElementById("tool-marker");
      const comment = document.getElementById("tool-comment");
      const colorEl = document.getElementById("marker-color");
      const widthEl = document.getElementById("marker-width");
      const widthVal = document.getElementById("marker-width-val");
      const setMprCursor = () => {
        const cur = (state.tool === "marker" || state.tool === "comment") ? "crosshair" : "grab";
        const a = document.getElementById("cv-long");
        const b = document.getElementById("cv-ax");
        if (a) a.style.cursor = cur;
        if (b) b.style.cursor = cur;
      };
      const setToolOn = (el, on) => {
        if (!el) return;
        el.classList.toggle("layers-dock__btn--active", on);
        el.classList.toggle("on", on);
      };
      const pickTool = name => {
        state.tool = state.tool === name ? null : name;
        setToolOn(ruler, state.tool === "ruler");
        setToolOn(marker, state.tool === "marker");
        setToolOn(comment, state.tool === "comment");
        if (tools) tools.classList.toggle("marker-on", state.tool === "marker");
        setMprCursor();
      };
      if (colorEl) {
        colorEl.value = state.markerColor;
        colorEl.oninput = () => { state.markerColor = colorEl.value; };
      }
      if (widthEl) {
        widthEl.value = String(state.markerWidth);
        if (widthVal) widthVal.textContent = String(state.markerWidth);
        widthEl.oninput = () => {
          state.markerWidth = +widthEl.value;
          if (widthVal) widthVal.textContent = String(state.markerWidth);
        };
      }
      document.querySelectorAll("[data-marker-swatch]").forEach(btn => {
        btn.onclick = ev => {
          ev.preventDefault();
          state.markerColor = btn.getAttribute("data-marker-swatch");
          if (colorEl) colorEl.value = state.markerColor;
          document.querySelectorAll("[data-marker-swatch]").forEach(b =>
            b.classList.toggle("on", b.getAttribute("data-marker-swatch") === state.markerColor));
        };
      });
      if (ruler) ruler.onclick = () => pickTool("ruler");
      if (rulerClear) rulerClear.onclick = ev => { ev.preventDefault(); clearRulers(); };
      const saveEditsHtml = document.getElementById("tool-save-html");
      if (saveEditsHtml) saveEditsHtml.onclick = ev => { ev.preventDefault(); saveEditedHtml(); };
      const resetEditsBtn = document.getElementById("tool-reset-edits");
      if (resetEditsBtn) resetEditsBtn.onclick = ev => { ev.preventDefault(); resetSelected(); };
      const resetAllBtn = document.getElementById("tool-reset-all");
      if (resetAllBtn) resetAllBtn.onclick = ev => { ev.preventDefault(); resetEdits(); };
      const showRest = document.getElementById("tool-show-rest");
      const showEdit = document.getElementById("tool-show-edit");
      if (showRest) showRest.onclick = ev => { ev.preventDefault(); togglePose("rest"); };
      if (showEdit) showEdit.onclick = ev => { ev.preventDefault(); togglePose("edit"); };
      const enterEdit = document.getElementById("tool-enter-edit");
      const exitEdit = document.getElementById("tool-exit-edit");
      if (enterEdit) enterEdit.onclick = ev => { ev.preventDefault(); setEditMode(true); };
      if (exitEdit) exitEdit.onclick = ev => { ev.preventDefault(); setEditMode(false); };
      setEditMode(false);
      syncSaveBtn();
      window.addEventListener("keydown", ev => {
        if (ev.key !== "Delete" && ev.key !== "Backspace" && ev.key !== "Escape") return;
        const tag = (ev.target && ev.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA" || ev.target.isContentEditable) return;
        if (ev.key === "Escape") {
          if (state.draft) { state.draft = null; renderMpr(); ev.preventDefault(); }
          else if (state.selRuler) { state.selRuler = null; renderMpr(); ev.preventDefault(); }
          return;
        }
        if (deleteSelRuler()) ev.preventDefault();
      });
      if (marker) marker.onclick = () => pickTool("marker");
      if (comment) comment.onclick = () => pickTool("comment");
      bindCanvas("cv-long", "long");
      bindCanvas("cv-ax", "ax");
      // Панорама ОПТГ убрана из UI (её место заняли кнопки переключения
      // имплантов, см. fillImplantSwitch) — cv-opg больше нет в разметке,
      // весь связанный код рендера (renderOpg и т.д.) остаётся в файле
      // мёртвым, но безопасным (renderOpg сам проверяет canvas на null).
      const opg = document.getElementById("cv-opg");
      if (opg) {
        let opgWheelRaf = 0, opgWheelEnd = 0;
        opg.addEventListener("wheel", ev => {
          ev.preventDefault();
          const step = ev.deltaY > 0 ? -0.08 : 0.08;
          state.zoomOpg = Math.max(1, Math.min(2.5, (state.zoomOpg || 1) + step));
          syncSlider("sl-zoom-opg", state.zoomOpg);
          state._live = true;
          if (!opgWheelRaf) opgWheelRaf = requestAnimationFrame(() => {
            opgWheelRaf = 0;
            renderOpg();
          });
          clearTimeout(opgWheelEnd);
          opgWheelEnd = setTimeout(() => {
            state._live = false;
            renderOpg();
          }, 90);
        }, { passive: false });
        opg.style.touchAction = "none";
        opg.addEventListener("pointerdown", ev => {
          if (ev.pointerType !== "touch" && ev.button !== 0) return;
          state._opgSwipe = { x: ev.clientX, y: ev.clientY, moved: false };
          if (ev.pointerType === "touch") ev.preventDefault();
        });
        opg.addEventListener("pointermove", ev => {
          const sw = state._opgSwipe;
          if (!sw) return;
          const dy = ev.clientY - sw.y, dx = ev.clientX - sw.x;
          if (Math.hypot(dx, dy) > 4) sw.moved = true;
          if (Math.abs(dy) >= 1) {
            state.zoomOpg = Math.max(1, Math.min(2.5, (state.zoomOpg || 1) * Math.exp(-dy * 0.007)));
            syncSlider("sl-zoom-opg", state.zoomOpg);
            renderOpg();
          }
          sw.x = ev.clientX;
          sw.y = ev.clientY;
          ev.preventDefault();
        });
        const opgUp = () => {
          if (state._opgSwipe && state._opgSwipe.moved) state._skipOpgClick = true;
          state._opgSwipe = null;
        };
        opg.addEventListener("pointerup", opgUp);
        opg.addEventListener("pointercancel", opgUp);
        opg.addEventListener("click", ev => {
          if (state._skipOpgClick) { state._skipOpgClick = false; return; }
          if (!state._opg) return;
          const r = opg.getBoundingClientRect();
          const hit = hitOpgSite(ev.clientX - r.left, ev.clientY - r.top);
          if (hit) openSite(hit);
        });
      }
      window.addEventListener("resize", () => { applyViewModes(); placeSideToggle(); placeTools(); schedulePaint(8); });
      const first = sitesOf("implant")[0] || sitesOf("pin")[0];
      if (first) openSite(first);
      else paintWhenReady(20);
    } catch (e) {
      boot.style.display = "flex";
      boot.textContent = "Ошибка: " + (e && e.message ? e.message : e);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
