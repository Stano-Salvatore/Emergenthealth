-- Create DriveImportLog table for tracking Revolut CSV imports from Google Drive
CREATE TABLE IF NOT EXISTS "DriveImportLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rowCount" INTEGER NOT NULL,
  CONSTRAINT "DriveImportLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DriveImportLog_userId_fileId_key" ON "DriveImportLog"("userId", "fileId");
CREATE INDEX IF NOT EXISTS "DriveImportLog_userId_idx" ON "DriveImportLog"("userId");
