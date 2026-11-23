// =====================================================================
//  Fonction Edge « notifier-attribution » — Agenda CRF Perfection
//
//  Envoie un email à chaque personne à qui le DG ou un administrateur
//  vient d'attribuer une tâche.
//
//  Appel (depuis l'application, avec la session de l'utilisateur) :
//    { tache_id: "<uuid>", profil_ids: ["<uuid>", ...] }
//    { tache_id: "<uuid>", profil_ids: [...], renvoi: true }   ← bouton « Prévenir par email »
//      (renvoi : tous les attributaires indiqués, sans condition de délai)
//
//  Contrôles :
//    - l'appelant doit être DG ou administrateur actif (sinon : rien n'est envoyé)
//    - chaque attribution doit exister, avoir été faite par l'appelant
//      il y a moins de 15 minutes (empêche les envois abusifs)
//    - pas d'email à soi-même ni aux comptes désactivés
//
//  Secrets à définir (Supabase > Edge Functions > Secrets) :
//    SMTP_HOST   smtp.hostinger.com
//    SMTP_PORT   465
//    SMTP_USER   contact@crfperfection.pro
//    SMTP_PASS   mot de passe de la boîte mail
//    SMTP_FROM   CRF Perfection <contact@crfperfection.pro>   (facultatif)
//    APP_URL     https://agenda-crf-perfection.vercel.app      (facultatif)
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'

const enTetesCors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function reponseJson(corps: unknown, statut = 200) {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { ...enTetesCors, 'Content-Type': 'application/json; charset=utf-8' }
  })
}

const DELAI_MAX_MS = 15 * 60 * 1000

function formaterDate(iso: string | null) {
  if (!iso) return 'Sans échéance'
  const [a, m, j] = iso.slice(0, 10).split('-')
  return `${j}/${m}/${a}`
}

function echapper(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function prenom(nom: string) {
  const p = String(nom || '').trim().split(/\s+/)[0] || ''
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : ''
}

type Tache = {
  id: string
  numero: number
  intitule: string
  description: string | null
  echeance: string | null
  priorite: string
}

function construireEmail(tache: Tache, destinataire: string, auteur: string, coAttributaires: string[], lien: string, logo: string) {
  const ligne = (libelle: string, valeur: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#5B6576;font-size:14px;white-space:nowrap;vertical-align:top">${libelle}</td>` +
    `<td style="padding:6px 0;color:#1B2A41;font-size:14px;font-weight:600">${valeur}</td></tr>`

  const html = `<!doctype html>
<html lang="fr"><body style="margin:0;background:#F5F6F8;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F6F8;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E3E6EB">
  <tr><td style="background:#1B2A41;padding:18px 24px;border-bottom:4px solid #96111C">
    <img src="${logo}" alt="CRF Perfection" width="200" style="display:block;background:#FFFFFF;border-radius:8px;padding:8px 12px">
  </td></tr>
  <tr><td style="padding:24px">
    <p style="margin:0 0 12px;color:#1B2A41;font-size:16px">Bonjour ${echapper(prenom(destinataire))},</p>
    <p style="margin:0 0 18px;color:#1B2A41;font-size:16px;line-height:1.5">
      <strong>${echapper(auteur)}</strong> vous a attribué une tâche dans l'Agenda CRF Perfection.
    </p>
    <div style="border:1px solid #E3E6EB;border-left:4px solid #96111C;border-radius:8px;padding:14px 16px;margin-bottom:18px">
      <div style="color:#8A93A3;font-size:13px;font-weight:700">N° ${tache.numero}${tache.priorite === 'haute' ? ' &nbsp;·&nbsp; <span style="color:#96111C">PRIORITÉ HAUTE</span>' : ''}</div>
      <div style="color:#1B2A41;font-size:18px;font-weight:700;margin-top:4px;line-height:1.35">${echapper(tache.intitule)}</div>
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:10px">
        ${ligne('Échéance', formaterDate(tache.echeance))}
        ${ligne('Confiée par', echapper(auteur))}
        ${coAttributaires.length ? ligne('Avec', echapper(coAttributaires.join(', '))) : ''}
      </table>
      ${tache.description ? `<p style="margin:12px 0 0;color:#1B2A41;font-size:14px;line-height:1.5;white-space:pre-wrap">${echapper(tache.description)}</p>` : ''}
    </div>
    <p style="margin:0 0 22px">
      <a href="${lien}" style="background:#1B2A41;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:8px;display:inline-block">Voir la tâche</a>
    </p>
    <p style="margin:0;color:#5B6576;font-size:13px;line-height:1.5">
      Dans l'agenda, vous pouvez mettre à jour l'avancement (En cours, Bloquée, Terminée) et ajouter un commentaire.
    </p>
  </td></tr>
  <tr><td style="padding:14px 24px;background:#F5F6F8;color:#8A93A3;font-size:12px">
    CRF Perfection — Centre de recherche et de formation · Message automatique de l'Agenda CRF Perfection
  </td></tr>
</table>
</td></tr></table>
</body></html>`

  const texte = [
    `Bonjour ${prenom(destinataire)},`,
    '',
    `${auteur} vous a attribué une tâche dans l'Agenda CRF Perfection.`,
    '',
    `N° ${tache.numero} — ${tache.intitule}${tache.priorite === 'haute' ? ' (priorité haute)' : ''}`,
    `Échéance : ${formaterDate(tache.echeance)}`,
    coAttributaires.length ? `Avec : ${coAttributaires.join(', ')}` : '',
    tache.description ? `\n${tache.description}` : '',
    '',
    `Voir la tâche : ${lien}`,
    '',
    'CRF Perfection — Centre de recherche et de formation'
  ].filter((l) => l !== null).join('\n')

  const sujet = `${tache.priorite === 'haute' ? '[Priorité haute] ' : ''}Nouvelle tâche N° ${tache.numero} : ${tache.intitule}`.slice(0, 180)
  return { sujet, html, texte }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: enTetesCors })
  if (req.method !== 'POST') return reponseJson({ erreur: 'Méthode non autorisée' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const cleService = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const appUrl = (Deno.env.get('APP_URL') ?? 'https://agenda-crf-perfection.vercel.app').replace(/\/+$/, '')

  const admin = createClient(url, cleService, { auth: { persistSession: false, autoRefreshToken: false } })

  // 1) Appelant
  const jeton = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  const { data: { user } } = await admin.auth.getUser(jeton)
  if (!user) return reponseJson({ erreur: 'Session invalide' }, 401)

  const { data: appelant } = await admin.from('profils').select('id, nom_complet, role, actif').eq('id', user.id).single()
  if (!appelant?.actif || !['dg', 'admin'].includes(appelant.role)) {
    // Un membre qui attribue sa propre tâche : pas d'email (comportement voulu)
    return reponseJson({ ok: true, envoyes: 0, raison: 'non_gestionnaire' })
  }

  let corps: { tache_id?: string; profil_ids?: string[]; renvoi?: boolean }
  try {
    corps = await req.json()
  } catch {
    return reponseJson({ erreur: 'Requête invalide' }, 400)
  }
  const tacheId = String(corps.tache_id ?? '')
  const ids = [...new Set((corps.profil_ids ?? []).map(String))].filter((id) => id && id !== appelant.id).slice(0, 50)
  if (!tacheId || !ids.length) return reponseJson({ ok: true, envoyes: 0 })

  // 2) Tâche et attributions réellement faites par l'appelant, récemment
  const { data: tache } = await admin
    .from('taches')
    .select('id, numero, intitule, description, echeance, priorite')
    .eq('id', tacheId)
    .single()
  if (!tache) return reponseJson({ erreur: 'Tâche introuvable' }, 404)

  const { data: attributions } = await admin
    .from('attributions')
    .select('profil_id, attribue_par, attribue_le')
    .eq('tache_id', tacheId)
  const toutes = attributions ?? []
  const limite = Date.now() - DELAI_MAX_MS
  const valides = corps.renvoi === true
    ? toutes.filter((a) => ids.includes(a.profil_id))
    : toutes.filter(
        (a) => ids.includes(a.profil_id) && a.attribue_par === appelant.id && new Date(a.attribue_le).getTime() >= limite
      )
  if (!valides.length) return reponseJson({ ok: true, envoyes: 0, raison: 'aucune_attribution_recente' })

  const { data: profils } = await admin
    .from('profils')
    .select('id, nom_complet, email, actif')
    .in('id', toutes.map((a) => a.profil_id))
  const parId = Object.fromEntries((profils ?? []).map((p) => [p.id, p]))

  // 3) Envoi
  const hote = Deno.env.get('SMTP_HOST')
  const utilisateur = Deno.env.get('SMTP_USER')
  const motDePasse = Deno.env.get('SMTP_PASS')
  if (!hote || !utilisateur || !motDePasse) {
    return reponseJson({ erreur: 'Secrets SMTP non configurés (SMTP_HOST, SMTP_USER, SMTP_PASS)' }, 500)
  }
  const port = Number(Deno.env.get('SMTP_PORT') ?? '465')
  const transport = nodemailer.createTransport({
    host: hote,
    port,
    secure: port === 465,
    auth: { user: utilisateur, pass: motDePasse }
  })
  const expediteur = Deno.env.get('SMTP_FROM') ?? `CRF Perfection <${utilisateur}>`
  const lien = `${appUrl}/taches/${tache.id}`
  const logo = `${appUrl}/logo-connexion.png`

  const resultats: { email: string; ok: boolean; erreur?: string }[] = []
  for (const a of valides) {
    const dest = parId[a.profil_id]
    if (!dest?.actif || !dest.email) continue
    const co = toutes
      .filter((x) => x.profil_id !== a.profil_id)
      .map((x) => parId[x.profil_id]?.nom_complet)
      .filter(Boolean) as string[]
    const { sujet, html, texte } = construireEmail(tache as Tache, dest.nom_complet, appelant.nom_complet, co, lien, logo)
    try {
      await transport.sendMail({ from: expediteur, to: dest.email, subject: sujet, html, text: texte })
      resultats.push({ email: dest.email, ok: true })
    } catch (e) {
      console.error('Envoi impossible à', dest.email, (e as Error).message)
      resultats.push({ email: dest.email, ok: false, erreur: (e as Error).message })
    }
  }

  return reponseJson({ ok: true, envoyes: resultats.filter((r) => r.ok).length, resultats })
})
