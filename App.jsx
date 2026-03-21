import { useState, useMemo, useEffect } from "react";
import { db } from "./firebase";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, addDoc, writeBatch, getDocs
} from "firebase/firestore";
import { INITIAL_RULES, INITIAL_PAYMENTS, PAYMENT_TOTALS, INITIAL_CALENDAR } from "./data";
import { HISTORICAL_MATCHES } from "./matches";

const LOGO_B64 = "data:image/jpeg;base64,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";

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
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [rules, setRules] = useState(INITIAL_RULES);
  const [matches, setMatches] = useState(HISTORICAL_MATCHES);
  const [calendar, setCalendar] = useState(INITIAL_CALENDAR);
  const [payments, setPayments] = useState(INITIAL_PAYMENTS);
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

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // Firebase real-time listeners
  useEffect(() => {
    let loaded = 0;
    const checkDone = () => { loaded++; if (loaded >= 4) setLoading(false); };

    // Rules
    const unsubRules = onSnapshot(collection(db, "rules"), snap => {
      if (!snap.empty) setRules(snap.docs.map(d => ({id: d.id, ...d.data()})));
      checkDone();
    });

    // Matches (infractions)
    const unsubMatches = onSnapshot(collection(db, "matches"), snap => {
      if (!snap.empty) {
        const fbMatches = snap.docs.map(d => ({...d.data(), fbId: d.id}));
        setMatches(fbMatches.sort((a,b) => (a.sortKey||0)-(b.sortKey||0)));
      }
      checkDone();
    });

    // Payments
    const unsubPayments = onSnapshot(collection(db, "payments"), snap => {
      if (!snap.empty) setPayments(snap.docs.map(d => ({...d.data(), fbId: d.id})));
      checkDone();
    });

    // Calendar
    const unsubCal = onSnapshot(collection(db, "calendar"), snap => {
      if (!snap.empty) setCalendar(snap.docs.map(d => ({...d.data(), fbId: d.id})));
      checkDone();
    });

    return () => { unsubRules(); unsubMatches(); unsubPayments(); unsubCal(); };
  }, []);

  // Initialize Firebase with data if empty
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

  const allEntries = useMemo(() =>
    matches.flatMap(m => m.entries ? m.entries.map((e,idx) => ({
      ...e, matchLabel:m.match, matchDate:m.date, matchId:m.id || m.fbId, sortKey:m.sortKey, entryIndex:idx
    })) : []),
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
    Object.keys(stats).forEach(p => {
      if (PAYMENT_TOTALS[p] !== undefined) stats[p].total = PAYMENT_TOTALS[p];
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

  // Actions
  const addInfraction = async () => {
    if (!newInfraction.player || (!newInfraction.ruleId && !newInfraction.customDetail)) return;
    const rule = rules.find(r => String(r.id) === String(newInfraction.ruleId));
    const amount = newInfraction.ruleId ? (rule?.amount || 0) : parseInt(newInfraction.customAmount)||0;
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
    setNewInfraction({player:"",ruleId:"",customDetail:"",customAmount:"",matchLabel:""});
    setShowAddInfraction(false);
    showToast("Infraction ajoutée ✓");
  };

  const deleteInfraction = async (matchId, entryIndex) => {
    const m = matches.find(x => (x.id === matchId || x.fbId === matchId));
    if (!m) return;
    const newEntries = (m.entries||[]).filter((_,i) => i !== entryIndex);
    const fbId = m.fbId || String(m.id);
    await updateDoc(doc(db, "matches", fbId), {entries: newEntries});
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
    const fbId = p.fbId || playerName;
    await updateDoc(doc(db, "payments", fbId), {paid: newPaid});
    setEditingPayment(null); setPaymentInput("");
    showToast("Paiement enregistré ✓");
  };

  const C = {
    card: {background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.07)"},
    h3: {margin:"0 0 16px", color:"#0d47a1", fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:1},
  };

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#f0f6ff",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <img src={LOGO_B64} style={{width:80,height:80,borderRadius:"50%",objectFit:"cover"}} alt="HBC"/>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:"#0d47a1",letterSpacing:2}}>Chargement...</div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#f0f6ff",fontFamily:"'Nunito',sans-serif"}}>
      {/* Toast */}
      {toast && (
        <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:"#1565c0",color:"white",padding:"10px 24px",borderRadius:30,fontWeight:800,fontSize:14,zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,0.2)"}}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#1565c0 0%,#0d47a1 100%)",boxShadow:"0 4px 20px rgba(13,71,161,0.3)",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:1200,margin:"0 auto",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <img src={LOGO_B64} style={{width:48,height:48,borderRadius:"50%",objectFit:"cover",border:"2px solid rgba(255,255,255,0.3)",flexShrink:0}} alt="HBC Langeac"/>
            <div>
              <div style={{color:"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:2,lineHeight:1}}>HBC LANGEAC</div>
              <div style={{color:"#90caf9",fontSize:10,fontWeight:700,letterSpacing:2,textTransform:"uppercase"}}>Caisse Noire</div>
            </div>
          </div>
          <div style={{background:"rgba(255,255,255,0.15)",borderRadius:12,padding:"6px 14px",textAlign:"center"}}>
            <div style={{color:"#90caf9",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Total caisse</div>
            <div style={{color:"white",fontSize:24,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:1}}>{totalCaisse.toFixed(1)}€</div>
          </div>
        </div>
        {/* Nav */}
        <div style={{borderTop:"1px solid rgba(255,255,255,0.1)",overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
          <div style={{display:"flex",padding:"0 16px",minWidth:"max-content"}}>
            {NAV_ITEMS.map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                background:"none",border:"none",padding:"10px 14px",cursor:"pointer",
                color:activeTab===tab?"white":"rgba(255,255,255,0.6)",
                fontFamily:"'Nunito',sans-serif",fontWeight:800,fontSize:12,
                borderBottom:activeTab===tab?"3px solid white":"3px solid transparent",
                whiteSpace:"nowrap",transition:"color 0.2s"
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
                {label:"Matchs joués",value:matches.length,color:"#1976d2",icon:"🏆"},
                {label:"Joueurs",value:players.length,color:"#1e88e5",icon:"👥"},
                {label:"Record match",value:`${Math.max(...matchTotals.map(m=>m.total))}€`,color:"#2196f3",icon:"🔥"},
              ].map(card => (
                <div key={card.label} style={{...C.card,borderTop:`4px solid ${card.color}`,padding:16}}>
                  <div style={{fontSize:24}}>{card.icon}</div>
                  <div style={{fontSize:24,fontFamily:"'Bebas Neue',sans-serif",color:card.color}}>{card.value}</div>
                  <div style={{fontSize:11,color:"#78909c",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>{card.label}</div>
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
              <div style={C.card}>
                <h3 style={C.h3}>🏆 Top Mauvais Élèves</h3>
                {topOffenders.map(([name,stats],i) => (
                  <div key={name} onClick={()=>{setSelectedPlayer(name);setActiveTab("Joueurs");}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #f0f0f0",cursor:"pointer"}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:i===0?"#f4d03f":i===1?"#bdc3c7":i===2?"#e59866":"#e3f2fd",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:12,color:i<3?"#333":"#1565c0",flexShrink:0}}>{i+1}</div>
                    <div style={{flex:1,fontWeight:700,color:"#1a237e"}}>{name}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#1565c0"}}>{stats.total}€</div>
                  </div>
                ))}
              </div>
              <div style={C.card}>
                <h3 style={C.h3}>😈 Classement Chaboulat</h3>
                {topChaboula.filter(([,s])=>s.chaboula>0).map(([name,stats],i) => (
                  <div key={name} onClick={()=>{setSelectedPlayer(name);setActiveTab("Joueurs");}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #f0f0f0",cursor:"pointer"}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:i===0?"#f4d03f":"#e3f2fd",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:12,color:i===0?"#333":"#1565c0",flexShrink:0}}>{i+1}</div>
                    <div style={{flex:1,fontWeight:700,color:"#1a237e"}}>{name}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#e53935"}}>{stats.chaboula}×</div>
                  </div>
                ))}
              </div>
              <div style={{...C.card,gridColumn:"1/-1"}}>
                <h3 style={C.h3}>📅 Matchs (du plus récent)</h3>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:10}}>
                  {matchTotals.slice().sort((a,b)=>b.sortKey-a.sortKey).map(m => (
                    <div key={m.id||m.fbId} style={{background:"#f0f6ff",borderRadius:12,padding:"12px 14px",borderLeft:"4px solid #1565c0"}}>
                      <div style={{fontWeight:800,fontSize:12,color:"#0d47a1"}}>{m.match}</div>
                      <div style={{fontSize:11,color:"#78909c",marginTop:2}}>{m.date}</div>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#1565c0",marginTop:4}}>{m.total}€</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PAIEMENTS */}
        {activeTab==="Paiements" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
              <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",letterSpacing:1,margin:0}}>💳 Paiements</h2>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {[
                  {label:"Total dû",value:`${payments.reduce((s,p)=>s+p.total,0).toFixed(1)}€`,color:"#0d47a1"},
                  {label:"Payé",value:`${payments.reduce((s,p)=>s+p.paid,0).toFixed(1)}€`,color:"#2e7d32"},
                  {label:"Reste",value:`${payments.reduce((s,p)=>s+(p.total-p.paid),0).toFixed(1)}€`,color:"#c62828"},
                ].map(c => (
                  <div key={c.label} style={{background:"white",borderRadius:12,padding:"8px 12px",boxShadow:"0 2px 8px rgba(0,0,0,0.07)",textAlign:"center"}}>
                    <div style={{fontSize:9,fontWeight:700,color:"#78909c",textTransform:"uppercase",letterSpacing:1}}>{c.label}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:c.color}}>{c.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {payments.slice().sort((a,b)=>(b.total-b.paid)-(a.total-a.paid)).map(p => {
                const reste = p.total - p.paid;
                const pct = Math.round((p.paid/p.total)*100);
                const isPaid = reste <= 0;
                return (
                  <div key={p.player} style={{background:isPaid?"#f1f8e9":"white",borderRadius:14,padding:"14px 16px",boxShadow:"0 2px 8px rgba(0,0,0,0.06)",borderLeft:`4px solid ${isPaid?"#4caf50":"#1565c0"}`}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,gap:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                        <div style={{width:36,height:36,borderRadius:"50%",background:isPaid?"linear-gradient(135deg,#2e7d32,#66bb6a)":"linear-gradient(135deg,#1565c0,#42a5f5)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:18,flexShrink:0}}>{p.player[0]}</div>
                        <div style={{minWidth:0}}>
                          <div style={{fontWeight:800,color:"#0d47a1",fontSize:15,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.player}</div>
                          <div style={{display:"flex",alignItems:"center",gap:4,marginTop:2}}>
                            <div style={{width:70,height:5,background:"#e3f2fd",borderRadius:3,flexShrink:0}}>
                              <div style={{width:`${Math.min(pct,100)}%`,height:"100%",background:isPaid?"#4caf50":"#1565c0",borderRadius:3}}/>
                            </div>
                            <span style={{fontSize:10,color:"#90a4ae",fontWeight:700}}>{pct}%</span>
                            {isPaid&&<span style={{fontSize:10,color:"#2e7d32",fontWeight:800}}>✓</span>}
                          </div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:10,flexShrink:0}}>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:9,color:"#90a4ae",fontWeight:700,textTransform:"uppercase"}}>Dû</div>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:"#0d47a1"}}>{p.total}€</div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:9,color:"#90a4ae",fontWeight:700,textTransform:"uppercase"}}>Payé</div>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:"#2e7d32"}}>{p.paid}€</div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:9,color:"#90a4ae",fontWeight:700,textTransform:"uppercase"}}>Reste</div>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:isPaid?"#4caf50":"#c62828"}}>{isPaid?"0€":reste.toFixed(1)+"€"}</div>
                        </div>
                      </div>
                    </div>
                    <div style={{display:"flex",justifyContent:"flex-end"}}>
                      {editingPayment===p.player ? (
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <input type="number" value={paymentInput} onChange={e=>setPaymentInput(e.target.value)}
                            placeholder="Montant €" inputMode="numeric"
                            style={{width:100,padding:"8px 10px",borderRadius:8,border:"2px solid #1565c0",fontSize:14}}/>
                          <button onClick={()=>savePayment(p.player)} style={{background:"#1565c0",color:"white",border:"none",padding:"8px 14px",borderRadius:8,cursor:"pointer",fontWeight:800,fontSize:14}}>✓</button>
                          <button onClick={()=>{setEditingPayment(null);setPaymentInput("");}} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"8px 12px",borderRadius:8,cursor:"pointer",fontSize:14}}>✕</button>
                        </div>
                      ) : (
                        <button onClick={()=>{setEditingPayment(p.player);setPaymentInput("");}} disabled={isPaid}
                          style={{background:isPaid?"#e8f5e9":"#1565c0",color:isPaid?"#4caf50":"white",border:"none",padding:"8px 18px",borderRadius:8,cursor:isPaid?"default":"pointer",fontWeight:800,fontSize:13}}>
                          {isPaid?"✓ Soldé":"+ Enregistrer paiement"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* JOUEURS */}
        {activeTab==="Joueurs" && (
          <div>
            {selectedPlayer ? (
              <div>
                <button onClick={()=>setSelectedPlayer(null)} style={{background:"#1565c0",color:"white",border:"none",padding:"8px 18px",borderRadius:8,cursor:"pointer",fontWeight:700,marginBottom:16}}>← Retour</button>
                <div style={C.card}>
                  <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:20}}>
                    <div style={{width:54,height:54,borderRadius:"50%",background:"linear-gradient(135deg,#1565c0,#42a5f5)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:26,flexShrink:0}}>{selectedPlayer[0]}</div>
                    <div>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:"#0d47a1",letterSpacing:1}}>{selectedPlayer}</div>
                      <div style={{color:"#78909c",fontSize:13}}>Total : <strong style={{color:"#1565c0"}}>{playerStats[selectedPlayer]?.total||0}€</strong> • Chaboulats : <strong style={{color:"#e53935"}}>{playerStats[selectedPlayer]?.chaboula||0}</strong></div>
                    </div>
                  </div>
                  {(() => {
                    const stats = getPlayerInfractionStats(playerStats[selectedPlayer]?.entries||[]);
                    if (!stats.length) return null;
                    return (
                      <div style={{marginBottom:16}}>
                        <div style={{fontSize:11,fontWeight:800,color:"#78909c",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Récurrences notables</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                          {stats.map(([label,count]) => (
                            <div key={label} style={{background:"#e3f2fd",borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:800,color:"#1565c0"}}>
                              {label} <span style={{background:"#1565c0",color:"white",borderRadius:10,padding:"1px 7px",marginLeft:4,fontSize:11}}>{count}×</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  <h4 style={{color:"#0d47a1",fontFamily:"'Bebas Neue',sans-serif",fontSize:17,margin:"0 0 12px",letterSpacing:1}}>Historique</h4>
                  {(() => {
                    const entries = (playerStats[selectedPlayer]?.entries||[]).filter(e=>e.amount>0);
                    const byMatch = {};
                    entries.forEach(e => {
                      if (!byMatch[e.matchLabel]) byMatch[e.matchLabel] = {date:e.matchDate,sortKey:e.sortKey||0,entries:[]};
                      byMatch[e.matchLabel].entries.push(e);
                    });
                    const sorted = Object.entries(byMatch).sort((a,b)=>(b[1].sortKey||0)-(a[1].sortKey||0));
                    if (!sorted.length) return <div style={{color:"#90a4ae",padding:20,textAlign:"center"}}>Aucune infraction</div>;
                    return sorted.map(([matchLabel,{date,entries:mE}]) => (
                      <div key={matchLabel} style={{marginBottom:12}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                          <div style={{fontSize:11,fontWeight:800,color:"#0d47a1",background:"#e3f2fd",borderRadius:8,padding:"3px 10px"}}>{matchLabel}</div>
                          <div style={{fontSize:11,color:"#90a4ae"}}>{date}</div>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:"#1565c0",marginLeft:"auto"}}>{mE.reduce((s,e)=>s+e.amount,0)}€</div>
                        </div>
                        {mE.map((e,i) => (
                          <div key={i} style={{display:"flex",alignItems:"center",padding:"8px 12px",background:"#f8fbff",borderRadius:8,marginBottom:4,borderLeft:`3px solid ${e.amount>10?"#e53935":e.amount>5?"#fb8c00":"#1565c0"}`}}>
                            <div style={{fontSize:13,color:"#546e7a",flex:1}}>{e.detail}</div>
                            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:e.amount>10?"#e53935":e.amount>5?"#fb8c00":"#1565c0"}}>{e.amount}€</div>
                              <button onClick={()=>deleteInfraction(e.matchId,e.entryIndex)} style={{background:"#ffebee",color:"#e53935",border:"none",width:26,height:26,borderRadius:6,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>🗑</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ));
                  })()}
                </div>
              </div>
            ) : (
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,gap:10,flexWrap:"wrap"}}>
                  <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",letterSpacing:1,margin:0}}>👥 Joueurs</h2>
                  <button onClick={()=>setShowAddInfraction(!showAddInfraction)} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 18px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:13}}>+ Infraction</button>
                </div>
                {showAddInfraction && (
                  <div style={{...C.card,marginBottom:16}}>
                    <h3 style={C.h3}>Ajouter une infraction</h3>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12}}>
                      <div>
                        <label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"block",marginBottom:4}}>JOUEUR</label>
                        <select value={newInfraction.player} onChange={e=>setNewInfraction(p=>({...p,player:e.target.value}))} style={{width:"100%",padding:"10px",borderRadius:8,border:"2px solid #e3f2fd",fontSize:14}}>
                          <option value="">Choisir</option>
                          {players.map(p=><option key={p}>{p}</option>)}
                          <option value="__new__">+ Nouveau</option>
                        </select>
                        {newInfraction.player==="__new__" && <input placeholder="Nom" style={{width:"100%",padding:"10px",borderRadius:8,border:"2px solid #e3f2fd",fontSize:14,marginTop:8,boxSizing:"border-box"}} onChange={e=>setNewInfraction(p=>({...p,player:e.target.value}))}/>}
                      </div>
                      <div>
                        <label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"block",marginBottom:4}}>MATCH</label>
                        <select value={newInfraction.matchLabel} onChange={e=>setNewInfraction(p=>({...p,matchLabel:e.target.value}))} style={{width:"100%",padding:"10px",borderRadius:8,border:"2px solid #e3f2fd",fontSize:14}}>
                          <option value="">Hors match</option>
                          {matches.map(m=><option key={m.id||m.fbId} value={m.match}>{m.match}</option>)}
                          <option value="__new__">+ Nouveau match</option>
                        </select>
                        {newInfraction.matchLabel==="__new__" && <input placeholder="Nom du match" style={{width:"100%",padding:"10px",borderRadius:8,border:"2px solid #e3f2fd",fontSize:14,marginTop:8,boxSizing:"border-box"}} onChange={e=>setNewInfraction(p=>({...p,matchLabel:e.target.value}))}/>}
                      </div>
                      <div>
                        <label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"block",marginBottom:4}}>RÈGLE</label>
                        <select value={newInfraction.ruleId} onChange={e=>setNewInfraction(p=>({...p,ruleId:e.target.value}))} style={{width:"100%",padding:"10px",borderRadius:8,border:"2px solid #e3f2fd",fontSize:14}}>
                          <option value="">Personnalisée</option>
                          {rules.map(r=><option key={r.id} value={r.id}>{r.name} ({r.amount}€)</option>)}
                        </select>
                      </div>
                      {!newInfraction.ruleId && <>
                        <div>
                          <label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"block",marginBottom:4}}>DÉTAIL</label>
                          <input value={newInfraction.customDetail} onChange={e=>setNewInfraction(p=>({...p,customDetail:e.target.value}))} placeholder="Description" style={{width:"100%",padding:"10px",borderRadius:8,border:"2px solid #e3f2fd",fontSize:14,boxSizing:"border-box"}}/>
                        </div>
                        <div>
                          <label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"block",marginBottom:4}}>MONTANT (€)</label>
                          <input type="number" inputMode="numeric" value={newInfraction.customAmount} onChange={e=>setNewInfraction(p=>({...p,customAmount:e.target.value}))} placeholder="0" style={{width:"100%",padding:"10px",borderRadius:8,border:"2px solid #e3f2fd",fontSize:14,boxSizing:"border-box"}}/>
                        </div>
                      </>}
                    </div>
                    <div style={{display:"flex",gap:10,marginTop:14}}>
                      <button onClick={addInfraction} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 22px",borderRadius:8,cursor:"pointer",fontWeight:800}}>Ajouter</button>
                      <button onClick={()=>setShowAddInfraction(false)} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"10px 18px",borderRadius:8,cursor:"pointer",fontWeight:700}}>Annuler</button>
                    </div>
                  </div>
                )}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12}}>
                  {players.sort((a,b)=>(playerStats[b]?.total||0)-(playerStats[a]?.total||0)).map(player => (
                    <div key={player} onClick={()=>setSelectedPlayer(player)} style={{...C.card,cursor:"pointer",borderTop:"4px solid #1565c0",transition:"transform 0.2s",padding:16}}
                      onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
                      onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}>
                      <div style={{width:40,height:40,borderRadius:"50%",background:"linear-gradient(135deg,#1565c0,#42a5f5)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:20,marginBottom:8}}>{player[0]}</div>
                      <div style={{fontWeight:800,color:"#0d47a1",fontSize:14}}>{player}</div>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#1565c0"}}>{playerStats[player]?.total||0}€</div>
                      {playerStats[player]?.chaboula>0 && <div style={{fontSize:11,color:"#e53935",fontWeight:700,marginTop:4}}>😈 {playerStats[player].chaboula}×</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* RÈGLES */}
        {activeTab==="Règles" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",letterSpacing:1,margin:0}}>📋 Règles</h2>
              <button onClick={()=>setShowAddRule(!showAddRule)} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 18px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:13}}>+ Règle</button>
            </div>
            {showAddRule && (
              <div style={{...C.card,marginBottom:16}}>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <input value={newRule.name} onChange={e=>setNewRule(p=>({...p,name:e.target.value}))} placeholder="Nom de la règle" style={{flex:1,minWidth:160,padding:"10px",borderRadius:8,border:"2px solid #e3f2fd",fontSize:14}}/>
                  <input type="number" inputMode="numeric" value={newRule.amount} onChange={e=>setNewRule(p=>({...p,amount:e.target.value}))} placeholder="€" style={{width:70,padding:"10px",borderRadius:8,border:"2px solid #e3f2fd",fontSize:14}}/>
                  <button onClick={addRule} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 18px",borderRadius:8,cursor:"pointer",fontWeight:800}}>Ajouter</button>
                  <button onClick={()=>setShowAddRule(false)} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"10px 12px",borderRadius:8,cursor:"pointer"}}>✕</button>
                </div>
              </div>
            )}
            {editingRule && (
              <div style={{...C.card,marginBottom:16}}>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <input value={editingRule.name} onChange={e=>setEditingRule(p=>({...p,name:e.target.value}))} style={{flex:1,minWidth:160,padding:"10px",borderRadius:8,border:"2px solid #1565c0",fontSize:14}}/>
                  <input type="number" inputMode="numeric" value={editingRule.amount} onChange={e=>setEditingRule(p=>({...p,amount:parseFloat(e.target.value)}))} style={{width:70,padding:"10px",borderRadius:8,border:"2px solid #1565c0",fontSize:14}}/>
                  <button onClick={saveRule} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 18px",borderRadius:8,cursor:"pointer",fontWeight:800}}>Sauver</button>
                  <button onClick={()=>setEditingRule(null)} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"10px 12px",borderRadius:8,cursor:"pointer"}}>✕</button>
                </div>
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
              {rules.map(rule => (
                <div key={rule.id} style={{background:"white",borderRadius:14,padding:"12px 16px",boxShadow:"0 2px 8px rgba(0,0,0,0.06)",display:"flex",alignItems:"center",borderLeft:"4px solid #1565c0"}}>
                  <div style={{flex:1,fontWeight:700,color:"#1a237e",fontSize:13}}>{rule.name}</div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#1565c0"}}>{rule.amount}€</div>
                    <button onClick={()=>setEditingRule(rule)} style={{background:"#e3f2fd",color:"#1565c0",border:"none",width:28,height:28,borderRadius:6,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>✏️</button>
                    <button onClick={()=>deleteRule(rule.id)} style={{background:"#ffebee",color:"#e53935",border:"none",width:28,height:28,borderRadius:6,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CALENDRIER */}
        {activeTab==="Calendrier" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",letterSpacing:1,margin:0}}>📅 Calendrier</h2>
              <button onClick={()=>setShowAddCalendar(!showAddCalendar)} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 18px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:13}}>+ Match</button>
            </div>
            {showAddCalendar && (
              <div style={{...C.card,marginBottom:16}}>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12}}>
                  {[{label:"DATE",key:"date",placeholder:"ex: Avr 2025"},{label:"ADVERSAIRE",key:"opponent",placeholder:"Nom"},{label:"LIEU",key:"location",placeholder:"Ville"}].map(f=>(
                    <div key={f.key}>
                      <label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"block",marginBottom:4}}>{f.label}</label>
                      <input value={newCalMatch[f.key]} onChange={e=>setNewCalMatch(p=>({...p,[f.key]:e.target.value}))} placeholder={f.placeholder} style={{width:"100%",padding:"10px",borderRadius:8,border:"2px solid #e3f2fd",fontSize:14,boxSizing:"border-box"}}/>
                    </div>
                  ))}
                  <div>
                    <label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"block",marginBottom:4}}>DOM / EXT</label>
                    <select value={newCalMatch.home} onChange={e=>setNewCalMatch(p=>({...p,home:e.target.value==="true"}))} style={{width:"100%",padding:"10px",borderRadius:8,border:"2px solid #e3f2fd",fontSize:14}}>
                      <option value="true">Domicile</option><option value="false">Extérieur</option>
                    </select>
                  </div>
                  <div>
                    <label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"block",marginBottom:4}}>ÉQUIPE</label>
                    <select value={newCalMatch.team} onChange={e=>setNewCalMatch(p=>({...p,team:e.target.value}))} style={{width:"100%",padding:"10px",borderRadius:8,border:"2px solid #e3f2fd",fontSize:14}}>
                      <option value="Éq1">Équipe 1</option><option value="Éq2">Équipe 2</option>
                    </select>
                  </div>
                </div>
                <div style={{display:"flex",gap:10,marginTop:14}}>
                  <button onClick={addCalendarMatch} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 22px",borderRadius:8,cursor:"pointer",fontWeight:800}}>Ajouter</button>
                  <button onClick={()=>setShowAddCalendar(false)} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"10px 18px",borderRadius:8,cursor:"pointer",fontWeight:700}}>Annuler</button>
                </div>
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {calendar.slice().sort((a,b)=>b.sortKey-a.sortKey).map(m => (
                <div key={m.id||m.fbId} style={{background:"white",borderRadius:14,padding:"12px 16px",boxShadow:"0 2px 8px rgba(0,0,0,0.06)",display:"flex",alignItems:"center",gap:14,borderLeft:`4px solid ${m.home?"#1565c0":"#42a5f5"}`}}>
                  <div style={{width:38,height:38,borderRadius:"50%",background:m.team==="Éq2"?"#e3f2fd":"#1565c0",display:"flex",alignItems:"center",justifyContent:"center",color:m.team==="Éq2"?"#1565c0":"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:12,flexShrink:0}}>{m.team}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:800,color:"#0d47a1",fontSize:14}}>vs {m.opponent}</div>
                    <div style={{fontSize:12,color:"#78909c",marginTop:2}}>{m.date} • {m.location} • {m.home?"🏠":"✈️"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STATS */}
        {activeTab==="Stats" && (
          <div>
            <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",letterSpacing:1,margin:"0 0 16px"}}>📊 Stats</h2>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
              <div style={{...C.card,gridColumn:"1/-1"}}>
                <h3 style={C.h3}>💰 Total par joueur</h3>
                {Object.entries(playerStats).sort((a,b)=>b[1].total-a[1].total).map(([name,stats]) => {
                  const maxTotal = Math.max(...Object.values(playerStats).map(s=>s.total));
                  const pct = Math.round((stats.total/maxTotal)*100);
                  return (
                    <div key={name} style={{marginBottom:10,cursor:"pointer"}} onClick={()=>{setSelectedPlayer(name);setActiveTab("Joueurs");}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                        <span style={{fontWeight:700,color:"#1a237e",fontSize:14}}>{name}</span>
                        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#1565c0"}}>{stats.total}€</span>
                      </div>
                      <div style={{background:"#e3f2fd",borderRadius:4,height:7}}>
                        <div style={{width:`${pct}%`,height:"100%",background:"linear-gradient(90deg,#1565c0,#42a5f5)",borderRadius:4}}/>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={C.card}>
                <h3 style={C.h3}>😈 Classement Chaboulat</h3>
                {Object.entries(playerStats).sort((a,b)=>b[1].chaboula-a[1].chaboula).filter(([,s])=>s.chaboula>0).map(([name,stats],i) => (
                  <div key={name} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f0f0f0"}}>
                    <div style={{width:26,height:26,borderRadius:"50%",background:i===0?"#f4d03f":"#e3f2fd",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:12,color:i===0?"#333":"#1565c0",flexShrink:0}}>{i+1}</div>
                    <div style={{flex:1,fontWeight:700,color:"#1a237e"}}>{name}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#e53935"}}>{stats.chaboula}×</div>
                  </div>
                ))}
              </div>
              <div style={C.card}>
                <h3 style={C.h3}>🔥 Matchs par montant</h3>
                {matchTotals.slice().sort((a,b)=>b.total-a.total).map((m,i) => (
                  <div key={m.id||m.fbId} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f0f0f0"}}>
                    <div style={{width:26,height:26,borderRadius:"50%",background:i===0?"#f4d03f":"#e3f2fd",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:11,color:i===0?"#333":"#1565c0",flexShrink:0}}>{i+1}</div>
                    <div style={{flex:1,fontWeight:600,color:"#1a237e",fontSize:13}}>{m.match}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:19,color:"#1565c0"}}>{m.total}€</div>
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
