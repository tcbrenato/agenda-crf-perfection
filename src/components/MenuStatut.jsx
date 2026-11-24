import { useEffect, useState } from 'react'
import FeuilleBas from './FeuilleBas'
import PastilleStatut from './PastilleStatut'
import { IconeCoche } from './Icones'
import { ORDRE_STATUTS } from '../lib/statuts'

/** Choix du statut en un geste. « Bloquée » demande un motif (transmis au DG). */
export default function MenuStatut({ tache, onChoisir, onFermer }) {
  const [etapeMotif, setEtapeMotif] = useState(false)
  const [motif, setMotif] = useState('')

  useEffect(() => {
    setEtapeMotif(false)
    setMotif('')
  }, [tache?.id])

  const choisir = (s) => {
    if (s === 'bloque' && tache.statut !== 'bloque') {
      setEtapeMotif(true)
      return
    }
    onChoisir(tache, s)
  }

  return (
    <FeuilleBas ouvert={Boolean(tache)} titre={tache ? (etapeMotif ? 'Pourquoi est-elle bloquée ?' : `N° ${tache.numero} — statut`) : ''} onFermer={onFermer}>
      {tache && !etapeMotif && (
        <>
          <p className="texte-doux texte-petit" style={{ marginBottom: 12 }}>{tache.intitule}</p>
          <div className="choix-statut">
            {ORDRE_STATUTS.map((s) => (
              <button key={s} type="button" aria-current={tache.statut === s} onClick={() => choisir(s)}>
                <PastilleStatut statut={s} />
                {tache.statut === s && <IconeCoche className="coche" />}
              </button>
            ))}
          </div>
        </>
      )}
      {tache && etapeMotif && (
        <form
          className="pile"
          onSubmit={(e) => {
            e.preventDefault()
            if (motif.trim()) onChoisir(tache, 'bloque', { motif })
          }}
        >
          <p className="texte-doux texte-petit">N° {tache.numero} — {tache.intitule}</p>
          <div className="champ">
            <label htmlFor="motif-blocage">Motif du blocage *</label>
            <textarea
              id="motif-blocage"
              className="saisie"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              placeholder="Ex. : en attente de la signature du contrat par le fournisseur"
              maxLength={500}
              autoFocus
            />
            <span className="aide">Le motif est ajouté en commentaire et le DG est prévenu.</span>
          </div>
          <button type="submit" className="btn btn--primaire btn--bloc" disabled={!motif.trim()}>Marquer « Bloquée »</button>
          <button type="button" className="btn btn--fantome btn--bloc" onClick={() => setEtapeMotif(false)}>Retour</button>
        </form>
      )}
    </FeuilleBas>
  )
}
