import * as Tabs from "@radix-ui/react-tabs";
import { Check, Pin, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Division, Event, NumberedRound, Pairing, Player } from "./published-tournament";
import {
  defaultDivision, hasStandings, hasTable, matchesName, numberedRounds, orderDivisions, orderPairings,
  pairedPlayerIds, recordsThrough, type PlayerRecord,
} from "./tournament-view";

type Preferences = {
  division: string;
  view: string;
  pinnedPlayer: string | null;
  incompleteOnly: boolean;
  pairingsSort: "table" | "name";
  rosterSort: "asc" | "desc";
  rosterStatus: string;
  allPlayers: boolean;
  search: string;
};

const defaults: Preferences = {
  division: "", view: "", pinnedPlayer: null, incompleteOnly: false, pairingsSort: "table",
  rosterSort: "asc", rosterStatus: "", allPlayers: false, search: "",
};

const statusLabels = { ACTIVE: "Active", DROPPED: "Dropped", DISQUALIFIED: "Disqualified", UNKNOWN: "Unknown" };
const viewOfRound = (round: NumberedRound) => `round-${round.roundNumber}`;
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const byName = (a: Player, b: Player) => collator.compare(a.displayName, b.displayName) || collator.compare(a.eventCode ?? "", b.eventCode ?? "");

function readPreferences(key: string): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!stored || typeof stored !== "object") return defaults;
    return {
      division: typeof stored.division === "string" ? stored.division : "",
      view: typeof stored.view === "string" ? stored.view : "",
      pinnedPlayer: typeof stored.pinnedPlayer === "string" ? stored.pinnedPlayer : null,
      incompleteOnly: stored.incompleteOnly === true,
      pairingsSort: stored.pairingsSort === "name" ? "name" : "table",
      rosterSort: stored.rosterSort === "desc" ? "desc" : "asc",
      rosterStatus: Object.hasOwn(statusLabels, stored.rosterStatus) ? stored.rosterStatus : "",
      allPlayers: stored.allPlayers === true,
      search: typeof stored.search === "string" ? stored.search.slice(0, 80) : "",
    };
  } catch {
    return defaults;
  }
}

function PlayerName({ player }: { player: Player | undefined }) {
  return <span className="player-name">
    {player?.displayName ?? "Player unavailable"}
    {player?.eventCode && <span className="event-code">{player.eventCode}</span>}
  </span>;
}

function PinButton({ player, pinned, onPin }: { player: Player; pinned: boolean; onPin: (id: string) => void }) {
  const playerLabel = player.eventCode ? `${player.displayName}, code ${player.eventCode}` : player.displayName;
  return <button className="icon-button pin-button" type="button" aria-pressed={pinned}
    aria-label={`${pinned ? "Unpin" : "Pin"} ${playerLabel}`} onClick={() => onPin(player.id)}>
    <Pin size={17} aria-hidden="true" fill={pinned ? "currentColor" : "none"} />
  </button>;
}

function PlayerSearch({ value, onChange, pairings, hasDuplicates }: {
  value: string; onChange: (value: string) => void; pairings?: boolean; hasDuplicates: boolean;
}) {
  const id = useId();
  return <div className="player-search">
    <label htmlFor={id} className="field-label">{pairings ? "Find my table" : "Find a player"}</label>
    <div className="search-box">
      <Search size={17} aria-hidden="true" />
      <input id={id} type="search" placeholder="Search by name" value={value} maxLength={80}
        aria-describedby={hasDuplicates ? `${id}-hint` : undefined} onChange={(event) => onChange(event.target.value)} />
    </div>
    {hasDuplicates && <p className="muted small" id={`${id}-hint`}>Same name? Ask your organizer for your four-digit event code.</p>}
  </div>;
}

function containsDuplicateName(players: (Player | undefined)[], query: string) {
  return Boolean(query.trim() && !/^\d{4}$/.test(query.trim()) &&
    players.some((player) => player?.eventCode && matchesName(player, query)));
}

function RosterView({ roster, division, preferences, change, onPin }: {
  roster: Player[]; division: Division | undefined; preferences: Preferences;
  change: (patch: Partial<Preferences>) => void; onPin: (id: string) => void;
}) {
  const members = division?.playerIds && new Set(division.playerIds);
  const scoped = members && !preferences.allPlayers ? roster.filter(({ id }) => members.has(id)) : roster;
  const players = scoped.filter((player) => (!preferences.rosterStatus || player.status === preferences.rosterStatus) &&
    matchesName(player, preferences.search)).sort((first, second) => preferences.rosterSort === "asc" ? byName(first, second) : byName(second, first));
  const id = useId();
  return <section aria-labelledby={`${id}-heading`} className="view-section">
    <h2 id={`${id}-heading`} className="view-title">Roster</h2>
    <PlayerSearch value={preferences.search} onChange={(search) => change({ search })}
      hasDuplicates={containsDuplicateName(scoped, preferences.search)} />
    <div className="view-controls">
      <label className="select-field">Status
        <select value={preferences.rosterStatus} onChange={(event) => change({ rosterStatus: event.target.value })}>
          <option value="">All statuses</option>
          {Object.entries(statusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
        </select>
      </label>
      <label className="select-field">Sort
        <select value={preferences.rosterSort} onChange={(event) => change({ rosterSort: event.target.value === "desc" ? "desc" : "asc" })}>
          <option value="asc">Name A–Z</option>
          <option value="desc">Name Z–A</option>
        </select>
      </label>
      {members && <label className="check-field">
        <input type="checkbox" checked={preferences.allPlayers} onChange={(event) => change({ allPlayers: event.target.checked })} />
        All players
      </label>}
    </div>
    {!players.length ? <p className="empty-state" role="status">{roster.length ? "No matching players." : "The roster has no players yet."}</p> :
      <ul className="item-list roster-list" aria-label="Players">
        {players.map((player) => <li key={player.id}>
          <div><PlayerName player={player} /><span className="roster-status">{statusLabels[player.status]}</span></div>
          <PinButton player={player} pinned={preferences.pinnedPlayer === player.id} onPin={onPin} />
        </li>)}
      </ul>}
  </section>;
}

function PairingPlayer({ player, record, pinned, winner, onPin }: {
  player: Player | undefined; record: PlayerRecord | undefined; pinned: boolean; winner: boolean;
  onPin: (id: string) => void;
}) {
  return <div className={`pairing-player${winner ? " winner" : ""}`}>
    <div className="pairing-name-line">
      <PlayerName player={player} />
      {player && <PinButton player={player} pinned={pinned} onPin={onPin} />}
    </div>
    {record ? <span className="record" aria-label={`${record.wins} wins, ${record.losses} losses, ${record.ties} ties, ${record.wins * 3 + record.ties} points`}>
      {record.wins}–{record.losses}–{record.ties} ({record.wins * 3 + record.ties})
    </span> : <span className="record" aria-label="Record unavailable">—</span>}
    {winner && <span className="winner-label"><Check size={15} aria-hidden="true" /> Winner</span>}
  </div>;
}

function RoundView({ round, rounds, players, preferences, change, onPin }: {
  round: NumberedRound; rounds: NumberedRound[]; players: Map<string, Player>; preferences: Preferences;
  change: (patch: Partial<Preferences>) => void; onPin: (id: string) => void;
}) {
  const headingId = useId();
  const filterRef = useRef<HTMLInputElement>(null);
  const focusedPairing = useRef<string | null>(null);
  const getRecord = useMemo(() => recordsThrough(rounds, round.roundNumber), [rounds, round.roundNumber]);
  const filtered = round.pairings.filter((pairing) =>
    (!preferences.incompleteOnly || (hasTable(pairing) && pairing.result.outcome === "PENDING")) &&
    pairedPlayerIds(pairing).some((id) => matchesName(players.get(id), preferences.search)));
  const byTable = (a: Pairing, b: Pairing) =>
    (hasTable(a) ? a.tableNumber! : Infinity) - (hasTable(b) ? b.tableNumber! : Infinity) || 0;
  const ordered = orderPairings(filtered, preferences.pinnedPlayer, (first, second) =>
    (preferences.pairingsSort === "name"
      ? collator.compare(players.get(first.player1Id)?.displayName ?? "", players.get(second.player1Id)?.displayName ?? "")
      : 0) || byTable(first, second));

  useEffect(() => {
    if (focusedPairing.current && !ordered.some(({ id }) => id === focusedPairing.current)) {
      if (document.activeElement === document.body) filterRef.current?.focus();
      focusedPairing.current = null;
    }
  }, [ordered]);

  return <section aria-labelledby={headingId} className="view-section">
    <h2 id={headingId} className="view-title">Round {round.roundNumber}</h2>
    <PlayerSearch value={preferences.search} onChange={(search) => change({ search })} pairings
      hasDuplicates={containsDuplicateName(round.pairings.flatMap(pairedPlayerIds).map((id) => players.get(id)), preferences.search)} />
    <div className="view-controls round-controls">
      <label className="check-field">
        <input ref={filterRef} type="checkbox" role="switch" checked={preferences.incompleteOnly}
          onChange={(event) => change({ incompleteOnly: event.target.checked })} />
        Incomplete tables only
      </label>
      <label className="select-field">Sort
        <select value={preferences.pairingsSort} onChange={(event) => change({ pairingsSort: event.target.value === "name" ? "name" : "table" })}>
          <option value="table">Table number</option>
          <option value="name">Player name</option>
        </select>
      </label>
    </div>
    {!ordered.length ? <p className="empty-state" role="status">{!round.pairings.length
      ? "No pairings have been published for this round." : preferences.search.trim()
        ? "No matching pairings." : "No incomplete tables in this round."}</p> :
      <ul className="item-list pairing-list" aria-label={`Round ${round.roundNumber} pairings`}>
        {ordered.map((pairing) => {
          const { player1Id, player2Id, result: { outcome } } = pairing;
          const bye = outcome === "BYE" && !player2Id;
          const numbered = hasTable(pairing) && !bye;
          const player1 = players.get(player1Id);
          const player2 = player2Id ? players.get(player2Id) : undefined;
          return <li key={pairing.id} className="pairing-row" onFocusCapture={() => { focusedPairing.current = pairing.id; }}>
            <PairingPlayer player={player1} record={player1 && getRecord(player1Id)}
              pinned={preferences.pinnedPlayer === player1Id} winner={outcome === "PLAYER1_WIN" || bye} onPin={onPin} />
            <div className="assignment">
              {numbered ? <><span className="assignment-caption">Table</span><strong>{pairing.tableNumber}</strong></> :
                <strong className="assignment-text">{bye ? "Bye" : "No table"}</strong>}
              {outcome === "TIE" && <span className="assignment-caption">Tie</span>}
              {outcome === "UNPAIRED_LOSS" && <span className="assignment-caption">Loss</span>}
            </div>
            {player2Id && <PairingPlayer player={player2} record={player2 && getRecord(player2Id)}
              pinned={preferences.pinnedPlayer === player2Id} winner={outcome === "PLAYER2_WIN"} onPin={onPin} />}
          </li>;
        })}
      </ul>}
  </section>;
}

function StandingsView({ division, players }: { division: Division; players: Map<string, Player> }) {
  const groups = division.finalStandings?.filter(({ placements }) => placements.length) ?? [];
  return <section className="view-section">
    <h2 className="view-title">Final standings</h2>
    {groups.map(({ placements }, index) => <table className="standings-table" key={index}>
      <caption className={groups.length > 1 ? "" : "sr-only"}>
        {groups.length > 1 ? `Ranking group ${index + 1}` : `${division.label} final standings`}
      </caption>
      <thead><tr><th scope="col">Place</th><th scope="col">Player</th></tr></thead>
      <tbody>
        {placements.toSorted((first, second) => first.place - second.place).map(({ place, playerId }) =>
          <tr key={playerId}><td>{place}</td><td><PlayerName player={players.get(playerId)} /></td></tr>)}
      </tbody>
    </table>)}
  </section>;
}

export function TournamentPage({ event }: { event: Event }) {
  const key = `woopair:${window.location.pathname}:${event.id}`;
  const [preferences, setPreferences] = useState(() => readPreferences(key));
  const divisions = useMemo(() => orderDivisions(event.divisions), [event.divisions]);
  const division = divisions.find(({ id }) => id === preferences.division) ?? defaultDivision(divisions);
  const rounds = useMemo(() => numberedRounds(division), [division]);
  const latest = rounds.at(-1);
  const standings = hasStandings(division);
  const previousLatest = useRef({ divisionId: division?.id, roundNumber: latest?.roundNumber });
  const players = useMemo(() => new Map(event.roster.map((player) => [player.id, player])), [event.roster]);
  const selectedRound = rounds.find((round) => viewOfRound(round) === preferences.view);
  const defaultView = event.phase === "COMPLETED" && standings ? "standings" :
    latest && rounds.some(({ pairings }) => pairings.length) ? viewOfRound(latest) : "roster";
  const view = preferences.view === "roster" || (preferences.view === "standings" && standings) || selectedRound
    ? preferences.view : defaultView;
  const round = rounds.find((item) => viewOfRound(item) === view);

  function change(patch: Partial<Preferences>) {
    setPreferences((previous) => ({ ...previous, ...patch }));
  }

  function chooseDivision(id: string) {
    const next = divisions.find((item) => item.id === id);
    const nextLatest = numberedRounds(next).at(-1);
    change({ division: id, view: view === "roster" ? "roster" : view === "standings" && hasStandings(next)
      ? "standings" : nextLatest ? viewOfRound(nextLatest) : "" });
  }

  function togglePin(id: string) {
    setPreferences((previous) => ({ ...previous, pinnedPlayer: previous.pinnedPlayer === id ? null : id }));
  }

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { /* Browsing without storage still works. */ }
  }, [key, preferences]);

  useEffect(() => {
    const previous = previousLatest.current;
    previousLatest.current = { divisionId: division?.id, roundNumber: latest?.roundNumber };
    if (previous.divisionId === division?.id && previous.roundNumber !== undefined && latest &&
        latest.roundNumber > previous.roundNumber) {
      setPreferences((current) => current.view.startsWith("round-") ? { ...current, view: viewOfRound(latest) } : current);
    }
  }, [division?.id, latest]);

  const contents = <Tabs.Root value={view} onValueChange={(next) => change({ view: next })}>
    <Tabs.List className="round-tabs" aria-label="Roster, rounds and standings">
      <Tabs.Trigger value="roster">Roster</Tabs.Trigger>
      {rounds.map((item) => <Tabs.Trigger value={viewOfRound(item)} key={item.id} aria-label={`Round ${item.roundNumber}`}>
        {item.roundNumber}
      </Tabs.Trigger>)}
      {standings && <Tabs.Trigger value="standings">Standings</Tabs.Trigger>}
    </Tabs.List>
    <Tabs.Content value="roster">
      {view === "roster" && <RosterView roster={event.roster} division={division} preferences={preferences} change={change} onPin={togglePin} />}
    </Tabs.Content>
    {/* Keep the active RoundView mounted when a live update advances it. */}
    {rounds.filter((item) => item !== round).map((item) => <Tabs.Content key={item.id} value={viewOfRound(item)} />)}
    {round && <Tabs.Content value={view}>
      <RoundView round={round} rounds={rounds} players={players} preferences={preferences} change={change} onPin={togglePin} />
    </Tabs.Content>}
    {standings && division && <Tabs.Content value="standings"><StandingsView division={division} players={players} /></Tabs.Content>}
  </Tabs.Root>;

  return <>
    {division ? <Tabs.Root value={division.id} onValueChange={chooseDivision}>
      <Tabs.List className="division-tabs" aria-label="Divisions">
        {divisions.map(({ id, label }) => <Tabs.Trigger value={id} key={id}>{label}</Tabs.Trigger>)}
      </Tabs.List>
      {divisions.filter(({ id }) => id !== division.id).map(({ id }) => <Tabs.Content key={id} value={id} />)}
      <Tabs.Content value={division.id}>{contents}</Tabs.Content>
    </Tabs.Root> : contents}
    <footer className="view-footer">
      <button type="button" className="quiet-button" onClick={() => setPreferences(defaults)}>Reset view preferences</button>
    </footer>
  </>;
}
