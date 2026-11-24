import { useCallback, useEffect, useState } from 'react'
import FeuilleBas from './FeuilleBas'
import ChampEcheance from './ChampEcheance'
import { IconeCalendrier } from './Icones'
import { useAuth } from '../context/AuthContext'
import { useDonnees } from '../context/DonneesContext'
import { useToast } from '../context/ToastContext'
import { chargerReports, chargerTache, demanderReport, messageErreur, traiterReport } from '../lib/api'
import { formaterDate, formaterHorodatage } from '../lib/dates'
import { estAttribuee, estGestionnaire, peutModifier } from '../lib/droits'
import { estTerminee } from '../lib/statuts'

/**
 * Demandes de report d'échéance sur une tâche.
 * - Attributaire (qui ne peut pas modifier l'échéance) : bouton « Demander un report »
 * - DG / admin : accepter ou refuser les demandes en attente
 */
export default function ReportsTache({ tache }) {
  const { profil } = useAuth()
  const { profilsParId, remplacerTache } = useDonnees()
  const toast = useToast()
  const [reports, setReports] = useState([])
  const [ouvert, setOuvert] = useState(false)
  const [f, setF] = useState({ date: '', motif: '' })
  const [envoi, setEnvoi] = useState(false)
  const [reponses, setReponses] = useState({})

  const charger = useCallback(() => {
    chargerReports(tache.id).then(setReports).catch(() => setReports([]))
  }, [tache.id])
  useEffect(charger, [charger, tache.echeance])

  const gestionnaire = estGestionnaire(profil)
  const enAttente = reports.filter((r) => r.statut === 'en_attente')
  const maDemande = enAttente.find((r) => r.demandeur_id === profil.id)
  const peutDemander = !gestionnaire && !peutModifier(profil, tache) && estAttribuee(profil, tache) && !estTerminee(tache) && !maDemande
  const historique = reports.filter((r) => r.statut !== 'en_attente').slice(0, 3)

  const envoyer = async (e) => {
    e.preventDefault()
    if (!f.date) return toast.erreur('Choisissez la nouvelle date.')
    if (tache.echeance && f.date <= tache.echeance) return toast.erreur("La nouvelle date doit être après l'échéance actuelle.")
    if (!f.motif.trim()) return toast.erreur('Indiquez le motif.')
    setEnvoi(true)
    try {
      await demanderReport(tache.id, f.date, f.motif.trim())
      toast.info('Demande envoyée au DG')
      setOuvert(false)
      setF({ date: '', motif: '' })
      charger()
    } catch (err) {
      toast.erreur(messageErreur(err))
    } finally {
      setEnvoi(false)
    }
  }

  const traiter = async (r, accepter) => {
    try {
      await traiterReport(r.id, accepter, reponses[r.id])
      toast.info(accepter ? `Report accepté : nouvelle échéance le ${formaterDate(r.nouvelle_echeance)}` : 'Demande refusée')
      const t = await chargerTache(tache.id)
      if (t) remplacerTache(t)
      charger()
    } catch (err) {
      toast.erreur(messageErreur(err))
    }
  }

  if (!peutDemander && !enAttente.length && !historique.length) return null

  return (
    <section style={{ marginTop: 16 }}>
      {enAttente.map((r) => (
        <div key={r.id} className="carte carte--padding pile" style={{ borderLeft: '4px solid #e08a1e', gap: 8 }}>
          <div>
            <strong>Demande de report</strong> · {profilsParId[r.demandeur_id]?.nom_complet || 'Membre'}
            <div className="texte-petit texte-doux">{formaterHorodatage(r.cree_le)}</div>
          </div>
          <div>
            Échéance : {formaterDate(r.ancienne_echeance)} → <strong>{formaterDate(r.nouvelle_echeance)}</strong>
          </div>
          <div className="texte-petit">Motif : {r.motif}</div>
          {gestionnaire ? (
            <>
              <input
                className="saisie"
                placeholder="Réponse (facultatif)"
                value={reponses[r.id] || ''}
                onChange={(e) => setReponses({ ...reponses, [r.id]: e.target.value })}
                aria-label="Réponse au demandeur"
              />
              <div className="ligne" style={{ gap: 10 }}>
                <button type="button" className="btn btn--primaire" style={{ flex: 1 }} onClick={() => traiter(r, true)}>Accepter</button>
                <button type="button" className="btn btn--alerte" style={{ flex: 1 }} onClick={() => traiter(r, false)}>Refuser</button>
              </div>
            </>
          ) : (
            <div className="texte-petit texte-doux">En attente de la réponse du DG.</div>
          )}
        </div>
      ))}

      {historique.map((r) => (
        <p key={r.id} className="texte-petit texte-doux" style={{ marginTop: 8 }}>
          Report au {formaterDate(r.nouvelle_echeance)} demandé par {profilsParId[r.demandeur_id]?.nom_complet || 'un membre'} :{' '}
          <strong style={{ color: r.statut === 'acceptee' ? 'var(--st-termine-texte)' : 'var(--rouge)' }}>
            {r.statut === 'acceptee' ? 'accepté' : 'refusé'}
          </strong>
          {r.traite_par && <> par {profilsParId[r.traite_par]?.nom_complet}</>}
          {r.reponse && <> (« {r.reponse} »)</>}
        </p>
      ))}

      {peutDemander && (
        <button type="button" className="btn btn--secondaire btn--bloc" onClick={() => setOuvert(true)}>
          <IconeCalendrier /> Demander un report d'échéance
        </button>
      )}

      <FeuilleBas ouvert={ouvert} titre="Demander un report" onFermer={() => setOuvert(false)}>
        <form className="pile" onSubmit={envoyer}>
          <p className="texte-doux texte-petit">Échéance actuelle : <strong>{formaterDate(tache.echeance)}</strong></p>
          <ChampEcheance id="report-date" valeur={f.date} onChange={(date) => setF({ ...f, date })} />
          <div className="champ">
            <label htmlFor="report-motif">Motif *</label>
            <textarea id="report-motif" className="saisie" value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} maxLength={500} placeholder="Ex. : le fournisseur livre le 5 décembre" />
          </div>
          <button type="submit" className="btn btn--primaire btn--bloc" disabled={envoi}>{envoi ? 'Envoi…' : 'Envoyer la demande au DG'}</button>
        </form>
      </FeuilleBas>
    </section>
  )
}
