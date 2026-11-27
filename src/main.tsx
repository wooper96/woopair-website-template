import { ArrowLeft, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadSite, type EventSummary, type Site } from "./published-tournament";
import { TournamentPage } from "./tournament-page";
import "./site.css";

const eventId = new URLSearchParams(window.location.search).get("event");
const phaseLabels = { SETUP: "Roster open", LIVE: "Live", COMPLETED: "Completed" };

function formatDate(event: EventSummary) {
  return event.eventDate
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(event.eventDate))
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(event.updatedAt));
}

function eventTime(event: EventSummary) {
  return Date.parse(event.eventDate ?? event.updatedAt);
}

function LeagueHome({ tournaments }: { tournaments: EventSummary[] }) {
  const current = tournaments.filter((event) => event.phase !== "COMPLETED")
    .sort((a, b) => Number(b.phase === "LIVE") - Number(a.phase === "LIVE") || eventTime(b) - eventTime(a));
  const completed = tournaments.filter((event) => event.phase === "COMPLETED").sort((a, b) => eventTime(b) - eventTime(a));
  return <div className="league-events">
    <EventList title="Current tournaments" events={current} empty={tournaments.length
      ? "No current tournaments." : "No tournaments have been published yet."} />
    <EventList title="Completed tournaments" events={completed} empty="No completed tournaments." />
  </div>;
}

function EventList({ title, events, empty }: { title: string; events: EventSummary[]; empty: string }) {
  return <section>
    <h2 className="view-title">{title}</h2>
    {events.length ? <ul className="item-list event-list">
      {events.map((event) => <li key={event.id}>
        <a href={`?event=${encodeURIComponent(event.id)}`} className="event-link">
          <span className="event-entry"><strong>{event.displayName}</strong><span className="muted small">{formatDate(event)}</span></span>
          {event.phase !== "COMPLETED" && <span className={`phase phase-${event.phase.toLowerCase()}`}>{phaseLabels[event.phase]}</span>}
        </a>
      </li>)}
    </ul> : <p className="empty-state">{empty}</p>}
  </section>;
}

function App() {
  const [site, setSite] = useState<Site | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef<Site | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setRefreshing(true);
    const timeout = window.setTimeout(() => controller.abort("timeout"), 12000);
    try {
      const next = await loadSite(eventId, latest.current, controller.signal);
      if (inFlight.current !== controller) return;
      latest.current = next;
      setSite(next);
      setFailed(false);
    } catch {
      if (inFlight.current === controller) setFailed(true);
    } finally {
      window.clearTimeout(timeout);
      if (inFlight.current === controller) {
        inFlight.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const whenVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = window.setInterval(whenVisible, 30000);
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", whenVisible);
      const controller = inFlight.current;
      inFlight.current = null;
      controller?.abort();
    };
  }, [refresh]);

  const event = site?.event;
  const leagueName = site?.leagueName ?? "WooPair league";
  useEffect(() => {
    document.title = event ? `${event.displayName} · ${leagueName}` : leagueName;
  }, [event, leagueName]);

  return <main className="site-shell">
    <header className="site-header">
      {eventId && <a className="back-link" href="./"><ArrowLeft size={17} aria-hidden="true" /> {leagueName}</a>}
      <div className="heading-line">
        <h1>{event?.displayName ?? leagueName}</h1>
        {event && <span className={`phase phase-${event.phase.toLowerCase()}`}>{phaseLabels[event.phase]}</span>}
      </div>
      <div className="publication-bar">
        <span className="muted small" role="status">
          {event && `Updated ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(event.updatedAt))}`}
        </span>
        <button type="button" className="quiet-button refresh-button" aria-disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw size={16} aria-hidden="true" /> {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {failed && <p className="notice" role="status">{site
        ? "The latest update is unavailable. Showing the last published version while WooPair retries."
        : "Tournament data is unavailable. Use Refresh to try again."}</p>}
    </header>
    {!site ? !failed && <p className="empty-state" role="status">Loading tournaments…</p> :
      event ? <TournamentPage key={event.id} event={event} /> :
        eventId ? <p className="empty-state">This tournament has not been published on this league site.</p> :
          <LeagueHome tournaments={site.tournaments} />}
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
