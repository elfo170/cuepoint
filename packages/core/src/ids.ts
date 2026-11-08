import { v5 as uuidv5, v7 as uuidv7, validate } from 'uuid';

/** Namespace fixo do CuePoint para UUIDv5 (não alterar: quebra a deduplicação entre aparelhos). */
export const CUEPOINT_NAMESPACE = '6f2b8f5e-3c1a-4d7e-9a43-2f6c1b9e0d57';

/** Novo identificador aleatório e ordenável no tempo. */
export function newId(): string {
  return uuidv7();
}

export function isUuid(value: string): boolean {
  return validate(value);
}

/** Identificador determinístico: o mesmo `name` gera o mesmo id em qualquer dispositivo. */
export function deterministicId(name: string): string {
  return uuidv5(name, CUEPOINT_NAMESPACE);
}

/** Faixa identificada por URN SoundCloud: id estável derivado do URN. */
export function trackIdFromUrn(urn: string): string {
  return deterministicId(`track:${urn}`);
}

/** Uma decisão por música e pesquisa. */
export function decisionId(trackId: string, researchId: string): string {
  return deterministicId(`decision:${trackId}:${researchId}`);
}

/** Uma classificação por música, pesquisa e categoria. */
export function trackCategoryId(trackId: string, researchId: string, categoryId: string): string {
  return deterministicId(`track_category:${trackId}:${researchId}:${categoryId}`);
}

/** Uma música aparece uma vez por playlist. */
export function playlistTrackId(playlistId: string, trackId: string): string {
  return deterministicId(`playlist_track:${playlistId}:${trackId}`);
}

/** Id do registro de conflito de um campo. */
export function conflictId(entityType: string, entityId: string, field: string): string {
  return deterministicId(`conflict:${entityType}:${entityId}:${field}`);
}
