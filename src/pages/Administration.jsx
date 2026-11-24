import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import GestionMembres from './GestionMembres'
import { IconeImporter, IconeTelecharger, IconeFichier, IconeSuivant, IconeActualiser } from '../components/Icones'
import { useAuth } from '../context/AuthContext'
import { useDonnees } from '../context/DonneesContext'
import { useToast } from '../context/ToastContext'
import { chargerActiviteRecente, chargerEtatComptes, messageErreur } from '../lib/api'
import { formaterDate, formaterHorodatage } from '../lib/dates'
import { ROLES, STATUTS, estEchue, estTerminee, trierParNumero } from '../lib/statuts'
import { pluriel } from '../lib/texte'

const ONGLETS = [
  { cle: 'apercu', libelle: 'Aperçu' },
  { cle: 'membres', libelle: 'Membres' },
  { cle: 'donnees', libelle: 'Données' },
  { cle: 'activite', libelle: 'Activité' }
]

function Indicateur({ valeur, libelle, alerte, lien }) {
  const contenu = (
    <>
      <div className="compteur__valeur" style={alerte && valeur ? { color: 'var(--rouge)' } : undefined}>{valeur ?? '–'}</div>
      <div className="compteur__libelle">{libelle}</div>
    </>
  )
  return lien ? <Link to={lien} className="compteur">{contenu}</Link> : <div className="compteur">{contenu}</div>
}

function texteActivite(h) {
  switch (h.champ) {
    case 'creation': return 'a créé la tâche'
    case 'statut': return <>statut : {STATUTS[h.ancienne_valeur]?.libelle} → <strong>{STATUTS[h.nouvelle_valeur]?.libelle}</strong></>
    case 'echeance': return <>échéance : {formaterDate(h.ancienne_valeur)} → <strong>{formaterDate(h.nouvelle_valeur)}</strong></>
    case 'attribution': return h.nouvelle_valeur ? <>a attribué à <strong>{h.nouvelle_valeur}</strong></> : <>a retiré <strong>{h.ancienne_valeur}</strong></>
    default: return h.champ
  }
}

export default function Administration() {
  const { profil } = useAuth()
  const { taches, profils, profilsParId, jour, recharger } = useDonnees()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const onglet = ONGLETS.some((o) => o.cle === params.get('onglet')) ? params.get('onglet') : 'apercu'
  const [etats, setEtats] = useState(undefined)
  const [activite, setActivite] = useState(null)
  const [exportEnCours, setExportEnCours] = useState(null)

  useEffect(() => {
    chargerEtatComptes().then(setEtats)
  }, [profils.length])

  useEffect(() => {
    if (onglet === 'activite' || onglet === 'apercu') {
      chargerActiviteRecente(onglet === 'apercu' ? 6 : 60).then(setActivite).catch(() => setActivite([]))
    }
  }, [onglet])

  const stats = useMemo(() => {
    const actifs = profils.filter((p) => p.actif)
    const enAttente = etats ? actifs.filter((p) => etats[p.id] && !etats[p.id].compte_active).length : null
    const nonAttribuees = taches.filter((t) => !estTerminee(t) && !t.attribues.length).length
    // charge par personne : tâches ouvertes et échues
    const charge = actifs
      .filter((p) => p.role !== 'admin')
      .map((p) => {
        const siennes = taches.filter((t) => t.attribues.includes(p.id) && !estTerminee(t))
        return { p, ouvertes: siennes.length, echues: siennes.filter((t) => estEchue(t, jour)).length }
      })
      .sort((a, b) => b.echues - a.echues || b.ouvertes - a.ouvertes)
    return {
      actifs: actifs.length,
      inactifs: profils.length - actifs.length,
      enAttente,
      total: taches.length,
      echues: taches.filter((t) => estEchue(t, jour)).length,
      nonAttribuees,
      charge
    }
  }, [profils, taches, etats, jour])

  const exporterTout = async (format) => {
    setExportEnCours(format)
    try {
      const { exporterExcel, exporterPDF } = await import('../lib/export')
      const liste = [...taches].sort(trierParNumero)
      if (format === 'excel') await exporterExcel(liste, profilsParId, 'Toutes les tâches')
      else await exporterPDF(liste, profilsParId, 'Toutes les tâches')
    } catch (e) {
      toast.erreur(`Export impossible : ${messageErreur(e)}`)
    } finally {
      setExportEnCours(null)
    }
  }

  return (
    <>
      <div className="ligne ligne--espace" style={{ marginBottom: 4 }}>
        <h1 className="titre-page">Administration</h1>
        <button type="button" className="btn-icone" onClick={() => { recharger(); chargerEtatComptes().then(setEtats) }} aria-label="Actualiser">
          <IconeActualiser />
        </button>
      </div>
      <p className="sous-titre" style={{ marginBottom: 8 }}>
        Connecté en tant que {profil.nom_complet} · {ROLES[profil.role]}
      </p>

      <div className="onglets" role="tablist" style={{ marginTop: 8, overflowX: 'auto' }}>
        {ONGLETS.map((o) => (
          <button key={o.cle} role="tab" aria-selected={onglet === o.cle} onClick={() => setParams(o.cle === 'apercu' ? {} : { onglet: o.cle }, { replace: true })} style={{ whiteSpace: 'nowrap', padding: '0 10px' }}>
            {o.libelle}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        {onglet === 'apercu' && (
          <>
            <section className="compteurs" aria-label="Indicateurs">
              <Indicateur valeur={stats.actifs} libelle="Membres actifs" lien="/admin?onglet=membres" />
              <Indicateur valeur={etats === null ? '?' : stats.enAttente} libelle="Invitations en attente" lien="/admin?onglet=membres" />
              <Indicateur valeur={stats.total} libelle="Tâches au total" lien="/taches" />
              <Indicateur valeur={stats.echues} libelle="Tâches échues" alerte lien="/taches?filtre=echues" />
            </section>
            {etats === null && (
              <p className="message-info" style={{ marginTop: 12 }}>
                Pour voir les invitations en attente et les dernières connexions, exécutez le fichier
                <code> supabase/migrations/0004_admin.sql</code> dans Supabase (SQL Editor).
              </p>
            )}
            {stats.nonAttribuees > 0 && (
              <p className="message-info" style={{ marginTop: 12 }}>
                <Link to="/taches?personne=aucun">{pluriel(stats.nonAttribuees, 'tâche ouverte', 'tâches ouvertes')} sans attributaire</Link>
              </p>
            )}

            <h2 className="titre-section">Charge par personne</h2>
            <div className="carte tableau-conteneur">
              <table className="tableau">
                <thead><tr><th>Membre</th><th>Ouvertes</th><th>Échues</th></tr></thead>
                <tbody>
                  {stats.charge.map(({ p, ouvertes, echues }) => (
                    <tr key={p.id} style={{ cursor: "default" }}>
                      <td><Link to={`/taches?personne=${p.id}`} style={{ fontWeight: 600, textDecoration: 'none' }}>{p.nom_complet}</Link></td>
                      <td>{ouvertes}</td>
                      <td style={echues ? { color: 'var(--rouge)', fontWeight: 700 } : undefined}>{echues}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className="titre-section">Dernières modifications</h2>
            <ListeActivite activite={activite} profilsParId={profilsParId} />
            <Link to="/admin?onglet=activite" className="btn btn--fantome btn--bloc" style={{ marginTop: 6 }}>Tout le journal <IconeSuivant /></Link>
          </>
        )}

        {onglet === 'membres' && <GestionMembres integre />}

        {onglet === 'donnees' && (
          <div className="pile">
            <div className="carte carte--padding pile">
              <h2 style={{ fontSize: '1rem' }}>Importer une liste de tâches</h2>
              <p className="texte-doux texte-petit">Fichier Excel ou CSV : N°, Tâche, Date, Échéance, Attributaire.</p>
              <Link to="/compte/import" className="btn btn--primaire btn--bloc"><IconeImporter /> Importer un fichier</Link>
            </div>
            <div className="carte carte--padding pile">
              <h2 style={{ fontSize: '1rem' }}>Exporter toutes les tâches</h2>
              <p className="texte-doux texte-petit">{pluriel(stats.total, 'tâche')}, classées par N° (pour archivage ou réunion). Pour une liste filtrée, utilisez « Exporter » dans l'onglet Tâches.</p>
              <button className="btn btn--secondaire btn--bloc" disabled={!stats.total || exportEnCours} onClick={() => exporterTout('excel')}>
                <IconeTelecharger /> {exportEnCours === 'excel' ? 'Préparation…' : 'Excel (.xlsx)'}
              </button>
              <button className="btn btn--secondaire btn--bloc" disabled={!stats.total || exportEnCours} onClick={() => exporterTout('pdf')}>
                <IconeFichier /> {exportEnCours === 'pdf' ? 'Préparation…' : 'PDF'}
              </button>
            </div>
            <div className="carte carte--padding pile">
              <h2 style={{ fontSize: '1rem' }}>Emails envoyés par l'agenda</h2>
              <p className="texte-doux texte-petit">
                Les invitations et les réinitialisations de mot de passe partent de <strong>contact@crfperfection.pro</strong>.
                Ce réglage se modifie dans Supabase (Authentication &gt; Emails).
              </p>
            </div>
          </div>
        )}

        {onglet === 'activite' && <ListeActivite activite={activite} profilsParId={profilsParId} />}
      </div>
    </>
  )
}

function ListeActivite({ activite, profilsParId }) {
  if (activite === null) return <p className="texte-doux">Chargement…</p>
  if (!activite.length) return <p className="vide">Aucune activité pour l'instant.</p>
  return (
    <ol className="chronologie" style={{ marginTop: 4 }}>
      {activite.map((h) => (
        <li key={h.id}>
          <div>
            <strong>{profilsParId[h.auteur_id]?.nom_complet || 'Système'}</strong> {texteActivite(h)}
          </div>
          {h.taches && (
            <Link to={`/taches/${h.taches.id}`} className="texte-petit" style={{ display: 'block', color: 'var(--bleu-nuit)' }}>
              N° {h.taches.numero} — {h.taches.intitule}
            </Link>
          )}
          <div className="quand">{formaterHorodatage(h.date)}</div>
        </li>
      ))}
    </ol>
  )
}
