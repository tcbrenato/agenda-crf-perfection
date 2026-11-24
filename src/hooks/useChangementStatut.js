import { useCallback, useState } from 'react'
import { ajouterCommentaire, ajouterPieceJointe, changerStatut, messageErreur } from '../lib/api'
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
  const [etapeMenu, setEtapeMenu] = useState(null)

  const appliquer = useCallback(
    async (tache, statut, { annulable = true, motif, compteRendu, fichiers = [] } = {}) => {
      setTacheMenu(null)
      if (tache.statut === statut) return
      const avant = { statut: tache.statut, date_terminee: tache.date_terminee }
      const recurrente = statut === 'termine' && tache.recurrence && tache.recurrence !== 'aucune'
      // 1) Fichiers corrigés et compte rendu / motif, enregistrés AVANT le statut :
      //    la notification (et l'email) au DG les reprend.
      try {
        const noms = []
        for (const f of fichiers) {
          await ajouterPieceJointe(tache.id, f)
          noms.push(f.name)
        }
        if (statut === 'bloque' && motif?.trim()) {
          await ajouterCommentaire(tache.id, `🚫 Bloquée : ${motif.trim()}`)
        }
        if (statut === 'termine' && (compteRendu?.trim() || noms.length)) {
          const joint = noms.length ? `${compteRendu?.trim() ? '\n' : ''}📎 Fichier${noms.length > 1 ? 's' : ''} joint${noms.length > 1 ? 's' : ''} : ${noms.join(', ')}` : ''
          await ajouterCommentaire(tache.id, `✅ Terminée : ${compteRendu?.trim() || ''}${joint}`.replace('✅ Terminée : \n', '✅ Terminée : '))
        }
      } catch (e) {
        toast.erreur(messageErreur(e))
        return
      }
      // 2) Changement de statut (affichage immédiat, annulé si le serveur refuse)
      majTache(tache.id, { statut, date_terminee: statut === 'termine' ? aujourdhui() : null })
      try {
        const maj = await changerStatut(tache.id, statut)
        majTache(tache.id, maj)
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

  /** Ouvre le menu de statut ; `etape` = 'termine' ou 'bloque' pour aller directement à cette étape. */
  const ouvrirMenu = useCallback((tache, etape = null) => {
    setEtapeMenu(etape)
    setTacheMenu(tache)
  }, [])

  return { appliquer, tacheMenu, etapeMenu, ouvrirMenu, fermerMenu: () => setTacheMenu(null) }
}
