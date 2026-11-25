import { useCallback, useEffect, useState } from 'react'
import { chargerOccurrences } from '../lib/api'

/** Réunions entre deux dates (null si la migration 0012 n'est pas appliquée). */
export function useOccurrences(de, a) {
  const [liste, setListe] = useState([])
  const [disponible, setDisponible] = useState(true)
  const cle = `${de.toISOString()}|${a.toISOString()}`
  const charger = useCallback(() => {
    chargerOccurrences(de, a).then((l) => { setListe(l); setDisponible(true) }).catch(() => { setListe([]); setDisponible(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle])
  useEffect(charger, [charger])
  return { liste, disponible, recharger: charger }
}
