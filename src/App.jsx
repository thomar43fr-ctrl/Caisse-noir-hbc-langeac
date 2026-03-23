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
          const adminSnap = await getDocs(collection(db, "admins"));
          const adminEmails = adminSnap.docs.map(d => d.id);
          setIsAdmin(adminEmails.includes(u.email));
        } catch(e) { setIsAdmin(false); }
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
      setAuthError("Identifiants incorrects");
    }
    setAuthLoading(false);
  };

  // Firebase real-time listeners - CORRIGÉ POUR ÉVITER LE BLOCAGE
  useEffect(() => {
    let collectionsLoaded = { rules: false, matches: false, payments: false, calendar: false };
    
    const checkDone = (key) => {
      collectionsLoaded[key] = true;
      // On libère l'écran dès qu'on a tenté de charger les 4, même si elles sont vides
      if (Object.values(collectionsLoaded).every(v => v === true)) {
        setLoading(false);
      }
    };

    const unsubRules = onSnapshot(collection(db, "rules"), snap => {
      if (!snap.empty) setRules(snap.docs.map(d => ({...d.data(), id: d.id})));
      checkDone('rules');
    }, () => checkDone('rules'));

    const unsubMatches = onSnapshot(collection(db, "matches"), snap => {
      if (!snap.empty) {
        const fbMatches = snap.docs.map(d => ({...d.data(), fbId: d.id}));
        setMatches(fbMatches.sort((a,b) => (a.sortKey||0)-(b.sortKey||0)));
      }
      checkDone('matches');
    }, () => checkDone('matches'));

    const unsubPayments = onSnapshot(collection(db, "payments"), snap => {
      if (!snap.empty) setPayments(snap.docs.map(d => ({...d.data(), fbId: d.id})));
      checkDone('payments');
    }, () => checkDone('payments'));

    const unsubCal = onSnapshot(collection(db, "calendar"), snap => {
      if (!snap.empty) setCalendar(snap.docs.map(d => ({...d.data(), fbId: d.id})));
      checkDone('calendar');
    }, () => checkDone('calendar'));

    // Timeout de secours au cas où Firebase ne répond pas du tout
    const fallback = setTimeout(() => setLoading(false), 4000);

    return () => { 
      unsubRules(); unsubMatches(); unsubPayments(); unsubCal(); 
      clearTimeout(fallback);
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
      stats[p].total += e.amount;
      if (e.amount > 0) stats[p].count++;
      if (e.detail && /chaboula/i.test(e.detail)) stats[p].chaboula++;
      stats[p].entries.push(e);
    });
    return stats;
  }, [allEntries]);

  const players = useMemo(() => Object.keys(playerStats).sort(), [playerStats]);
  const totalCaisse = useMemo(() => payments.reduce((s,p) => s+p.total, 0), [payments]);
  const matchTotals = useMemo(() => matches.map(m => ({
    ...m, total: (m.entries||[]).reduce((s,e) => s+e.amount, 0)
  })), [matches]);
  const topOffenders = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].total-a[1].total).slice(0,5), [playerStats]);
  const topChaboula = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].chaboula-a[1].chaboula).slice(0,5), [playerStats]);

  const C = {
    card: {background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.07)"},
    h3: {margin:"0 0 16px", color:"#0d47a1", fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:1},
  };

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#f0f6ff",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{width:80,height:80,borderRadius:"50%",background:"#1565c0",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:36}}>🤾</div>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:"#0d47a1",letterSpacing:2}}>Chargement...</div>
    </div>
  );

  if (!user) return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#1565c0,#0d47a1)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"white",borderRadius:20,padding:32,width:"100%",maxWidth:380,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{width:72,height:72,borderRadius:"50%",background:"linear-gradient(135deg,#1565c0,#42a5f5)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:32,marginBottom:12}}>🤾</div>
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
          <input type="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="Email" style={{padding:"12px 16px",borderRadius:10,border:"2px solid #e3f2fd",fontSize:15,outline:"none",fontFamily:"'Nunito',sans-serif"}}/>
          <input type="password" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} placeholder="Mot de passe" style={{padding:"12px 16px",borderRadius:10,border:"2px solid #e3f2fd",fontSize:15,outline:"none",fontFamily:"'Nunito',sans-serif"}}/>
          {authError && <div style={{color:"#e53935",fontSize:13,fontWeight:700,textAlign:"center",padding:"8px",background:"#ffebee",borderRadius:8}}>{authError}</div>}
          <button onClick={handleAuth} style={{background:"#1565c0",color:"white",border:"none",padding:"14px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:15,marginTop:4,fontFamily:"'Nunito',sans-serif"}}>
            {authLoading?"...":(authMode==="login"?"Se connecter":"Créer mon compte")}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#f0f6ff",fontFamily:"'Nunito',sans-serif"}}>
      {/* HEADER */}
      <div style={{background:"linear-gradient(135deg,#1565c0 0%,#0d47a1 100%)",boxShadow:"0 4px 20px rgba(13,71,161,0.3)",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:1200,margin:"0 auto",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:46,height:46,borderRadius:"50%",background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:22,flexShrink:0}}>🤾</div>
            <div>
              <div style={{color:"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:2,lineHeight:1}}>HBC LANGEAC</div>
              <div style={{color:"#90caf9",fontSize:10,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Caisse Noire</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
             <div style={{background:"rgba(255,255,255,0.15)",borderRadius:12,padding:"6px 12px",textAlign:"center"}}>
              <div style={{color:"#90caf9",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Total</div>
              <div style={{color:"white",fontSize:22,fontFamily:"'Bebas Neue',sans-serif"}}>{totalCaisse.toFixed(1)}€</div>
            </div>
            <button onClick={()=>signOut(auth)} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:10,padding:"8px 10px",color:"white",cursor:"pointer",fontSize:11,fontWeight:700,lineHeight:1.4}}>
              {isAdmin?"👑":"👤"}<br/>Déco
            </button>
          </div>
        </div>
        <div style={{borderTop:"1px solid rgba(255,255,255,0.1)",overflowX:"auto"}}>
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
        {/* DASHBOARD */}
        {activeTab==="Dashboard" && (
          <div>
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
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
               <div style={C.card}>
                 <h3 style={C.h3}>🏆 Top Mauvais Élèves</h3>
                 {topOffenders.map(([name,stats],i) => (
                   <div key={name} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #f0f0f0"}}>
                     <div style={{width:28,height:28,borderRadius:"50%",background:"#e3f2fd",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:12,color:"#1565c0"}}>{i+1}</div>
                     <div style={{flex:1,fontWeight:700,color:"#1a237e"}}>{name}</div>
                     <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#1565c0"}}>{stats.total}€</div>
                   </div>
                 ))}
               </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
