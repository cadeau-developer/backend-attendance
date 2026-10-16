-- Teachers can record how many discipline marks a case removes from a student.
ALTER TABLE "DisciplineCase" ADD COLUMN "marksDeducted" INTEGER NOT NULL DEFAULT 0;

-- Per-school discipline policy: starting marks and the punishment threshold.
CREATE TABLE "DisciplineSetting" (
    "id" SERIAL NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "defaultMarks" INTEGER NOT NULL DEFAULT 40,
    "punishmentThreshold" INTEGER NOT NULL DEFAULT 10,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisciplineSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DisciplineSetting_schoolId_key" ON "DisciplineSetting"("schoolId");

ALTER TABLE "DisciplineSetting" ADD CONSTRAINT "DisciplineSetting_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
