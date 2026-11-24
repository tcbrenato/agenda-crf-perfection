import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDonnees } from '../context/DonneesContext'
import { ajouterJours, ecartJours } from '../lib/dates'
import { estEchue, estTerminee } from '../lib/statuts'

const PERIODES = [
  { cle: 30, libelle: '30 jours' },
  { cle: 90, libelle: '3 mois' },
  { cle: 0, libelle: 'Tout' }
]
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/** Une tâche terminée est « à temps » si elle a été terminée au plus tard le jour de son échéance. */
const aTemps = (t) => !t.echeance || (t.date_terminee && t.date_terminee <= t.echeance)
const retardJours = (t) => (t.echeance && t.date_terminee && t.date_terminee > t.echeance ? ecartJours(t.echeance, t.date_terminee) : 0)
const pourcent = (a, b) => (b ? Math.round((a / b) * 100) : null)

function Tuile({ valeur, libelle, sous }) {
  return (
    <div className="compteur">
      <div className="compteur__valeur">{valeur ?? '—'}</div>
      <div className="compteur__libelle">{libelle}</div>
      {sous && <div className="texte-tres-petit texte-doux" style={{ marginTop: 2 }}>{sous}</div>}
    </div>
  )
}

function Barre({ valeur, max = 100, titre }) {
  return (
    <span className="barre-stat" title={titre}>
      <span style={{ width: `${max ? Math.max(2, (valeur / max) * 100) : 0}%` }} />
    </span>
  )
}

/** Statistiques de l'équipe (DG et administrateur). */
export default function Statistiques() {
  const { taches, profilsAssignables, projetsActifs, jour } = useDonnees()
  const [periode, setPeriode] = useState(30)

  const s = useMemo(() => {
    const debut = periode ? ajouterJours(jour, -periode) : '0000-01-01'
    const terminees = taches.filter((t) => estTerminee(t) && t.date_terminee && t.date_terminee >= debut)
    const enRetardTerminees = terminees.filter((t) => !aTemps(t))
    const ouvertesEnRetard = taches.filter((t) => estEchue(t, jour))
    const moyRetard = enRetardTerminees.length
      ? Math.round(enRetardTerminees.reduce((n, t) => n + retardJours(t), 0) / enRetardTerminees.length)
      : 0

    const parPersonne = profilsAssignables.map((p) => {
      const siennes = taches.filter((t) => t.attribues.includes(p.id))
      const fini = terminees.filter((t) => t.attribues.includes(p.id))
      const aT = fini.filter(aTemps).length
      const retard = fini.filter((t) => !aTemps(t))
      return {
        p,
        ouvertes: siennes.filter((t) => !estTerminee(t)).length,
        echues: siennes.filter((t) => estEchue(t, jour)).length,
        terminees: fini.length,
        tauxATemps: pourcent(aT, fini.length),
        retardMoyen: retard.length ? Math.round(retard.reduce((n, t) => n + retardJours(t), 0) / retard.length) : 0
      }
    }).sort((a, b) => b.echues - a.echues || b.ouvertes - a.ouvertes)

    // Tâches terminées par mois (6 derniers mois)
    const [a, m] = jour.split('-').map(Number)
    const mois = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(Date.UTC(a, m - 1 - (5 - i), 1))
      const cle = d.toISOString().slice(0, 7)
      const fini = taches.filter((t) => estTerminee(t) && t.date_terminee?.startsWith(cle))
      return { cle, libelle: `${MOIS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, total: fini.length, aTemps: fini.filter(aTemps).length }
    })

    const parProjet = projetsActifs.map((pr) => {
      const liste = taches.filter((t) => t.projet_id === pr.id)
      return {
        pr,
        ouvertes: liste.filter((t) => !estTerminee(t)).length,
        echues: liste.filter((t) => estEchue(t, jour)).length,
        terminees: liste.filter(estTerminee).length
      }
    }).filter((x) => x.ouvertes + x.terminees > 0)

    return {
      terminees: terminees.length,
      tauxATemps: pourcent(terminees.length - enRetardTerminees.length, terminees.length),
      moyRetard,
      ouvertesEnRetard: ouvertesEnRetard.length,
      ouvertes: taches.filter((t) => !estTerminee(t)).length,
      parPersonne,
      mois,
      parProjet
    }
  }, [taches, profilsAssignables, projetsActifs, jour, periode])

  const maxMois = Math.max(1, ...s.mois.map((m) => m.total))

  return (
    <>
      <div className="ligne ligne--espace" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h1 className="titre-page">Statistiques</h1>
        <div className="segment" role="group" aria-label="Période">
          {PERIODES.map((p) => (
            <button key={p.cle} type="button" aria-pressed={periode === p.cle} onClick={() => setPeriode(p.cle)}>{p.libelle}</button>
          ))}
        </div>
      </div>

      <section className="compteurs" aria-label="Indicateurs">
        <Tuile valeur={s.terminees} libelle="Tâches terminées" sous={periode ? `sur ${PERIODES.find((p) => p.cle === periode).libelle}` : 'depuis le début'} />
        <Tuile valeur={s.tauxATemps === null ? '—' : `${s.tauxATemps} %`} libelle="Terminées à temps" />
        <Tuile valeur={s.moyRetard ? `${s.moyRetard} j` : '0 j'} libelle="Retard moyen" sous="des tâches finies en retard" />
        <Tuile valeur={s.ouvertesEnRetard} libelle="En retard aujourd'hui" sous={`sur ${s.ouvertes} tâches ouvertes`} />
      </section>

      <h2 className="titre-section">Par personne</h2>
      <div className="carte tableau-conteneur">
        <table className="tableau">
          <thead>
            <tr><th>Membre</th><th>Ouvertes</th><th>En retard</th><th>Terminées</th><th style={{ minWidth: 150 }}>À temps</th><th>Retard moyen</th></tr>
          </thead>
          <tbody>
            {s.parPersonne.map((x) => (
              <tr key={x.p.id} style={{ cursor: 'default' }}>
                <td><Link to={`/taches?personne=${x.p.id}`} style={{ fontWeight: 600, textDecoration: 'none' }}>{x.p.nom_complet}</Link></td>
                <td>{x.ouvertes}</td>
                <td style={x.echues ? { color: 'var(--rouge)', fontWeight: 700 } : undefined}>{x.echues}</td>
                <td>{x.terminees}</td>
                <td>
                  {x.tauxATemps === null ? <span className="texte-doux">—</span> : (
                    <span className="ligne" style={{ gap: 8 }}>
                      <Barre valeur={x.tauxATemps} titre={`${x.tauxATemps} % terminées à temps`} />
                      <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 42 }}>{x.tauxATemps} %</span>
                    </span>
                  )}
                </td>
                <td>{x.retardMoyen ? `${x.retardMoyen} j` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="titre-section">Tâches terminées par mois</h2>
      <div className="carte carte--padding">
        <div className="histogramme" role="img" aria-label={s.mois.map((m) => `${m.libelle} : ${m.total} terminées dont ${m.aTemps} à temps`).join(' ; ')}>
          {s.mois.map((m) => (
            <div key={m.cle} className="histogramme__colonne" title={`${m.libelle} : ${m.total} terminée(s), dont ${m.aTemps} à temps`}>
              <span className="histogramme__valeur">{m.total}</span>
              <span className="histogramme__barre" style={{ height: `${(m.total / maxMois) * 100}%` }} />
              <span className="histogramme__mois">{m.libelle}</span>
            </div>
          ))}
        </div>
      </div>

      {s.parProjet.length > 0 && (
        <>
          <h2 className="titre-section">Par projet</h2>
          <div className="carte tableau-conteneur">
            <table className="tableau">
              <thead><tr><th>Projet</th><th>Ouvertes</th><th>En retard</th><th>Terminées</th></tr></thead>
              <tbody>
                {s.parProjet.map((x) => (
                  <tr key={x.pr.id} style={{ cursor: 'default' }}>
                    <td>
                      <Link to={`/taches?projet=${x.pr.id}`} className="badge-projet" style={{ fontSize: '0.9375rem', color: 'var(--texte)', textDecoration: 'none' }}>
                        <i style={{ background: x.pr.couleur }} /><span>{x.pr.nom}</span>
                      </Link>
                    </td>
                    <td>{x.ouvertes}</td>
                    <td style={x.echues ? { color: 'var(--rouge)', fontWeight: 700 } : undefined}>{x.echues}</td>
                    <td>{x.terminees}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="texte-doux texte-tres-petit" style={{ marginTop: 14 }}>
        « À temps » : tâche terminée au plus tard le jour de son échéance. Les chiffres portent sur les tâches terminées pendant la période choisie.
      </p>
    </>
  )
}
