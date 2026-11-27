import type { Division, NumberedRound, Pairing, Player } from "./published-tournament";

const ageOrder = { JR: 0, SR: 1, MA: 2 };

export function orderDivisions(divisions: Division[]) {
  return divisions.map((division) => ({
    division, ages: division.ageGroups.map((age) => ageOrder[age]).sort(),
  })).sort((first, second) =>
    (first.ages[0] ?? 3) - (second.ages[0] ?? 3) || first.ages.length - second.ages.length
  ).map(({ division }) => division);
}

export function defaultDivision(divisions: Division[]) {
  return divisions.find(({ ageGroups }) => ageGroups.length === 1 && ageGroups[0] === "MA") ??
    divisions.find(({ ageGroups }) => ageGroups.includes("MA")) ?? divisions[0];
}

export function numberedRounds(division: Division | undefined): NumberedRound[] {
  return (division?.rounds ?? []).filter((round): round is NumberedRound =>
    round.kind === "ROUND" && round.roundNumber !== undefined,
  ).toSorted((first, second) => first.roundNumber - second.roundNumber);
}

export function hasStandings(division: Division | undefined) {
  return Boolean(division?.finalStandings?.some(({ placements }) => placements.length));
}

export type PlayerRecord = { wins: number; losses: number; ties: number };

export function recordsThrough(rounds: NumberedRound[], selectedRound: number) {
  const records = new Map<string, PlayerRecord>();
  const unavailable = new Set<string>();
  const history = rounds.filter(({ roundNumber }) => roundNumber <= selectedRound);
  const hasGaps = history.length !== selectedRound || history.some(({ roundNumber, pairings }, index) =>
    roundNumber !== index + 1 || pairings.length === 0);

  function count(id: string, field: keyof PlayerRecord) {
    const record = records.get(id) ?? { wins: 0, losses: 0, ties: 0 };
    record[field]++;
    records.set(id, record);
  }

  for (const { pairings } of history) {
    for (const { result, player1Id, player2Id } of pairings) {
      if (result.outcome === "PENDING") continue;
      if (!player2Id && result.outcome === "BYE") {
        count(player1Id, "wins");
      } else if (!player2Id && result.outcome === "UNPAIRED_LOSS") {
        count(player1Id, "losses");
      } else if (player2Id && result.outcome === "TIE") {
        count(player1Id, "ties");
        count(player2Id, "ties");
      } else if (player2Id && (result.outcome === "PLAYER1_WIN" || result.outcome === "PLAYER2_WIN")) {
        const firstWon = result.outcome === "PLAYER1_WIN";
        count(player1Id, firstWon ? "wins" : "losses");
        count(player2Id, firstWon ? "losses" : "wins");
      } else {
        unavailable.add(player1Id);
        if (player2Id) unavailable.add(player2Id);
      }
    }
  }

  return (id: string): PlayerRecord | undefined => hasGaps || unavailable.has(id)
    ? undefined : records.get(id) ?? { wins: 0, losses: 0, ties: 0 };
}

export function matchesName(player: Player | undefined, query: string) {
  const normalized = query.trim().normalize("NFC").toLowerCase();
  return !normalized || Boolean(player && (player.displayName.normalize("NFC").toLowerCase().includes(normalized) ||
    player.eventCode === normalized));
}

export function pairedPlayerIds(pairing: Pairing) {
  return pairing.player2Id ? [pairing.player1Id, pairing.player2Id] : [pairing.player1Id];
}

export function hasTable(pairing: Pairing) {
  return pairing.tableNumber !== undefined && pairing.tableNumber > 0;
}

export function orderPairings(pairings: Pairing[], pinnedPlayer: string | null, compare: (a: Pairing, b: Pairing) => number) {
  const pinned: Pairing[] = [];
  const byes: Pairing[] = [];
  const regular: Pairing[] = [];
  for (const pairing of pairings) {
    if (!pinned.length && pinnedPlayer && pairedPlayerIds(pairing).includes(pinnedPlayer)) pinned.push(pairing);
    else if (pairing.result.outcome === "BYE") byes.push(pairing);
    else regular.push(pairing);
  }
  return [...pinned, ...byes, ...regular.sort(compare)];
}
