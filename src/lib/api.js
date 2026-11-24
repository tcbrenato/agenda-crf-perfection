import { supabase } from './supabase'

/** Traduit les erreurs techniques en messages compréhensibles. */
export function messageErreur(e) {
  const brut = String(e?.message || e || '')
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(brut)) {
    return 'Connexion impossible. Vérifiez votre réseau puis réessayez.'
  }
  if (/Invalid login credentials/i.test(brut)) return 'Email ou mot de passe incorrect.'
  if (/Email not confirmed/i.test(brut)) return "Votre compte n'est pas encore activé. Utilisez le lien reçu par email."
  if (/User is banned|banned/i.test(brut)) return 'Votre compte a été désactivé. Contactez la Direction.'
  if (/row-level security|permission denied|violates row-level/i.test(brut)) {
    return "Action non autorisée pour votre compte."
  }
  if (/duplicate key.*numero/i.test(brut)) return 'Ce numéro de tâche est déjà utilisé.'
  if (/demandes_report_une_en_attente/i.test(brut)) return 'Vous avez déjà une demande de report en attente pour cette tâche.'
  if (/duplicate key.*projets_nom/i.test(brut)) return 'Un projet porte déjà ce nom.'
  if (/JWT expired|invalid JWT/i.test(brut)) return 'Votre session a expiré. Reconnectez-vous.'
  if (/Password should be at least/i.test(brut)) return 'Le mot de passe doit contenir au moins 8 caractères.'
  if (/same password|different from the old/i.test(brut)) return "Le nouveau mot de passe doit être différent de l'ancien."
  if (/rate limit|too many/i.test(brut)) return 'Trop de tentatives. Patientez quelques minutes.'
  return brut || 'Une erreur est survenue.'
}

function verifier({ data, error }) {
  if (error) throw error
  return data
}

// ------------------------------- Profils -------------------------------
export async function chargerProfils() {
  return verifier(await supabase.from('profils').select('*').order('nom_complet'))
}

export async function chargerProfil(id) {
  return verifier(await supabase.from('profils').select('*').eq('id', id).maybeSingle())
}

export async function modifierProfil(id, champs) {
  return verifier(await supabase.from('profils').update(champs).eq('id', id).select().single())
}

// ------------------------------- Tâches --------------------------------
const SELECTION_TACHE = '*, attributions(profil_id, attribue_par, attribue_le, recu_le), etapes(fait)'
// Sélection de secours si la migration 0007 (étapes) n'est pas encore appliquée
const SELECTION_TACHE_BASE = '*, attributions(profil_id, attribue_par, attribue_le)'

function enrichir(t) {
  const { attributions, ...reste } = t
  const liste = attributions || []
  const etapes = reste.etapes || []
  delete reste.etapes
  return {
    ...reste,
    recurrence: reste.recurrence || 'aucune',
    etapesTotal: etapes.length,
    etapesFaites: etapes.filter((e) => e.fait).length,
    attribues: liste.map((a) => a.profil_id),
    // traçabilité : qui a attribué la tâche à qui, et quand
    attributionsDetail: liste.map((a) => ({ profil_id: a.profil_id, attribue_par: a.attribue_par, attribue_le: a.attribue_le, recu_le: a.recu_le }))
  }
}

/** Personnes (autres que l'attributaire lui-même) qui ont confié la tâche. */
export function confieePar(tache) {
  return [...new Set((tache.attributionsDetail || [])
    .filter((a) => a.attribue_par && a.attribue_par !== a.profil_id)
    .map((a) => a.attribue_par))]
}

export async function chargerTaches() {
  let r = await supabase.from('taches').select(SELECTION_TACHE).order('numero', { ascending: true }).limit(5000)
  if (r.error && !/fetch/i.test(r.error.message)) {
    r = await supabase.from('taches').select(SELECTION_TACHE_BASE).order('numero', { ascending: true }).limit(5000)
  }
  return verifier(r).map(enrichir)
}

export async function chargerTache(id) {
  let r = await supabase.from('taches').select(SELECTION_TACHE).eq('id', id).maybeSingle()
  if (r.error && !/fetch/i.test(r.error.message)) {
    r = await supabase.from('taches').select(SELECTION_TACHE_BASE).eq('id', id).maybeSingle()
  }
  const data = verifier(r)
  return data ? enrichir(data) : null
}

async function synchroniserAttributions(tacheId, nouveaux, anciens = []) {
  const aAjouter = nouveaux.filter((id) => !anciens.includes(id))
  const aRetirer = anciens.filter((id) => !nouveaux.includes(id))
  if (aRetirer.length) {
    verifier(await supabase.from('attributions').delete().eq('tache_id', tacheId).in('profil_id', aRetirer))
  }
  if (aAjouter.length) {
    verifier(await supabase.from('attributions').insert(aAjouter.map((profil_id) => ({ tache_id: tacheId, profil_id }))))
    // L'email de la nouvelle attribution est envoyé automatiquement par la base (migration 0009)
  }
}

/**
 * Bouton « Prévenir par email » (DG / admin) : renvoie l'email à tous les attributaires
 * de la tâche, sauf soi-même. Retourne { envoyes, resultats }.
 */
export async function renvoyerNotification(tacheId, profilIds) {
  const { data, error } = await supabase.functions.invoke('notifier-attribution', {
    body: { tache_id: tacheId, profil_ids: profilIds, renvoi: true }
  })
  if (error) {
    let message = error.message
    try {
      const corps = await error.context?.json?.()
      if (corps?.erreur) message = corps.erreur
    } catch { /* réponse non JSON */ }
    if (error.context?.status === 404 || /Failed to send a request|not found/i.test(message)) {
      message = "La fonction « notifier-attribution » n'est pas encore déployée sur Supabase."
    }
    throw new Error(message)
  }
  if (data?.erreur) throw new Error(data.erreur)
  return data
}

/**
 * Prévient par email les personnes nouvellement attribuées (fonction Edge « notifier-attribution »).
 * N'envoie rien si l'auteur n'est ni DG ni administrateur (contrôle côté serveur).
 * Sans attente : l'écran n'est jamais bloqué, un échec d'envoi n'empêche pas l'attribution.
 */
export function notifierAttribution(tacheId, profilIds) {
  supabase.functions
    .invoke('notifier-attribution', { body: { tache_id: tacheId, profil_ids: profilIds } })
    .then(({ error }) => error && console.warn('Notification email non envoyée :', error.message))
    .catch((e) => console.warn('Notification email non envoyée :', e))
}

export async function creerTache(champs, attribues = []) {
  const tache = verifier(await supabase.from('taches').insert(champs).select().single())
  await synchroniserAttributions(tache.id, attribues)
  return chargerTache(tache.id)
}

export async function modifierTache(id, champs, attribues, anciensAttribues) {
  if (champs && Object.keys(champs).length) {
    verifier(await supabase.from('taches').update(champs).eq('id', id).select('id').single())
  }
  if (attribues) await synchroniserAttributions(id, attribues, anciensAttribues)
  return chargerTache(id)
}

export async function changerStatut(id, statut) {
  const data = verifier(await supabase.from('taches').update({ statut }).eq('id', id).select('id, statut, date_terminee, modifie_le'))
  if (!data.length) throw new Error('permission denied')
  return data[0]
}

export async function supprimerTache(id) {
  const data = verifier(await supabase.from('taches').delete().eq('id', id).select('id'))
  if (!data.length) throw new Error('permission denied')
}

// ---------------------- Commentaires & historique ----------------------
export async function chargerCommentaires(tacheId) {
  return verifier(await supabase.from('commentaires').select('*').eq('tache_id', tacheId).order('date'))
}

export async function ajouterCommentaire(tacheId, texte) {
  return verifier(await supabase.from('commentaires').insert({ tache_id: tacheId, texte }).select().single())
}

export async function supprimerCommentaire(id) {
  verifier(await supabase.from('commentaires').delete().eq('id', id))
}

export async function chargerHistorique(tacheId) {
  return verifier(await supabase.from('historique').select('*').eq('tache_id', tacheId).order('date', { ascending: false }))
}

// --------------------------------- Chat ---------------------------------
export async function chargerConversations() {
  const { data, error } = await supabase.rpc('resume_conversations')
  if (error) throw error
  return data
}
export async function chargerMessages(conversationId, limite = 150) {
  const data = verifier(
    await supabase.from('messages').select('*').eq('conversation_id', conversationId)
      .order('cree_le', { ascending: false }).limit(limite)
  )
  return data.reverse()
}
export async function envoyerMessage(conversationId, texte) {
  return verifier(await supabase.from('messages').insert({ conversation_id: conversationId, texte }).select().single())
}
export async function supprimerMessage(id) {
  verifier(await supabase.from('messages').delete().eq('id', id))
}
export async function ouvrirConversation(autreId) {
  return verifier(await supabase.rpc('ouvrir_conversation', { p_autre: autreId }))
}
export async function marquerConversationLue(conversationId) {
  await supabase.rpc('marquer_conversation_lue', { p_conversation: conversationId })
}

// ----------------------------- Photo de profil -----------------------------
/** Recadre la photo en carré 256 px (JPEG ~25 Ko) avant l'envoi : léger pour les connexions faibles. */
async function preparerPhoto(fichier) {
  const image = await createImageBitmap(fichier)
  const cote = Math.min(image.width, image.height)
  const toile = document.createElement('canvas')
  toile.width = toile.height = 256
  toile.getContext('2d').drawImage(image, (image.width - cote) / 2, (image.height - cote) / 2, cote, cote, 0, 0, 256, 256)
  return await new Promise((ok) => toile.toBlob(ok, 'image/jpeg', 0.82))
}
export async function changerPhoto(profilId, fichier) {
  if (!fichier.type.startsWith('image/')) throw new Error('Choisissez une image (JPEG ou PNG).')
  const blob = await preparerPhoto(fichier)
  const chemin = `${profilId}/${Date.now()}.jpg`
  const { error } = await supabase.storage.from('avatars').upload(chemin, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('avatars').getPublicUrl(chemin)
  return modifierProfil(profilId, { photo_url: data.publicUrl })
}
export async function retirerPhoto(profilId) {
  return modifierProfil(profilId, { photo_url: null })
}

// --------------------------- Accusé de réception ---------------------------
/** L'attributaire confirme avoir bien reçu la tâche ; la personne qui l'a confiée est prévenue. */
export async function confirmerReception(tacheId) {
  return verifier(await supabase.rpc('confirmer_reception', { p_tache: tacheId }))
}

/** Vrai si la tâche a été confiée à `profil` par quelqu'un d'autre et qu'il n'a pas encore confirmé. */
export function receptionAConfirmer(profil, tache) {
  const a = (tache.attributionsDetail || []).find((x) => x.profil_id === profil?.id)
  return Boolean(a && a.recu_le === null && a.attribue_par && a.attribue_par !== profil.id)
}

// -------------------------------- Projets --------------------------------
export async function chargerProjets() {
  const { data, error } = await supabase.from('projets').select('*').order('nom')
  return error ? [] : data // table absente (migration 0007 non appliquée) : pas de projets
}
export async function enregistrerProjet(projet) {
  const { id, ...champs } = projet
  return verifier(
    id
      ? await supabase.from('projets').update(champs).eq('id', id).select().single()
      : await supabase.from('projets').insert(champs).select().single()
  )
}
export async function supprimerProjet(id) {
  verifier(await supabase.from('projets').delete().eq('id', id))
}

// ------------------------------- Étapes ---------------------------------
export async function chargerEtapes(tacheId) {
  return verifier(await supabase.from('etapes').select('*').eq('tache_id', tacheId).order('ordre').order('cree_le'))
}
export async function ajouterEtape(tacheId, texte, ordre) {
  return verifier(await supabase.from('etapes').insert({ tache_id: tacheId, texte, ordre }).select().single())
}
export async function cocherEtape(id, fait) {
  verifier(await supabase.from('etapes').update({ fait }).eq('id', id))
}
export async function supprimerEtape(id) {
  verifier(await supabase.from('etapes').delete().eq('id', id))
}

// ---------------------------- Pièces jointes ----------------------------
const BUCKET = 'pieces-jointes'
export const TAILLE_MAX_PJ = 10 * 1024 * 1024

export async function chargerPiecesJointes(tacheId) {
  return verifier(await supabase.from('pieces_jointes').select('*').eq('tache_id', tacheId).order('cree_le'))
}
export async function ajouterPieceJointe(tacheId, fichier) {
  if (fichier.size > TAILLE_MAX_PJ) throw new Error('Fichier trop lourd (10 Mo maximum).')
  const propre = fichier.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80)
  const chemin = `${tacheId}/${Date.now()}-${propre}`
  const { error } = await supabase.storage.from(BUCKET).upload(chemin, fichier, { contentType: fichier.type || undefined })
  if (error) throw error
  try {
    return verifier(
      await supabase.from('pieces_jointes')
        .insert({ tache_id: tacheId, nom: fichier.name, chemin, taille: fichier.size, type_mime: fichier.type || null })
        .select().single()
    )
  } catch (e) {
    await supabase.storage.from(BUCKET).remove([chemin])
    throw e
  }
}
export async function lienPieceJointe(chemin, nom) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(chemin, 300, { download: nom })
  if (error) throw error
  return data.signedUrl
}
export async function supprimerPieceJointe(pj) {
  verifier(await supabase.from('pieces_jointes').delete().eq('id', pj.id))
  await supabase.storage.from(BUCKET).remove([pj.chemin])
}

// ------------------------- Demandes de report --------------------------
export async function chargerReports(tacheId) {
  return verifier(await supabase.from('demandes_report').select('*').eq('tache_id', tacheId).order('cree_le', { ascending: false }))
}

export async function chargerReportsEnAttente() {
  return verifier(
    await supabase
      .from('demandes_report')
      .select('*, taches(id, numero, intitule, echeance)')
      .eq('statut', 'en_attente')
      .order('cree_le')
  )
}

export async function demanderReport(tacheId, nouvelleEcheance, motif) {
  return verifier(
    await supabase.from('demandes_report').insert({ tache_id: tacheId, nouvelle_echeance: nouvelleEcheance, motif }).select().single()
  )
}

export async function traiterReport(id, accepter, reponse) {
  verifier(await supabase.rpc('traiter_report', { p_id: id, p_accepter: accepter, p_reponse: reponse || null }))
}

// ---------------------------- Notifications ----------------------------
export async function chargerNotifications() {
  return verifier(
    await supabase
      .from('notifications')
      .select('*, taches(id, numero, intitule, echeance)')
      .order('cree_le', { ascending: false })
      .limit(40)
  )
}

export async function marquerNotificationsLues(ids) {
  if (!ids.length) return
  verifier(await supabase.from('notifications').update({ lu: true }).in('id', ids))
}

// ------------------------- Gestion des membres -------------------------
/** État des comptes (invitation acceptée, dernière connexion). Réservé à l'administrateur. */
export async function chargerEtatComptes() {
  const { data, error } = await supabase.rpc('admin_comptes')
  if (error) return null
  return Object.fromEntries(data.map((c) => [c.id, c]))
}

/** Dernières modifications de toute l'équipe (journal d'activité). */
export async function chargerActiviteRecente(limite = 40) {
  return verifier(
    await supabase.from('historique').select('*, taches(id, numero, intitule)').order('date', { ascending: false }).limit(limite)
  )
}

/** Appelle la fonction Edge « admin-membres » (invitation, désactivation…). */
export async function adminMembres(action, donnees = {}, nouvelEssai = true) {
  const { data, error } = await supabase.functions.invoke('admin-membres', {
    body: { action, redirectTo: window.location.origin, ...donnees }
  })
  // Session expirée (onglet resté ouvert, ordinateur en veille…) :
  // on renouvelle la session puis on réessaie une fois.
  if (error && error.context?.status === 401 && nouvelEssai) {
    const { error: e } = await supabase.auth.refreshSession()
    if (!e) return adminMembres(action, donnees, false)
  }
  if (error) {
    let message = error.message
    try {
      const corps = await error.context?.json?.()
      if (corps?.erreur) message = corps.erreur
    } catch { /* réponse non JSON */ }
    if (error.context?.status === 401) {
      message = 'Votre session a expiré. Déconnectez-vous puis reconnectez-vous.'
    } else if (/Failed to send a request|Function not found|404/i.test(message)) {
      message = "La fonction « admin-membres » n'est pas déployée sur Supabase (voir README)."
    }
    throw new Error(message)
  }
  if (data?.erreur) throw new Error(data.erreur)
  return data
}
