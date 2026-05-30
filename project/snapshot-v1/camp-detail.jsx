// Camp Library — Detail sheet + Activity picker overlays
const D = window.CampData;

function Fact({ k, children }) {
  return (
    <div className="facts__cell">
      <span className="facts__k">{k}</span>
      <span className="facts__v">{children}</span>
    </div>
  );
}

function Block({ num, name, children }) {
  return (
    <div className="block">
      <div className="block__label">
        <span className="block__num">{num}</span>
        <span className="block__name">{name}</span>
      </div>
      {children}
    </div>
  );
}

function DetailSheet({ activity: a, isFav, onToggleFav, onClose, onAddToSchedule, added }) {
  if (!a) return null;
  return (
    <React.Fragment>
      <div className="scrim" onClick={onClose} />
      <div className="overlay overlay--sheet" role="dialog" aria-label={a.title}>
        <div className="overlay__bar">
          <div className="overlay__handle" />
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CampIcon.Close /></button>
          <div className="overlay__bar-spacer" />
          <StarButton on={isFav(a.id)} onToggle={() => onToggleFav(a.id)} stop={false} />
        </div>

        <div className="overlay__body">
          <div className="detail__hero">
            <div className="plate__grid" />
            <span className="detail__mono">{window.mono(a.title)}</span>
          </div>

          <div className="detail__pad">
            <div className="detail__eyebrow">{D.code(a)} · {a.type}</div>
            <h2 className="detail__title">{a.title}</h2>
            <p className="detail__blurb">{a.blurb}</p>

            <div className="detail__stamps">
              <span className="stamp stamp--accent">{a.place}</span>
              <span className="stamp">{D.ageLabel(a)}</span>
              <span className="stamp">{ENERGY[a.energy]}</span>
              <span className="stamp">{a.prep === "None" ? "No prep" : a.prep + " prep"}</span>
            </div>

            <div className="facts">
              <Fact k="Ages">{a.ageMax >= 18 ? a.ageMin + "+" : a.ageMin + "–" + a.ageMax}</Fact>
              <Fact k="Group size">{D.groupLabel(a)}</Fact>
              <Fact k="Time"><span>{a.durationMin}</span><small>min</small></Fact>
              <Fact k="Energy"><EnergyMeter level={a.energy} /><small>{ENERGY[a.energy]}</small></Fact>
              <Fact k="Place">{a.place}</Fact>
              <Fact k="Prep">{a.prep}</Fact>
            </div>

            <Block num="i" name="Materials">
              {a.materials.length === 0
                ? <span className="stamp">None needed</span>
                : <div className="matlist">{a.materials.map((m, i) => <span className="stamp" key={i}>{m}</span>)}</div>}
            </Block>

            <Block num="ii" name="How to play">
              <ol className="steps">{a.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </Block>

            <Block num="iii" name="Notes & variations">
              <p className="prose">{a.notes}</p>
            </Block>

            <Block num="iv" name="Safety">
              <div className="safety">{a.safety}</div>
            </Block>
          </div>
        </div>

        <div className="detail__actions">
          <button className="btn btn--primary btn--block" onClick={() => onAddToSchedule(a)}>
            {added ? <CampIcon.Check /> : <CampIcon.Calendar />}
            {added ? "Added to schedule" : "Add to schedule"}
          </button>
        </div>
      </div>
    </React.Fragment>
  );
}

// ---------- Activity picker (for filling a schedule slot) ----------
function ActivityPicker({ items, isFav, onPick, onClose, slotLabel }) {
  const [q, setQ] = React.useState("");
  const list = items
    .filter((a) => a.title.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.title.localeCompare(b.title));
  return (
    <React.Fragment>
      <div className="scrim" onClick={onClose} />
      <div className="overlay overlay--sheet" role="dialog" aria-label="Choose an activity">
        <div className="overlay__bar">
          <div className="overlay__handle" />
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CampIcon.Close /></button>
          <div className="overlay__bar-spacer" />
        </div>
        <div className="picker__head">
          <div className="label" style={{ marginBottom: 6 }}>Add to {slotLabel}</div>
          <div className="picker__q">What goes here?</div>
        </div>
        <div style={{ padding: "10px 18px 0" }}>
          <div className="field">
            <input className="input" placeholder="Search the library…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="overlay__body">
          <div className="catalog">
            {list.map((a) => (
              <div className="cat-row" key={a.id} onClick={() => onPick(a)} role="button">
                <div className="cat-code">{D.code(a)}</div>
                <div className="cat-main">
                  <div className="cat-title">{a.title}</div>
                  <div className="cat-stamps">
                    <span className="stamp">{a.type}</span>
                    <span className="stamp">{D.durLabel(a)}</span>
                    <span className="stamp">{a.place}</span>
                  </div>
                </div>
                <button className="icon-btn" aria-label="Add"><CampIcon.Plus /></button>
              </div>
            ))}
            {!list.length && <div className="empty"><div className="empty__title">No matches</div></div>}
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { DetailSheet, ActivityPicker });
