import { useState, useMemo, useEffect } from "react";
import { db, auth } from "./firebase";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, getDoc
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
  
  // Auth states
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // Modale Admin
  const [showAddInfraction, setShowAddInfraction] = useState(false);
  const [newInfraction, setNewInfraction] = useState({player:"", ruleId:""});

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  // --- LOGIQUE ADMIN ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const userDoc = await getDoc(doc(db, "users", u.uid));
          setIsAdmin(userDoc.exists() && userDoc.data().role === "admin");
        } catch(e) { console.error(e); setIsAdmin(false); }
      } else { setIsAdmin(false); }
    });
    return () => unsub();
  }, []);

  // --- SYNC FIREBASE ---
  useEffect(() => {
    const unsubRules = onSnapshot(collection(db, "rules"), s => !s.empty && setRules(s.docs.map(d => ({...d.data(), id: d.id}))));
    const unsubMatches = onSnapshot(collection(db, "matches"), s => {
      if (!s.empty) setMatches(s.docs.map(d => ({...d.data(), fbId: d.id})).sort((a,b) => (b.sortKey||0)-(a.sortKey||0)));
    });
    const unsubPayments = onSnapshot(collection(db, "payments"), s => !s.empty && setPayments(s.docs.map(d => ({...d.data(), fbId: d.id}))));
    setLoading(false);
    return () => { unsubRules(); unsubMatches(); unsubPayments(); };
  }, []);

  // --- CALCULS STATS (Design d'origine) ---
  const allEntries = useMemo(() => matches.flatMap(m => (m.entries||[]).map(e => ({...e, mLabel: m.match}))), [matches]);
  const playerStats = useMemo(() => {
    const s = {};
    allEntries.forEach(e => {
      if(!s[e.player]) s[e.player] = {total:0, chaboula:0};
      s[e.player].total += e.amount;
      if(/chaboula/i.test(e.detail)) s[e.player].chaboula++;
    });
    return s;
  }, [allEntries]);

  const totalCaisse = useMemo(() => payments.reduce((s,p) => s+p.total, 0), [payments]);
  const topBadBoys = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].total - a[1].total).slice(0,5), [playerStats]);
  const topChaboula = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].chaboula - a[1].chaboula).slice(0,5), [playerStats]);

  // --- FONCTIONS AUTH ---
  const handleAuth = async () => {
    setAuthError("");
    try {
      if (authMode === "login") {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        const res = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        // Par défaut, un nouvel inscrit n'est pas admin
        await setDoc(doc(db, "users", res.user.uid), { email: authEmail, role: "player" });
      }
    } catch(e) { setAuthError("Erreur : " + e.message); }
  };

  const addInfraction = async () => {
    const rule = rules.find(r => String(r.id) === String(newInfraction.ruleId));
    if (!rule || !newInfraction.player || !matches[0]) return;
    const newEntries = [...(matches[0].entries||[]), {player: newInfraction.player, amount: rule.amount, detail: rule.name}];
    await updateDoc(doc(db, "matches", matches[0].fbId), {entries: newEntries});
    showToast("Amende enregistrée ! 💸");
    setShowAddInfraction(false);
  };

  if (loading) return <div style={{textAlign:"center", marginTop:100}}>Chargement...</div>;

  // --- ÉCRAN DE CONNEXION / CRÉATION (RESTAURÉ) ---
  if (!user) return (
    <div style={{minHeight:"100vh", background:"#1565c0", display:"flex", alignItems:"center", justifyContent:"center", padding:20}}>
      <div style={{background:"white", padding:30, borderRadius:20, width:"100%", maxWidth:400, textAlign:"center"}}>
        <h2 style={{margin:0, color:"#1565c0"}}>HBC LANGEAC</h2>
        <p style={{fontSize:14, color:"#666", marginBottom:25}}>{authMode === "login" ? "Connexion à la Caisse Noire" : "Créer un compte joueur"}</p>
        
        <input type="email" placeholder="Email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} style={{width:"100%", padding:12, marginBottom:10, borderRadius:10, border:"1px solid #ddd"}} />
        <input type="password" placeholder="Mot de passe" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} style={{width:"100%", padding:12, marginBottom:15, borderRadius:10, border:"1px solid #ddd"}} />
        
        {authError && <p style={{color:"red", fontSize:12, marginBottom:10}}>{authError}</p>}
        
        <button onClick={handleAuth} style={{width:"100%", padding:14, background:"#1565c0", color:"white", border:"none", borderRadius:10, fontWeight:800, cursor:"pointer"}}>
          {authMode === "login" ? "SE CONNECTER" : "CRÉER MON COMPTE"}
        </button>
        
        <p style={{marginTop:20, fontSize:13, color:"#1565c0", cursor:"pointer", fontWeight:700}} onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>
          {authMode === "login" ? "Pas encore de compte ? S'inscrire" : "Déjà un compte ? Se connecter"}
        </p>
      </div>
    </div>
  );

  return (
    <div style={{background:"#f0f6ff", minHeight:"100vh", fontFamily:"sans-serif"}}>
      {/* HEADER D'ORIGINE */}
      <div style={{background:"#1565c0", color:"white", padding:"20px 20px 10px"}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", maxWidth:1200, margin:"0 auto"}}>
          <div style={{display:"flex", alignItems:"center", gap:10}}>
            <div style={{background:"white", color:"#1565c0", width:35, height:35, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:"bold"}}>🤾</div>
            <h1 style={{margin:0, fontSize:18}}>HBC LANGEAC {isAdmin && "👑"}</h1>
          </div>
          <button onClick={()=>signOut(auth)} style={{background:"rgba(255,255,255,0.2)", border:"none", padding:"6px 12px", borderRadius:6, color:"white", cursor:"pointer"}}>Déco</button>
        </div>
        
        <div style={{display:"flex", gap:20, marginTop:25, maxWidth:1200, margin:"25px auto 0", overflowX:"auto", paddingBottom:10}}>
          {NAV_ITEMS.map(item => (
            <span key={item} onClick={()=>setActiveTab(item)} style={{cursor:"pointer", fontWeight:700, fontSize:13, opacity:activeTab===item?1:0.7, borderBottom:activeTab===item?"3px solid white":"none", paddingBottom:5}}>{item}</span>
          ))}
        </div>
      </div>

      <div style={{padding:20, maxWidth:1200, margin:"0 auto"}}>
        {/* BOUTONS ADMIN (uniquement si isAdmin) */}
        {isAdmin && (
          <div style={{display:"flex", gap:10, marginBottom:20}}>
            <button onClick={()=>setShowAddInfraction(true)} style={{flex:1, padding:15, background:"#ef5350", color:"white", border:"none", borderRadius:12, fontWeight:800}}>+ AMENDE</button>
            <button onClick={()=>setActiveTab("Règles")} style={{flex:1, padding:15, background:"#4caf50", color:"white", border:"none", borderRadius:12, fontWeight:800}}>+ RÈGLE</button>
          </div>
        )}

        {/* DASHBOARD - DESIGN EXACT IMAGE 1 */}
        {activeTab === "Dashboard" && (
          <>
            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:20, marginBottom:30}}>
              <div style={{background:"white", padding:20, borderRadius:20, boxShadow:"0 4px 12px rgba(0,0,0,0.05)"}}>
                <div style={{fontSize:24, fontWeight:900, color:"#1565c0"}}>{totalCaisse.toFixed(1)}€</div>
                <div style={{fontSize:11, color:"#999", fontWeight:700}}>TOTAL CAISSE</div>
              </div>
              <div style={{background:"white", padding:20, borderRadius:20, boxShadow:"0 4px 12px rgba(0,0,0,0.05)"}}>
                <div style={{fontSize:24, fontWeight:900, color:"#1565c0"}}>{matches.length}</div>
                <div style={{fontSize:11, color:"#999", fontWeight:700}}>MATCHS</div>
              </div>
              <div style={{background:"white", padding:20, borderRadius:20, boxShadow:"0 4px 12px rgba(0,0,0,0.05)"}}>
                <div style={{fontSize:24, fontWeight:900, color:"#1565c0"}}>{payments.length}</div>
                <div style={{fontSize:11, color:"#999", fontWeight:700}}>JOUEURS</div>
              </div>
            </div>

            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))", gap:25}}>
              <div style={{background:"white", padding:20, borderRadius:20}}>
                <h3 style={{marginTop:0, fontSize:16, color:"#1565c0"}}>🏆 TOP MAUVAIS ÉLÈVES</h3>
                {topBadBoys.map(([n, s], i) => (
                  <div key={n} style={{display:"flex", justifyContent:"space-between", padding:"12px 0", borderBottom:"1px solid #f5f5f5"}}>
                    <span><span style={{color:"#ffb300", fontWeight:900, marginRight:10}}>{i+1}</span>{n}</span>
                    <span style={{fontWeight:800}}>{s.total}€</span>
                  </div>
                ))}
              </div>
              <div style={{background:"white", padding:20, borderRadius:20}}>
                <h3 style={{marginTop:0, fontSize:16, color:"#1565c0"}}>😈 CLASSEMENT CHABOULAT</h3>
                {topChaboula.map(([n, s], i) => (
                  <div key={n} style={{display:"flex", justifyContent:"space-between", padding:"12px 0", borderBottom:"1px solid #f5f5f5"}}>
                    <span><span style={{color:"#9c27b0", fontWeight:900, marginRight:10}}>{i+1}</span>{n}</span>
                    <span style={{fontWeight:800}}>{s.chaboula}×</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* AUTRES ONGLETS (Design épuré) */}
        {activeTab === "Paiements" && (
           <div style={{background:"white", borderRadius:20}}>
             {payments.map(p => (
               <div key={p.player} style={{padding:20, borderBottom:"1px solid #eee", display:"flex", justifyContent:"space-between"}}>
                 <span style={{fontWeight:700}}>{p.player}</span>
                 <span style={{fontWeight:900, color:p.paid >= p.total ? "green" : "red"}}>{p.total}€</span>
               </div>
             ))}
           </div>
        )}

        {/* MODALE ADMIN (RESTAURÉE) */}
        {showAddInfraction && (
          <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20}}>
            <div style={{background:"white", padding:25, borderRadius:20, width:"100%", maxWidth:400}}>
              <h3>Nouvelle amende</h3>
              <select onChange={e=>setNewInfraction({...newInfraction, player:e.target.value})} style={{width:"100%", padding:12, marginBottom:10, borderRadius:10}}>
                <option>Joueur...</option>
                {payments.map(p => <option key={p.player} value={p.player}>{p.player}</option>)}
              </select>
              <select onChange={e=>setNewInfraction({...newInfraction, ruleId:e.target.value})} style={{width:"100%", padding:12, marginBottom:20, borderRadius:10}}>
                <option>Règle...</option>
                {rules.map(r => <option key={r.id} value={r.id}>{r.name} ({r.amount}€)</option>)}
              </select>
              <button onClick={addInfraction} style={{width:"100%", padding:14, background:"#1565c0", color:"white", border:"none", borderRadius:10, fontWeight:800}}>VALIDER</button>
              <button onClick={()=>setShowAddInfraction(false)} style={{width:"100%", padding:10, marginTop:10, background:"none", border:"none", color:"#999"}}>Annuler</button>
            </div>
          </div>
        )}
      </div>

      {toast && <div style={{position:"fixed", bottom:20, left:"50%", transform:"translateX(-50%)", background:"#333", color:"white", padding:"10px 20px", borderRadius:30, fontSize:14, fontWeight:700}}>{toast}</div>}
    </div>
  );
}

const NAV_ITEMS = ["Dashboard", "Paiements", "Joueurs", "Règles", "Calendrier", "Stats"];
