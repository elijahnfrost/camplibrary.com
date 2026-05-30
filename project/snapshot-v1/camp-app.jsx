// Camp Library — main app: state, chrome, device stage, mount
const { ACTIVITIES } = window.CampData;
const APP_CATS = window.CampData.CATEGORIES;

// ---------- persistence ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

const PLACES = ["Inside", "Outside"];

function App() {
  const [tab, setTab] = React.useState("library");
  const [view, setView] = React.useState(() => store.get("camp:view", "deck"));
  const [cat, setCat] = React.useState("All");
  const [place, setPlace] = React.useState("All");
  const [query, setQuery] = React.useState("");
  const [searchOpen, setSearchOpen] = React.useState(false);

  const [favs, setFavs] = React.useState(() => store.get("camp:favs", []));
  const [extra, setExtra] = React.useState(() => store.get("camp:extra", []));
  const [schedule, setSchedule] = React.useState(() =>
    store.get("camp:schedule", { 2: { s1: "boom-chicka-boom", s2: "gaga-ball", s3: "tie-dye", s4: "sponge-relay" } }));
  const [dayIndex, setDayIndex] = React.useState(2);

  const [detail, setDetail] = React.useState(null);
  const [pickerSlot, setPickerSlot] = React.useState(null);
  const [justAdded, setJustAdded] = React.useState(null);

  React.useEffect(() => { store.set("camp:favs", favs); }, [favs]);
  React.useEffect(() => { store.set("camp:extra", extra); }, [extra]);
  React.useEffect(() => { store.set("camp:schedule", schedule); }, [schedule]);
  React.useEffect(() => { store.set("camp:view", view); }, [view]);

  const all = React.useMemo(() => [...extra, ...ACTIVITIES], [extra]);
  const byId = React.useMemo(() => { const m = {}; all.forEach((a) => (m[a.id] = a)); return m; }, [all]);

  const isFav = (id) => favs.indexOf(id) !== -1;
  const toggleFav = (id) => setFavs((p) => (p.indexOf(id) !== -1 ? p.filter((x) => x !== id) : [id, ...p]));

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((a) => {
      if (cat !== "All" && a.type !== cat) return false;
      if (place === "Inside" && !(a.place === "Inside" || a.place === "Both")) return false;
      if (place === "Outside" && !(a.place === "Outside" || a.place === "Both")) return false;
      if (q) {
        const hay = (a.title + " " + a.type + " " + a.place + " " + a.blurb + " " + a.materials.join(" ")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, cat, place, query]);

  const dayMap = schedule[dayIndex] || {};

  function addToSchedule(a) {
    const map = { ...(schedule[dayIndex] || {}) };
    const empty = window.SLOTS.find((s) => !s.meal && !map[s.id]);
    if (!empty) { setJustAdded("full"); return; }
    map[empty.id] = a.id;
    setSchedule((p) => ({ ...p, [dayIndex]: map }));
    setJustAdded(a.id);
  }
  function removeSlot(slotId) {
    const map = { ...(schedule[dayIndex] || {}) };
    delete map[slotId];
    setSchedule((p) => ({ ...p, [dayIndex]: map }));
  }
  function pickForSlot(a) {
    const map = { ...(schedule[dayIndex] || {}) };
    map[pickerSlot.id] = a.id;
    setSchedule((p) => ({ ...p, [dayIndex]: map }));
    setPickerSlot(null);
  }
  function changeDay(d) { setDayIndex((i) => Math.max(0, Math.min(window.DAYS.length - 1, i + d))); }

  function openDetail(a) { setJustAdded(null); setDetail(a); }

  const TABS = [
    { id: "library", label: "Library", icon: CampIcon.Library },
    { id: "schedule", label: "Schedule", icon: CampIcon.Calendar },
    { id: "saved", label: "Saved", icon: CampIcon.Bookmark },
    { id: "add", label: "Add", icon: CampIcon.Plus },
  ];

  const titleByTab = {
    library: <React.Fragment>Camp <em>Library</em></React.Fragment>,
    schedule: <React.Fragment>The <em>Day</em></React.Fragment>,
    saved: <React.Fragment>Saved <em>Shelf</em></React.Fragment>,
    add: <React.Fragment>New <em>Entry</em></React.Fragment>,
  };
  const kickerByTab = {
    library: filtered.length + " activities",
    schedule: "Plan a day",
    saved: favs.length + " starred",
    add: "Catalog something",
  };

  return (
    <div className="app">
      {/* top bar */}
      <div className="topbar">
        <div className="topbar__brand">
          <span className="topbar__kicker">{kickerByTab[tab]}</span>
          <span className="topbar__title">{titleByTab[tab]}</span>
        </div>
        <div className="topbar__actions">
          {tab === "library" && (
            <button className={"icon-btn" + (searchOpen ? " is-on" : "")} onClick={() => { setSearchOpen((s) => !s); if (searchOpen) setQuery(""); }} aria-label="Search">
              <CampIcon.Search />
            </button>
          )}
        </div>
      </div>

      {/* library controls */}
      {tab === "library" && (
        <React.Fragment>
          <div className="viewswitch">
            <button className={view === "shelf" ? "is-active" : ""} onClick={() => setView("shelf")}><CampIcon.Shelf />Shelf</button>
            <button className={view === "deck" ? "is-active" : ""} onClick={() => setView("deck")}><CampIcon.Deck />Deck</button>
            <button className={view === "catalog" ? "is-active" : ""} onClick={() => setView("catalog")}><CampIcon.List />Catalog</button>
          </div>
          {searchOpen && (
            <div style={{ padding: "12px 18px 0" }} className="fadein">
              <input className="input" autoFocus placeholder="Search titles, tags, materials…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}
          <div className="filterbar">
            <button className={"chip" + (cat === "All" ? " is-on" : "")} onClick={() => setCat("All")}>All</button>
            {APP_CATS.map((c) => (
              <button key={c.id} className={"chip" + (cat === c.id ? " is-on" : "")} onClick={() => setCat((p) => (p === c.id ? "All" : c.id))}>{c.label}</button>
            ))}
            <span style={{ flex: "none", width: 1.5, background: "var(--line)", margin: "3px 4px" }} />
            {PLACES.map((p) => (
              <button key={p} className={"chip" + (place === p ? " is-on" : "")} onClick={() => setPlace((cur) => (cur === p ? "All" : p))}>{p}</button>
            ))}
          </div>
        </React.Fragment>
      )}

      {/* scrollable body */}
      <div className="app__scroll">
        {tab === "library" && view === "shelf" && <ShelfView items={filtered} onOpen={openDetail} isFav={isFav} onToggleFav={toggleFav} />}
        {tab === "library" && view === "deck" && <DeckView items={filtered} onOpen={openDetail} isFav={isFav} onToggleFav={toggleFav} />}
        {tab === "library" && view === "catalog" && <CatalogView items={filtered} onOpen={openDetail} isFav={isFav} onToggleFav={toggleFav} />}
        {tab === "schedule" && (
          <ScheduleView dayIndex={dayIndex} onDayChange={changeDay} dayMap={dayMap}
            onOpenSlot={(s) => setPickerSlot(s)} onRemoveSlot={removeSlot} onOpenActivity={openDetail} byId={byId} />
        )}
        {tab === "saved" && <SavedView items={all} onOpen={openDetail} isFav={isFav} onToggleFav={toggleFav} />}
        {tab === "add" && <AddView onSubmit={(a) => { setExtra((p) => [a, ...p]); setTab("library"); setCat("All"); setView("catalog"); }} />}
      </div>

      {/* tab bar */}
      <div className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "is-active" : ""} onClick={() => setTab(t.id)}>
            <t.icon /> {t.label}
          </button>
        ))}
      </div>

      {/* overlays */}
      {detail && (
        <DetailSheet activity={detail} isFav={isFav} onToggleFav={toggleFav} onClose={() => setDetail(null)}
          onAddToSchedule={addToSchedule} added={justAdded === detail.id} />
      )}
      {pickerSlot && (
        <ActivityPicker items={all} isFav={isFav} onPick={pickForSlot} onClose={() => setPickerSlot(null)}
          slotLabel={pickerSlot.time ? pickerSlot.time : "the day"} />
      )}
    </div>
  );
}

// ---------- device stage (scales the phone to fit any viewport) ----------
function PhoneFrame({ children }) {
  return (
    <div className="phone-frame">
      <div className="phone-screen">
        <div className="phone-notch" />
        {children}
      </div>
    </div>
  );
}

function Stage() {
  const DW = 372, DH = 770;
  const [scale, setScale] = React.useState(1);
  React.useEffect(() => {
    function fit() {
      const s = Math.min((window.innerWidth - 36) / DW, (window.innerHeight - 36) / DH, 1.0);
      setScale(s);
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className="stage">
      <div style={{ transform: "scale(" + scale + ")", transformOrigin: "center" }}>
        <PhoneFrame>
          <App />
        </PhoneFrame>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Stage />);
