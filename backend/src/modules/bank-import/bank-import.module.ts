import type { Database } from '../../infrastructure/database/database.ts';
import type { ExpenseService } from '../expenses/expenses.service.ts';
import type { GroupsRepository } from '../groups/groups.repository.ts';
import type { SyncService } from '../sync/sync.service.ts';
import { ApiKeysRepository } from './api-keys.repository.ts';
import { ApiKeysService } from './api-keys.service.ts';
import type { BankImportRoutesDeps } from './bank-import.routes.ts';
import { BankImportService } from './import.service.ts';
import { BankImportsRepository } from './imports.repository.ts';

export interface BankImportModuleOptions {
  database: Database;
  expenses: ExpenseService;
  groups: GroupsRepository;
  sync: Pick<SyncService, 'requestCycle' | 'enabled'>;
  /** For tests */
  limits?: BankImportRoutesDeps['limits'];
}

/** Everything of the notification import assembled in one place, so the server and the tests wire it the same way. */
export function createBankImportModule(options: BankImportModuleOptions): BankImportRoutesDeps {
  const { database } = options;
  const imports = new BankImportsRepository(database);
  return {
    keys: new ApiKeysService(new ApiKeysRepository(database)),
    imports: new BankImportService({
      database,
      imports,
      expenses: options.expenses,
      groups: options.groups,
      sync: options.sync,
    }),
    history: imports,
    limits: options.limits,
  };
}
