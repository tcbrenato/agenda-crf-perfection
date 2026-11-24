import { useDonnees } from '../context/DonneesContext'

const LIBELLES_RECURRENCE = { hebdomadaire: 'Chaque semaine', mensuelle: 'Chaque mois' }

/** Petits repères : projet (pastille de couleur), récurrence, avancement des étapes. */
export default function BadgesTache({ tache }) {
  const { projetsParId } = useDonnees()
  const projet = tache.projet_id && projetsParId[tache.projet_id]
  return (
    <>
      {projet && (
        <span className="badge-projet" title={`Projet : ${projet.nom}`}>
          <i style={{ background: projet.couleur }} />
          <span>{projet.nom}</span>
        </span>
      )}
      {tache.recurrence && tache.recurrence !== 'aucune' && (
        <span className="badge-info" title={LIBELLES_RECURRENCE[tache.recurrence]}>↻ {LIBELLES_RECURRENCE[tache.recurrence]}</span>
      )}
      {tache.etapesTotal > 0 && (
        <span className="badge-info" title="Étapes réalisées">☑ {tache.etapesFaites}/{tache.etapesTotal}</span>
      )}
    </>
  )
}

export { LIBELLES_RECURRENCE }
