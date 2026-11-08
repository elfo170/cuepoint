import { Replica, syncPair, type ConflictInfo, type EntityRecord, type Op } from '../src';

/** Identificadores fixos usados nos cenários (e nos vetores compartilhados com o Kotlin). */
export const IDS = {
  user: '00000000-0000-4000-8000-000000000001',
  deviceA: 'aaaaaaaa-0000-4000-8000-00000000000a',
  deviceB: 'bbbbbbbb-0000-4000-8000-00000000000b',
  deviceC: 'cccccccc-0000-4000-8000-00000000000c',
  trackA: '10000000-0000-4000-8000-000000000001',
  trackB: '10000000-0000-4000-8000-000000000002',
  research1: '20000000-0000-4000-8000-000000000001',
  research2: '20000000-0000-4000-8000-000000000002',
  categoryX: '30000000-0000-4000-8000-000000000001',
  categoryY: '30000000-0000-4000-8000-000000000002',
} as const;

export const START_MS = 1_767_225_600_000; // 2026-01-01T00:00:00Z

/** Relógio compartilhado e determinístico: avança 1 s a cada leitura. */
export function fakeClock(start = START_MS) {
  let t = start;
  return () => (t += 1000);
}

export interface World {
  A: Replica;
  B: Replica;
  C: Replica;
  sync: (x: Replica, y: Replica) => void;
}

export function newWorld(): World {
  const now = fakeClock();
  return {
    A: new Replica(IDS.deviceA, IDS.user, now),
    B: new Replica(IDS.deviceB, IDS.user, now),
    C: new Replica(IDS.deviceC, IDS.user, now),
    sync: syncPair,
  };
}

export function seedTrack(r: Replica, id: string = IDS.trackA, urn = 'soundcloud:tracks:1') {
  return r.put('track', id, {
    soundcloud_urn: urn,
    soundcloud_url: 'https://soundcloud.com/artist/track',
    title: 'Track',
    artist: 'Artist',
    artwork_url: null,
    metadata_source: 'dom',
    merged_into: null,
  });
}

export function seedResearch(r: Replica, id: string, name: string) {
  return r.put('research', id, { user_id: IDS.user, name, description: '', archived: false });
}

export function seedCategory(r: Replica, id: string, name: string) {
  return r.put('category', id, { user_id: IDS.user, name, description: '' });
}

export function decide(
  r: Replica,
  trackId: string,
  researchId: string,
  value: boolean,
  decisionId: string,
) {
  return r.put('decision', decisionId, {
    user_id: IDS.user,
    track_id: trackId,
    research_id: researchId,
    decision: value,
    device_source: r.deviceId,
  });
}

export interface Scenario {
  name: string;
  description: string;
  run: (w: World) => void;
}

export interface ScenarioResult {
  name: string;
  description: string;
  ops: Op[];
  records: EntityRecord[];
  conflicts: ConflictInfo[];
}

/** Executa o cenário, sincroniza tudo e devolve o estado convergente. */
export function runScenario(s: Scenario): ScenarioResult & { world: World } {
  const world = newWorld();
  s.run(world);
  const { A, B, C } = world;
  syncPair(A, B);
  syncPair(B, C);
  syncPair(A, B);
  const ops = [...A.log].sort((x, y) => (x.hlc < y.hlc ? -1 : 1));
  const records = [...A.records.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, r]) => r);
  return {
    name: s.name,
    description: s.description,
    ops,
    records,
    conflicts: A.conflicts(),
    world,
  };
}
