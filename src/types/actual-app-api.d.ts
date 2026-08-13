// Local declaration for @actual-app/api.
//
// The package resolves to its own raw TypeScript source, which TypeScript then
// typechecks — and that source doesn't compile under this project's `strict`
// settings (its mocks index arrays without null checks). That single dependency
// is why the whole app had `typescript.ignoreBuildErrors: true`, which meant no
// build anywhere ever checked our types.
//
// Declaring the narrow surface actually used (see api/sync/finances) buys back
// build-time typechecking for every other file, and keeps this integration
// honestly typed rather than silently `any`.

declare module "@actual-app/api" {
  export interface ActualAccount {
    id: string
    name: string
    closed?: boolean
    offbudget?: boolean
  }

  export interface ActualPayee {
    id: string
    name: string
  }

  export interface ActualTransaction {
    id: string
    account: string
    date: string
    amount: number
    payee?: string | null
    notes?: string | null
    category?: string | null
    imported_payee?: string | null
    transfer_id?: string | null
  }

  export function init(config: {
    dataDir: string
    serverURL?: string
    password?: string
  }): Promise<void>

  export function downloadBudget(syncId: string, options?: { password?: string }): Promise<void>
  export function getAccounts(): Promise<ActualAccount[]>
  export function getPayees(): Promise<ActualPayee[]>
  export function getTransactions(accountId: string, startDate: string, endDate: string): Promise<ActualTransaction[]>
  export function shutdown(): Promise<void>
}
