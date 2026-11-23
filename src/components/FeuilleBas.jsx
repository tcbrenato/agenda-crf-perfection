import { useEffect, useRef } from 'react'
import { IconeFermer } from './Icones'

/** Feuille qui monte du bas de l'écran (mobile) / boîte de dialogue centrée (ordinateur). */
export default function FeuilleBas({ ouvert, titre, onFermer, children }) {
  const ref = useRef(null)
  // onFermer change à chaque affichage du parent : on garde la dernière version dans une référence,
  // pour que l'effet ci-dessous ne s'exécute qu'à l'ouverture et à la fermeture
  // (sinon le focus quittait le champ à chaque lettre tapée).
  const fermerRef = useRef(onFermer)
  fermerRef.current = onFermer

  useEffect(() => {
    if (!ouvert) return
    const auClavier = (e) => e.key === 'Escape' && fermerRef.current()
    document.addEventListener('keydown', auClavier)
    const ancienDebordement = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusPrecedent = document.activeElement
    // met le focus dans la feuille (sauf si un champ s'en charge avec autoFocus)
    const minuterie = setTimeout(() => {
      if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus()
    }, 30)
    return () => {
      clearTimeout(minuterie)
      document.removeEventListener('keydown', auClavier)
      document.body.style.overflow = ancienDebordement
      focusPrecedent?.focus?.()
    }
  }, [ouvert])

  if (!ouvert) return null
  return (
    <div className="voile" onMouseDown={(e) => e.target === e.currentTarget && onFermer()}>
      <div className="feuille" role="dialog" aria-modal="true" aria-label={titre} ref={ref} tabIndex={-1}>
        <div className="feuille__poignee" />
        <div className="feuille__entete">
          <h2 className="feuille__titre">{titre}</h2>
          <button type="button" className="btn-icone" onClick={onFermer} aria-label="Fermer">
            <IconeFermer />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
