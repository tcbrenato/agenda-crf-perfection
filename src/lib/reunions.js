import { FUSEAU } from './dates'

export const TYPES_EVENEMENT = {
  reunion: { libelle: 'Réunion', couleur: '#6B3FA0' },
  projet: { libelle: 'Projet', couleur: '#1D4B94' },
  evenement: { libelle: 'Événement', couleur: '#0E7C86' }
}
export const JOURS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
export const JOURS_COURTS = ['', 'L', 'M', 'M', 'J', 'V', 'S', 'D']

const fmtHeure = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit' })
const fmtJour = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, weekday: 'long', day: 'numeric', month: 'long' })
const fmtIso = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' })

export const heureDe = (ts) => fmtHeure.format(new Date(ts)).replace(':', ' h ')
export const heureCourte = (ts) => fmtHeure.format(new Date(ts))
export const jourDe = (ts) => fmtJour.format(new Date(ts))
export const jourIsoDe = (ts) => fmtIso.format(new Date(ts))

/** « 2026-11-25 » + « 19:00 » (heure de Porto-Novo, UTC+1 toute l'année) → ISO */
export function versInstant(date, heure) {
  return `${date}T${heure}:00+01:00`
}

/** Libellé de la répétition : « Chaque mardi et vendredi » */
export function libelleRecurrence(e) {
  if (e.recurrence !== 'hebdomadaire' || !e.jours_semaine?.length) return ''
  const noms = [...e.jours_semaine].sort().map((j) => JOURS[j].toLowerCase())
  const liste = noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}` : noms[0]
  return `Chaque ${liste}`
}

/** Nom de la plateforme d'après le lien */
export function plateforme(lien) {
  if (!lien) return ''
  if (/meet\.google/i.test(lien)) return 'Google Meet'
  if (/zoom\.us|zoom\.com/i.test(lien)) return 'Zoom'
  if (/teams\.microsoft|teams\.live/i.test(lien)) return 'Teams'
  if (/whereby|jitsi/i.test(lien)) return 'la visio'
  return 'la réunion'
}

/** La réunion est-elle « en cours » ou commence-t-elle dans les 15 minutes ? */
export function bientot(o, maintenant = Date.now()) {
  const d = new Date(o.occurrence).getTime()
  const f = new Date(o.occurrence_fin).getTime()
  return maintenant >= d - 15 * 60_000 && maintenant <= f
}

export function normaliserLien(l) {
  const t = String(l || '').trim()
  if (!t) return null
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}
