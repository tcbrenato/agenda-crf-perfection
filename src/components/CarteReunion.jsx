import { useDonnees } from '../context/DonneesContext'
import { useToast } from '../context/ToastContext'
import { IconeCrayon } from './Icones'
import { TYPES_EVENEMENT, bientot, heureCourte, libelleRecurrence, plateforme } from '../lib/reunions'

/** Une réunion (occurrence) : heure, titre, répétition, lien « Rejoindre ». */
export default function CarteReunion({ o, onModifier, compacte = false }) {
  const { profilsParId } = useDonnees()
  const toast = useToast()
  const type = TYPES_EVENEMENT[o.type] || TYPES_EVENEMENT.reunion
  const imminente = bientot(o)

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(o.lien)
      toast.info('Lien copié')
    } catch {
      toast.erreur('Copie impossible')
    }
  }

  return (
    <article className={`carte-reunion ${imminente ? 'carte-reunion--imminente' : ''}`} style={{ borderLeftColor: type.couleur }}>
      <div className="carte-reunion__heure">
        <strong>{heureCourte(o.occurrence)}</strong>
        <span>{heureCourte(o.occurrence_fin)}</span>
      </div>
      <div className="carte-reunion__corps">
        <div className="ligne" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="badge-type" style={{ background: type.couleur }}>{type.libelle}</span>
          {imminente && <span className="badge-direct">● Maintenant</span>}
        </div>
        <h3 className="carte-reunion__titre">{o.titre}</h3>
        {!compacte && (
          <div className="texte-petit texte-doux">
            {[libelleRecurrence(o), o.lieu, o.pour_tous ? 'Toute l’équipe' : o.participants.map((id) => profilsParId[id]?.nom_complet).filter(Boolean).join(', ')]
              .filter(Boolean).join(' · ')}
          </div>
        )}
        {!compacte && o.description && <p className="texte-petit" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{o.description}</p>}
        {o.lien && (
          <a className={`btn btn--petit btn--bloc ${imminente ? 'btn--accent' : 'btn--primaire'}`} style={{ marginTop: 8 }} href={o.lien} target="_blank" rel="noopener noreferrer">
            ▶ Rejoindre {plateforme(o.lien)}
          </a>
        )}
        {((o.lien && !compacte) || onModifier) && (
          <div className="ligne carte-reunion__actions">
            {o.lien && !compacte && <button type="button" className="btn btn--fantome btn--petit" onClick={copier}>Copier le lien</button>}
            {onModifier && (
              <button type="button" className="btn btn--fantome btn--petit" onClick={() => onModifier(o)} aria-label={`Modifier ${o.titre}`}>
                <IconeCrayon /> Modifier
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
