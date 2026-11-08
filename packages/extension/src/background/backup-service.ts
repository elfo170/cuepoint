import {
  backupFilename,
  buildBackup,
  changesSinceLastBackup,
  getBackupSettings,
  recordBackup,
  type BackupRecord,
} from '../data/backup';
import type { Store } from '../data/store';

export const BACKUP_ALARM = 'cuepoint-backup';
export const BACKUP_FOLDER = 'CuePoint/backups';

/** Grava o arquivo em disco. Em produção: chrome.downloads (pasta Downloads/CuePoint/backups). */
export type FileWriter = (filename: string, content: string) => Promise<void>;

function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const downloadsWriter: FileWriter = async (filename, content) => {
  await chrome.downloads.download({
    url: `data:application/json;base64,${toBase64Utf8(content)}`,
    filename: `${BACKUP_FOLDER}/${filename}`,
    conflictAction: 'uniquify',
    saveAs: false,
  });
};

/** Backup automático e manual (PRD §5.8). Nunca apaga backups antigos. */
export class BackupService {
  private running: Promise<BackupRecord | null> | null = null;

  constructor(
    private readonly store: Store,
    private readonly write: FileWriter = downloadsWriter,
  ) {}

  async run(reason: BackupRecord['reason'], force = false): Promise<BackupRecord | null> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        if (!force && (await changesSinceLastBackup(this.store)) <= 0) return null;
        const backup = await buildBackup(this.store);
        const content = JSON.stringify(backup);
        const filename = backupFilename(new Date(backup.created_at));
        await this.write(filename, content);
        const record: BackupRecord = {
          at: backup.created_at,
          filename: `${BACKUP_FOLDER}/${filename}`,
          ops: backup.counts.ops ?? 0,
          sha256: backup.sha256,
          bytes: new TextEncoder().encode(content).length,
          reason,
        };
        await recordBackup(this.store, record);
        return record;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** Chamado após alterações: faz backup ao atingir o limite de N alterações. */
  async onChanges(): Promise<void> {
    const { everyChanges } = await getBackupSettings(this.store);
    if (everyChanges > 0 && (await changesSinceLastBackup(this.store)) >= everyChanges) {
      await this.run('auto');
    }
  }

  /** (Re)agenda o alarme periódico conforme as configurações. */
  async schedule(): Promise<void> {
    const { intervalHours } = await getBackupSettings(this.store);
    await chrome.alarms.clear(BACKUP_ALARM);
    if (intervalHours > 0) {
      await chrome.alarms.create(BACKUP_ALARM, {
        delayInMinutes: 1,
        periodInMinutes: intervalHours * 60,
      });
    }
  }
}
