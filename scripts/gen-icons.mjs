/**
 * Rasteriza a marca do PITWALL nos PNGs que o electron-builder consome.
 *
 *   node scripts/gen-icons.mjs
 *
 * Não usa rasterizador de SVG: a geometria é um squircle + 5 círculos + uma
 * barra, então rasterizamos na mão (supersampling 4x4) e escrevemos o PNG com
 * zlib da stdlib. Isso evita sharp/imagemagick, o cache de browsers do
 * Playwright e o offscreen do Electron — que trava em headless. Em troca, esta
 * geometria precisa ser mantida em sincronia com build/icon.svg.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// build/icons/<n>x<n>.png é o que o electron-builder lê no linux; build/icon.png
// é o que mac/win pegam pela convenção de buildResources.
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

// Espelho de build/icon.svg (viewBox 0 0 512 512).
const VIEWBOX = 512
const ACCENT = [0xff, 0x7a, 0x45]
const SQUIRCLE = { x: 0, y: 0, w: 512, h: 512, r: 114 }
const DOTS = [112, 184, 256, 328, 400].map((cx) => ({ cx, cy: 196, r: 27 }))
const BAR = { x: 94, y: 290, w: 324, h: 62, r: 16 }

const SUBSAMPLES = 4

function inRoundedRect(x, y, { x: rx, y: ry, w, h, r }) {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false
  const dx = Math.max(rx + r - x, 0, x - (rx + w - r))
  const dy = Math.max(ry + r - y, 0, y - (ry + h - r))
  return dx * dx + dy * dy <= r * r
}

function inCircle(x, y, { cx, cy, r }) {
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function isWhite(x, y) {
  return inRoundedRect(x, y, BAR) || DOTS.some((d) => inCircle(x, y, d))
}

/** RGBA não-premultiplicado, top-down, sem filtro. */
function rasterize(size) {
  const px = new Uint8Array(size * size * 4)
  const scale = VIEWBOX / size
  const n = SUBSAMPLES * SUBSAMPLES

  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      // Acumula em espaço premultiplicado para o antialias da borda ficar correto.
      let sr = 0
      let sg = 0
      let sb = 0
      let sa = 0

      for (let sy = 0; sy < SUBSAMPLES; sy++) {
        for (let sx = 0; sx < SUBSAMPLES; sx++) {
          const x = (pxi + (sx + 0.5) / SUBSAMPLES) * scale
          const y = (py + (sy + 0.5) / SUBSAMPLES) * scale
          if (!inRoundedRect(x, y, SQUIRCLE)) continue
          const [r, g, b] = isWhite(x, y) ? [255, 255, 255] : ACCENT
          sr += r
          sg += g
          sb += b
          sa += 255
        }
      }

      const o = (py * size + pxi) * 4
      if (sa === 0) continue
      const covered = sa / 255 // nº de subamostras dentro do squircle
      px[o] = Math.round(sr / covered)
      px[o + 1] = Math.round(sg / covered)
      px[o + 2] = Math.round(sb / covered)
      px[o + 3] = Math.round(sa / n)
    }
  }
  return px
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (~c) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  // 10..12: compression/filter/interlace = 0

  // Uma linha = 1 byte de filtro (0 = None) + size*4 bytes de pixel.
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    )
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(join(root, 'build/icons'), { recursive: true })

for (const size of SIZES) {
  const png = encodePNG(rasterize(size), size)
  writeFileSync(join(root, `build/icons/${size}x${size}.png`), png)
  if (size === 512) writeFileSync(join(root, 'build/icon.png'), png)
  console.log(`build/icons/${size}x${size}.png  ${png.length} bytes`)
}
