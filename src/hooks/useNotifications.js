import { useCallback, useEffect, useRef, useState } from 'react'
import { chargerNotifications, marquerNotificationsLues } from '../lib/api'

const INTERVALLE = 60_000 // vérification toutes les minutes quand l'application est ouverte

/**
 * Notifications de l'utilisateur connecté (« X vous a confié la tâche N° … »).
 * Désactivé silencieusement si la table n'existe pas encore (migration 0006 non appliquée).
 */
export function useNotifications({ surNouvelle } = {}) {
  const [liste, setListe] = useState([])
  const [disponible, setDisponible] = useState(true)
  const dejaVues = useRef(null)
  const rappel = useRef(surNouvelle)
  rappel.current = surNouvelle

  const charger = useCallback(async () => {
    try {
      const data = await chargerNotifications()
      setListe(data)
      setDisponible(true)
      // signale les notifications arrivées depuis le dernier chargement
      if (dejaVues.current) {
        const nouvelles = data.filter((n) => !n.lu && !dejaVues.current.has(n.id))
        if (nouvelles.length) rappel.current?.(nouvelles)
      }
      dejaVues.current = new Set(data.map((n) => n.id))
    } catch {
      setDisponible(false)
    }
  }, [])

  useEffect(() => {
    charger()
    const minuterie = setInterval(() => document.visibilityState === 'visible' && charger(), INTERVALLE)
    const auRetour = () => document.visibilityState === 'visible' && charger()
    document.addEventListener('visibilitychange', auRetour)
    return () => {
      clearInterval(minuterie)
      document.removeEventListener('visibilitychange', auRetour)
    }
  }, [charger])

  const marquerLues = useCallback(async (ids) => {
    setListe((l) => l.map((n) => (ids.includes(n.id) ? { ...n, lu: true } : n)))
    try { await marquerNotificationsLues(ids) } catch { /* sera resynchronisé au prochain chargement */ }
  }, [])

  return { liste, nonLues: liste.filter((n) => !n.lu).length, disponible, recharger: charger, marquerLues }
}
