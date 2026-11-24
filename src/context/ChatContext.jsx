import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { chargerConversations } from '../lib/api'

const ChatContext = createContext(null)

/**
 * Liste des conversations + non-lus, mise à jour en direct (Supabase Realtime)
 * et toutes les minutes en secours. Désactivé si la migration 0010 manque.
 */
export function ChatProvider({ children }) {
  const [conversations, setConversations] = useState([])
  const [disponible, setDisponible] = useState(true)
  const abonnes = useRef(new Set())

  const recharger = useCallback(async () => {
    try {
      setConversations(await chargerConversations())
      setDisponible(true)
    } catch {
      setDisponible(false)
    }
  }, [])

  useEffect(() => {
    recharger()
    let minuterie
    const canal = supabase
      .channel('agenda-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (charge) => {
        abonnes.current.forEach((f) => f(charge.new))
        clearTimeout(minuterie)
        minuterie = setTimeout(recharger, 300)
      })
      .subscribe()
    const secours = setInterval(() => document.visibilityState === 'visible' && recharger(), 60_000)
    const auRetour = () => document.visibilityState === 'visible' && recharger()
    document.addEventListener('visibilitychange', auRetour)
    return () => {
      supabase.removeChannel(canal)
      clearInterval(secours)
      clearTimeout(minuterie)
      document.removeEventListener('visibilitychange', auRetour)
    }
  }, [recharger])

  /** S'abonner aux nouveaux messages (retourne la fonction de désabonnement). Référence stable. */
  const surMessage = useCallback((f) => {
    abonnes.current.add(f)
    return () => abonnes.current.delete(f)
  }, [])

  const valeur = useMemo(() => ({
    conversations,
    disponible,
    nonLus: conversations.reduce((n, c) => n + (c.non_lus || 0), 0),
    recharger,
    surMessage
  }), [conversations, disponible, recharger, surMessage])

  return <ChatContext.Provider value={valeur}>{children}</ChatContext.Provider>
}

export function useChat() {
  return useContext(ChatContext)
}
