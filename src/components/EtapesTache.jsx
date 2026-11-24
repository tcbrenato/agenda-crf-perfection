import { useEffect, useState } from 'react'
import { IconeFermer, IconePlus } from './Icones'
import { useAuth } from '../context/AuthContext'
import { useDonnees } from '../context/DonneesContext'
import { useToast } from '../context/ToastContext'
import { ajouterEtape, chargerEtapes, cocherEtape, messageErreur, supprimerEtape } from '../lib/api'
import { peutChangerStatut, peutModifier } from '../lib/droits'

/** Étapes (checklist) d'une tâche : cocher (attributaires), ajouter / retirer (DG, admin, créateur). */
export default function EtapesTache({ tache }) {
  const { profil } = useAuth()
  const { majTache } = useDonnees()
  const toast = useToast()
  const [etapes, setEtapes] = useState(null)
  const [texte, setTexte] = useState('')

  useEffect(() => {
    chargerEtapes(tache.id).then(setEtapes).catch(() => setEtapes(null))
  }, [tache.id])

  if (etapes === null) return null // table absente ou chargement
  const peutGerer = peutModifier(profil, tache)
  const peutCocher = peutChangerStatut(profil, tache)
  if (!etapes.length && !peutGerer) return null

  const synchroniser = (liste) => {
    setEtapes(liste)
    majTache(tache.id, { etapesTotal: liste.length, etapesFaites: liste.filter((e) => e.fait).length })
  }

  const basculer = async (e) => {
    const liste = etapes.map((x) => (x.id === e.id ? { ...x, fait: !x.fait } : x))
    synchroniser(liste)
    try {
      await cocherEtape(e.id, !e.fait)
    } catch (err) {
      synchroniser(etapes)
      toast.erreur(messageErreur(err))
    }
  }

  const ajouter = async (ev) => {
    ev.preventDefault()
    if (!texte.trim()) return
    try {
      const e = await ajouterEtape(tache.id, texte.trim(), etapes.length + 1)
      synchroniser([...etapes, e])
      setTexte('')
    } catch (err) {
      toast.erreur(messageErreur(err))
    }
  }

  const retirer = async (e) => {
    try {
      await supprimerEtape(e.id)
      synchroniser(etapes.filter((x) => x.id !== e.id))
    } catch (err) {
      toast.erreur(messageErreur(err))
    }
  }

  const faites = etapes.filter((e) => e.fait).length
  return (
    <section>
      <h2 className="titre-section">
        Étapes <span className="compte">({faites}/{etapes.length})</span>
      </h2>
      {etapes.length > 0 && (
        <div className="progression" aria-hidden="true"><span style={{ width: `${(faites / etapes.length) * 100}%` }} /></div>
      )}
      <div className="carte" style={{ padding: '2px 14px' }}>
        {etapes.map((e) => (
          <div key={e.id} className="etape">
            <label className="etape__case">
              <input type="checkbox" checked={e.fait} disabled={!peutCocher} onChange={() => basculer(e)} />
              <span className={e.fait ? 'etape__texte etape__texte--fait' : 'etape__texte'}>{e.texte}</span>
            </label>
            {peutGerer && (
              <button type="button" className="btn-icone" onClick={() => retirer(e)} aria-label={`Retirer l'étape ${e.texte}`}>
                <IconeFermer />
              </button>
            )}
          </div>
        ))}
        {peutGerer && (
          <form className="zone-commentaire" onSubmit={ajouter} style={{ margin: '10px 0' }}>
            <input className="saisie" value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Ajouter une étape…" maxLength={200} aria-label="Nouvelle étape" />
            <button className="btn btn--secondaire" type="submit" disabled={!texte.trim()} aria-label="Ajouter l'étape" style={{ padding: '0 14px' }}><IconePlus /></button>
          </form>
        )}
      </div>
    </section>
  )
}
