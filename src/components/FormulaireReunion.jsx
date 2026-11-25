import { useEffect, useState } from 'react'
import FeuilleBas from './FeuilleBas'
import SelecteurPersonnes from './SelecteurPersonnes'
import { useAuth } from '../context/AuthContext'
import { useDonnees } from '../context/DonneesContext'
import { useToast } from '../context/ToastContext'
import { annulerEvenement, enregistrerEvenement, messageErreur } from '../lib/api'
import { aujourdhui, ajouterJours, jourSemaine } from '../lib/dates'
import { JOURS, JOURS_COURTS, TYPES_EVENEMENT, heureCourte, jourIsoDe, normaliserLien, versInstant } from '../lib/reunions'

const DUREES = [15, 30, 45, 60, 90, 120, 180]

function vide() {
  return { titre: '', type: 'reunion', date: aujourdhui(), heure: '19:00', duree_minutes: 60, lien: '', lieu: '', description: '', recurrence: 'aucune', jours_semaine: [], fin_recurrence: '', pour_tous: true, participants: [] }
}

/** Planifier / modifier une réunion, un projet ou un événement (DG et administrateur). */
export default function FormulaireReunion({ ouvert, evenement, onFermer, onEnregistre }) {
  const { profil } = useAuth()
  const { profilsAssignables } = useDonnees()
  const toast = useToast()
  const [f, setF] = useState(vide)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    if (!ouvert) return
    setErreur('')
    if (evenement) {
      setF({
        id: evenement.id,
        titre: evenement.titre,
        type: evenement.type,
        date: jourIsoDe(evenement.debut),
        heure: heureCourte(evenement.debut),
        duree_minutes: evenement.duree_minutes,
        lien: evenement.lien || '',
        lieu: evenement.lieu || '',
        description: evenement.description || '',
        recurrence: evenement.recurrence,
        jours_semaine: evenement.jours_semaine || [],
        fin_recurrence: evenement.fin_recurrence || '',
        pour_tous: evenement.pour_tous,
        participants: evenement.participants || []
      })
    } else setF(vide())
  }, [ouvert, evenement])

  /** Raccourci : réunion du staff, chaque mardi et vendredi à 19 h */
  const staff = () => {
    const j = jourSemaine(aujourdhui()) + 1 // 1 = lundi
    const prochain = [2, 5].map((x) => (x - j + 7) % 7).sort((a, b) => a - b)[0]
    setF({ ...f, titre: 'Réunion du staff', type: 'reunion', heure: '19:00', duree_minutes: f.duree_minutes || 60, recurrence: 'hebdomadaire', jours_semaine: [2, 5], date: ajouterJours(aujourdhui(), prochain), pour_tous: true })
  }

  const basculerJour = (j) =>
    setF({ ...f, jours_semaine: f.jours_semaine.includes(j) ? f.jours_semaine.filter((x) => x !== j) : [...f.jours_semaine, j].sort() })

  const enregistrer = async (e) => {
    e.preventDefault()
    if (!f.titre.trim()) return setErreur('Indiquez le titre.')
    if (!f.date || !f.heure) return setErreur("Indiquez la date et l'heure.")
    if (f.recurrence === 'hebdomadaire' && !f.jours_semaine.length) return setErreur('Choisissez au moins un jour de la semaine.')
    if (!f.pour_tous && !f.participants.length) return setErreur('Choisissez au moins un participant.')
    setErreur('')
    setEnvoi(true)
    try {
      // pour une répétition, la date de départ est la 1re occurrence à partir de la date choisie
      let date = f.date
      if (f.recurrence === 'hebdomadaire') {
        for (let i = 0; i < 7; i++) {
          const d = ajouterJours(f.date, i)
          if (f.jours_semaine.includes(jourSemaine(d) + 1)) { date = d; break }
        }
      }
      const ev = await enregistrerEvenement(
        {
          ...(f.id ? { id: f.id } : {}),
          titre: f.titre.trim(),
          type: f.type,
          debut: versInstant(date, f.heure),
          duree_minutes: Number(f.duree_minutes),
          lien: normaliserLien(f.lien),
          lieu: f.lieu.trim() || null,
          description: f.description.trim() || null,
          recurrence: f.recurrence,
          jours_semaine: f.recurrence === 'hebdomadaire' ? f.jours_semaine : [],
          fin_recurrence: f.recurrence === 'hebdomadaire' && f.fin_recurrence ? f.fin_recurrence : null,
          pour_tous: f.pour_tous
        },
        f.pour_tous ? [] : f.participants,
        evenement?.participants || []
      )
      toast.info(f.id ? 'Modification enregistrée — les participants sont prévenus' : 'Planifié — les participants sont prévenus par notification et email')
      onEnregistre?.(ev)
      onFermer()
    } catch (err) {
      setErreur(messageErreur(err))
    } finally {
      setEnvoi(false)
    }
  }

  const annuler = async () => {
    if (!window.confirm(`Annuler « ${f.titre} »${f.recurrence === 'hebdomadaire' ? ' (toutes les dates)' : ''} ? Les participants seront prévenus.`)) return
    try {
      await annulerEvenement(f.id)
      toast.info('Annulé — les participants sont prévenus')
      onEnregistre?.()
      onFermer()
    } catch (err) {
      toast.erreur(messageErreur(err))
    }
  }

  return (
    <FeuilleBas ouvert={ouvert} titre={f.id ? 'Modifier' : 'Planifier'} onFermer={onFermer}>
      <form className="pile" onSubmit={enregistrer} noValidate>
        {!f.id && (
          <button type="button" className="btn btn--secondaire btn--bloc" onClick={staff} style={{ whiteSpace: 'normal', lineHeight: 1.25 }}>
            ⚡ Réunion du staff (mardi et vendredi, 19 h)
          </button>
        )}

        <div className="segment" role="group" aria-label="Type" style={{ display: 'grid' }}>
          {Object.entries(TYPES_EVENEMENT).map(([cle, t]) => (
            <button key={cle} type="button" aria-pressed={f.type === cle} onClick={() => setF({ ...f, type: cle })}>{t.libelle}</button>
          ))}
        </div>

        <div className="champ">
          <label htmlFor="ev-titre">Titre *</label>
          <input id="ev-titre" className="saisie" value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} placeholder="Ex. : Réunion du staff" maxLength={150} />
        </div>

        <div className="ligne" style={{ gap: 10, alignItems: 'flex-start' }}>
          <div className="champ" style={{ flex: 1.3, minWidth: 0 }}>
            <label htmlFor="ev-date">{f.recurrence === 'hebdomadaire' ? 'À partir du *' : 'Date *'}</label>
            <input id="ev-date" className="saisie" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} lang="fr" />
          </div>
          <div className="champ" style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor="ev-heure">Heure *</label>
            <input id="ev-heure" className="saisie" type="time" value={f.heure} onChange={(e) => setF({ ...f, heure: e.target.value })} step="300" />
          </div>
        </div>

        <div className="champ">
          <label htmlFor="ev-duree">Durée</label>
          <select id="ev-duree" className="saisie" value={f.duree_minutes} onChange={(e) => setF({ ...f, duree_minutes: e.target.value })}>
            {DUREES.map((d) => <option key={d} value={d}>{d < 60 ? `${d} min` : `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60}` : ''}`}</option>)}
          </select>
        </div>

        <div className="champ">
          <label htmlFor="ev-recurrence">Répéter</label>
          <select id="ev-recurrence" className="saisie" value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value })}>
            <option value="aucune">Une seule fois</option>
            <option value="hebdomadaire">Chaque semaine</option>
          </select>
        </div>
        {f.recurrence === 'hebdomadaire' && (
          <>
            <div className="selecteur-jours" role="group" aria-label="Jours de la semaine">
              {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                <button key={j} type="button" aria-pressed={f.jours_semaine.includes(j)} onClick={() => basculerJour(j)} title={JOURS[j]} aria-label={JOURS[j]}>
                  {JOURS_COURTS[j]}
                </button>
              ))}
            </div>
            <div className="champ">
              <label htmlFor="ev-fin">Jusqu'au <span className="texte-doux">(facultatif)</span></label>
              <input id="ev-fin" className="saisie" type="date" value={f.fin_recurrence} onChange={(e) => setF({ ...f, fin_recurrence: e.target.value })} lang="fr" />
            </div>
          </>
        )}

        <div className="champ">
          <label htmlFor="ev-lien">Lien de la réunion (Google Meet, Zoom…)</label>
          <input id="ev-lien" className="saisie" type="url" inputMode="url" value={f.lien} onChange={(e) => setF({ ...f, lien: e.target.value })} placeholder="https://meet.google.com/…" autoCapitalize="none" />
          <span className="aide">Un bouton « Rejoindre » apparaîtra pour tout le monde. Rappel par email 30 min avant.</span>
        </div>

        <div className="champ">
          <label htmlFor="ev-lieu">Lieu <span className="texte-doux">(facultatif)</span></label>
          <input id="ev-lieu" className="saisie" value={f.lieu} onChange={(e) => setF({ ...f, lieu: e.target.value })} placeholder="Ex. : Salle de réunion, Cotonou" />
        </div>

        <div className="champ">
          <label htmlFor="ev-desc">Ordre du jour <span className="texte-doux">(facultatif)</span></label>
          <textarea id="ev-desc" className="saisie" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} placeholder="Points à aborder…" />
        </div>

        <label className="interrupteur">
          <span style={{ fontWeight: 600 }}>Toute l'équipe</span>
          <input type="checkbox" checked={f.pour_tous} onChange={(e) => setF({ ...f, pour_tous: e.target.checked })} />
        </label>
        {!f.pour_tous && (
          <SelecteurPersonnes profils={profilsAssignables} selection={f.participants} onChange={(participants) => setF({ ...f, participants })} moiId={profil.id} />
        )}

        {erreur && <p className="message-erreur" role="alert">{erreur}</p>}
        <button type="submit" className="btn btn--primaire btn--bloc" disabled={envoi}>
          {envoi ? 'Enregistrement…' : f.id ? 'Enregistrer et prévenir' : 'Planifier et prévenir l’équipe'}
        </button>
        {f.id && <button type="button" className="btn btn--alerte btn--bloc" onClick={annuler}>Annuler la réunion</button>}
      </form>
    </FeuilleBas>
  )
}
