/**
 * Reads a PNG picture into plain pixels, with no library and nothing from a browser, so that the
 * PDF export can include it wherever the model runs. A PNG is a list of chunks; the pixels are
 * in the IDAT ones, compressed with "deflate" and filtered line by line.
 */

interface Huffman {
  count: Uint16Array
  symbol: Uint16Array
}

/** The table that turns code lengths into symbols, in the canonical order deflate uses. */
function huffman(lengths: ArrayLike<number>): Huffman {
  const count = new Uint16Array(16)
  for (let i = 0; i < lengths.length; i++) count[lengths[i]]++
  count[0] = 0
  const offsets = new Uint16Array(16)
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + count[i - 1]
  const symbol = new Uint16Array(lengths.length)
  for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbol[offsets[lengths[i]]++] = i
  return { count, symbol }
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
/** The order in which a block lists the lengths of its code-length codes. */
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

/** Undoes "deflate" compression wrapped in a zlib header, as PNG stores it. `size` is how many bytes come out. */
export function inflate(data: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size)
  let at = 0
  // Past the two bytes of the zlib header.
  let pos = 2
  let held = 0
  let bitsHeld = 0
  const bits = (need: number): number => {
    while (bitsHeld < need) {
      if (pos >= data.length) throw new Error('The picture is cut short.')
      held |= data[pos++] << bitsHeld
      bitsHeld += 8
    }
    const value = held & ((1 << need) - 1)
    held >>>= need
    bitsHeld -= need
    return value
  }
  const decode = (table: Huffman): number => {
    let code = 0
    let first = 0
    let index = 0
    for (let length = 1; length < 16; length++) {
      code |= bits(1)
      const count = table.count[length]
      if (code - count < first) return table.symbol[index + (code - first)]
      index += count
      first = (first + count) << 1
      code <<= 1
    }
    throw new Error('The picture is damaged.')
  }

  const fixedLengths = new Uint8Array(288)
  fixedLengths.fill(8, 0, 144)
  fixedLengths.fill(9, 144, 256)
  fixedLengths.fill(7, 256, 280)
  fixedLengths.fill(8, 280, 288)
  const fixed = { lengths: huffman(fixedLengths), distances: huffman(new Uint8Array(30).fill(5)) }

  for (let last = false; !last; ) {
    last = bits(1) === 1
    const type = bits(2)
    if (type === 0) {
      // Stored as it is: skip to the next whole byte, then a length and the bytes.
      held = 0
      bitsHeld = 0
      const length = data[pos] | (data[pos + 1] << 8)
      pos += 4
      out.set(data.subarray(pos, pos + length), at)
      at += length
      pos += length
      continue
    }
    if (type === 3) throw new Error('The picture is damaged.')
    let tables = fixed
    if (type === 2) {
      const literals = bits(5) + 257
      const distances = bits(5) + 1
      const codes = bits(4) + 4
      const codeLengths = new Uint8Array(19)
      for (let i = 0; i < codes; i++) codeLengths[ORDER[i]] = bits(3)
      const lengthTable = huffman(codeLengths)
      const lengths = new Uint8Array(literals + distances)
      for (let i = 0; i < lengths.length; ) {
        const symbol = decode(lengthTable)
        if (symbol < 16) lengths[i++] = symbol
        else {
          const [value, repeat] = symbol === 16 ? [lengths[i - 1], 3 + bits(2)] : symbol === 17 ? [0, 3 + bits(3)] : [0, 11 + bits(7)]
          for (let k = 0; k < repeat; k++) lengths[i++] = value
        }
      }
      tables = { lengths: huffman(lengths.subarray(0, literals)), distances: huffman(lengths.subarray(literals)) }
    }
    for (;;) {
      const symbol = decode(tables.lengths)
      if (symbol === 256) break
      if (symbol < 256) {
        out[at++] = symbol
        continue
      }
      const length = LENGTH_BASE[symbol - 257] + bits(LENGTH_EXTRA[symbol - 257])
      const code = decode(tables.distances)
      const back = DIST_BASE[code] + bits(DIST_EXTRA[code])
      // Copied byte by byte: the stretch copied may overlap what is being written.
      for (let k = 0; k < length; k++, at++) out[at] = out[at - back]
    }
  }
  return out
}

export interface Pixels {
  width: number
  height: number
  /** Three bytes a pixel: red, green, blue. What was see-through is laid on white. */
  rgb: Uint8Array
}

/** The pixels of a PNG, or null when it is not one or is of a kind not read here (interlaced). */
export function decodePng(file: Uint8Array): Pixels | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (signature.some((byte, i) => file[i] !== byte)) return null
  const u32 = (i: number) => ((file[i] << 24) | (file[i + 1] << 16) | (file[i + 2] << 8) | file[i + 3]) >>> 0
  let width = 0
  let height = 0
  let depth = 8
  let colour = 6
  let palette: Uint8Array | null = null
  let opacity: Uint8Array | null = null
  const data: Uint8Array[] = []
  for (let i = 8; i + 8 <= file.length; ) {
    const length = u32(i)
    const type = String.fromCharCode(file[i + 4], file[i + 5], file[i + 6], file[i + 7])
    const body = file.subarray(i + 8, i + 8 + length)
    if (type === 'IHDR') {
      width = u32(i + 8)
      height = u32(i + 12)
      depth = body[8]
      colour = body[9]
      if (body[12] !== 0) return null
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') opacity = body
    else if (type === 'IDAT') data.push(body)
    else if (type === 'IEND') break
    i += 12 + length
  }
  if (!width || !height || data.length === 0) return null
  const channels = [1, 0, 3, 1, 2, 0, 4][colour]
  if (!channels || (colour === 3 && !palette)) return null

  const packed = new Uint8Array(data.reduce((sum, part) => sum + part.length, 0))
  data.reduce((at, part) => (packed.set(part, at), at + part.length), 0)
  // Each line is its bytes behind one byte saying how it was filtered.
  const stride = Math.ceil((width * channels * depth) / 8)
  const raw = inflate(packed, (stride + 1) * height)
  const step = Math.max(1, (channels * depth) >> 3)
  const lines = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const from = y * (stride + 1) + 1
    const to = y * stride
    for (let x = 0; x < stride; x++) {
      const left = x >= step ? lines[to + x - step] : 0
      const up = y > 0 ? lines[to + x - stride] : 0
      const corner = x >= step && y > 0 ? lines[to + x - stride - step] : 0
      let guess = 0
      if (filter === 1) guess = left
      else if (filter === 2) guess = up
      else if (filter === 3) guess = (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - corner
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)]
        guess = a <= b && a <= c ? left : b <= c ? up : corner
      }
      lines[to + x] = (raw[from + x] + guess) & 0xff
    }
  }

  const rgb = new Uint8Array(width * height * 3)
  const bytes = depth === 16 ? 2 : 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // One sample of this pixel as 0 to 255: the high byte of a 16-bit one, a packed one spread out.
      const sample = (channel: number) => {
        if (depth >= 8) return lines[y * stride + (x * channels + channel) * bytes]
        const bit = x * depth
        const value = (lines[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
        return colour === 3 ? value : Math.round((value * 255) / ((1 << depth) - 1))
      }
      let r: number
      let g: number
      let b: number
      let a = 255
      if (colour === 3) {
        const index = sample(0)
        ;[r, g, b] = [palette![index * 3] ?? 0, palette![index * 3 + 1] ?? 0, palette![index * 3 + 2] ?? 0]
        a = opacity?.[index] ?? 255
      } else if (colour === 0 || colour === 4) {
        r = g = b = sample(0)
        if (colour === 4) a = sample(1)
      } else {
        ;[r, g, b] = [sample(0), sample(1), sample(2)]
        if (colour === 6) a = sample(3)
      }
      const o = (y * width + x) * 3
      rgb[o] = Math.round((r * a + 255 * (255 - a)) / 255)
      rgb[o + 1] = Math.round((g * a + 255 * (255 - a)) / 255)
      rgb[o + 2] = Math.round((b * a + 255 * (255 - a)) / 255)
    }
  }
  return { width, height, rgb }
}
