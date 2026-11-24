import { useCallback, useState } from 'react'
import { ajouterCommentaire, changerStatut, messageErreur } from '../lib/api'
import { useDonnees } from '../context/DonneesContext'
import { useToast } from '../context/ToastContext'
import { STATUTS } from '../lib/statuts'
import { aujourdhui } from '../lib/dates'

/**
 * Changement de statut « optimiste » : l'écran est mis à jour immédiatement,
 * puis annulé si le serveur refuse (connexion faible ou droits insuffisants).
 * - « Bloquée » : le motif est enregistré en commentaire (visible par le DG).
 * - Tâche récurrente terminée : la base crée l'occurrence suivante, on recharge la liste.
 */
export function useChangementStatut() {
  const { majTache, recharger } = useDonnees()
  const toast = useToast()
  const [tacheMenu, setTacheMenu] = useState(null)

  const appliquer = useCallback(
    async (tache, statut, { annulable = true, motif } = {}) => {
      setTacheMenu(null)
      if (tache.statut === statut) return
      const avant = { statut: tache.statut, date_terminee: tache.date_terminee }
      const recurrente = statut === 'termine' && tache.recurrence && tache.recurrence !== 'aucune'
      majTache(tache.id, { statut, date_terminee: statut === 'termine' ? aujourdhui() : null })
      try {
        const maj = await changerStatut(tache.id, statut)
        majTache(tache.id, maj)
        if (statut === 'bloque' && motif?.trim()) {
          await ajouterCommentaire(tache.id, `🚫 Bloquée : ${motif.trim()}`)
        }
        if (recurrente) {
          await recharger()
          toast.info(`N° ${tache.numero} terminée · la prochaine occurrence a été créée`)
          return
        }
        toast.info(`N° ${tache.numero} : ${STATUTS[statut].libelle}`, annulable ? {
          action: { libelle: 'Annuler', onClick: () => appliquer({ ...tache, ...maj }, avant.statut, { annulable: false }) }
        } : undefined)
      } catch (e) {
        majTache(tache.id, avant)
        toast.erreur(messageErreur(e))
      }
    },
    [majTache, recharger, toast]
  )

  return { appliquer, tacheMenu, ouvrirMenu: setTacheMenu, fermerMenu: () => setTacheMenu(null) }
}
