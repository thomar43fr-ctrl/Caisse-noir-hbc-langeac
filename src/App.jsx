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

// --- HELPERS STATS ---
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

const NAV_ITEMS = ["Dashboard","Paiements","Joueurs","Règles","Calendrier","Stats"];

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
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  // --- AUTH & ADMIN CHECK ---
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

  // --- FIREBASE SYNC ---
  useEffect(() => {
    const unsubRules = onSnapshot(collection(db, "rules"), s => !s.empty && setRules(s.docs.map(d => ({...d.data(), id: d.id}))));
    const unsubMatches = onSnapshot(collection(db, "matches"), s => {
      if (!s.empty) {
        const m = s.docs.map(d => ({...d.data(), fbId: d.id}));
        setMatches(m.sort((a,b) => (b.sortKey||0)-(a.sortKey||0)));
      }
    });
    const unsubPayments = onSnapshot(collection(db, "payments"), s => !s.empty && setPayments(s.docs.map(d => ({...d.data(), fbId: d.id}))));
    const unsubCal = onSnapshot(collection(db, "calendar"), s => !s.empty && setCalendar(s.docs.map(d => ({...d.data(), fbId: d.id}))));
    setLoading(false);
    return () => { unsubRules(); unsubMatches(); unsubPayments(); unsubCal(); };
  }, []);

  // --- COMPUTED DATA ---
  const allEntries = useMemo(() => matches.flatMap(m => (m.entries||[]).map(e => ({...e, matchDate: m.date, matchLabel: m.match}))), [matches]);
  const playerStats = useMemo(() => {
    const stats = {};
    allEntries.forEach(e => {
      if(!stats[e.player]) stats[e.player] = {total:0, chaboula:0, count:0};
      stats[e.player].total += e.amount;
      if (e.detail && /chaboula/i.test(e.detail)) stats[e.player].chaboula++;
      if (e.amount > 0) stats[e.player].count++;
    });
    return stats;
  }, [allEntries]);

  const totalCaisse = useMemo(() => payments.reduce((s,p) => s+p.total, 0), [payments]);
  const sortedBadBoys = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].total - a[1].total).slice(0,5), [playerStats]);
  const sortedChaboula = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].chaboula - a[1].chaboula).slice(0,5), [playerStats]);

  // --- ACTIONS ---
  const addInfraction = async () => {
    const rule = rules.find(r => String(r.id) === String(newInfraction.ruleId));
    const amount = rule ? rule.amount : 0;
    const detail = rule ? rule.name : "Inconnu";
    const targetMatch = matches[0]; // Prend le dernier match par défaut
    
    if (targetMatch && newInfraction.player) {
      const newEntries = [...(targetMatch.entries || []), {player: newInfraction.player, amount, detail}];
      await updateDoc(doc(db, "matches", targetMatch.fbId), {entries: newEntries});
      showToast("Amende ajoutée avec succès !");
      setShowAddInfraction(false);
    }
  };

  const handleAuth = async () => {
    try { await signInWithEmailAndPassword(auth, authEmail, authPassword); }
    catch(e) { alert("Erreur de connexion"); }
  };

  if (loading) return <div style={{textAlign:"center", padding:50}}>Chargement du club...</div>;

  if (!user) return (
    <div style={{padding:40, maxWidth:400, margin:"100px auto", textAlign:"center", background:"white", borderRadius:20}}>
        <h2 style={{fontFamily:"Bebas Neue, sans-serif"}}>HBC LANGEAC</h2>
        <input type="email" placeholder="Email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} style={{width:'100%', marginBottom:10, padding:12, borderRadius:8, border:"1px solid #ccc"}}/>
        <input type="password" placeholder="Mot de passe" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} style={{width:'100%', marginBottom:10, padding:12, borderRadius:8, border:"1px solid #ccc"}}/>
        <button onClick={handleAuth} style={{padding:12, width:'100%', background:'#1565c0', color:'white', border:'none', borderRadius:8, fontWeight:"bold"}}>SE CONNECTER</button>
    </div>
  );

  return (
    <div style={{background:"#f0f6ff", minHeight:"100vh", fontFamily:"'Nunito', sans-serif"}}>
      {/* HEADER DYNAMIQUE */}
      <div style={{background:"linear-gradient(135deg,#1565c0,#0d47a1)", color:"white", padding:15, position:"sticky", top:0, zIndex:100}}>
        <div style={{maxWidth:1200, margin:"0 auto", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <h1 style={{margin:0, fontSize:22, fontFamily:"Bebas Neue"}}>HBC LANGEAC {isAdmin && "👑"}</h1>
            <button onClick={()=>signOut(auth)} style={{background:"rgba(255,255,255,0.2)", border:"none", padding:"8px 15px", borderRadius:8, color:"white", cursor:"pointer"}}>Déco</button>
        </div>
        <div style={{display:"flex", gap:10, marginTop:15, overflowX:"auto", maxWidth:1200, margin:"15px auto 0"}}>
            {NAV_ITEMS.map(t => (
                <button key={t} onClick={()=>setActiveTab(t)} style={{background:activeTab===t?"white":"transparent", color:activeTab===t?"#0d47a1":"white", border:"none", padding:"8px 15px", fontWeight:800, borderRadius:20, whiteSpace:"nowrap"}}>{t}</button>
            ))}
        </div>
      </div>

      <div style={{padding:15, maxWidth:1200, margin:"0 auto"}}>
        {/* BOUTONS ADMIN RAPIDES */}
        {isAdmin && (
            <div style={{display:"flex", gap:10, marginBottom:25}}>
                <button onClick={()=>setShowAddInfraction(true)} style={{flex:1, padding:18, background:"#ef5350", color:"white", border:"none", borderRadius:12, fontWeight:"bold", boxShadow:"0 4px 15px rgba(239,83,80,0.3)"}}>+ AMENDE</button>
                <button onClick={()=>setActiveTab("Règles")} style={{flex:1, padding:18, background:"#66bb6a", color:"white", border:"none", borderRadius:12, fontWeight:"bold", boxShadow:"0 4px 15px rgba(102,187,106,0.3)"}}>GÉRER RÈGLES</button>
            </div>
        )}

        {/* DASHBOARD COMPLET */}
        {activeTab === "Dashboard" && (
            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))", gap:20}}>
                <div style={{background:"white", padding:25, borderRadius:20, boxShadow:"0 5px 15px rgba(0,0,0,0.05)"}}>
                    <div style={{fontSize:14, color:"#78909c", fontWeight:700}}>TOTAL CAISSE</div>
                    <div style={{fontSize:40, fontWeight:900, color:"#1565c0"}}>{totalCaisse.toFixed(1)}€</div>
                </div>
                <div style={{background:"white", padding:25, borderRadius:20, boxShadow:"0 5px 15px rgba(0,0,0,0.05)"}}>
                    <div style={{fontSize:14, color:"#78909c", fontWeight:700}}>TOP MAUVAIS ÉLÈVE</div>
                    <div style={{fontSize:24, fontWeight:800}}>{sortedBadBoys[0]?.[0]} ({sortedBadBoys[0]?.[1].total}€)</div>
                </div>
                
                {/* CLASSEMENT LISTE */}
                <div style={{background:"white", padding:20, borderRadius:20}}>
                    <h3 style={{marginTop:0}}>Top Amendes</h3>
                    {sortedBadBoys.map(([name, s], i) => (
                        <div key={name} style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px solid #f0f0f0"}}>
                            <span>{i+1}. {name}</span>
                            <strong>{s.total}€</strong>
                        </div>
                    ))}
                </div>

                <div style={{background:"white", padding:20, borderRadius:20}}>
                    <h3 style={{marginTop:0}}>Classement Chaboulat</h3>
                    {sortedChaboula.map(([name, s], i) => (
                        <div key={name} style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px solid #f0f0f0"}}>
                            <span>{i+1}. {name}</span>
                            <strong style={{color:"#9c27b0"}}>{s.chaboula} 🍷</strong>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* LISTE DES MATCHS (en bas du dashboard) */}
        {activeTab === "Dashboard" && (
            <div style={{marginTop:30}}>
                <h3>Dernières récoltes</h3>
                <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(250px, 1fr))", gap:15}}>
                    {matches.slice(0, 6).map(m => (
                        <div key={m.fbId} style={{background:"white", padding:15, borderRadius:15}}>
                            <div style={{fontSize:12, color:"#1565c0", fontWeight:800}}>{m.date}</div>
                            <div style={{fontWeight:700}}>{m.match}</div>
                            <div style={{fontSize:18, fontWeight:900, marginTop:5}}>{(m.entries||[]).reduce((s,e)=>s+e.amount,0)}€</div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* MODALE AMENDE */}
        {showAddInfraction && (
            <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", padding:20, zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center"}}>
                <div style={{background:"white", padding:30, borderRadius:25, width:"100%", maxWidth:450}}>
                    <h2 style={{marginTop:0}}>Punir un joueur 💸</h2>
                    <label style={{display:"block", marginBottom:5, fontSize:12, fontWeight:700}}>JOUEUR</label>
                    <select onChange={e=>setNewInfraction({...newInfraction, player:e.target.value})} style={{width:"100%", padding:15, marginBottom:20, borderRadius:10, border:"2px solid #f0f0f0"}}>
                        <option>Sélectionner...</option>
                        {payments.map(p => <option key={p.player} value={p.player}>{p.player}</option>)}
                    </select>
                    
                    <label style={{display:"block", marginBottom:5, fontSize:12, fontWeight:700}}>MOTIF / RÈGLE</label>
                    <select onChange={e=>setNewInfraction({...newInfraction, ruleId:e.target.value})} style={{width:"100%", padding:15, marginBottom:25, borderRadius:10, border:"2px solid #f0f0f0"}}>
                        <option>Choisir la faute...</option>
                        {rules.map(r => <option key={r.id} value={r.id}>{r.name} ({r.amount}€)</option>)}
                    </select>
                    
                    <button onClick={addInfraction} style={{width:"100%", padding:15, background:"#1565c0", color:"white", border:"none", borderRadius:12, fontWeight:900, fontSize:16, marginBottom:10}}>VALIDER L'AMENDE</button>
                    <button onClick={()=>setShowAddInfraction(false)} style={{width:"100%", background:"#eee", border:"none", padding:12, borderRadius:12, color:"#666"}}>Annuler</button>
                </div>
            </div>
        )}

        {toast && <div style={{position:"fixed", bottom:30, left:"50%", transform:"translateX(-50%)", background:"#333", color:"white", padding:"12px 25px", borderRadius:30, fontWeight:800, zIndex:2000}}>{toast}</div>}
      </div>
    </div>
  );
}
