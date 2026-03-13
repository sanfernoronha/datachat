-- CreateIndex
CREATE UNIQUE INDEX "UploadedFile_sessionId_filename_key" ON "UploadedFile"("sessionId", "filename");
