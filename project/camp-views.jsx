// Camp Library — shared bits + the three Library views (Shelf / Deck / Catalog)
const { code, ageLabel, groupLabel, durLabel, metaLine, ENERGY, CATEGORIES } = window.CampData;

function EnergyMeter({ level }) {
  return (
    <span className="meter" aria-label={ENERGY[level] + " energy"}>
      {[1, 2, 3].map((n) => <i key={n} className={n <= level ? "on" : ""} />)}
    </span>
  );
}

// Approval rating → warm sequential color scale (low = clay, high = green) so we can rank by color.
const RATING_COLORS = { 1: "#cda08a", 2: "#d8b78f", 3: "#dcc587", 4: "#aebf86", 5: "#85a45f" };
const RATING_NEUTRAL = "#e6dcc6";   // unrated / not run yet — a plain, blank cover
const RATING_WORD = { 0: "Not run yet", 1: "Rough day", 2: "So-so", 3: "Solid", 4: "Crowd-pleaser", 5: "Camp favorite" };
function ratingColor(r) { if (!r || r < 1) return RATING_NEUTRAL; return RATING_COLORS[Math.max(1, Math.min(5, Math.round(r)))]; }

function ApprovalDots({ rating }) {
  const c = ratingColor(rating);
  return (
    <span className="meter" aria-label={"Approval " + rating + " of 5"}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={n <= rating ? "on" : ""} style={n <= rating ? { background: c, borderColor: c } : null} />
      ))}
    </span>
  );
}

function StarButton({ on, onToggle, stop = true }) {
  return (
    <button
      className={"star" + (on ? " is-on" : "")}
      aria-label={on ? "Remove from saved" : "Save"}
      onClick={(e) => { if (stop) e.stopPropagation(); onToggle(); }}
    >
      <CampIcon.Bookmark />
    </button>
  );
}

function mono(title) { return title.trim().charAt(0).toUpperCase(); }
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

function Plate({ activity, big }) {
  return (
    <div className={"plate" + (big ? " plate--big" : "")}>
      <div className="plate__grid" />
      {!big && <span className="plate__cat">{activity.type}</span>}
      <span className="plate__mono">{mono(activity.title)}</span>
    </div>
  );
}

// ---------- Shelf view ----------
// Book covers tint by approval rating (low = clay → high = green) so the shelf ranks by color.
function spineWidth(a) { return 30 + (hash(a.id + "w") % 5) * 4; }      // 30–46
function spinePadTop(a) { return 10 + (hash(a.id + "h") % 5) * 9; }      // extra cover space above the title

function ShelfView({ items, onOpen, isFav, onToggleFav }) {
  const groups = CATEGORIES
    .map((c) => ({ cat: c, list: items.filter((a) => a.type === c.id) }))
    .filter((g) => g.list.length);

  if (!groups.length) return <EmptyResults />;

  return (
    <div className="fadein shelfwrap">
      {groups.map((g) => (
        <section className="shelf" key={g.cat.id}>
          <div className="shelf__head">
            <span className="shelf__label">{g.cat.label}</span>
          </div>
          <div className="rail">
            {g.list.map((a) => (
              <div
                className="spine"
                key={a.id}
                style={{ width: spineWidth(a), paddingTop: spinePadTop(a), background: ratingColor(a.rating) }}
                onClick={() => onOpen(a)}
                role="button"
                title={a.title}
              >
                {isFav(a.id) && <span className="spine__fav"><CampIcon.Bookmark /></span>}
                <span className="spine__title">{a.title}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      <div style={{ height: 16 }} />
    </div>
  );
}

// ---------- Deck view ----------
function DeckView({ items, onOpen, isFav, onToggleFav }) {
  if (!items.length) return <EmptyResults />;
  return (
    <div className="deck fadein">
      {items.map((a) => (
        <div className="deck-card" key={a.id} onClick={() => onOpen(a)} role="button">
          <div className="plate" style={{ background: ratingColor(a.rating) }}>
            <div className="plate__grid" />
            <span className="plate__cat">{a.type}</span>
            <span className="plate__star">
              <StarButton on={isFav(a.id)} onToggle={() => onToggleFav(a.id)} />
            </span>
            <span className="plate__mono">{mono(a.title)}</span>
          </div>
          <div className="deck-card__body">
            <div className="deck-card__title">{a.title}</div>
            <div className="deck-card__meta">{durLabel(a)} · {a.place}<br />{ageLabel(a)} · {ENERGY[a.energy]}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Catalog view ----------
function CatalogView({ items, onOpen, isFav, onToggleFav }) {
  const [sort, setSort] = React.useState("az");
  if (!items.length) return <EmptyResults />;
  const sorted = [...items].sort((a, b) =>
    sort === "rating" ? (b.rating - a.rating) || a.title.localeCompare(b.title) : a.title.localeCompare(b.title));
  return (
    <div className="catalog fadein">
      <div className="catalog__head">
        <span className="label">{sorted.length} entries</span>
        <button className="sortbtn" onClick={() => setSort((s) => (s === "az" ? "rating" : "az"))}>
          {sort === "az" ? "A–Z" : "Top rated"}
        </button>
      </div>
      {sorted.map((a) => (
        <div className="cat-row" key={a.id} onClick={() => onOpen(a)} role="button">
          <div className="cat-code" style={{ background: ratingColor(a.rating) }}>{code(a)}</div>
          <div className="cat-main">
            <div className="cat-title">{a.title}</div>
            <div className="cat-stamps">
              <span className="stamp">{a.type}</span>
              <span className="stamp">{a.place}</span>
              <span className="stamp">{durLabel(a)}</span>
              <span className="stamp">{ENERGY[a.energy]}</span>
            </div>
          </div>
          <StarButton on={isFav(a.id)} onToggle={() => onToggleFav(a.id)} />
        </div>
      ))}
      <div style={{ height: 10 }} />
    </div>
  );
}

function EmptyResults() {
  return (
    <div className="empty">
      <div className="empty__mark"><CampIcon.Search /></div>
      <div className="empty__title">Nothing on this shelf</div>
      <div className="empty__sub">No activities match these filters. Loosen a tag or clear the search.</div>
    </div>
  );
}

Object.assign(window, { EnergyMeter, ApprovalDots, ratingColor, RATING_WORD, StarButton, Plate, ShelfView, DeckView, CatalogView, EmptyResults, mono });
