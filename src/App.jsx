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

const NAV_ITEMS = ["Dashboard", "Paiements", "Joueurs", "Règles", "Calendrier", "Stats"];

export default function App() {
  const [rules, setRules] = useState(INITIAL_RULES);
  const [matches, setMatches] = useState(HISTORICAL_MATCHES);
  const [calendar, setCalendar] = useState(INITIAL_CALENDAR);
  const [payments, setPayments] = useState(INITIAL_PAYMENTS);
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  
  // Auth & Admin
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // Modales Admin
  const [showAddInfraction, setShowAddInfraction] = useState(false);
  const [newInfraction, setNewInfraction] = useState({player:"", ruleId:""});

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  // --- LOGIQUE AUTH & ADMIN ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const userDoc = await getDoc(doc(db, "users", u.uid));
        setIsAdmin(userDoc.exists() && userDoc.data().role === "admin");
      } else {
        setIsAdmin(false);
      }
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

  // --- CALCULS STATS ---
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

  const handleAuth = async () => {
    setAuthError("");
    try {
      if (authMode === "login") {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        const res = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
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

  if (loading) return null;

  if (!user) return (
    <div style={{minHeight:"100vh", background:"#1565c0", display:"flex", alignItems:"center", justifyContent:"center", padding:20}}>
      <div style={{background:"white", padding:40, borderRadius:30, width:"100%", maxWidth:400, textAlign:"center", boxShadow:"0 20px 40px rgba(0,0,0,0.2)"}}>
        <h2 style={{margin:0, color:"#1565c0", fontSize:28, fontWeight:900}}>HBC LANGEAC</h2>
        <p style={{fontSize:14, color:"#666", marginBottom:30}}>{authMode === "login" ? "Connexion" : "Créer un compte"}</p>
        <input type="email" placeholder="Email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} style={{width:"100%", padding:15, marginBottom:10, borderRadius:15, border:"1px solid #eee", background:"#f9f9f9"}} />
        <input type="password" placeholder="Mot de passe" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} style={{width:"100%", padding:15, marginBottom:20, borderRadius:15, border:"1px solid #eee", background:"#f9f9f9"}} />
        {authError && <p style={{color:"red", fontSize:12, marginBottom:10}}>{authError}</p>}
        <button onClick={handleAuth} style={{width:"100%", padding:16, background:"#1565c0", color:"white", border:"none", borderRadius:15, fontWeight:800, fontSize:16}}>{authMode === "login" ? "SE CONNECTER" : "S'INSCRIRE"}</button>
        <p style={{marginTop:25, fontSize:14, color:"#1565c0", cursor:"pointer", fontWeight:700}} onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>
          {authMode === "login" ? "Nouveau ? Créer un compte" : "Déjà inscrit ? Connexion"}
        </p>
      </div>
    </div>
  );

  return (
    <div style={{background:"#f4f7fe", minHeight:"100vh", fontFamily:"'Inter', sans-serif"}}>
      {/* HEADER ORIGINAL */}
      <div style={{background:"#1c4da1", color:"white", padding:"25px 20px 0px"}}>
        <div style={{maxWidth:1200, margin:"0 auto", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div style={{display:"flex", alignItems:"center", gap:12}}>
            <div style={{background:"#ffb300", width:32, height:32, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center"}}>🏃</div>
            <h1 style={{margin:0, fontSize:20, fontWeight:800, letterSpacing:"-0.5px"}}>HBC LANGEAC {isAdmin && "👑"}</h1>
          </div>
          <button onClick={()=>signOut(auth)} style={{background:"rgba(255,255,255,0.15)", border:"none", padding:"8px 16px", borderRadius:12, color:"white", fontWeight:600, fontSize:13}}>Déco</button>
        </div>
        <div style={{display:"flex", gap:25, marginTop:30, maxWidth:1200, margin:"30px auto 0", overflowX:"auto", paddingBottom:15}}>
          {NAV_ITEMS.map(item => (
            <span key={item} onClick={()=>setActiveTab(item)} style={{cursor:"pointer", fontWeight:700, fontSize:14, opacity:activeTab===item?1:0.6, borderBottom:activeTab===item?"4px solid white":"4px solid transparent", paddingBottom:10, transition:"0.2s"}}>{item}</span>
          ))}
        </div>
      </div>

      <div style={{padding:25, maxWidth:1200, margin:"0 auto"}}>
        {isAdmin && (
          <div style={{display:"flex", gap:15, marginBottom:25}}>
            <button onClick={()=>setShowAddInfraction(true)} style={{flex:1, padding:18, background:"#ff5252", color:"white", border:"none", borderRadius:20, fontWeight:800, fontSize:15, boxShadow:"0 10px 20px rgba(255,82,82,0.2)"}}>+ AMENDE</button>
            <button onClick={()=>setActiveTab("Règles")} style={{flex:1, padding:18, background:"#4caf50", color:"white", border:"none", borderRadius:20, fontWeight:800, fontSize:15, boxShadow:"0 10px 20px rgba(76,175,80,0.2)"}}>+ RÈGLE</button>
          </div>
        )}

        {activeTab === "Dashboard" && (
          <>
            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))", gap:20, marginBottom:30}}>
              <div style={{background:"white", padding:25, borderRadius:25, boxShadow:"0 10px 30px rgba(0,0,0,0.03)"}}>
                <div style={{fontSize:28, fontWeight:900, color:"#1c4da1"}}>💰 {totalCaisse.toFixed(1)}€</div>
                <div style={{fontSize:12, color:"#a0aec0", fontWeight:700, marginTop:5}}>TOTAL CAISSE</div>
              </div>
              <div style={{background:"white", padding:25, borderRadius:25, boxShadow:"0 10px 30px rgba(0,0,0,0.03)"}}>
                <div style={{fontSize:28, fontWeight:900, color:"#1c4da1"}}>🏆 {matches.length}</div>
                <div style={{fontSize:12, color:"#a0aec0", fontWeight:700, marginTop:5}}>MATCHS</div>
              </div>
              <div style={{background:"white", padding:25, borderRadius:25, boxShadow:"0 10px 30px rgba(0,0,0,0.03)"}}>
                <div style={{fontSize:28, fontWeight:900, color:"#1c4da1"}}>👥 {payments.length}</div>
                <div style={{fontSize:12, color:"#a0aec0", fontWeight:700, marginTop:5}}>JOUEURS</div>
              </div>
            </div>

            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))", gap:25}}>
              <div style={{background:"white", padding:25, borderRadius:30, boxShadow:"0 10px 30px rgba(0,0,0,0.03)"}}>
                <h3 style={{marginTop:0, fontSize:17, fontWeight:800, color:"#1c4da1", marginBottom:20}}>🥇 TOP MAUVAIS ÉLÈVES</h3>
                {topBadBoys.map(([n, s], i) => (
                  <div key={n} style={{display:"flex", justifyContent:"space-between", padding:"15px 0", borderBottom:"1px solid #f7fafc"}}>
                    <span style={{fontWeight:600}}><span style={{color:"#cbd5e0", marginRight:12}}>{i+1}</span>{n}</span>
                    <span style={{fontWeight:800, color:"#1c4da1"}}>{s.total}€</span>
                  </div>
                ))}
              </div>
              <div style={{background:"white", padding:25, borderRadius:30, boxShadow:"0 10px 30px rgba(0,0,0,0.03)"}}>
                <h3 style={{marginTop:0, fontSize:17, fontWeight:800, color:"#1c4da1", marginBottom:20}}>😈 CLASSEMENT CHABOULAT</h3>
                {topChaboula.map(([n, s], i) => (
                  <div key={n} style={{display:"flex", justifyContent:"space-between", padding:"15px 0", borderBottom:"1px solid #f7fafc"}}>
                    <span style={{fontWeight:600}}><span style={{color:"#cbd5e0", marginRight:12}}>{i+1}</span>{n}</span>
                    <span style={{fontWeight:800, color:"#9f7aea"}}>{s.chaboula}×</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div style={{marginTop:40}}>
              <h3 style={{fontSize:18, fontWeight:800, color:"#1c4da1", marginBottom:20}}>🗓️ MATCHS (DU PLUS RÉCENT)</h3>
              <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))", gap:15}}>
                {matches.map(m => (
                  <div key={m.fbId} style={{background:"white", padding:20, borderRadius:20, border:"1px solid #edf2f7"}}>
                    <div style={{fontSize:11, fontWeight:800, color:"#3182ce", marginBottom:5}}>{m.date}</div>
                    <div style={{fontSize:14, fontWeight:700, color:"#2d3748"}}>{m.match}</div>
                    <div style={{fontSize:20, fontWeight:900, marginTop:10, color:"#1c4da1"}}>{(m.entries||[]).reduce((s,e)=>s+e.amount,0)}€</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === "Paiements" && (
          <div style={{background:"white", borderRadius:30, padding:10, boxShadow:"0 10px 30px rgba(0,0,0,0.03)"}}>
            {payments.sort((a,b)=>b.total-a.total).map(p => (
              <div key={p.player} style={{padding:20, borderBottom:"1px solid #f7fafc", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                <span style={{fontWeight:700, fontSize:16}}>{p.player}</span>
                <span style={{fontWeight:900, color:p.paid >= p.total ? "#48bb78" : "#f56565", fontSize:18}}>{p.total}€</span>
              </div>
            ))}
          </div>
        )}

        {showAddInfraction && (
          <div style={{position:"fixed", inset:0, background:"rgba(26, 32, 44, 0.8)", backdropFilter:"blur(4px)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20}}>
            <div style={{background:"white", padding:35, borderRadius:30, width:"100%", maxWidth:400, boxShadow:"0 25px 50px rgba(0,0,0,0.2)"}}>
              <h2 style={{marginTop:0, fontSize:22, fontWeight:800, color:"#1c4da1"}}>Nouvelle amende 💸</h2>
              <select onChange={e=>setNewInfraction({...newInfraction, player:e.target.value})} style={{width:"100%", padding:15, marginBottom:12, borderRadius:15, border:"1px solid #e2e8f0", fontSize:15, appearance:"none"}}>
                <option>Joueur...</option>
                {payments.map(p => <option key={p.player} value={p.player}>{p.player}</option>)}
              </select>
              <select onChange={e=>setNewInfraction({...newInfraction, ruleId:e.target.value})} style={{width:"100%", padding:15, marginBottom:25, borderRadius:15, border:"1px solid #e2e8f0", fontSize:15, appearance:"none"}}>
                <option>Règle...</option>
                {rules.map(r => <option key={r.id} value={r.id}>{r.name} ({r.amount}€)</option>)}
              </select>
              <button onClick={addInfraction} style={{width:"100%", padding:16, background:"#1c4da1", color:"white", border:"none", borderRadius:15, fontWeight:800, fontSize:16}}>VALIDER</button>
              <button onClick={()=>setShowAddInfraction(false)} style={{width:"100%", padding:12, marginTop:10, background:"none", border:"none", color:"#a0aec0", fontWeight:700}}>Annuler</button>
            </div>
          </div>
        )}
      </div>

      {toast && <div style={{position:"fixed", bottom:30, left:"50%", transform:"translateX(-50%)", background:"#2d3748", color:"white", padding:"12px 24px", borderRadius:20, fontSize:14, fontWeight:700, boxShadow:"0 10px 25px rgba(0,0,0,0.1)"}}>{toast}</div>}
    </div>
  );
}
