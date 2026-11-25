// =====================================================================
//  Fonction Edge « rappels-echeances » — Agenda CRF Perfection
//
//  Appelée automatiquement chaque matin (pg_cron, voir 0008_planification.sql).
//  À chaque appel :
//   1. RAPPELS : tâches non terminées dont l'échéance tombe dans les 48 h,
//      ou déjà échues → un seul email par personne, listant ses tâches
//      (+ notification dans l'application, créée par la base).
//      Chaque rappel n'est envoyé qu'une fois (journal_rappels).
//   2. LE LUNDI : récapitulatif de la semaine envoyé au(x) DG
//      (en retard, à rendre cette semaine, terminées la semaine passée,
//       demandes de report en attente).
//   3. LE LUNDI : sauvegarde complète des données (fichier JSON)
//      envoyée à l'administration (compte(s) administrateur).
//
//  La fonction peut être appelée plusieurs fois sans risque : rien n'est envoyé deux fois.
//  ⚠ Lors du déploiement, désactiver « Verify JWT » (appel par la planification).
//
//  Secrets (déjà définis pour notifier-attribution) :
//    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, APP_URL, SMTP_FROM (facultatif)
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

// ----------------------------- Dates -----------------------------
const FUSEAU = 'Africa/Porto-Novo'
function aujourdhui() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).map((x) => [x.type, x.value])
  )
  return `${p.year}-${p.month}-${p.day}`
}
const versUTC = (iso: string) => { const [a, m, j] = iso.split('-').map(Number); return new Date(Date.UTC(a, m - 1, j)) }
const plusJours = (iso: string, n: number) => { const d = versUTC(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const ecart = (de: string, a: string) => Math.round((versUTC(a).getTime() - versUTC(de).getTime()) / 86400000)
const jj = (iso: string | null) => { if (!iso) return '—'; const [a, m, j] = iso.slice(0, 10).split('-'); return `${j}/${m}/${a}` }
const estLundi = (iso: string) => versUTC(iso).getUTCDay() === 1
function semaineIso(iso: string) {
  const d = versUTC(iso)
  const jour = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - jour + 3)
  const premierJeudi = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const n = 1 + Math.round(((d.getTime() - premierJeudi.getTime()) / 86400000 - 3 + ((premierJeudi.getUTCDay() + 6) % 7)) / 7)
  return `${d.getUTCFullYear()}-S${String(n).padStart(2, '0')}`
}

// ----------------------------- Emails -----------------------------
const echapper = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const prenom = (nom: string) => { const p = String(nom || '').trim().split(/\s+/)[0] || ''; return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '' }

function gabarit(appUrl: string, titre: string, contenu: string) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#F5F6F8;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F6F8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E3E6EB">
<tr><td style="background:#1B2A41;padding:18px 24px;border-bottom:4px solid #96111C">
<img src="${appUrl}/logo-connexion.png" alt="CRF Perfection" width="200" style="display:block;background:#fff;border-radius:8px;padding:8px 12px"></td></tr>
<tr><td style="padding:24px;color:#1B2A41;font-size:15px;line-height:1.5">
<h1 style="margin:0 0 14px;font-size:19px;color:#1B2A41">${titre}</h1>${contenu}
<p style="margin:22px 0 0"><a href="${appUrl}" style="background:#1B2A41;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px;display:inline-block">Ouvrir l'agenda</a></p>
</td></tr>
<tr><td style="padding:14px 24px;background:#F5F6F8;color:#8A93A3;font-size:12px">CRF Perfection — Centre de recherche et de formation · Message automatique de l'Agenda CRF Perfection</td></tr>
</table></td></tr></table></body></html>`
}

type LigneTache = { id: string; numero: number; intitule: string; echeance: string | null; detail?: string; rouge?: boolean }
function tableau(appUrl: string, lignes: LigneTache[], vide = 'Aucune.') {
  if (!lignes.length) return `<p style="color:#5B6576;margin:4px 0 14px">${vide}</p>`
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:4px 0 16px">${lignes.map((l) => `
<tr><td style="padding:9px 8px;border-bottom:1px solid #E3E6EB;color:#8A93A3;font-weight:700;font-size:13px;width:44px;vertical-align:top">N° ${l.numero}</td>
<td style="padding:9px 8px;border-bottom:1px solid #E3E6EB;vertical-align:top"><a href="${appUrl}/taches/${l.id}" style="color:#1B2A41;font-weight:700;text-decoration:none">${echapper(l.intitule)}</a>
${l.detail ? `<div style="color:#5B6576;font-size:13px">${echapper(l.detail)}</div>` : ''}</td>
<td style="padding:9px 8px;border-bottom:1px solid #E3E6EB;white-space:nowrap;text-align:right;vertical-align:top;font-size:13px;font-weight:700;color:${l.rouge ? '#C8202F' : '#1B2A41'}">${jj(l.echeance)}</td></tr>`).join('')}</table>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: enTetesCors })

  const url = Deno.env.get('SUPABASE_URL')!
  const cleService = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const appUrl = (Deno.env.get('APP_URL') ?? 'https://agenda.crfperfection.pro').replace(/\/+$/, '')
  const admin = createClient(url, cleService, { auth: { persistSession: false, autoRefreshToken: false } })

  const hote = Deno.env.get('SMTP_HOST'), utilisateur = Deno.env.get('SMTP_USER'), motDePasse = Deno.env.get('SMTP_PASS')
  if (!hote || !utilisateur || !motDePasse) return json({ erreur: 'Secrets SMTP non configurés' }, 500)
  const port = Number(Deno.env.get('SMTP_PORT') ?? '465')
  const transport = nodemailer.createTransport({ host: hote, port, secure: port === 465, auth: { user: utilisateur, pass: motDePasse } })
  const expediteur = Deno.env.get('SMTP_FROM') ?? `CRF Perfection <${utilisateur}>`
  const envoyer = async (to: string, subject: string, html: string, attachments?: unknown[]) => {
    try {
      await transport.sendMail({ from: expediteur, to, subject, html, attachments })
      return true
    } catch (e) {
      console.error('Envoi impossible à', to, (e as Error).message)
      return false
    }
  }

  const jour = aujourdhui()
  const bilan: Record<string, unknown> = { jour }

  // ---------------------------------------------------------------- 1. Rappels
  const { data: rappels, error: e1 } = await admin.rpc('generer_rappels')
  if (e1) return json({ erreur: e1.message }, 500)
  const parPersonne = new Map<string, { email: string; nom: string; lignes: (LigneTache & { type: string })[] }>()
  for (const r of rappels ?? []) {
    if (!r.email) continue
    const g = parPersonne.get(r.profil_id) ?? { email: r.email, nom: r.nom_complet, lignes: [] }
    g.lignes.push({ id: r.tache_id, numero: r.numero, intitule: r.intitule, echeance: r.echeance, type: r.type })
    parPersonne.set(r.profil_id, g)
  }
  let rappelsEnvoyes = 0
  for (const g of parPersonne.values()) {
    const echues = g.lignes.filter((l) => l.type === 'echue').map((l) => ({ ...l, rouge: true, detail: `Échue depuis ${-ecart(jour, l.echeance!)} j` }))
    const proches = g.lignes.filter((l) => l.type !== 'echue').map((l) => {
      const n = ecart(jour, l.echeance!)
      return { ...l, detail: n === 0 ? "Échéance aujourd'hui" : n === 1 ? 'Échéance demain' : `Échéance dans ${n} jours` }
    })
    const contenu =
      `<p style="margin:0 0 14px">Bonjour ${echapper(prenom(g.nom))}, voici un rappel de vos tâches.</p>` +
      (echues.length ? `<h2 style="font-size:15px;color:#C8202F;margin:8px 0 2px">En retard</h2>${tableau(appUrl, echues)}` : '') +
      (proches.length ? `<h2 style="font-size:15px;margin:8px 0 2px">À rendre très bientôt</h2>${tableau(appUrl, proches)}` : '') +
      `<p style="color:#5B6576;font-size:13px;margin:0">Pensez à mettre à jour le statut dans l'agenda ou à demander un report si nécessaire.</p>`
    const sujet = echues.length
      ? `Rappel : ${echues.length} tâche${echues.length > 1 ? 's' : ''} en retard`
      : `Rappel : ${proches.length} tâche${proches.length > 1 ? 's' : ''} à rendre d'ici 48 h`
    if (await envoyer(g.email, sujet, gabarit(appUrl, 'Rappel de vos tâches', contenu))) rappelsEnvoyes++
  }
  bilan.rappels = { personnes: parPersonne.size, emails_envoyes: rappelsEnvoyes }

  // ------------------------------------------------- 2 & 3. Envois du lundi
  if (estLundi(jour)) {
    const semaine = semaineIso(jour)
    const { data: profils } = await admin.from('profils').select('id, nom_complet, email, role, actif')
    const actifs = (profils ?? []).filter((p) => p.actif)
    const nom = (id: string) => (profils ?? []).find((p) => p.id === id)?.nom_complet ?? '—'

    // --- 2. Récapitulatif pour le DG
    const cleRecap = `recap-${semaine}`
    const { data: dejaRecap } = await admin.from('journal_envois').select('cle').eq('cle', cleRecap).maybeSingle()
    if (!dejaRecap) {
      const { data: taches } = await admin.from('taches').select('id, numero, intitule, echeance, statut, date_terminee, attributions(profil_id)')
      const { data: reports } = await admin.from('demandes_report').select('id, tache_id, demandeur_id, nouvelle_echeance, motif').eq('statut', 'en_attente')
      const liste = taches ?? []
      const qui = (t: { attributions: { profil_id: string }[] }) => t.attributions.map((a) => nom(a.profil_id)).join(', ') || 'Non attribuée'
      const enRetard = liste.filter((t) => t.statut !== 'termine' && t.echeance && t.echeance < jour)
        .sort((a, b) => a.echeance!.localeCompare(b.echeance!))
        .map((t) => ({ ...t, rouge: true, detail: `${qui(t)} · échue depuis ${-ecart(jour, t.echeance!)} j` }))
      const semaineProchaine = plusJours(jour, 6)
      const aRendre = liste.filter((t) => t.statut !== 'termine' && t.echeance && t.echeance >= jour && t.echeance <= semaineProchaine)
        .sort((a, b) => a.echeance!.localeCompare(b.echeance!)).map((t) => ({ ...t, detail: qui(t) }))
      const lundiPasse = plusJours(jour, -7)
      const terminees = liste.filter((t) => t.statut === 'termine' && t.date_terminee && t.date_terminee >= lundiPasse && t.date_terminee < jour)
        .map((t) => ({ ...t, echeance: t.date_terminee, detail: `${qui(t)} · terminée le ${jj(t.date_terminee)}` }))
      const lignesReports = (reports ?? []).map((r) => {
        const t = liste.find((x) => x.id === r.tache_id)
        return { id: r.tache_id, numero: t?.numero ?? 0, intitule: t?.intitule ?? 'Tâche', echeance: r.nouvelle_echeance, detail: `${nom(r.demandeur_id)} demande le ${jj(r.nouvelle_echeance)} : ${r.motif}` }
      })
      const ouvertes = liste.filter((t) => t.statut !== 'termine').length
      const contenu =
        `<p style="margin:0 0 6px">Semaine du ${jj(jour)} au ${jj(semaineProchaine)}.</p>` +
        `<p style="margin:0 0 16px"><strong>${ouvertes}</strong> tâches ouvertes · <strong style="color:#C8202F">${enRetard.length}</strong> en retard · <strong>${terminees.length}</strong> terminées la semaine passée.</p>` +
        `<h2 style="font-size:15px;color:#C8202F;margin:8px 0 2px">En retard (${enRetard.length})</h2>${tableau(appUrl, enRetard, 'Aucune tâche en retard.')}` +
        `<h2 style="font-size:15px;margin:8px 0 2px">À rendre cette semaine (${aRendre.length})</h2>${tableau(appUrl, aRendre, 'Rien à rendre cette semaine.')}` +
        (lignesReports.length ? `<h2 style="font-size:15px;margin:8px 0 2px">Demandes de report à traiter (${lignesReports.length})</h2>${tableau(appUrl, lignesReports)}` : '') +
        `<h2 style="font-size:15px;color:#1C6A40;margin:8px 0 2px">Terminées la semaine passée (${terminees.length})</h2>${tableau(appUrl, terminees, 'Aucune.')}` +
        `<p style="color:#5B6576;font-size:13px;margin:0">Pour la réunion : export PDF ou Excel depuis l'onglet Tâches de l'agenda.</p>`
      let n = 0
      for (const dg of actifs.filter((p) => p.role === 'dg' && p.email)) {
        if (await envoyer(dg.email, `Récapitulatif de la semaine — ${enRetard.length} en retard, ${aRendre.length} à rendre`, gabarit(appUrl, 'Récapitulatif hebdomadaire', `<p style="margin:0 0 10px">Bonjour ${echapper(prenom(dg.nom_complet))},</p>` + contenu))) n++
      }
      if (n) await admin.from('journal_envois').insert({ cle: cleRecap })
      bilan.recapitulatif = { envoye_a: n }
    }

    // --- 3. Sauvegarde hebdomadaire à l'administration
    const cleSauvegarde = `sauvegarde-${semaine}`
    const { data: dejaSauvegarde } = await admin.from('journal_envois').select('cle').eq('cle', cleSauvegarde).maybeSingle()
    if (!dejaSauvegarde) {
      const tables = ['profils', 'projets', 'taches', 'attributions', 'etapes', 'commentaires', 'historique', 'demandes_report', 'pieces_jointes']
      const export_: Record<string, unknown> = { genere_le: new Date().toISOString(), application: 'Agenda CRF Perfection' }
      for (const t of tables) {
        const { data } = await admin.from(t).select('*').limit(50000)
        export_[t] = data ?? []
      }
      const contenu = `<p style="margin:0 0 10px">Vous trouverez en pièce jointe la sauvegarde complète des données de l'agenda (${(export_.taches as unknown[]).length} tâches).</p>
<p style="color:#5B6576;font-size:13px;margin:0">Conservez ce fichier : il permet de restaurer les données en cas de problème. Les pièces jointes des tâches ne sont pas incluses (seulement leur liste).</p>`
      let n = 0
      for (const ad of actifs.filter((p) => p.role === 'admin' && p.email)) {
        if (await envoyer(ad.email, `Sauvegarde hebdomadaire de l'agenda — ${jj(jour)}`, gabarit(appUrl, 'Sauvegarde hebdomadaire', contenu), [
          { filename: `sauvegarde-agenda-crf-${jour}.json`, content: JSON.stringify(export_, null, 1), contentType: 'application/json' }
        ])) n++
      }
      if (n) await admin.from('journal_envois').insert({ cle: cleSauvegarde })
      bilan.sauvegarde = { envoyee_a: n }
    }
  }

  return json({ ok: true, ...bilan })
})
