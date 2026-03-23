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

// --- LOGIQUE DE STATS AVANCÉE (RESTAURÉE) ---
function getPlayerInfractionStats(entries) {
  const counts = {};
  entries.forEach(e => {
    if (!e.detail || e.detail === "Rien" || e.amount === 0) return;
    const d = e.detail.toLowerCase();
    [
      {key:"mitraillette",label:"Mitraillette"},{key:"sortie veille",label:"Sortie veille"},
      {key:"chaboula",label:"Chaboulat"},{key:"penalty raté",label:"Penalty raté"},
      {key:"contre-attaque ratée",label:"Contre-attaque ratée"},{key:"relance ratée",label:"Relance ratée"},
      {key:"tir fantaisie raté",label:"Tir fantaisie raté"},{key:"vomi",label:"Vomi en soirée"},
      {key:"retard",label:"Retard"},{key:"carton rouge",label:"Carton rouge"},
      {key:"défaite",label:"Défaite collective"},{key:"fantôme",label:"Fantôme"},
    ].forEach(({key,label}) => {
      if (d.includes(key)) counts[label] = (counts[label]||0)+1;
    });
  });
  return Object.entries(counts).filter(([,v])=>v>=2).sort((a,b)=>b[1]-a[1]);
}

const NAV_ITEMS = ["Dashboard", "Paiements", "Joueurs", "Règles", "Calendrier", "Stats"];

export default function App() {
  const [rules, setRules] = useState(INITIAL_RULES);
  const [matches, setMatches] = useState(HISTORICAL_MATCHES);
  const [calendar, setCalendar] = useState(INITIAL_CALENDAR);
  const [payments, setPayments] = useState(INITIAL_PAYMENTS);
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  
  // States Modales
  const [showAddInfraction, setShowAddInfraction] = useState(false);
  const [newInfraction, setNewInfraction] = useState({player:"", ruleId:"", matchLabel:""});
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  // --- AUTH & ADMIN CHECK (CORRIGÉ) ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const userDoc = await getDoc(doc(db, "users", u.uid));
        setIsAdmin(userDoc.exists() && userDoc.data().role === "admin");
      } else { setIsAdmin(false); }
    });
    return () => unsub();
  }, []);

  // --- SYNC FIREBASE (RESTAURÉ) ---
  useEffect(() => {
    const unsubRules = onSnapshot(collection(db, "rules"), s => !s.empty && setRules(s.docs.map(d => ({...d.data(), id: d.id}))));
    const unsubMatches = onSnapshot(collection(db, "matches"), s => {
      if (!s.empty) setMatches(s.docs.map(d => ({...d.data(), fbId: d.id})).sort((a,b) => (b.sortKey||0)-(a.sortKey||0)));
    });
    const unsubPayments = onSnapshot(collection(db, "payments"), s => !s.empty && setPayments(s.docs.map(d => ({...d.data(), fbId: d.id}))));
    const unsubCal = onSnapshot(collection(db, "calendar"), s => !s.empty && setCalendar(s.docs.map(d => ({...d.data(), fbId: d.id}))));
    setLoading(false);
    return () => { unsubRules(); unsubMatches(); unsubPayments(); unsubCal(); };
  }, []);

  // --- CALCULS DES STATS (RESTAURÉS) ---
  const allEntries = useMemo(() => matches.flatMap(m => (m.entries||[]).map(e => ({...e, mDate: m.date, mLabel: m.match}))), [matches]);
  const playerStats = useMemo(() => {
    const s = {};
    allEntries.forEach(e => {
      if(!s[e.player]) s[e.player] = {total:0, chaboula:0, entries:[]};
      s[e.player].total += e.amount;
      if(/chaboula/i.test(e.detail)) s[e.player].chaboula++;
      s[e.player].entries.push(e);
    });
    return s;
  }, [allEntries]);

  const totalCaisse = useMemo(() => payments.reduce((s,p) => s+p.total, 0), [payments]);
  const topBadBoys = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].total - a[1].total).slice(0,5), [playerStats]);
  const topChaboula = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].chaboula - a[1].chaboula).slice(0,5), [playerStats]);

  // --- ACTIONS ---
  const handleAddInfraction = async () => {
    const rule = rules.find(r => String(r.id) === String(newInfraction.ruleId));
    if (!rule || !newInfraction.player) return;
    const target = matches[0]; // Dernier match
    const newEntries = [...(target.entries||[]), {player: newInfraction.player, amount: rule.amount, detail: rule.name}];
    await updateDoc(doc(db, "matches", target.fbId), {entries: newEntries});
    showToast("Amende ajoutée ! 💸");
    setShowAddInfraction(false);
  };

  if (loading) return <div style={{height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#f0f6ff", fontFamily:"'Bebas Neue'"}}>CHARGEMENT...</div>;

  if (!user) return (
    <div style={{height:"100vh", background:"linear-gradient(135deg,#1565c0,#0d47a1)", display:"flex", alignItems:"center", justifyContent:"center", padding:20}}>
      <div style={{background:"white", padding:30, borderRadius:20, width:"100%", maxWidth:380, textAlign:"center", boxShadow:"0 10px 40px rgba(0,0,0,0.3)"}}>
        <h2 style={{fontFamily:"'Bebas Neue'", color:"#0d47a1", fontSize:28}}>HBC LANGEAC</h2>
        <input type="email" placeholder="Email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} style={{width:"100%", padding:12, marginBottom:10, borderRadius:10, border:"1px solid #ddd"}} />
        <input type="password" placeholder="Mot de passe" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} style={{width:"100%", padding:12, marginBottom:20, borderRadius:10, border:"1px solid #ddd"}} />
        <button onClick={() => signInWithEmailAndPassword(auth, authEmail, authPassword)} style={{width:"100%", padding:14, background:"#1565c0", color:"white", border:"none", borderRadius:10, fontWeight:800}}>SE CONNECTER</button>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh", background:"#f0f6ff", fontFamily:"'Nunito', sans-serif"}}>
      {/* HEADER PREMIUM */}
      <div style={{background:"linear-gradient(135deg,#1565c0,#0d47a1)", color:"white", padding:"15px 20px", position:"sticky", top:0, zIndex:100, boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}}>
        <div style={{maxWidth:1200, margin:"0 auto", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div style={{fontFamily:"'Bebas Neue'", fontSize:24, letterSpacing:1}}>HBC LANGEAC {isAdmin && "👑"}</div>
          <button onClick={()=>signOut(auth)} style={{background:"rgba(255,255,255,0.2)", border:"none", padding:"8px 16px", borderRadius:10, color:"white", fontWeight:700}}>Déco</button>
        </div>
        <div style={{display:"flex", gap:10, marginTop:15, overflowX:"auto", maxWidth:1200, margin:"15px auto 0"}}>
          {NAV_ITEMS.map(t => (
            <button key={t} onClick={()=>setActiveTab(t)} style={{background:activeTab===t?"white":"transparent", color:activeTab===t?"#0d47a1":"white", border:"none", padding:"10px 20px", fontWeight:800, borderRadius:12, whiteSpace:"nowrap", transition:"0.3s"}}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{padding:20, maxWidth:1200, margin:"0 auto"}}>
        {/* BOUTONS ADMIN DESIGN */}
        {isAdmin && (
          <div style={{display:"flex", gap:15, marginBottom:30}}>
            <button onClick={()=>setShowAddInfraction(true)} style={{flex:1, padding:20, background:"#ef5350", color:"white", border:"none", borderRadius:15, fontWeight:900, fontSize:16, boxShadow:"0 6px 20px rgba(239,83,80,0.3)"}}>+ AMENDE</button>
            <button onClick={()=>setActiveTab("Règles")} style={{flex:1, padding:20, background:"#66bb6a", color:"white", border:"none", borderRadius:15, fontWeight:900, fontSize:16, boxShadow:"0 6px 20px rgba(102,187,106,0.3)"}}>GÉRER RÈGLES</button>
          </div>
        )}

        {/* DASHBOARD (RESTAURÉ AVEC CARTES) */}
        {activeTab === "Dashboard" && (
          <>
            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))", gap:20, marginBottom:30}}>
              <div style={{background:"white", padding:25, borderRadius:20, boxShadow:"0 4px 15px rgba(0,0,0,0.05)"}}>
                <div style={{fontSize:12, color:"#78909c", fontWeight:800, textTransform:"uppercase"}}>Total Caisse</div>
                <div style={{fontSize:42, fontWeight:900, color:"#1565c0"}}>{totalCaisse.toFixed(1)}€</div>
              </div>
              <div style={{background:"white", padding:25, borderRadius:20, boxShadow:"0 4px 15px rgba(0,0,0,0.05)"}}>
                <div style={{fontSize:12, color:"#78909c", fontWeight:800, textTransform:"uppercase"}}>Top Sanctionné</div>
                <div style={{fontSize:24, fontWeight:800, marginTop:5}}>{topBadBoys[0]?.[0] || "Aucun"}</div>
              </div>
            </div>

            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(400px, 1fr))", gap:25}}>
               <div style={{background:"white", padding:20, borderRadius:20}}>
                  <h3 style={{fontFamily:"'Bebas Neue'", color:"#0d47a1"}}>🏆 Top Mauvais Élèves</h3>
                  {topBadBoys.map(([name, data], i) => (
                    <div key={name} style={{display:"flex", justifyContent:"space-between", padding:"12px 0", borderBottom:"1px solid #f5f5f5"}}>
                      <span><strong>{i+1}.</strong> {name}</span>
                      <span style={{fontWeight:900, color:"#ef5350"}}>{data.total}€</span>
                    </div>
                  ))}
               </div>
               <div style={{background:"white", padding:20, borderRadius:20}}>
                  <h3 style={{fontFamily:"'Bebas Neue'", color:"#9c27b0"}}>🍷 Classement Chaboulat</h3>
                  {topChaboula.map(([name, data], i) => (
                    <div key={name} style={{display:"flex", justifyContent:"space-between", padding:"12px 0", borderBottom:"1px solid #f5f5f5"}}>
                      <span><strong>{i+1}.</strong> {name}</span>
                      <span style={{fontWeight:900, color:"#9c27b0"}}>{data.chaboula} ×</span>
                    </div>
                  ))}
               </div>
            </div>
          </>
        )}

        {/* PAIEMENTS (RESTAURÉ) */}
        {activeTab === "Paiements" && (
          <div style={{background:"white", borderRadius:20, overflow:"hidden"}}>
            {payments.sort((a,b)=>b.total-a.total).map(p => (
              <div key={p.player} style={{padding:20, borderBottom:"1px solid #f0f0f0", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:800, fontSize:18}}>{p.player}</div>
                  <div style={{fontSize:12, color:"#90a4ae"}}>Total dû : {p.total}€</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:20, fontWeight:900, color:p.paid >= p.total ? "#4caf50" : "#ef5350"}}>{p.paid}€</div>
                  <div style={{fontSize:10, fontWeight:800}}>{p.paid >= p.total ? "RÉGLÉ ✅" : "À PAYER ❌"}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* RÈGLES (RESTAURÉ) */}
        {activeTab === "Règles" && (
          <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(300px, 1fr))", gap:15}}>
            {rules.map(r => (
              <div key={r.id} style={{background:"white", padding:20, borderRadius:15, display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 4px 10px rgba(0,0,0,0.03)"}}>
                <span style={{fontWeight:700}}>{r.name}</span>
                <span style={{background:"#e3f2fd", color:"#1565c0", padding:"5px 12px", borderRadius:10, fontWeight:900}}>{r.amount}€</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MODALE AMENDE (RESTAURÉE) */}
      {showAddInfraction && (
        <div style={{position:"fixed", inset:0, background:"rgba(13, 71, 161, 0.8)", backdropFilter:"blur(5px)", padding:20, zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center"}}>
          <div style={{background:"white", padding:30, borderRadius:25, width:"100%", maxWidth:450, boxShadow:"0 20px 60px rgba(0,0,0,0.4)"}}>
            <h2 style={{fontFamily:"'Bebas Neue'", fontSize:28, marginBottom:20}}>Sanctionner 💸</h2>
            <select onChange={e=>setNewInfraction({...newInfraction, player:e.target.value})} style={{width:"100%", padding:15, marginBottom:15, borderRadius:12, border:"2px solid #eee", fontSize:16}}>
              <option>Choisir le coupable...</option>
              {payments.map(p => <option key={p.player} value={p.player}>{p.player}</option>)}
            </select>
            <select onChange={e=>setNewInfraction({...newInfraction, ruleId:e.target.value})} style={{width:"100%", padding:15, marginBottom:25, borderRadius:12, border:"2px solid #eee", fontSize:16}}>
              <option>Choisir la faute...</option>
              {rules.map(r => <option key={r.id} value={r.id}>{r.name} ({r.amount}€)</option>)}
            </select>
            <button onClick={handleAddInfraction} style={{width:"100%", padding:16, background:"#1565c0", color:"white", border:"none", borderRadius:12, fontWeight:900, fontSize:18, marginBottom:10}}>VALIDER</button>
            <button onClick={()=>setShowAddInfraction(false)} style={{width:"100%", padding:10, background:"none", border:"none", color:"#90a4ae", fontWeight:700}}>Annuler</button>
          </div>
        </div>
      )}

      {toast && <div style={{position:"fixed", bottom:40, left:"50%", transform:"translateX(-50%)", background:"#333", color:"white", padding:"15px 30px", borderRadius:40, fontWeight:800, boxShadow:"0 10px 30px rgba(0,0,0,0.2)", zIndex:2000}}>{toast}</div>}
    </div>
  );
}
