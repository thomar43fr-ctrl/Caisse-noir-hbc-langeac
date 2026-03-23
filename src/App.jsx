import { useState, useMemo, useEffect } from "react";
import { db, auth } from "./firebase";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, getDocs, getDoc
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "firebase/auth";
import { INITIAL_RULES, INITIAL_PAYMENTS, INITIAL_CALENDAR } from "./data";
import { HISTORICAL_MATCHES } from "./matches";

// --- HELPERS ---
function getPlayerInfractionStats(entries) {
  const counts = {};
  entries.forEach(e => {
    if (!e.detail || e.detail === "Rien" || e.amount === 0) return;
    const d = e.detail.toLowerCase();
    const keywords = [
      {key:"mitraillette",label:"Mitraillette"},{key:"sortie veille",label:"Sortie veille"},
      {key:"chaboula",label:"Chaboulat"},{key:"penalty raté",label:"Penalty raté"},
      {key:"contre-attaque ratée",label:"Contre-attaque ratée"},{key:"relance ratée",label:"Relance ratée"},
      {key:"tir fantaisie raté",label:"Tir fantaisie raté"},{key:"vomi",label:"Vomi en soirée"},
      {key:"retard",label:"Retard"},{key:"carton rouge",label:"Carton rouge"},
      {key:"défaite",label:"Défaite collective"},{key:"fantôme",label:"Fantôme"},
    ];
    keywords.forEach(({key,label}) => {
      if (d.includes(key)) counts[label] = (counts[label]||0)+1;
    });
  });
  return Object.entries(counts).filter(([,v])=>v>=2).sort((a,b)=>b[1]-a[1]);
}

const NAV_ITEMS = ["Dashboard","Paiements","Joueurs","Règles","Calendrier"];

export default function App() {
  // Data State
  const [rules, setRules] = useState(INITIAL_RULES);
  const [matches, setMatches] = useState(HISTORICAL_MATCHES);
  const [calendar, setCalendar] = useState(INITIAL_CALENDAR);
  const [payments, setPayments] = useState(INITIAL_PAYMENTS);
  
  // UI State
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showAddInfraction, setShowAddInfraction] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [newInfraction, setNewInfraction] = useState({player:"",ruleId:"",customDetail:"",customAmount:"",matchLabel:""});
  const [newRule, setNewRule] = useState({name:"",amount:""});

  // Auth State
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false); 
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  // --- AUTH LISTENER ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const userDoc = await getDoc(doc(db, "users", u.uid));
          setIsAdmin(userDoc.exists() && userDoc.data().role === "admin");
        } catch(e) { setIsAdmin(false); }
      } else { setIsAdmin(false); }
    });
    return () => unsub();
  }, []);

  const handleAuth = async () => {
    try {
      if (authMode === "login") await signInWithEmailAndPassword(auth, authEmail, authPassword);
      else await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      setAuthEmail(""); setAuthPassword("");
    } catch(e) { setAuthError("Erreur d'authentification"); }
  };

  // --- FIREBASE LISTENERS ---
  useEffect(() => {
    const unsubRules = onSnapshot(collection(db, "rules"), s => !s.empty && setRules(s.docs.map(d => ({...d.data(), id: d.id}))));
    const unsubMatches = onSnapshot(collection(db, "matches"), s => !s.empty && setMatches(s.docs.map(d => ({...d.data(), fbId: d.id}))));
    const unsubPayments = onSnapshot(collection(db, "payments"), s => !s.empty && setPayments(s.docs.map(d => ({...d.data(), fbId: d.id}))));
    const unsubCal = onSnapshot(collection(db, "calendar"), s => !s.empty && setCalendar(s.docs.map(d => ({...d.data(), fbId: d.id}))));
    setLoading(false);
    return () => { unsubRules(); unsubMatches(); unsubPayments(); unsubCal(); };
  }, []);

  // --- COMPUTED ---
  const totalCaisse = useMemo(() => payments.reduce((s,p) => s+p.total, 0), [payments]);
  const players = useMemo(() => payments.map(p => p.player).sort(), [payments]);

  // --- ACTIONS ---
  const addInfraction = async () => {
    const rule = rules.find(r => String(r.id) === String(newInfraction.ruleId));
    const amount = rule ? rule.amount : parseFloat(newInfraction.customAmount) || 0;
    const detail = rule ? rule.name : newInfraction.customDetail;
    const match = matches.find(m => m.match === (newInfraction.matchLabel || "Hors match"));
    
    if (match) {
      const newEntries = [...(match.entries || []), {player: newInfraction.player, amount, detail}];
      await updateDoc(doc(db, "matches", match.fbId || String(match.id)), {entries: newEntries});
      showToast("Ajouté !");
      setShowAddInfraction(false);
    }
  };

  const addRule = async () => {
    if (!newRule.name || !newRule.amount) return;
    await setDoc(doc(db, "rules", String(Date.now())), {name: newRule.name, amount: parseFloat(newRule.amount)});
    setShowAddRule(false);
    showToast("Règle ajoutée !");
  };

  if (loading) return <div style={{textAlign:"center", padding:50}}>Chargement...</div>;

  if (!user) return (
    <div style={{padding:40, maxWidth:400, margin:"auto", textAlign:"center"}}>
        <h2>HBC LANGEAC</h2>
        <input type="email" placeholder="Email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} style={{width:'100%', marginBottom:10, padding:10}}/>
        <input type="password" placeholder="Pass" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} style={{width:'100%', marginBottom:10, padding:10}}/>
        <button onClick={handleAuth} style={{padding:10, width:'100%', background:'#1565c0', color:'white', border:'none'}}>Connexion</button>
        {authError && <p style={{color:'red'}}>{authError}</p>}
    </div>
  );

  return (
    <div style={{background:"#f0f6ff", minHeight:"100vh", fontFamily:"sans-serif"}}>
      {/* HEADER */}
      <div style={{background:"#1565c0", color:"white", padding:15}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <h1 style={{margin:0, fontSize:20}}>CAISSE NOIRE {isAdmin && "👑"}</h1>
            <button onClick={()=>signOut(auth)} style={{background:"white", border:"none", padding:5, borderRadius:5}}>Déco</button>
        </div>
        <div style={{display:"flex", gap:10, marginTop:10, overflowX:"auto"}}>
            {NAV_ITEMS.map(t => <button key={t} onClick={()=>setActiveTab(t)} style={{background:activeTab===t?"#0d47a1":"transparent", color:"white", border:"none", padding:8, fontWeight:800}}>{t}</button>)}
        </div>
      </div>

      <div style={{padding:15}}>
        {/* BOUTONS ADMIN - C'est ici qu'ils reviennent ! */}
        {isAdmin && (
            <div style={{display:"flex", gap:10, marginBottom:20}}>
                <button onClick={()=>setShowAddInfraction(true)} style={{flex:1, padding:15, background:"#e53935", color:"white", border:"none", borderRadius:10, fontWeight:"bold"}}>+ AMENDE</button>
                <button onClick={()=>setShowAddRule(true)} style={{flex:1, padding:15, background:"#2e7d32", color:"white", border:"none", borderRadius:10, fontWeight:"bold"}}>+ RÈGLE</button>
            </div>
        )}

        {/* CONTENU SELON TAB */}
        {activeTab === "Dashboard" && (
            <div>
                <div style={{background:"white", padding:20, borderRadius:15, marginBottom:15}}>
                    <div style={{fontSize:12, color:"#78909c"}}>TOTAL CAISSE</div>
                    <div style={{fontSize:32, fontWeight:"bold", color:"#1565c0"}}>{totalCaisse.toFixed(1)}€</div>
                </div>
            </div>
        )}

        {activeTab === "Règles" && (
            <div style={{display:"flex", flexDirection:"column", gap:10}}>
                {rules.map(r => (
                    <div key={r.id} style={{background:"white", padding:15, borderRadius:10, display:"flex", justifyContent:"space-between"}}>
                        <span>{r.name}</span>
                        <strong style={{color:"#1565c0"}}>{r.amount}€</strong>
                    </div>
                ))}
            </div>
        )}
        
        {/* MODALE AJOUT INFRACTION */}
        {showAddInfraction && (
            <div style={{position:"fixed", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,0.7)", padding:20, zIndex:1000}}>
                <div style={{background:"white", padding:20, borderRadius:15}}>
                    <h3>Nouvelle Amende</h3>
                    <select onChange={e=>setNewInfraction({...newInfraction, player:e.target.value})} style={{width:"100%", padding:10, marginBottom:10}}>
                        <option>Choisir un joueur</option>
                        {players.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <select onChange={e=>setNewInfraction({...newInfraction, ruleId:e.target.value})} style={{width:"100%", padding:10, marginBottom:10}}>
                        <option>Choisir une règle</option>
                        {rules.map(r => <option key={r.id} value={r.id}>{r.name} ({r.amount}€)</option>)}
                    </select>
                    <button onClick={addInfraction} style={{width:"100%", padding:12, background:"#e53935", color:"white", border:"none", borderRadius:8, fontWeight:"bold", marginBottom:10}}>VALIDER</button>
                    <button onClick={()=>setShowAddInfraction(false)} style={{width:"100%", background:"#eee", border:"none", padding:10}}>Annuler</button>
                </div>
            </div>
        )}

        {/* MODALE AJOUT RÈGLE */}
        {showAddRule && (
            <div style={{position:"fixed", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,0.7)", padding:20, zIndex:1000}}>
                <div style={{background:"white", padding:20, borderRadius:15}}>
                    <h3>Nouvelle Règle</h3>
                    <input type="text" placeholder="Nom de la règle" onChange={e=>setNewRule({...newRule, name:e.target.value})} style={{width:"100%", padding:10, marginBottom:10}} />
                    <input type="number" placeholder="Montant €" onChange={e=>setNewRule({...newRule, amount:e.target.value})} style={{width:"100%", padding:10, marginBottom:10}} />
                    <button onClick={addRule} style={{width:"100%", padding:12, background:"#2e7d32", color:"white", border:"none", borderRadius:8, fontWeight:"bold", marginBottom:10}}>ENREGISTRER</button>
                    <button onClick={()=>setShowAddRule(false)} style={{width:"100%", background:"#eee", border:"none", padding:10}}>Annuler</button>
                </div>
            </div>
        )}

        {toast && <div style={{position:"fixed", bottom:20, left:20, right:20, background:"#333", color:"white", padding:10, borderRadius:10, textAlign:"center"}}>{toast}</div>}
      </div>
    </div>
  );
}
