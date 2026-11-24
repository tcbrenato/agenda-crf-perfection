import { useEffect, useRef, useState } from 'react'
import FeuilleBas from './FeuilleBas'
import PastilleStatut from './PastilleStatut'
import { IconeCoche, IconeFermer, IconeImporter } from './Icones'
import { TAILLE_MAX_PJ } from '../lib/api'
import { ORDRE_STATUTS } from '../lib/statuts'

/**
 * Choix du statut en un geste.
 * - « Bloquée » : motif obligatoire (transmis au DG)
 * - « Terminée » : compte rendu et fichier(s) corrigé(s), facultatifs
 */
export default function MenuStatut({ tache, etape = null, onChoisir, onFermer }) {
  const [etapeMotif, setEtapeMotif] = useState(false)
  const [etapeFin, setEtapeFin] = useState(false)
  const [motif, setMotif] = useState('')
  const [compteRendu, setCompteRendu] = useState('')
  const [fichiers, setFichiers] = useState([])
  const [erreurFichier, setErreurFichier] = useState('')
  const champ = useRef(null)

  useEffect(() => {
    setEtapeMotif(Boolean(tache) && etape === 'bloque')
    setEtapeFin(Boolean(tache) && etape === 'termine')
    setMotif('')
    setCompteRendu('')
    setFichiers([])
    setErreurFichier('')
  }, [tache?.id, etape])

  const choisir = (s) => {
    if (s === 'bloque' && tache.statut !== 'bloque') return setEtapeMotif(true)
    if (s === 'termine' && tache.statut !== 'termine') return setEtapeFin(true)
    onChoisir(tache, s)
  }

  const ajouterFichiers = (e) => {
    const choisis = [...(e.target.files || [])]
    e.target.value = ''
    const tropLourds = choisis.filter((f) => f.size > TAILLE_MAX_PJ)
    setErreurFichier(tropLourds.length ? `Trop lourd (10 Mo max) : ${tropLourds.map((f) => f.name).join(', ')}` : '')
    setFichiers((l) => [...l, ...choisis.filter((f) => f.size <= TAILLE_MAX_PJ)])
  }

  const titre = !tache ? '' : etapeMotif ? 'Pourquoi est-elle bloquée ?' : etapeFin ? `Terminer la tâche N° ${tache.numero}` : `N° ${tache.numero} — statut`

  return (
    <FeuilleBas ouvert={Boolean(tache)} titre={titre} onFermer={onFermer}>
      {tache && etapeFin && (
        <form
          className="pile"
          onSubmit={(e) => {
            e.preventDefault()
            onChoisir(tache, 'termine', { compteRendu, fichiers })
          }}
        >
          <p className="texte-doux texte-petit">{tache.intitule}</p>
          <div className="champ">
            <label htmlFor="compte-rendu">Compte rendu <span className="texte-doux">(facultatif)</span></label>
            <textarea
              id="compte-rendu"
              className="saisie"
              value={compteRendu}
              onChange={(e) => setCompteRendu(e.target.value)}
              placeholder="Ex. : rapport corrigé selon les remarques du DG, version finale jointe"
              maxLength={1000}
            />
          </div>
          <div className="champ">
            <span className="etiquette">Fichier corrigé / livrable <span className="texte-doux">(facultatif)</span></span>
            <input ref={champ} type="file" multiple hidden onChange={ajouterFichiers} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*" />
            {fichiers.map((f, i) => (
              <div key={i} className="ligne fichier-choisi">
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📎 {f.name}</span>
                <button type="button" className="btn-icone" onClick={() => setFichiers(fichiers.filter((_, j) => j !== i))} aria-label={`Retirer ${f.name}`}><IconeFermer /></button>
              </div>
            ))}
            <button type="button" className="btn btn--secondaire btn--bloc" onClick={() => champ.current.click()}>
              <IconeImporter /> {fichiers.length ? 'Ajouter un autre fichier' : 'Joindre le fichier (10 Mo max)'}
            </button>
            {erreurFichier && <span className="aide" style={{ color: 'var(--rouge)' }}>{erreurFichier}</span>}
            <span className="aide">Le fichier rejoint les pièces jointes de la tâche ; le DG est prévenu avec votre compte rendu.</span>
          </div>
          <button type="submit" className="btn btn--primaire btn--bloc"><IconeCoche /> Marquer « Terminée »</button>
          {!etape && <button type="button" className="btn btn--fantome btn--bloc" onClick={() => setEtapeFin(false)}>Retour</button>}
        </form>
      )}
      {tache && !etapeMotif && !etapeFin && (
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
