-- Allow students to exist without an active class (undergraduates / alumni).
ALTER TABLE "Student" ALTER COLUMN "classId" DROP NOT NULL;

-- One row per student per class per year: the student's enrolment record.
CREATE TABLE "StudentRecord" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "classSnapshot" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "termCompleted" BOOLEAN NOT NULL DEFAULT false,
    "movedToClassId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "StudentRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentRecord_studentId_classId_year_key" ON "StudentRecord"("studentId", "classId", "year");

CREATE INDEX "StudentRecord_schoolId_year_idx" ON "StudentRecord"("schoolId", "year");

CREATE INDEX "StudentRecord_studentId_idx" ON "StudentRecord"("studentId");

ALTER TABLE "StudentRecord" ADD CONSTRAINT "StudentRecord_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudentRecord" ADD CONSTRAINT "StudentRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
