import { useState, useEffect, useCallback, useMemo } from "react";

const PMU = import.meta.env.DEV
  ? "/api/pmu/rest/client/1"
  : "https://online.turfinfo.api.pmu.fr/rest/client/1";

function fmtDate(d) {
  return `${String(d.getDate()).padStart(2,"0")}${String(d.getMonth()+1).padStart(2,"0")}${d.getFullYear()}`;
}

function parseMusique(m) {
  if (!m) return [];
  const r = [];
  const re = /(\d+|D|T|A|Ret|0)([a-z]?)/gi;
  let match;
  while ((match = re.exec(m)) !== null) {
    const pos = match[1];
    const type = match[2] || "";
    r.push({ pos: pos === "D" || pos === "T" || pos === "A" || pos === "Ret" ? 99 : parseInt(pos), type, raw: match[0] });
  }
  return r.slice(0, 10);
}

function scoreMusicality(musique) {
  const runs = parseMusique(musique);
  if (runs.length === 0) return 0;
  let score = 0;
  runs.forEach((r, i) => {
    const weight = Math.max(1, 5 - i * 0.4);
    if (r.pos === 1) score += 10 * weight;
    else if (r.pos === 2) score += 7 * weight;
    else if (r.pos === 3) score += 5 * weight;
    else if (r.pos <= 5) score += 3 * weight;
    else if (r.pos <= 8) score += 1 * weight;
    else score -= 1 * weight;
  });
  return Math.round(score * 10) / 10;
}

function renderMusique(m) {
  const runs = parseMusique(m);
  return runs.map((r, i) => {
    let color = "#666";
    if (r.pos === 1) color = "#FFD700";
    else if (r.pos === 2) color = "#C0C0C0";
    else if (r.pos === 3) color = "#CD7F32";
    else if (r.pos <= 5) color = "#5BBA6F";
    else if (r.pos <= 8) color = "#8899AA";
    return (
      <span key={i} style={{ color, fontWeight: r.pos <= 3 ? 700 : 400, marginRight: 3, fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>
        {r.raw}
      </span>
    );
  });
}

const TABS = ["quinté", "analyse", "pronostic"];

export default function QuinteAnalyzer() {
  const [tab, setTab] = useState("quinté");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [raceInfo, setRaceInfo] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [pronostics, setPronostics] = useState(null);
  const [historyData, setHistoryData] = useState({});
  const [histLoading, setHistLoading] = useState(false);
  const [histProgress, setHistProgress] = useState(0);
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split("T")[0];
  });

  const dateObj = useMemo(() => new Date(selectedDate + "T12:00:00"), [selectedDate]);

  const fetchQuinte = useCallback(async () => {
    setLoading(true);
    setError(null);
    setParticipants([]);
    setPronostics(null);
    setRaceInfo(null);
    try {
      const dateStr = fmtDate(dateObj);
      const progRes = await fetch(`${PMU}/programme/${dateStr}`);
      if (!progRes.ok) throw new Error(`Programme indisponible (${progRes.status})`);
      const prog = await progRes.json();

      let quinteRace = null;
      let reunionNum = null;
      for (const reunion of (prog.programme?.reunions || [])) {
        for (const course of (reunion.courses || [])) {
          if (course.categorieParticularite === "QUINTE" || (course.libelle || "").toUpperCase().includes("QUINTE") || course.quinte) {
            quinteRace = course;
            reunionNum = reunion.numOfficiel;
            break;
          }
        }
        if (quinteRace) break;
      }

      if (!quinteRace) {
        for (const reunion of (prog.programme?.reunions || [])) {
          for (const course of (reunion.courses || [])) {
            if (course.ordreQuinte || (course.specialite && course.montantPrix > 50000)) {
              quinteRace = course;
              reunionNum = reunion.numOfficiel;
              break;
            }
          }
          if (quinteRace) break;
        }
      }

      if (!quinteRace) throw new Error("Aucun Quinté+ trouvé pour cette date");

      setRaceInfo({
        ...quinteRace,
        reunionNum,
        date: dateStr,
        hippodrome: quinteRace.hippodrome?.libelleLong || quinteRace.hippodrome?.libelleCourt || "Inconnu"
      });

      const partRes = await fetch(`${PMU}/programme/${dateStr}/R${reunionNum}/C${quinteRace.numOrdre}/participants`);
      if (!partRes.ok) throw new Error("Participants indisponibles");
      const partData = await partRes.json();
      setParticipants(partData.participants || []);

      try {
        const pronoRes = await fetch(`${PMU}/programme/${dateStr}/R${reunionNum}/C${quinteRace.numOrdre}/pronostics`);
        if (pronoRes.ok) {
          const pronoData = await pronoRes.json();
          setPronostics(pronoData);
        }
      } catch (e) { /* pronostics optional */ }

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [dateObj]);

  useEffect(() => { fetchQuinte(); }, [fetchQuinte]);

  const loadHistory = useCallback(async () => {
    if (histLoading) return;
    setHistLoading(true);
    setHistProgress(0);
    const stats = {};
    const today = new Date();
    const DAYS = 90;

    for (let i = 1; i <= DAYS; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const ds = fmtDate(d);
      setHistProgress(Math.round((i / DAYS) * 100));
      try {
        const res = await fetch(`${PMU}/programme/${ds}`);
        if (!res.ok) continue;
        const prog = await res.json();
        for (const reunion of (prog.programme?.reunions || [])) {
          for (const course of (reunion.courses || [])) {
            if (course.categorieParticularite === "QUINTE" || (course.libelle || "").toUpperCase().includes("QUINTE") || course.quinte) {
              try {
                const pRes = await fetch(`${PMU}/programme/${ds}/R${reunion.numOfficiel}/C${course.numOrdre}/participants`);
                if (!pRes.ok) continue;
                const pData = await pRes.json();
                for (const p of (pData.participants || [])) {
                  const jName = p.driver || p.jockey?.nom || (typeof p.jockey === "string" ? p.jockey : "?");
                  const tName = (typeof p.entraineur === "string" ? p.entraineur : p.entraineur?.nom) || "?";
                  if (!stats[jName]) stats[jName] = { type: "jockey", runs: 0, top3: 0, top5: 0, wins: 0 };
                  stats[jName].runs++;
                  if (p.ordreArrivee === 1) { stats[jName].wins++; stats[jName].top3++; stats[jName].top5++; }
                  else if (p.ordreArrivee <= 3) { stats[jName].top3++; stats[jName].top5++; }
                  else if (p.ordreArrivee <= 5) { stats[jName].top5++; }

                  const tKey = `T_${tName}`;
                  if (!stats[tKey]) stats[tKey] = { type: "trainer", runs: 0, top3: 0, top5: 0, wins: 0 };
                  stats[tKey].runs++;
                  if (p.ordreArrivee === 1) { stats[tKey].wins++; stats[tKey].top3++; stats[tKey].top5++; }
                  else if (p.ordreArrivee <= 3) { stats[tKey].top3++; stats[tKey].top5++; }
                  else if (p.ordreArrivee <= 5) { stats[tKey].top5++; }
                }
              } catch (e) { /* skip race */ }
              break;
            }
          }
        }
      } catch (e) { /* skip day */ }
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 200));
    }
    setHistoryData(stats);
    setHistLoading(false);
  }, [histLoading]);

  const scoredParticipants = useMemo(() => {
    if (!participants.length) return [];

    const pronoMap = {};
    if (pronostics) {
      const lists = pronostics.propinosPMU || pronostics.pronostics || [];
      const pronoList = Array.isArray(lists) ? lists : [lists];
      pronoList.forEach(p => {
        if (p?.participants) {
          p.participants.forEach((num, idx) => {
            pronoMap[num] = (pronoMap[num] || 0) + Math.max(0, 10 - idx * 1.5);
          });
        } else if (p?.numParticipants) {
          p.numParticipants.forEach((num, idx) => {
            pronoMap[num] = (pronoMap[num] || 0) + Math.max(0, 10 - idx * 1.5);
          });
        }
      });
    }

    return participants
      .filter(p => !p.supplement && !p.nonPartant)
      .map(p => {
        let score = 0;

        const mScore = scoreMusicality(p.musique);
        score += mScore;

        const pronoScore = pronoMap[p.numPmu] || 0;
        score += pronoScore * 2;

        const jName = p.driver || p.jockey?.nom || (typeof p.jockey === "string" ? p.jockey : "") || "";
        const jStats = historyData[jName];
        if (jStats && jStats.runs >= 3) {
          const jWinRate = jStats.wins / jStats.runs;
          const jTopRate = jStats.top5 / jStats.runs;
          score += jWinRate * 30 + jTopRate * 15;
        }

        const tName = (typeof p.entraineur === "string" ? p.entraineur : p.entraineur?.nom) || "";
        const tStats = historyData[`T_${tName}`];
        if (tStats && tStats.runs >= 3) {
          const tWinRate = tStats.wins / tStats.runs;
          const tTopRate = tStats.top5 / tStats.runs;
          score += tWinRate * 20 + tTopRate * 10;
        }

        if (p.oeilleres && p.oeilleres !== "SANS_OEILLERES") score += 2;
        if (p.deferre === "DEFERRE_ANTERIEURS" || p.deferre === "DEFERRE_POSTERIEURS") score += 1.5;
        if (p.deferre === "DEFERRE_4") score += 3;

        const age = p.age || 0;
        if (age >= 4 && age <= 7) score += 3;
        else if (age === 3 || age === 8) score += 1;

        return { ...p, score: Math.round(score * 10) / 10, mScore, pronoScore, jStats, tStats };
      })
      .sort((a, b) => b.score - a.score);
  }, [participants, pronostics, historyData]);

  const getJockey = (p) => p.driver || p.jockey?.nom || (typeof p.jockey === "string" ? p.jockey : null) || "?";
  const getEntraineur = (p) => (typeof p.entraineur === "string" ? p.entraineur : p.entraineur?.nom) || "?";
  const getProprietaire = (p) => (typeof p.proprietaire === "string" ? p.proprietaire : p.proprietaire?.nom) || "?";
  const getEleveur = (p) => (typeof p.eleveur === "string" ? p.eleveur : p.eleveur?.nom) || null;
  const hasOeilleres = (p) => p.oeilleres && p.oeilleres !== "SANS_OEILLERES";
  const getSexLabel = (s) => ({ MALES: "♂ Mâle", FEMELLES: "♀ Femelle", HONGRES: "⚊ Hongre" }[s] || s || "?");
  const getOeilleres = (o) => o && o !== "SANS_OEILLERES" ? "✓ Oui" : "✗ Non";
  const getDeferre = (d) => {
    if (!d || d === "FERRE") return "Ferré 4 pieds";
    if (d === "DEFERRE_ANTERIEURS") return "Déferré antérieurs";
    if (d === "DEFERRE_POSTERIEURS") return "Déferré postérieurs";
    if (d === "DEFERRE_4") return "Déferré 4 pieds";
    return d.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase());
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(170deg, #0a0a0f 0%, #111118 40%, #0d0d14 100%)",
      color: "#e8e6e1",
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      padding: 0,
      margin: 0
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Playfair+Display:wght@600;700;800&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, rgba(212,175,55,0.08) 0%, rgba(10,10,15,0) 60%)",
        borderBottom: "1px solid rgba(212,175,55,0.15)",
        padding: "20px 24px 16px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "linear-gradient(135deg, #D4AF37, #B8860B)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, fontWeight: 700, color: "#0a0a0f",
            fontFamily: "Playfair Display, serif"
          }}>Q</div>
          <div>
            <h1 style={{
              margin: 0, fontSize: 22, fontWeight: 700,
              fontFamily: "Playfair Display, serif",
              background: "linear-gradient(135deg, #D4AF37, #F5E6A3, #D4AF37)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
            }}>Quinté+ Analyzer</h1>
            <p style={{ margin: 0, fontSize: 11, color: "#888", letterSpacing: 2, textTransform: "uppercase" }}>
              Analyse & Pronostics PMU
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(212,175,55,0.2)",
              borderRadius: 8, color: "#e8e6e1", padding: "8px 12px", fontSize: 14,
              fontFamily: "JetBrains Mono, monospace", outline: "none", flex: 1
            }}
          />
          <button
            onClick={fetchQuinte}
            style={{
              background: "linear-gradient(135deg, #D4AF37, #B8860B)", border: "none",
              borderRadius: 8, color: "#0a0a0f", padding: "8px 16px", fontSize: 13,
              fontWeight: 600, cursor: "pointer"
            }}
          >Charger</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "8px 0", border: "none", borderRadius: 8,
              background: tab === t ? "rgba(212,175,55,0.15)" : "transparent",
              color: tab === t ? "#D4AF37" : "#777",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
              textTransform: "uppercase", letterSpacing: 1.5,
              borderBottom: tab === t ? "2px solid #D4AF37" : "2px solid transparent",
              transition: "all 0.2s"
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "16px 20px 40px" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 60 }}>
            <div style={{
              width: 40, height: 40, border: "3px solid rgba(212,175,55,0.2)",
              borderTop: "3px solid #D4AF37", borderRadius: "50%",
              animation: "spin 0.8s linear infinite", margin: "0 auto 16px"
            }} />
            <p style={{ color: "#888", fontSize: 14 }}>Chargement du Quinté+...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {error && !loading && (
          <div style={{
            background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.2)",
            borderRadius: 12, padding: 20, textAlign: "center"
          }}>
            <p style={{ color: "#ff6b6b", fontSize: 15, fontWeight: 600, margin: "0 0 8px" }}>Erreur</p>
            <p style={{ color: "#999", fontSize: 13, margin: 0 }}>{error}</p>
            <p style={{ color: "#666", fontSize: 12, margin: "12px 0 0", lineHeight: 1.5 }}>
              L'API PMU peut être bloquée par CORS dans ce contexte.
              L'app fonctionne parfaitement en local ou via un proxy.
            </p>
          </div>
        )}

        {!loading && !error && raceInfo && tab === "quinté" && (
          <div>
            {/* Race Info Card */}
            <div style={{
              background: "linear-gradient(135deg, rgba(212,175,55,0.06), rgba(212,175,55,0.02))",
              border: "1px solid rgba(212,175,55,0.12)", borderRadius: 14, padding: 18, marginBottom: 16
            }}>
              <h2 style={{
                margin: "0 0 6px", fontSize: 17, fontWeight: 700,
                fontFamily: "Playfair Display, serif", color: "#D4AF37"
              }}>{raceInfo.libelle || `Quinté+ R${raceInfo.reunionNum}C${raceInfo.numOrdre}`}</h2>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "#999" }}>
                <span>📍 {raceInfo.hippodrome}</span>
                <span>🏇 {raceInfo.specialite || "Plat"}</span>
                <span>📏 {raceInfo.distance ? `${raceInfo.distance}m` : "?"}</span>
                <span>💰 {raceInfo.montantPrix ? `${(raceInfo.montantPrix/1000).toFixed(0)}K€` : "?"}</span>
                <span>👥 {participants.filter(p => !p.nonPartant).length} partants</span>
              </div>
            </div>

            {/* History Loader */}
            <div style={{
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 12, padding: 14, marginBottom: 16, display: "flex",
              alignItems: "center", justifyContent: "space-between"
            }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#ccc" }}>
                  Données historiques (90 jours)
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#777" }}>
                  {Object.keys(historyData).length > 0
                    ? `✓ ${Object.keys(historyData).length} profils chargés`
                    : "Améliore la précision du pronostic"}
                </p>
              </div>
              <button
                onClick={loadHistory}
                disabled={histLoading || Object.keys(historyData).length > 0}
                style={{
                  background: histLoading ? "rgba(212,175,55,0.1)" : Object.keys(historyData).length > 0 ? "rgba(90,180,90,0.15)" : "rgba(212,175,55,0.15)",
                  border: "1px solid rgba(212,175,55,0.2)", borderRadius: 8,
                  color: Object.keys(historyData).length > 0 ? "#5BBA6F" : "#D4AF37",
                  padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer"
                }}
              >
                {histLoading ? `${histProgress}%` : Object.keys(historyData).length > 0 ? "Chargé ✓" : "Scanner"}
              </button>
            </div>

            {/* Participants List */}
            {participants.filter(p => !p.nonPartant).map((p, i) => (
              <div key={p.numPmu} style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12, padding: 14, marginBottom: 8,
                borderLeft: `3px solid ${i < 3 ? "#D4AF37" : i < 6 ? "#666" : "#333"}`
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{
                      background: "rgba(212,175,55,0.15)", color: "#D4AF37",
                      width: 28, height: 28, borderRadius: 7, display: "flex",
                      alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700, fontFamily: "JetBrains Mono"
                    }}>{p.numPmu}</span>
                    <div>
                      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#e8e6e1" }}>
                        {(p.nom || "?").toUpperCase()}
                      </p>
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: "#888" }}>
                        {getSexLabel(p.sexe)} • {p.age || "?"}ans • {p.race || ""}
                      </p>
                    </div>
                  </div>
                </div>

                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px",
                  fontSize: 12, color: "#999", marginBottom: 8
                }}>
                  <div><span style={{ color: "#666" }}>Jockey/Driver:</span> {getJockey(p)}</div>
                  <div><span style={{ color: "#666" }}>Entraîneur:</span> {getEntraineur(p)}</div>
                  <div><span style={{ color: "#666" }}>Propriétaire:</span> {getProprietaire(p)}</div>
                  <div><span style={{ color: "#666" }}>Poids:</span> {p.poidsConditionMonte || p.handicapPoids || "?"}kg</div>
                  <div><span style={{ color: "#666" }}>Œillères:</span> <span style={{ color: hasOeilleres(p) ? "#5BBA6F" : "#888" }}>{getOeilleres(p.oeilleres)}</span></div>
                  <div><span style={{ color: "#666" }}>Ferrure:</span> {getDeferre(p.deferre)}</div>
                  {getEleveur(p) && <div><span style={{ color: "#666" }}>Éleveur:</span> {getEleveur(p)}</div>}
                  {p.nomPere && <div><span style={{ color: "#666" }}>Père:</span> {p.nomPere}</div>}
                  {p.nomMere && <div><span style={{ color: "#666" }}>Mère:</span> {p.nomMere}</div>}
                  {p.nombreCourses != null && <div><span style={{ color: "#666" }}>Courses:</span> {p.nombreCourses} ({p.nombreVictoires}V {p.nombrePlaces}P)</div>}
                </div>

                {p.musique && (
                  <div style={{
                    background: "rgba(0,0,0,0.3)", borderRadius: 6,
                    padding: "6px 10px", display: "flex", alignItems: "center", gap: 8
                  }}>
                    <span style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>MUSIQUE</span>
                    <div>{renderMusique(p.musique)}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!loading && !error && tab === "analyse" && (
          <div>
            <div style={{
              background: "rgba(212,175,55,0.06)", border: "1px solid rgba(212,175,55,0.1)",
              borderRadius: 12, padding: 16, marginBottom: 16
            }}>
              <h3 style={{ margin: "0 0 8px", fontFamily: "Playfair Display", fontSize: 16, color: "#D4AF37" }}>
                Méthode d'analyse
              </h3>
              <p style={{ margin: 0, fontSize: 12, color: "#999", lineHeight: 1.6 }}>
                Score composite basé sur : <strong style={{ color: "#ccc" }}>musique</strong> (performances récentes pondérées),{" "}
                <strong style={{ color: "#ccc" }}>pronostics PMU</strong> (consensus experts),{" "}
                <strong style={{ color: "#ccc" }}>jockey</strong> (taux victoire/placé sur 90j),{" "}
                <strong style={{ color: "#ccc" }}>entraîneur</strong> (taux victoire/placé),{" "}
                <strong style={{ color: "#ccc" }}>équipement</strong> (œillères, ferrure),{" "}
                <strong style={{ color: "#ccc" }}>âge</strong> (fenêtre optimale 4-7 ans).
              </p>
            </div>

            {scoredParticipants.map((p, i) => (
              <div key={p.numPmu} style={{
                background: i < 5 ? "rgba(212,175,55,0.04)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${i < 5 ? "rgba(212,175,55,0.12)" : "rgba(255,255,255,0.05)"}`,
                borderRadius: 10, padding: 12, marginBottom: 6,
                display: "flex", alignItems: "center", gap: 12
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: i === 0 ? "linear-gradient(135deg,#D4AF37,#B8860B)" : i < 3 ? "rgba(212,175,55,0.15)" : i < 5 ? "rgba(212,175,55,0.08)" : "rgba(255,255,255,0.05)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 700, color: i === 0 ? "#0a0a0f" : i < 3 ? "#D4AF37" : "#888",
                  fontFamily: "JetBrains Mono"
                }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: i < 5 ? "#e8e6e1" : "#999" }}>
                      N°{p.numPmu} {(p.nom || "").toUpperCase()}
                    </span>
                    <span style={{
                      fontFamily: "JetBrains Mono", fontSize: 14, fontWeight: 700,
                      color: i === 0 ? "#D4AF37" : i < 3 ? "#ccc" : i < 5 ? "#999" : "#666"
                    }}>{p.score}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 4, fontSize: 10, color: "#777" }}>
                    <span style={{ background: "rgba(212,175,55,0.08)", padding: "2px 6px", borderRadius: 4 }}>
                      Musique: {p.mScore}
                    </span>
                    <span style={{ background: "rgba(100,150,255,0.08)", padding: "2px 6px", borderRadius: 4 }}>
                      Prono: {(p.pronoScore * 2).toFixed(0)}
                    </span>
                    {p.jStats && (
                      <span style={{ background: "rgba(90,180,90,0.08)", padding: "2px 6px", borderRadius: 4 }}>
                        J: {((p.jStats.wins/p.jStats.runs)*100).toFixed(0)}%W
                      </span>
                    )}
                    {p.tStats && (
                      <span style={{ background: "rgba(180,90,180,0.08)", padding: "2px 6px", borderRadius: 4 }}>
                        E: {((p.tStats.wins/p.tStats.runs)*100).toFixed(0)}%W
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && tab === "pronostic" && (() => {
          const raceDate = raceInfo?.heureDepart
            ? new Date(raceInfo.heureDepart)
            : null;
          const dateStr = raceDate
            ? raceDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
            : selectedDate;
          const timeStr = raceDate
            ? raceDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
            : null;

          // Generate multiple DISTINCT series of 5 horses
          const all = scoredParticipants;
          const series = [];
          const usedCombos = new Set();

          const comboKey = (horses) => horses.map(h => h.numPmu).sort((a,b) => a-b).join("-");

          const addSeries = (label, desc, horses) => {
            if (horses.length !== 5) return;
            const key = comboKey(horses);
            if (usedCombos.has(key)) return;
            usedCombos.add(key);
            series.push({ label, desc, horses });
          };

          // Sort variants
          const byScore = [...all];
          const byMusic = [...all].sort((a, b) => b.mScore - a.mScore);
          const byProno = [...all].sort((a, b) => b.pronoScore - a.pronoScore);

          // Serie 1: Top 5 score strict — ordre par score global
          if (all.length >= 5) {
            addSeries("Série 1 — Favoris", "Top 5 score global dans l'ordre", byScore.slice(0, 5));
          }

          // Serie 2: Best music order — chevaux avec la meilleure forme récente
          if (all.length >= 8) {
            const picked = [];
            const used = new Set();
            // Take top 3 music + fill with top score not already in
            for (const h of byMusic) { if (picked.length < 3 && !used.has(h.numPmu)) { picked.push(h); used.add(h.numPmu); } }
            for (const h of byScore) { if (picked.length < 5 && !used.has(h.numPmu)) { picked.push(h); used.add(h.numPmu); } }
            addSeries("Série 2 — Forme récente", "Meilleure musique + base solide", picked);
          }

          // Serie 3: Prono PMU + outsider — confiance experts avec surprise
          if (all.length >= 10) {
            const picked = [];
            const used = new Set();
            for (const h of byProno) { if (picked.length < 3 && !used.has(h.numPmu)) { picked.push(h); used.add(h.numPmu); } }
            // Add 2 outsiders (ranked 7-12 by score)
            for (const h of byScore.slice(6, 12)) { if (picked.length < 5 && !used.has(h.numPmu)) { picked.push(h); used.add(h.numPmu); } }
            addSeries("Série 3 — Experts + outsiders", "Consensus PMU + 2 surprises", picked);
          }

          // Serie 4: Pure outsiders — chevaux 5-10 du classement
          if (all.length >= 10) {
            addSeries("Série 4 — Outsiders", "Chevaux sous-cotés rang 5-10", byScore.slice(4, 9));
          }

          // Serie 5: Mix — meilleur de chaque critère sans doublon
          if (all.length >= 10) {
            const picked = [];
            const used = new Set();
            // #1: best score
            if (byScore[0]) { picked.push(byScore[0]); used.add(byScore[0].numPmu); }
            // #2: best music not already picked
            for (const h of byMusic) { if (!used.has(h.numPmu)) { picked.push(h); used.add(h.numPmu); break; } }
            // #3: best prono not already picked
            for (const h of byProno) { if (!used.has(h.numPmu)) { picked.push(h); used.add(h.numPmu); break; } }
            // #4: best outsider (rank 8+)
            for (const h of byScore.slice(7)) { if (!used.has(h.numPmu)) { picked.push(h); used.add(h.numPmu); break; } }
            // #5: second best music not already picked
            let mCount = 0;
            for (const h of byMusic) { if (!used.has(h.numPmu)) { mCount++; if (mCount >= 2) { picked.push(h); used.add(h.numPmu); break; } } }
            addSeries("Série 5 — Combiné optimal", "1 favori + forme + experts + outsider", picked);
          }

          // Serie 6: Reverse top — favori en 5e, outsiders devant
          if (all.length >= 8) {
            const base = byScore.slice(0, 5);
            addSeries("Série 6 — Ordre inversé", "Même chevaux, arrivée surprise", [base[4], base[3], base[2], base[1], base[0]]);
          }

          // Serie 7: Deep outsiders + 1 favori
          if (all.length >= 14) {
            const picked = [byScore[0]]; // 1 favori
            const used = new Set([byScore[0].numPmu]);
            // 4 deep outsiders (rank 9-14)
            for (const h of byScore.slice(8, 14)) { if (picked.length < 5 && !used.has(h.numPmu)) { picked.push(h); used.add(h.numPmu); } }
            addSeries("Série 7 — Gros rapport", "1 favori + outsiders lointains", picked);
          }

          return (
          <div>
            {/* Header with date & time */}
            <div style={{
              background: "linear-gradient(135deg, rgba(212,175,55,0.1), rgba(212,175,55,0.03))",
              border: "1px solid rgba(212,175,55,0.2)", borderRadius: 16,
              padding: 20, marginBottom: 20, textAlign: "center"
            }}>
              <p style={{
                fontSize: 11, color: "#D4AF37", textTransform: "uppercase",
                letterSpacing: 3, margin: "0 0 10px", fontWeight: 600
              }}>Pronostic du jour</p>
              <h2 style={{
                margin: "0 0 8px", fontFamily: "Playfair Display", fontSize: 20,
                color: "#F5E6A3"
              }}>
                {raceInfo?.libelle || "Quinté+"}
              </h2>
              <div style={{
                display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap",
                fontSize: 13, color: "#ccc", marginBottom: 6
              }}>
                <span>📅 {dateStr}</span>
                {timeStr && <span>🕐 {timeStr}</span>}
              </div>
              <div style={{
                display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap",
                fontSize: 12, color: "#888"
              }}>
                <span>📍 {raceInfo?.hippodrome}</span>
                <span>🏇 {raceInfo?.specialite || "Plat"}</span>
                <span>📏 {raceInfo?.distance}m</span>
                <span>💰 {raceInfo?.montantPrix ? `${(raceInfo.montantPrix/1000).toFixed(0)}K€` : "?"}</span>
                <span>👥 {participants.filter(p=>!p.nonPartant).length} partants</span>
              </div>
            </div>

            {/* Multiple series */}
            {series.map((s, si) => (
              <div key={si} style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <p style={{
                    fontSize: 12, color: si === 0 ? "#D4AF37" : "#aaa", textTransform: "uppercase",
                    letterSpacing: 2, margin: 0, fontWeight: 700
                  }}>{si === 0 ? "🏆 " : "🎯 "}{s.label}</p>
                  <span style={{ fontSize: 10, color: "#666" }}>{s.desc}</span>
                </div>

                <div style={{
                  background: si === 0 ? "rgba(212,175,55,0.04)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${si === 0 ? "rgba(212,175,55,0.15)" : "rgba(255,255,255,0.06)"}`,
                  borderRadius: 14, padding: 14
                }}>
                  {/* Compact order display */}
                  <div style={{
                    display: "flex", gap: 6, marginBottom: 12, justifyContent: "center", flexWrap: "wrap"
                  }}>
                    {s.horses.map((p, i) => (
                      <div key={p.numPmu} style={{
                        background: i === 0 ? "linear-gradient(135deg, #D4AF37, #B8860B)" : "rgba(255,255,255,0.08)",
                        borderRadius: 10, padding: "6px 14px",
                        display: "flex", alignItems: "center", gap: 6
                      }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: i === 0 ? "#0a0a0f" : "#888",
                          fontFamily: "JetBrains Mono"
                        }}>{i + 1}.</span>
                        <span style={{
                          fontSize: 15, fontWeight: 800, color: i === 0 ? "#0a0a0f" : "#D4AF37",
                          fontFamily: "JetBrains Mono"
                        }}>{p.numPmu}</span>
                      </div>
                    ))}
                  </div>

                  {/* Detail rows */}
                  {s.horses.map((p, i) => (
                    <div key={p.numPmu} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "6px 0",
                      borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none"
                    }}>
                      <span style={{
                        width: 22, height: 22, borderRadius: 6, display: "flex",
                        alignItems: "center", justifyContent: "center", fontSize: 11,
                        fontWeight: 700, fontFamily: "JetBrains Mono",
                        background: i === 0 ? "rgba(212,175,55,0.2)" : "rgba(255,255,255,0.05)",
                        color: i === 0 ? "#D4AF37" : "#888"
                      }}>{i + 1}</span>
                      <span style={{ fontWeight: 600, fontSize: 13, color: "#e8e6e1", minWidth: 30 }}>N°{p.numPmu}</span>
                      <span style={{ fontWeight: 600, fontSize: 13, color: "#ccc", flex: 1 }}>{(p.nom || "").toUpperCase()}</span>
                      <span style={{ fontSize: 11, color: "#888" }}>{getJockey(p)}</span>
                      <span style={{
                        fontFamily: "JetBrains Mono", fontSize: 12, fontWeight: 700,
                        color: i === 0 ? "#D4AF37" : "#777"
                      }}>{p.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Disclaimer */}
            <div style={{
              marginTop: 10, padding: 14, background: "rgba(255,255,255,0.02)",
              borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)"
            }}>
              <p style={{ margin: 0, fontSize: 11, color: "#666", lineHeight: 1.6 }}>
                ⚠️ Ces pronostics sont générés par algorithme à titre indicatif. Ils ne constituent pas un conseil de jeu.
                L'ordre proposé est basé sur le score composite (musique, pronostics PMU, stats jockey/entraîneur, équipement, âge).
                {Object.keys(historyData).length === 0 && (
                  <span style={{ color: "#D4AF37" }}>
                    {" "}Pour des pronostics plus précis, chargez les données historiques depuis l'onglet Quinté.
                  </span>
                )}
              </p>
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
}
