"use client";

import { useMemo, useState } from "react";
import type { Activity, LibraryView, Schedule, Slot, TabId } from "@/lib/types";
import { ACTIVITIES, DAYS, SLOTS } from "@/lib/data";
import { useLocalStorage } from "@/lib/store";
import { CampIcon } from "./icons";
import { CatalogView, DeckView, ShelfView } from "./LibraryViews";
import { ScheduleView } from "./ScheduleView";
import { SavedView } from "./SavedView";
import { AddView } from "./AddView";
import { DetailSheet } from "./DetailSheet";
import { ActivityPicker } from "./ActivityPicker";
import { Filters, type AgeFilter, type CatFilter, type PlaceFilter } from "./Filters";

const TABS: { id: TabId; label: string; icon: (typeof CampIcon)[keyof typeof CampIcon] }[] = [
  { id: "library", label: "Library", icon: CampIcon.Library },
  { id: "schedule", label: "Schedule", icon: CampIcon.Calendar },
  { id: "saved", label: "Saved", icon: CampIcon.Bookmark },
  { id: "add", label: "Add", icon: CampIcon.Plus },
];

export function CampApp() {
  const [tab, setTab] = useState<TabId>("library");
  const [view, setView] = useLocalStorage<LibraryView>("view", "deck");
  const [cat, setCat] = useState<CatFilter>("All");
  const [place, setPlace] = useState<PlaceFilter>("All");
  const [age, setAge] = useState<AgeFilter>("All");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const [favs, setFavs] = useLocalStorage<string[]>("favs", []);
  const [extra, setExtra] = useLocalStorage<Activity[]>("extra", []);
  const [schedule, setSchedule] = useLocalStorage<Schedule>("schedule", {
    2: { s1: "boom-chicka-boom", s2: "gaga-ball", s3: "tie-dye", s4: "sponge-relay" },
  });
  const [dayIndex, setDayIndex] = useState(2);

  const [detail, setDetail] = useState<Activity | null>(null);
  const [pickerSlot, setPickerSlot] = useState<Slot | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [ratings, setRatings] = useLocalStorage<Record<string, number>>("ratings", {});

  const all = useMemo(() => {
    const base = [...extra, ...ACTIVITIES];
    return base.map((a) => (ratings[a.id] != null ? { ...a, rating: ratings[a.id] } : a));
  }, [extra, ratings]);

  const byId = useMemo(() => {
    const m: Record<string, Activity> = {};
    all.forEach((a) => (m[a.id] = a));
    return m;
  }, [all]);

  const isFav = (id: string) => favs.indexOf(id) !== -1;
  const toggleFav = (id: string) =>
    setFavs((p) => (p.indexOf(id) !== -1 ? p.filter((x) => x !== id) : [id, ...p]));
  const setRating = (id: string, val: number) => setRatings((p) => ({ ...p, [id]: val }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((a) => {
      if (cat !== "All" && a.type !== cat) return false;
      if (place === "Inside" && !(a.place === "Inside" || a.place === "Both")) return false;
      if (place === "Outside" && !(a.place === "Outside" || a.place === "Both")) return false;
      if (age !== "All" && (a.ages || []).indexOf(age) < 0) return false;
      if (q) {
        const hay = (
          a.title +
          " " +
          a.type +
          " " +
          a.place +
          " " +
          a.blurb +
          " " +
          a.materials.join(" ")
        ).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, cat, place, age, query]);

  const dayMap = schedule[dayIndex] || {};

  function addToSchedule(a: Activity) {
    const map = { ...(schedule[dayIndex] || {}) };
    const empty = SLOTS.find((s) => !s.meal && !map[s.id]);
    if (!empty) {
      setJustAdded("full");
      return;
    }
    map[empty.id] = a.id;
    setSchedule((p) => ({ ...p, [dayIndex]: map }));
    setJustAdded(a.id);
  }
  function removeSlot(slotId: string) {
    const map = { ...(schedule[dayIndex] || {}) };
    delete map[slotId];
    setSchedule((p) => ({ ...p, [dayIndex]: map }));
  }
  function pickForSlot(a: Activity) {
    if (!pickerSlot) return;
    const map = { ...(schedule[dayIndex] || {}) };
    map[pickerSlot.id] = a.id;
    setSchedule((p) => ({ ...p, [dayIndex]: map }));
    setPickerSlot(null);
  }
  function changeDay(d: number) {
    setDayIndex((i) => Math.max(0, Math.min(DAYS.length - 1, i + d)));
  }
  function openDetail(a: Activity) {
    setJustAdded(null);
    setDetail(a);
  }

  const titleByTab: Record<TabId, React.ReactNode> = {
    library: (
      <>
        Camp <em>Library</em>
      </>
    ),
    schedule: (
      <>
        The <em>Day</em>
      </>
    ),
    saved: (
      <>
        Saved <em>Shelf</em>
      </>
    ),
    add: (
      <>
        New <em>Entry</em>
      </>
    ),
  };
  const kickerByTab: Record<TabId, string> = {
    library: filtered.length + " activities",
    schedule: "Plan a day",
    saved: favs.length + " starred",
    add: "Catalog something",
  };

  return (
    <div className="stage">
      <div className="app">
        {/* desktop side navigation */}
        <nav className="sidenav" aria-label="Primary">
          <div className="sidenav__brand">
            <span className="sidenav__kicker">The counselor&rsquo;s kit</span>
            <span className="sidenav__title">
              Camp <em>Library</em>
            </span>
          </div>
          <div className="sidenav__nav">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={"sidenav__item" + (tab === t.id ? " is-active" : "")}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
              >
                <t.icon />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          {tab === "library" && (
            <Filters
              variant="rail"
              cat={cat}
              place={place}
              age={age}
              onCat={setCat}
              onPlace={setPlace}
              onAge={setAge}
            />
          )}
          <div className="sidenav__foot">
            {all.length} in the library · {favs.length} saved
          </div>
        </nav>

        {/* main column */}
        <div className="app__main">
          <div className="topbar">
            <div className="topbar__brand">
              <span className="topbar__kicker">{kickerByTab[tab]}</span>
              <span className="topbar__title">{titleByTab[tab]}</span>
            </div>
            <div className="topbar__actions">
              {tab === "library" && (
                <button
                  type="button"
                  className={"icon-btn" + (searchOpen ? " is-on" : "")}
                  onClick={() => {
                    setSearchOpen((s) => !s);
                    if (searchOpen) setQuery("");
                  }}
                  aria-label="Search"
                  aria-pressed={searchOpen}
                >
                  <CampIcon.Search />
                </button>
              )}
            </div>
          </div>

          {tab === "library" && (
            <>
              <div className="toolbar">
                <div className="viewswitch">
                  <button
                    type="button"
                    className={view === "shelf" ? "is-active" : ""}
                    onClick={() => setView("shelf")}
                  >
                    <CampIcon.Shelf />
                    Shelf
                  </button>
                  <button
                    type="button"
                    className={view === "deck" ? "is-active" : ""}
                    onClick={() => setView("deck")}
                  >
                    <CampIcon.Deck />
                    Deck
                  </button>
                  <button
                    type="button"
                    className={view === "catalog" ? "is-active" : ""}
                    onClick={() => setView("catalog")}
                  >
                    <CampIcon.List />
                    Catalog
                  </button>
                </div>
                {/* Persistent search field — desktop toolbar (hidden on phones). */}
                <div className="toolbar__search">
                  <CampIcon.Search />
                  <input
                    className="toolbar__search-input"
                    placeholder="Search titles, tags, materials…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search the library"
                  />
                </div>
              </div>
              {/* Toggled search — phone only. */}
              {searchOpen && (
                <div style={{ padding: "12px 18px 0" }} className="searchrow fadein">
                  <input
                    className="input"
                    autoFocus
                    placeholder="Search titles, tags, materials…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              )}
              {/* Filter chips — phone only; desktop uses the sidebar rail. */}
              <Filters
                variant="bar"
                cat={cat}
                place={place}
                age={age}
                onCat={setCat}
                onPlace={setPlace}
                onAge={setAge}
              />
            </>
          )}

          <div className="app__scroll">
            {tab === "library" && view === "shelf" && (
              <ShelfView items={filtered} onOpen={openDetail} isFav={isFav} onToggleFav={toggleFav} />
            )}
            {tab === "library" && view === "deck" && (
              <DeckView items={filtered} onOpen={openDetail} isFav={isFav} onToggleFav={toggleFav} />
            )}
            {tab === "library" && view === "catalog" && (
              <CatalogView items={filtered} onOpen={openDetail} isFav={isFav} onToggleFav={toggleFav} />
            )}
            {tab === "schedule" && (
              <ScheduleView
                dayIndex={dayIndex}
                onDayChange={changeDay}
                dayMap={dayMap}
                onOpenSlot={(s) => setPickerSlot(s)}
                onRemoveSlot={removeSlot}
                onOpenActivity={openDetail}
                byId={byId}
              />
            )}
            {tab === "saved" && (
              <SavedView items={all} onOpen={openDetail} isFav={isFav} onToggleFav={toggleFav} />
            )}
            {tab === "add" && (
              <AddView
                onSubmit={(a) => {
                  setExtra((p) => [a, ...p]);
                  setTab("library");
                  setCat("All");
                  setView("catalog");
                }}
              />
            )}
          </div>
        </div>

        {/* mobile tab bar */}
        <nav className="tabbar" aria-label="Primary">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? "is-active" : ""}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
            >
              <t.icon /> {t.label}
            </button>
          ))}
        </nav>

        {/* overlays */}
        {detail && (
          <DetailSheet
            activity={byId[detail.id] || detail}
            isFav={isFav}
            onToggleFav={toggleFav}
            onClose={() => setDetail(null)}
            onAddToSchedule={addToSchedule}
            added={justAdded === detail.id ? "added" : justAdded === "full" ? "full" : false}
            onSetRating={setRating}
          />
        )}
        {pickerSlot && (
          <ActivityPicker
            items={all}
            onPick={pickForSlot}
            onClose={() => setPickerSlot(null)}
            slotLabel={pickerSlot.time ? pickerSlot.time : "the day"}
          />
        )}
      </div>
    </div>
  );
}
