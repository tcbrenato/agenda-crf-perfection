import { useMemo, useState } from 'react'
import CarteReunion from '../components/CarteReunion'
import FormulaireReunion from '../components/FormulaireReunion'
import { IconePlus } from '../components/Icones'
import { useAuth } from '../context/AuthContext'
import { useOccurrences } from '../hooks/useOccurrences'
import { estGestionnaire } from '../lib/droits'
import { jourDe, jourIsoDe } from '../lib/reunions'
import { aujourdhui } from '../lib/dates'
import { majuscule } from '../lib/texte'

const PERIODE_JOURS = 45

/** Réunions, projets et événements planifiés (45 prochains jours). */
export default function Reunions() {
  const { profil } = useAuth()
  const gestionnaire = estGestionnaire(profil)
  const [de] = useState(() => new Date(Date.now() - 3 * 3600_000))
  const [a] = useState(() => new Date(Date.now() + PERIODE_JOURS * 86400_000))
  const { liste, disponible, recharger } = useOccurrences(de, a)
  const [formulaire, setFormulaire] = useState(null) // null | 'nouveau' | événement

  const parJour = useMemo(() => {
    const groupes = []
    for (const o of liste) {
      const j = jourIsoDe(o.occurrence)
      const g = groupes.find((x) => x.jour === j)
      if (g) g.items.push(o)
      else groupes.push({ jour: j, items: [o] })
    }
    return groupes
  }, [liste])

  if (!disponible) return <p className="message-info">Les réunions seront disponibles dès que la migration 0012 aura été appliquée dans Supabase.</p>

  return (
    <>
      <div className="ligne ligne--espace" style={{ marginBottom: 6 }}>
        <h1 className="titre-page">Réunions</h1>
        {gestionnaire && (
          <button type="button" className="btn btn--accent btn--petit" onClick={() => setFormulaire('nouveau')}>
            <IconePlus /> Planifier
          </button>
        )}
      </div>
      <p className="sous-titre" style={{ marginBottom: 14 }}>Réunions, projets et événements des {PERIODE_JOURS} prochains jours. Rappel par email 30 minutes avant.</p>

      {parJour.length === 0 && (
        <p className="vide">{gestionnaire ? 'Rien de planifié. Touchez « Planifier » pour ajouter la réunion du staff.' : 'Aucune réunion planifiée.'}</p>
      )}
      {parJour.map((g) => (
        <section key={g.jour}>
          <h2 className="titre-section">{g.jour === aujourdhui() ? "Aujourd'hui" : majuscule(jourDe(g.items[0].occurrence))}</h2>
          <div className="pile" style={{ gap: 10 }}>
            {g.items.map((o) => (
              <CarteReunion key={`${o.id}-${o.occurrence}`} o={o} onModifier={gestionnaire ? (x) => setFormulaire(x) : undefined} />
            ))}
          </div>
        </section>
      ))}

      <FormulaireReunion
        ouvert={Boolean(formulaire)}
        evenement={formulaire && formulaire !== 'nouveau' ? formulaire : null}
        onFermer={() => setFormulaire(null)}
        onEnregistre={recharger}
      />
    </>
  )
}
