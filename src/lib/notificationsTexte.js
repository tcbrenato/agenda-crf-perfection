import { formaterDate } from './dates'

/**
 * Texte d'une notification selon son type.
 * Retourne { auteur, action } : « <auteur> <action> <tâche> ».
 */
export function texteNotification(n, profilsParId) {
  const auteur = n.auteur_id ? profilsParId[n.auteur_id]?.nom_complet || 'Quelqu’un' : ''
  const d = n.details || {}
  switch (n.type || 'attribution') {
    case 'attribution':
      return { auteur, action: 'vous a confié la tâche' }
    case 'statut':
      return d.statut === 'bloque'
        ? { auteur, action: 'a signalé un blocage sur la tâche' }
        : { auteur, action: 'a terminé la tâche' }
    case 'commentaire':
      return { auteur, action: `a commenté « ${d.extrait || ''} » sur la tâche` }
    case 'rappel_48h':
      return { auteur: '⏰ Rappel :', action: 'échéance proche pour la tâche' }
    case 'rappel_echue':
      return { auteur: '⚠️ En retard :', action: 'la tâche a dépassé son échéance' }
    case 'report_demande':
      return { auteur, action: `demande un report au ${formaterDate(d.nouvelle_echeance)} (« ${d.motif || ''} ») pour la tâche` }
    case 'report_reponse':
      return {
        auteur,
        action: d.acceptee
          ? `a accepté votre report au ${formaterDate(d.nouvelle_echeance)} pour la tâche`
          : `a refusé votre demande de report${d.reponse ? ` (« ${d.reponse} »)` : ''} pour la tâche`
      }
    default:
      return { auteur, action: 'a mis à jour la tâche' }
  }
}
