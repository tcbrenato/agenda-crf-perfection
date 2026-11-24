import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ListeTaches from '../components/ListeTaches'
import { SqueletteCartes } from '../components/Chargement'
import { IconeAlerte, IconeHorloge, IconeActualiser } from '../components/Icones'
import { useAuth } from '../context/AuthContext'
import { useDonnees } from '../context/DonneesContext'
import { ajouterJours, formaterDateLongue } from '../lib/dates'
import { estEchue, estTerminee, trierParEcheance } from '../lib/statuts'
import { estGestionnaire } from '../lib/droits'
import { useEstOrdinateur } from '../hooks/useMediaQuery'
import { majuscule, prenom } from '../lib/texte'
import { chargerReportsEnAttente, messageErreur, receptionAConfirmer } from '../lib/api'
import { useConfirmerReception } from '../hooks/useConfirmerReception'
import { formaterDate as fd } from '../lib/dates'

const CLE_PORTEE = 'agenda-crf-portee-accueil'

export default function Accueil() {
  const { profil } = useAuth()
  const { taches, jour, chargement, erreur, recharger } = useDonnees()
  const ordinateur = useEstOrdinateur()
  // Les membres ne voient que leurs tâches : pas de bascule Équipe / Mes tâches
  const gestionnaire = estGestionnaire(profil)
  const [porteeChoisie, setPortee] = useState(() => {
    try {
      return localStorage.getItem(CLE_PORTEE) || (estGestionnaire(profil) ? 'equipe' : 'moi')
    } catch {
      return 'equipe'
    }
  })
  const portee = gestionnaire ? porteeChoisie : 'tout'
  const { profilsParId } = useDonnees()
  const [reports, setReports] = useState([])
  const reception = useConfirmerReception()
  const aConfirmer = taches.filter((t) => receptionAConfirmer(profil, t))
  useEffect(() => {
    if (gestionnaire) chargerReportsEnAttente().then(setReports).catch(() => setReports([]))
  }, [gestionnaire, taches])
  const changerPortee = (p) => {
    setPortee(p)
    try { localStorage.setItem(CLE_PORTEE, p) } catch { /* stockage indisponible */ }
  }

  const { liste, compteurs, enRetard, semaine } = useMemo(() => {
    const liste = portee === 'moi' ? taches.filter((t) => t.attribues.includes(profil.id)) : taches // 'tout' : ce que la base autorise
    const dans7 = ajouterJours(jour, 7)
    const enRetard = liste.filter((t) => estEchue(t, jour)).sort(trierParEcheance)
    const semaine = liste
      .filter((t) => !estTerminee(t) && t.echeance && t.echeance >= jour && t.echeance <= dans7)
      .sort(trierParEcheance)
    return {
      liste,
      enRetard,
      semaine,
      compteurs: {
        total: liste.length,
        enCours: liste.filter((t) => !estTerminee(t) && !estEchue(t, jour)).length,
        echues: enRetard.length,
        terminees: liste.filter(estTerminee).length
      }
    }
  }, [taches, portee, profil.id, jour])

  const suffixe = portee === 'moi' ? '&portee=moi' : ''

  return (
    <>
      <div className="ligne ligne--espace" style={{ alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="titre-page">Bonjour {prenom(profil.nom_complet)}</h1>
          <p className="sous-titre">{majuscule(formaterDateLongue(jour))}</p>
        </div>
        {gestionnaire && (
          <div className="segment" role="group" aria-label="Portée du tableau de bord">
            <button type="button" aria-pressed={portee === 'equipe'} onClick={() => changerPortee('equipe')}>Équipe</button>
            <button type="button" aria-pressed={portee === 'moi'} onClick={() => changerPortee('moi')}>Mes tâches</button>
          </div>
        )}
      </div>

      {erreur && (
        <div className="message-erreur ligne ligne--espace" style={{ marginBottom: 12 }}>
          <span>{messageErreur(erreur)}</span>
          <button className="btn btn--petit btn--secondaire" onClick={recharger}><IconeActualiser /> Réessayer</button>
        </div>
      )}

      <section className="compteurs" aria-label="Compteurs">
        <Link to={`/taches?filtre=toutes${suffixe}`} className="compteur compteur--total">
          <div className="compteur__valeur">{chargement ? '–' : compteurs.total}</div>
          <div className="compteur__libelle">Total</div>
        </Link>
        <Link to={`/taches?filtre=en_cours${suffixe}`} className="compteur compteur--encours">
          <div className="compteur__valeur">{chargement ? '–' : compteurs.enCours}</div>
          <div className="compteur__libelle">En cours</div>
        </Link>
        <Link to={`/taches?filtre=echues${suffixe}`} className={`compteur compteur--echues ${compteurs.echues ? '' : 'vide'}`}>
          <div className="compteur__valeur">{chargement ? '–' : compteurs.echues}</div>
          <div className="compteur__libelle">Échues</div>
        </Link>
        <Link to={`/taches?filtre=terminees${suffixe}`} className="compteur compteur--terminees">
          <div className="compteur__valeur">{chargement ? '–' : compteurs.terminees}</div>
          <div className="compteur__libelle">Terminées</div>
        </Link>
      </section>

      {aConfirmer.length > 0 && (
        <section className="bloc-recu" aria-labelledby="titre-recu">
          <div className="ligne ligne--espace" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h2 className="titre-section" id="titre-recu" style={{ margin: 0 }}>
              Nouvelles tâches à confirmer <span className="compte">({aConfirmer.length})</span>
            </h2>
            {aConfirmer.length > 1 && (
              <button type="button" className="btn btn--accent btn--petit" disabled={Boolean(reception.enCours)} onClick={() => reception.confirmer(aConfirmer)}>
                ✓ Tout confirmer
              </button>
            )}
          </div>
          <p className="texte-petit texte-doux" style={{ margin: '4px 0 10px' }}>
            Ces tâches vous ont été confiées. Confirmez que vous les avez bien reçues : la personne qui les a confiées sera prévenue.
          </p>
          <ListeTaches taches={aConfirmer} />
        </section>
      )}

      {reports.length > 0 && (
        <section className="bloc-reports" aria-labelledby="titre-reports">
          <h2 className="titre-section" id="titre-reports" style={{ marginTop: 4 }}>
            Demandes de report à traiter <span className="compte">({reports.length})</span>
          </h2>
          <div className="pile" style={{ gap: 8 }}>
            {reports.map((r) => (
              <Link key={r.id} to={`/taches/${r.tache_id}`} className="ligne-report">
                <span className="numero">N° {r.taches?.numero}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>{r.taches?.intitule}</strong>
                  <span className="texte-petit texte-doux" style={{ display: 'block' }}>
                    {profilsParId[r.demandeur_id]?.nom_complet} : {fd(r.ancienne_echeance)} → {fd(r.nouvelle_echeance)} · {r.motif}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {chargement ? (
        <div style={{ marginTop: 24 }}><SqueletteCartes nombre={3} /></div>
      ) : (
        <>
          {enRetard.length > 0 ? (
            <section className="bloc-retard" aria-labelledby="titre-retard">
              <h2 className="titre-section" id="titre-retard">
                <IconeAlerte /> En retard <span className="compte">({enRetard.length})</span>
              </h2>
              <ListeTaches taches={enRetard.slice(0, ordinateur ? 15 : 8)} tableau />
              {enRetard.length > (ordinateur ? 15 : 8) && (
                <Link to={`/taches?filtre=echues${suffixe}`} className="btn btn--alerte btn--bloc" style={{ marginTop: 10 }}>
                  Voir les {enRetard.length} tâches en retard
                </Link>
              )}
            </section>
          ) : (
            liste.length > 0 && <p className="message-succes">Aucune tâche en retard 👍</p>
          )}

          <section aria-labelledby="titre-semaine">
            <h2 className="titre-section" id="titre-semaine">
              <IconeHorloge width="20" height="20" /> À échéance dans les 7 jours <span className="compte">({semaine.length})</span>
            </h2>
            <ListeTaches taches={semaine} tableau vide="Rien à rendre dans les 7 prochains jours." />
          </section>
        </>
      )}
      {!chargement && liste.length === 0 && (
        <p className="message-info" style={{ marginTop: 16 }}>
          Aucune tâche pour l'instant. Touchez le bouton <strong>+</strong> pour en ajouter une.
        </p>
      )}
    </>
  )
}
