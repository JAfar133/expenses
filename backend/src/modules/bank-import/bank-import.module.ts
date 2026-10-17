import type { Database } from '../../infrastructure/database/database.ts';
import type { ExpenseEditor } from '../expenses/expense-editor.ts';
import type { ExpenseService } from '../expenses/expenses.service.ts';
import type { GroupsRepository } from '../groups/groups.repository.ts';
import type { NotificationsService } from '../notifications/notifications.service.ts';
import type { SyncService } from '../sync/sync.service.ts';
import { ApiKeysRepository } from './api-keys.repository.ts';
import { ApiKeysService } from './api-keys.service.ts';
import type { BankImportRoutesDeps } from './bank-import.routes.ts';
import { ImportLogRepository } from './import-log.repository.ts';
import { BankImportService } from './import.service.ts';
import { BankImportsRepository } from './imports.repository.ts';

export interface BankImportModuleOptions {
  database: Database;
  expenses: ExpenseService;
  editor: ExpenseEditor;
  groups: GroupsRepository;
  sync: Pick<SyncService, 'requestCycle' | 'enabled'>;
  /** The bell of the app */
  notifications?: Pick<NotificationsService, 'emit' | 'retract'>;
  /** For tests */
  limits?: BankImportRoutesDeps['limits'];
}

/** Everything of the notification import assembled in one place, so the server and the tests wire it the same way. */
export function createBankImportModule(options: BankImportModuleOptions): BankImportRoutesDeps {
  const { database } = options;
  const imports = new BankImportsRepository(database);
  const log = new ImportLogRepository(database);
  return {
    keys: new ApiKeysService(new ApiKeysRepository(database)),
    imports: new BankImportService({
      database,
      imports,
      log,
      expenses: options.expenses,
      editor: options.editor,
      groups: options.groups,
      sync: options.sync,
      notifications: options.notifications,
    }),
    log,
    limits: options.limits,
  };
}
