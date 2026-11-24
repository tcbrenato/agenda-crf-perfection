import { useState } from 'react'
import { Link } from 'react-router-dom'
import FeuilleBas from '../components/FeuilleBas'
import { IconePlus, IconeCrayon } from '../components/Icones'
import { useDonnees } from '../context/DonneesContext'
import { useToast } from '../context/ToastContext'
import { enregistrerProjet, messageErreur, supprimerProjet } from '../lib/api'
import { estTerminee } from '../lib/statuts'

const COULEURS = ['#1B2A41', '#96111C', '#1D4B94', '#1C6A40', '#8F4700', '#6B3FA0', '#0E7C86', '#5B6576']

/** Projets (catégories de tâches) — gérés par le DG et l'administrateur. */
export default function Projets() {
  const { projets, setProjets, taches } = useDonnees()
  const toast = useToast()
  const [edition, setEdition] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  const compter = (id) => {
    const liste = taches.filter((t) => t.projet_id === id)
    return { total: liste.length, ouvertes: liste.filter((t) => !estTerminee(t)).length }
  }

  const enregistrer = async (e) => {
    e.preventDefault()
    if (!edition.nom.trim()) return toast.erreur('Indiquez le nom du projet.')
    setEnvoi(true)
    try {
      const p = await enregistrerProjet({ ...edition, nom: edition.nom.trim() })
      setProjets((l) => (l.some((x) => x.id === p.id) ? l.map((x) => (x.id === p.id ? p : x)) : [...l, p]).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')))
      setEdition(null)
      toast.info('Projet enregistré')
    } catch (err) {
      toast.erreur(messageErreur(err))
    } finally {
      setEnvoi(false)
    }
  }

  const supprimer = async (p) => {
    if (!window.confirm(`Supprimer le projet « ${p.nom} » ? Les tâches sont conservées, sans projet.`)) return
    try {
      await supprimerProjet(p.id)
      setProjets((l) => l.filter((x) => x.id !== p.id))
      setEdition(null)
    } catch (err) {
      toast.erreur(messageErreur(err))
    }
  }

  return (
    <>
      <div className="ligne ligne--espace" style={{ marginBottom: 8 }}>
        <h1 className="titre-page">Projets</h1>
        <button type="button" className="btn btn--accent btn--petit" onClick={() => setEdition({ nom: '', couleur: COULEURS[0], archive: false })}>
          <IconePlus /> Nouveau projet
        </button>
      </div>
      <p className="sous-titre" style={{ marginBottom: 16 }}>
        Regroupez les tâches par dossier (COPAF, Catalogue 2027, Site web…) pour les retrouver et les filtrer d'un coup.
      </p>

      {projets.length === 0 && <p className="vide">Aucun projet pour l'instant.</p>}
      <div className="liste-cartes liste-cartes--grille">
        {projets.map((p) => {
          const n = compter(p.id)
          return (
            <div key={p.id} className="carte carte--padding" style={{ borderLeft: `5px solid ${p.couleur}`, opacity: p.archive ? 0.6 : 1 }}>
              <div className="ligne ligne--espace">
                <strong style={{ fontSize: '1.0625rem' }}>{p.nom}</strong>
                <button type="button" className="btn-icone" onClick={() => setEdition({ ...p })} aria-label={`Modifier ${p.nom}`}><IconeCrayon /></button>
              </div>
              <p className="texte-doux texte-petit">{n.ouvertes} tâche(s) ouverte(s) · {n.total} au total{p.archive && ' · archivé'}</p>
              <Link to={`/taches?projet=${p.id}`} className="btn btn--secondaire btn--petit" style={{ marginTop: 10 }}>Voir les tâches</Link>
            </div>
          )
        })}
      </div>

      <FeuilleBas ouvert={Boolean(edition)} titre={edition?.id ? 'Modifier le projet' : 'Nouveau projet'} onFermer={() => setEdition(null)}>
        {edition && (
          <form className="pile" onSubmit={enregistrer}>
            <div className="champ">
              <label htmlFor="projet-nom">Nom *</label>
              <input id="projet-nom" className="saisie" value={edition.nom} onChange={(e) => setEdition({ ...edition, nom: e.target.value })} maxLength={80} autoFocus />
            </div>
            <div className="champ">
              <span className="etiquette">Couleur</span>
              <div className="ligne" style={{ flexWrap: 'wrap' }}>
                {COULEURS.map((c) => (
                  <button key={c} type="button" onClick={() => setEdition({ ...edition, couleur: c })} aria-label={`Couleur ${c}`} aria-pressed={edition.couleur === c}
                    style={{ width: 40, height: 40, borderRadius: '50%', background: c, border: edition.couleur === c ? '3px solid #fff' : '0', boxShadow: edition.couleur === c ? `0 0 0 2px ${c}` : 'none', cursor: 'pointer' }} />
                ))}
              </div>
            </div>
            {edition.id && (
              <label className="interrupteur">
                <span style={{ fontWeight: 600 }}>Archivé (masqué des choix)</span>
                <input type="checkbox" checked={edition.archive} onChange={(e) => setEdition({ ...edition, archive: e.target.checked })} />
              </label>
            )}
            <button type="submit" className="btn btn--primaire btn--bloc" disabled={envoi}>Enregistrer</button>
            {edition.id && <button type="button" className="btn btn--alerte btn--bloc" onClick={() => supprimer(edition)}>Supprimer le projet</button>}
          </form>
        )}
      </FeuilleBas>
    </>
  )
}
