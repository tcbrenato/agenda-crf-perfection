export function SqueletteCartes({ nombre = 4 }) {
  return (
    <div className="liste-cartes" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: nombre }).map((_, i) => (
        <div key={i} className="squelette" style={{ height: 104 }} />
      ))}
    </div>
  )
}

/** Écran de chargement : anneau qui tourne autour du logo CRF. */
export function ChargementPleinEcran() {
  return (
    <div className="chargement" role="status" aria-label="Chargement en cours">
      <div className="chargement__cercle">
        <span className="chargement__anneau" />
        <img src="/logo-entete.png" alt="CRF Perfection" width="104" height="43" />
      </div>
    </div>
  )
}
