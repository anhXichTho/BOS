/**
 * generate-icons.mjs
 * Creates public/icon-192.png and public/icon-512.png using only Node.js built-ins.
 * Colors: BOS primary blue #2452B1 background with a simple "B" initial.
 *
 * Run once: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

// CRC32 lookup table
const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  CRC_TABLE[n] = c
}

function crc32(buf) {
  let c = 0xFFFFFFFF
  for (const b of buf) c = (c >>> 8) ^ CRC_TABLE[(c ^ b) & 0xFF]
  return (c ^ 0xFFFFFFFF)
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])) >>> 0, 0)
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf])
}

/**
 * Create a solid-color PNG.
 * r,g,b are 0-255 integers.
 */
function solidPNG(size, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR: width, height, bitDepth=8, colorType=2 (RGB), compress=0, filter=0, interlace=0
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8  // 8-bit depth
  ihdr[9] = 2  // RGB

  // Build raw image data: one filter byte (0 = None) per row + RGB pixels
  const row = Buffer.alloc(1 + size * 3)
  row[0] = 0 // filter: None
  for (let x = 0; x < size; x++) {
    row[1 + x * 3]     = r
    row[1 + x * 3 + 1] = g
    row[1 + x * 3 + 2] = b
  }
  // Stack rows
  const rawParts = []
  for (let y = 0; y < size; y++) rawParts.push(Buffer.from(row))
  const idat = deflateSync(Buffer.concat(rawParts), { level: 9 })

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// BOS primary blue: #2452B1 (RGB 36, 82, 177)
const [R, G, B] = [0x24, 0x52, 0xB1]

writeFileSync('public/icon-192.png', solidPNG(192, R, G, B))
writeFileSync('public/icon-512.png', solidPNG(512, R, G, B))

console.log('✓ public/icon-192.png  (192×192, #2452B1)')
console.log('✓ public/icon-512.png  (512×512, #2452B1)')
console.log()
console.log('Tip: replace these with your actual logo PNG for production.')
