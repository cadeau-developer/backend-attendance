-- DropIndex
DROP INDEX "OffDay_date_key";

-- AlterTable
ALTER TABLE "OffDay" ADD COLUMN     "schoolId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "OffDay_date_schoolId_key" ON "OffDay"("date", "schoolId");

-- AddForeignKey
ALTER TABLE "OffDay" ADD CONSTRAINT "OffDay_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;