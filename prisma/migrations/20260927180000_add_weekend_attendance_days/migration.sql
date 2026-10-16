CREATE TABLE "WeekendAttendanceDay" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "schoolId" INTEGER NOT NULL,

    CONSTRAINT "WeekendAttendanceDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WeekendAttendanceDay_date_schoolId_key"
ON "WeekendAttendanceDay"("date", "schoolId");

CREATE INDEX "WeekendAttendanceDay_schoolId_idx"
ON "WeekendAttendanceDay"("schoolId");

ALTER TABLE "WeekendAttendanceDay"
ADD CONSTRAINT "WeekendAttendanceDay_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "School"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
