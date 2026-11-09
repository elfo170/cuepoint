import type { Curation, TrackInput } from '../data/curation';
import type { BackupService } from './backup-service';
import type { Option, Request, WidgetState } from '../shared/messages';

const toOption = (r: { id: string; name: string }): Option => ({ id: r.id, name: r.name });

/** Lógica do service worker, sem dependência direta de `chrome.*` (testável). */
export class BackgroundHandler {
  constructor(
    private readonly curation: Curation,
    private readonly openLibrary: (hash?: string) => Promise<void> = async () => undefined,
    private readonly backups?: BackupService,
  ) {}

  async state(track: TrackInput | null): Promise<WidgetState> {
    const [researches, categories, activeResearchId] = await Promise.all([
      this.curation.listResearches(),
      this.curation.listCategories(),
      this.curation.getActiveResearchId(),
    ]);
    const trackState = track
      ? await this.curation.getTrackState(track, activeResearchId)
      : { trackId: null, provisional: false, decision: null, categoryIds: [] };
    return {
      researches: researches.map(toOption),
      categories: categories.map(toOption),
      activeResearchId,
      track: trackState,
    };
  }

  private async requireResearch(): Promise<string> {
    const id = await this.curation.getActiveResearchId();
    if (!id) throw new Error('Escolha uma pesquisa antes de classificar.');
    return id;
  }

  async handle(req: Request): Promise<unknown> {
    switch (req.type) {
      case 'ping':
        return 'pong';
      case 'widget:getState':
        return this.state(req.track);
      case 'widget:decide': {
        const researchId = await this.requireResearch();
        const track = await this.curation.ensureTrack(req.track);
        await this.curation.decide(track.id, researchId, req.value);
        return this.state(req.track);
      }
      case 'widget:setCategory': {
        const researchId = await this.requireResearch();
        const track = await this.curation.ensureTrack(req.track);
        await this.curation.setTrackCategory(track.id, researchId, req.categoryId, req.on);
        return this.state(req.track);
      }
      case 'widget:createCategory': {
        const category = await this.curation.createCategory(req.name);
        if (req.track) {
          const researchId = await this.requireResearch();
          const track = await this.curation.ensureTrack(req.track);
          await this.curation.setTrackCategory(track.id, researchId, category.id, true);
        }
        return this.state(req.track);
      }
      case 'widget:setActiveResearch':
        await this.curation.setActiveResearchId(req.researchId);
        return null;
      case 'widget:createResearch': {
        const research = await this.curation.createResearch(req.name);
        await this.curation.setActiveResearchId(research.id);
        return toOption(research);
      }
      case 'openLibrary':
        await this.openLibrary(req.hash);
        return null;
      case 'notifyChanged':
        return null;
      case 'backup:run':
        if (!this.backups) throw new Error('Backup indisponível.');
        return this.backups.run(req.reason, true);
      case 'store:reset':
        this.curation.store.resetIdentity();
        return null;
      case 'backup:reschedule':
        await this.backups?.schedule();
        return null;
      default:
        return null;
    }
  }
}
