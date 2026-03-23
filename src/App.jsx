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
  const [rules, setRules] = useState(INITIAL_RULES);
  const [matches, setMatches] = useState(HISTORICAL_MATCHES);
  const [calendar, setCalendar] = useState(INITIAL_CALENDAR);
  const [payments, setPayments] = useState(INITIAL_PAYMENTS);
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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const userDoc = await getDoc(doc(db, "users", u.uid));
          if (userDoc.exists()) {
            setIsAdmin(userDoc.data().role === "admin");
          } else {
            setIsAdmin(false);
          }
        } catch(e) { 
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

  useEffect(() => {
    let loaded = 0;
    const checkDone = () => { loaded++; if (loaded >= 4) setLoading(false); };
    const unsubRules = onSnapshot(collection(db, "rules"), snap => {
      if (!snap.empty) setRules(snap.docs.map(d => ({...d.data(), id: d.id})));
      checkDone();
    });
    const unsubMatches = onSnapshot(collection(db, "matches"), snap => {
      if (!snap.empty) {
        const fbMatches = snap.docs.map(d => ({...d.data(), fbId: d.id}));
        setMatches(fbMatches.sort((a,b) => (a.sortKey||0)-(b.sortKey||0)));
      }
      checkDone();
    });
    const unsubPayments = onSnapshot(collection(db, "payments"), snap => {
      if (!snap.empty) setPayments(snap.docs.map(d => ({...d.data(), fbId: d.id})));
      checkDone();
    });
    const unsubCal = onSnapshot(collection(db, "calendar"), snap => {
      if (!snap.empty) setCalendar(snap.docs.map(d => ({...d.data(), fbId: d.id})));
      checkDone();
    });
    return () => { unsubRules(); unsubMatches(); unsubPayments(); unsubCal(); };
  }, []);

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
          {[{k:"login",l:"Connexion"},{k:"register",l:"Créer"},].map(({k,l}) => (
            <button key={k} onClick={()=>setAuthMode(k)} style={{flex:1,padding:"8px",borderRadius:8,border:"none",background:authMode===k?"#1565c0":"transparent",color:authMode===k?"white":"#78909c",fontWeight:800}}>{l}</button>
          ))}
        </div>
        <input type="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="Email" style={{width:"100%",padding:12,marginBottom:10,borderRadius:10,border:"1px solid #ddd"}} />
        <input type="password" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} placeholder="Mot de passe" style={{width:"100%",padding:12,marginBottom:20,borderRadius:10,border:"1px solid #ddd"}} />
        <button onClick={handleAuth} style={{width:"100%",padding:14,background:"#1565c0",color:"white",border:"none",borderRadius:10,fontWeight:800}}>{authMode==="login"?"Se connecter":"Créer compte"}</button>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#f0f6ff",fontFamily:"'Nunito',sans-serif"}}>
      <div style={{background:"linear-gradient(135deg,#1565c0 0%,#0d47a1 100%)",color:"white",padding:"10px 16px",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:1200,margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22}}>HBC LANGEAC {isAdmin && "👑"}</div>
          <button onClick={()=>signOut(auth)} style={{background:"rgba(255,255,255,0.2)",border:"none",color:"white",padding:"6px 12px",borderRadius:8}}>Déco</button>
        </div>
        <div style={{display:"flex",overflowX:"auto",marginTop:10}}>
          {NAV_ITEMS.map(tab => (
            <button key={tab} onClick={()=>setActiveTab(tab)} style={{background:"none",border:"none",padding:"8px 12px",color:activeTab===tab?"white":"rgba(255,255,255,0.5)",fontWeight:800}}>{tab}</button>
          ))}
        </div>
      </div>
      <div style={{maxWidth:1200,margin:"0 auto",padding:16}}>
        <h2 style={{color:"#0d47a1",fontFamily:"'Bebas Neue',sans-serif"}}>{activeTab}</h2>
        {activeTab === "Dashboard" && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:16}}>
                <div style={C.card}>Total: {totalCaisse.toFixed(1)}€</div>
                <div style={C.card}>Matchs: {matches.length}</div>
            </div>
        )}
        {activeTab === "Paiements" && (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {payments.map(p => (
                    <div key={p.player} style={C.card}>
                        <strong>{p.player}</strong> : {p.total}€ (Payé: {p.paid}€)
                        {isAdmin && <button onClick={() => setEditingPayment(p.player)} style={{marginLeft:10}}>Gérer</button>}
                    </div>
                ))}
            </div>
        )}
        <div style={{marginTop:20, textAlign:'center', color:'#90a4ae', fontSize:12}}>Connecté en tant que : {user.email}</div>
      </div>
    </div>
  );
}
