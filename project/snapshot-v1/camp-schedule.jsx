// Camp Library — Schedule, Saved, and Add (catalog-entry) views
const SD = window.CampData;

const SLOTS = [
  { id: "s1", time: "9:00" },
  { id: "s2", time: "10:30" },
  { id: "lunch", meal: true, label: "Lunch & rest hour" },
  { id: "s3", time: "1:30" },
  { id: "s4", time: "3:00" },
  { id: "s5", time: "4:30" },
];

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o} className={value === o ? "is-on" : ""} onClick={() => onChange(o)} type="button">{o}</button>
      ))}
    </div>
  );
}

// ---------- Schedule ----------
function ScheduleView({ dayIndex, onDayChange, dayMap, onOpenSlot, onRemoveSlot, onOpenActivity, byId }) {
  const filled = SLOTS.filter((s) => !s.meal && dayMap[s.id]).length;
  return (
    <div className="fadein">
      <div className="dayhead">
        <div>
          <div className="dayhead__title"><em>{DAYS[dayIndex]}</em></div>
          <div className="dayhead__sub">Week 1 · {filled} {filled === 1 ? "activity" : "activities"} planned</div>
        </div>
        <div className="daynav">
          <button className="icon-btn" onClick={() => onDayChange(-1)} aria-label="Previous day"><CampIcon.ChevronLeft /></button>
          <button className="icon-btn" onClick={() => onDayChange(1)} aria-label="Next day"><CampIcon.ChevronRight /></button>
        </div>
      </div>

      <div className="timeline">
        {SLOTS.map((s) => {
          if (s.meal) return <div className="slot" key={s.id}><div className="slot__time" /><div className="slot__box slot__box--meal">{s.label}</div></div>;
          const act = dayMap[s.id] ? byId[dayMap[s.id]] : null;
          return (
            <div className="slot" key={s.id}>
              <div className="slot__time">{s.time}</div>
              {act ? (
                <div className="slot__box slot__box--filled">
                  <div className="slot__act" onClick={() => onOpenActivity(act)}>
                    <div className="slot__act-title">{act.title}</div>
                    <div className="slot__act-meta">{act.type} · {SD.durLabel(act)} · {act.place}</div>
                  </div>
                  <button className="icon-btn" onClick={() => onRemoveSlot(s.id)} aria-label="Remove"><CampIcon.Trash /></button>
                </div>
              ) : (
                <div className="slot__box slot__box--empty" onClick={() => onOpenSlot(s)}>
                  <CampIcon.Plus /><span>Add activity</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ height: 8 }} />
    </div>
  );
}

// ---------- Saved ----------
function SavedView({ items, onOpen, isFav, onToggleFav }) {
  const saved = items.filter((a) => isFav(a.id));
  if (!saved.length) {
    return (
      <div className="empty">
        <div className="empty__mark"><CampIcon.Bookmark /></div>
        <div className="empty__title">Nothing saved yet</div>
        <div className="empty__sub">Tap the star on any activity to keep it here — your go-to shortlist for a rainy day.</div>
      </div>
    );
  }
  return (
    <div className="catalog fadein" style={{ paddingTop: 14 }}>
      <span className="label">{saved.length} saved</span>
      {saved.sort((a, b) => a.title.localeCompare(b.title)).map((a) => (
        <div className="cat-row" key={a.id} onClick={() => onOpen(a)} role="button">
          <div className="cat-code">{SD.code(a)}</div>
          <div className="cat-main">
            <div className="cat-title">{a.title}</div>
            <div className="cat-stamps">
              <span className="stamp">{a.type}</span><span className="stamp">{a.place}</span>
              <span className="stamp">{SD.durLabel(a)}</span><span className="stamp">{ENERGY[a.energy]}</span>
            </div>
          </div>
          <StarButton on={true} onToggle={() => onToggleFav(a.id)} />
        </div>
      ))}
      <div style={{ height: 10 }} />
    </div>
  );
}

// ---------- Add ----------
function AddView({ onSubmit }) {
  const [f, setF] = React.useState({
    title: "", type: "Game", place: "Outside", ageMin: "8", ageMax: "12",
    durationMin: "20", groupMin: "", groupMax: "", energy: "Lively", prep: "Low",
    blurb: "", materials: "", steps: "", notes: "", safety: "",
  });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const onIn = (k) => (e) => set(k)(e.target.value);
  const valid = f.title.trim().length > 0;

  function submit() {
    if (!valid) return;
    const energyMap = { Calm: 1, Lively: 2, Rowdy: 3 };
    const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);
    const a = {
      id: f.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36),
      title: f.title.trim(), type: f.type, place: f.place,
      ageMin: parseInt(f.ageMin || "5", 10), ageMax: parseInt(f.ageMax || "12", 10),
      durationMin: parseInt(f.durationMin || "20", 10),
      groupMin: f.groupMin ? parseInt(f.groupMin, 10) : null,
      groupMax: f.groupMax ? parseInt(f.groupMax, 10) : null,
      energy: energyMap[f.energy], prep: f.prep,
      blurb: f.blurb.trim() || "A new entry in the library.",
      materials: f.materials.split(",").map((x) => x.trim()).filter(Boolean),
      steps: lines(f.steps), notes: f.notes.trim() || "—", safety: f.safety.trim() || "—",
    };
    onSubmit(a);
  }

  return (
    <div className="form fadein">
      <div className="field">
        <label className="field__label">Title</label>
        <input className="input" placeholder="e.g. Giant Parachute" value={f.title} onChange={onIn("title")} />
      </div>
      <div className="field">
        <label className="field__label">Category</label>
        <select className="select" value={f.type} onChange={onIn("type")}>
          {SD.CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="field__label">Inside / Outside</label>
        <Seg options={["Inside", "Outside", "Both"]} value={f.place} onChange={set("place")} />
      </div>
      <div className="row2">
        <div className="field"><label className="field__label">Age min</label><input className="input" inputMode="numeric" value={f.ageMin} onChange={onIn("ageMin")} /></div>
        <div className="field"><label className="field__label">Age max</label><input className="input" inputMode="numeric" value={f.ageMax} onChange={onIn("ageMax")} /></div>
      </div>
      <div className="row2">
        <div className="field"><label className="field__label">Duration (min)</label><input className="input" inputMode="numeric" value={f.durationMin} onChange={onIn("durationMin")} /></div>
        <div className="field"><label className="field__label">Energy</label><Seg options={["Calm", "Lively", "Rowdy"]} value={f.energy} onChange={set("energy")} /></div>
      </div>
      <div className="row2">
        <div className="field"><label className="field__label">Group min</label><input className="input" inputMode="numeric" placeholder="any" value={f.groupMin} onChange={onIn("groupMin")} /></div>
        <div className="field"><label className="field__label">Group max</label><input className="input" inputMode="numeric" placeholder="any" value={f.groupMax} onChange={onIn("groupMax")} /></div>
      </div>
      <div className="field">
        <label className="field__label">Prep effort</label>
        <Seg options={["None", "Low", "Medium", "High"]} value={f.prep} onChange={set("prep")} />
      </div>
      <div className="field">
        <label className="field__label">One-line description</label>
        <input className="input" placeholder="The hook, in a sentence." value={f.blurb} onChange={onIn("blurb")} />
      </div>
      <div className="field">
        <label className="field__label">Materials <span style={{ textTransform: "none", letterSpacing: 0 }}>(comma-separated)</span></label>
        <input className="input" placeholder="flags, cones, pinnies" value={f.materials} onChange={onIn("materials")} />
      </div>
      <div className="field">
        <label className="field__label">How to play <span style={{ textTransform: "none", letterSpacing: 0 }}>(one step per line)</span></label>
        <textarea className="textarea" placeholder={"Split into teams…\nPlace the flags…"} value={f.steps} onChange={onIn("steps")} />
      </div>
      <div className="field">
        <label className="field__label">Notes & variations</label>
        <textarea className="textarea" style={{ minHeight: 64 }} value={f.notes} onChange={onIn("notes")} />
      </div>
      <div className="field">
        <label className="field__label">Safety</label>
        <textarea className="textarea" style={{ minHeight: 64 }} value={f.safety} onChange={onIn("safety")} />
      </div>
      <button className="btn btn--primary btn--block" disabled={!valid} onClick={submit}>
        <CampIcon.Plus />Add to library
      </button>
      <div style={{ height: 8 }} />
    </div>
  );
}

Object.assign(window, { ScheduleView, SavedView, AddView, SLOTS, DAYS });
