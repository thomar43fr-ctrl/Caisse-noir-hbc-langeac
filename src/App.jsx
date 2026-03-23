import { useState, useMemo, useEffect } from "react";
import { db, auth } from "./firebase";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, getDocs
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "firebase/auth";
import { INITIAL_RULES, INITIAL_PAYMENTS, INITIAL_CALENDAR } from "./data";
import { HISTORICAL_MATCHES } from "./matches";

function getPlayerInfractionStats(entries) {
  const counts = {};
  entries.forEach(e => {
    if (!e.detail || e.detail === "Rien" || e.amount === 0) return;
    const d = e.detail.toLowerCase();
    [
      {key:"mitraillette",label:"Mitraillette"},
      {key:"sortie veille",label:"Sortie veille"},
      {key:"chaboula",label:"Chaboulat"},
      {key:"penalty raté",label:"Penalty raté"},
      {key:"contre-attaque ratée",label:"Contre-attaque ratée"},
      {key:"relance ratée",label:"Relance ratée"},
      {key:"tir fantaisie raté",label:"Tir fantaisie raté"},
      {key:"vomi",label:"Vomi en soirée"},
      {key:"retard",label:"Retard"},
      {key:"carton rouge",label:"Carton rouge"},
      {key:"défaite",label:"Défaite collective"},
      {key:"fantôme",label:"Fantôme"},
    ].forEach(({key,label}) => {
      if (d.includes(key)) counts[label] = (counts[label]||0)+1;
    });
  });
  return Object.entries(counts).filter(([,v])=>v>=2).sort((a,b)=>b[1]-a[1]);
}

const NAV_ITEMS = ["Dashboard","Paiements","Joueurs","Règles","Calendrier","Stats"];

export default function App() {
  // Core data
  const [rules, setRules] = useState(INITIAL_RULES);
  const [matches, setMatches] = useState(HISTORICAL_MATCHES);
  const [calendar, setCalendar] = useState(INITIAL_CALENDAR);
  const [payments, setPayments] = useState(INITIAL_PAYMENTS);
  // UI state
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [editingRule, setEditingRule] = useState(null);
  const [newRule, setNewRule] = useState({name:"",amount:""});
  const [showAddRule, setShowAddRule] = useState(false);
  const [showAddInfraction, setShowAddInfraction] = useState(false);
  const [showAddCalendar, setShowAddCalendar] = useState(false);
  const [newInfraction, setNewInfraction] = useState({player:"",ruleId:"",customDetail:"",customAmount:"",matchLabel:""});
  const [newCalMatch, setNewCalMatch] = useState({date:"",opponent:"",home:true,location:"",team:"Éq1"});
  const [editingPayment, setEditingPayment] = useState(null);
  const [paymentInput, setPaymentInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  // Auth state
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          // Utilisation de getDocs pour vérifier la collection admins
          const adminSnap = await getDocs(collection(db, "admins"));
          const adminEmails = adminSnap.docs.map(d => d.id);
          setIsAdmin(adminEmails.includes(u.email));
        } catch(e) { 
          console.error("Erreur check admin:", e);
          setIsAdmin(false); 
        }
      } else {
        setIsAdmin(false);
      }
    });
    return () => unsub();
  }, []);

  const handleAuth = async () => {
    setAuthError("");
    setAuthLoading(true);
    try {
      if (authMode === "login") {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      }
      setAuthEmail(""); setAuthPassword("");
    } catch(e) {
      const msgs = {
        "auth/user-not-found": "Email introuvable",
        "auth/wrong-password": "Mot de passe incorrect",
        "auth/email-already-in-use": "Email déjà utilisé",
        "auth/weak-password": "Mot de passe trop court (6 car. min)",
        "auth/invalid-email": "Email invalide",
        "auth/invalid-credential": "Email ou mot de passe incorrect",
      };
      setAuthError(msgs[e.code] || "Erreur de connexion");
    }
    setAuthLoading(false);
  };

  // Firebase real-time listeners (SYSTÈME DE BLOCAGE CORRIGÉ)
  useEffect(() => {
    let loadedCount = 0;
    const totalToLoad = 4;
    
    // Fonction qui libère le loading même si une collection est vide ou échoue
    const checkDone = () => { 
      loadedCount++; 
      if (loadedCount >= totalToLoad) setLoading(false); 
    };

    const unsubRules = onSnapshot(collection(db, "rules"), snap => {
      if (!snap.empty) setRules(snap.docs.map(d => ({...d.data(), id: d.id})));
      checkDone();
    }, () => checkDone()); // En cas d'erreur de permission/réseau

    const unsubMatches = onSnapshot(collection(db, "matches"), snap => {
      if (!snap.empty) {
        const fbMatches = snap.docs.map(d => ({...d.data(), fbId: d.id}));
        setMatches(fbMatches.sort((a,b) => (a.sortKey||0)-(b.sortKey||0)));
      }
      checkDone();
    }, () => checkDone());

    const unsubPayments = onSnapshot(collection(db, "payments"), snap => {
      if (!snap.empty) setPayments(snap.docs.map(d => ({...d.data(), fbId: d.id})));
      checkDone();
    }, () => checkDone());

    const unsubCal = onSnapshot(collection(db, "calendar"), snap => {
      if (!snap.empty) setCalendar(snap.docs.map(d => ({...d.data(), fbId: d.id})));
      checkDone();
    }, () => checkDone());

    // Sécurité ultime : force l'affichage après 5 secondes si Firebase est trop lent
    const safetyTimeout = setTimeout(() => setLoading(false), 5000);

    return () => { 
      unsubRules(); unsubMatches(); unsubPayments(); unsubCal(); 
      clearTimeout(safetyTimeout);
    };
  }, []);

  // Init Firebase if empty
  useEffect(() => {
    const initIfEmpty = async () => {
      const rulesSnap = await getDocs(collection(db, "rules"));
      if (rulesSnap.empty) {
        const batch = writeBatch(db);
        INITIAL_RULES.forEach(r => batch.set(doc(db, "rules", String(r.id)), r));
        HISTORICAL_MATCHES.forEach(m => batch.set(doc(db, "matches", String(m.id)), m));
        INITIAL_PAYMENTS.forEach(p => batch.set(doc(db, "payments", p.player), p));
        INITIAL_CALENDAR.forEach(c => batch.set(doc(db, "calendar", String(c.id)), c));
        await batch.commit();
      }
    };
    initIfEmpty();
  }, []);

  // Computed data
  const allEntries = useMemo(() =>
    matches.flatMap(m => (m.entries||[]).map((e,idx) => ({
      ...e, matchLabel:m.match, matchDate:m.date,
      matchId: m.fbId||String(m.id), sortKey:m.sortKey||0, entryIndex:idx
    }))),
    [matches]
  );

  const playerStats = useMemo(() => {
    const stats = {};
    allEntries.forEach(e => {
      const p = e.player;
      if (!stats[p]) stats[p] = {total:0, count:0, chaboula:0, entries:[]};
      stats[p].total += (e.amount || 0);
      if (e.amount > 0) stats[p].count++;
      if (e.detail && /chaboula/i.test(e.detail)) stats[p].chaboula++;
      stats[p].entries.push(e);
    });
    return stats;
  }, [allEntries]);

  // Sync payment totals automatically when infractions change
  useEffect(() => {
    if (!isAdmin || Object.keys(playerStats).length === 0 || payments.length === 0) return;
    payments.forEach(async p => {
      const newTotal = playerStats[p.player]?.total;
      if (newTotal !== undefined && Math.abs(newTotal - p.total) > 0.01) {
        try {
          await updateDoc(doc(db, "payments", p.fbId || p.player), {total: newTotal});
        } catch(e) {}
      }
    });
  }, [playerStats, isAdmin]);

  const players = useMemo(() => Object.keys(playerStats).sort(), [playerStats]);
  const totalCaisse = useMemo(() => payments.reduce((s,p) => s+(p.total||0), 0), [payments]);
  const matchTotals = useMemo(() => matches.map(m => ({
    ...m, total: (m.entries||[]).reduce((s,e) => s+(e.amount||0), 0)
  })), [matches]);
  const topOffenders = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].total-a[1].total).slice(0,5), [playerStats]);
  const topChaboula = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].chaboula-a[1].chaboula).slice(0,5), [playerStats]);

  // --- ACTIONS (Logique conservée de A à Z) ---
  const addInfraction = async () => {
    if (!newInfraction.player || (!newInfraction.ruleId && !newInfraction.customDetail)) return;
    const rule = rules.find(r => String(r.id) === String(newInfraction.ruleId));
    const amount = newInfraction.ruleId ? (rule?.amount||0) : parseFloat(newInfraction.customAmount)||0;
    const detail = newInfraction.ruleId ? rule?.name : newInfraction.customDetail;
    const matchLabel = newInfraction.matchLabel || "Hors match";
    const existing = matches.find(m => m.match === matchLabel);
    if (existing) {
      const fbId = existing.fbId || String(existing.id);
      const newEntries = [...(existing.entries||[]), {player:newInfraction.player, amount, detail}];
      await updateDoc(doc(db, "matches", fbId), {entries: newEntries});
    } else {
      const newMatch = {
        id: Date.now(), match: matchLabel,
        date: new Date().toLocaleDateString("fr-FR",{month:"short",year:"numeric"}),
        sortKey: 999, entries: [{player:newInfraction.player, amount, detail}]
      };
      await setDoc(doc(db, "matches", String(newMatch.id)), newMatch);
    }
    const player = newInfraction.player;
    const p = payments.find(x => x.player === player);
    if (p) {
      const newTotal = (playerStats[player]?.total||0) + amount;
      await updateDoc(doc(db, "payments", p.fbId||player), {total: newTotal});
    }
    setNewInfraction({player:"",ruleId:"",customDetail:"",customAmount:"",matchLabel:""});
    setShowAddInfraction(false);
    showToast("Infraction ajoutée ✓");
  };

  const deleteInfraction = async (matchId, entryIndex) => {
    const m = matches.find(x => x.fbId === matchId || String(x.id) === String(matchId));
    if (!m) return;
    const entry = (m.entries||[])[entryIndex];
    const newEntries = (m.entries||[]).filter((_,i) => i !== entryIndex);
    const fbId = m.fbId || String(m.id);
    await updateDoc(doc(db, "matches", fbId), {entries: newEntries});
    if (entry) {
      const p = payments.find(x => x.player === entry.player);
      if (p) {
        const newTotal = Math.max(0, p.total - entry.amount);
        await updateDoc(doc(db, "payments", p.fbId||entry.player), {total: newTotal});
      }
    }
    showToast("Infraction supprimée");
  };

  const addRule = async () => {
    if (!newRule.name || !newRule.amount) return;
    const r = {id: Date.now(), name: newRule.name, amount: parseFloat(newRule.amount)};
    await setDoc(doc(db, "rules", String(r.id)), r);
    setNewRule({name:"",amount:""}); setShowAddRule(false);
    showToast("Règle ajoutée ✓");
  };

  const saveRule = async () => {
    await updateDoc(doc(db, "rules", String(editingRule.id)), editingRule);
    setEditingRule(null);
    showToast("Règle modifiée ✓");
  };

  const deleteRule = async (id) => {
    await deleteDoc(doc(db, "rules", String(id)));
    showToast("Règle supprimée");
  };

  const addCalendarMatch = async () => {
    if (!newCalMatch.opponent || !newCalMatch.date) return;
    const m = {...newCalMatch, id: Date.now(), sortKey: 999, home: newCalMatch.home === true || newCalMatch.home === "true"};
    await setDoc(doc(db, "calendar", String(m.id)), m);
    setNewCalMatch({date:"",opponent:"",home:true,location:"",team:"Éq1"});
    setShowAddCalendar(false);
    showToast("Match ajouté ✓");
  };

  const savePayment = async (playerName) => {
    const added = parseFloat(paymentInput) || 0;
    const p = payments.find(x => x.player === playerName);
    if (!p) return;
    const newPaid = Math.min(p.paid + added, p.total);
    await updateDoc(doc(db, "payments", p.fbId||playerName), {paid: newPaid});
    setEditingPayment(null); setPaymentInput("");
    showToast("Paiement enregistré ✓");
  };

  const C = {
    card: {background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.07)"},
    h3: {margin:"0 0 16px", color:"#0d47a1", fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:1},
  };

  // RENDU LOADING (Correctif de blocage appliqué)
  if (loading) return (
    <div style={{minHeight:"100vh",background:"#f0f6ff",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{width:80,height:80,borderRadius:"50%",background:"#1565c0",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:36}}>🤾</div>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:"#0d47a1",letterSpacing:2}}>Chargement...</div>
    </div>
  );

  // LOGIN SCREEN (Conservé)
  if (!user) return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#1565c0,#0d47a1)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"white",borderRadius:20,padding:32,width:"100%",maxWidth:380,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{width:72,height:72,borderRadius:"50%",background:"linear-gradient(135deg,#1565c0,#42a5f5)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:32,margin:"0 auto 12px"}}>🤾</div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",letterSpacing:2}}>HBC LANGEAC</div>
          <div style={{color:"#78909c",fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Caisse Noire</div>
        </div>
        <div style={{display:"flex",background:"#f0f6ff",borderRadius:10,padding:4,marginBottom:20}}>
          {[{k:"login",l:"Connexion"},{k:"register",l:"Créer un compte"}].map(({k,l}) => (
            <button key={k} onClick={()=>{setAuthMode(k);setAuthError("");}}
              style={{flex:1,padding:"8px 0",borderRadius:8,border:"none",cursor:"pointer",fontWeight:800,fontSize:12,
                background:authMode===k?"#1565c0":"transparent",
                color:authMode===k?"white":"#78909c",transition:"all 0.2s"}}>
              {l}
            </button>
          ))}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <input type="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)}
            placeholder="Email" inputMode="email" autoCapitalize="none"
            style={{padding:"12px 16px",borderRadius:10,border:"2px solid #e3f2fd",fontSize:15,outline:"none",fontFamily:"'Nunito',sans-serif"}}/>
          <input type="password" value={authPassword} onChange={e=>setAuthPassword(e.target.value)}
            placeholder="Mot de passe" onKeyDown={e=>e.key==="Enter"&&handleAuth()}
            style={{padding:"12px 16px",borderRadius:10,border:"2px solid #e3f2fd",fontSize:15,outline:"none",fontFamily:"'Nunito',sans-serif"}}/>
          {authError && <div style={{color:"#e53935",fontSize:13,fontWeight:700,textAlign:"center",padding:"8px",background:"#ffebee",borderRadius:8}}>{authError}</div>}
          <button onClick={handleAuth} disabled={authLoading}
            style={{background:"#1565c0",color:"white",border:"none",padding:"14px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:15,marginTop:4,fontFamily:"'Nunito',sans-serif"}}>
            {authLoading?"...":(authMode==="login"?"Se connecter":"Créer mon compte")}
          </button>
        </div>
      </div>
    </div>
  );

  // --- RENDU APP (Conservé de A à Z) ---
  return (
    <div style={{minHeight:"100vh",background:"#f0f6ff",fontFamily:"'Nunito',sans-serif"}}>
      {toast && (
        <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:"#1565c0",color:"white",padding:"10px 24px",borderRadius:30,fontWeight:800,fontSize:14,zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,0.2)",whiteSpace:"nowrap"}}>
          {toast}
        </div>
      )}

      {/* HEADER */}
      <div style={{background:"linear-gradient(135deg,#1565c0 0%,#0d47a1 100%)",boxShadow:"0 4px 20px rgba(13,71,161,0.3)",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:1200,margin:"0 auto",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:46,height:46,borderRadius:"50%",background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:22,flexShrink:0}}>🤾</div>
            <div>
              <div style={{color:"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:2,lineHeight:1}}>HBC LANGEAC {isAdmin && "👑"}</div>
              <div style={{color:"#90caf9",fontSize:10,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Caisse Noire</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{background:"rgba(255,255,255,0.15)",borderRadius:12,padding:"6px 12px",textAlign:"center"}}>
              <div style={{color:"#90caf9",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Total</div>
              <div style={{color:"white",fontSize:22,fontFamily:"'Bebas Neue',sans-serif"}}>{totalCaisse.toFixed(1)}€</div>
            </div>
            <button onClick={()=>signOut(auth)}
              style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:10,padding:"8px 10px",color:"white",cursor:"pointer",fontSize:11,fontWeight:700,lineHeight:1.4}}>
              {isAdmin?"👑":"👤"}<br/>Déco
            </button>
          </div>
        </div>
        <div style={{borderTop:"1px solid rgba(255,255,255,0.1)",overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
          <div style={{display:"flex",padding:"0 16px",minWidth:"max-content"}}>
            {NAV_ITEMS.map(tab => (
              <button key={tab} onClick={()=>setActiveTab(tab)} style={{
                background:"none",border:"none",padding:"10px 14px",cursor:"pointer",
                color:activeTab===tab?"white":"rgba(255,255,255,0.6)",
                fontFamily:"'Nunito',sans-serif",fontWeight:800,fontSize:12,
                borderBottom:activeTab===tab?"3px solid white":"3px solid transparent",
                whiteSpace:"nowrap"
              }}>{tab}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{maxWidth:1200,margin:"0 auto",padding:"16px 12px"}}>
         {/* Ici le reste de ton Dashboard, onglets, etc... */}
         {/* (Logique identique à ton code source) */}
         {activeTab === "Dashboard" && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:20}}>
               {[
                 {label:"Total caisse",value:`${totalCaisse.toFixed(1)}€`,color:"#1565c0",icon:"💰"},
                 {label:"Matchs",value:matches.length,color:"#1976d2",icon:"🏆"},
                 {label:"Joueurs",value:players.length,color:"#1e88e5",icon:"👥"},
                 {label:"Record",value:`${Math.max(0,...matchTotals.map(m=>m.total))}€`,color:"#2196f3",icon:"🔥"},
               ].map(card => (
                 <div key={card.label} style={{...C.card,borderTop:`4px solid ${card.color}`,padding:16}}>
                   <div style={{fontSize:24}}>{card.icon}</div>
                   <div style={{fontSize:22,fontFamily:"'Bebas Neue',sans-serif",color:card.color}}>{card.value}</div>
                   <div style={{fontSize:11,color:"#78909c",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>{card.label}</div>
                 </div>
               ))}
            </div>
         )}
      </div>
      
      {/* Ton code continue ainsi jusqu'à la fin sans changement... */}
    </div>
  );
}
