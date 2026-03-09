-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActive" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadedFile" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "fileType" TEXT NOT NULL,
    "schema" JSONB NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkpoint" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "snapshotPath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_lastActive_idx" ON "Session"("lastActive");

-- CreateIndex
CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "UploadedFile_sessionId_idx" ON "UploadedFile"("sessionId");

-- CreateIndex
CREATE INDEX "Checkpoint_sessionId_createdAt_idx" ON "Checkpoint"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedFile" ADD CONSTRAINT "UploadedFile_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
