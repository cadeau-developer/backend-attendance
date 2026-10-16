-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "parentNames" TEXT,
ADD COLUMN     "parentPhone" TEXT;

-- CreateTable
CREATE TABLE "Term" (
    "id" SERIAL NOT NULL,
    "starts" DATE NOT NULL,
    "ends" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classId" INTEGER NOT NULL,

    CONSTRAINT "Term_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Term_classId_idx" ON "Term"("classId");

-- AddForeignKey
ALTER TABLE "Term" ADD CONSTRAINT "Term_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;