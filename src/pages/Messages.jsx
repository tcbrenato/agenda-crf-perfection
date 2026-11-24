import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import FeuilleBas from '../components/FeuilleBas'
import { IconeEnvoyer, IconeGroupe, IconePlus, IconeRetour } from '../components/Icones'
import { useAuth } from '../context/AuthContext'
import { useChat } from '../context/ChatContext'
import { useDonnees } from '../context/DonneesContext'
import { useToast } from '../context/ToastContext'
import { useEstOrdinateur } from '../hooks/useMediaQuery'
import { chargerMessages, envoyerMessage, marquerConversationLue, messageErreur, ouvrirConversation, supprimerMessage } from '../lib/api'
import { aujourdhui, formaterDate, FUSEAU } from '../lib/dates'
import { ROLES } from '../lib/statuts'

const heure = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit' })
const jourIso = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' })

function quand(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const j = jourIso.format(d)
  return j === aujourdhui() ? heure.format(d) : formaterDate(j)
}

function nomConversation(c, profilsParId) {
  if (c.type === 'general') return 'Général'
  return profilsParId[c.autre_id]?.nom_complet || 'Conversation'
}

/** Liste des conversations */
function ListeConversations({ actif, onOuvrir, onNouvelle }) {
  const { conversations } = useChat()
  const { profilsParId } = useDonnees()
  const { profil } = useAuth()
  return (
    <div className="chat-liste">
      <div className="ligne ligne--espace" style={{ padding: '4px 4px 10px' }}>
        <h1 className="titre-page">Messages</h1>
        <button type="button" className="btn btn--accent btn--petit" onClick={onNouvelle}>
          <IconePlus /> Nouveau
        </button>
      </div>
      {conversations.map((c) => {
        const autre = profilsParId[c.autre_id]
        const auteur = c.dernier_auteur === profil.id ? 'Vous' : profilsParId[c.dernier_auteur]?.nom_complet?.split(' ')[0]
        return (
          <button key={c.id} type="button" className={`chat-conv ${actif === c.id ? 'chat-conv--active' : ''}`} onClick={() => onOuvrir(c.id)}>
            {c.type === 'general'
              ? <span className="avatar avatar--groupe"><IconeGroupe /></span>
              : <Avatar profil={autre} />}
            <span className="chat-conv__corps">
              <span className="chat-conv__haut">
                <strong>{nomConversation(c, profilsParId)}</strong>
                <span className="chat-conv__date">{quand(c.dernier_le)}</span>
              </span>
              <span className="chat-conv__apercu">
                {c.dernier_texte ? <>{auteur && `${auteur} : `}{c.dernier_texte}</> : c.type === 'general' ? 'Discussion de toute l’équipe' : 'Aucun message'}
              </span>
            </span>
            {c.non_lus > 0 && <span className="pastille-cloche chat-conv__nb">{c.non_lus}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Une conversation ouverte */
function Conversation({ id, onRetour }) {
  const { profil } = useAuth()
  const { profilsParId } = useDonnees()
  const { conversations, surMessage, recharger } = useChat()
  const toast = useToast()
  const [messages, setMessages] = useState(null)
  const [texte, setTexte] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const fil = useRef(null)
  const c = conversations.find((x) => x.id === id)
  const general = c?.type === 'general'
  const autre = c && profilsParId[c.autre_id]

  useEffect(() => {
    setMessages(null)
    chargerMessages(id).then((m) => {
      setMessages(m)
      marquerConversationLue(id).then(recharger)
    }).catch(() => setMessages([]))
    return surMessage((m) => {
      if (m.conversation_id !== id) return
      setMessages((l) => (l && !l.some((x) => x.id === m.id) ? [...l, m] : l))
      marquerConversationLue(id).then(recharger)
    })
  }, [id, surMessage, recharger])

  useLayoutEffect(() => {
    if (fil.current) fil.current.scrollTop = fil.current.scrollHeight
  }, [messages])

  const envoyer = async (e) => {
    e?.preventDefault()
    const t = texte.trim()
    if (!t || envoi) return
    setEnvoi(true)
    try {
      const m = await envoyerMessage(id, t)
      setMessages((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]))
      setTexte('')
      recharger()
    } catch (err) {
      toast.erreur(messageErreur(err))
    } finally {
      setEnvoi(false)
    }
  }

  const effacer = async (m) => {
    if (!window.confirm('Supprimer ce message ?')) return
    try {
      await supprimerMessage(m.id)
      setMessages((l) => l.filter((x) => x.id !== m.id))
      recharger()
    } catch (err) {
      toast.erreur(messageErreur(err))
    }
  }

  let jourPrecedent = null
  return (
    <div className="chat-conversation">
      <div className="chat-entete">
        {onRetour && <button type="button" className="btn-icone" onClick={onRetour} aria-label="Retour aux conversations"><IconeRetour /></button>}
        {general ? <span className="avatar avatar--groupe"><IconeGroupe /></span> : <Avatar profil={autre} />}
        <div style={{ minWidth: 0 }}>
          <strong>{general ? 'Général' : autre?.nom_complet || 'Conversation'}</strong>
          <div className="texte-tres-petit texte-doux">{general ? 'Toute l’équipe' : autre?.poste || ROLES[autre?.role] || ''}</div>
        </div>
      </div>

      <div className="chat-fil" ref={fil}>
        {messages === null && <p className="texte-doux" style={{ textAlign: 'center' }}>Chargement…</p>}
        {messages?.length === 0 && <p className="vide">Aucun message. Écrivez le premier !</p>}
        {messages?.map((m) => {
          const moi = m.auteur_id === profil.id
          const j = jourIso.format(new Date(m.cree_le))
          const separateur = j !== jourPrecedent
          jourPrecedent = j
          return (
            <div key={m.id}>
              {separateur && <div className="chat-jour">{j === aujourdhui() ? "Aujourd'hui" : formaterDate(j)}</div>}
              <div className={`chat-message ${moi ? 'chat-message--moi' : ''}`}>
                {!moi && general && <Avatar profil={profilsParId[m.auteur_id]} taille="petit" />}
                <div className="chat-bulle" onDoubleClick={() => moi && effacer(m)}>
                  {!moi && general && <div className="chat-bulle__auteur">{profilsParId[m.auteur_id]?.nom_complet || 'Ancien membre'}</div>}
                  <div className="chat-bulle__texte">{m.texte}</div>
                  <div className="chat-bulle__heure">{heure.format(new Date(m.cree_le))}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <form className="chat-saisie" onSubmit={envoyer}>
        <textarea
          className="saisie"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 900px)').matches) {
              e.preventDefault()
              envoyer()
            }
          }}
          placeholder="Écrire un message…"
          rows={1}
          maxLength={4000}
          aria-label="Message"
        />
        <button type="submit" className="btn btn--primaire" disabled={!texte.trim() || envoi} aria-label="Envoyer"><IconeEnvoyer /></button>
      </form>
    </div>
  )
}

export default function Messages() {
  const { id } = useParams()
  const naviguer = useNavigate()
  const ordinateur = useEstOrdinateur()
  const { profil } = useAuth()
  const { profils } = useDonnees()
  const { disponible, recharger } = useChat()
  const toast = useToast()
  const [choix, setChoix] = useState(false)

  if (!disponible) {
    return <p className="message-info">La messagerie sera disponible dès que la migration 0010 aura été appliquée dans Supabase.</p>
  }

  const ouvrir = (cid) => naviguer(`/messages/${cid}`)
  const nouvelle = async (autreId) => {
    try {
      const cid = await ouvrirConversation(autreId)
      setChoix(false)
      await recharger()
      ouvrir(cid)
    } catch (err) {
      toast.erreur(messageErreur(err))
    }
  }

  const personnes = profils.filter((p) => p.actif && p.id !== profil.id).sort((a, b) => a.nom_complet.localeCompare(b.nom_complet, 'fr'))

  return (
    <div className="page-chat">
      {(ordinateur || !id) && <ListeConversations actif={id} onOuvrir={ouvrir} onNouvelle={() => setChoix(true)} />}
      {id ? (
        <Conversation key={id} id={id} onRetour={ordinateur ? null : () => naviguer('/messages')} />
      ) : (
        ordinateur && <div className="chat-conversation chat-vide"><p className="texte-doux">Choisissez une conversation.</p></div>
      )}

      <FeuilleBas ouvert={choix} titre="Nouvelle conversation" onFermer={() => setChoix(false)}>
        <div className="liste-notifications">
          {personnes.map((p) => (
            <button key={p.id} type="button" className="notification" onClick={() => nouvelle(p.id)} style={{ alignItems: 'center' }}>
              <Avatar profil={p} />
              <span className="notification__corps">
                <strong>{p.nom_complet}</strong>
                <span className="notification__date">{p.poste || ROLES[p.role]}</span>
              </span>
            </button>
          ))}
        </div>
      </FeuilleBas>
    </div>
  )
}
