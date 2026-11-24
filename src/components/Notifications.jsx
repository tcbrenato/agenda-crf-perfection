import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import FeuilleBas from './FeuilleBas'
import { IconeCloche } from './Icones'
import { useDonnees } from '../context/DonneesContext'
import { formaterDate, formaterHorodatage } from '../lib/dates'

/** Bouton cloche + liste des notifications. `variante` : 'icone' (en-tête mobile) ou 'menu' (barre latérale). */
export default function Notifications({ notifications, variante = 'icone' }) {
  const { liste, nonLues, disponible, marquerLues } = notifications
  const { profilsParId, recharger } = useDonnees()
  const [ouvert, setOuvert] = useState(false)
  const naviguer = useNavigate()

  if (!disponible) return null

  const ouvrir = (n) => {
    if (!n.lu) marquerLues([n.id])
    setOuvert(false)
    if (n.taches) {
      recharger()
      naviguer(`/taches/${n.taches.id}`)
    }
  }

  const libelle = nonLues ? `Notifications : ${nonLues} non lue${nonLues > 1 ? 's' : ''}` : 'Notifications'
  const pastille = nonLues > 0 && <span className="pastille-cloche">{nonLues > 99 ? '99+' : nonLues}</span>

  return (
    <>
      {variante === 'menu' ? (
        <button type="button" className="lien-lateral" onClick={() => setOuvert(true)} aria-label={libelle}>
          <IconeCloche /> Notifications {pastille}
        </button>
      ) : (
        <button type="button" className="btn-icone bouton-cloche" onClick={() => setOuvert(true)} aria-label={libelle}>
          <IconeCloche />
          {pastille}
        </button>
      )}

      <FeuilleBas ouvert={ouvert} titre="Notifications" onFermer={() => setOuvert(false)}>
        {nonLues > 0 && (
          <button type="button" className="btn btn--fantome btn--petit" style={{ marginBottom: 6 }} onClick={() => marquerLues(liste.filter((n) => !n.lu).map((n) => n.id))}>
            Tout marquer comme lu
          </button>
        )}
        {liste.length === 0 && <p className="vide">Aucune notification pour l'instant.</p>}
        <div className="liste-notifications">
          {liste.map((n) => (
            <button key={n.id} type="button" className={`notification ${n.lu ? '' : 'notification--non-lue'}`} onClick={() => ouvrir(n)}>
              <span className="notification__point" aria-hidden="true" />
              <span className="notification__corps">
                <span>
                  <strong>{profilsParId[n.auteur_id]?.nom_complet || 'Quelqu’un'}</strong> vous a confié la tâche{' '}
                  {n.taches ? <strong>N° {n.taches.numero} — {n.taches.intitule}</strong> : '(supprimée)'}
                </span>
                <span className="notification__date">
                  {formaterHorodatage(n.cree_le)}
                  {n.taches?.echeance && ` · échéance ${formaterDate(n.taches.echeance)}`}
                </span>
              </span>
            </button>
          ))}
        </div>
      </FeuilleBas>
    </>
  )
}
