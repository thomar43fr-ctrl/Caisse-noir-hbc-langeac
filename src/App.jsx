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

export default function App() {
  const [rules, setRules] = useState(INITIAL_RULES);
  const [matches, setMatches] = useState(HISTORICAL_MATCHES);
  const [calendar, setCalendar] = useState(INITIAL_CALENDAR);
  const [payments, setPayments] = useState(INITIAL_PAYMENTS);
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showAddInfraction, setShowAddInfraction] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [newInfraction, setNewInfraction] = useState({player:"",ruleId:"",customDetail:"",customAmount:"",matchLabel:""});
  const [newRule, setNewRule] = useState({name:"",amount:""});

  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false); 
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  // --- AUTH & ADMIN CHECK ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        console.log("Connecté avec l'UID :", u.uid);
        try {
          const userDoc = await getDoc(doc(db, "users", u.uid));
          if (userDoc.exists()) {
            const role = userDoc.data().role;
            console.log("Rôle trouvé dans Firestore :", role);
            setIsAdmin(role === "admin");
          } else {
            console.log("Document 'users/" + u.uid + "' introuvable dans Firestore !");
            setIsAdmin(false);
          }
        } catch(e) { 
          console.error("Erreur check admin :", e);
          setIsAdmin(false); 
        }
      } else { setIsAdmin(false); }
    });
    return () => unsub();
  }, []);

  const handleAuth = async () => {
    setAuthError("");
    try {
      if (authMode === "login") await signInWithEmailAndPassword(auth, authEmail, authPassword);
      else await createUserWithEmailAndPassword(auth, authEmail, authPassword);
    } catch(e) { setAuthError("Erreur : " + e.message); }
  };

  // --- FIREBASE SYNC ---
  useEffect(() => {
    const unsubRules = onSnapshot(collection(db, "rules"), s => !s.empty && setRules(s.docs.map(d => ({...d.data(), id: d.id}))));
    const unsubMatches = onSnapshot(collection(db, "matches"), s => !s.empty && setMatches(s.docs.map(d => ({...d.data(), fbId: d.id}))));
    const unsubPayments = onSnapshot(collection(db, "payments"), s => !s.empty && setPayments(s.docs.map(d => ({...d.data(), fbId: d.id}))));
    setLoading(false);
    return () => { unsubRules(); unsubMatches(); unsubPayments(); };
  }, []);

  const totalCaisse = useMemo(() => payments.reduce((s,p) => s+p.total, 0), [payments]);
  const playersList = useMemo(() => payments.map(p => p.player).sort(), [payments]);

  // --- ACTIONS ---
  const addInfraction = async () => {
    const rule = rules.find(r => String(r.id) === String(newInfraction.ruleId));
    const amount = rule ? rule.amount : 0;
    const detail = rule ? rule.name : "Inconnu";
    const match = matches[0]; // On simplifie pour le test
    
    if (match && newInfraction.player) {
      const newEntries = [...(match.entries || []), {player: newInfraction.player, amount, detail}];
      await updateDoc(doc(db, "matches", match.fbId || String(match.id)), {entries: newEntries});
      showToast("Amende ajoutée !");
      setShowAddInfraction(false);
    }
  };

  if (loading) return <div style={{textAlign:"center", padding:50}}>Chargement...</div>;

  if (!user) return (
    <div style={{padding:40, maxWidth:400, margin:"auto", textAlign:"center"}}>
        <h2>HBC LANGEAC</h2>
        <input type="email" placeholder="Email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} style={{width:'100%', marginBottom:10, padding:12, borderRadius:8, border:"1px solid #ccc"}}/>
        <input type="password" placeholder="Mot de passe" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} style={{width:'100%', marginBottom:10, padding:12, borderRadius:8, border:"1px solid #ccc"}}/>
        <button onClick={handleAuth} style={{padding:12, width:'100%', background:'#1565c0', color:'white', border:'none', borderRadius:8, fontWeight:"bold"}}>SE CONNECTER</button>
        {authError && <p style={{color:'red', fontSize:12}}>{authError}</p>}
    </div>
  );

  return (
    <div style={{background:"#f0f6ff", minHeight:"100vh", fontFamily:"sans-serif"}}>
      <div style={{background:"#1565c0", color:"white", padding:15}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <h1 style={{margin:0, fontSize:20}}>CAISSE NOIRE {isAdmin && "👑"}</h1>
            <button onClick={()=>signOut(auth)} style={{background:"rgba(255,255,255,0.2)", border:"none", padding:8, borderRadius:5, color:"white"}}>Déco</button>
        </div>
        <div style={{display:"flex", gap:10, marginTop:15, overflowX:"auto"}}>
            {["Dashboard","Paiements","Règles"].map(t => (
                <button key={t} onClick={()=>setActiveTab(t)} style={{background:activeTab===t?"#0d47a1":"transparent", color:"white", border:"none", padding:8, fontWeight:800, borderRadius:5}}>{t}</button>
            ))}
        </div>
      </div>

      <div style={{padding:15, maxWidth:800, margin:"auto"}}>
        {isAdmin && (
            <div style={{display:"flex", gap:10, marginBottom:20}}>
                <button onClick={()=>setShowAddInfraction(true)} style={{flex:1, padding:15, background:"#e53935", color:"white", border:"none", borderRadius:10, fontWeight:"bold"}}>+ AMENDE</button>
                <button onClick={()=>setShowAddRule(true)} style={{flex:1, padding:15, background:"#2e7d32", color:"white", border:"none", borderRadius:10, fontWeight:"bold"}}>+ RÈGLE</button>
            </div>
        )}

        {activeTab === "Dashboard" && (
            <div style={{background:"white", padding:20, borderRadius:15, boxShadow:"0 2px 10px rgba(0,0,0,0.05)"}}>
                <div style={{fontSize:12, color:"#78909c"}}>TOTAL CAISSE</div>
                <div style={{fontSize:32, fontWeight:"bold", color:"#1565c0"}}>{totalCaisse.toFixed(1)}€</div>
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

        {/* MODALE AJOUT AMENDE */}
        {showAddInfraction && (
            <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", padding:20, zIndex:1000, display:"flex", alignItems:"center"}}>
                <div style={{background:"white", padding:20, borderRadius:15, width:"100%"}}>
                    <h3>Nouvelle Amende</h3>
                    <select onChange={e=>setNewInfraction({...newInfraction, player:e.target.value})} style={{width:"100%", padding:12, marginBottom:10, borderRadius:8}}>
                        <option>Joueur...</option>
                        {playersList.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <select onChange={e=>setNewInfraction({...newInfraction, ruleId:e.target.value})} style={{width:"100%", padding:12, marginBottom:10, borderRadius:8}}>
                        <option>Règle...</option>
                        {rules.map(r => <option key={r.id} value={r.id}>{r.name} ({r.amount}€)</option>)}
                    </select>
                    <button onClick={addInfraction} style={{width:"100%", padding:12, background:"#e53935", color:"white", border:"none", borderRadius:8, fontWeight:"bold", marginBottom:10}}>VALIDER</button>
                    <button onClick={()=>setShowAddInfraction(false)} style={{width:"100%", background:"#eee", border:"none", padding:10, borderRadius:8}}>Annuler</button>
                </div>
            </div>
        )}

        {toast && <div style={{position:"fixed", bottom:20, left:20, right:20, background:"#333", color:"white", padding:12, borderRadius:10, textAlign:"center", fontWeight:"bold"}}>{toast}</div>}
      </div>
    </div>
  );
}
