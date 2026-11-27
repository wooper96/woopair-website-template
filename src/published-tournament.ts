export type AgeGroup = "JR" | "SR" | "MA";
export type Phase = "SETUP" | "LIVE" | "COMPLETED";
export type PlayerStatus = "ACTIVE" | "DROPPED" | "DISQUALIFIED" | "UNKNOWN";
type Outcome = "PENDING" | "PLAYER1_WIN" | "PLAYER2_WIN" | "TIE" | "BYE" | "UNPAIRED_LOSS" | "UNKNOWN";

export type Player = {
  id: string;
  displayName: string;
  status: PlayerStatus;
  eventCode?: string;
};

export type Pairing = {
  id: string;
  player1Id: string;
  player2Id?: string;
  tableNumber?: number;
  result: { outcome: Outcome };
};

type Round = {
  id: string;
  kind: "ROUND" | "RESULTS";
  roundNumber?: number;
  pairings: Pairing[];
};

export type NumberedRound = Round & { roundNumber: number };
type Placement = { playerId: string; place: number };

export type Division = {
  id: string;
  label: string;
  ageGroups: AgeGroup[];
  playerIds?: string[];
  rounds: Round[];
  finalStandings?: { placements: Placement[] }[];
};

export type EventSummary = {
  id: string;
  revision: string;
  revisionNumber?: number;
  displayName: string;
  phase: Phase;
  updatedAt: string;
  eventDate?: string;
};

export type Event = EventSummary & {
  roster: Player[];
  divisions: Division[];
};

export type Site = { leagueName: string; tournaments: EventSummary[]; event?: Event };
type JsonObject = Record<string, unknown>;

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const phases = new Set<unknown>(["SETUP", "LIVE", "COMPLETED"]);
const ages = new Set<unknown>(["JR", "SR", "MA"]);
const statuses = new Set<unknown>(["ACTIVE", "DROPPED", "DISQUALIFIED", "UNKNOWN"]);
const outcomes = new Set<unknown>([
  "PENDING", "PLAYER1_WIN", "PLAYER2_WIN", "TIE", "BYE", "UNPAIRED_LOSS", "UNKNOWN",
]);

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function date(value: unknown): value is string {
  return text(value) && Number.isFinite(Date.parse(value));
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isSummary(value: unknown): value is EventSummary {
  return object(value) && text(value.id) && uuid.test(value.id) && text(value.revision) && uuid.test(value.revision) &&
    text(value.displayName) && phases.has(value.phase) && date(value.updatedAt) &&
    (value.revisionNumber === undefined || positiveInteger(value.revisionNumber)) &&
    (value.eventDate === undefined || date(value.eventDate));
}

function isPlayer(value: unknown): value is Player {
  return object(value) && text(value.id) && text(value.displayName) && statuses.has(value.status) &&
    (value.eventCode === undefined || (typeof value.eventCode === "string" && /^\d{4}$/.test(value.eventCode)));
}

function isPairing(value: unknown): value is Pairing {
  return object(value) && text(value.id) && text(value.player1Id) &&
    (value.player2Id === undefined || text(value.player2Id)) &&
    (value.tableNumber === undefined || (typeof value.tableNumber === "number" && Number.isSafeInteger(value.tableNumber) &&
      value.tableNumber >= 0)) && object(value.result) && outcomes.has(value.result.outcome);
}

function isDivision(value: unknown): value is Division {
  return object(value) && text(value.id) && text(value.label) &&
    Array.isArray(value.ageGroups) && value.ageGroups.every((age) => ages.has(age)) &&
    (value.playerIds === undefined || (Array.isArray(value.playerIds) && value.playerIds.every(text))) &&
    Array.isArray(value.rounds) && value.rounds.every((round) => object(round) && text(round.id) &&
      (round.kind === "ROUND" || round.kind === "RESULTS") &&
      (round.roundNumber === undefined || positiveInteger(round.roundNumber)) &&
      Array.isArray(round.pairings) && round.pairings.every(isPairing)) &&
    (value.finalStandings === undefined || (Array.isArray(value.finalStandings) &&
      value.finalStandings.every((group) => object(group) && Array.isArray(group.placements) &&
        group.placements.every((placement) => object(placement) && text(placement.playerId) && positiveInteger(placement.place)))));
}

function isEvent(value: unknown): value is Event {
  return object(value) && value.schemaVersion === 1 &&
    Array.isArray(value.roster) && value.roster.every(isPlayer) &&
    Array.isArray(value.divisions) && value.divisions.every(isDivision) && isSummary(value);
}

async function readJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(new URL(path, window.location.href), { cache: "no-store", signal });
  if (!response.ok) throw new Error("Website data is unavailable");
  return response.json();
}

function canAdvanceRevision(current: EventSummary, next: EventSummary): boolean {
  if (current.revisionNumber !== undefined || next.revisionNumber !== undefined) {
    return (next.revisionNumber ?? 0) > (current.revisionNumber ?? 0);
  }
  // Legacy publishes only have timestamps to compare.
  return Date.parse(next.updatedAt) >= Date.parse(current.updatedAt);
}

function matchesRevision(first: EventSummary, second: EventSummary): boolean {
  return first.revision === second.revision && first.phase === second.phase && first.revisionNumber === second.revisionNumber;
}

export async function loadSite(eventId: string | null, previous: Site | null, signal: AbortSignal): Promise<Site> {
  const [league, index] = await Promise.all([readJson("./league.json", signal), readJson("./data/tournaments/index.json", signal)]);
  if (!object(league) || league.templateVersion !== 1 || !(league.displayName === null || text(league.displayName)) ||
      !object(index) || index.schemaVersion !== 1 || !Array.isArray(index.tournaments) || !index.tournaments.every(isSummary) ||
      new Set(index.tournaments.map(({ id }) => id)).size !== index.tournaments.length) {
    throw new Error("Website data is invalid");
  }

  const site = { leagueName: league.displayName ?? "WooPair league", tournaments: index.tournaments };
  if (!eventId) {
    const nextById = new Map(index.tournaments.map((entry) => [entry.id, entry]));
    const outdated = previous?.tournaments.some((current) => {
      const next = nextById.get(current.id);
      return !next || (next.revision === current.revision ? !matchesRevision(current, next) : !canAdvanceRevision(current, next));
    });
    if (outdated) throw new Error("Tournament index is outdated");
    return site;
  }

  const summary = index.tournaments.find(({ id }) => id === eventId);
  const current = previous?.event?.id === eventId ? previous.event : undefined;
  if (!summary) {
    if (current) throw new Error("Tournament revision is unavailable");
    return site;
  }
  if (current && matchesRevision(current, summary)) {
    return { ...site, event: current };
  }
  const event = await readJson(`./data/tournaments/${summary.id}.json`, signal);
  if (!isEvent(event) || event.id !== summary.id || !matchesRevision(summary, event) ||
      (current && !canAdvanceRevision(current, event))) {
    throw new Error("Tournament revision is unavailable");
  }

  return { ...site, event };
}
