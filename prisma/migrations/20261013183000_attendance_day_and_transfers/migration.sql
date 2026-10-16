-- Students can be marked as having left the school.
ALTER TABLE "Student" ADD COLUMN "leftSchool" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "leftAt" TIMESTAMP(3);

-- Per class/day record of how many times attendance was corrected.
CREATE TABLE "AttendanceDay" (
    "id" SERIAL NOT NULL,
    "classId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "editCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendanceDay_classId_date_key" ON "AttendanceDay"("classId", "date");
CREATE INDEX "AttendanceDay_classId_idx" ON "AttendanceDay"("classId");

-- Incoming students waiting to be received into a class.
CREATE TABLE "PendingTransfer" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "fromClassId" INTEGER,
    "fromClassName" TEXT NOT NULL,
    "toClassId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "PendingTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingTransfer_schoolId_year_idx" ON "PendingTransfer"("schoolId", "year");
CREATE INDEX "PendingTransfer_toClassId_status_idx" ON "PendingTransfer"("toClassId", "status");
CREATE INDEX "PendingTransfer_studentId_idx" ON "PendingTransfer"("studentId");

ALTER TABLE "PendingTransfer" ADD CONSTRAINT "PendingTransfer_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
