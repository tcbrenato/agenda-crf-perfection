/**
 * Génère les images de l'application à partir des logos officiels du dossier logos/ :
 *   npm run icones
 *
 *   logos/logo-icone.png    carré bleu nuit (CRF blanc/rouge)  → icônes PWA, favicon
 *   logos/logo-symbole.png  symbole CRF sur fond blanc         → en-tête de l'application
 *   logos/logo-complet.png  CRF PERFECTION + sous-titre        → écran de connexion, PDF
 *
 * Produit dans public/ des versions légères (connexions faibles) :
 *   icons/icon-192.png, icons/icon-512.png, icons/icon-maskable-512.png,
 *   icons/apple-touch-icon.png, favicon.png, logo-entete.png, logo-connexion.png
 */
import sharp from 'sharp'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (n) => path.join(racine, 'logos', n)
const pub = (n) => path.join(racine, 'public', n)
const PNG = { compressionLevel: 9, palette: true, colours: 256, dither: 0, effort: 10 }

for (const f of ['logo-icone.png', 'logo-symbole.png', 'logo-complet.png']) {
  if (!existsSync(src(f))) {
    console.error(`❌ Fichier introuvable : logos/${f}`)
    process.exit(1)
  }
}
mkdirSync(pub('icons'), { recursive: true })

const ok = (n) => console.log('✔ public/' + n)

// 1) Icônes à partir du carré bleu nuit.
//    Icônes standard : on recadre au centre (85 %) pour agrandir le symbole.
//    Icône « maskable » (Android adaptatif) : image entière, le symbole reste dans la zone de sécurité.
const icone = sharp(src('logo-icone.png'))
const { width: cote } = await icone.metadata()
const marge = Math.round(cote * 0.075)
const recadree = await sharp(src('logo-icone.png'))
  .extract({ left: marge, top: marge, width: cote - 2 * marge, height: cote - 2 * marge })
  .toBuffer()
for (const [taille, nom, entier] of [
  [192, 'icons/icon-192.png'],
  [512, 'icons/icon-512.png'],
  [512, 'icons/icon-maskable-512.png', true],
  [180, 'icons/apple-touch-icon.png'],
  [64, 'favicon.png']
]) {
  await sharp(entier ? src('logo-icone.png') : recadree).resize(taille, taille, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(pub(nom))
  ok(nom)
}

// 2) En-tête : symbole CRF détouré (bords blancs retirés), 96 px de haut (affiché à 36 px, net sur écran HD)
await sharp(src('logo-symbole.png'))
  .trim({ threshold: 20 })
  .resize({ height: 96 })
  .png(PNG)
  .toFile(pub('logo-entete.png'))
ok('logo-entete.png')

// 3) Connexion / PDF : logo complet détouré, 720 px de large
await sharp(src('logo-complet.png'))
  .trim({ threshold: 20 })
  .resize({ width: 720 })
  .flatten({ background: '#ffffff' })
  .png(PNG)
  .toFile(pub('logo-connexion.png'))
ok('logo-connexion.png')
console.log('Images générées.')
