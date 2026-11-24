// =====================================================================
//  Fonction Edge « envoyer-notifications » — Agenda CRF Perfection
//
//  Envoie PAR EMAIL chaque notification de l'agenda :
//   tâche confiée, tâche terminée / bloquée, commentaire,
//   demande de report et réponse, accusé de réception.
//  (Les rappels du matin ont leur propre email groupé : rappels-echeances.)
//
//  Déclenchée automatiquement par la base à chaque nouvelle notification,
//  et toutes les 10 minutes en filet de sécurité (migration 0009).
//  Chaque notification n'est envoyée qu'une fois ; en cas d'échec d'envoi,
//  elle est retentée (3 essais maximum).
//
//  ⚠ Déployer avec « Verify JWT » DÉSACTIVÉ (appel par la base).
//  Secrets : SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, APP_URL, SMTP_FROM (facultatif)
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'

const enTetesCors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
}
const json = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { ...enTetesCors, 'Content-Type': 'application/json; charset=utf-8' } })

const jj = (iso: string | null) => { if (!iso) return 'Sans échéance'; const [a, m, j] = String(iso).slice(0, 10).split('-'); return `${j}/${m}/${a}` }
const echapper = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const prenom = (nom: string) => { const p = String(nom || '').trim().split(/\s+/)[0] || ''; return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '' }

type Notif = {
  id: number
  type: string
  details: Record<string, unknown> | null
  destinataire_email: string
  destinataire_nom: string
  auteur_nom: string | null
  tache_id: string | null
  numero: number | null
  intitule: string | null
  description: string | null
  echeance: string | null
  priorite: string | null
  co_attributaires: string | null
}

/** Sujet, phrase d'introduction, détails et accent de couleur selon le type. */
function contenu(n: Notif) {
  const qui = n.auteur_nom || 'Quelqu’un'
  const tache = `N° ${n.numero} : ${n.intitule}`
  const d = n.details || {}
  switch (n.type) {
    case 'attribution':
      return {
        sujet: `${n.priorite === 'haute' ? '[Priorité haute] ' : ''}Nouvelle tâche ${tache}`,
        intro: `<strong>${echapper(qui)}</strong> vous a confié une tâche. Merci de confirmer sa réception dans l'agenda (« J'ai bien reçu »).`,
        bouton: 'Voir et confirmer la réception',
        accent: '#96111C',
        lignes: [['Échéance', jj(n.echeance)], ['Confiée par', qui], ...(n.co_attributaires ? [['Avec', n.co_attributaires]] : [])],
        description: n.description
      }
    case 'statut':
      return d.statut === 'bloque'
        ? { sujet: `Tâche bloquée : ${tache}`, intro: `<strong>${echapper(qui)}</strong> a signalé un <strong style="color:#8F4700">blocage</strong> sur cette tâche. Le motif figure dans les commentaires.`, bouton: 'Voir le motif', accent: '#E08A1E', lignes: [['Échéance', jj(n.echeance)]] }
        : { sujet: `Tâche terminée : ${tache}`, intro: `<strong>${echapper(qui)}</strong> a marqué cette tâche comme <strong style="color:#1C6A40">terminée</strong>.`, bouton: 'Voir la tâche', accent: '#1C6A40', lignes: [['Échéance', jj(n.echeance)]] }
    case 'commentaire':
      return { sujet: `Nouveau commentaire : ${tache}`, intro: `<strong>${echapper(qui)}</strong> a commenté cette tâche :`, citation: String(d.extrait ?? ''), bouton: 'Répondre', accent: '#1B2A41', lignes: [] }
    case 'report_demande':
      return {
        sujet: `Demande de report : ${tache}`,
        intro: `<strong>${echapper(qui)}</strong> demande à reporter l'échéance de cette tâche.`,
        citation: String(d.motif ?? ''),
        bouton: 'Accepter ou refuser',
        accent: '#E08A1E',
        lignes: [['Échéance actuelle', jj(n.echeance)], ['Date demandée', jj(String(d.nouvelle_echeance ?? ''))]]
      }
    case 'report_reponse':
      return d.acceptee
        ? { sujet: `Report accepté : ${tache}`, intro: `<strong>${echapper(qui)}</strong> a <strong style="color:#1C6A40">accepté</strong> votre demande de report.`, citation: d.reponse ? String(d.reponse) : undefined, bouton: 'Voir la tâche', accent: '#1C6A40', lignes: [['Nouvelle échéance', jj(String(d.nouvelle_echeance ?? ''))]] }
        : { sujet: `Report refusé : ${tache}`, intro: `<strong>${echapper(qui)}</strong> a <strong style="color:#C8202F">refusé</strong> votre demande de report. L'échéance reste inchangée.`, citation: d.reponse ? String(d.reponse) : undefined, bouton: 'Voir la tâche', accent: '#C8202F', lignes: [['Échéance', jj(n.echeance)]] }
    case 'accuse_reception':
      return { sujet: `Tâche bien reçue : ${tache}`, intro: `<strong>${echapper(qui)}</strong> confirme avoir <strong style="color:#1C6A40">bien reçu</strong> la tâche que vous lui avez confiée.`, bouton: 'Voir la tâche', accent: '#1C6A40', lignes: [['Échéance', jj(n.echeance)]] }
    default:
      return { sujet: `Mise à jour : ${tache}`, intro: `La tâche a été mise à jour.`, bouton: 'Voir la tâche', accent: '#1B2A41', lignes: [] }
  }
}

function construire(n: Notif, appUrl: string) {
  const c = contenu(n) as ReturnType<typeof contenu> & { citation?: string; description?: string | null }
  const lien = n.tache_id ? `${appUrl}/taches/${n.tache_id}` : appUrl
  const lignes = (c.lignes as string[][])
    .map(([l, v]) => `<tr><td style="padding:5px 12px 5px 0;color:#5B6576;font-size:14px;white-space:nowrap;vertical-align:top">${echapper(l)}</td><td style="padding:5px 0;color:#1B2A41;font-size:14px;font-weight:600">${echapper(v)}</td></tr>`)
    .join('')
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#F5F6F8;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F6F8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E3E6EB">
<tr><td style="background:#1B2A41;padding:18px 24px;border-bottom:4px solid #96111C">
<img src="${appUrl}/logo-connexion.png" alt="CRF Perfection" width="200" style="display:block;background:#fff;border-radius:8px;padding:8px 12px"></td></tr>
<tr><td style="padding:24px;color:#1B2A41;font-size:15px;line-height:1.5">
<p style="margin:0 0 12px">Bonjour ${echapper(prenom(n.destinataire_nom))},</p>
<p style="margin:0 0 16px">${c.intro}</p>
${n.numero ? `<div style="border:1px solid #E3E6EB;border-left:4px solid ${c.accent};border-radius:8px;padding:14px 16px;margin-bottom:18px">
  <div style="color:#8A93A3;font-size:13px;font-weight:700">N° ${n.numero}${n.priorite === 'haute' ? ' &nbsp;·&nbsp; <span style="color:#96111C">PRIORITÉ HAUTE</span>' : ''}</div>
  <div style="color:#1B2A41;font-size:17px;font-weight:700;margin-top:4px;line-height:1.35">${echapper(n.intitule)}</div>
  ${lignes ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:8px">${lignes}</table>` : ''}
  ${c.citation ? `<p style="margin:12px 0 0;padding:10px 12px;background:#F5F6F8;border-radius:6px;color:#1B2A41;font-size:14px;white-space:pre-wrap">« ${echapper(c.citation)} »</p>` : ''}
  ${c.description ? `<p style="margin:12px 0 0;color:#1B2A41;font-size:14px;white-space:pre-wrap">${echapper(c.description)}</p>` : ''}
</div>` : ''}
<p style="margin:0"><a href="${lien}" style="background:#1B2A41;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:8px;display:inline-block">${echapper(c.bouton)}</a></p>
</td></tr>
<tr><td style="padding:14px 24px;background:#F5F6F8;color:#8A93A3;font-size:12px">CRF Perfection — Centre de recherche et de formation · Message automatique de l'Agenda CRF Perfection</td></tr>
</table></td></tr></table></body></html>`
  const texte = `Bonjour ${prenom(n.destinataire_nom)},\n\n${c.intro.replace(/<[^>]+>/g, '')}\n\n${n.numero ? `N° ${n.numero} — ${n.intitule}\n` : ''}${(c.lignes as string[][]).map(([l, v]) => `${l} : ${v}`).join('\n')}${c.citation ? `\n« ${c.citation} »` : ''}\n\n${c.bouton} : ${lien}\n\nCRF Perfection — Centre de recherche et de formation`
  return { sujet: String(c.sujet).slice(0, 180), html, texte }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: enTetesCors })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const appUrl = (Deno.env.get('APP_URL') ?? 'https://agenda-crf-perfection.vercel.app').replace(/\/+$/, '')
  const hote = Deno.env.get('SMTP_HOST'), utilisateur = Deno.env.get('SMTP_USER'), motDePasse = Deno.env.get('SMTP_PASS')
  if (!hote || !utilisateur || !motDePasse) return json({ erreur: 'Secrets SMTP non configurés' }, 500)
  const port = Number(Deno.env.get('SMTP_PORT') ?? '465')
  const transport = nodemailer.createTransport({ host: hote, port, secure: port === 465, auth: { user: utilisateur, pass: motDePasse }, pool: true, maxConnections: 2 })
  const expediteur = Deno.env.get('SMTP_FROM') ?? `CRF Perfection <${utilisateur}>`

  let envoyes = 0
  const echecs: string[] = []
  // jusqu'à 3 lots de 40 par appel
  for (let lot = 0; lot < 3; lot++) {
    const { data, error } = await admin.rpc('reserver_notifications_email', { p_limite: 40 })
    if (error) return json({ erreur: error.message }, 500)
    const liste = (data ?? []) as Notif[]
    if (!liste.length) break
    for (const n of liste) {
      if (!n.destinataire_email) continue
      const { sujet, html, texte } = construire(n, appUrl)
      try {
        await transport.sendMail({ from: expediteur, to: n.destinataire_email, subject: sujet, html, text: texte })
        envoyes++
      } catch (e) {
        echecs.push(`${n.destinataire_email} : ${(e as Error).message}`)
        // remise en file d'attente (3 tentatives maximum)
        await admin.from('notifications').update({ email_envoye_le: null }).eq('id', n.id)
      }
    }
    if (liste.length < 40) break
  }
  transport.close()
  if (echecs.length) console.error('Échecs :', echecs)
  return json({ ok: true, envoyes, echecs })
})
