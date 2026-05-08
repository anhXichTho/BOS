/**
 * generate-vapid-keys.mjs
 * Generates a VAPID EC P-256 key pair for Web Push notifications.
 * Uses only Node.js built-in Web Crypto (Node 18+).
 *
 * Run once: node scripts/generate-vapid-keys.mjs
 *
 * Copy the output keys to:
 *   Supabase Dashboard → Project Settings → Edge Functions → Secrets
 * And add VITE_VAPID_PUBLIC_KEY to your .env file (and Vercel env vars).
 */

const { subtle } = globalThis.crypto

// VAPID signing uses ECDSA P-256
const keyPair = await subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
)

const publicRaw  = await subtle.exportKey('raw', keyPair.publicKey)
const privateJwk = await subtle.exportKey('jwk', keyPair.privateKey)

// Base64url encode (URL-safe, no padding)
const toB64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

// Public key: raw 65-byte uncompressed EC point → base64url
// Private key: JWK 'd' field is already the raw 32-byte scalar in base64url
const publicKey  = toB64url(publicRaw)
const privateKey = privateJwk.d  // raw 32-byte scalar, already base64url

console.log('─── VAPID Keys ───────────────────────────────────────────────────────────')
console.log()
console.log('Add these 3 secrets to Supabase Dashboard → Project Settings → Edge Functions → Secrets:')
console.log()
console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}`)
console.log(`VAPID_SUBJECT=mailto:phamvietdung812020@gmail.com`)
console.log()
console.log('Add this to your .env file (and Vercel environment variables):')
console.log()
console.log(`VITE_VAPID_PUBLIC_KEY=${publicKey}`)
console.log()
console.log('──────────────────────────────────────────────────────────────────────────')
