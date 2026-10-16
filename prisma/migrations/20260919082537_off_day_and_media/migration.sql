-- AlterTable
ALTER TABLE "DisciplineCase" ADD COLUMN     "reviewed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "logoUrl" TEXT;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "photoUrl" TEXT;

-- CreateTable
CREATE TABLE "OffDay" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OffDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OffDay_date_key" ON "OffDay"("date");
