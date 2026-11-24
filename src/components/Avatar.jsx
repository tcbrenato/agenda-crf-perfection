import { initiales } from '../lib/texte'

/**
 * Photo de profil, ou initiales si aucune photo.
 * Conformément au cahier des charges, la photo du DG n'est jamais affichée.
 */
export function photoVisible(profil) {
  return Boolean(profil?.photo_url && profil.role !== 'dg')
}

export default function Avatar({ profil, nom, taille, className = '', style }) {
  const libelle = profil?.nom_complet || nom || '?'
  const classes = ['avatar', taille === 'grand' ? 'avatar--grand' : '', taille === 'petit' ? 'avatar--petit' : '', className].filter(Boolean).join(' ')
  if (photoVisible(profil)) {
    return <img className={`${classes} avatar--photo`} src={profil.photo_url} alt={libelle} loading="lazy" style={style} />
  }
  return <span className={classes} style={style} aria-hidden="true">{initiales(libelle)}</span>
}
