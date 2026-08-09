export type ContentType = 'movie' | 'series' | 'anime' | 'other';

export type ProviderCapability = 'recommendations' | 'similar' | 'details' | 'episodes' | 'images' | 'search';

export interface CanonicalId {
  imdb?: string;
  tmdb?: number;
  mal?: number;
  anilist?: number;
  tvdb?: number;
  slug: string;
}

export interface CanonicalItem {
  id: CanonicalId;
  title: string;
  type: ContentType;
  year?: number;
  poster?: string;
  backdrop?: string;
  description?: string;
  genres?: string[];
  runtime?: number;
  trailerYouTubeId?: string;
  voteAverage?: number;
  voteCount?: number;
  releaseDate?: string;
}

export interface CandidateSource {
  readonly providerId: string;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  getRecommendations?(seed: CanonicalItem, signal?: AbortSignal): AsyncIterable<CanonicalItem>;
  getSimilar?(seed: CanonicalItem, signal?: AbortSignal): AsyncIterable<CanonicalItem>;
}

export interface MetadataSource {
  readonly providerId: string;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  getDetails?(id: CanonicalId, signal?: AbortSignal): Promise<Partial<CanonicalItem> | null>;
  getEpisodes?(id: CanonicalId, season: number, signal?: AbortSignal): Promise<Episode[]>;
}

export interface ScoredItem extends CanonicalItem {
  score: number;
  source: string;
  reason?: string;
}

export interface Episode {
  id: string;
  season: number;
  episode: number;
  title?: string;
  overview?: string;
  thumbnail?: string;
  airDate?: string;
}