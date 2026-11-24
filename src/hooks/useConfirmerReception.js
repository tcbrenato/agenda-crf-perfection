import { useCallback, useState } from 'react'
import { confirmerReception, messageErreur } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useDonnees } from '../context/DonneesContext'
import { useToast } from '../context/ToastContext'

/** Bouton « J'ai bien reçu » : confirme la réception d'une ou plusieurs tâches. */
export function useConfirmerReception() {
  const { profil } = useAuth()
  const { majTache } = useDonnees()
  const toast = useToast()
  const [enCours, setEnCours] = useState(null)

  const marquer = useCallback((tache, recuLe) => {
    majTache(tache.id, {
      attributionsDetail: (tache.attributionsDetail || []).map((a) => (a.profil_id === profil.id ? { ...a, recu_le: recuLe } : a))
    })
  }, [majTache, profil.id])

  const confirmer = useCallback(async (taches) => {
    const liste = Array.isArray(taches) ? taches : [taches]
    setEnCours(liste.length === 1 ? liste[0].id : 'tout')
    let ok = 0
    for (const t of liste) {
      try {
        marquer(t, await confirmerReception(t.id))
        ok++
      } catch (e) {
        toast.erreur(messageErreur(e))
        break
      }
    }
    setEnCours(null)
    if (ok) toast.info(ok > 1 ? `Réception de ${ok} tâches confirmée` : `Réception de la tâche N° ${liste[0].numero} confirmée`)
  }, [marquer, toast])

  return { confirmer, enCours }
}
